import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const sharedSource = await readFile(new URL('../shared.js', import.meta.url), 'utf8');
const popupSource = await readFile(new URL('../popup.js', import.meta.url), 'utf8');

class FakeElement {
  constructor() {
    this.value = '';
    this.textContent = '';
    this.disabled = false;
    this.dataset = {};
    this.listeners = new Map();
  }

  addEventListener(type, listener) {
    const current = this.listeners.get(type) ?? [];
    current.push(listener);
    this.listeners.set(type, current);
  }

  dispatch(type, event = {}) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }

  select() {}

  focus() {}
}

const createPopupContext = async () => {
  const ids = [
    'selection', 'character-count', 'translate-button', 'add-button', 'status',
    'save-shortcut-value', 'translate-shortcut-value', 'selection-form', 'open-app', 'open-options',
  ];
  const elements = new Map(ids.map(id => [id, new FakeElement()]));
  const runtimeMessages = [];
  const runtimeListeners = [];
  let closeCalls = 0;
  const runtime = {
    sendMessage(message) {
      runtimeMessages.push(message);
      if (message.type === 'GET_SELECTION') return Promise.resolve({ ok: true, text: 'resilient' });
      if (message.type === 'GET_SHORTCUTS') return Promise.resolve({ ok: true });
      if (message.type === 'TRANSLATE_SELECTION') {
        return Promise.resolve({ ok: true, text: 'resilient', translation: 'bền bỉ', inlineShown: false });
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
    String,
    URL,
    URLSearchParams,
    clearTimeout,
    document: {
      getElementById: id => elements.get(id),
    },
    setTimeout,
    close: () => { closeCalls += 1; },
    browser: { runtime },
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(sharedSource, context, { filename: 'shared.js' });
  vm.runInContext(popupSource, context, { filename: 'popup.js' });
  await new Promise(resolve => setImmediate(resolve));
  return {
    elements,
    runtimeMessages,
    runtimeListeners,
    get closeCalls() { return closeCalls; },
  };
};

test('keeps popup open and shows translation when inline rendering is unavailable', async () => {
  const popup = await createPopupContext();

  popup.elements.get('translate-button').dispatch('click');
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(popup.elements.get('status').textContent, 'Bản dịch: bền bỉ');
  assert.equal(popup.elements.get('status').dataset.tone, 'success');
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
