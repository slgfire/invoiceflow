// ─── DOM refs ─────────────────────────────────────────────────────────────────

const $ = id => document.getElementById(id);

const elUrl     = $('paperlessUrl');
const elToken   = $('paperlessToken');
const elBtnTest = $('btnTest');
const elStatus  = $('connectionStatus');
const elBtnSave = $('btnSave');
const elSaveMsg = $('saveMsg');
const elCustom  = $('customRangeFields');
const elFrom    = $('customFrom');
const elTo      = $('customTo');
const elTags    = $('tagsContainer');

const SHOP_IDS = ['amazon', 'ebay', 'zalando', 'mediamarkt', 'otto'];

// ─── Init ─────────────────────────────────────────────────────────────────────

async function load() {
  const s = await chrome.storage.sync.get([
    'paperlessUrl', 'paperlessToken',
    'defaultDateRange', 'customFrom', 'customTo',
    'enabledShops', 'tagIds',
  ]);

  elUrl.value   = s.paperlessUrl   || '';
  elToken.value = s.paperlessToken || '';

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

  if (s.paperlessUrl && s.paperlessToken) {
    await loadTags(s.paperlessUrl, s.paperlessToken, s.tagIds || []);
  }
}

// ─── Date-range toggle ────────────────────────────────────────────────────────

function toggleCustomRange(value) {
  elCustom.classList.toggle('visible', value === 'custom');
}

document.querySelectorAll('input[name="dateRange"]').forEach(el => {
  el.addEventListener('change', e => toggleCustomRange(e.target.value));
});

// ─── Tags ─────────────────────────────────────────────────────────────────────

async function loadTags(baseUrl, token, selectedIds) {
  elTags.innerHTML = '<span style="font-size:12px;color:#94a3b8;">Lade Tags…</span>';

  try {
    const url    = baseUrl.replace(/\/+$/, '') + '/api/tags/?page_size=500';
    const res    = await fetch(url, { headers: { Authorization: `Token ${token}` } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data   = await res.json();
    const tags   = data.results || [];

    if (tags.length === 0) {
      elTags.innerHTML = '<span style="font-size:12px;color:#94a3b8;">Keine Tags vorhanden.</span>';
      return;
    }

    elTags.innerHTML = '';
    for (const tag of tags) {
      const chip = document.createElement('label');
      chip.className = 'tag-chip' + (selectedIds.includes(tag.id) ? ' selected' : '');
      chip.innerHTML = `
        <input type="checkbox" value="${tag.id}" ${selectedIds.includes(tag.id) ? 'checked' : ''}>
        ${tag.name}
      `;
      chip.addEventListener('change', e => {
        chip.classList.toggle('selected', e.target.checked);
      });
      elTags.appendChild(chip);
    }
  } catch (e) {
    elTags.innerHTML = `<span style="font-size:12px;color:#dc2626;">Tags konnten nicht geladen werden: ${e.message}</span>`;
  }
}

// ─── Connection test ──────────────────────────────────────────────────────────

// Verbindungstest läuft im Options-Page-Kontext (kein Service Worker) →
// mTLS-Client-Zertifikate aus dem Browser-Store werden automatisch verwendet.
elBtnTest.addEventListener('click', async () => {
  const url   = elUrl.value.trim();
  const token = elToken.value.trim();

  if (!url || !token) {
    showStatus('error', 'URL und Token eingeben.');
    return;
  }

  showStatus('testing', 'Teste Verbindung…');
  elBtnTest.disabled = true;

  try {
    const res = await fetch(url.replace(/\/+$/, '') + '/api/', {
      headers: { Authorization: `Token ${token}` },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!data.documents) throw new Error('Keine gültige Paperless-API-Antwort.');
    showStatus('ok', 'Verbindung OK');
    await loadTags(url, token, getSelectedTagIds());
  } catch (e) {
    showStatus('error', e.message);
  } finally {
    elBtnTest.disabled = false;
  }
});

function showStatus(type, text) {
  elStatus.style.display = 'inline-flex';
  elStatus.className = `connection-status status-${type}`;
  elStatus.textContent = text;
}

// ─── Save ─────────────────────────────────────────────────────────────────────

elBtnSave.addEventListener('click', async () => {
  const url   = elUrl.value.trim();
  const token = elToken.value.trim();

  if (!url || !token) {
    showSaveMsg('error', 'Bitte URL und Token angeben.');
    return;
  }

  const range       = document.querySelector('input[name="dateRange"]:checked')?.value || 'currentYear';
  const enabledShops = {};
  for (const id of SHOP_IDS) {
    const el = document.getElementById(`shop${id.charAt(0).toUpperCase() + id.slice(1)}`);
    enabledShops[id] = el ? el.checked : false;
  }

  await chrome.storage.sync.set({
    paperlessUrl:     url,
    paperlessToken:   token,
    defaultDateRange: range,
    customFrom:       elFrom.value,
    customTo:         elTo.value,
    enabledShops,
    tagIds:           getSelectedTagIds(),
  });

  showSaveMsg('ok', 'Gespeichert.');
  setTimeout(() => { elSaveMsg.textContent = ''; }, 3000);
});

function getSelectedTagIds() {
  return Array.from(elTags.querySelectorAll('input[type="checkbox"]:checked'))
    .map(el => Number(el.value));
}

function showSaveMsg(type, text) {
  elSaveMsg.className = `save-msg ${type}`;
  elSaveMsg.textContent = text;
}

// ─── Bootstrap ────────────────────────────────────────────────────────────────

load();
