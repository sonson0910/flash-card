'use strict';

const {
  extensionApi,
  apiCall,
  MAX_TEXT_LENGTH,
  normalizeSelectedText,
  selectionValidation,
  t,
  localizeDocument,
  applyColorScheme,
  applyThemeFamily,
  readSettings,
} = globalThis.LingoFlashExtension;

localizeDocument(document);
void readSettings().then(settings => {
  applyColorScheme(settings.colorScheme);
  applyThemeFamily(settings.themeFamily);
}).catch(() => undefined);

const selectionInput = document.getElementById('selection');
const requestedDeckSelect = document.getElementById('requested-deck');
const deckStatus = document.getElementById('deck-status');
const characterCount = document.getElementById('character-count');
const translateButton = document.getElementById('translate-button');
const addButton = document.getElementById('add-button');
const speakSelectionButton = document.getElementById('speak-selection');
const speechSupportStatus = document.getElementById('speech-support-status');
const status = document.getElementById('status');
const saveShortcutValue = document.getElementById('save-shortcut-value');
const translateShortcutValue = document.getElementById('translate-shortcut-value');
const openShortcutsButton = document.getElementById('open-shortcuts');
const recentLookups = document.getElementById('recent-lookups');
const recentList = document.getElementById('recent-list');
const clearHistoryButton = document.getElementById('clear-history');
const selectionIconToggle = document.getElementById('selection-icon-toggle');
const selectionIconStatus = document.getElementById('selection-icon-status');
const dueCountSuffix = document.getElementById('due-count-suffix');
const resultCard = document.getElementById('result-card');
const resultWord = document.getElementById('result-word');
const resultTranslation = document.getElementById('result-translation');
const resultDetails = document.getElementById('result-details');
const resultPhonetic = document.getElementById('result-phonetic');
const resultExplanation = document.getElementById('result-explanation');
const resultExample = document.getElementById('result-example');
const resultExampleTranslation = document.getElementById('result-example-translation');
const resultClose = document.getElementById('result-close');
const resultSpeak = document.getElementById('result-speak');
const resultSave = document.getElementById('result-save');
let activeQuickAddId = null;
let isBusy = false;
let selectionIconSite = null;
let selectionInputTouched = false;
let decksReady = false;
const pendingQuickAddStatuses = new Map();
const speechRequestIds = new WeakMap();
const speechLocaleForLanguage = value => {
  const code = String(value || '').toLowerCase().split('-')[0];
  const locales = { en: 'en-US', vi: 'vi-VN', fr: 'fr-FR', de: 'de-DE', es: 'es-ES', it: 'it-IT', pt: 'pt-BR', ja: 'ja-JP', ko: 'ko-KR', zh: 'zh-CN', ru: 'ru-RU' };
  return locales[code] || 'en-US';
};
const speechSupported = () => Boolean(
  globalThis.speechSynthesis && typeof globalThis.speechSynthesis.speak === 'function'
    && typeof globalThis.SpeechSynthesisUtterance === 'function',
);

