import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { createI18nMock, loadMessages } from './i18n-test-helper.mjs';

const sharedSource = await readFile(new URL('../shared.js', import.meta.url), 'utf8');
const popupSource = await readFile(new URL('../popup.js', import.meta.url), 'utf8');
const popupHtmlSource = await readFile(new URL('../popup.html', import.meta.url), 'utf8');
const popupCssSource = await readFile(new URL('../popup.css', import.meta.url), 'utf8');

test('selection permission failure rolls back the newly granted origin', () => {
  assert.match(popupSource, /permissions.*request|request.*permissions/s);
  assert.match(popupSource, /permissions.*remove|remove.*permissions/s);
});

test('popup applies the saved theme family on boot alongside the color scheme', () => {
  assert.match(popupSource, /applyThemeFamily/);
  assert.match(popupSource, /applyThemeFamily\(settings\.themeFamily\)/);
});

test('popup removes a newly granted site permission when background enable fails', async () => {
  const popup = await createPopupContext({
    activeSite: { ok: true, pattern: 'https://example.com/*', protected: false, enabled: false },
    enableSelectionResponse: { ok: false, error: 'registration failed' },
  });
  popup.elements.get('selection-icon-toggle').dispatch('click');
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));

  assert.deepEqual(popup.permissionCalls.map(call => call.type), ['request', 'remove']);
  assert.equal(popup.permissionCalls[1].details.origins[0], 'https://example.com/*');
});

class FakeElement {
  constructor() {
    this.value = '';
    this.textContent = '';
    this.disabled = false;
    this.dataset = {};
    this.hidden = false;
    this.attributes = {};
    this.children = [];
    this.listeners = new Map();
    this.focusCalls = 0;
    this.selectCalls = 0;
  }

  addEventListener(type, listener) {
    const current = this.listeners.get(type) ?? [];
    current.push(listener);
    this.listeners.set(type, current);
  }

  dispatch(type, event = {}) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
    if (type === 'click' && typeof this.onclick === 'function') this.onclick(event);
  }

  select() {
    this.selectCalls += 1;
    if (this.ownerDocument) this.ownerDocument.activeElement = this;
  }

  focus() {
    this.focusCalls += 1;
    if (this.ownerDocument) this.ownerDocument.activeElement = this;
  }

  setAttribute(name, value) { this.attributes[name] = String(value); }

  removeAttribute(name) { delete this.attributes[name]; }

  append(...children) { this.children.push(...children); }

  prepend(...children) { this.children.unshift(...children); }

  replaceChildren(...children) { this.children = children; this.textContent = children.map(child => child.textContent ?? '').join(''); }
}

