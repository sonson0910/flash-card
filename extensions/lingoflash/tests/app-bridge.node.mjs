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

const createBridgeContext = async ({
  promiseApi = false,
  response = { ok: true, verified: true },
  encodedImport = null,
  atobImpl = atob,
  topFrame = true,
} = {}) => {
  const calls = [];
  const messages = createEventTarget();
  const storageValues = new Map();
  const encoded = encodedImport ?? encodePayload({
    v: 3,
    id: 'job_123456789',
    nonce: 'nonce_123456789012345678',
    text: 'resilient',
    createdAt: Date.UTC(2026, 7, 19, 8, 0, 0),
    mode: 'silent',
  });
  let currentUrl = `https://encoded-hangout-433912-h2.web.app/?view=library#lf-import=${encoded}`;
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
    atob: atobImpl,
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
    dispatchEvent: event => messages.dispatch(event.type, event),
    self: null,
    top: null,
  };
  context.self = topFrame ? context : {};
  context.top = topFrame ? context : {};
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(bridgeSource, context, { filename: 'app-bridge.js' });
  vm.runInContext("globalThis.__dispatchMessage = data => globalThis.dispatchEvent('message', { source: globalThis, origin: globalThis.location.origin, data });", context);
  await new Promise(resolve => setImmediate(resolve));
  return { calls, context, currentUrl: () => currentUrl, storageValues, dispatch: data => context.__dispatchMessage(data) };
};

test('verifies the captured hash before writing pending storage and notifying the app', async () => {
  const bridge = await createBridgeContext();
  const verification = bridge.calls.find(call => call.type === 'runtime.sendMessage');
  assert.ok(verification);
  assert.equal(verification.args[0].type, 'VERIFY_IMPORT_INTENT');
  assert.equal(verification.args[0].payload.text, 'resilient');
  assert.equal(verification.args[0].payload.nonce, 'nonce_123456789012345678');
  assert.equal(bridge.currentUrl(), 'https://encoded-hangout-433912-h2.web.app/?view=library');
  assert.match(bridge.storageValues.get('lingoflash_browser_extension_import'), /resilient/);
  const ready = bridge.calls.find(call => call.type === 'window.postMessage');
  assert.equal(ready.message.type, 'LINGOFLASH_EXTENSION_IMPORT_READY');
});

test('removes a forged hash and forwards it only as a draft-only intent', async () => {
  const bridge = await createBridgeContext({ response: { ok: true, verified: false } });
  assert.equal(bridge.currentUrl(), 'https://encoded-hangout-433912-h2.web.app/?view=library');
  assert.equal(bridge.storageValues.has('lingoflash_browser_extension_import'), false);
  assert.match(bridge.storageValues.get('lingoflash_browser_extension_draft_import'), /resilient/);
  const unverified = bridge.calls.find(call => call.type === 'window.postMessage');
  assert.equal(unverified.message.type, 'LINGOFLASH_EXTENSION_IMPORT_UNVERIFIED');
  assert.equal(unverified.message.payload.text, 'resilient');
});

test('uses the Promise browser API without passing a callback', async () => {
  const bridge = await createBridgeContext({ promiseApi: true });
  const verification = bridge.calls.find(call => call.type === 'runtime.sendMessage');
  assert.ok(verification);
  assert.equal(verification.args.length, 1);
});

test('rejects oversized encoded imports before invoking atob', async () => {
  let calls = 0;
  const bridge = await createBridgeContext({
    encodedImport: 'a'.repeat(2049),
    atobImpl: value => { calls += 1; return atob(value); },
  });
  assert.equal(calls, 0);
  assert.equal(bridge.calls.some(call => call.type === 'runtime.sendMessage'), false);
});

test('does not persist an intent when verification returns a mismatched nonce', async () => {
  const bridge = await createBridgeContext({
    response: {
      ok: true,
      verified: true,
      intent: {
        v: 3,
        id: 'job_123456789',
        nonce: 'nonce_wrong_123456789012345678',
        text: 'resilient',
        createdAt: Date.UTC(2026, 7, 19, 8, 0, 0),
        mode: 'silent',
      },
    },
  });
  assert.equal(bridge.storageValues.has('lingoflash_browser_extension_import'), false);
  assert.match(bridge.storageValues.get('lingoflash_browser_extension_draft_import'), /resilient/);
});

test('does not let a legacy v2 silent hash enter either verification or fallback', async () => {
  const bridge = await createBridgeContext({
    encodedImport: encodePayload({
      v: 2,
      id: 'legacy_silent_123',
      nonce: 'nonce_123456789012345678',
      text: 'legacy',
      createdAt: Date.UTC(2026, 7, 19, 8, 0, 0),
      mode: 'silent',
    }),
  });
  assert.equal(bridge.calls.some(call => call.type === 'runtime.sendMessage'), false);
  assert.equal(bridge.storageValues.size, 0);
});

test('routes a valid legacy v2 non-silent hash only to the draft channel', async () => {
  const bridge = await createBridgeContext({
    encodedImport: encodePayload({
      v: 2,
      id: 'legacy_draft_123',
      text: 'legacy',
      createdAt: Date.UTC(2026, 7, 19, 8, 0, 0),
    }),
  });
  assert.equal(bridge.calls.some(call => call.type === 'runtime.sendMessage'), false);
  assert.equal(bridge.storageValues.has('lingoflash_browser_extension_import'), false);
  assert.match(bridge.storageValues.get('lingoflash_browser_extension_draft_import'), /legacy/);
  const unverified = bridge.calls.find(call => call.type === 'window.postMessage');
  assert.equal(unverified.message.type, 'LINGOFLASH_EXTENSION_IMPORT_UNVERIFIED');
  assert.equal(unverified.message.payload.v, 2);
  assert.equal(unverified.message.payload.mode, undefined);
  assert.equal(bridge.calls.some(call => call.type === 'runtime.sendMessage'
    && call.args[0].type === 'APP_IMPORT_RESULT'), false);
});

test('does not process imports from a subframe', async () => {
  const bridge = await createBridgeContext({ topFrame: false });
  assert.equal(bridge.calls.some(call => call.type === 'runtime.sendMessage'), false);
  assert.equal(bridge.storageValues.size, 0);
});
