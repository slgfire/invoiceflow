# InvoiceFlow for Nextcloud

> **Fork of [BMWfan/invoiceflow](https://github.com/BMWfan/invoiceflow)** with added Nextcloud WebDAV backend.

A Chrome / Edge browser extension (Manifest V3) that automatically downloads invoices from online shops and services and uploads them to either **[Paperless-ngx](https://docs.paperless-ngx.com)** (direct API) or a **Nextcloud folder via WebDAV** — switchable per a single toggle in the settings.

The Nextcloud path is designed for setups where a Nextcloud folder is also the Paperless **consume directory**: the extension drops PDFs there, Paperless picks them up automatically.

---

## Upload backends

| | Paperless-ngx | Nextcloud WebDAV |
|---|---|---|
| Auth | API token | App-password (Basic Auth) |
| Duplicate detection | Local cache + Paperless API query | Local cache only (Paperless content-hash dedup as backstop) |
| Tag assignment | Per-shop tags via API | — (use `PAPERLESS_CONSUMER_SUBDIRS_AS_TAGS` with sub-folders instead) |
| Custom fields | Per-shop custom fields via API | — |

---

## Supported Shops & Services

### Online Shops
| Shop | Domains |
|---|---|
| Amazon | amazon.de · amazon.com · amazon.co.uk · amazon.fr · amazon.it · amazon.es |
| eBay | ebay.de |
| Zalando | zalando.de |
| MediaMarkt | mediamarkt.de |
| Otto | otto.de |
| AliExpress | aliexpress.com |
| GitHub | github.com/billing |

### Services & Subscriptions
| Service | Domain |
|---|---|
| PayPal | paypal.com |
| ChatGPT | pay.openai.com |
| Google Ads | ads.google.com |
| Google Pay | payments.google.com |
| LinkedIn | linkedin.com |
| Meta Ads | business.facebook.com |
| Microsoft 365 | admin.microsoft.com |
| OpenAI API | platform.openai.com |
| Revolut Business | business.revolut.com |

> **Note on selectors:** Shop plugins scrape order history pages. Since shops update their frontends regularly, selectors may break over time. Fixes go into `src/plugins/<shop>.js`.

---

## Features

- **Automatic invoice download** — opens a background tab per shop, scrapes the order history, and fetches PDFs
- **Dual upload backend** — switch between Paperless-ngx (direct API) and Nextcloud WebDAV in the settings
- **Duplicate detection** — local cache (`chrome.storage.local`) always active; Paperless API query additionally active when Paperless backend is selected
- **Login detection** — if a shop redirects to its sign-in page, the tab is brought to the foreground and the extension waits up to 5 minutes for you to log in, then continues automatically
- **Per-shop Paperless tags** — assign different tags per shop/service (Paperless backend only)
- **Per-shop custom fields** — assign Paperless custom fields per shop (all types: text, date, integer, monetary, URL, boolean, select, document link)
- **Date range selection** — choose a year or a custom date range from the popup
- **mTLS support** — API/WebDAV calls run in an offscreen document with full fetch() support

---

## Installation

### Requirements

- Chrome 109+ or Microsoft Edge 109+
- One of:
  - A running [Paperless-ngx](https://docs.paperless-ngx.com) instance (Paperless backend)
  - A Nextcloud instance with WebDAV access (Nextcloud backend)

### 1. Get the extension

**Option A — Clone this repo:**
```bash
git clone https://github.com/slgfire/invoiceflow.git
cd invoiceflow
```

**Option B — Download ZIP:**  
`https://github.com/slgfire/invoiceflow/archive/refs/heads/main.zip` → extract the folder.

### 2. Load into Chrome / Edge

1. Open `chrome://extensions` (or `edge://extensions`)
2. Enable **Developer mode** (toggle, top right)
3. Click **Load unpacked**
4. Select the `invoiceflow` folder (the one that contains `manifest.json`)

The InvoiceFlow icon appears in the toolbar. Pin it for easy access.

### 3. Configure

Click the extension icon → **⚙ Settings**, then follow the section below for your chosen backend.

---

## Configuration

### Choose a backend

At the top of the settings page, select either **📄 Paperless-ngx** or **☁️ Nextcloud WebDAV**. Only the relevant fields are shown.

---

### Paperless-ngx backend

1. **Server URL** — e.g. `https://paperless.example.com`
2. **API Token** — Paperless → Settings → API Token → copy
3. Click **Test connection** — on success, available tags and custom fields load automatically
4. Enable the shops you use
5. Optionally assign **tags** and **custom fields** per shop
6. Click **Save settings**

---

### Nextcloud WebDAV backend

#### Prerequisites in Nextcloud

1. Create the target folder (e.g. `paperless/consume`) in Nextcloud — this must match the Paperless `PAPERLESS_CONSUMPTION_DIR` path, typically mounted as a Nextcloud external storage or shared volume.
2. Generate an **App-password**:  
   Nextcloud → top-right avatar → **Settings** → **Security** → scroll to *App passwords* → enter a name (e.g. `InvoiceFlow`) → click **Generate new app password** → copy it immediately (shown only once).

#### In the extension settings

1. **Server URL** — your Nextcloud base URL, e.g. `https://cloud.example.de`
2. **Username** — your Nextcloud username
3. **App-password** — the password generated above  
   *(stored only in `chrome.storage.local`, never synced across devices)*
4. **Target folder** — path relative to your Nextcloud root, e.g. `paperless/consume`
5. Click **Test connection** — verifies WebDAV access with a `PROPFIND` request
6. Enable the shops you use
7. Click **Save settings**

> **How it works:** The extension uploads PDFs via `PUT` to `/remote.php/dav/files/<user>/<folder>/<filename>`. Paperless monitors the consume folder and ingests each new file automatically. The folder is empty again after ingestion, so duplicate detection relies on the local order-ID cache. If the cache is cleared (new browser/profile), Paperless's built-in content-hash dedup prevents double documents.

---

## Usage

1. Open the **extension popup**
2. Select the shops you are currently logged into
3. Choose a **time range** (year dropdown or custom date range)
4. Click **Start download**

The extension opens a background tab per shop, scrapes the invoice list, checks for duplicates, and uploads new invoices to the configured backend.

### Login handling

If a shop redirects to its login page, the tab is brought to the foreground. The extension waits up to **5 minutes** for you to log in, then automatically navigates back and continues.

### Duplicate detection

**Paperless backend:**
1. Local cache (`chrome.storage.local`) — processed order IDs stored locally
2. Paperless API — `GET /api/documents/?query=<orderId>`

**Nextcloud backend:**
1. Local cache only — the consume folder is empty after Paperless ingests the file, so a WebDAV existence check would always miss

### Filename format

```
YYYYMMDD_<amount>EUR_<shop>_<orderId>.pdf
```

Example: `20240315_29,99EUR_amazon_302-1234567-8901234.pdf`  
For Nextcloud uploads, filenames are sanitized to `[A-Za-z0-9._-]` before being used in the WebDAV path.

---

## Project Structure

```
invoiceflow/
├── manifest.json          # MV3 manifest
├── popup.html             # Browser action popup
├── options.html           # Settings page
├── offscreen.html         # Offscreen document (mTLS / btoa context)
├── src/
│   ├── popup.js           # Popup logic
│   ├── options.js         # Settings logic (backend toggle + both backends)
│   ├── background.js      # Service worker (download coordination, backend routing)
│   ├── paperless.js       # Paperless-ngx API client
│   ├── nextcloud.js       # Nextcloud WebDAV client
│   ├── content.js         # Content script router
│   ├── offscreen.js       # Offscreen document handler (routes to paperless/nextcloud)
│   └── plugins/
│       ├── amazon.js
│       ├── ebay.js
│       └── ...            # one file per shop
└── icons/
```

---

## Architecture

```
popup.js ──────────────────────────────────────► background.js
  (START_DOWNLOAD + uploadBackend)              (Service Worker)
                                                      │
  ◄──── chrome.runtime.connect('progress') ──────────┤
  (live updates)                                      │
                                               opens tab per shop
                                                      │
                                             content.js + plugin.js
                                               GET_INVOICES
                                                      │
                                              per invoice:
                                               ├─ duplicate check (cache [+ Paperless API])
                                               ├─ FETCH_INVOICE → dataUrl (content script)
                                               └─ UPLOAD_DOCUMENT (offscreen)
                                                      │
                                               offscreen.js
                                               ├─ backend=paperless → paperless.js
                                               └─ backend=nextcloud → nextcloud.js
```

---

## Writing a new shop plugin

Each plugin is an IIFE that sets `window.InvoiceFlowPlugin`. Create a new file at `src/plugins/<shopname>.js`:

```javascript
window.InvoiceFlowPlugin = {
  name: 'MyShop',
  domains: ['myshop.com'],

  async getInvoices(dateFrom, dateTo) {
    return [
      {
        orderId:    'ORDER-123',
        date:       '2024-03-15T00:00:00.000Z',
        amount:     '29.99',
        invoiceUrl: 'https://myshop.com/invoices/ORDER-123.pdf',
        filename:   '20240315_29,99EUR_myshop_ORDER-123.pdf',
      }
    ];
  },

  async fetchInvoice(url) {
    const resp = await fetch(url, { credentials: 'include' });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return resp.blob();
  },
};
```

Then add to `manifest.json`:
- `host_permissions`: `"*://*.myshop.com/*"`
- `content_scripts`: new entry with `src/content.js` + your plugin file

And in `src/background.js` → `SHOP_START_URL`, add the invoice history start URL.

---

## Privacy

InvoiceFlow stores data exclusively in your browser:
- Nextcloud/Paperless URL, username, token (`chrome.storage.sync` — your browser profile)
- Nextcloud app-password (`chrome.storage.local` — this device only, not synced)
- Processed order IDs as a duplicate cache (`chrome.storage.local`)

No data is sent to any third party.

---

## Changelog

### v0.3.0 (this fork)
- **Nextcloud WebDAV backend** — upload invoices directly to a Nextcloud folder via WebDAV (PUT + Basic Auth with App-password)
- **Backend selector** — toggle between Paperless-ngx and Nextcloud in the settings; both configs are preserved when switching
- Nextcloud: recursive `MKCOL` ensures target folder exists; filename sanitizing for safe WebDAV paths
- Nextcloud app-password stored in `chrome.storage.local` (not synced across devices)

### v0.2.5
- Moved PayPal from "Online Shops" to "Services" section in popup and settings

### v0.2.4
- Fixed custom fields upload format for Paperless `post_document` API

### v0.2.3
- Full custom field type support: select, boolean, date, integer, monetary, URL, document link, string

### v0.2.2
- Per-shop custom fields

### v0.2.1
- Login detection with 5-minute wait

### v0.2.0
- 11 new shop plugins; per-shop Paperless tags

### v0.1.x
- Initial release with Amazon, eBay, Zalando, MediaMarkt, Otto; Paperless-ngx integration

---

## License

MIT
