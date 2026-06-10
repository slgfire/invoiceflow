/**
 * InvoiceFlow — Offscreen Document
 *
 * Läuft im normalen Browser-Rendering-Kontext, nicht im Service Worker.
 * Dadurch unterstützt fetch() hier Client-Zertifikate für mTLS — und
 * btoa() ist ohne Weiteres verfügbar.
 *
 * Der Service Worker (background.js) sendet alle Nextcloud-WebDAV-Aufrufe
 * als Nachrichten hierher und bekommt die Ergebnisse zurück.
 */

import { NextcloudClient } from './nextcloud.js';

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.target !== 'offscreen') return false;

  handle(msg)
    .then(result => sendResponse({ success: true, result }))
    .catch(err  => sendResponse({ error: err.message }));

  return true; // async response
});

async function handle(msg) {
  const client = new NextcloudClient(msg.ncUrl, msg.ncUser, msg.ncPassword, msg.ncFolder);

  switch (msg.action) {

    case 'TEST_CONNECTION':
      return client.testConnection();

    case 'UPLOAD_DOCUMENT': {
      // dataUrl kommt als base64-Data-URL vom Content Script via background
      const resp = await fetch(msg.dataUrl);
      const blob = await resp.blob();
      return client.uploadDocument(blob, msg.filename);
    }

    default:
      throw new Error(`Unbekannte Offscreen-Aktion: ${msg.action}`);
  }
}
