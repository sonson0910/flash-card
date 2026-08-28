'use strict';

const {
  DEFAULT_SETTINGS,
  extensionApi,
  apiCall,
  selectionIconSitePatternFromUrl,
  isProtectedSelectionIconUrl,
  readSettings,
} = globalThis.LingoFlashExtension;

const form = document.getElementById('settings-form');
const autoSpeak = document.getElementById('auto-speak');
const bubbleDuration = document.getElementById('bubble-duration');
const recentLookupsEnabled = document.getElementById('recent-lookups-enabled');
const quickTranslateSource = document.getElementById('quick-translate-source');
const quickTranslateTarget = document.getElementById('quick-translate-target');
const status = document.getElementById('settings-status');
const selectionIconSiteInput = document.getElementById('selection-icon-site');
const addSelectionIconSiteButton = document.getElementById('add-selection-icon-site');
const selectionIconStatus = document.getElementById('selection-icon-status');
const selectionIconSitesList = document.getElementById('selection-icon-sites');
const selectionIconEmpty = document.getElementById('selection-icon-empty');
const saveButton = document.getElementById('save-settings');
let currentSettings = { ...DEFAULT_SETTINGS };

const setStatus = (message = '', tone = '') => {
  status.textContent = message;
  if (tone) status.dataset.tone = tone;
  else delete status.dataset.tone;
};

const setSelectionIconStatus = (message = '', tone = '') => {
  if (!selectionIconStatus) return;
  selectionIconStatus.textContent = message;
  if (tone) selectionIconStatus.dataset.tone = tone;
  else delete selectionIconStatus.dataset.tone;
};

const applySettings = settings => {
  currentSettings = settings;
  autoSpeak.checked = settings.autoSpeak;
  bubbleDuration.value = String(settings.bubbleDurationMs);
  recentLookupsEnabled.checked = settings.recentLookupsEnabled;
  quickTranslateSource.value = settings.quickTranslateSource;
  quickTranslateTarget.value = settings.quickTranslateTarget;
};

const sendMessage = message => apiCall(extensionApi.runtime, 'sendMessage', message);

const renderSelectionIconSites = sites => {
  if (!selectionIconSitesList) return;
  selectionIconSitesList.replaceChildren();
  const values = Array.isArray(sites) ? sites : [];
  if (selectionIconEmpty) selectionIconEmpty.hidden = values.length > 0;
  for (const pattern of values) {
    const row = document.createElement('li');
    row.className = 'site-row';
    const label = document.createElement('span');
    label.textContent = pattern;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = 'Tắt';
    remove.setAttribute('aria-label', `Tắt floating icon cho ${pattern}`);
    remove.addEventListener('click', () => { void removeSelectionIconSite(pattern, remove); });
    row.append(label, remove);
    selectionIconSitesList.append(row);
  }
};

const loadSelectionIconSites = async () => {
  if (!selectionIconSitesList) return;
  try {
    const response = await sendMessage({ type: 'GET_SELECTION_ICON_SITES' });
    if (!response?.ok) throw new Error(response?.error || 'Không thể đọc danh sách website.');
    renderSelectionIconSites(response.sites);
  } catch {
    renderSelectionIconSites([]);
    setSelectionIconStatus('Không thể đọc danh sách website đã cấp quyền.', 'error');
  }
};

const removeSelectionIconSite = async (pattern, button) => {
  if (button) button.disabled = true;
  try {
    const removed = await apiCall(extensionApi.permissions, 'remove', { origins: [pattern] });
    if (removed === false) throw new Error('Trình duyệt không thu hồi được quyền website.');
    const response = await sendMessage({ type: 'DISABLE_SELECTION_ICON_SITE', pattern });
    if (!response?.ok) throw new Error(response?.error || 'Không thể tắt floating icon.');
    renderSelectionIconSites(response.sites);
    currentSettings = { ...currentSettings, selectionIconSites: response.sites };
    setSelectionIconStatus('Đã tắt floating icon cho website này.', 'success');
  } catch (error) {
    setSelectionIconStatus(error instanceof Error ? error.message : 'Không thể tắt floating icon.', 'error');
  } finally {
    if (button) button.disabled = false;
  }
};

const addSelectionIconSite = async () => {
  const raw = selectionIconSiteInput?.value?.trim() || '';
  const pattern = selectionIconSitePatternFromUrl(raw);
  if (!pattern || isProtectedSelectionIconUrl(raw)) {
    setSelectionIconStatus('Hãy nhập một website http(s) hợp lệ (không phải trang bảo vệ hoặc LingoFlash).', 'error');
    return;
  }
  addSelectionIconSiteButton.disabled = true;
  let permissionGrantedThisAttempt = false;
  try {
    // This call must remain in the direct click path so Chrome can display its
    // permission prompt and the user can make an explicit opt-in decision.
    const granted = await apiCall(extensionApi.permissions, 'request', { origins: [pattern] });
    if (granted !== true) throw new Error('Bạn chưa cấp quyền cho website này.');
    permissionGrantedThisAttempt = true;
    const response = await sendMessage({ type: 'ENABLE_SELECTION_ICON_SITE', pattern });
    if (!response?.ok) throw new Error(response?.error || 'Không thể bật floating icon.');
    currentSettings = { ...currentSettings, selectionIconSites: response.sites };
    renderSelectionIconSites(response.sites);
    selectionIconSiteInput.value = '';
    setSelectionIconStatus('Đã cấp quyền và bật floating icon.', 'success');
  } catch (error) {
    if (permissionGrantedThisAttempt) {
      try { await apiCall(extensionApi.permissions, 'remove', { origins: [pattern] }); } catch {}
    }
    setSelectionIconStatus(error instanceof Error ? error.message : 'Không thể cấp quyền website.', 'error');
  } finally {
    addSelectionIconSiteButton.disabled = false;
  }
};

const load = async () => {
  try {
    applySettings(await readSettings());
    await loadSelectionIconSites();
  } catch {
    applySettings(DEFAULT_SETTINGS);
    setStatus('Không thể đọc cài đặt hiện tại; đã dùng giá trị mặc định.', 'error');
  }
};

form.addEventListener('submit', event => {
  event.preventDefault();
  if (saveButton?.disabled) return;
  if (saveButton) {
    saveButton.disabled = true;
    saveButton.textContent = 'Đang lưu…';
  }
  form.setAttribute('aria-busy', 'true');
  setStatus('Đang lưu cài đặt…');
  void sendMessage({
    type: 'UPDATE_USER_SETTINGS',
    changes: {
      autoSpeak: autoSpeak.checked,
      bubbleDurationMs: Number(bubbleDuration.value),
      recentLookupsEnabled: recentLookupsEnabled.checked,
      quickTranslateSource: quickTranslateSource.value,
      quickTranslateTarget: quickTranslateTarget.value,
    },
  }).then(response => {
    if (!response?.ok || !response.settings) throw new Error(response?.error || 'Không thể lưu cài đặt.');
    const settings = response.settings;
    applySettings(settings);
    setStatus('Đã lưu cài đặt.', 'success');
  }).catch(error => setStatus(error instanceof Error ? error.message : 'Không thể lưu cài đặt.', 'error'))
    .finally(() => {
      form.removeAttribute('aria-busy');
      if (saveButton) {
        saveButton.disabled = false;
        saveButton.textContent = 'Lưu cài đặt';
      }
    });
});

addSelectionIconSiteButton?.addEventListener('click', () => { void addSelectionIconSite(); });

void load();