const renderResultCard = ({ word = '', translation = '', phonetic = '', explanation = '', example = '', exampleTranslation = '', sourceLanguage = '', speechLocale = '', canSave = false } = {}) => {
  if (!resultCard) return;
  if (!translation) {
    resultCard.hidden = true;
    return;
  }
  resultCard.hidden = false;
  if (resultWord) resultWord.textContent = word;
  if (resultTranslation) resultTranslation.textContent = translation;
  const hasDetails = Boolean(phonetic || explanation || example || exampleTranslation);
  if (resultDetails) {
    resultDetails.hidden = !hasDetails;
    if (resultPhonetic) {
      resultPhonetic.textContent = phonetic;
      resultPhonetic.hidden = !phonetic;
    }
    if (resultExplanation) {
      resultExplanation.textContent = explanation;
      resultExplanation.hidden = !explanation;
    }
    if (resultExample) {
      resultExample.textContent = example ? t('resultExamplePrefix', [example], `Ví dụ: ${example}`) : '';
      resultExample.hidden = !example;
    }
    if (resultExampleTranslation) {
      resultExampleTranslation.textContent = exampleTranslation ? t('resultExampleTranslationPrefix', [exampleTranslation], `Dịch ví dụ: ${exampleTranslation}`) : '';
      resultExampleTranslation.hidden = !exampleTranslation;
    }
  }
  if (resultSave) {
    resultSave.hidden = !canSave;
    resultSave.onclick = () => {
      selectionInput.value = word;
      updateInputState();
      void runMode('ADD_SELECTION');
    };
  }
  if (resultSpeak) {
    nextSpeechRequestId(resultSpeak);
    if (resultSpeak.dataset.speechState === 'playing') {
      try { globalThis.speechSynthesis?.cancel?.(); } catch {}
    }
    const speakLabel = t('resultSpeakAriaLabel', [word], `Nghe phát âm ${word}`);
    setSpeechState(resultSpeak, 'idle', speakLabel);
    resultSpeak.disabled = !speechSupported();
    resultSpeak.onclick = () => speakText(word, resultSpeak, speechLocale || sourceLanguage || 'en-US', speakLabel);
  }
};

const setStatus = (message = '', tone = '') => {
  status.textContent = message;
  if (tone) status.dataset.tone = tone;
  else delete status.dataset.tone;
};

const updateInputState = () => {
  const validation = selectionValidation(selectionInput.value);
  characterCount.textContent = `${selectionInput.value.length}/${MAX_TEXT_LENGTH}`;
  const enabled = !isBusy && validation.ok;
  translateButton.disabled = !enabled;
  addButton.disabled = !enabled || !decksReady;
  speakSelectionButton.disabled = !enabled || !speechSupported();
  if (speechSupportStatus) {
    const unsupported = !speechSupported();
    speechSupportStatus.hidden = !unsupported;
    speechSupportStatus.textContent = unsupported
      ? t('speechUnsupported', undefined, 'Trình duyệt này không hỗ trợ phát âm.')
      : '';
  }
};

const setBusy = busy => {
  isBusy = busy;
  updateInputState();
};

const sendMessage = message => apiCall(extensionApi.runtime, 'sendMessage', message);

const setSelectionIconStatus = (message = '', tone = '') => {
  if (!selectionIconStatus) return;
  selectionIconStatus.textContent = message;
  if (tone) selectionIconStatus.dataset.tone = tone;
  else delete selectionIconStatus.dataset.tone;
};

const renderSelectionIconSite = state => {
  if (!selectionIconToggle) return;
  selectionIconSite = state && typeof state === 'object' ? state : null;
  const pattern = typeof selectionIconSite?.pattern === 'string' ? selectionIconSite.pattern : '';
  const protectedUrl = selectionIconSite?.protected === true || !pattern;
  selectionIconToggle.disabled = protectedUrl;
  selectionIconToggle.setAttribute('aria-pressed', selectionIconSite?.enabled === true ? 'true' : 'false');
  if (protectedUrl) {
    selectionIconToggle.textContent = t('floatingIconUnavailable', undefined, 'Không khả dụng');
    setSelectionIconStatus(t('floatingIconStatusUnsupported', undefined, 'Trang này không hỗ trợ floating icon.'));
    return;
  }
  if (selectionIconSite?.enabled === true) {
    selectionIconToggle.textContent = t('floatingIconOn', undefined, 'Tắt');
    setSelectionIconStatus(t('floatingIconStatusOn', undefined, 'Đã cấp quyền và bật trên website này.'));
  } else {
    selectionIconToggle.textContent = t('floatingIconOff', undefined, 'Bật');
    setSelectionIconStatus(t('floatingIconStatusOff', undefined, 'Tắt mặc định; cần cấp quyền cho website này.'));
  }
};

const loadSelectionIconSite = async () => {
  if (!selectionIconToggle) return;
  try {
    const response = await sendMessage({ type: 'GET_ACTIVE_SITE' });
    if (!response?.ok) throw new Error(response?.error || t('errorReadActiveSite', undefined, 'Không thể đọc trạng thái website.'));
    renderSelectionIconSite(response);
  } catch {
    selectionIconToggle.disabled = true;
    selectionIconToggle.textContent = t('floatingIconUnavailable', undefined, 'Không khả dụng');
    setSelectionIconStatus(t('errorReadActiveSiteGeneric', undefined, 'Không thể đọc quyền website hiện tại.'));
  }
};

