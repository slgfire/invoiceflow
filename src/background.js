import { PaperlessClient } from './paperless.js';

// ─── State ───────────────────────────────────────────────────────────────────

let activeJob = null;   // { cancelled: bool }
let progressPort = null; // long-lived connection to popup

// ─── Start-URLs je Shop ───────────────────────────────────────────────────────

const SHOP_START_URL = {
  amazon:     'https://www.amazon.de/gp/your-account/order-history',
  ebay:       'https://www.ebay.de/mye/myebay/purchase',
  zalando:    'https://www.zalando.de/myaccount/orders',
  mediamarkt: 'https://www.mediamarkt.de/de/myaccount/orders',
  otto:       'https://www.otto.de/meinekonto/bestellungen',
};

// ─── Messaging ────────────────────────────────────────────────────────────────

// Popup verbindet sich per chrome.runtime.connect({ name: 'progress' })
// um den Service Worker während des Downloads am Leben zu halten und
// Echtzeit-Updates zu empfangen.
chrome.runtime.onConnect.addListener(port => {
  if (port.name !== 'progress') return;
  progressPort = port;
  port.onDisconnect.addListener(() => { progressPort = null; });
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action === 'START_DOWNLOAD') {
    if (activeJob) {
      sendResponse({ error: 'Download läuft bereits.' });
      return false;
    }
    startDownload(msg.config)
      .catch(err => emit({ type: 'FATAL', message: err.message }));
    sendResponse({ success: true });
    return false;
  }

  if (msg.action === 'CANCEL_DOWNLOAD') {
    if (activeJob) activeJob.cancelled = true;
    sendResponse({ success: true });
    return false;
  }

  if (msg.action === 'GET_STATUS') {
    sendResponse({ running: !!activeJob });
    return false;
  }
});

// ─── Haupt-Download-Logik ─────────────────────────────────────────────────────

async function startDownload(config) {
  const { shops, dateFrom, dateTo, paperlessUrl, paperlessToken, tagIds = [] } = config;

  const paperless = new PaperlessClient(paperlessUrl, paperlessToken);

  emit({ type: 'STATUS', message: 'Verbinde mit Paperless-ngx…' });
  try {
    await paperless.testConnection();
  } catch (e) {
    emit({ type: 'FATAL', message: `Paperless nicht erreichbar: ${e.message}` });
    return;
  }
  emit({ type: 'STATUS', message: 'Paperless-Verbindung OK.' });

  activeJob = { cancelled: false };

  let totalUploaded  = 0;
  let totalDuplicates = 0;
  let totalErrors    = 0;

  for (const shopId of shops) {
    if (activeJob.cancelled) break;
    if (!SHOP_START_URL[shopId]) continue;

    emit({ type: 'SHOP_START', shop: shopId });

    let tab;
    try {
      tab = await openTab(SHOP_START_URL[shopId]);
      await waitForTabLoad(tab.id);
      await sleep(1200); // Warten bis Content-Scripts fertig sind

      emit({ type: 'SHOP_STATUS', shop: shopId, message: 'Lade Bestellliste…' });

      const listResult = await sendToTab(tab.id, {
        action: 'GET_INVOICES',
        dateFrom,
        dateTo,
      }, 120_000);

      if (listResult.error) throw new Error(listResult.error);

      const invoices = listResult.invoices ?? [];
      emit({ type: 'SHOP_INVOICES_FOUND', shop: shopId, count: invoices.length });

      for (let i = 0; i < invoices.length; i++) {
        if (activeJob.cancelled) break;

        const inv = invoices[i];
        emit({
          type: 'INVOICE_PROCESSING',
          shop: shopId,
          filename: inv.filename,
          current: i + 1,
          total: invoices.length,
        });

        try {
          // 1. Lokaler Cache
          if (await isLocalCached(inv.orderId)) {
            emit({ type: 'INVOICE_SKIP', filename: inv.filename, reason: 'cache' });
            totalDuplicates++;
            continue;
          }

          // 2. Paperless-Duplikatprüfung
          if (await paperless.checkDuplicate(inv.orderId)) {
            await addLocalCache(inv.orderId);
            emit({ type: 'INVOICE_SKIP', filename: inv.filename, reason: 'paperless' });
            totalDuplicates++;
            continue;
          }

          // 3. PDF vom Shop laden
          const fetchResult = await sendToTab(tab.id, {
            action: 'FETCH_INVOICE',
            url: inv.invoiceUrl,
          }, 45_000);

          if (fetchResult.error) throw new Error(fetchResult.error);

          // base64-DataURL → Blob
          const pdfResp = await fetch(fetchResult.dataUrl);
          const blob    = await pdfResp.blob();

          if (blob.size < 500) throw new Error('PDF zu klein — vermutlich Fehlerseite.');

          // 4. Hochladen
          await paperless.uploadDocument(blob, inv.filename, tagIds);
          await addLocalCache(inv.orderId);

          emit({ type: 'INVOICE_UPLOADED', filename: inv.filename });
          totalUploaded++;

        } catch (err) {
          emit({ type: 'INVOICE_ERROR', filename: inv.filename, message: err.message });
          totalErrors++;
        }

        // Anti-Bot-Pause
        await sleep(300 + Math.random() * 500);
      }

    } catch (err) {
      emit({ type: 'SHOP_ERROR', shop: shopId, message: err.message });
    } finally {
      if (tab) await chrome.tabs.remove(tab.id).catch(() => {});
    }

    emit({ type: 'SHOP_DONE', shop: shopId });
  }

  activeJob = null;
  emit({ type: 'ALL_DONE', uploaded: totalUploaded, duplicates: totalDuplicates, errors: totalErrors });
}

// ─── Hilfsfunktionen ─────────────────────────────────────────────────────────

function emit(data) {
  if (progressPort) {
    try { progressPort.postMessage(data); } catch (_) { /* popup geschlossen */ }
  }
}

function openTab(url) {
  return new Promise(resolve =>
    chrome.tabs.create({ url, active: false }, resolve)
  );
}

function waitForTabLoad(tabId) {
  return new Promise(resolve => {
    function onUpdated(id, info) {
      if (id === tabId && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(onUpdated);
        resolve();
      }
    }
    chrome.tabs.onUpdated.addListener(onUpdated);
  });
}

function sendToTab(tabId, message, timeoutMs = 30_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Tab-Nachricht Timeout (${timeoutMs}ms)`)),
      timeoutMs
    );
    chrome.tabs.sendMessage(tabId, message, response => {
      clearTimeout(timer);
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(response ?? {});
      }
    });
  });
}

async function isLocalCached(orderId) {
  const { processedOrders = {} } = await chrome.storage.local.get('processedOrders');
  return Boolean(processedOrders[orderId]);
}

async function addLocalCache(orderId) {
  const { processedOrders = {} } = await chrome.storage.local.get('processedOrders');
  processedOrders[orderId] = Date.now();
  await chrome.storage.local.set({ processedOrders });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
