'use strict';

const {
  extensionApi,
  apiCall,
  MAX_TEXT_LENGTH,
  normalizeSelectedText,
  selectionValidation,
} = globalThis.LingoFlashExtension;

const selectionInput = document.getElementById('selection');
const characterCount = document.getElementById('character-count');
const translateButton = document.getElementById('translate-button');
const addButton = document.getElementById('add-button');
const status = document.getElementById('status');
const saveShortcutValue = document.getElementById('save-shortcut-value');
const translateShortcutValue = document.getElementById('translate-shortcut-value');

const setStatus = (message = '', tone = '') => {
  status.textContent = message;
  if (tone) status.dataset.tone = tone;
  else delete status.dataset.tone;
};

const updateInputState = () => {
  const validation = selectionValidation(selectionInput.value);
  characterCount.textContent = `${selectionInput.value.length}/${MAX_TEXT_LENGTH}`;
  translateButton.disabled = !validation.ok;
  addButton.disabled = !validation.ok;
};

const setBusy = busy => {
  translateButton.disabled = busy || !selectionValidation(selectionInput.value).ok;
  addButton.disabled = busy || !selectionValidation(selectionInput.value).ok;
};

const sendMessage = message => apiCall(extensionApi.runtime, 'sendMessage', message);

const loadSelection = async () => {
  try {
    const response = await sendMessage({ type: 'GET_SELECTION' });
    if (!response?.ok) throw new Error(response?.error || 'Không thể đọc đoạn đã chọn.');
    const text = normalizeSelectedText(response.text);
    if (text) {
      selectionInput.value = text;
      const validation = selectionValidation(text);
      if (validation.ok) selectionInput.select();
      else setStatus(validation.error, 'error');
    }
  } catch {
    // Protected browser pages can still use manual entry.
  } finally {
    updateInputState();
    selectionInput.focus();
  }
};

const loadShortcuts = async () => {
  try {
    const response = await sendMessage({ type: 'GET_SHORTCUTS' });
    if (!response?.ok) return;
    if (response.saveShortcut) saveShortcutValue.textContent = response.saveShortcut;
    if (response.translateShortcut) translateShortcutValue.textContent = response.translateShortcut;
  } catch {}
};

const runMode = async type => {
  const validation = selectionValidation(selectionInput.value);
  if (!validation.ok) {
    setStatus(validation.error, 'error');
    return;
  }

  setBusy(true);
  setStatus(type === 'TRANSLATE_SELECTION'
    ? 'Đang dịch nhanh bằng Google Translate…'
    : 'Đang tạo flashcard ở nền bằng đúng 1 lần AI…');

  try {
    const response = await sendMessage({ type, text: validation.text });
    if (!response?.ok) throw new Error(response?.error || 'Không thể khởi động LingoFlash.');
    setStatus(type === 'TRANSLATE_SELECTION'
      ? 'Đã dịch. Kết quả đang hiển thị trên trang.'
      : 'Đã bắt đầu tạo + lưu. Bạn có thể tiếp tục đọc trang.', 'success');
    globalThis.setTimeout(() => globalThis.close(), 350);
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), 'error');
    setBusy(false);
  }
};

document.getElementById('selection-form').addEventListener('submit', event => {
  event.preventDefault();
  void runMode('ADD_SELECTION');
});

translateButton.addEventListener('click', () => {
  void runMode('TRANSLATE_SELECTION');
});

selectionInput.addEventListener('input', () => {
  setStatus();
  updateInputState();
});

document.getElementById('open-app').addEventListener('click', () => {
  void sendMessage({ type: 'OPEN_APP' }).then(response => {
    if (!response?.ok) throw new Error(response?.error || 'Không thể mở LingoFlash.');
    globalThis.close();
  }).catch(error => setStatus(error instanceof Error ? error.message : String(error), 'error'));
});

document.getElementById('open-options').addEventListener('click', () => {
  void apiCall(extensionApi.runtime, 'openOptionsPage')
    .then(() => globalThis.close())
    .catch(error => setStatus(error instanceof Error ? error.message : String(error), 'error'));
});

void Promise.all([loadSelection(), loadShortcuts()]);