const createPopupContext = async ({
  recentItems = [],
  decks = [],
  speechSupported = true,
  translateInlineShown = false,
  translatePending = false,
  activeSite = null,
  enableSelectionResponse = { ok: true },
  selectionPending = false,
  shortcuts = { saveShortcut: 'Ctrl+Shift+L', translateShortcut: 'Alt+Shift+L' },
  shortcutSettingsAvailable = true,
  deckLoadError = false,
  deckResponseError = false,
  deckResponsePending = false,
  dueCount = null,
  dueResponsePending = false,
  metadataGeneration = 0,
  deckScope = '',
  dueScope = '',
  localeScope = '',
  retryQuickAddResponse = { ok: true, id: 'job_retry_1', text: 'resilient' },
  // Defaults to today's behavior: no confirmed course locale synced yet, so
  // applyCourseUiLocale() finds nothing to override (07.5).
  courseLocaleResponse = { ok: true, nativeLanguage: null, targetLanguage: null },
} = {}) => {
  const ids = [
    'selection', 'requested-deck', 'character-count', 'translate-button', 'add-button', 'speak-selection', 'speech-support-status', 'status',
    'save-shortcut-value', 'translate-shortcut-value', 'open-shortcuts', 'selection-form', 'open-app',
    'recent-lookups', 'recent-list', 'clear-history', 'selection-icon-toggle', 'selection-icon-status',
    'web-words-loop', 'web-words-loop-text', 'web-words-loop-action',
    'result-card', 'result-badge', 'result-close', 'result-word', 'result-translation', 'result-details',
    'result-phonetic', 'result-explanation', 'result-example', 'result-example-translation', 'result-actions', 'result-speak', 'result-save', 'deck-status',
    'due-count-suffix', 'open-app-label', 'target-language-label',
    'state-card', 'state-icon', 'state-title', 'state-desc', 'state-note', 'state-actions',
  ];
  const elements = new Map(ids.map(id => [id, new FakeElement()]));
  const runtimeMessages = [];
  const runtimeListeners = [];
  const permissionCalls = [];
  let resolveTranslate = () => undefined;
  let resolveSelection = () => undefined;
  let resolveDeckResponse = () => undefined;
  let resolveDueResponse = () => undefined;
  let closeCalls = 0;
  const speechSynthesis = {
    cancelCalls: 0,
    spoken: [],
    cancel() { this.cancelCalls += 1; },
    speak(utterance) { this.spoken.push(utterance); },
  };
  const runtime = {
    sendMessage(message) {
      runtimeMessages.push(message);
      if (message.type === 'GET_SELECTION') {
        if (selectionPending) return new Promise(resolve => { resolveSelection = resolve; });
        return Promise.resolve({ ok: true, text: 'resilient' });
      }
      if (message.type === 'GET_SHORTCUTS') return Promise.resolve({ ok: true, ...shortcuts, shortcutSettingsAvailable });
      if (message.type === 'GET_ACTIVE_SITE') return Promise.resolve(activeSite ?? { ok: true });
      if (message.type === 'ENABLE_SELECTION_ICON_SITE') return Promise.resolve(enableSelectionResponse);
      if (message.type === 'GET_RECENT_LOOKUPS') return Promise.resolve({ ok: true, items: recentItems });
      if (message.type === 'GET_DECKS') {
        if (deckLoadError) return Promise.reject(new Error('deck metadata unavailable'));
        const response = deckResponseError ? { ok: false, error: 'deck metadata unavailable' } : { ok: true, decks };
        const tagged = metadataGeneration ? { ...response, generation: metadataGeneration, scope: deckScope } : response;
        if (deckResponsePending) return new Promise(resolve => { resolveDeckResponse = () => resolve(tagged); });
        return Promise.resolve(tagged);
      }
      if (message.type === 'TRANSLATE_SELECTION') {
        if (translatePending) return new Promise(resolve => { resolveTranslate = resolve; });
        return Promise.resolve({ ok: true, text: 'resilient', translation: 'bền bỉ', inlineShown: translateInlineShown });
      }
      if (message.type === 'ADD_SELECTION') {
        return Promise.resolve({ ok: true, id: 'job_123456789', text: 'resilient' });
      }
      if (message.type === 'GET_DUE_COUNT') {
        const response = metadataGeneration
          ? { ok: true, count: dueCount, generation: metadataGeneration, scope: dueScope }
          : { ok: true, count: dueCount };
        if (dueResponsePending) return new Promise(resolve => { resolveDueResponse = () => resolve(response); });
        return Promise.resolve(response);
      }
      if (message.type === 'RETRY_QUICK_ADD') {
        return Promise.resolve(retryQuickAddResponse);
      }
      if (message.type === 'GET_COURSE_LOCALE') {
        return Promise.resolve(metadataGeneration
          ? { ...courseLocaleResponse, generation: metadataGeneration, scope: localeScope }
          : courseLocaleResponse);
      }
      return Promise.resolve({ ok: true });
    },
    onMessage: {
      addListener(listener) { runtimeListeners.push(listener); },
    },
    // Real getURL of the extension's own bundled _locales catalog (07.5):
    // resolved synchronously, exactly like the real chrome.runtime.getURL.
    getURL(path) { return `chrome-extension://lingoflash-test/${path}`; },
  };
  const fetchCalls = [];
  // Backs loadLocaleMessageCatalog()'s fetch of this extension's own bundled
  // `_locales/{locale}/messages.json` (07.5) with the real shipped catalog
  // content, read synchronously so no real async I/O races the microtask
  // ordering the rest of this harness already relies on.
  const fetchLocaleCatalog = async url => {
    fetchCalls.push(url);
    const match = String(url).match(/_locales\/([a-z]+)\/messages\.json$/);
    if (!match) return { ok: false };
    try {
      const data = loadMessages(match[1]);
      return { ok: true, json: async () => data };
    } catch {
      return { ok: false };
    }
  };
  const context = {
    Array,
    Date,
    Error,
    Map,
    Math,
    Number,
    Object,
    Promise,
    Set,
    WeakMap,
    String,
    URL,
    URLSearchParams,
    clearTimeout,
    document: {
      getElementById: id => elements.get(id),
      createElement: tag => {
        const element = new FakeElement();
        element.tagName = tag.toUpperCase();
        return element;
      },
      createElementNS: (_namespace, tag) => {
        const element = new FakeElement();
        element.tagName = tag.toUpperCase();
        return element;
      },
    },
    setTimeout,
    close: () => { closeCalls += 1; },
    fetch: fetchLocaleCatalog,
    browser: {
      runtime,
      i18n: createI18nMock('vi'),
      permissions: {
        request(details) { permissionCalls.push({ type: 'request', details }); return Promise.resolve(true); },
        remove(details) { permissionCalls.push({ type: 'remove', details }); return Promise.resolve(true); },
      },
    },
  };
  if (speechSupported) {
    context.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
    context.speechSynthesis = speechSynthesis;
  }
  context.globalThis = context;
  for (const element of elements.values()) element.ownerDocument = context.document;
  vm.createContext(context);
  vm.runInContext(sharedSource, context, { filename: 'shared.js' });
  vm.runInContext(popupSource, context, { filename: 'popup.js' });
  await new Promise(resolve => setImmediate(resolve));
  // A second tick covers applyCourseUiLocale()'s extra sendMessage -> fetch ->
  // json() microtask chain (07.5), which is one hop deeper than the plain
  // sendMessage-only boot calls the first tick already covers.
  await new Promise(resolve => setImmediate(resolve));
  return {
    elements,
    runtimeMessages,
    runtimeListeners,
    permissionCalls,
    resolveTranslate: value => resolveTranslate(value),
    resolveSelection: value => resolveSelection(value),
    resolveDeckResponse: () => resolveDeckResponse(),
    resolveDueResponse: () => resolveDueResponse(),
    speechSynthesis,
    fetchCalls,
    get closeCalls() { return closeCalls; },
  };
};

