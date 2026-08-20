import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const bridgeSource = await readFile(new URL('../app-bridge.js', import.meta.url), 'utf8');

const encodePayload = value => {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = '';
  bytes.forEach(byte => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
};

const createEventTarget = () => {
  const listeners = new Map();
  return {
    addEventListener(type, listener) {
      const current = listeners.get(type) ?? [];
      current.push(listener);
      listeners.set(type, current);
    },
    removeEventListener(type, listener) {
      listeners.set(type, (listeners.get(type) ?? []).filter(candidate => candidate !== listener));
    },
    dispatch(type, event = {}) {
      for (const listener of listeners.get(type) ?? []) listener(event);
    },
  };
};

const createBridgeContext = async ({ promiseApi = false, response = { ok: true, verified: true } } = {}) => {
  const calls = [];
  const messages = createEventTarget();
  const storageValues = new Map();
  let currentUrl = `https://encoded-hangout-433912-h2.web.app/?view=library#lf-import=${encodePayload({
    v: 1,
    id: 'job_123456789',
    text: 'resilient',
    createdAt: Date.UTC(2026, 7, 19, 8, 0, 0),
    mode: 'silent',
  })}`;
  const location = {
    get href() { return currentUrl; },
    get hash() { return new URL(currentUrl).hash; },
    origin: 'https://encoded-hangout-433912-h2.web.app',
  };
  const history = {
    state: null,
    replaceState(_state, _title, value) {
      calls.push({ type: 'history.replaceState', value });
      currentUrl = new URL(value, location.origin).toString();
    },
  };
  const document = {
    readyState: 'loading',
    addEventListener: (...args) => messages.addEventListener(...args),
    querySelector: () => null,
  };
  const sessionStorage = {
    getItem: key => storageValues.get(key) ?? null,
    setItem: (key, value) => storageValues.set(key, value),
    removeItem: key => storageValues.delete(key),
  };
  const runtime = promiseApi
    ? {
        sendMessage: (...args) => {
          calls.push({ type: 'runtime.sendMessage', args });
          return Promise.resolve(response);
        },
      }
    : {
        sendMessage: (message, callback) => {
          calls.push({ type: 'runtime.sendMessage', args: [message, callback] });
          callback(response);
        },
      };
  class FakeHTMLInputElement {}
  class FakeHTMLFormElement {}
  const context = {
    Array,
    ArrayBuffer,
    atob,
    btoa,
    Date,
    Error,
    Event,
    HTMLFormElement: FakeHTMLFormElement,
    HTMLInputElement: FakeHTMLInputElement,
    JSON,
    Map,
    Math,
    Number,
    Object,
    Promise,
    Set,
    String,
    TextDecoder,
    TextEncoder,
    Uint8Array,
    URL,
    URLSearchParams,
    clearTimeout,
    document,
    history,
    location,
    sessionStorage,
    setTimeout,
    chrome: promiseApi ? undefined : { runtime },
    browser: promiseApi ? { runtime } : undefined,
    postMessage: (message, targetOrigin) => calls.push({ type: 'window.postMessage', message, targetOrigin }),
    addEventListener: messages.addEventListener,
    removeEventListener: messages.removeEventListener,
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(bridgeSource, context, { filename: 'app-bridge.js' });
  await new Promise(resolve => setImmediate(resolve));
  return { calls, context, currentUrl: () => currentUrl, storageValues };
};

test('verifies the captured hash before writing pending storage and notifying the app', async () => {
  const bridge = await createBridgeContext();
  const verification = bridge.calls.find(call => call.type === 'runtime.sendMessage');
  assert.ok(verification);
  assert.equal(verification.args[0].type, 'VERIFY_IMPORT_INTENT');
  assert.equal(verification.args[0].payload.text, 'resilient');
  assert.equal(bridge.currentUrl(), 'https://encoded-hangout-433912-h2.web.app/?view=library');
  assert.match(bridge.storageValues.get('lingoflash_browser_extension_import'), /resilient/);
  const ready = bridge.calls.find(call => call.type === 'window.postMessage');
  assert.equal(ready.message.type, 'LINGOFLASH_EXTENSION_IMPORT_READY');
});

test('removes a forged hash without forwarding it to the app', async () => {
  const bridge = await createBridgeContext({ response: { ok: true, verified: false } });
  assert.equal(bridge.currentUrl(), 'https://encoded-hangout-433912-h2.web.app/?view=library');
  assert.equal(bridge.storageValues.has('lingoflash_browser_extension_import'), false);
  assert.equal(bridge.calls.some(call => call.type === 'window.postMessage'), false);
});

test('uses the Promise browser API without passing a callback', async () => {
  const bridge = await createBridgeContext({ promiseApi: true });
  const verification = bridge.calls.find(call => call.type === 'runtime.sendMessage');
  assert.ok(verification);
  assert.equal(verification.args.length, 1);
});