const toggleSelectionIconSite = async () => {
  if (!selectionIconSite || !selectionIconSite.pattern || selectionIconSite.protected || isBusy) return;
  const pattern = selectionIconSite.pattern;
  selectionIconToggle.disabled = true;
  let permissionGrantedThisAttempt = false;
  try {
    if (selectionIconSite.enabled) {
      const removed = await apiCall(extensionApi.permissions, 'remove', { origins: [pattern] });
      if (removed === false) throw new Error(t('errorPermissionRevoke', undefined, 'Trình duyệt không thu hồi được quyền website.'));
      const response = await sendMessage({ type: 'DISABLE_SELECTION_ICON_SITE', pattern });
      if (!response?.ok) throw new Error(response?.error || t('errorDisableFloatingIcon', undefined, 'Không thể tắt floating icon.'));
      renderSelectionIconSite({ ...selectionIconSite, enabled: false });
      return;
    }
    // Keep permissions.request directly in this click handler: browsers reject
    // permission prompts that are initiated by a background message/timer.
    const granted = await apiCall(extensionApi.permissions, 'request', { origins: [pattern] });
    if (granted !== true) throw new Error(t('errorPermissionMissing', undefined, 'Bạn chưa cấp quyền cho website này.'));
    permissionGrantedThisAttempt = true;
    const response = await sendMessage({ type: 'ENABLE_SELECTION_ICON_SITE', pattern });
    if (!response?.ok) throw new Error(response?.error || t('errorEnableFloatingIcon', undefined, 'Không thể bật floating icon.'));
    renderSelectionIconSite({ ...selectionIconSite, enabled: true });
  } catch (error) {
    if (permissionGrantedThisAttempt) {
      try { await apiCall(extensionApi.permissions, 'remove', { origins: [pattern] }); } catch {}
    }
    renderSelectionIconSite(selectionIconSite);
    setSelectionIconStatus(error instanceof Error ? error.message : t('errorUpdateSitePermission', undefined, 'Không thể cập nhật quyền website.'), 'error');
  }
};

const setSpeechState = (button, state, label) => {
  if (!button) return;
  button.dataset.speechState = state;
  const suffix = state === 'playing' ? ' (đang phát)' : state === 'error' ? ' (lỗi)' : '';
  button.setAttribute('aria-label', `${label}${suffix}`);
};

const nextSpeechRequestId = button => {
  if (!button) return 0;
  const requestId = (speechRequestIds.get(button) || 0) + 1;
  speechRequestIds.set(button, requestId);
  return requestId;
};

const isCurrentSpeechRequest = (button, requestId) => button && speechRequestIds.get(button) === requestId;

