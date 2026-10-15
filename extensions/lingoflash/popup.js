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
  applyCourseUiLocale,
  invalidateExtensionMetadata,
  getActiveCourseTargetLanguage,
  readSettings,
} = globalThis.LingoFlashExtension;

localizeDocument(document);
// Follows the active course's native language when the app has told the
// extension about a signed-in owner's active course (07.5); otherwise this
// resolves to false and every t()/localizeDocument() call keeps using
// today's Chrome-i18n-resolved locale exactly as before. The boot-time loads
// below (loadDueCount, loadShortcuts, ...) render their own text with direct
// t() calls rather than data-i18n attributes, so they must not start until
// this settles — otherwise they would race ahead and render in the browser's
// own UI locale before the course's native-language catalog is ready.
const courseUiLocaleReady = applyCourseUiLocale()
  .then(changed => { if (changed) localizeDocument(document); })
  .catch(() => undefined);
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
const openAppLabel = document.getElementById('open-app-label');
const webWordsLoop = document.getElementById('web-words-loop');
const webWordsLoopText = document.getElementById('web-words-loop-text');
const webWordsLoopAction = document.getElementById('web-words-loop-action');
const targetLanguageLabel = document.getElementById('target-language-label');
const resultCard = document.getElementById('result-card');
const resultBadge = document.getElementById('result-badge');
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
const stateCard = document.getElementById('state-card');
const stateIcon = document.getElementById('state-icon');
const stateTitle = document.getElementById('state-title');
const stateDesc = document.getElementById('state-desc');
const stateNote = document.getElementById('state-note');
const stateActions = document.getElementById('state-actions');
let activeQuickAddId = null;
let lastRetryId = null;
let isBusy = false;
let selectionIconSite = null;
let selectionInputTouched = false;
let decksReady = false;
const pendingQuickAddStatuses = new Map();
const speechRequestIds = new WeakMap();
const METADATA_INVALIDATED_MESSAGE = 'LINGOFLASH_EXTENSION_METADATA_INVALIDATED';
const metadataState = {
  deck: { generation: 0, scope: '' },
  due: { generation: 0, scope: '' },
  locale: { generation: 0, scope: '' },
};
const invalidatedMetadataKeys = new Set();
let metadataInvalidationEpoch = 0;
const normalizeMetadataGeneration = value => Number.isSafeInteger(value) && value > 0 ? value : 0;
const normalizeMetadataScope = value => typeof value === 'string' ? value.trim() : '';
const metadataKey = (channel, generation, scope) => `${channel}:${generation}:${scope || '*'}`;
const metadataResponseIsCurrent = (channel, response) => {
  const generation = normalizeMetadataGeneration(response?.generation);
  const scope = normalizeMetadataScope(response?.scope);
  // Old workers did not tag GET responses. Preserve that wire compatibility;
  // current workers always include generation/scope before exposing data.
  if (!generation) return true;
  if (invalidatedMetadataKeys.has(metadataKey(channel, generation, scope))
    || invalidatedMetadataKeys.has(metadataKey(channel, generation, ''))) return false;
  const state = metadataState[channel];
  if (!state) return false;
  if (state.generation > generation) return false;
  if (state.generation === generation && state.scope && scope && state.scope !== scope) return false;
  state.generation = generation;
  state.scope = scope;
  return true;
};
const speechLocaleForLanguage = value => {
  const code = String(value || '').toLowerCase().split('-')[0];
  const locales = { en: 'en-US', vi: 'vi-VN', fr: 'fr-FR', de: 'de-DE', es: 'es-ES', it: 'it-IT', pt: 'pt-BR', ja: 'ja-JP', ko: 'ko-KR', zh: 'zh-CN', ru: 'ru-RU' };
  return locales[code] || 'en-US';
};
const speechSupported = () => Boolean(
  globalThis.speechSynthesis && typeof globalThis.speechSynthesis.speak === 'function'
    && typeof globalThis.SpeechSynthesisUtterance === 'function',
);

const RESULT_BADGE_KEYS = {
  created: ['resultBadgeCreated', 'ĐÃ LƯU FLASHCARD'],
  existing: ['resultBadgeExisting', 'ĐÃ CÓ TRONG THƯ VIỆN'],
};

const TARGET_LANGUAGE_LABELS = {
  en: ['targetLanguageEnglish', 'Tiếng Anh'],
  ko: ['targetLanguageKorean', 'Tiếng Hàn'],
  ja: ['targetLanguageJapanese', 'Tiếng Nhật'],
  zh: ['targetLanguageChinese', 'Tiếng Trung'],
};

