/**
 * InvoiceFlow — Amazon Plugin
 *
 * Unterstützte Domains: amazon.de · amazon.com · amazon.co.uk · amazon.fr · amazon.it · amazon.es
 *
 * Ablauf:
 *  1. getInvoices() durchläuft die Bestellhistorie jahrweise mit Pagination.
 *  2. Für jede Bestellung im Zeitraum: direkten Rechnungslink suchen.
 *     Falls keiner vorhanden → Detailseite laden und dort suchen.
 *  3. fetchInvoice() lädt das PDF als Blob (nutzt Session-Cookies der Seite).
 *
 * Hinweis zu CSS-Selektoren:
 *  Amazon ändert sein Frontend regelmäßig. Die Selektoren sind im Mai 2025
 *  getestet. Sollten Bestellungen nicht erkannt werden, ist eine Anpassung
 *  der Selektoren in _SELECTORS nötig.
 */

window.InvoiceFlowPlugin = (() => {

  // ─── Konfiguration ─────────────────────────────────────────────────────────

  const _SELECTORS = {
    // Bestellkarten auf der Übersichtsseite
    orderCard:   '.js-order-card, [data-order-id], .order.a-box-group',
    // Bestelldatum (Text, z.B. "19. März 2024")
    orderDate:   '.order-header .a-column:first-child .a-size-base, ' +
                 '.order-header .a-column:first-child .a-color-secondary',
    // Bestellbetrag
    orderAmount: '.order-header .a-column:nth-child(2) .a-size-base, ' +
                 '.order-header .a-column:nth-child(2) .a-color-secondary',
    // Direkter Rechnungslink auf der Übersichtsseite
    invoiceLink: 'a[href*="invoice/getinvoice"], a[href*="/invoice?"], ' +
                 'a[href*="invoice/print"]',
    // Link zur Detailseite der Bestellung
    detailLink:  'a[href*="order-details"], a[href*="orderID="]',
    // Pagination "Weiter"-Link
    nextPage:    '.a-pagination .a-last:not(.a-disabled) a, ' +
                 'ul.a-pagination li.a-last:not(.a-disabled) a',
    // Login-Erkennung
    loginForm:   '#ap_email, input[name="email"][type="email"]',
  };

  // Monatsnamen je Amazon-Domain-Sprache
  const _MONTHS = {
    de: ['januar','februar','märz','april','mai','juni','juli','august','september','oktober','november','dezember'],
    en: ['january','february','march','april','may','june','july','august','september','october','november','december'],
    fr: ['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'],
    it: ['gennaio','febbraio','marzo','aprile','maggio','giugno','luglio','agosto','settembre','ottobre','novembre','dicembre'],
    es: ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'],
  };

  // ─── Private Hilfsfunktionen ───────────────────────────────────────────────

  function _lang() {
    const host = window.location.hostname;
    if (host.includes('.de'))     return 'de';
    if (host.includes('.fr'))     return 'fr';
    if (host.includes('.it'))     return 'it';
    if (host.includes('.es'))     return 'es';
    return 'en';
  }

  function _sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  /** Parsed Amazon-Datumsstrings wie "19. März 2024" oder "March 19, 2024" */
  function _parseDate(text) {
    if (!text) return null;
    const t    = text.trim().toLowerCase();
    const lang = _lang();
    const months = _MONTHS[lang] || _MONTHS.en;

    for (let m = 0; m < months.length; m++) {
      if (t.includes(months[m])) {
        const year  = (t.match(/\d{4}/) || [])[0];
        const day   = (t.match(/\d{1,2}/)  || [])[0];
        if (year && day) {
          return new Date(Number(year), m, Number(day));
        }
      }
    }
    return null;
  }

  /** Normalisiert einen Betrag-String auf "29.99" */
  function _parseAmount(text) {
    if (!text) return '0.00';
    // Entferne alles außer Ziffern, Komma und Punkt
    const cleaned = text.replace(/[^\d,\.]/g, '');
    // Deutsches Format: "1.234,56" → "1234.56"
    if (/\d\.\d{3},\d{2}/.test(cleaned)) {
      return cleaned.replace(/\./g, '').replace(',', '.');
    }
    // Komma als Dezimaltrennzeichen: "29,99"
    if (/^\d+,\d{2}$/.test(cleaned)) {
      return cleaned.replace(',', '.');
    }
    return cleaned || '0.00';
  }

  /** Formatiert ein Date-Objekt als YYYYMMDD */
  function _formatDateCompact(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}${m}${d}`;
  }

  /** Baut den Dateinamen nach Schema: YYYYMMDD_<betrag>EUR_amazon_<orderId>.pdf */
  function _buildFilename(date, amount, orderId) {
    const dateStr   = _formatDateCompact(date);
    const amountStr = parseFloat(amount).toFixed(2).replace('.', ',');
    const safeId    = orderId.replace(/[^A-Za-z0-9\-]/g, '');
    return `${dateStr}_${amountStr}EUR_amazon_${safeId}.pdf`;
  }

  /**
   * Lädt eine URL als geparste HTML-Seite (mit Session-Cookies).
   */
  async function _fetchDoc(url) {
    const resp = await fetch(url, {
      credentials: 'include',
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': navigator.language || 'de-DE',
      },
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status} für ${url}`);
    const html = await resp.text();
    return new DOMParser().parseFromString(html, 'text/html');
  }

  /**
   * Sucht in einem geparsten Dokument nach einem Rechnungslink.
   * Gibt eine absolute URL zurück oder null.
   */
  function _findInvoiceLink(doc, baseUrl) {
    const el = doc.querySelector(_SELECTORS.invoiceLink);
    if (!el) return null;
    const href = el.getAttribute('href');
    if (!href) return null;
    return href.startsWith('http') ? href : baseUrl + href;
  }

  /**
   * Lädt die Bestelldetailseite und sucht darin nach dem Rechnungslink.
   */
  async function _resolveFromDetailPage(detailUrl, baseUrl) {
    const doc  = await _fetchDoc(detailUrl);
    return _findInvoiceLink(doc, baseUrl);
  }

  /**
   * Extrahiert alle Bestellungen aus einem Übersichts-Dokument,
   * filtert nach Zeitraum und gibt eine Liste von Invoice-Objekten zurück.
   * Bestellungen, bei denen der Rechnungslink erst auf der Detailseite steht,
   * werden mit invoiceUrl = '__DETAIL__:<url>' markiert.
   */
  function _parseOrderCards(doc, dateFrom, dateTo, baseUrl) {
    const from    = new Date(dateFrom);
    const to      = new Date(dateTo);
    to.setHours(23, 59, 59, 999);

    const cards   = doc.querySelectorAll(_SELECTORS.orderCard);
    const results = [];

    for (const card of cards) {
      // ─── Order-ID ───────────────────────────────────────────────────────────
      let orderId =
        card.getAttribute('data-order-id') ||
        card.querySelector('[data-order-id]')?.getAttribute('data-order-id');

      if (!orderId) {
        const m = (card.querySelector(_SELECTORS.detailLink)?.href || '').match(/orderID=([A-Z0-9\-]+)/i);
        if (m) orderId = m[1];
      }
      if (!orderId) continue;

      // ─── Datum ──────────────────────────────────────────────────────────────
      let orderDate = null;
      for (const sel of _SELECTORS.orderDate.split(',')) {
        const el = card.querySelector(sel.trim());
        if (el) { orderDate = _parseDate(el.textContent); }
        if (orderDate) break;
      }
      // Fallback: RegEx über den gesamten Kartentext
      if (!orderDate) {
        const m = card.textContent.match(/\d{1,2}\.\s+\w+\s+\d{4}|\w+\s+\d{1,2},\s+\d{4}/);
        if (m) orderDate = _parseDate(m[0]);
      }
      if (!orderDate) continue;
      if (orderDate < from || orderDate > to) continue;

      // ─── Betrag ─────────────────────────────────────────────────────────────
      let amount = '0.00';
      for (const sel of _SELECTORS.orderAmount.split(',')) {
        const el = card.querySelector(sel.trim());
        if (el && el.textContent.match(/[\d,\.]+/)) {
          amount = _parseAmount(el.textContent);
          break;
        }
      }

      // ─── Rechnungslink ──────────────────────────────────────────────────────
      const directLink = _findInvoiceLink(card, baseUrl);
      let invoiceUrl;

      if (directLink) {
        invoiceUrl = directLink;
      } else {
        const detailEl = card.querySelector(_SELECTORS.detailLink);
        if (!detailEl) continue; // keine Detailseite → überspringen
        const href = detailEl.getAttribute('href');
        const detailUrl = href.startsWith('http') ? href : baseUrl + href;
        invoiceUrl = `__DETAIL__:${detailUrl}`;
      }

      results.push({
        orderId,
        date:       orderDate.toISOString(),
        amount,
        invoiceUrl,
        filename:   _buildFilename(orderDate, amount, orderId),
      });
    }

    return results;
  }

  // ─── Öffentliches Plugin-Interface ────────────────────────────────────────

  return {
    name:    'Amazon',
    domains: ['amazon.de','amazon.com','amazon.co.uk','amazon.fr','amazon.it','amazon.es'],

    /**
     * Gibt alle Rechnungen im Zeitraum [dateFrom, dateTo] zurück.
     * Durchläuft alle relevanten Jahre mit Pagination.
     */
    async getInvoices(dateFrom, dateTo) {
      const baseUrl   = `https://${window.location.hostname}`;
      const yearFrom  = new Date(dateFrom).getFullYear();
      const yearTo    = new Date(dateTo).getFullYear();
      const allInvoices = [];

      for (let year = yearTo; year >= yearFrom; year--) {
        let startIndex = 0;
        let hasMore    = true;

        while (hasMore) {
          const orderHistoryUrl =
            `${baseUrl}/gp/your-account/order-history` +
            `?orderFilter=year-${year}&startIndex=${startIndex}`;

          const doc = await _fetchDoc(orderHistoryUrl);

          // Nicht eingeloggt?
          if (doc.querySelector(_SELECTORS.loginForm)) {
            throw new Error(
              'Nicht bei Amazon angemeldet. Bitte zuerst auf amazon.de einloggen.'
            );
          }

          const pageInvoices = _parseOrderCards(doc, dateFrom, dateTo, baseUrl);

          // Detailseiten für Bestellungen ohne direkten Rechnungslink
          for (const inv of pageInvoices) {
            if (inv.invoiceUrl.startsWith('__DETAIL__:')) {
              const detailUrl = inv.invoiceUrl.slice('__DETAIL__:'.length);
              await _sleep(300 + Math.random() * 400);
              const resolved = await _resolveFromDetailPage(detailUrl, baseUrl).catch(() => null);
              if (resolved) {
                inv.invoiceUrl = resolved;
                allInvoices.push(inv);
              }
            } else {
              allInvoices.push(inv);
            }
          }

          // Gibt es eine nächste Seite?
          const nextLink = doc.querySelector(_SELECTORS.nextPage);
          if (nextLink) {
            startIndex += 10;
            await _sleep(300 + Math.random() * 500);
          } else {
            hasMore = false;
          }

          // Leere Seite → Jahr-Schleife beenden
          if (pageInvoices.length === 0 && startIndex > 0) hasMore = false;
        }
      }

      return allInvoices;
    },

    /**
     * Lädt eine einzelne Rechnung als Blob (PDF).
     * Nutzt die Sitzungs-Cookies der Seite für die Authentifizierung.
     */
    async fetchInvoice(url) {
      const resp = await fetch(url, {
        credentials: 'include',
        headers: { Accept: 'application/pdf, */*' },
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status} beim Herunterladen der Rechnung.`);

      const blob = await resp.blob();
      if (blob.size < 100) throw new Error('Antwort zu klein — kein PDF erhalten.');
      return blob;
    },
  };

})();
