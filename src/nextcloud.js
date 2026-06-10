export class NextcloudClient {
  /**
   * @param {string} baseUrl      Nextcloud-Basis-URL, z.B. "https://cloud.example.de"
   * @param {string} user         Nextcloud-Benutzername
   * @param {string} appPassword  App-Passwort (nicht das Haupt-Passwort)
   * @param {string} folder       Zielordner, relativ zum WebDAV-Root des Benutzers,
   *                              z.B. "paperless/consume" oder "Rechnungen"
   */
  constructor(baseUrl, user, appPassword, folder) {
    this.baseUrl     = baseUrl.replace(/\/+$/, '');
    this.user        = user;
    this.folder      = folder.replace(/^\/+/, '').replace(/\/+$/, '');
    // btoa ist in Offscreen-Dokumenten (Rendering-Kontext) und Service Workern verfügbar
    this._auth       = 'Basic ' + btoa(`${user}:${appPassword}`);
  }

  get _headers() {
    return { Authorization: this._auth };
  }

  /** WebDAV-Root für diesen Benutzer */
  get _davRoot() {
    return `${this.baseUrl}/remote.php/dav/files/${encodeURIComponent(this.user)}`;
  }

  /** Baut eine vollständige WebDAV-URL aus einem relativen Pfad (Segmente einzeln encoden). */
  _buildUrl(relativePath) {
    const parts = relativePath.split('/').filter(Boolean);
    return `${this._davRoot}/${parts.map(encodeURIComponent).join('/')}`;
  }

  /**
   * Bereinigt einen Dateinamen für WebDAV:
   * Nur [A-Za-z0-9._-] erlaubt, alles andere → "_".
   * Führende Punkte werden ebenfalls ersetzt.
   */
  static sanitizeFilename(name) {
    return name
      .replace(/[^A-Za-z0-9._\-]/g, '_')
      .replace(/^\.+/, '_');
  }

  /**
   * Testet die Verbindung via PROPFIND (Tiefe 0) auf den Zielordner.
   * Wirft bei Auth-Fehler, fehlendem Ordner oder sonstigen HTTP-Fehlern.
   */
  async testConnection() {
    const url = this._buildUrl(this.folder);
    const res = await fetch(url, {
      method:  'PROPFIND',
      headers: { ...this._headers, Depth: '0' },
    });

    if (res.status === 401) throw new Error('Authentifizierung fehlgeschlagen — Benutzername oder App-Passwort falsch.');
    if (res.status === 403) throw new Error('Zugriff verweigert — keine Berechtigung für diesen Ordner.');
    if (res.status === 404) throw new Error(`Ordner nicht gefunden: ${this.folder} — Pfad prüfen oder Ordner in Nextcloud anlegen.`);
    if (res.status !== 207 && !res.ok) throw new Error(`Nextcloud antwortet mit HTTP ${res.status}`);

    return true;
  }

  /**
   * Legt den Zielordner (und alle übergeordneten Segmente) an.
   * MKCOL ist nicht rekursiv → jedes Level einzeln anlegen.
   * 405 (bereits vorhanden) wird ignoriert.
   */
  async ensureFolder() {
    const parts = this.folder.split('/').filter(Boolean);
    for (let i = 1; i <= parts.length; i++) {
      const partial = parts.slice(0, i).join('/');
      const url     = this._buildUrl(partial);
      const res     = await fetch(url, { method: 'MKCOL', headers: this._headers });

      // 201 = angelegt, 405 = existiert bereits — beide OK
      if (res.status === 201 || res.status === 405) continue;

      if (res.status === 401) throw new Error('Authentifizierung fehlgeschlagen beim Ordner anlegen.');
      if (res.status === 403) throw new Error(`Keine Berechtigung, Ordner anzulegen: ${partial}`);
      throw new Error(`MKCOL für "${partial}" fehlgeschlagen (HTTP ${res.status})`);
    }
  }

  /**
   * Lädt ein PDF via WebDAV PUT hoch.
   * Legt den Zielordner bei Bedarf automatisch an.
   *
   * @param {Blob}   blob      PDF-Inhalt
   * @param {string} filename  Dateiname (wird intern sanitized + URL-encodiert)
   */
  async uploadDocument(blob, filename) {
    const safeName = NextcloudClient.sanitizeFilename(filename);
    const parts    = this.folder.split('/').filter(Boolean);
    const url      = `${this._davRoot}/${[...parts, encodeURIComponent(safeName)].join('/')}`;

    let res = await fetch(url, {
      method:  'PUT',
      headers: { ...this._headers, 'Content-Type': 'application/pdf' },
      body:    blob,
    });

    // 409/404: Ordner fehlt → anlegen und nochmal versuchen
    if (res.status === 404 || res.status === 409) {
      await this.ensureFolder();
      res = await fetch(url, {
        method:  'PUT',
        headers: { ...this._headers, 'Content-Type': 'application/pdf' },
        body:    blob,
      });
    }

    if (res.status === 401) throw new Error('Authentifizierung fehlgeschlagen beim Upload.');
    if (res.status === 403) throw new Error('Keine Schreibberechtigung für den Zielordner.');

    // 201 (neu angelegt) und 204 (überschrieben) sind beide Erfolg
    if (res.status !== 201 && res.status !== 204) {
      const text = await res.text().catch(() => '');
      throw new Error(`Upload fehlgeschlagen (HTTP ${res.status}): ${text.slice(0, 200)}`);
    }

    return safeName;
  }
}
