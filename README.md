# InvoiceFlow

Eine Browser-Extension (Chrome / Edge, Manifest V3), die Rechnungen von Online-Shops automatisch herunterlädt und direkt in [Paperless-ngx](https://docs.paperless-ngx.com) hochlädt — mit Duplikatserkennung über die Paperless API und einen lokalen Cache.

---

## Unterstützte Shops (Phase 1)

| Shop | Domains |
|---|---|
| Amazon | amazon.de · amazon.com · amazon.co.uk · amazon.fr · amazon.it · amazon.es |
| eBay | ebay.de |
| Zalando | zalando.de |
| MediaMarkt | mediamarkt.de |
| Otto | otto.de |

> **Hinweis zu CSS-Selektoren:** Die Shop-Plugins scrapen die jeweiligen Bestellseiten. Da Shops ihr Frontend regelmäßig ändern, können Selektoren veralten. Anpassungen erfolgen in `src/plugins/<shop>.js`.

---

## Projektstruktur

```
invoiceflow/
├── manifest.json          # MV3-Manifest
├── popup.html             # Browser-Action Popup
├── options.html           # Einstellungsseite
├── src/
│   ├── popup.js           # Popup-Logik
│   ├── options.js         # Optionen-Logik
│   ├── background.js      # Service Worker (Download-Koordination)
│   ├── paperless.js       # Paperless-ngx API-Client
│   ├── content.js         # Content-Script-Router
│   └── plugins/
│       ├── amazon.js      # Amazon-Plugin (vollständig)
│       ├── ebay.js        # eBay-Plugin (Grundgerüst)
│       ├── zalando.js     # Zalando-Plugin (Grundgerüst)
│       ├── mediamarkt.js  # MediaMarkt-Plugin (Grundgerüst)
│       └── otto.js        # Otto-Plugin (Grundgerüst)
├── icons/
│   ├── icon.svg           # Quell-Icon
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── scripts/
    └── generate-icons.py  # Icon-Generator (cairosvg / Inkscape / rsvg)
```

---

## Installation

### Voraussetzungen

- Chrome 109+ oder Microsoft Edge 109+
- Ein laufendes [Paperless-ngx](https://docs.paperless-ngx.com)-System
- Python 3 + `cairosvg` (nur für Icon-Generierung nötig, PNGs sind bereits enthalten)

### 1. Repository klonen

```bash
git clone https://github.com/BMWfan/invoiceflow.git
cd invoiceflow
```

### 2. Icons generieren (optional, PNGs bereits vorhanden)

```bash
pip install cairosvg
python3 scripts/generate-icons.py
```

### 3. Extension in Chrome/Edge laden

1. `chrome://extensions` (oder `edge://extensions`) öffnen
2. **Entwicklermodus** oben rechts aktivieren
3. **Entpackte Erweiterung laden** klicken
4. Den `invoiceflow`-Ordner auswählen

Die Extension erscheint jetzt in der Toolbar.

---

## Paperless-ngx einrichten

### API-Token erstellen

1. Paperless-ngx öffnen → **Einstellungen** → **API-Token**
2. Token kopieren

### Extension konfigurieren

1. Extension-Icon klicken → **⚙ Einstellungen**
2. **Server-URL** eingeben, z. B. `https://paperless.mein-server.de`
3. **API-Token** einfügen
4. **Verbindung testen** — bei Erfolg werden verfügbare Tags geladen
5. Gewünschte Tags für automatische Zuordnung auswählen
6. **Einstellungen speichern**

---

## Benutzung

1. **Extension-Popup** öffnen
2. Shops auswählen, bei denen du eingeloggt bist
3. **Zeitraum** wählen (Jahr-Dropdown oder individueller Datumsbereich)
4. **Download starten** klicken

Die Extension öffnet im Hintergrund einen Tab pro Shop, lädt die Bestellhistorie, prüft Duplikate und lädt neue Rechnungen in Paperless hoch.

### Duplikaterkennung

Für jede Rechnung wird in zwei Stufen geprüft:

1. **Lokaler Cache** (`chrome.storage.local`) — bereits verarbeitete Order-IDs werden gespeichert
2. **Paperless API** — `GET /api/documents/?query=<orderId>`

Nur Rechnungen, die in keinem der beiden Stores gefunden wurden, werden hochgeladen.

### Dateiname-Schema

```
YYYYMMDD_<betrag>EUR_<shop>_<orderId>.pdf
```

Beispiel: `20240315_29,99EUR_amazon_302-1234567-8901234.pdf`

---

## Neues Shop-Plugin schreiben

Jedes Plugin ist eine IIFE die `window.InvoiceFlowPlugin` setzt. Neue Datei anlegen unter `src/plugins/<shopname>.js`:

```javascript
window.InvoiceFlowPlugin = {
  name: 'MeinShop',
  domains: ['meinshop.de'],

  /**
   * Gibt alle Rechnungen im Zeitraum zurück.
   * @param {string} dateFrom  ISO-Datum, z.B. "2024-01-01"
   * @param {string} dateTo    ISO-Datum, z.B. "2024-12-31"
   * @returns {Promise<Array<{
   *   orderId: string,
   *   date: string,       // ISO
   *   amount: string,     // "29.99"
   *   invoiceUrl: string,
   *   filename: string    // YYYYMMDD_<betrag>EUR_<shop>_<id>.pdf
   * }>>}
   */
  async getInvoices(dateFrom, dateTo) {
    // TODO: Bestellhistorie parsen
    return [];
  },

  /**
   * Lädt eine einzelne Rechnung als Blob.
   * Fetch läuft im Content-Script-Kontext → Session-Cookies verfügbar.
   * @param {string} url
   * @returns {Promise<Blob>}
   */
  async fetchInvoice(url) {
    const resp = await fetch(url, { credentials: 'include' });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return resp.blob();
  },
};
```

Dann in `manifest.json` unter `content_scripts` einen neuen Eintrag hinzufügen:

```json
{
  "matches": ["*://*.meinshop.de/*"],
  "js": ["src/content.js", "src/plugins/meinshop.js"],
  "run_at": "document_idle"
}
```

Außerdem in `manifest.json` → `host_permissions` die Domain ergänzen und in `background.js` → `SHOP_START_URL` die Start-URL der Bestellhistorie hinzufügen.

---

## Architektur

```
popup.js ──────────────────────────────────────────────────► background.js
  (START_DOWNLOAD)                                          (Service Worker)
                                                                │
  ◄──────────────── chrome.runtime.connect('progress') ────────┤
  (Live-Updates)                                                │
                                                         öffnet Tab
                                                                │
                                                        content.js + plugin.js
                                                         (GET_INVOICES)
                                                                │
                                                     ◄──────────┘ invoices[]
                                                                │
                                                     für jede Rechnung:
                                                      - Duplikat-Check (cache + Paperless)
                                                      - FETCH_INVOICE → blob
                                                      - paperless.uploadDocument()
```

---

## Roadmap (Phase 2)

- [ ] **Headless-Modus** — Puppeteer/CDP-Support für automatischen Cronjob-Betrieb ohne Browser-UI
- [ ] **Consume-Ordner** — PDFs alternativ direkt in den Paperless-Consume-Ordner ablegen (WebDAV / SMB)
- [ ] **Weitere Shops** — Lidl, Tchibo, Douglas, Apple, Google Play, Steam
- [ ] **Zusammenfassungs-E-Mail** — optionale E-Mail nach jedem Lauf
- [ ] **Konfigurierbares Dateiname-Schema**
- [ ] **Rate-Limit-Erkennung** — automatisch pausieren bei 429/503

---

## Branch-Strategie & CI/CD

### Branching-Modell

```
feature/add-lidl-plugin  ──┐
feature/better-pagination  ├──► release/1.1.0 ──► main  ──► v1.1.0 Release
fix/amazon-selector-2025  ──┘
```

| Branch | Zweck | Darf mergen nach |
|---|---|---|
| `feature/<name>` | Neues Feature | `release/x.y.z` |
| `fix/<name>` | Bugfix | `release/x.y.z` |
| `release/x.y.z` | Sammelt alle Änderungen eines Releases | `main` |
| `main` | Immer produktionsreif, entspricht letztem Release | — |

**Direkte Pushes / PRs nach `main` sind verboten** — nur `release/*`-Branches
dürfen dort hineingehen. Der CI-Check `enforce-branch-policy` erzwingt das.

### GitHub Branch-Protection einrichten

Nach dem ersten Push einmalig im GitHub-Repo unter
**Settings → Branches → Add branch ruleset** konfigurieren:

#### Regel für `main`

| Einstellung | Wert |
|---|---|
| Applies to | `main` |
| Require a pull request before merging | ✅ |
| Require status checks to pass | ✅ `validate`, `enforce-branch-policy` |
| Require branches to be up to date | ✅ |
| Block direct pushes | ✅ |
| Restrict who can push | nur Admins / Release-Manager |

#### Regel für `release/**`

| Einstellung | Wert |
|---|---|
| Applies to | `release/**` |
| Require a pull request before merging | ✅ |
| Require status checks to pass | ✅ `validate`, `build` |
| Block direct pushes | ✅ |

### CI/CD-Pipelines

#### `ci.yml` — läuft auf allen Feature-, Fix- und Release-Branches

| Job | Was passiert |
|---|---|
| `validate` | JSON-Validierung `manifest.json`, `node --check` für alle JS-Dateien, Vollständigkeitsprüfung |
| `enforce-branch-policy` | Schlägt fehl wenn ein PR direkt nach `main` geht (außer von `release/*`) |
| `enforce-branch-policy` | Prüft dass `manifest.json`-Version mit dem Branch-Namen (`release/x.y.z`) übereinstimmt |
| `build` | Baut die fertige ZIP und lädt sie als CI-Artefakt hoch (7 Tage Aufbewahrung) |

#### `release.yml` — läuft beim Merge in `main`

1. Liest Version aus `manifest.json`
2. Prüft, dass das Tag noch nicht existiert
3. Wiederholt alle Validierungen
4. Baut `invoiceflow-vX.Y.Z.zip` (nur Extension-Dateien, keine Dev-Dateien)
5. Erstellt Git-Tag `vX.Y.Z` und GitHub Release mit automatischen Release Notes
6. Hängt ZIP als Release-Asset an

### Typischer Workflow

```bash
# 1. Neues Feature beginnen
git checkout -b feature/add-lidl-plugin

# ... Änderungen machen ...
git commit -m "feat: add Lidl.de plugin skeleton"
git push origin feature/add-lidl-plugin
# → PR öffnen: feature/add-lidl-plugin → release/1.1.0

# 2. Release vorbereiten (auf release/1.1.0)
# manifest.json version auf "1.1.0" setzen
git commit -m "chore: bump version to 1.1.0"
git push origin release/1.1.0
# → PR öffnen: release/1.1.0 → main
# CI prüft automatisch: Version stimmt, Branch-Policy ok

# 3. Nach Merge in main:
# GitHub Actions erstellt automatisch Tag v1.1.0 + Release mit ZIP
```

---

## Datenschutz

InvoiceFlow speichert ausschließlich lokal:
- Paperless-URL und API-Token (`chrome.storage.sync` — nur dein Browser-Profil)
- Bereits verarbeitete Order-IDs als Cache (`chrome.storage.local`)

Es werden keine Daten an Dritte übertragen.

---

## Lizenz

MIT