const renderTargetLanguageLabel = targetLanguage => {
  if (!targetLanguageLabel) return;
  const [key, fallback] = TARGET_LANGUAGE_LABELS[targetLanguage] || [];
  if (!key) {
    targetLanguageLabel.hidden = true;
    targetLanguageLabel.textContent = '';
    targetLanguageLabel.removeAttribute('aria-label');
    return;
  }
  const language = t(key, undefined, fallback);
  targetLanguageLabel.textContent = language;
  targetLanguageLabel.setAttribute('aria-label', t('targetLanguageBadgeAria', [language], `Ngôn ngữ đích: ${language}`));
  targetLanguageLabel.hidden = false;
};

const clearDeckMetadataView = () => {
  decksReady = false;
  requestedDeckSelect?.replaceChildren();
  if (requestedDeckSelect) requestedDeckSelect.disabled = true;
  if (deckStatus) {
    deckStatus.textContent = t('deckSyncError', undefined, 'Chưa đồng bộ được deck; hãy mở SonFlash một lần.');
    deckStatus.dataset.tone = 'error';
  }
  updateInputState();
};

const clearDueCountView = () => {
  if (dueCountSuffix) {
    dueCountSuffix.hidden = true;
    dueCountSuffix.textContent = '';
  }
  setOpenAppLabel(false);
};

const handleMetadataInvalidation = message => {
  if (!message || typeof message !== 'object' || Array.isArray(message)) return;
  const generation = normalizeMetadataGeneration(message.generation);
  const scopes = message.scopes;
  if (!generation || !scopes || typeof scopes !== 'object' || Array.isArray(scopes)) return;
  metadataInvalidationEpoch += 1;

  for (const channel of ['deck', 'due', 'locale']) {
    if (!Object.prototype.hasOwnProperty.call(scopes, channel)) continue;
    const scope = normalizeMetadataScope(scopes[channel]);
    invalidatedMetadataKeys.add(metadataKey(channel, generation, scope));
    const state = metadataState[channel];
    if (state.generation > generation
      || (state.generation === generation && state.scope && scope && state.scope !== scope)) continue;
    state.generation = Math.max(state.generation, generation);
    state.scope = '';
    if (channel === 'deck') clearDeckMetadataView();
    if (channel === 'due') clearDueCountView();
  }

  if (Object.prototype.hasOwnProperty.call(scopes, 'locale')) {
    invalidateExtensionMetadata?.(message);
    localizeDocument(document);
    renderTargetLanguageLabel(getActiveCourseTargetLanguage());
  }
};