test('shows unassigned shortcuts explicitly and opens Chrome shortcut settings', async () => {
  const popup = await createPopupContext({ shortcuts: { saveShortcut: '', translateShortcut: '' } });

  assert.equal(popup.elements.get('save-shortcut-value').textContent, 'Chưa gán');
  assert.equal(popup.elements.get('translate-shortcut-value').textContent, 'Chưa gán');
  popup.elements.get('open-shortcuts').dispatch('click');
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(popup.runtimeMessages.some(message => message.type === 'OPEN_SHORTCUTS'));
});

test('does not overwrite user input when selection capture resolves late', async () => {
  const popup = await createPopupContext({ selectionPending: true });
  const input = popup.elements.get('selection');
  input.value = 'typed by user';
  input.dispatch('input');

  popup.resolveSelection({ ok: true, text: 'captured selection' });
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(input.value, 'typed by user');
  assert.equal(input.selectCalls, 0);
  assert.equal(input.focusCalls, 0);
});

test('does not steal focus when selection capture resolves after the user moves on', async () => {
  const popup = await createPopupContext({ selectionPending: true });
  const input = popup.elements.get('selection');
  const focusedButton = popup.elements.get('open-shortcuts');
  input.ownerDocument.activeElement = focusedButton;

  popup.resolveSelection({ ok: true, text: 'captured selection' });
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(input.value, 'captured selection');
  assert.equal(input.selectCalls, 0);
  assert.equal(input.focusCalls, 0);
  assert.equal(input.ownerDocument.activeElement, focusedButton);
});

test('explains when custom decks are not synchronized', async () => {
  const empty = await createPopupContext({ decks: [] });
  assert.match(empty.elements.get('deck-status').textContent, /chưa có deck/i);

  const unavailable = await createPopupContext({ deckLoadError: true });
  assert.match(unavailable.elements.get('deck-status').textContent, /mở SonFlash/i);
  assert.equal(unavailable.elements.get('requested-deck').disabled, true);
  assert.equal(unavailable.elements.get('add-button').disabled, false);

  const rejected = await createPopupContext({ deckResponseError: true });
  assert.match(rejected.elements.get('deck-status').textContent, /mở SonFlash/i);
});

test('hides Chrome shortcut settings on browsers that cannot open them', async () => {
  const popup = await createPopupContext({ shortcutSettingsAvailable: false });

  assert.equal(popup.elements.get('open-shortcuts').hidden, true);
});