const speakText = (value, button = speakSelectionButton, lang = 'en-US', label) => {
  const resolvedLabel = label ?? t('speakSelectionAriaLabel', undefined, 'Nghe phát âm đoạn đã chọn');
  const text = normalizeSelectedText(value);
  const speech = globalThis.speechSynthesis;
  const Utterance = globalThis.SpeechSynthesisUtterance;
  if (!text || !speech || typeof speech.speak !== 'function' || typeof Utterance !== 'function') {
    if (button) button.disabled = true;
    setStatus(t('speechUnsupportedGeneric', undefined, 'Trình duyệt không hỗ trợ phát âm.'), 'error');
    return false;
  }
  const requestId = nextSpeechRequestId(button);
  setSpeechState(button, 'playing', resolvedLabel);
  try {
    speech.cancel?.();
    const utterance = new Utterance(text);
    utterance.lang = speechLocaleForLanguage(lang);
    utterance.rate = 0.88;
    utterance.onend = () => {
      if (isCurrentSpeechRequest(button, requestId)) setSpeechState(button, 'ended', resolvedLabel);
    };
    utterance.onerror = () => {
      if (isCurrentSpeechRequest(button, requestId)) setSpeechState(button, 'error', resolvedLabel);
    };
    speech.speak(utterance);
    return true;
  } catch {
    if (isCurrentSpeechRequest(button, requestId)) setSpeechState(button, 'error', resolvedLabel);
    setStatus(t('speechFailed', undefined, 'Không thể phát âm đoạn này.'), 'error');
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
    setStatus(t('statusCreatingBackground', undefined, 'Đang tạo flashcard ở nền…'));
    return;
  }
  const inlineSuffix = payload.inlineShown === false
    ? t('statusInlineNotShown', undefined, ' Không thể hiển thị trên trang này; kết quả vẫn được giữ an toàn.')
    : '';
  if (payload.status === 'created') {
    setStatus(t('statusCreatedSaved', [text, inlineSuffix], `Đã tạo và lưu “${text}”.${inlineSuffix}`), 'success');
    if (payload.translation) {
      renderResultCard({ word: text, translation: payload.translation, phonetic: payload.phonetic, explanation: payload.explanation, example: payload.exampleSentence, exampleTranslation: payload.exampleTranslation, sourceLanguage: payload.sourceLanguage, speechLocale: payload.speechLocale, canSave: false });
    }
  } else if (payload.status === 'existing') {
    setStatus(t('statusAlreadyInLibrary', [text, inlineSuffix], `“${text}” đã có trong thư viện.${inlineSuffix}`), 'success');
    if (payload.translation) {
      renderResultCard({ word: text, translation: payload.translation, phonetic: payload.phonetic, explanation: payload.explanation, example: payload.exampleSentence, exampleTranslation: payload.exampleTranslation, sourceLanguage: payload.sourceLanguage, speechLocale: payload.speechLocale, canSave: false });
    }
  } else if (payload.status === 'auth-required') {
    setStatus(t('statusAuthRequired', undefined, 'Cần đăng nhập SonFlash để hoàn tất việc lưu flashcard.'), 'error');
  } else if (payload.status === 'error') {
    setStatus(payload.message || t('statusGenericError', undefined, 'Không thể tạo hoặc lưu flashcard này.'), 'error');
  } else {
    return;
  }
  setBusy(false);
};

extensionApi.runtime?.onMessage?.addListener?.(message => {
  if (message?.type === 'QUICK_ADD_STATUS') applyQuickAddStatus(message.payload);
});

const loadSelection = async () => {
  try {
    const response = await sendMessage({ type: 'GET_SELECTION' });
    if (!response?.ok) throw new Error(response?.error || t('errorReadSelection', undefined, 'Không thể đọc đoạn đã chọn.'));
    const text = normalizeSelectedText(response.text);
    if (text && !selectionInputTouched && !selectionInput.value.trim()) {
      selectionInput.value = text;
      const validation = selectionValidation(text);
      const activeElement = document.activeElement;
      const canClaimFocus = !activeElement || activeElement === document.body || activeElement === selectionInput;
      if (!validation.ok) setStatus(validation.error, 'error');
      else if (canClaimFocus) selectionInput.select();
    }
  } catch {
    // Protected browser pages can still use manual entry.
  } finally {
    updateInputState();
    const activeElement = document.activeElement;
    if (!selectionInputTouched
      && (!activeElement || activeElement === document.body || activeElement === selectionInput)) {
      selectionInput.focus();
    }
  }
};