const renderResultCard = ({ word = '', translation = '', phonetic = '', explanation = '', example = '', exampleTranslation = '', sourceLanguage = '', speechLocale = '', canSave = false, status = '' } = {}) => {
  if (!resultCard) return;
  if (!translation) {
    resultCard.hidden = true;
    delete resultCard.dataset.status;
    return;
  }
  resultCard.hidden = false;
  // 07.1: the same mini-flashcard shell renders three distinct real states —
  // a fresh translation, a newly saved card, and a duplicate that already
  // existed — each with its own badge tone so "saved" and "duplicate" are
  // never visually confused (data-status drives the CSS in popup.css).
  if (status) resultCard.dataset.status = status;
  else delete resultCard.dataset.status;
  if (resultBadge) {
    const [key, fallback] = RESULT_BADGE_KEYS[status] || [];
    resultBadge.textContent = key ? t(key, undefined, fallback) : t('resultBadge', undefined, 'KẾT QUẢ');
  }
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
    setSelectionIconStatus(t('floatingIconStatusUnsupported', undefined, 'Trang này không hỗ trợ floating icon.'), 'unavailable');
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

// The extension never receives a distinct "quota" wire status — status stays
// one of the existing ['created','existing','auth-required','error'] values
// (no new protocol identifier). The app's captureFailureMessage() guarantees
// every AI-quota-classified error message contains one of these three
// Vietnamese phrases, so this is a real, documented signal read from the
// existing message field, not a guess at unstructured text.
const QUOTA_MESSAGE_HINTS = ['hạn mức', 'số thẻ', 'lượt AI'];
const isQuotaMessage = message => typeof message === 'string' && QUOTA_MESSAGE_HINTS.some(hint => message.includes(hint));

const hideStateCard = () => {
  if (!stateCard) return;
  stateCard.hidden = true;
  delete stateCard.dataset.state;
  if (stateActions) stateActions.replaceChildren();
  if (stateNote) { stateNote.hidden = true; stateNote.textContent = ''; }
};

const makeStateButton = (label, kind, handler) => {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = kind === 'secondary' ? 'state-btn state-btn-secondary' : 'state-btn';
  button.textContent = label;
  button.addEventListener('click', handler);
  return button;
};

// One state-card shell renders every non-result state (sign-in/quota/error);
// it mirrors ExtPopupState's isError card (icon + title + description + CTA)
// from the Canvas boards instead of inventing a new layout per state.
const renderStateCard = ({ state, icon, title, desc, note = '', actions = [] }) => {
  if (!stateCard) return;
  if (resultCard) { resultCard.hidden = true; delete resultCard.dataset.status; }
  stateCard.hidden = false;
  stateCard.dataset.state = state;
  if (stateIcon) { stateIcon.replaceChildren(); addSvgIcon(stateIcon, icon, 16); }
  if (stateTitle) stateTitle.textContent = title;
  if (stateDesc) stateDesc.textContent = desc;
  if (stateNote) {
    stateNote.hidden = !note;
    stateNote.textContent = note;
  }
  if (stateActions) {
    stateActions.replaceChildren();
    actions.forEach(({ label, kind, handler }) => stateActions.append(makeStateButton(label, kind, handler)));
  }
};

const openAppFromState = () => {
  void sendMessage({ type: 'OPEN_APP' }).then(response => {
    if (!response?.ok) throw new Error(response?.error || t('errorOpenApp', undefined, 'Không thể mở SonFlash.'));
    globalThis.close();
  }).catch(error => setStatus(error instanceof Error ? error.message : String(error), 'error'));
};

const showSignInState = () => {
  renderStateCard({
    state: 'sign-in',
    icon: 'lock',
    title: t('stateSignInTitle', undefined, 'Chưa đăng nhập SonFlash'),
    desc: t('stateSignInDesc', undefined, 'Đăng nhập để tạo flashcard và đồng bộ deck. Dịch nhanh vẫn dùng được.'),
    actions: [{ label: t('stateSignInAction', undefined, 'Đăng nhập SonFlash'), handler: openAppFromState }],
  });
};

// Real signal, no fabricated numbers: the app only ever hands the extension a
// message string (see captureFailureMessage), never the AiQuotaError's
// structured used/limit/tier fields, so this card cannot show a meter or an
// exact quota count without inventing one. "Dịch nhanh vẫn miễn phí" and the
// upgrade CTA are the only claims that hold regardless of the exact numbers.
const showQuotaState = message => {
  renderStateCard({
    state: 'quota',
    icon: 'warning',
    title: t('stateQuotaTitle', undefined, 'Hết lượt AI hôm nay'),
    desc: message || t('stateQuotaDescFallback', undefined, 'Dịch vụ AI đã hết hạn mức. Từ đã chọn vẫn được giữ lại; hãy thử lại sau.'),
    note: t('stateQuotaNote', undefined, 'Dịch nhanh vẫn miễn phí, không dùng lượt AI.'),
    actions: [{ label: t('stateQuotaAction', undefined, 'Mở SonFlash · Nâng cấp Pro'), handler: openAppFromState }],
  });
};

const retryQuickAdd = async id => {
  if (!id || isBusy) return;
  setBusy(true);
  setStatus(t('statusCreatingSave', undefined, 'Đang tạo flashcard ở nền bằng đúng 1 lần AI…'), 'busy');
  try {
    const response = await sendMessage({ type: 'RETRY_QUICK_ADD', id });
    if (!response?.ok) throw new Error(response?.error || t('errorRetryQuickAdd', undefined, 'Không thể thử lại. Hãy chọn lại từ trong extension.'));
    activeQuickAddId = response.id;
    hideStateCard();
    setStatus(t('statusQuickAddStarted', undefined, 'Đã bắt đầu tạo + lưu. Bạn có thể tiếp tục đọc trang.'), 'success');
    const pending = pendingQuickAddStatuses.get(activeQuickAddId);
    if (pending) {
      pendingQuickAddStatuses.delete(activeQuickAddId);
      applyQuickAddStatus(pending);
    }
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), 'error');
    setBusy(false);
  }
};

const showErrorState = (message, retryId) => {
  lastRetryId = typeof retryId === 'string' && retryId ? retryId : null;
  const actions = [];
  if (lastRetryId) {
    actions.push({ label: t('stateErrorAction', undefined, 'Thử lại'), handler: () => void retryQuickAdd(lastRetryId) });
  }
  renderStateCard({
    state: 'error',
    icon: 'warning',
    title: t('stateErrorTitle', undefined, 'Không thể tạo hoặc lưu flashcard này'),
    desc: message || t('statusGenericError', undefined, 'Không thể tạo hoặc lưu flashcard này.'),
    actions,
  });
};