test('popup keeps its designed width and reflows fallback layouts', () => {
  assert.match(popupCssSource, /body\s*\{[^}]*min-width:\s*380px/);
  assert.doesNotMatch(popupCssSource, /max-width:\s*100vw/);
  assert.match(popupCssSource, /max-width:\s*340px[\s\S]*\.config-grid[\s\S]*grid-template-columns:\s*1fr/);
  assert.match(popupCssSource, /max-width:\s*340px[\s\S]*\.actions[\s\S]*grid-template-columns:\s*1fr/);
  assert.match(popupCssSource, /textarea::placeholder\s*\{\s*color:\s*#94a3b8/);
  assert.match(popupCssSource, /\.result-example-translation\s*\{[^}]*color:\s*#94a3b8/);
});

test('uses the Canvas-sized popup shell and keeps support controls behind disclosure', () => {
  assert.match(popupHtmlSource, /<details class="popup-utilities">/);
  assert.match(popupHtmlSource, /class="brand-name">\s*<span>Son<\/span><em>Flash<\/em>/);
  assert.match(popupHtmlSource, /id="selection"[^>]*rows="2"/);
  assert.match(popupCssSource, /\.shell\s*\{[^}]*height:\s*640px/);
  assert.match(popupCssSource, /\[data-theme-family="crystal"\] body::before/);
  assert.match(popupCssSource, /\[data-theme-family="crystal"\] textarea::placeholder/);
  assert.match(popupCssSource, /\[data-theme-family="crystal"\]\[data-scheme="light"\] body/);
  assert.match(popupCssSource, /\[data-theme-family="crystal"\]\[data-scheme="light"\] textarea::placeholder/);
  assert.match(popupCssSource, /\.selection-field \.speak-button:disabled\s*\{\s*display:\s*none/);
  assert.match(popupCssSource, /\.result-card:not\(\[hidden\]\) ~ \.recent-lookups/);
});

test('keeps popup open and shows translation when inline rendering is unavailable', async () => {
  const popup = await createPopupContext();

  popup.elements.get('translate-button').dispatch('click');
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(popup.elements.get('status').textContent, 'Bản dịch: bền bỉ');
  assert.equal(popup.elements.get('status').dataset.tone, 'success');
  assert.equal(popup.elements.get('translate-button').disabled, false);
  assert.equal(popup.elements.get('add-button').disabled, false);
  assert.equal(popup.closeCalls, 0);
});

test('renders a quick translation result card with a save action', async () => {
  const popup = await createPopupContext();

  popup.elements.get('translate-button').dispatch('click');
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(popup.elements.get('result-card').hidden, false);
  assert.equal(popup.elements.get('result-word').textContent, 'resilient');
  assert.equal(popup.elements.get('result-translation').textContent, 'bền bỉ');
  assert.equal(popup.elements.get('result-save').hidden, false);
});

test('resets the result speaker state and accessible label when a new result replaces the old one', async () => {
  const popup = await createPopupContext();

  popup.elements.get('translate-button').dispatch('click');
  await new Promise(resolve => setImmediate(resolve));
  popup.elements.get('result-speak').dispatch('click');
  assert.equal(popup.elements.get('result-speak').dataset.speechState, 'playing');
  const oldUtterance = popup.speechSynthesis.spoken.at(-1);

  popup.elements.get('selection').value = 'bonjour';
  popup.elements.get('selection-form').dispatch('submit', { preventDefault() {} });
  await new Promise(resolve => setImmediate(resolve));
  popup.runtimeListeners[0]({
    type: 'QUICK_ADD_STATUS',
    payload: { id: 'job_123456789', status: 'created', inlineShown: false, text: 'bonjour', translation: 'xin chào', sourceLanguage: 'fr' },
  });

  assert.equal(popup.elements.get('result-speak').dataset.speechState, 'idle');
  assert.equal(popup.elements.get('result-speak').attributes['aria-label'], 'Nghe phát âm bonjour');
  oldUtterance?.onend?.();
  assert.equal(popup.elements.get('result-speak').dataset.speechState, 'idle');
  assert.equal(popup.elements.get('result-speak').attributes['aria-label'], 'Nghe phát âm bonjour');
});

test('saves the rendered result using the selected deck', async () => {
  const popup = await createPopupContext({ decks: ['Reading'] });

  popup.elements.get('translate-button').dispatch('click');
  await new Promise(resolve => setImmediate(resolve));
  popup.elements.get('requested-deck').value = 'Reading';
  popup.elements.get('result-save').dispatch('click');
  await new Promise(resolve => setImmediate(resolve));

  const saveMessage = popup.runtimeMessages.find(message => message.type === 'ADD_SELECTION');
  assert.equal(saveMessage?.text, 'resilient');
  assert.equal(saveMessage?.requestedDeck, 'Reading');
});

test('does not re-enable actions while a translation is still running', async () => {
  const popup = await createPopupContext({ translatePending: true });

  popup.elements.get('translate-button').dispatch('click');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(popup.elements.get('translate-button').disabled, true);
  assert.equal(popup.elements.get('add-button').disabled, true);

  popup.elements.get('selection').value = 'changed while busy';
  popup.elements.get('selection').dispatch('input');
  assert.equal(popup.elements.get('translate-button').disabled, true);
  assert.equal(popup.elements.get('add-button').disabled, true);

  popup.resolveTranslate({ ok: true, text: 'changed while busy', translation: 'đã đổi', inlineShown: false });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(popup.elements.get('translate-button').disabled, false);
  assert.equal(popup.elements.get('add-button').disabled, false);
});

test('does not auto-close after an inline translation succeeds', async () => {
  const popup = await createPopupContext({ translateInlineShown: true });

  popup.elements.get('translate-button').dispatch('click');
  await new Promise(resolve => setTimeout(resolve, 400));

  assert.equal(popup.closeCalls, 0);
});

test('keeps popup open for a quick-add completion that cannot render inline', async () => {
  const popup = await createPopupContext();

  popup.elements.get('selection-form').dispatch('submit', { preventDefault() {} });
  await new Promise(resolve => setImmediate(resolve));
  const listener = popup.runtimeListeners[0];
  assert.equal(typeof listener, 'function');
  listener({
    type: 'QUICK_ADD_STATUS',
    payload: { id: 'job_123456789', status: 'created', inlineShown: false, text: 'resilient' },
  });

  assert.match(popup.elements.get('status').textContent, /đã lưu|hiển thị/i);
  assert.equal(popup.closeCalls, 0);
});

test('renders AI details in the quick-add result card and uses its source locale', async () => {
  const popup = await createPopupContext();

  popup.elements.get('selection-form').dispatch('submit', { preventDefault() {} });
  await new Promise(resolve => setImmediate(resolve));
  popup.runtimeListeners[0]({
    type: 'QUICK_ADD_STATUS',
    payload: {
      id: 'job_123456789', status: 'created', inlineShown: false, text: 'bonjour',
      translation: 'xin chào', phonetic: '/bɔ̃.ʒuʁ/', explanation: 'Lời chào',
      exampleSentence: 'Bonjour, tout le monde.', exampleTranslation: 'Xin chào mọi người.', sourceLanguage: 'fr',
    },
  });

  assert.equal(popup.elements.get('result-phonetic').textContent, '/bɔ̃.ʒuʁ/');
  assert.equal(popup.elements.get('result-explanation').textContent, 'Lời chào');
  assert.equal(popup.elements.get('result-example').textContent, 'Ví dụ: Bonjour, tout le monde.');
  assert.equal(popup.elements.get('result-example-translation').textContent, 'Dịch ví dụ: Xin chào mọi người.');
  popup.elements.get('result-speak').dispatch('click');
  assert.equal(popup.speechSynthesis.spoken.at(-1)?.lang, 'fr-FR');
});

test('speaks the selected text only after a speaker button click', async () => {
  const popup = await createPopupContext();

  popup.elements.get('speak-selection').dispatch('click');
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(popup.speechSynthesis.cancelCalls, 1);
  assert.equal(popup.speechSynthesis.spoken[0]?.text, 'resilient');
  assert.equal(popup.speechSynthesis.spoken[0]?.rate, 0.88);
  assert.equal(popup.elements.get('speak-selection').dataset.speechState, 'playing');
  popup.speechSynthesis.spoken[0]?.onend?.();
  assert.equal(popup.elements.get('speak-selection').dataset.speechState, 'ended');
});

test('disables the selected-text speaker when Speech API is unavailable', async () => {
  const popup = await createPopupContext({ speechSupported: false });

  assert.equal(popup.elements.get('speak-selection').disabled, true);
  assert.equal(popup.elements.get('speech-support-status').hidden, false);
  assert.match(popup.elements.get('speech-support-status').textContent, /không hỗ trợ phát âm/i);
});

test('connects the speech support explanation to the button and keeps focus visible', () => {
  assert.match(popupHtmlSource, /id="speak-selection"[^>]*aria-describedby="speech-support-status"/);
  assert.match(popupHtmlSource, /id="result-speak"[^>]*aria-describedby="speech-support-status"/);
  assert.match(popupHtmlSource, /id="speech-support-status"[^>]*role="status"/);
  assert.match(popupCssSource, /\.speak-button:focus-visible/);
});

test('declares data-flow disclosure and reduced-motion support in the popup', () => {
  assert.match(popupHtmlSource, /Google Translate/);
  assert.match(popupHtmlSource, /SonFlash\/Gemini/);
  assert.match(popupHtmlSource, /chỉ hỗ trợ tiếng Anh/);
  assert.match(popupHtmlSource, /id="speak-selection"[\s\S]*<svg/);
  assert.match(popupHtmlSource, /id="result-close"[\s\S]*<svg/);
  assert.match(popupHtmlSource, /id="result-speak"[\s\S]*<svg/);
  assert.match(popupCssSource, /prefers-reduced-motion/);
});

test('renders recent lookups and can start a save from a translate row', async () => {
  const popup = await createPopupContext({
    recentItems: [{
      text: 'resilient', translation: 'bền bỉ', sourceLanguage: 'auto', targetLanguage: 'vi',
      kind: 'translate', status: 'translated', timestamp: Date.now(),
    }],
  });

  assert.equal(popup.elements.get('recent-lookups').hidden, false);
  assert.equal(popup.elements.get('recent-list').children.length, 1);
  const actions = popup.elements.get('recent-list').children[0].children[1];
  actions.children[1].dispatch('click');
  await new Promise(resolve => setImmediate(resolve));
  const saveMessage = popup.runtimeMessages.find(message => message.type === 'ADD_SELECTION');
  assert.equal(saveMessage?.type, 'ADD_SELECTION');
  assert.equal(saveMessage?.text, 'resilient');
});

test('renders custom decks with a shared-library default and sends the selected deck', async () => {
  const popup = await createPopupContext({ decks: ['Reading', 'IELTS'] });
  const select = popup.elements.get('requested-deck');
  assert.equal(select.value, '');
  assert.equal(select.children.length, 3);
  assert.equal(select.children[0].value, '');
  assert.equal(select.children[0].textContent, 'Thư viện chung');
  assert.equal(select.children[1].value, 'Reading');

  popup.elements.get('selection').value = 'resilient';
  select.value = 'IELTS';
  popup.elements.get('selection-form').dispatch('submit', { preventDefault() {} });
  await new Promise(resolve => setImmediate(resolve));
  const save = popup.runtimeMessages.find(message => message.type === 'ADD_SELECTION');
  assert.equal(save?.requestedDeck, 'IELTS');
});

test('clears recent lookup history from the popup', async () => {
  const popup = await createPopupContext({
    recentItems: [{
      text: 'resilient', translation: 'bền bỉ', sourceLanguage: 'auto', targetLanguage: 'vi',
      kind: 'translate', status: 'translated', timestamp: Date.now(),
    }],
  });
  popup.elements.get('clear-history').dispatch('click');
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(popup.runtimeMessages.some(message => message.type === 'CLEAR_RECENT_LOOKUPS'));
  assert.equal(popup.elements.get('recent-lookups').hidden, true);
  assert.equal(popup.elements.get('web-words-loop').hidden, true);
});

test('shows the web-words loop reminder only for saved (kind: create) lookups, not a translate-only one', async () => {
  const popup = await createPopupContext({
    recentItems: [
      { text: 'resilient', translation: 'bền bỉ', sourceLanguage: 'auto', targetLanguage: 'vi', kind: 'translate', status: 'translated', timestamp: Date.now() },
      { text: 'ephemeral', translation: 'thoáng qua', sourceLanguage: 'auto', targetLanguage: 'vi', kind: 'create', status: 'created', timestamp: Date.now() },
      { text: 'lucid', translation: 'sáng suốt', sourceLanguage: 'auto', targetLanguage: 'vi', kind: 'create', status: 'existing', timestamp: Date.now() },
    ],
  });

  assert.equal(popup.elements.get('web-words-loop').hidden, false);
  assert.match(popup.elements.get('web-words-loop-text').textContent, /2/);
});

test('hides the web-words loop reminder when there is nothing saved yet', async () => {
  const popup = await createPopupContext({
    recentItems: [{ text: 'resilient', translation: 'bền bỉ', sourceLanguage: 'auto', targetLanguage: 'vi', kind: 'translate', status: 'translated', timestamp: Date.now() }],
  });

  assert.equal(popup.elements.get('web-words-loop').hidden, true);
});

test('opens the app on the WebWords route from the loop reminder, reusing OPEN_APP with a target', async () => {
  const popup = await createPopupContext({
    recentItems: [{ text: 'ephemeral', translation: 'thoáng qua', sourceLanguage: 'auto', targetLanguage: 'vi', kind: 'create', status: 'created', timestamp: Date.now() }],
  });

  popup.elements.get('web-words-loop-action').dispatch('click');
  await new Promise(resolve => setImmediate(resolve));

  const openAppMessage = popup.runtimeMessages.find(message => message.type === 'OPEN_APP');
  assert.equal(openAppMessage?.target, 'webWords');
  assert.equal(popup.closeCalls, 1);
});

test('shows a real synced due count next to the library link, never a placeholder', async () => {
  const withCount = await createPopupContext({ dueCount: 12 });
  assert.ok(withCount.runtimeMessages.some(message => message.type === 'GET_DUE_COUNT'));
  assert.equal(withCount.elements.get('due-count-suffix').hidden, false);
  assert.equal(withCount.elements.get('due-count-suffix').textContent, '12 thẻ đến hạn');

  const withoutCount = await createPopupContext({ dueCount: null });
  assert.equal(withoutCount.elements.get('due-count-suffix').hidden, true);
  assert.equal(withoutCount.elements.get('due-count-suffix').textContent, '');
});

test('clears rendered deck, due-count, and course-locale metadata when the provider retires', async () => {
  const popup = await createPopupContext({
    decks: ['Owner A'],
    dueCount: 12,
    metadataGeneration: 1,
    deckScope: 'opaque_scope_deck_a_123456',
    dueScope: 'opaque_scope_due_a_123456',
    localeScope: 'opaque_scope_locale_a_123456',
    courseLocaleResponse: { ok: true, nativeLanguage: 'vi', targetLanguage: 'ko' },
  });
  assert.equal(popup.elements.get('requested-deck').children.some(child => child.textContent === 'Owner A'), true);
  assert.equal(popup.elements.get('due-count-suffix').hidden, false);
  assert.equal(popup.elements.get('target-language-label').hidden, false);

  popup.runtimeListeners[0]({
    type: 'LINGOFLASH_EXTENSION_METADATA_INVALIDATED',
    generation: 1,
    scopes: {
      deck: 'opaque_scope_deck_a_123456',
      due: 'opaque_scope_due_a_123456',
      locale: 'opaque_scope_locale_a_123456',
    },
  });

  assert.equal(popup.elements.get('requested-deck').children.length, 0);
  assert.equal(popup.elements.get('requested-deck').disabled, true);
  assert.equal(popup.elements.get('due-count-suffix').hidden, true);
  assert.equal(popup.elements.get('due-count-suffix').textContent, '');
  assert.equal(popup.elements.get('target-language-label').hidden, true);
  assert.equal(popup.elements.get('target-language-label').textContent, '');
});

test('ignores a late due-count response for a retired provider scope', async () => {
  const popup = await createPopupContext({
    dueCount: 12,
    dueResponsePending: true,
    metadataGeneration: 1,
    dueScope: 'opaque_scope_due_a_123456',
  });
  popup.runtimeListeners[0]({
    type: 'LINGOFLASH_EXTENSION_METADATA_INVALIDATED',
    generation: 1,
    scopes: { due: 'opaque_scope_due_a_123456' },
  });
  popup.resolveDueResponse();
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(popup.elements.get('due-count-suffix').hidden, true);
  assert.equal(popup.elements.get('due-count-suffix').textContent, '');
  assert.equal(popup.elements.get('open-app-label').textContent, 'Đăng nhập');
});

test('accepts a fresh same-generation due scope after the old scope retires', async () => {
  const popup = await createPopupContext({
    dueCount: 12,
    dueResponsePending: true,
    metadataGeneration: 1,
    dueScope: 'opaque_scope_due_b_123456',
  });
  popup.runtimeListeners[0]({
    type: 'LINGOFLASH_EXTENSION_METADATA_INVALIDATED',
    generation: 1,
    scopes: { due: 'opaque_scope_due_a_123456' },
  });
  popup.resolveDueResponse();
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(popup.elements.get('due-count-suffix').hidden, false);
  assert.equal(popup.elements.get('due-count-suffix').textContent, '12 thẻ đến hạn');
});

test('clicking the due-count badge opens the app on the session it is counting, not the plain library (07.6)', async () => {
  const withCount = await createPopupContext({ dueCount: 12 });
  withCount.elements.get('open-app').dispatch('click');
  await new Promise(resolve => setImmediate(resolve));

  const openAppMessage = withCount.runtimeMessages.find(message => message.type === 'OPEN_APP');
  assert.equal(openAppMessage?.target, 'today');
  assert.equal(withCount.closeCalls, 1);
});

test('opening the app without a synced due count keeps the existing library/sign-in destination unchanged (07.6)', async () => {
  const withoutCount = await createPopupContext({ dueCount: null });
  withoutCount.elements.get('open-app').dispatch('click');
  await new Promise(resolve => setImmediate(resolve));

  const openAppMessage = withoutCount.runtimeMessages.find(message => message.type === 'OPEN_APP');
  assert.equal(openAppMessage?.target, undefined);
  assert.equal(withoutCount.closeCalls, 1);
});

test('swaps the footer link label between signed-out and signed-in phrasing based on a resolved due count', async () => {
  const withCount = await createPopupContext({ dueCount: 12 });
  assert.equal(withCount.elements.get('open-app-label').textContent, 'Mở thư viện');

  const withoutCount = await createPopupContext({ dueCount: null });
  assert.equal(withoutCount.elements.get('open-app-label').textContent, 'Đăng nhập');
});

test('follows the active course native language for popup text once GET_COURSE_LOCALE resolves a different locale (07.5)', async () => {
  const popup = await createPopupContext({
    dueCount: 12,
    courseLocaleResponse: { ok: true, nativeLanguage: 'en', targetLanguage: 'ko' },
  });
  assert.ok(popup.runtimeMessages.some(message => message.type === 'GET_COURSE_LOCALE'));
  assert.ok(popup.fetchCalls.some(url => String(url).includes('_locales/en/messages.json')));

  const expectedEnglishText = loadMessages('en').dueCountBadge.message.replace('$COUNT$', '12');
  assert.equal(popup.elements.get('due-count-suffix').textContent, expectedEnglishText);
  assert.notEqual(popup.elements.get('due-count-suffix').textContent, '12 thẻ đến hạn');
  assert.equal(popup.elements.get('target-language-label').textContent, 'Korean');
  assert.equal(popup.elements.get('target-language-label').attributes['aria-label'], 'Target language: Korean');
});

test('shows the scoped target-language label only when a valid course locale is available', async () => {
  const synced = await createPopupContext({
    courseLocaleResponse: { ok: true, nativeLanguage: 'vi', targetLanguage: 'ja' },
  });
  assert.equal(synced.elements.get('target-language-label').hidden, false);
  assert.equal(synced.elements.get('target-language-label').textContent, 'Tiếng Nhật');

  const unavailable = await createPopupContext();
  assert.equal(unavailable.elements.get('target-language-label').hidden, true);
  assert.equal(unavailable.elements.get('target-language-label').textContent, '');

  const unknown = await createPopupContext({
    courseLocaleResponse: { ok: true, nativeLanguage: 'vi', targetLanguage: 'fr' },
  });
  assert.equal(unknown.elements.get('target-language-label').hidden, true);
});

test('never fetches a locale catalog when the synced course native language already matches the UI language (07.5)', async () => {
  const popup = await createPopupContext({
    dueCount: 12,
    courseLocaleResponse: { ok: true, nativeLanguage: 'vi', targetLanguage: 'ko' },
  });
  assert.ok(popup.runtimeMessages.some(message => message.type === 'GET_COURSE_LOCALE'));
  assert.equal(popup.fetchCalls.length, 0);
  assert.equal(popup.elements.get('due-count-suffix').textContent, '12 thẻ đến hạn');
});

test('keeps today\'s due-count text when no course locale has ever been synced (07.5)', async () => {
  const popup = await createPopupContext({ dueCount: 12 });
  assert.equal(popup.fetchCalls.length, 0);
  assert.equal(popup.elements.get('due-count-suffix').textContent, '12 thẻ đến hạn');
});

test('shows the loading state as a busy spinner while a quick-add runs, then a distinct saved badge', async () => {
  const popup = await createPopupContext();

  popup.elements.get('selection-form').dispatch('submit', { preventDefault() {} });
  // setBusy(true) and the busy status tone are applied synchronously, before
  // the first await inside runMode — this is the real "loading" state, not a
  // simulated one.
  assert.equal(popup.elements.get('status').dataset.tone, 'busy');
  await new Promise(resolve => setImmediate(resolve));

  popup.runtimeListeners[0]({
    type: 'QUICK_ADD_STATUS',
    payload: { id: 'job_123456789', status: 'created', inlineShown: true, text: 'resilient', translation: 'bền bỉ' },
  });

  assert.equal(popup.elements.get('status').dataset.tone, 'success');
  assert.equal(popup.elements.get('result-card').hidden, false);
  assert.equal(popup.elements.get('result-card').dataset.status, 'created');
  assert.equal(popup.elements.get('result-badge').textContent, 'ĐÃ LƯU FLASHCARD');
  assert.equal(popup.elements.get('state-card').hidden, true);
});

test('shows a distinct duplicate badge for a word that already existed, never the saved badge', async () => {
  const popup = await createPopupContext();

  popup.elements.get('selection-form').dispatch('submit', { preventDefault() {} });
  await new Promise(resolve => setImmediate(resolve));
  popup.runtimeListeners[0]({
    type: 'QUICK_ADD_STATUS',
    payload: { id: 'job_123456789', status: 'existing', inlineShown: true, text: 'resilient', translation: 'bền bỉ' },
  });

  assert.equal(popup.elements.get('result-card').dataset.status, 'existing');
  assert.equal(popup.elements.get('result-badge').textContent, 'ĐÃ CÓ TRONG THƯ VIỆN');
  assert.notEqual(popup.elements.get('result-badge').textContent, 'ĐÃ LƯU FLASHCARD');
});

test('shows a sign-in state card with a working sign-in action when auth is required', async () => {
  const popup = await createPopupContext();

  popup.elements.get('selection-form').dispatch('submit', { preventDefault() {} });
  await new Promise(resolve => setImmediate(resolve));
  popup.runtimeListeners[0]({
    type: 'QUICK_ADD_STATUS',
    payload: { id: 'job_123456789', status: 'auth-required', inlineShown: false, text: 'resilient' },
  });

  const card = popup.elements.get('state-card');
  assert.equal(card.hidden, false);
  assert.equal(card.dataset.state, 'sign-in');
  assert.equal(popup.elements.get('state-title').textContent, 'Chưa đăng nhập SonFlash');
  assert.equal(popup.elements.get('result-card').hidden, true);

  const [action] = popup.elements.get('state-actions').children;
  assert.equal(action.textContent, 'Đăng nhập SonFlash');
  action.dispatch('click');
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(popup.runtimeMessages.some(message => message.type === 'OPEN_APP'));
  assert.equal(popup.closeCalls, 1);
});

test('classifies an AI-quota error message as the quota state, distinct from a generic error, with no retry action', async () => {
  const popup = await createPopupContext();

  popup.elements.get('selection-form').dispatch('submit', { preventDefault() {} });
  await new Promise(resolve => setImmediate(resolve));
  popup.runtimeListeners[0]({
    type: 'QUICK_ADD_STATUS',
    payload: {
      id: 'job_123456789', status: 'error', inlineShown: false, text: 'resilient',
      message: 'Dịch vụ AI đã hết hạn mức. Từ đã chọn vẫn được giữ lại; hãy thử lại sau.',
    },
  });

  const card = popup.elements.get('state-card');
  assert.equal(card.dataset.state, 'quota');
  assert.equal(popup.elements.get('state-title').textContent, 'Hết lượt AI hôm nay');
  assert.equal(popup.elements.get('state-note').hidden, false);
  assert.match(popup.elements.get('state-note').textContent, /Dịch nhanh vẫn miễn phí/);
  const [action] = popup.elements.get('state-actions').children;
  assert.equal(action.textContent, 'Mở SonFlash · Nâng cấp Pro');
});

test('shows a generic error state card whose retry action resends RETRY_QUICK_ADD and applies the retried result', async () => {
  const popup = await createPopupContext({
    retryQuickAddResponse: { ok: true, id: 'job_retry_1', text: 'resilient' },
  });

  popup.elements.get('selection-form').dispatch('submit', { preventDefault() {} });
  await new Promise(resolve => setImmediate(resolve));
  popup.runtimeListeners[0]({
    type: 'QUICK_ADD_STATUS',
    payload: { id: 'job_123456789', status: 'error', inlineShown: false, text: 'resilient', message: 'Không thể kết nối tới AI.' },
  });

  const card = popup.elements.get('state-card');
  assert.equal(card.dataset.state, 'error');
  assert.equal(popup.elements.get('state-title').textContent, 'Không thể tạo hoặc lưu flashcard này');
  const [retryButton] = popup.elements.get('state-actions').children;
  assert.equal(retryButton.textContent, 'Thử lại');

  retryButton.dispatch('click');
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(popup.runtimeMessages.some(message => message.type === 'RETRY_QUICK_ADD' && message.id === 'job_123456789'));

  popup.runtimeListeners[0]({
    type: 'QUICK_ADD_STATUS',
    payload: { id: 'job_retry_1', status: 'created', inlineShown: true, text: 'resilient', translation: 'bền bỉ' },
  });
  assert.equal(popup.elements.get('result-card').dataset.status, 'created');
  assert.equal(popup.elements.get('state-card').hidden, true);
});

test('marks the floating icon toggle unavailable on a protected page instead of a generic error tone', async () => {
  const popup = await createPopupContext({
    activeSite: { ok: true, pattern: '', protected: true, enabled: false },
  });

  assert.equal(popup.elements.get('selection-icon-toggle').disabled, true);
  assert.equal(popup.elements.get('selection-icon-toggle').textContent, 'Không khả dụng');
  assert.equal(popup.elements.get('selection-icon-status').dataset.tone, 'unavailable');
});
