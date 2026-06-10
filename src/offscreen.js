/**
 * InvoiceFlow — Offscreen Document
 *
 * Läuft im normalen Browser-Rendering-Kontext, nicht im Service Worker.
 * Dadurch unterstützt fetch() hier Client-Zertifikate für mTLS — und
 * btoa() ist ohne Weiteres verfügbar.
 *
 * Der Service Worker (background.js) sendet alle API-/WebDAV-Aufrufe
 * als Nachrichten hierher und bekommt die Ergebnisse zurück.
 * Das Feld `msg.backend` ('paperless' | 'nextcloud') bestimmt den Pfad.
 */

import { PaperlessClient }  from './paperless.js';
import { NextcloudClient }  from './nextcloud.js';

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.target !== 'offscreen') return false;

  handle(msg)
    .then(result => sendResponse({ success: true, result }))
    .catch(err  => sendResponse({ error: err.message }));

  return true; // async response
});

async function handle(msg) {
  if (msg.backend === 'paperless') {
    const client = new PaperlessClient(msg.paperlessUrl, msg.paperlessToken);

    switch (msg.action) {

      case 'TEST_CONNECTION':
        return client.testConnection();

      case 'CHECK_DUPLICATE':
        return client.checkDuplicate(msg.orderId);

      case 'GET_TAGS':
        return client.getTags();

      case 'GET_CUSTOM_FIELDS':
        return client.getCustomFields();

      case 'UPLOAD_DOCUMENT': {
        const resp = await fetch(msg.dataUrl);
        const blob = await resp.blob();
        return client.uploadDocument(blob, msg.filename, msg.tagIds ?? [], msg.customFields ?? []);
      }

      default:
        throw new Error(`Unbekannte Paperless-Aktion: ${msg.action}`);
    }
  }

  // Nextcloud WebDAV
  const client = new NextcloudClient(msg.ncUrl, msg.ncUser, msg.ncPassword, msg.ncFolder);

  switch (msg.action) {

    case 'TEST_CONNECTION':
      return client.testConnection();

    case 'UPLOAD_DOCUMENT': {
      const resp = await fetch(msg.dataUrl);
      const blob = await resp.blob();
      return client.uploadDocument(blob, msg.filename);
    }

    default:
      throw new Error(`Unbekannte Nextcloud-Aktion: ${msg.action}`);
  }
}
