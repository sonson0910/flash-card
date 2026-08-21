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
const speakSelectionButton = document.getElementById('speak-selection');
const status = document.getElementById('status');
const saveShortcutValue = document.getElementById('save-shortcut-value');
const translateShortcutValue = document.getElementById('translate-shortcut-value');
const recentLookups = document.getElementById('recent-lookups');
const recentList = document.getElementById('recent-list');
const clearHistoryButton = document.getElementById('clear-history');
let activeQuickAddId = null;
const pendingQuickAddStatuses = new Map();

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
  speakSelectionButton.disabled = !validation.ok;
};

const setBusy = busy => {
  translateButton.disabled = busy || !selectionValidation(selectionInput.value).ok;
  addButton.disabled = busy || !selectionValidation(selectionInput.value).ok;
};

const sendMessage = message => apiCall(extensionApi.runtime, 'sendMessage', message);

const speakText = value => {
  const text = normalizeSelectedText(value);
  const speech = globalThis.speechSynthesis;
  const Utterance = globalThis.SpeechSynthesisUtterance;
  if (!text || !speech || typeof speech.speak !== 'function' || typeof Utterance !== 'function') {
    setStatus('Trình duyệt không hỗ trợ phát âm.', 'error');
    return false;
  }
  try {
    speech.cancel?.();
    const utterance = new Utterance(text);
    utterance.lang = 'en-US';
    speech.speak(utterance);
    return true;
  } catch {
    setStatus('Không thể phát âm đoạn này.', 'error');
    return false;
  }
};

const applyQuickAddStatus = payload => {
  if (!payload || typeof payload !== 'object' || typeof payload.id !== 'string') return;
  if (activeQuickAddId !== payload.id) {
    pendingQuickAddStatuses.set(payload.id, payload);
    return;
  }
  const text = typeof payload.text === 'string' ? payload.text : '';
  if (payload.status === 'loading-save') {
    setStatus('Đang tạo flashcard ở nền…');
    return;
  }
  const inlineSuffix = payload.inlineShown === false
    ? ' Không thể hiển thị trên trang này; kết quả vẫn được giữ an toàn.'
    : '';
  if (payload.status === 'created') {
    setStatus(`Đã tạo và lưu “${text}”.${inlineSuffix}`, 'success');
  } else if (payload.status === 'existing') {
    setStatus(`“${text}” đã có trong thư viện.${inlineSuffix}`, 'success');
  } else if (payload.status === 'auth-required') {
    setStatus('Cần đăng nhập LingoFlash để hoàn tất việc lưu flashcard.', 'error');
  } else if (payload.status === 'error') {
    setStatus(payload.message || 'Không thể tạo hoặc lưu flashcard này.', 'error');
  } else {
    return;
  }
  setBusy(false);
  if (payload.inlineShown !== false && payload.status !== 'auth-required' && payload.status !== 'error') {
    globalThis.setTimeout(() => globalThis.close(), 350);
  }
};

extensionApi.runtime?.onMessage?.addListener?.(message => {
  if (message?.type === 'QUICK_ADD_STATUS') applyQuickAddStatus(message.payload);
});

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

const makeRecentButton = (label, ariaLabel, handler) => {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'recent-action';
  button.textContent = label;
  button.setAttribute('aria-label', ariaLabel);
  button.addEventListener('click', handler);
  return button;
};

const renderRecentLookups = items => {
  recentList.replaceChildren();
  const values = Array.isArray(items) ? items : [];
  recentLookups.hidden = values.length === 0;
  values.forEach(item => {
    const row = document.createElement('div');
    row.className = 'recent-row';
    const copy = document.createElement('div');
    copy.className = 'recent-copy';
    const text = document.createElement('div');
    text.className = 'recent-text';
    text.textContent = item.text;
    const translation = document.createElement('div');
    translation.className = 'recent-translation';
    translation.textContent = item.translation;
    copy.append(text, translation);
    const actions = document.createElement('div');
    actions.className = 'recent-actions';
    actions.append(makeRecentButton('🔊', `Nghe phát âm ${item.text}`, () => speakText(item.text)));
    if (item.kind === 'translate') {
      actions.append(makeRecentButton('Lưu thẻ', `Lưu ${item.text} thành flashcard`, () => {
        selectionInput.value = item.text;
        updateInputState();
        void runMode('ADD_SELECTION');
      }));
    }
    row.append(copy, actions);
    recentList.append(row);
  });
};

const loadRecentLookups = async () => {
  try {
    const response = await sendMessage({ type: 'GET_RECENT_LOOKUPS' });
    renderRecentLookups(response?.ok ? response.items : []);
  } catch {
    renderRecentLookups([]);
  }
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
    if (type === 'TRANSLATE_SELECTION') {
      if (response.inlineShown === false) {
        setStatus(`Bản dịch: ${response.translation || 'Không có kết quả.'}`, 'success');
      } else {
        setStatus('Đã dịch. Kết quả đang hiển thị trên trang.', 'success');
        globalThis.setTimeout(() => globalThis.close(), 350);
      }
    } else {
      activeQuickAddId = response.id;
      setStatus('Đã bắt đầu tạo + lưu. Bạn có thể tiếp tục đọc trang.', 'success');
      const pending = pendingQuickAddStatuses.get(activeQuickAddId);
      if (pending) {
        pendingQuickAddStatuses.delete(activeQuickAddId);
        applyQuickAddStatus(pending);
      }
    }
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

speakSelectionButton.addEventListener('click', () => speakText(selectionInput.value));

clearHistoryButton.addEventListener('click', () => {
  void sendMessage({ type: 'CLEAR_RECENT_LOOKUPS' }).then(response => {
    if (!response?.ok) throw new Error(response?.error || 'Không thể xóa lịch sử.');
    renderRecentLookups([]);
    setStatus('Đã xóa lịch sử tra cứu.', 'success');
  }).catch(error => setStatus(error instanceof Error ? error.message : String(error), 'error'));
});

document.getElementById('open-app').addEventListener('click', () => {
  void sendMessage({ type: 'OPEN_APP' }).then(response => {
    if (!response?.ok) throw new Error(response?.error || 'Không thể mở LingoFlash.');
    globalThis.close();
  }).catch(error => setStatus(error instanceof Error ? error.message : String(error), 'error'));
});

void Promise.all([loadSelection(), loadShortcuts(), loadRecentLookups()]);