const applyQuickAddStatus = payload => {
  if (!payload || typeof payload !== 'object' || typeof payload.id !== 'string') return;
  if (activeQuickAddId !== payload.id) {
    pendingQuickAddStatuses.set(payload.id, payload);
    return;
  }
  const text = typeof payload.text === 'string' ? payload.text : '';
  if (payload.status === 'loading-save') {
    setStatus(t('statusCreatingBackground', undefined, 'Đang tạo flashcard ở nền…'), 'busy');
    return;
  }
  const inlineSuffix = payload.inlineShown === false
    ? t('statusInlineNotShown', undefined, ' Không thể hiển thị trên trang này; kết quả vẫn được giữ an toàn.')
    : '';
  if (payload.status === 'created') {
    hideStateCard();
    setStatus(t('statusCreatedSaved', [text, inlineSuffix], `Đã tạo và lưu “${text}”.${inlineSuffix}`), 'success');
    if (payload.translation) {
      renderResultCard({ word: text, translation: payload.translation, phonetic: payload.phonetic, explanation: payload.explanation, example: payload.exampleSentence, exampleTranslation: payload.exampleTranslation, sourceLanguage: payload.sourceLanguage, speechLocale: payload.speechLocale, canSave: false, status: 'created' });
    }
  } else if (payload.status === 'existing') {
    hideStateCard();
    setStatus(t('statusAlreadyInLibrary', [text, inlineSuffix], `“${text}” đã có trong thư viện.${inlineSuffix}`), 'success');
    if (payload.translation) {
      renderResultCard({ word: text, translation: payload.translation, phonetic: payload.phonetic, explanation: payload.explanation, example: payload.exampleSentence, exampleTranslation: payload.exampleTranslation, sourceLanguage: payload.sourceLanguage, speechLocale: payload.speechLocale, canSave: false, status: 'existing' });
    }
  } else if (payload.status === 'auth-required') {
    setStatus('');
    showSignInState();
  } else if (payload.status === 'error') {
    setStatus('');
    if (isQuotaMessage(payload.message)) showQuotaState(payload.message);
    else showErrorState(payload.message, payload.id);
  } else {
    return;
  }
  setBusy(false);
};

