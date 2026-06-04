export class PaperlessClient {
  constructor(baseUrl, token) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.token = token;
  }

  get _headers() {
    return { Authorization: `Token ${this.token}`, Accept: 'application/json' };
  }

  async _get(path) {
    const res = await fetch(`${this.baseUrl}${path}`, { headers: this._headers, credentials: 'include' });
    if (!res.ok) throw new Error(`Paperless HTTP ${res.status}: ${path}`);
    return res.json();
  }

  /** Prüft ob die API erreichbar und der Token gültig ist. */
  async testConnection() {
    const data = await this._get('/api/documents/?page_size=1');
    if (typeof data.count !== 'number') throw new Error('Unerwartete API-Antwort — kein Paperless-ngx?');
    return true;
  }

  /**
   * Prüft, ob ein Dokument mit der orderId bereits existiert.
   * Zuerst lokaler Cache (chrome.storage.local), dann Paperless API.
   */
  async checkDuplicate(orderId) {
    const url = `/api/documents/?query=${encodeURIComponent(orderId)}&page_size=1`;
    const data = await this._get(url);
    return data.count > 0;
  }

  /**
   * Lädt ein PDF als Multipart-POST hoch.
   * @param {Blob}     blob
   * @param {string}   filename   z.B. "20240315_29,99EUR_amazon_302-xxx.pdf"
   * @param {number[]} tagIds
   */
  async uploadDocument(blob, filename, tagIds = []) {
    const form = new FormData();
    form.append('document', blob, filename);
    form.append('title', filename.replace(/\.pdf$/i, ''));
    tagIds.forEach(id => form.append('tags', String(id)));

    const res = await fetch(`${this.baseUrl}/api/documents/post_document/`, {
      method: 'POST',
      headers: this._headers, // no Content-Type — browser sets multipart boundary
      credentials: 'include',
      body: form,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Upload fehlgeschlagen (${res.status}): ${text.slice(0, 200)}`);
    }

    return res.json().catch(() => ({}));
  }

  /** Gibt alle konfigurierten Tags zurück. */
  async getTags() {
    const data = await this._get('/api/tags/?page_size=500');
    return data.results ?? [];
  }
}
