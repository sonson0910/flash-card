import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const sharedSource = await readFile(new URL('../shared.js', import.meta.url), 'utf8');
const popupSource = await readFile(new URL('../popup.js', import.meta.url), 'utf8');
const popupHtmlSource = await readFile(new URL('../popup.html', import.meta.url), 'utf8');
const popupCssSource = await readFile(new URL('../popup.css', import.meta.url), 'utf8');

test('selection permission failure rolls back the newly granted origin', () => {
  assert.match(popupSource, /permissions.*request|request.*permissions/s);
  assert.match(popupSource, /permissions.*remove|remove.*permissions/s);
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

  select() {}

  focus() {}

  setAttribute(name, value) { this.attributes[name] = String(value); }

  append(...children) { this.children.push(...children); }

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
} = {}) => {
  const ids = [
    'selection', 'requested-deck', 'character-count', 'translate-button', 'add-button', 'speak-selection', 'speech-support-status', 'status',
    'save-shortcut-value', 'translate-shortcut-value', 'selection-form', 'open-app',
    'recent-lookups', 'recent-list', 'clear-history', 'selection-icon-toggle', 'selection-icon-status',
    'result-card', 'result-badge', 'result-close', 'result-word', 'result-translation', 'result-details',
    'result-phonetic', 'result-explanation', 'result-example', 'result-example-translation', 'result-actions', 'result-speak', 'result-save',
  ];
  const elements = new Map(ids.map(id => [id, new FakeElement()]));
  const runtimeMessages = [];
  const runtimeListeners = [];
  const permissionCalls = [];
  let resolveTranslate = () => undefined;
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
      if (message.type === 'GET_SELECTION') return Promise.resolve({ ok: true, text: 'resilient' });
      if (message.type === 'GET_SHORTCUTS') return Promise.resolve({ ok: true });
      if (message.type === 'GET_ACTIVE_SITE') return Promise.resolve(activeSite ?? { ok: true });
      if (message.type === 'ENABLE_SELECTION_ICON_SITE') return Promise.resolve(enableSelectionResponse);
      if (message.type === 'GET_RECENT_LOOKUPS') return Promise.resolve({ ok: true, items: recentItems });
      if (message.type === 'GET_DECKS') return Promise.resolve({ ok: true, decks });
      if (message.type === 'TRANSLATE_SELECTION') {
        if (translatePending) return new Promise(resolve => { resolveTranslate = resolve; });
        return Promise.resolve({ ok: true, text: 'resilient', translation: 'bền bỉ', inlineShown: translateInlineShown });
      }
      if (message.type === 'ADD_SELECTION') {
        return Promise.resolve({ ok: true, id: 'job_123456789', text: 'resilient' });
      }
      return Promise.resolve({ ok: true });
    },
    onMessage: {
      addListener(listener) { runtimeListeners.push(listener); },
    },
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
    browser: {
      runtime,
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
  vm.createContext(context);
  vm.runInContext(sharedSource, context, { filename: 'shared.js' });
  vm.runInContext(popupSource, context, { filename: 'popup.js' });
  await new Promise(resolve => setImmediate(resolve));
  return {
    elements,
    runtimeMessages,
    runtimeListeners,
    permissionCalls,
    resolveTranslate: value => resolveTranslate(value),
    speechSynthesis,
    get closeCalls() { return closeCalls; },
  };
};

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
  assert.match(popupHtmlSource, /LingoFlash\/Gemini/);
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
});
