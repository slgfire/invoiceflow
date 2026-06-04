// Guard against double-injection (e.g. via executeScript on top of manifest injection)
if (!window.__invoiceFlowLoaded) {
  window.__invoiceFlowLoaded = true;

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    const plugin = window.InvoiceFlowPlugin;

    if (!plugin) {
      sendResponse({ error: 'Kein Plugin für diese Seite verfügbar.' });
      return false;
    }

    if (message.action === 'PING') {
      sendResponse({ ok: true, plugin: plugin.name });
      return false;
    }

    if (message.action === 'GET_INVOICES') {
      plugin
        .getInvoices(message.dateFrom, message.dateTo)
        .then(invoices => sendResponse({ success: true, invoices }))
        .catch(err => sendResponse({ error: err.message }));
      return true;
    }

    if (message.action === 'GET_INVOICES_PAGE') {
      if (typeof plugin.getInvoicesFromCurrentPage !== 'function') {
        // Fallback für Plugins ohne DOM-basiertes Scraping
        sendResponse({ error: 'GET_INVOICES_PAGE nicht unterstützt.' });
        return false;
      }
      plugin
        .getInvoicesFromCurrentPage(message.dateFrom, message.dateTo)
        .then(result => sendResponse({ success: true, invoices: result.invoices, nextUrl: result.nextUrl }))
        .catch(err => sendResponse({ error: err.message }));
      return true;
    }

    if (message.action === 'FETCH_INVOICE') {
      plugin
        .fetchInvoice(message.url)
        .then(blob => {
          const reader = new FileReader();
          reader.onload = () =>
            sendResponse({ success: true, dataUrl: reader.result, mimeType: blob.type });
          reader.onerror = () =>
            sendResponse({ error: 'FileReader-Fehler beim Lesen des Blobs.' });
          reader.readAsDataURL(blob);
        })
        .catch(err => sendResponse({ error: err.message }));
      return true;
    }

    sendResponse({ error: `Unbekannte Aktion: ${message.action}` });
    return false;
  });
}
