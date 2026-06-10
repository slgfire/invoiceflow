// ─── DOM refs ─────────────────────────────────────────────────────────────────

const $ = id => document.getElementById(id);

const elUrl      = $('ncUrl');
const elUser     = $('ncUser');
const elPassword = $('ncPassword');
const elFolder   = $('ncFolder');
const elBtnTest  = $('btnTest');
const elStatus   = $('connectionStatus');
const elBtnSave  = $('btnSave');
const elSaveMsg  = $('saveMsg');
const elCustom   = $('customRangeFields');
const elFrom     = $('customFrom');
const elTo       = $('customTo');

const SHOP_IDS = [
  'amazon', 'ebay', 'zalando', 'mediamarkt', 'otto',
  'aliexpress', 'chatgpt', 'github', 'googleads', 'googlepay',
  'linkedin', 'metaads', 'microsoft365', 'openaiapi', 'paypal', 'revolut',
];

// ─── Init ─────────────────────────────────────────────────────────────────────

async function load() {
  // ncPassword kommt aus local (nicht sync) — wird nicht über Google-Konto synchronisiert
  const [s, local] = await Promise.all([
    chrome.storage.sync.get([
      'ncUrl', 'ncUser', 'ncFolder',
      'defaultDateRange', 'customFrom', 'customTo',
      'enabledShops',
    ]),
    chrome.storage.local.get(['ncPassword']),
  ]);

  elUrl.value      = s.ncUrl     || '';
  elUser.value     = s.ncUser    || '';
  elPassword.value = local.ncPassword || '';
  elFolder.value   = s.ncFolder  || '';

  const range = s.defaultDateRange || 'currentYear';
  const radio = document.querySelector(`input[name="dateRange"][value="${range}"]`);
  if (radio) radio.checked = true;
  toggleCustomRange(range);

  elFrom.value = s.customFrom || '';
  elTo.value   = s.customTo   || '';

  const enabled = s.enabledShops || { amazon: true, ebay: true };
  for (const id of SHOP_IDS) {
    const el = document.getElementById(`shop${id.charAt(0).toUpperCase() + id.slice(1)}`);
    if (el) el.checked = Boolean(enabled[id] ?? false);
  }
}

// ─── Date-range toggle ────────────────────────────────────────────────────────

function toggleCustomRange(value) {
  elCustom.classList.toggle('visible', value === 'custom');
}

document.querySelectorAll('input[name="dateRange"]').forEach(el => {
  el.addEventListener('change', e => toggleCustomRange(e.target.value));
});

// ─── Host-Permission für Nextcloud-URL anfordern ─────────────────────────────
// Ohne diese Erlaubnis blockiert der Browser CORS-Anfragen von der Extension
// an die Nextcloud-URL (chrome-extension:// Origin ist nicht erlaubt).
// chrome.permissions.request() muss durch eine User-Geste ausgelöst werden.

async function requestHostPermission(url) {
  try {
    const origin  = new URL(url).origin + '/*';
    const granted = await chrome.permissions.request({ origins: [origin] });
    return granted;
  } catch {
    return false;
  }
}

async function hasHostPermission(url) {
  try {
    const origin = new URL(url).origin + '/*';
    return chrome.permissions.contains({ origins: [origin] });
  } catch {
    return false;
  }
}

// ─── Verbindungstest ──────────────────────────────────────────────────────────

elBtnTest.addEventListener('click', async () => {
  const url      = elUrl.value.trim();
  const user     = elUser.value.trim();
  const password = elPassword.value.trim();
  const folder   = elFolder.value.trim();

  if (!url || !user || !password) {
    showStatus('error', 'URL, Benutzername und App-Passwort eingeben.');
    return;
  }

  // Host-Permission sicherstellen (einmaliger Browser-Dialog)
  const already = await hasHostPermission(url);
  if (!already) {
    showStatus('testing', 'Bitte Zugriff auf Nextcloud-URL erlauben…');
    const granted = await requestHostPermission(url);
    if (!granted) {
      showStatus('error', 'Zugriff verweigert — CORS-Anfragen werden blockiert.');
      return;
    }
  }

  showStatus('testing', 'Teste Verbindung…');
  elBtnTest.disabled = true;

  try {
    const davRoot  = url.replace(/\/+$/, '') + '/remote.php/dav/files/' + encodeURIComponent(user);
    const testPath = folder
      ? folder.split('/').filter(Boolean).map(encodeURIComponent).join('/')
      : '';
    const testUrl  = testPath ? `${davRoot}/${testPath}` : davRoot;

    const res = await fetch(testUrl, {
      method:  'PROPFIND',
      headers: {
        Authorization: 'Basic ' + btoa(`${user}:${password}`),
        Depth:         '0',
      },
    });

    if (res.status === 401) throw new Error('Authentifizierung fehlgeschlagen — Benutzername oder App-Passwort falsch.');
    if (res.status === 403) throw new Error('Zugriff verweigert — keine Berechtigung.');
    if (res.status === 404) {
      showStatus('error', `Ordner nicht gefunden: "${folder || '/'}" — Pfad prüfen.`);
      return;
    }
    if (res.status !== 207 && !res.ok) throw new Error(`Nextcloud antwortet mit HTTP ${res.status}`);

    showStatus('ok', 'Verbindung OK');
  } catch (e) {
    showStatus('error', e.message);
  } finally {
    elBtnTest.disabled = false;
  }
});

function showStatus(type, text) {
  elStatus.style.display = 'inline-flex';
  elStatus.className     = `connection-status status-${type}`;
  elStatus.textContent   = text;
}

// ─── Speichern ────────────────────────────────────────────────────────────────

elBtnSave.addEventListener('click', async () => {
  const url      = elUrl.value.trim();
  const user     = elUser.value.trim();
  const password = elPassword.value.trim();
  const folder   = elFolder.value.trim();

  if (!url || !user || !password) {
    showSaveMsg('error', 'Bitte URL, Benutzername und App-Passwort angeben.');
    return;
  }

  // Host-Permission für die Nextcloud-URL sicherstellen
  const already = await hasHostPermission(url);
  if (!already) {
    const granted = await requestHostPermission(url);
    if (!granted) {
      showSaveMsg('error', 'Zugriff auf Nextcloud-URL nicht erteilt — Verbindung wird fehlschlagen.');
      return;
    }
  }

  const range = document.querySelector('input[name="dateRange"]:checked')?.value || 'currentYear';
  const enabledShops = {};
  for (const id of SHOP_IDS) {
    const el = document.getElementById(`shop${id.charAt(0).toUpperCase() + id.slice(1)}`);
    enabledShops[id] = el ? el.checked : false;
  }

  // Passwort geht in local (nicht sync) — kein Sync über Google-Konto
  await Promise.all([
    chrome.storage.sync.set({
      ncUrl:            url,
      ncUser:           user,
      ncFolder:         folder,
      defaultDateRange: range,
      customFrom:       elFrom.value,
      customTo:         elTo.value,
      enabledShops,
    }),
    chrome.storage.local.set({ ncPassword: password }),
  ]);

  showSaveMsg('ok', 'Gespeichert.');
  setTimeout(() => { elSaveMsg.textContent = ''; }, 3000);
});

function showSaveMsg(type, text) {
  elSaveMsg.className   = `save-msg ${type}`;
  elSaveMsg.textContent = text;
}

// ─── Bootstrap ────────────────────────────────────────────────────────────────

load();
