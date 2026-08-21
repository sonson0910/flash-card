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

const createBridgeContext = async ({ promiseApi = false, response = { ok: true, verified: true }, fallbackMode = null, protocolV3 = false } = {}) => {
  const calls = [];
  const messages = createEventTarget();
  const storageValues = new Map();
  let fakeNow = 0;
  const dateApi = fallbackMode
    ? { now: () => { fakeNow += 1_000; return fakeNow; } }
    : Date;
  const timerApi = fallbackMode
    ? callback => globalThis.setTimeout(callback, 0)
    : setTimeout;
  const createdAt = Date.UTC(2026, 7, 19, 8, 0, 0);
  const ticket = 'ticket_123456789';
  let currentUrl = `https://encoded-hangout-433912-h2.web.app/?view=library#lf-import=${encodePayload(protocolV3 ? {
    v: 3, ticket, mode: 'silent',
  } : {
    v: 2, id: 'job_123456789', text: 'resilient', createdAt, mode: 'silent',
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
  let fallbackInput;
  let fallbackForm;
  let fallbackSubmit;
  class FakeHTMLInputElement {
    constructor() {
      this._value = '';
      this.disabled = false;
    }

    closest(selector) {
      return (fallbackMode === 'stable' && selector === '[data-extension-target="card-create-form"]')
        || (fallbackMode === 'legacy' && selector === 'form')
        ? fallbackForm
        : null;
    }

    dispatchEvent() {}
  }
  Object.defineProperty(FakeHTMLInputElement.prototype, 'value', {
    configurable: true,
    get() { return this._value; },
    set(value) { this._value = String(value); },
  });
  class FakeHTMLFormElement {
    querySelector(selector) {
      return (fallbackMode === 'stable' && selector === '[data-extension-target="word-submit"]')
        || (fallbackMode === 'legacy' && selector === 'button[type="submit"]')
        ? fallbackSubmit
        : null;
    }

    requestSubmit() {
      fallbackInput.value = '';
    }
  }
  class FakeHTMLButtonElement {
    constructor() {
      this.disabled = false;
    }
  }
  if (fallbackMode) {
    fallbackInput = new FakeHTMLInputElement();
    fallbackForm = new FakeHTMLFormElement();
    fallbackSubmit = new FakeHTMLButtonElement();
  }
  const document = {
    readyState: fallbackMode ? 'complete' : 'loading',
    addEventListener: (...args) => messages.addEventListener(...args),
    querySelector: selector => {
      if (fallbackMode === 'stable' && selector === '[data-extension-target="word-input"]') return fallbackInput;
      if (fallbackMode === 'legacy' && selector === '#new-word') return fallbackInput;
      return null;
    },
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
  const context = {
    Array,
    ArrayBuffer,
    atob,
    btoa,
    Date: dateApi,
    Error,
    Event,
    HTMLButtonElement: FakeHTMLButtonElement,
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
    setTimeout: timerApi,
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

test('verifies a v3 opaque ticket and stores the resolved job intent', async () => {
  const bridge = await createBridgeContext({
    protocolV3: true,
    response: {
      ok: true,
      verified: true,
      intent: {
        v: 3,
        id: 'job_123456789',
        text: 'resilient',
        createdAt: Date.UTC(2026, 7, 19, 8, 0, 0),
        mode: 'silent',
        ticket: 'ticket_123456789',
      },
    },
  });
  const verification = bridge.calls.find(call => call.type === 'runtime.sendMessage');
  assert.equal(verification.args[0].payload.v, 3);
  assert.equal(verification.args[0].payload.ticket, 'ticket_123456789');
  assert.equal('text' in verification.args[0].payload, false);
  assert.match(bridge.storageValues.get('lingoflash_browser_extension_import'), /resilient/);
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

test('uses stable data selectors for the library fallback form', async () => {
  const bridge = await createBridgeContext({ fallbackMode: 'stable' });
  await new Promise(resolve => setTimeout(resolve, 30));
  const result = bridge.calls.find(call => call.type === 'runtime.sendMessage' && call.args[0]?.type === 'APP_IMPORT_RESULT');
  assert.ok(result);
  assert.equal(result.args[0].payload.status, 'created');
});

test('keeps the legacy selectors working for older app markup', async () => {
  const bridge = await createBridgeContext({ fallbackMode: 'legacy' });
  await new Promise(resolve => setTimeout(resolve, 30));
  const result = bridge.calls.find(call => call.type === 'runtime.sendMessage' && call.args[0]?.type === 'APP_IMPORT_RESULT');
  assert.ok(result);
  assert.equal(result.args[0].payload.status, 'created');
});