const loadShortcuts = async () => {
  const renderShortcut = (element, value) => {
    const assigned = typeof value === 'string' && value.trim();
    element.textContent = assigned ? value.trim() : t('shortcutUnassigned', undefined, 'Chưa gán');
    element.dataset.assigned = assigned ? 'true' : 'false';
  };
  try {
    const response = await sendMessage({ type: 'GET_SHORTCUTS' });
    if (!response?.ok) throw new Error(response?.error || t('errorReadShortcuts', undefined, 'Không thể đọc phím tắt.'));
    renderShortcut(saveShortcutValue, response.saveShortcut);
    renderShortcut(translateShortcutValue, response.translateShortcut);
    if (openShortcutsButton) openShortcutsButton.hidden = response.shortcutSettingsAvailable === false;
  } catch {
    renderShortcut(saveShortcutValue, '');
    renderShortcut(translateShortcutValue, '');
    if (openShortcutsButton) openShortcutsButton.hidden = true;
  }
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

const addSvgIcon = (button, kind) => {
  if (!button || typeof document.createElementNS !== 'function') return;
  const paths = kind === 'volume'
    ? ['M11 5 6 9H3v6h3l5 4V5Z', 'm15.5 8.5 3 3-3 3', 'M15.5 5.5a7 7 0 0 1 0 11']
    : ['M6 6l12 12', 'M18 6 6 18'];
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '14');
  svg.setAttribute('height', '14');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  paths.forEach(d => {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    svg.append(path);
  });
  button.append(svg);
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
    const speakLabel = t('recentSpeakAriaLabel', [item.text], `Nghe phát âm ${item.text}`);
    const speaker = makeRecentButton(t('recentSpeakLabel', undefined, 'Nghe'), speakLabel, () => speakText(item.text, speaker, item.sourceLanguage, speakLabel));
    addSvgIcon(speaker, 'volume');
    speaker.disabled = !speechSupported();
    speaker.dataset.speechState = 'idle';
    actions.append(speaker);
    if (item.kind === 'translate') {
      actions.append(makeRecentButton(t('recentSaveLabel', undefined, 'Lưu thẻ'), t('recentSaveAriaLabel', [item.text], `Lưu ${item.text} thành flashcard`), () => {
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

const loadDecks = async () => {
  if (!requestedDeckSelect) return;
  decksReady = false;
  requestedDeckSelect.disabled = true;
  updateInputState();
  try {
    const response = await sendMessage({ type: 'GET_DECKS' });
    if (!response?.ok) throw new Error(response?.error || t('errorReadRecentUnavailable', undefined, 'Không thể đọc danh sách deck.'));
    const decks = Array.isArray(response?.decks) ? response.decks : [];
    requestedDeckSelect.replaceChildren();
    const shared = document.createElement('option');
    shared.value = '';
    shared.textContent = t('deckSharedOption', undefined, 'Thư viện chung');
    requestedDeckSelect.append(shared);
    decks.slice(0, 100).forEach(deck => {
      if (typeof deck !== 'string' || !deck.trim()) return;
      const option = document.createElement('option');
      option.value = deck.trim().slice(0, 128);
      option.textContent = option.value;
      requestedDeckSelect.append(option);
    });
    requestedDeckSelect.value = '';
    requestedDeckSelect.disabled = false;
    decksReady = true;
    if (deckStatus) {
      deckStatus.textContent = decks.length
        ? t('deckSyncedCount', [decks.length], `${decks.length} deck đã đồng bộ.`)
        : t('deckSyncEmpty', undefined, 'Chưa có deck tùy chỉnh; đang dùng Thư viện chung.');
      delete deckStatus.dataset.tone;
    }
  } catch {
    decksReady = false;
    requestedDeckSelect.disabled = true;
    if (deckStatus) {
      deckStatus.textContent = t('deckSyncError', undefined, 'Chưa đồng bộ được deck; hãy mở SonFlash một lần.');
      deckStatus.dataset.tone = 'error';
    }
  } finally {
    updateInputState();
  }
};

const runMode = async type => {
  if (isBusy) return;
  if (type === 'ADD_SELECTION' && !decksReady) {
    setStatus(t('statusDeckNotSynced', undefined, 'Chưa đồng bộ được deck; hãy mở SonFlash một lần.'), 'error');
    return;
  }
  const validation = selectionValidation(selectionInput.value);
  if (!validation.ok) {
    setStatus(validation.error, 'error');
    return;
  }

  setBusy(true);
  setStatus(type === 'TRANSLATE_SELECTION'
    ? t('statusTranslating', undefined, 'Đang dịch nhanh bằng Google Translate…')
    : t('statusCreatingSave', undefined, 'Đang tạo flashcard ở nền bằng đúng 1 lần AI…'));

  try {
    const requestedDeck = type === 'ADD_SELECTION' && requestedDeckSelect?.value
      ? String(requestedDeckSelect.value).trim().slice(0, 128)
      : '';
    const response = await sendMessage({ type, text: validation.text, ...(requestedDeck ? { requestedDeck } : {}) });
    if (!response?.ok) throw new Error(response?.error || t('errorStartExtension', undefined, 'Không thể khởi động SonFlash.'));
    if (type === 'TRANSLATE_SELECTION') {
      if (response.inlineShown === false) {
        setStatus(t('statusTranslateResult', [response.translation || 'Không có kết quả.'], `Bản dịch: ${response.translation || 'Không có kết quả.'}`), 'success');
      } else {
        setStatus(t('statusTranslateShown', undefined, 'Đã dịch. Kết quả đang hiển thị trên trang.'), 'success');
      }
      if (response.translation) {
        renderResultCard({ word: validation.text, translation: response.translation, sourceLanguage: response.sourceLanguage, speechLocale: response.speechLocale, canSave: true });
      }
      setBusy(false);
    } else {
      activeQuickAddId = response.id;
      setStatus(t('statusQuickAddStarted', undefined, 'Đã bắt đầu tạo + lưu. Bạn có thể tiếp tục đọc trang.'), 'success');
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
  selectionInputTouched = true;
  setStatus();
  if (resultCard) resultCard.hidden = true;
  updateInputState();
});

openShortcutsButton?.addEventListener('click', () => {
  void sendMessage({ type: 'OPEN_SHORTCUTS' }).then(response => {
    if (!response?.ok) throw new Error(response?.error || t('errorOpenShortcuts', undefined, 'Không thể mở cài đặt phím tắt.'));
    globalThis.close();
  }).catch(error => setStatus(error instanceof Error ? error.message : String(error), 'error'));
});

resultClose?.addEventListener('click', () => {
  if (resultCard) resultCard.hidden = true;
});

speakSelectionButton.addEventListener('click', () => speakText(selectionInput.value, speakSelectionButton));

clearHistoryButton.addEventListener('click', () => {
  void sendMessage({ type: 'CLEAR_RECENT_LOOKUPS' }).then(response => {
    if (!response?.ok) throw new Error(response?.error || t('errorClearHistory', undefined, 'Không thể xóa lịch sử.'));
    renderRecentLookups([]);
    setStatus(t('statusHistoryCleared', undefined, 'Đã xóa lịch sử tra cứu.'), 'success');
  }).catch(error => setStatus(error instanceof Error ? error.message : String(error), 'error'));
});

selectionIconToggle?.addEventListener('click', () => {
  void toggleSelectionIconSite();
});

document.getElementById('open-app').addEventListener('click', () => {
  void sendMessage({ type: 'OPEN_APP' }).then(response => {
    if (!response?.ok) throw new Error(response?.error || t('errorOpenApp', undefined, 'Không thể mở SonFlash.'));
    globalThis.close();
  }).catch(error => setStatus(error instanceof Error ? error.message : String(error), 'error'));
});

// 07.6: the due-count badge only ever shows a real, background-synced value
// (kept in the extension's own storage, scoped like deck metadata) — it is
// hidden, never a placeholder number, until the signed-in app has synced one.
const loadDueCount = async () => {
  if (!dueCountSuffix) return;
  try {
    const response = await sendMessage({ type: 'GET_DUE_COUNT' });
    if (response?.ok && Number.isSafeInteger(response.count) && response.count >= 0) {
      dueCountSuffix.textContent = t('dueCountBadge', [response.count], `· ${response.count} thẻ đến hạn`);
      dueCountSuffix.hidden = false;
    } else {
      dueCountSuffix.hidden = true;
      dueCountSuffix.textContent = '';
    }
  } catch {
    dueCountSuffix.hidden = true;
    dueCountSuffix.textContent = '';
  }
};

void Promise.all([loadSelection(), loadShortcuts(), loadRecentLookups(), loadDecks(), loadSelectionIconSite(), loadDueCount()]);