extensionApi.runtime?.onMessage?.addListener?.(message => {
  if (message?.type === 'QUICK_ADD_STATUS') applyQuickAddStatus(message.payload);
  if (message?.type === METADATA_INVALIDATED_MESSAGE) handleMetadataInvalidation(message);
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

const SVG_ICON_PATHS = {
  volume: ['M11 5 6 9H3v6h3l5 4V5Z', 'm15.5 8.5 3 3-3 3', 'M15.5 5.5a7 7 0 0 1 0 11'],
  close: ['M6 6l12 12', 'M18 6 6 18'],
  lock: ['M6 11h12v10H6z', 'M8.5 11V8a3.5 3.5 0 0 1 7 0v3'],
  warning: ['M12 3 2 20h20z', 'M12 10v4', 'M12 17h.01'],
};

const addSvgIcon = (button, kind, size = 14) => {
  if (!button || typeof document.createElementNS !== 'function') return;
  const paths = SVG_ICON_PATHS[kind] || SVG_ICON_PATHS.close;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
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
  // Icons lead the label everywhere else in this UI, so the icon must be
  // prepended rather than appended after any text a caller already set.
  button.prepend(svg);
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

// The "loop" half of the ExtLoop state: a saved word does not just sit in the
// extension's own history, it feeds today's SonFlash session. This reuses the
// exact same GET_RECENT_LOOKUPS data `renderRecentLookups` already has (no new
// message type, no extra storage read) and only counts `kind: 'create'`
// entries — `background-core.js` records that kind exclusively on a
// successful save (status 'created' or 'existing'), so a failed or
// translate-only lookup never inflates this reminder.
const renderWebWordsLoop = items => {
  if (!webWordsLoop || !webWordsLoopText) return;
  const savedCount = (Array.isArray(items) ? items : []).filter(item => item.kind === 'create').length;
  webWordsLoop.hidden = savedCount === 0;
  if (savedCount === 0) return;
  webWordsLoopText.textContent = t(
    'webWordsLoopSummary',
    [String(savedCount)],
    `${savedCount} từ đã lưu từ trang web đang chờ trong buổi học hôm nay của bạn.`,
  );
};

const loadRecentLookups = async () => {
  try {
    const response = await sendMessage({ type: 'GET_RECENT_LOOKUPS' });
    const items = response?.ok ? response.items : [];
    renderRecentLookups(items);
    renderWebWordsLoop(items);
  } catch {
    renderRecentLookups([]);
    renderWebWordsLoop([]);
  }
};

const loadDecks = async () => {
  if (!requestedDeckSelect) return;
  const requestEpoch = metadataInvalidationEpoch;
  decksReady = false;
  requestedDeckSelect.disabled = true;
  if (deckStatus) deckStatus.dataset.tone = 'busy';
  updateInputState();
  try {
    const response = await sendMessage({ type: 'GET_DECKS' });
    if ((!normalizeMetadataGeneration(response?.generation) && requestEpoch !== metadataInvalidationEpoch)
      || !metadataResponseIsCurrent('deck', response)) {
      clearDeckMetadataView();
      return;
    }
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

  hideStateCard();
  setBusy(true);
  setStatus(type === 'TRANSLATE_SELECTION'
    ? t('statusTranslating', undefined, 'Đang dịch nhanh bằng Google Translate…')
    : t('statusCreatingSave', undefined, 'Đang tạo flashcard ở nền bằng đúng 1 lần AI…'), 'busy');

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
  hideStateCard();
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
    renderWebWordsLoop([]);
    setStatus(t('statusHistoryCleared', undefined, 'Đã xóa lịch sử tra cứu.'), 'success');
  }).catch(error => setStatus(error instanceof Error ? error.message : String(error), 'error'));
});

selectionIconToggle?.addEventListener('click', () => {
  void toggleSelectionIconSite();
});

document.getElementById('open-app').addEventListener('click', () => {
  // 07.6: a real, background-synced due count is currently displayed only
  // when dueCountSuffix is not hidden (see loadDueCount below) — in that
  // case the click should land the user on the session (Today) it is
  // counting, not the plain library. Sign-in and "no synced count yet"
  // clicks keep opening the plain app URL unchanged.
  const target = dueCountSuffix && !dueCountSuffix.hidden ? 'today' : undefined;
  void sendMessage({ type: 'OPEN_APP', target }).then(response => {
    if (!response?.ok) throw new Error(response?.error || t('errorOpenApp', undefined, 'Không thể mở SonFlash.'));
    globalThis.close();
  }).catch(error => setStatus(error instanceof Error ? error.message : String(error), 'error'));
});

webWordsLoopAction?.addEventListener('click', () => {
  void sendMessage({ type: 'OPEN_APP', target: 'webWords' }).then(response => {
    if (!response?.ok) throw new Error(response?.error || t('errorOpenApp', undefined, 'Không thể mở SonFlash.'));
    globalThis.close();
  }).catch(error => setStatus(error instanceof Error ? error.message : String(error), 'error'));
});

// 07.6: the due-count badge only ever shows a real, background-synced value
// (kept in the extension's own storage, scoped like deck metadata) — it is
// hidden, never a placeholder number, until the signed-in app has synced one.
// A resolved due count implies the extension already has a signed-in,
// synced session, so the footer link's label swaps from "Đăng nhập" to a
// "Mở thư viện" affordance instead of asking an already-signed-in user to
// sign in again.
const setOpenAppLabel = signedIn => {
  if (!openAppLabel) return;
  openAppLabel.textContent = signedIn
    ? t('openAppLinkLibrary', undefined, 'Mở thư viện')
    : t('openAppLink', undefined, 'Đăng nhập');
};

const loadDueCount = async () => {
  if (!dueCountSuffix) return;
  const requestEpoch = metadataInvalidationEpoch;
  try {
    const response = await sendMessage({ type: 'GET_DUE_COUNT' });
    if ((!normalizeMetadataGeneration(response?.generation) && requestEpoch !== metadataInvalidationEpoch)
      || !metadataResponseIsCurrent('due', response)) {
      clearDueCountView();
      return;
    }
    if (response?.ok && Number.isSafeInteger(response.count) && response.count >= 0) {
      dueCountSuffix.textContent = t('dueCountBadge', [response.count], `${response.count} thẻ đến hạn`);
      dueCountSuffix.hidden = false;
      setOpenAppLabel(true);
    } else {
      dueCountSuffix.hidden = true;
      dueCountSuffix.textContent = '';
      setOpenAppLabel(false);
    }
  } catch {
    dueCountSuffix.hidden = true;
    dueCountSuffix.textContent = '';
    setOpenAppLabel(false);
  }
};

void courseUiLocaleReady.then(() => {
  renderTargetLanguageLabel(getActiveCourseTargetLanguage());
  return Promise.all([
    loadSelection(), loadShortcuts(), loadRecentLookups(), loadDecks(), loadSelectionIconSite(), loadDueCount(),
  ]);
});
