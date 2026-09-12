import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const bridgeSource = await readFile(new URL('../app-bridge.js', import.meta.url), 'utf8');

test('keeps compatibility fallback open through the two-attempt AI budget', () => {
  const match = bridgeSource.match(/const FALLBACK_GENERATION_TIMEOUT_MS = ([\d_]+);/);
  assert.ok(match);
  const timeoutMs = Number(match[1].replaceAll('_', ''));
  assert.ok(timeoutMs >= 135_000);
  assert.ok(timeoutMs - 1 < 135_000);
});

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
  fallbackMode = null,
  initialIntent,
  storageError = false,
  storageReadError = false,
  storageRemoveError = false,
  storageGetterError = false,
  runtimeCapability = null,
} = {}) => {
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
  const nonce = 'nonce_1234567890123456789012';
  let currentUrl = `https://encoded-hangout-433912-h2.web.app/?view=library#lf-import=${encodePayload(initialIntent ?? {
    v: 3, id: 'job_123456789', nonce, text: 'resilient', createdAt, mode: 'silent',
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
  let fallbackSubmitted = false;
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
      fallbackSubmitted = true;
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
      if (selector === 'meta[name="sonflash-import-runtime"]' && runtimeCapability) return { getAttribute: () => runtimeCapability };
      if (fallbackMode === 'stable' && selector === '[data-extension-target="word-input"]') return fallbackInput;
      if (fallbackMode === 'legacy' && selector === '#new-word') return fallbackInput;
      return null;
    },
  };
  const sessionStorage = {
    getItem: key => { if (storageReadError) throw new Error('read denied'); return storageValues.get(key) ?? null; },
    setItem: (key, value) => { if (storageError) throw new Error('quota'); storageValues.set(key, value); },
    removeItem: key => { if (storageRemoveError) throw new Error('remove denied'); return storageValues.delete(key); },
  };
  const runtime = promiseApi
    ? {
        sendMessage: (...args) => {
          calls.push({ type: 'runtime.sendMessage', args });
          return Promise.resolve(args[0]?.type === 'GET_DECK_METADATA_GENERATION' ? { ok: true, generation: 'generation_123456789' } : response);
        },
      }
    : {
        sendMessage: (message, callback) => {
          calls.push({ type: 'runtime.sendMessage', args: [message, callback] });
          callback(message.type === 'GET_DECK_METADATA_GENERATION' ? { ok: true, generation: 'generation_123456789' } : response);
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
    get sessionStorage() { if (storageGetterError) throw new Error('access denied'); return sessionStorage; },
    setTimeout: timerApi,
    chrome: promiseApi ? undefined : { runtime },
    browser: promiseApi ? { runtime } : undefined,
    postMessage: (message, targetOrigin) => calls.push({ type: 'window.postMessage', message, targetOrigin }),
    addEventListener: messages.addEventListener,
    removeEventListener: messages.removeEventListener,
  };
  context.globalThis = context;
  context.top = context;
  context.self = context;
  vm.createContext(context);
  vm.runInContext(bridgeSource, context, { filename: 'app-bridge.js' });
  await new Promise(resolve => setImmediate(resolve));
  const bridgeGlobal = vm.runInContext('globalThis', context);
  return {
    calls,
    context,
    bridgeGlobal,
    currentUrl: () => currentUrl,
    storageValues,
    wasFallbackSubmitted: () => fallbackSubmitted,
    dispatchMessage: event => messages.dispatch('message', event),
  };
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

test('verifies a nonce-bound v3 handoff and stores the resolved structured intent', async () => {
  const bridge = await createBridgeContext({
    response: {
      ok: true,
      verified: true,
      intent: {
        v: 3,
        id: 'job_123456789',
        nonce: 'nonce_1234567890123456789012',
        text: 'resilient',
        context: 'The resilient team recovered quickly.',
        requestedDeck: 'Reading',
        createdAt: Date.UTC(2026, 7, 19, 8, 0, 0),
        mode: 'silent',
      },
    },
  });
  const verification = bridge.calls.find(call => call.type === 'runtime.sendMessage');
  assert.equal(verification.args[0].payload.v, 3);
  assert.equal(verification.args[0].payload.nonce, 'nonce_1234567890123456789012');
  assert.equal(verification.args[0].payload.text, 'resilient');
  const stored = bridge.storageValues.get('lingoflash_browser_extension_import');
  assert.match(stored, /resilient/);
  assert.match(stored, /The resilient team recovered quickly/);
  assert.match(stored, /Reading/);
});

test('relays deck metadata only from same-origin app messages', async () => {
  const bridge = await createBridgeContext({ response: { ok: true, verified: false } });
  bridge.dispatchMessage({
    source: bridge.bridgeGlobal,
    origin: 'https://encoded-hangout-433912-h2.web.app',
    data: {
      source: 'lingoflash-web-app',
      type: 'LINGOFLASH_EXTENSION_DECK_METADATA',
      payload: { scope: 'opaque_scope_123456', decks: ['Reading'] },
    },
  });
  bridge.dispatchMessage({
    source: bridge.bridgeGlobal,
    origin: 'https://encoded-hangout-433912-h2.web.app',
    data: {
      source: 'evil',
      type: 'LINGOFLASH_EXTENSION_DECK_METADATA',
      payload: { scope: 'evil_scope_123456', decks: ['Injected'] },
    },
  });
  await new Promise(resolve => setImmediate(resolve));
  const relayed = bridge.calls.filter(call => call.type === 'runtime.sendMessage')
    .map(call => call.args[0])
    .find(message => message.type === 'SYNC_DECK_METADATA');
  assert.deepEqual(JSON.parse(JSON.stringify(relayed.payload)), { scope: 'opaque_scope_123456', decks: ['Reading'], generation: 'generation_123456789' });
  assert.equal(bridge.calls.filter(call => call.type === 'runtime.sendMessage'
    && call.args[0].type === 'SYNC_DECK_METADATA').length, 1);
});

test('relays deck metadata clear messages through the runtime', async () => {
  const bridge = await createBridgeContext({ response: { ok: true, verified: false } });
  bridge.dispatchMessage({
    source: bridge.bridgeGlobal,
    origin: 'https://encoded-hangout-433912-h2.web.app',
    data: { source: 'lingoflash-web-app', type: 'LINGOFLASH_EXTENSION_DECK_METADATA', payload: { scope: 'opaque_scope_123456', decks: ['Reading'] } },
  });
  await new Promise(resolve => setImmediate(resolve));
  bridge.dispatchMessage({
    source: bridge.bridgeGlobal,
    origin: 'https://encoded-hangout-433912-h2.web.app',
    data: {
      source: 'lingoflash-web-app',
      type: 'LINGOFLASH_EXTENSION_DECK_METADATA_CLEAR',
      payload: { scope: 'opaque_scope_123456' },
    },
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(bridge.calls.some(call => call.type === 'runtime.sendMessage'
    && call.args[0].type === 'CLEAR_DECK_METADATA'));
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

test('forwards a legacy v2 draft without treating it as a verified silent import', async () => {
  const bridge = await createBridgeContext({
    initialIntent: {
      v: 2,
      id: 'draft_123456789',
      text: 'legacy draft',
      createdAt: Date.UTC(2026, 7, 19, 8, 0, 0),
    },
  });

  assert.equal(bridge.currentUrl(), 'https://encoded-hangout-433912-h2.web.app/?view=library');
  assert.equal(bridge.calls.some(call => call.type === 'runtime.sendMessage'), false);
  assert.equal(bridge.storageValues.has('lingoflash_browser_extension_import'), false);
  assert.match(bridge.storageValues.get('lingoflash_browser_extension_draft_import'), /legacy draft/);
  const unverified = bridge.calls.find(call => call.type === 'window.postMessage');
  assert.equal(unverified.message.type, 'LINGOFLASH_EXTENSION_IMPORT_UNVERIFIED');
  assert.equal(unverified.message.payload.v, 2);
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

test('does not use the compatibility fallback when a verified v3 intent requests a deck', async () => {
  const bridge = await createBridgeContext({
    fallbackMode: 'stable',
    response: {
      ok: true,
      verified: true,
      intent: {
        v: 3,
        id: 'job_123456789',
        nonce: 'nonce_1234567890123456789012',
        text: 'resilient',
        requestedDeck: 'Reading',
        createdAt: Date.UTC(2026, 7, 19, 8, 0, 0),
        mode: 'silent',
      },
    },
  });
  await new Promise(resolve => setTimeout(resolve, 30));

  const result = bridge.calls.find(call => call.type === 'runtime.sendMessage'
    && call.args[0]?.type === 'APP_IMPORT_RESULT');
  assert.ok(result);
  assert.equal(result.args[0].payload.status, 'error');
  assert.match(result.args[0].payload.message, /Reading/);
  assert.equal(bridge.wasFallbackSubmitted(), false);
  assert.equal(bridge.storageValues.has('lingoflash_browser_extension_import'), false);
});

test('does not use the compatibility fallback when a verified v3 intent carries context', async () => {
  const bridge = await createBridgeContext({
    fallbackMode: 'stable',
    response: {
      ok: true,
      verified: true,
      intent: {
        v: 3,
        id: 'job_123456789',
        nonce: 'nonce_1234567890123456789012',
        text: 'resilient',
        context: 'The resilient team recovered quickly.',
        createdAt: Date.UTC(2026, 7, 19, 8, 0, 0),
        mode: 'silent',
      },
    },
  });
  await new Promise(resolve => setTimeout(resolve, 30));

  const result = bridge.calls.find(call => call.type === 'runtime.sendMessage'
    && call.args[0]?.type === 'APP_IMPORT_RESULT');
  assert.ok(result);
  assert.equal(result.args[0].payload.status, 'error');
  assert.match(result.args[0].payload.message, /context|runtime|current/i);
  assert.equal(bridge.wasFallbackSubmitted(), false);
  assert.equal(bridge.storageValues.has('lingoflash_browser_extension_import'), false);
});


test('reports storage failure without claiming delivery through an unverified message', async () => {
  const bridge = await createBridgeContext({ storageError: true });
  const result = bridge.calls.find(call => call.type === 'runtime.sendMessage' && call.args[0].type === 'APP_IMPORT_RESULT');
  assert.equal(result.args[0].payload.status, 'error');
  assert.match(result.args[0].payload.message, /storage/i);
  assert.equal(bridge.calls.some(call => call.type === 'window.postMessage' && call.message.type === 'LINGOFLASH_EXTENSION_IMPORT_READY'), false);
  assert.equal(bridge.wasFallbackSubmitted(), false);
});

test('a current runtime can claim structured import after the legacy grace period', async () => {
  const bridge = await createBridgeContext({ fallbackMode: 'stable', runtimeCapability: '3', response: { ok: true, verified: true, intent: {
    v: 3, id: 'job_123456789', nonce: 'nonce_1234567890123456789012', text: 'resilient', context: 'Keep this sentence.', requestedDeck: 'Reading', createdAt: Date.UTC(2026, 7, 19, 8, 0, 0), mode: 'silent',
  } } });
  // The harness advances a second per poll; this claim arrives after the old 1.5s grace.
  await new Promise(resolve => setTimeout(resolve, 3));
  bridge.dispatchMessage({ source: bridge.bridgeGlobal, origin: bridge.context.location.origin, data: {
    source: 'lingoflash-web-app', type: 'LINGOFLASH_EXTENSION_IMPORT_CLAIMED',
    payload: { id: 'job_123456789', nonce: 'nonce_1234567890123456789012' },
  } });
  await new Promise(resolve => setTimeout(resolve, 25));
  assert.equal(bridge.calls.some(call => call.type === 'runtime.sendMessage' && call.args[0].type === 'APP_IMPORT_RESULT'), false);
  const pending = JSON.parse(bridge.storageValues.get('lingoflash_browser_extension_import'));
  assert.equal(pending.context, 'Keep this sentence.');
  assert.equal(pending.requestedDeck, 'Reading');
  assert.equal(bridge.wasFallbackSubmitted(), false);
});

for (const option of ['storageGetterError', 'storageReadError', 'storageError']) {
  test(`storage ${option} fails before a claimable handoff is committed`, async () => {
    const bridge = await createBridgeContext({ [option]: true });
    assert.equal(bridge.storageValues.has('lingoflash_browser_extension_import'), false);
    assert.equal(bridge.calls.some(call => call.type === 'window.postMessage' && call.message.type === 'LINGOFLASH_EXTENSION_IMPORT_READY'), false);
    assert.ok(bridge.calls.find(call => call.type === 'runtime.sendMessage' && call.args[0].type === 'APP_IMPORT_RESULT'));
  });
}
test('unverified cleanup failure does not turn a committed handoff into an error', async () => {
  const bridge = await createBridgeContext({ storageRemoveError: true });
  assert.ok(bridge.storageValues.has('lingoflash_browser_extension_import'));
  assert.ok(bridge.calls.find(call => call.type === 'window.postMessage' && call.message.type === 'LINGOFLASH_EXTENSION_IMPORT_READY'));
  assert.equal(bridge.calls.some(call => call.type === 'runtime.sendMessage' && call.args[0].type === 'APP_IMPORT_RESULT'), false);
});
test('startup timeout cannot report terminal failure while a verified handoff survives', async () => {
  const bridge = await createBridgeContext({ storageRemoveError: true, runtimeCapability: '3', fallbackMode: 'stable' });
  await new Promise(resolve => setTimeout(resolve, 45));
  assert.ok(bridge.storageValues.has('lingoflash_browser_extension_import'));
  assert.equal(bridge.calls.some(call => call.type === 'runtime.sendMessage' && call.args[0].type === 'APP_IMPORT_RESULT'), false);
});
test('a publisher can bind and logout before publishing ready decks', async () => {
  const bridge = await createBridgeContext();
  const dispatch = (type, payload) => bridge.dispatchMessage({ source: bridge.bridgeGlobal, origin: bridge.context.location.origin, data: { source: 'lingoflash-web-app', type, payload } });
  dispatch('LINGOFLASH_EXTENSION_DECK_METADATA', { scope: 'scope_before_ready' });
  dispatch('LINGOFLASH_EXTENSION_DECK_METADATA_CLEAR', { scope: 'scope_before_ready' });
  await new Promise(resolve => setImmediate(resolve));
  const messages = bridge.calls.filter(call => call.type === 'runtime.sendMessage').map(call => call.args[0]);
  assert.equal(messages.some(message => message.type === 'SYNC_DECK_METADATA'), false);
  assert.ok(messages.some(message => message.type === 'CLEAR_DECK_METADATA' && message.payload.generation === 'generation_123456789'));
});
