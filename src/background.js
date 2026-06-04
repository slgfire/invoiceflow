// Kein direkter PaperlessClient-Import mehr — alle Paperless-Calls laufen
// über das Offscreen Document (mTLS-fähiger fetch()-Kontext).

// ─── State ───────────────────────────────────────────────────────────────────

let activeJob    = null;
let progressPort = null;

// ─── Start-URLs je Shop ───────────────────────────────────────────────────────

const SHOP_START_URL = {
  amazon:     'https://www.amazon.de/gp/your-account/order-history',
  ebay:       'https://www.ebay.de/mye/myebay/purchase',
  zalando:    'https://www.zalando.de/myaccount/orders',
  mediamarkt: 'https://www.mediamarkt.de/de/myaccount/orders',
  otto:       'https://www.otto.de/meinekonto/bestellungen',
};

// ─── Messaging ────────────────────────────────────────────────────────────────

chrome.runtime.onConnect.addListener(port => {
  if (port.name !== 'progress') return;
  progressPort = port;
  port.onDisconnect.addListener(() => { progressPort = null; });
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action === 'START_DOWNLOAD') {
    if (activeJob) { sendResponse({ error: 'Download läuft bereits.' }); return false; }
    startDownload(msg.config).catch(err => emit({ type: 'FATAL', message: err.message }));
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

// ─── Offscreen Document ───────────────────────────────────────────────────────

async function ensureOffscreen() {
  const exists = await chrome.offscreen.hasDocument();
  if (!exists) {
    await chrome.offscreen.createDocument({
      url:           'offscreen.html',
      reasons:       [chrome.offscreen.Reason.BLOBS],
      justification: 'Paperless API-Calls benötigen mTLS-Unterstützung — ' +
                     'nur im Rendering-Kontext verfügbar, nicht im Service Worker.',
    });
  }
}

async function closeOffscreen() {
  const exists = await chrome.offscreen.hasDocument();
  if (exists) await chrome.offscreen.closeDocument();
}

/**
 * Sendet einen Paperless-Aufruf an das Offscreen Document und wartet auf die Antwort.
 */
function paperless(action, paperlessUrl, paperlessToken, params = {}) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      { target: 'offscreen', action, paperlessUrl, paperlessToken, ...params },
      response => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else if (response?.error) {
          reject(new Error(response.error));
        } else {
          resolve(response?.result);
        }
      }
    );
  });
}

// ─── Haupt-Download-Logik ─────────────────────────────────────────────────────

async function startDownload(config) {
  const { shops, dateFrom, dateTo, paperlessUrl, paperlessToken, shopTags = {} } = config;

  await ensureOffscreen();

  emit({ type: 'STATUS', message: 'Verbinde mit Paperless-ngx…' });
  try {
    await paperless('TEST_CONNECTION', paperlessUrl, paperlessToken);
  } catch (e) {
    emit({ type: 'FATAL', message: `Paperless nicht erreichbar: ${e.message}` });
    await closeOffscreen();
    return;
  }
  emit({ type: 'STATUS', message: 'Paperless-Verbindung OK.' });

  activeJob = { cancelled: false };

  let totalUploaded   = 0;
  let totalDuplicates = 0;
  let totalErrors     = 0;

  for (const shopId of shops) {
    if (activeJob.cancelled) break;
    if (!SHOP_START_URL[shopId]) continue;

    emit({ type: 'SHOP_START', shop: shopId });

    let tab;
    try {
      tab = await openTab(SHOP_START_URL[shopId]);
      await waitForTabLoad(tab.id);
      await sleep(1200);

      emit({ type: 'SHOP_STATUS', shop: shopId, message: 'Lade Bestellliste…' });

      const listResult = await sendToTab(tab.id, { action: 'GET_INVOICES', dateFrom, dateTo }, 120_000);
      if (listResult.error) throw new Error(listResult.error);

      const invoices = listResult.invoices ?? [];
      emit({ type: 'SHOP_INVOICES_FOUND', shop: shopId, count: invoices.length });

      for (let i = 0; i < invoices.length; i++) {
        if (activeJob.cancelled) break;

        const inv = invoices[i];
        emit({ type: 'INVOICE_PROCESSING', shop: shopId, filename: inv.filename, current: i + 1, total: invoices.length });

        try {
          // 1. Lokaler Cache
          if (await isLocalCached(inv.orderId)) {
            emit({ type: 'INVOICE_SKIP', filename: inv.filename, reason: 'cache' });
            totalDuplicates++;
            continue;
          }

          // 2. Paperless-Duplikatprüfung (läuft im Offscreen → mTLS)
          const exists = await paperless('CHECK_DUPLICATE', paperlessUrl, paperlessToken, { orderId: inv.orderId });
          if (exists) {
            await addLocalCache(inv.orderId);
            emit({ type: 'INVOICE_SKIP', filename: inv.filename, reason: 'paperless' });
            totalDuplicates++;
            continue;
          }

          // 3. PDF vom Shop laden (Content Script im Tab → Session-Cookies)
          const fetchResult = await sendToTab(tab.id, { action: 'FETCH_INVOICE', url: inv.invoiceUrl }, 45_000);
          if (fetchResult.error) throw new Error(fetchResult.error);
          if (fetchResult.dataUrl.length < 500) throw new Error('PDF zu klein — kein gültiges Dokument.');

          // 4. Upload über Offscreen Document (mTLS)
          await paperless('UPLOAD_DOCUMENT', paperlessUrl, paperlessToken, {
            dataUrl:  fetchResult.dataUrl,
            filename: inv.filename,
            tagIds:   shopTags[shopId] ?? [],
          });

          await addLocalCache(inv.orderId);
          emit({ type: 'INVOICE_UPLOADED', filename: inv.filename });
          totalUploaded++;

        } catch (err) {
          emit({ type: 'INVOICE_ERROR', filename: inv.filename, message: err.message });
          totalErrors++;
        }

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
  await closeOffscreen();
  emit({ type: 'ALL_DONE', uploaded: totalUploaded, duplicates: totalDuplicates, errors: totalErrors });
}

// ─── Hilfsfunktionen ─────────────────────────────────────────────────────────

function emit(data) {
  if (progressPort) {
    try { progressPort.postMessage(data); } catch (_) {}
  }
}

function openTab(url) {
  return new Promise(resolve => chrome.tabs.create({ url, active: false }, resolve));
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
    const timer = setTimeout(() => reject(new Error(`Tab-Nachricht Timeout (${timeoutMs}ms)`)), timeoutMs);
    chrome.tabs.sendMessage(tabId, message, response => {
      clearTimeout(timer);
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(response ?? {});
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
