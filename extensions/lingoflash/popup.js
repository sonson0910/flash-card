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
const addButton = document.getElementById('add-button');
const status = document.getElementById('status');
const shortcutValue = document.getElementById('shortcut-value');

const setStatus = (message = '', tone = '') => {
  status.textContent = message;
  if (tone) status.dataset.tone = tone;
  else delete status.dataset.tone;
};

const updateInputState = () => {
  const validation = selectionValidation(selectionInput.value);
  characterCount.textContent = `${selectionInput.value.length}/${MAX_TEXT_LENGTH}`;
  addButton.disabled = !validation.ok;
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
    // Some protected browser pages cannot expose selection; manual entry remains available.
  } finally {
    updateInputState();
    selectionInput.focus();
  }
};

const loadShortcut = async () => {
  try {
    const response = await sendMessage({ type: 'GET_SHORTCUT' });
    if (response?.ok && response.shortcut) shortcutValue.textContent = response.shortcut;
  } catch {
    // Keep the suggested shortcut label.
  }
};

document.getElementById('selection-form').addEventListener('submit', event => {
  event.preventDefault();
  const validation = selectionValidation(selectionInput.value);
  if (!validation.ok) {
    setStatus(validation.error, 'error');
    return;
  }
  addButton.disabled = true;
  setStatus('Đang chuyển sang LingoFlash…');
  void sendMessage({ type: 'ADD_SELECTION', text: validation.text }).then(response => {
    if (!response?.ok) throw new Error(response?.error || 'Không thể mở LingoFlash.');
    setStatus(`Đã gửi “${response.text}” sang LingoFlash.`, 'success');
    globalThis.setTimeout(() => globalThis.close(), 250);
  }).catch(error => {
    setStatus(error instanceof Error ? error.message : String(error), 'error');
    updateInputState();
  });
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

void Promise.all([loadSelection(), loadShortcut()]);
