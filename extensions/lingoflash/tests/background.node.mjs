import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const sourceFiles = [
  '../shared.js',
  '../background-ui.js',
  '../background-core.js',
];
const backgroundSource = await readFile(new URL('../background-core.js', import.meta.url), 'utf8');

const makeEvent = () => {
  const listeners = [];
  return {
    listeners,
    addListener(listener) {
      listeners.push(listener);
    },
  };
};

const flushMicrotasks = () => new Promise(resolve => setImmediate(resolve));

test('keeps quick-add job expiry at the AI flow deadline', () => {
  const match = backgroundSource.match(/const JOB_TIMEOUT_MINUTES = ([\d.]+);/);
  assert.ok(match);
  const timeoutMs = Number(match[1]) * 60_000;
  assert.ok(timeoutMs >= 150_000);
  assert.ok(timeoutMs - 1 < 150_000);
});

const createWorkerContext = async ({
  executeScriptError = '',
  executeScriptRenderResult = { ok: true },
  executeScriptCaptureResult = { text: '', anchor: null, context: '' },
  fetchImpl = null,
  storageEntries = [],
  storageGetError = '',
  storageSetError = '',
  storageSetErrorAfter = null,
  storageRemoveGate = null,
  storageRemoveError = '',
  emitTabRemovalOnRemove = false,
  timerCapMs = null,
  permissionOrigins = [],
  activeTabUrl = '',
  permissionsRequestResult = true,
  hasSessionStorage = true,
  registerContentScriptError = '',
  userAgent = 'Mozilla/5.0 Chrome/127.0.0.0 Safari/537.36',
} = {}) => {
  const calls = [];
  const storageValues = new Map(storageEntries);
  let storageSetCalls = 0;
  const events = {
    installed: makeEvent(),
    startup: makeEvent(),
    messages: makeEvent(),
    menuClicks: makeEvent(),
    commands: makeEvent(),
    alarms: makeEvent(),
    tabsRemoved: makeEvent(),
    permissionsRemoved: makeEvent(),
  };
  const grantedOrigins = new Set(permissionOrigins);
  const storage = {
    get(key, callback) {
      if (storageGetError) {
        chrome.runtime.lastError = { message: storageGetError };
        callback({});
        chrome.runtime.lastError = null;
        return;
      }
      if (key === null) {
        callback(Object.fromEntries(storageValues));
        return;
      }
      callback({ [key]: storageValues.get(key) });
    },
    set(values, callback) {
      calls.push({ type: 'storage.set', values });
      storageSetCalls += 1;
      if (storageSetError && (storageSetErrorAfter === null || storageSetCalls > storageSetErrorAfter)) {
        chrome.runtime.lastError = { message: storageSetError };
        callback?.();
        chrome.runtime.lastError = null;
        return;
      }
      for (const [key, value] of Object.entries(values)) storageValues.set(key, value);
      callback?.();
    },
    remove(key, callback) {
      calls.push({ type: 'storage.remove', key });
      if (storageRemoveError) {
        chrome.runtime.lastError = { message: storageRemoveError };
        callback?.();
        chrome.runtime.lastError = null;
        return;
      }
      if (storageRemoveGate) {
        storageRemoveGate.then(() => {
          storageValues.delete(key);
          callback?.();
        });
        return;
      }
      storageValues.delete(key);
      callback?.();
    },
  };

  const chrome = {
    runtime: {
      lastError: null,
      onInstalled: events.installed,
      onStartup: events.startup,
      onMessage: events.messages,
      getManifest() {
        return { version: '1.6.3' };
      },
      sendMessage: message => {
        calls.push({ type: 'runtime.sendMessage', message });
        return Promise.resolve();
      },
    },
    storage: {
      ...(hasSessionStorage ? { session: storage } : { local: storage }),
      sync: storage,
    },
    tabs: {
      query(_query, callback) {
        callback([{ id: 7, ...(activeTabUrl ? { url: activeTabUrl } : {}) }]);
      },
      create(details, callback) {
        calls.push({ type: 'tabs.create', details });
        callback({ id: 99, ...details });
      },
      update(id, details, callback) {
        calls.push({ type: 'tabs.update', id, details });
        callback({ id, ...details });
      },
      remove(id, callback) {
        calls.push({ type: 'tabs.remove', id });
        if (emitTabRemovalOnRemove) {
          for (const listener of events.tabsRemoved.listeners) listener(id);
        }
        callback?.();
      },
      sendMessage(id, message, callback) {
        calls.push({ type: 'tabs.sendMessage', id, message });
        callback?.();
      },
      onRemoved: events.tabsRemoved,
    },
    scripting: {
    executeScript(details, callback) {
      calls.push({ type: 'scripting.executeScript', details });
      if (executeScriptError) {
        chrome.runtime.lastError = { message: executeScriptError };
        callback();
        chrome.runtime.lastError = null;
        return;
      }
      callback(details.func?.name === 'renderInlineBubble'
        ? [{ result: executeScriptRenderResult }]
        : details.func?.name === 'captureSelectionFromPage'
          ? [{ result: executeScriptCaptureResult }]
          : []);
      },
      registerContentScripts(details, callback) {
        calls.push({ type: 'scripting.registerContentScripts', details });
        if (!Array.isArray(details)) {
          chrome.runtime.lastError = { message: 'registerContentScripts expects an array' };
          callback?.();
          chrome.runtime.lastError = null;
          return;
        }
        if (registerContentScriptError) {
          chrome.runtime.lastError = { message: registerContentScriptError };
          callback?.();
          chrome.runtime.lastError = null;
          return;
        }
        callback?.();
      },
      unregisterContentScripts(details, callback) {
        calls.push({ type: 'scripting.unregisterContentScripts', details });
        callback?.();
      },
    },
    alarms: {
      create(name, details) {
        calls.push({ type: 'alarms.create', name, details });
      },
      clear(name, callback) {
        calls.push({ type: 'alarms.clear', name });
        callback?.(true);
      },
      onAlarm: events.alarms,
    },
    contextMenus: {
      removeAll(callback) {
        calls.push({ type: 'contextMenus.removeAll' });
        callback?.();
      },
      create(details, callback) {
        calls.push({ type: 'contextMenus.create', details });
        callback?.(details.id);
      },
      onClicked: events.menuClicks,
    },
    commands: {
      getAll(callback) {
        callback([
          { name: 'translate-selection', shortcut: 'Ctrl+Shift+L' },
          { name: 'translate-only-selection', shortcut: 'Alt+Shift+L' },
        ]);
      },
      onCommand: events.commands,
    },
    permissions: {
      contains(details, callback) {
        callback(Boolean(details?.origins?.every(origin => grantedOrigins.has(origin))));
      },
      request(details, callback) {
        if (permissionsRequestResult) for (const origin of details?.origins ?? []) grantedOrigins.add(origin);
        callback(Boolean(permissionsRequestResult));
      },
      remove(details, callback) {
        const removed = [];
        for (const origin of details?.origins ?? []) {
          if (grantedOrigins.delete(origin)) removed.push(origin);
        }
        if (removed.length) for (const listener of events.permissionsRemoved.listeners) listener({ origins: removed, permissions: [] });
        callback(true);
      },
      onRemoved: events.permissionsRemoved,
    },
  };
  const workerSetTimeout = timerCapMs === null
    ? setTimeout
    : (callback, milliseconds) => setTimeout(callback, Math.min(milliseconds, timerCapMs));

  const context = {
    Array,
    ArrayBuffer,
    AbortController,
    AbortSignal,
    atob: value => Buffer.from(value, 'base64').toString('binary'),
    btoa: value => Buffer.from(value, 'binary').toString('base64'),
    Date,
    Error,
    Math,
    Number,
    Object,
    Promise,
    String,
    TextDecoder,
    TextEncoder,
    Uint8Array,
    Uint32Array,
    URL,
    URLSearchParams,
    clearTimeout,
    console,
    crypto: webcrypto,
    fetch: fetchImpl ?? (() => { throw new Error('fetch should not be called by this test'); }),
    setTimeout: workerSetTimeout,
    navigator: { userAgent },
    chrome,
  };
  context.globalThis = context;
  vm.createContext(context);
  for (const relativePath of sourceFiles) {
    const source = await readFile(new URL(relativePath, import.meta.url), 'utf8');
    vm.runInContext(source, context, { filename: relativePath });
  }
  await flushMicrotasks();
  calls.length = 0;

  return {
    context,
    calls,
    events,
    storageValues,
  };
};

const sendRuntimeMessage = (worker, message, sender = {}) => new Promise(resolve => {
  const [listener] = worker.events.messages.listeners;
  assert.ok(listener, 'background worker did not register a runtime message listener');
  assert.equal(listener(message, sender, resolve), true);
});

const startQuickAdd = worker => sendRuntimeMessage(worker, {
  type: 'ADD_SELECTION',
  text: 'resilient',
});

test('opens the browser shortcut configuration on request', async () => {
  const worker = await createWorkerContext();

  const response = await sendRuntimeMessage(worker, { type: 'OPEN_SHORTCUTS' });

  assert.equal(response.ok, true);
  assert.ok(worker.calls.some(call => call.type === 'tabs.create'
    && call.details.url === 'chrome://extensions/shortcuts'));
});

test('does not expose a Chrome shortcut URL on Safari', async () => {
  const worker = await createWorkerContext({
    userAgent: 'Mozilla/5.0 Version/17.5 Safari/605.1.15',
  });

  const shortcuts = await sendRuntimeMessage(worker, { type: 'GET_SHORTCUTS' });
  const response = await sendRuntimeMessage(worker, { type: 'OPEN_SHORTCUTS' });

  assert.equal(shortcuts.shortcutSettingsAvailable, false);
  assert.equal(response.ok, false);
  assert.equal(worker.calls.some(call => call.type === 'tabs.create'), false);
});

const readStartedIntent = (worker, id) => {
  const navigation = [...worker.calls].reverse().find(call => call.type === 'tabs.update');
  assert.ok(navigation, 'quick-add worker navigation was not recorded');
  const intent = worker.context.LingoFlashExtension.decodeImportIntentFromUrl(
    navigation.details.url,
  );
  assert.equal(intent.v, 3);
  assert.equal(typeof intent.nonce, 'string');
  assert.equal(intent.id, id);
  assert.equal(intent.text, 'resilient');
  assert.equal(worker.storageValues.get(`lingoflash_quick_add_job_${id}`).nonce, intent.nonce);
  return intent;
};

const verifyIntent = (worker, intent, sender = {}) => sendRuntimeMessage(worker, {
  type: 'VERIFY_IMPORT_INTENT',
  payload: intent,
}, sender);

const appSender = (worker, tabId = 99, overrides = {}) => ({
  url: worker.context.LingoFlashExtension.DEFAULT_APP_URL,
  tab: { id: tabId },
  frameId: 0,
  ...overrides,
});

const appResultPayload = (worker, id, payload) => ({
  id,
  nonce: worker.storageValues.get(`lingoflash_quick_add_job_${id}`)?.nonce
    ?? 'missing_job_nonce_1234567890',
  ...payload,
});

test('verifies a silent import only for its origin, worker tab and exact job payload', async () => {
  const worker = await createWorkerContext();
  const started = await startQuickAdd(worker);
  const intent = readStartedIntent(worker, started.id);
  const sender = {
    url: worker.context.LingoFlashExtension.DEFAULT_APP_URL,
    tab: { id: 99 },
    frameId: 0,
  };

  const forged = await verifyIntent(worker, {
    ...intent,
    nonce: 'forged_nonce_1234567890123456',
  }, sender);
  assert.equal(forged.ok, true);
  assert.equal(forged.verified, false);

  const wrongNonce = await verifyIntent(worker, {
    ...intent,
    nonce: 'wrong_nonce_123456789012345678',
  }, sender);
  assert.equal(wrongNonce.ok, true);
  assert.equal(wrongNonce.verified, false);

  const verified = await verifyIntent(worker, intent, sender);
  assert.equal(verified.ok, true);
  assert.equal(verified.verified, true);
  assert.equal(verified.intent.v, 3);
  assert.equal(verified.intent.id, started.id);
  assert.equal(verified.intent.text, 'resilient');
  assert.equal(verified.intent.nonce, intent.nonce);

  const wrongMode = await verifyIntent(worker, {
    ...intent,
    mode: 'open',
  }, sender);
  assert.equal(wrongMode.ok, true);
  assert.equal(wrongMode.verified, false);

  const wrongVersion = await verifyIntent(worker, {
    ...intent,
    v: 2,
  }, sender);
  assert.equal(wrongVersion.ok, true);
  assert.equal(wrongVersion.verified, false);

  const wrongOrigin = await verifyIntent(worker, intent, {
    ...sender,
    url: 'https://example.com/?view=library',
  });
  assert.equal(wrongOrigin.ok, true);
  assert.equal(wrongOrigin.verified, false);

  const wrongTab = await verifyIntent(worker, intent, {
    ...sender,
    tab: { id: 123 },
  });
  assert.equal(wrongTab.ok, true);
  assert.equal(wrongTab.verified, false);
});

test('claims a verified intent once and rejects replay', async () => {
  const worker = await createWorkerContext();
  const started = await startQuickAdd(worker);
  const intent = readStartedIntent(worker, started.id);
  const sender = {
    url: worker.context.LingoFlashExtension.DEFAULT_APP_URL,
    tab: { id: 99 },
    frameId: 0,
  };

  const first = await verifyIntent(worker, intent, sender);
  const replay = await verifyIntent(worker, intent, sender);

  assert.equal(first.verified, true);
  assert.equal(replay.verified, false);
  const storedJob = worker.storageValues.get(`lingoflash_quick_add_job_${started.id}`);
  assert.equal(storedJob.importClaimedAt > 0, true);
});

test('allows only one of two concurrent verification requests to claim a job', async () => {
  const worker = await createWorkerContext();
  const started = await startQuickAdd(worker);
  const intent = readStartedIntent(worker, started.id);
  const sender = {
    url: worker.context.LingoFlashExtension.DEFAULT_APP_URL,
    tab: { id: 99 },
    frameId: 0,
  };

  const results = await Promise.all([
    verifyIntent(worker, intent, sender),
    verifyIntent(worker, intent, sender),
  ]);

  assert.deepEqual(results.map(result => result.verified).sort(), [false, true]);
});

test('rejects an unclaimed job after its verification window expires', async () => {
  const worker = await createWorkerContext();
  const started = await startQuickAdd(worker);
  const intent = readStartedIntent(worker, started.id);
  const jobKey = `lingoflash_quick_add_job_${started.id}`;
  const storedJob = worker.storageValues.get(jobKey);
  storedJob.createdAt = Date.now() - 150_001;

  const response = await verifyIntent(worker, {
    ...intent,
  }, {
    url: worker.context.LingoFlashExtension.DEFAULT_APP_URL,
    tab: { id: 99 },
    frameId: 0,
  });

  assert.equal(response.ok, true);
  assert.equal(response.verified, false);
  assert.equal(storedJob.importClaimedAt, undefined);
  assert.equal(worker.storageValues.has(jobKey), false);
  assert.ok(worker.calls.some(call => call.type === 'tabs.remove' && call.id === 99));
});

test('persists a quick-add job before navigating the worker tab', async () => {
  const worker = await createWorkerContext();

  const response = await startQuickAdd(worker);
  assert.equal(response.ok, true);
  assert.match(response.id, /^[A-Za-z0-9_-]{8,128}$/);
  assert.equal(response.text, 'resilient');

  const firstJobWrite = worker.calls.findIndex(call =>
    call.type === 'storage.set' && Object.values(call.values)[0]?.text === 'resilient');
  const workerTabCreate = worker.calls.findIndex(call => call.type === 'tabs.create');
  const secondJobWrite = worker.calls.findIndex((call, index) =>
    index > workerTabCreate
    && call.type === 'storage.set'
    && Object.values(call.values)[0]?.workerTabId === 99);
  const workerNavigation = worker.calls.findIndex(call => call.type === 'tabs.update');

  assert.ok(firstJobWrite >= 0);
  assert.ok(workerTabCreate > firstJobWrite);
  assert.ok(secondJobWrite > workerTabCreate);
  assert.ok(workerNavigation > secondJobWrite);

  const navigation = worker.calls[workerNavigation];
  const intent = worker.context.LingoFlashExtension.decodeImportIntentFromUrl(
    navigation.details.url,
  );
  assert.equal(intent.v, 3);
  assert.equal(typeof intent.nonce, 'string');
  assert.equal(worker.storageValues.get(`lingoflash_quick_add_job_${response.id}`).nonce, intent.nonce);
  assert.equal(intent.mode, 'silent');
  assert.equal(intent.text, 'resilient');
  assert.equal('context' in intent, false);
});

test('persists bounded sentence context captured from the source tab', async () => {
  const worker = await createWorkerContext({
    executeScriptCaptureResult: {
      text: 'resilient',
      anchor: { left: 10, bottom: 40 },
      context: `The resilient ${'team '.repeat(200)}finished.`,
    },
  });

  const response = await sendRuntimeMessage(worker, { type: 'ADD_SELECTION' });
  const job = worker.storageValues.get(`lingoflash_quick_add_job_${response.id}`);

  assert.equal(response.ok, true);
  assert.equal(job.text, 'resilient');
  assert.equal(job.context.length, 500);
  assert.equal(job.context.startsWith('The resilient'), true);
});

test('syncs bounded deck metadata only from the production app origin', async () => {
  const worker = await createWorkerContext();
  const sender = {
    url: worker.context.LingoFlashExtension.DEFAULT_APP_URL,
    tab: { id: 7 },
  };
  const longDeck = `  ${'Reading '.repeat(30)}  `;
  const response = await sendRuntimeMessage(worker, {
    type: 'SYNC_DECK_METADATA',
    payload: {
      scope: 'opaque_scope_a_123456',
      decks: ['Reading', 'Reading', longDeck, ...Array.from({ length: 120 }, (_, i) => `Deck ${i}`)],
    },
  }, sender);

  assert.equal(response.ok, true);
  assert.equal(response.count, 100);
  const cached = worker.storageValues.get('lingoflash_extension_deck_metadata');
  assert.equal(cached.scope, 'opaque_scope_a_123456');
  assert.equal(cached.decks.length, 100);
  assert.equal(cached.decks[0], 'Reading');
  assert.equal(cached.decks.filter(deck => deck === 'Reading').length, 1);
  assert.equal(cached.decks[1].length, 128);

  const wrongOrigin = await sendRuntimeMessage(worker, {
    type: 'SYNC_DECK_METADATA',
    payload: { scope: 'attacker_scope_123456', decks: ['Injected'] },
  }, { ...sender, url: 'https://example.com/?view=library' });
  assert.equal(wrongOrigin.ok, false);
  assert.match(wrongOrigin.error, /Nguồn metadata deck/);
  assert.equal(worker.storageValues.get('lingoflash_extension_deck_metadata').scope, 'opaque_scope_a_123456');
});

test('keeps deck metadata in memory when session storage is unavailable', async () => {
  const worker = await createWorkerContext({ hasSessionStorage: false });
  const sender = {
    url: worker.context.LingoFlashExtension.DEFAULT_APP_URL,
    tab: { id: 7 },
  };

  const synced = await sendRuntimeMessage(worker, {
    type: 'SYNC_DECK_METADATA',
    payload: { scope: 'opaque_memory_scope_123456', decks: ['Reading'] },
  }, sender);

  assert.equal(synced.ok, true);
  assert.equal(worker.storageValues.has('lingoflash_extension_deck_metadata'), false);
  assert.deepEqual([...(await sendRuntimeMessage(worker, { type: 'GET_DECKS' })).decks], ['Reading']);

  const restarted = await createWorkerContext({
    hasSessionStorage: false,
    storageEntries: [...worker.storageValues.entries()],
  });
  assert.equal((await sendRuntimeMessage(restarted, { type: 'GET_DECKS' })).ok, false);
});

test('reports unavailable deck metadata when session storage cannot be read', async () => {
  const worker = await createWorkerContext({ storageGetError: 'session storage unavailable' });

  const response = await sendRuntimeMessage(worker, { type: 'GET_DECKS' });

  assert.equal(response.ok, false);
  assert.match(response.error, /session storage unavailable/);
});

test('replaces stale owner-scoped deck metadata and clears it on sign-out', async () => {
  const worker = await createWorkerContext();
  const sender = {
    url: worker.context.LingoFlashExtension.DEFAULT_APP_URL,
    tab: { id: 7 },
  };
  await sendRuntimeMessage(worker, {
    type: 'SYNC_DECK_METADATA',
    payload: { scope: 'opaque_scope_a_123456', decks: ['Owner A'] },
  }, sender);
  await sendRuntimeMessage(worker, {
    type: 'SYNC_DECK_METADATA',
    payload: { scope: 'opaque_scope_b_123456', decks: ['Owner B'] },
  }, sender);
  const delayedOldOwner = await sendRuntimeMessage(worker, {
    type: 'SYNC_DECK_METADATA',
    payload: { scope: 'opaque_scope_a_123456', decks: ['Stale owner A'] },
  }, sender);
  assert.equal(delayedOldOwner.ok, false);
  const listed = await sendRuntimeMessage(worker, { type: 'GET_DECKS' });
  assert.deepEqual([...listed.decks], ['Owner B']);

  const cleared = await sendRuntimeMessage(worker, {
    type: 'CLEAR_DECK_METADATA',
    payload: { scope: 'opaque_scope_b_123456' },
  }, sender);
  assert.equal(cleared.ok, true);
  assert.equal(worker.storageValues.has('lingoflash_extension_deck_metadata'), false);
  const delayedAfterSignOut = await sendRuntimeMessage(worker, {
    type: 'SYNC_DECK_METADATA',
    payload: { scope: 'opaque_scope_b_123456', decks: ['Stale after sign-out'] },
  }, sender);
  assert.equal(delayedAfterSignOut.ok, false);
  assert.equal(worker.storageValues.has('lingoflash_extension_deck_metadata'), false);
  assert.equal((await sendRuntimeMessage(worker, { type: 'GET_DECKS' })).ok, false);
});

test('owns settings mutations in the background and preserves concurrent site opt-ins', async () => {
  const worker = await createWorkerContext({
    storageEntries: [[
      'lingoflash_extension_settings',
      {
        autoSpeak: false,
        bubbleDurationMs: 12000,
        recentLookupsEnabled: true,
        quickTranslateSource: 'auto',
        quickTranslateTarget: 'vi',
        selectionIconSites: ['https://existing.example/*'],
      },
    ]],
    permissionOrigins: ['https://new.example/*'],
  });

  const [settingsUpdate, siteEnable] = await Promise.all([
    sendRuntimeMessage(worker, {
      type: 'UPDATE_USER_SETTINGS',
      changes: { autoSpeak: true, bubbleDurationMs: 0 },
    }),
    sendRuntimeMessage(worker, { type: 'ENABLE_SELECTION_ICON_SITE', pattern: 'https://new.example/*' }),
  ]);

  assert.equal(settingsUpdate.ok, true);
  assert.equal(siteEnable.ok, true);
  const saved = worker.storageValues.get('lingoflash_extension_settings');
  assert.equal(saved.autoSpeak, true);
  assert.equal(saved.bubbleDurationMs, 0);
  assert.deepEqual([...saved.selectionIconSites].sort(), ['https://existing.example/*', 'https://new.example/*']);
});

test('persists requestedDeck in the verified job and ignores a deck forged into the raw handoff', async () => {
  const worker = await createWorkerContext();
  const started = await sendRuntimeMessage(worker, { type: 'ADD_SELECTION', text: 'resilient', requestedDeck: 'Reading' });
  const jobKey = `lingoflash_quick_add_job_${started.id}`;
  const job = worker.storageValues.get(jobKey);
  assert.equal(job.requestedDeck, 'Reading');
  const intent = readStartedIntent(worker, started.id);
  const verified = await verifyIntent(worker, { ...intent, requestedDeck: 'Forged' }, {
    url: worker.context.LingoFlashExtension.DEFAULT_APP_URL,
    tab: { id: 99 },
    frameId: 0,
  });
  assert.equal(verified.verified, true);
  assert.equal(verified.intent.requestedDeck, 'Reading');
});

test('captures sentence context even when a context menu supplies the selected text', async () => {
  const worker = await createWorkerContext({
    executeScriptCaptureResult: {
      text: 'resilient',
      anchor: { left: 10, bottom: 40 },
      context: 'The resilient team recovered quickly.',
    },
  });

  const response = await sendRuntimeMessage(worker, { type: 'ADD_SELECTION', text: 'resilient' });
  const job = worker.storageValues.get(`lingoflash_quick_add_job_${response.id}`);

  assert.equal(response.ok, true);
  assert.equal(job.context, 'The resilient team recovered quickly.');
});

test('rejects an app result from the wrong worker tab and cleans up a valid result', async () => {
  const worker = await createWorkerContext();
  const started = await startQuickAdd(worker);

  const wrongTab = await sendRuntimeMessage(worker, {
    type: 'APP_IMPORT_RESULT',
    bridgeType: 'LINGOFLASH_EXTENSION_RESULT',
    payload: appResultPayload(worker, started.id, { status: 'created', translation: 'bền bỉ' }),
  }, appSender(worker, 123));
  assert.equal(wrongTab.ok, false);
  assert.match(wrongTab.error, /Tab\/frame trả kết quả không khớp/);
  assert.equal(worker.storageValues.size, 1);
  assert.equal(worker.calls.some(call => call.type === 'tabs.remove'), false);

  const wrongOrigin = await sendRuntimeMessage(worker, {
    type: 'APP_IMPORT_RESULT',
    bridgeType: 'LINGOFLASH_EXTENSION_RESULT',
    payload: appResultPayload(worker, started.id, { status: 'created', translation: 'bền bỉ' }),
  }, appSender(worker, 99, { url: 'https://example.com/?view=library' }));
  assert.equal(wrongOrigin.ok, false);
  assert.match(wrongOrigin.error, /Nguồn kết quả LingoFlash không hợp lệ/);
  assert.equal(worker.storageValues.size, 1);
  assert.equal(worker.calls.some(call => call.type === 'tabs.remove'), false);

  const wrongNonce = await sendRuntimeMessage(worker, {
    type: 'APP_IMPORT_RESULT',
    bridgeType: 'LINGOFLASH_EXTENSION_RESULT',
    payload: {
      ...appResultPayload(worker, started.id, { status: 'created', translation: 'bền bỉ' }),
      nonce: 'wrong_nonce_123456789012345678',
    },
  }, appSender(worker));
  assert.equal(wrongNonce.ok, false);
  assert.match(wrongNonce.error, /Nonce/);

  const wrongFrame = await sendRuntimeMessage(worker, {
    type: 'APP_IMPORT_RESULT',
    bridgeType: 'LINGOFLASH_EXTENSION_RESULT',
    payload: appResultPayload(worker, started.id, { status: 'created', translation: 'bền bỉ' }),
  }, appSender(worker, 99, { frameId: 1 }));
  assert.equal(wrongFrame.ok, false);
  assert.match(wrongFrame.error, /Tab\/frame/);

  const valid = await sendRuntimeMessage(worker, {
    type: 'APP_IMPORT_RESULT',
    bridgeType: 'LINGOFLASH_EXTENSION_RESULT',
    payload: appResultPayload(worker, started.id, { status: 'created', translation: 'bền bỉ' }),
  }, appSender(worker));
  assert.equal(valid.ok, true);
  assert.equal(valid.ignored, false);
  assert.equal(worker.storageValues.has(`lingoflash_quick_add_job_${started.id}`), false);
  assert.ok(worker.calls.some(call => call.type === 'storage.remove'));
  assert.ok(worker.calls.some(call => call.type === 'alarms.clear'));
  assert.ok(worker.calls.some(call => call.type === 'tabs.remove' && call.id === 99));
});

test('forwards AI result details and source locale to the popup status', async () => {
  const worker = await createWorkerContext();
  const started = await startQuickAdd(worker);

  const valid = await sendRuntimeMessage(worker, {
    type: 'APP_IMPORT_RESULT',
    bridgeType: 'LINGOFLASH_EXTENSION_RESULT',
    payload: {
      id: started.id,
      nonce: worker.storageValues.get(`lingoflash_quick_add_job_${started.id}`).nonce,
      status: 'created',
      translation: 'bền bỉ',
      phonetic: '/bɛːn/',
      explanation: 'Có khả năng phục hồi.',
      exampleSentence: 'She is resilient.',
      exampleTranslation: 'Cô ấy kiên cường.',
    },
  }, appSender(worker));

  assert.equal(valid.ignored, false);
  const statusCall = worker.calls.find(call => call.type === 'runtime.sendMessage'
    && call.message.payload?.status === 'created');
  assert.equal(statusCall?.message.payload?.phonetic, '/bɛːn/');
  assert.equal(statusCall?.message.payload?.explanation, 'Có khả năng phục hồi.');
  assert.equal(statusCall?.message.payload?.exampleSentence, 'She is resilient.');
  assert.equal(statusCall?.message.payload?.exampleTranslation, 'Cô ấy kiên cường.');
  assert.equal(statusCall?.message.payload?.sourceLanguage, 'en');
  assert.equal(statusCall?.message.payload?.speechLocale, 'en-US');
});

test('does not report a false error when successful cleanup closes the worker tab first', async () => {
  let releaseStorageRemove;
  const storageRemoveGate = new Promise(resolve => { releaseStorageRemove = resolve; });
  const worker = await createWorkerContext({ storageRemoveGate, emitTabRemovalOnRemove: true });
  const started = await startQuickAdd(worker);

  const resultPromise = sendRuntimeMessage(worker, {
    type: 'APP_IMPORT_RESULT',
    bridgeType: 'LINGOFLASH_EXTENSION_RESULT',
    payload: appResultPayload(worker, started.id, { status: 'created', translation: 'bền bỉ' }),
  }, appSender(worker));

  for (let attempt = 0; attempt < 5 && !worker.calls.some(call => call.type === 'storage.remove'); attempt += 1) {
    await flushMicrotasks();
  }
  assert.ok(worker.calls.some(call => call.type === 'storage.remove'));
  assert.equal(worker.calls.some(call => call.type === 'scripting.executeScript'
    && call.details.args?.[0]?.status === 'error'), false);
  assert.equal(worker.calls.some(call => call.type === 'runtime.sendMessage'
    && call.message.payload?.status === 'error'), false);

  releaseStorageRemove();
  const result = await resultPromise;
  await flushMicrotasks();

  assert.equal(result.ok, true);
  assert.equal(result.ignored, false);
  assert.equal(worker.storageValues.has(`lingoflash_quick_add_job_${started.id}`), false);
  assert.ok(worker.calls.some(call => call.type === 'alarms.clear'
    && call.name === `lingoflash_quick_add_timeout_${started.id}`));
  assert.equal(worker.calls.filter(call => call.type === 'scripting.executeScript'
    && call.details.args?.[0]?.status === 'created').length, 1);
  assert.equal(worker.calls.filter(call => call.type === 'scripting.executeScript'
    && call.details.args?.[0]?.status === 'error').length, 0);
});

test('does not let an alarm report an error while a successful result cleanup is pending', async () => {
  let releaseStorageRemove;
  const storageRemoveGate = new Promise(resolve => { releaseStorageRemove = resolve; });
  const worker = await createWorkerContext({ storageRemoveGate });
  const started = await startQuickAdd(worker);
  const alarmName = `lingoflash_quick_add_timeout_${started.id}`;

  const resultPromise = sendRuntimeMessage(worker, {
    type: 'APP_IMPORT_RESULT',
    bridgeType: 'LINGOFLASH_EXTENSION_RESULT',
    payload: appResultPayload(worker, started.id, { status: 'created', translation: 'bền bỉ' }),
  }, appSender(worker));

  await flushMicrotasks();
  assert.equal(Boolean(worker.storageValues.get(`lingoflash_quick_add_job_${started.id}`).resultClaimedAt), true);
  for (const listener of worker.events.alarms.listeners) listener({ name: alarmName });
  await flushMicrotasks();

  assert.equal(worker.calls.some(call => call.type === 'scripting.executeScript'
    && call.details.args?.[0]?.status === 'error'), false);
  assert.equal(worker.calls.some(call => call.type === 'runtime.sendMessage'
    && call.message.payload?.status === 'error'), false);

  releaseStorageRemove();
  const result = await resultPromise;
  await flushMicrotasks();
  assert.equal(result.ignored, false);
  assert.equal(worker.storageValues.has(`lingoflash_quick_add_job_${started.id}`), false);
});

test('does not report a worker error when successful cleanup cannot remove its job', async () => {
  const worker = await createWorkerContext({
    storageRemoveError: 'storage unavailable',
    emitTabRemovalOnRemove: true,
  });
  const started = await startQuickAdd(worker);

  const result = await sendRuntimeMessage(worker, {
    type: 'APP_IMPORT_RESULT',
    bridgeType: 'LINGOFLASH_EXTENSION_RESULT',
    payload: appResultPayload(worker, started.id, { status: 'created', translation: 'bền bỉ' }),
  }, appSender(worker));
  await flushMicrotasks();

  assert.equal(result.ignored, false);
  assert.equal(worker.storageValues.has(`lingoflash_quick_add_job_${started.id}`), true);
  assert.equal(worker.calls.some(call => call.type === 'tabs.remove' && call.id === 99), false);
  assert.equal(worker.calls.some(call => call.type === 'alarms.clear'
    && call.name === `lingoflash_quick_add_timeout_${started.id}`), false);
  assert.equal(worker.calls.some(call => call.type === 'scripting.executeScript'
    && call.details.args?.[0]?.status === 'error'), false);
  assert.equal(worker.calls.some(call => call.type === 'runtime.sendMessage'
    && call.message.payload?.status === 'error'), false);

  const alarmName = `lingoflash_quick_add_timeout_${started.id}`;
  const alarmsBeforeRetry = worker.calls.filter(call => call.type === 'alarms.create'
    && call.name === alarmName).length;
  for (const listener of worker.events.alarms.listeners) listener({ name: alarmName });
  await flushMicrotasks();
  const alarmsAfterRetry = worker.calls.filter(call => call.type === 'alarms.create'
    && call.name === alarmName).length;
  assert.ok(alarmsAfterRetry > alarmsBeforeRetry);
});

test('does not report a false error after a successful cleanup for an existing card', async () => {
  let releaseStorageRemove;
  const storageRemoveGate = new Promise(resolve => { releaseStorageRemove = resolve; });
  const worker = await createWorkerContext({ storageRemoveGate, emitTabRemovalOnRemove: true });
  const started = await startQuickAdd(worker);

  const resultPromise = sendRuntimeMessage(worker, {
    type: 'APP_IMPORT_RESULT',
    bridgeType: 'LINGOFLASH_EXTENSION_RESULT',
    payload: appResultPayload(worker, started.id, { status: 'existing', translation: 'đã có' }),
  }, appSender(worker));

  for (let attempt = 0; attempt < 5 && !worker.calls.some(call => call.type === 'storage.remove'); attempt += 1) {
    await flushMicrotasks();
  }
  assert.ok(worker.calls.some(call => call.type === 'storage.remove'));
  assert.equal(worker.calls.some(call => call.type === 'scripting.executeScript'
    && call.details.args?.[0]?.status === 'error'), false);
  releaseStorageRemove();
  const result = await resultPromise;
  await flushMicrotasks();

  assert.equal(result.ignored, false);
  assert.equal(worker.storageValues.has(`lingoflash_quick_add_job_${started.id}`), false);
  assert.equal(worker.calls.filter(call => call.type === 'scripting.executeScript'
    && call.details.args?.[0]?.status === 'existing').length, 1);
  assert.equal(worker.calls.filter(call => call.type === 'scripting.executeScript'
    && call.details.args?.[0]?.status === 'error').length, 0);
});

test('claims an app result before rendering so concurrent results are handled once', async () => {
  let fetchCount = 0;
  const worker = await createWorkerContext({
    fetchImpl: async () => {
      fetchCount += 1;
      await new Promise(resolve => setImmediate(resolve));
      return { ok: true, json: async () => [[['bền bỉ']]] };
    },
  });
  const started = await startQuickAdd(worker);
  const result = {
    type: 'APP_IMPORT_RESULT',
    bridgeType: 'LINGOFLASH_EXTENSION_RESULT',
    payload: appResultPayload(worker, started.id, { status: 'created', translation: '' }),
  };
  const sender = {
    url: worker.context.LingoFlashExtension.DEFAULT_APP_URL,
    tab: { id: 99 },
    frameId: 0,
  };

  const responses = await Promise.all([
    sendRuntimeMessage(worker, result, sender),
    sendRuntimeMessage(worker, result, sender),
  ]);

  assert.deepEqual(responses.map(response => response.ignored).sort(), [false, true]);
  assert.equal(worker.storageValues.has(`lingoflash_quick_add_job_${started.id}`), false);
  assert.equal(fetchCount, 1);
  const resultClaimWrite = worker.calls.findIndex(call => call.type === 'storage.set'
    && Object.values(call.values)[0]?.resultClaimedAt);
  const renderCall = worker.calls.findIndex(call => call.type === 'scripting.executeScript'
    && call.details.args?.[0]?.status === 'created');
  assert.ok(resultClaimWrite >= 0 && resultClaimWrite < renderCall);
  assert.equal(worker.calls.filter(call => call.type === 'scripting.executeScript'
    && call.details.args?.[0]?.status === 'created').length, 1);
  assert.equal(worker.calls.filter(call => call.type === 'tabs.remove' && call.id === 99).length, 1);
});

test('does not let a concurrent wrong-tab result suppress the valid worker result', async () => {
  const worker = await createWorkerContext();
  const started = await startQuickAdd(worker);
  const result = {
    type: 'APP_IMPORT_RESULT',
    bridgeType: 'LINGOFLASH_EXTENSION_RESULT',
    payload: appResultPayload(worker, started.id, { status: 'created', translation: 'bền bỉ' }),
  };

  const [wrong, valid] = await Promise.all([
    sendRuntimeMessage(worker, result, appSender(worker, 123)),
    sendRuntimeMessage(worker, result, appSender(worker)),
  ]);

  assert.equal(wrong.ok, false);
  assert.equal(valid.ignored, false);
  assert.equal(worker.storageValues.has(`lingoflash_quick_add_job_${started.id}`), false);
  assert.equal(worker.calls.filter(call => call.type === 'scripting.executeScript'
    && call.details.args?.[0]?.status === 'created').length, 1);
});

test('ignores a result for a job that is no longer pending', async () => {
  const worker = await createWorkerContext();

  const response = await sendRuntimeMessage(worker, {
    type: 'APP_IMPORT_RESULT',
    bridgeType: 'LINGOFLASH_EXTENSION_RESULT',
    payload: appResultPayload(worker, 'missing_job_123', { status: 'existing', translation: 'đã có' }),
  }, appSender(worker));

  assert.equal(response.ok, true);
  assert.equal(response.ignored, true);
  assert.equal(worker.calls.some(call => call.type === 'tabs.remove'), false);
});

test('returns quick translation to the caller when inline injection fails', async () => {
  const worker = await createWorkerContext({
    executeScriptError: 'Cannot access a protected browser page.',
    fetchImpl: async () => ({
      ok: true,
      json: async () => [[['résilient']]],
    }),
  });

  const response = await sendRuntimeMessage(worker, {
    type: 'TRANSLATE_SELECTION',
    text: 'resilient',
  });

  assert.equal(response.ok, true);
  assert.equal(response.translation, 'résilient');
  assert.equal(response.inlineShown, false);
  const recent = worker.storageValues.get('lingoflash_recent_lookups');
  assert.equal(recent?.[0]?.text, 'resilient');
  assert.equal(recent?.[0]?.kind, 'translate');
});

test('uses source auto-detection and exposes bounded recent lookup history', async () => {
  let requestUrl = '';
  const worker = await createWorkerContext({
    fetchImpl: async url => {
      requestUrl = url;
      return { ok: true, json: async () => [[['résilient']]] };
    },
  });
  const translated = await sendRuntimeMessage(worker, { type: 'TRANSLATE_SELECTION', text: 'resilient' });
  assert.equal(translated.ok, true);
  const params = new URL(requestUrl).searchParams;
  assert.equal(params.get('sl'), 'auto');
  assert.equal(params.get('tl'), 'vi');

  const history = await sendRuntimeMessage(worker, { type: 'GET_RECENT_LOOKUPS' });
  assert.equal(history.ok, true);
  assert.equal(history.items[0].translation, 'résilient');
  const cleared = await sendRuntimeMessage(worker, { type: 'CLEAR_RECENT_LOOKUPS' });
  assert.equal(cleared.ok, true);
  assert.deepEqual([...cleared.items], []);
  assert.equal(worker.storageValues.has('lingoflash_recent_lookups'), false);
});

test('propagates detected language and autoSpeak to the injected renderer', async () => {
  const worker = await createWorkerContext({
    storageEntries: [['lingoflash_extension_settings', {
      autoSpeak: true,
      bubbleDurationMs: 12_000,
      recentLookupsEnabled: true,
      quickTranslateSource: 'auto',
      quickTranslateTarget: 'vi',
    }]],
    fetchImpl: async () => ({
      ok: true,
      json: async () => [[['résilient']], null, 'fr'],
    }),
  });

  const response = await sendRuntimeMessage(worker, { type: 'TRANSLATE_SELECTION', text: 'resilient' });
  const renderCall = worker.calls.find(call => call.type === 'scripting.executeScript'
    && call.details.args?.[0]?.status === 'translated');
  const history = worker.storageValues.get('lingoflash_recent_lookups');

  assert.equal(response.ok, true);
  assert.equal(renderCall?.details.args[0].autoSpeak, true);
  assert.equal(renderCall?.details.args[0].speechLocale, 'fr-FR');
  assert.equal(history?.[0]?.sourceLanguage, 'fr');
});

test('treats a renderer acknowledgement failure as an inline fallback', async () => {
  const worker = await createWorkerContext({
    executeScriptRenderResult: { ok: false, error: 'Inline result host has no shadow root.' },
    fetchImpl: async () => ({
      ok: true,
      json: async () => [[['résilient']]],
    }),
  });

  const response = await sendRuntimeMessage(worker, {
    type: 'TRANSLATE_SELECTION',
    text: 'resilient',
  });

  assert.equal(response.ok, true);
  assert.equal(response.translation, 'résilient');
  assert.equal(response.inlineShown, false);
});

test('uses an abortable Google Translate request with a bounded timeout', async () => {
  let requestInit;
  const worker = await createWorkerContext({
    fetchImpl: async (_url, init) => {
      requestInit = init;
      throw new Error('network unavailable');
    },
  });

  const response = await sendRuntimeMessage(worker, {
    type: 'TRANSLATE_SELECTION',
    text: 'resilient',
  });

  assert.equal(response.ok, false);
  assert.match(response.error, /network unavailable/);
  assert.ok(requestInit?.signal instanceof AbortSignal);
});

test('bounds the response body parsing phase as well as the network request', async () => {
  const worker = await createWorkerContext({
    timerCapMs: 1,
    fetchImpl: async () => ({ ok: true, json: () => new Promise(() => {}) }),
  });

  const response = await sendRuntimeMessage(worker, {
    type: 'TRANSLATE_SELECTION',
    text: 'resilient',
  });

  assert.equal(response.ok, false);
  assert.match(response.error, /hết thời gian/i);
});

test('allows at most one quick-add job for a source tab', async () => {
  const worker = await createWorkerContext();
  const first = await startQuickAdd(worker);
  const second = await startQuickAdd(worker);

  assert.equal(first.ok, true);
  assert.equal(second.ok, false);
  assert.match(second.error, /đang chạy trên tab này/i);
});

test('enforces a small extension-wide active job limit', async () => {
  const now = Date.now();
  const seededJobs = [1, 2, 3].map(index => [`lingoflash_quick_add_job_seed_${index}`, {
    v: 2,
    id: `seed_${index}_123456`,
    text: 'resilient',
    mode: 'silent',
    sourceTabId: index,
    workerTabId: 100 + index,
    createdAt: now,
  }]);
  const worker = await createWorkerContext({ storageEntries: seededJobs });
  const response = await startQuickAdd(worker);

  assert.equal(response.ok, false);
  assert.match(response.error, /quá nhiều tác vụ/i);
});

test('reports a storage failure through the quick-add error flow', async () => {
  const worker = await createWorkerContext({ storageSetError: 'storage unavailable' });
  const response = await startQuickAdd(worker);

  assert.equal(response.ok, false);
  assert.match(response.error, /storage unavailable/);
  assert.ok(worker.calls.some(call => call.type === 'scripting.executeScript'
    && call.details.args?.[0]?.status === 'error'));
});

test('sweeps expired jobs when the worker starts up', async () => {
  const worker = await createWorkerContext();
  const job = {
    v: 2,
    id: 'expired_123456',
    text: 'resilient',
    mode: 'silent',
    sourceTabId: 7,
    workerTabId: 99,
    createdAt: Date.now() - 150_001,
  };
  worker.storageValues.set(`lingoflash_quick_add_job_${job.id}`, job);
  for (const listener of worker.events.startup.listeners) listener();
  await flushMicrotasks();

  assert.equal(worker.storageValues.has(`lingoflash_quick_add_job_${job.id}`), false);
  assert.ok(worker.calls.some(call => call.type === 'tabs.remove' && call.id === job.workerTabId));
  assert.ok(worker.calls.some(call => call.type === 'runtime.sendMessage'
    && call.message.payload?.id === job.id
    && call.message.payload?.status === 'error'));
});

test('alarm expiry reports an error and cleans the job, alarm and worker tab', async () => {
  const worker = await createWorkerContext();
  const started = await startQuickAdd(worker);
  const alarmName = `lingoflash_quick_add_timeout_${started.id}`;

  for (const listener of worker.events.alarms.listeners) listener({ name: alarmName });
  await flushMicrotasks();

  assert.equal(worker.storageValues.has(`lingoflash_quick_add_job_${started.id}`), false);
  assert.ok(worker.calls.some(call => call.type === 'scripting.executeScript'
    && call.details.args?.[0]?.status === 'error'));
  assert.ok(worker.calls.some(call => call.type === 'alarms.clear' && call.name === alarmName));
  assert.ok(worker.calls.some(call => call.type === 'tabs.remove' && call.id === 99));
  assert.ok(worker.calls.some(call => call.type === 'runtime.sendMessage'
    && call.message.payload?.status === 'error'));
});

test('source tab close reports status and cleans the worker job without injecting into the closed tab', async () => {
  const worker = await createWorkerContext();
  const started = await startQuickAdd(worker);

  for (const listener of worker.events.tabsRemoved.listeners) listener(7);
  await flushMicrotasks();

  assert.equal(worker.storageValues.has(`lingoflash_quick_add_job_${started.id}`), false);
  assert.ok(worker.calls.some(call => call.type === 'alarms.clear'
    && call.name === `lingoflash_quick_add_timeout_${started.id}`));
  assert.ok(worker.calls.some(call => call.type === 'tabs.remove' && call.id === 99));
  assert.ok(worker.calls.some(call => call.type === 'runtime.sendMessage'
    && call.message.payload?.status === 'error'));
  assert.equal(worker.calls.some(call => call.type === 'scripting.executeScript'
    && call.details.args?.[0]?.status === 'error'), false);
});

test('worker tab close reports an error on the source tab and cleans the job', async () => {
  const worker = await createWorkerContext();
  const started = await startQuickAdd(worker);

  for (const listener of worker.events.tabsRemoved.listeners) listener(99);
  await flushMicrotasks();

  assert.equal(worker.storageValues.has(`lingoflash_quick_add_job_${started.id}`), false);
  assert.ok(worker.calls.some(call => call.type === 'scripting.executeScript'
    && call.details.args?.[0]?.status === 'error'));
  assert.ok(worker.calls.some(call => call.type === 'alarms.clear'
    && call.name === `lingoflash_quick_add_timeout_${started.id}`));
  assert.ok(worker.calls.some(call => call.type === 'tabs.remove' && call.id === 99));
  assert.ok(worker.calls.some(call => call.type === 'runtime.sendMessage'
    && call.message.payload?.status === 'error'));
});

test('reports one terminal error when tab-close cleanup cannot remove a persisted job', async () => {
  for (const [closedTabId, label] of [[7, 'source'], [99, 'worker']]) {
    const worker = await createWorkerContext({ storageRemoveError: 'storage unavailable' });
    const started = await startQuickAdd(worker);
    const alarmName = `lingoflash_quick_add_timeout_${started.id}`;

    for (const listener of worker.events.tabsRemoved.listeners) listener(closedTabId);
    await flushMicrotasks();
    await flushMicrotasks();

    if (closedTabId === 7) {
      const lateResult = await sendRuntimeMessage(worker, {
        type: 'APP_IMPORT_RESULT',
        bridgeType: 'LINGOFLASH_EXTENSION_RESULT',
        payload: appResultPayload(worker, started.id, { status: 'created', translation: 'muộn' }),
      }, appSender(worker));
      assert.equal(lateResult.ignored, true, 'a claimed terminal error must suppress a late success');
    }

    for (const listener of worker.events.alarms.listeners) listener({ name: alarmName });
    await flushMicrotasks();
    await flushMicrotasks();

    const terminalErrors = worker.calls.filter(call => call.type === 'runtime.sendMessage'
      && call.message.payload?.status === 'error');
    assert.equal(terminalErrors.length, 1, `${label} close must have one terminal error`);
    assert.equal(Boolean(worker.storageValues.get(`lingoflash_quick_add_job_${started.id}`).errorClaimedAt), true);
  }
});

test('defers a terminal notice until its persisted claim can be written', async () => {
  const worker = await createWorkerContext({
    storageSetError: 'storage unavailable',
    storageSetErrorAfter: 2,
  });
  const started = await startQuickAdd(worker);
  const alarmName = `lingoflash_quick_add_timeout_${started.id}`;

  for (const listener of worker.events.tabsRemoved.listeners) listener(7);
  await flushMicrotasks();
  for (const listener of worker.events.alarms.listeners) listener({ name: alarmName });
  await flushMicrotasks();

  assert.equal(worker.calls.some(call => call.type === 'runtime.sendMessage'
    && call.message.payload?.status === 'error'), false);
  assert.ok(worker.calls.filter(call => call.type === 'alarms.create'
    && call.name === alarmName).length >= 2);
});

test('cleans a job idempotently when source and worker tabs close together', async () => {
  const worker = await createWorkerContext();
  const started = await startQuickAdd(worker);
  for (const listener of worker.events.tabsRemoved.listeners) {
    listener(7);
    listener(99);
  }
  await flushMicrotasks();

  assert.equal(worker.storageValues.has(`lingoflash_quick_add_job_${started.id}`), false);
  assert.equal(worker.calls.filter(call => call.type === 'tabs.remove' && call.id === 99).length, 1);
});

test('releases the tab-removal lock after cleanup settles', async () => {
  const worker = await createWorkerContext();
  const started = await startQuickAdd(worker);
  const jobKey = `lingoflash_quick_add_job_${started.id}`;
  const originalJob = { ...worker.storageValues.get(jobKey) };

  for (const listener of worker.events.tabsRemoved.listeners) listener(99);
  await flushMicrotasks();
  assert.equal(worker.storageValues.has(jobKey), false);
  const firstErrorCount = worker.calls.filter(call => call.type === 'runtime.sendMessage'
    && call.message.payload?.status === 'error').length;

  worker.storageValues.set(jobKey, originalJob);
  for (const listener of worker.events.tabsRemoved.listeners) listener(99);
  await flushMicrotasks();

  const secondErrorCount = worker.calls.filter(call => call.type === 'runtime.sendMessage'
    && call.message.payload?.status === 'error').length;
  assert.ok(secondErrorCount > firstErrorCount);
});

test('registers the selection icon only for a granted site allowlist entry', async () => {
  const worker = await createWorkerContext({
    activeTabUrl: 'https://example.com/article',
    permissionOrigins: ['https://example.com/*'],
  });
  const response = await sendRuntimeMessage(worker, {
    type: 'ENABLE_SELECTION_ICON_SITE',
    pattern: 'https://example.com/*',
  });
  assert.equal(response.ok, true);
  assert.equal(response.enabled, true);
  assert.deepEqual(Array.from(response.sites), ['https://example.com/*']);
  assert.deepEqual(Array.from(response.permittedSites), ['https://example.com/*']);
  const registration = worker.calls.find(call => call.type === 'scripting.registerContentScripts');
  assert.equal(Array.isArray(registration?.details), true);
  const registrationDetails = registration?.details?.[0];
  assert.deepEqual(registrationDetails?.matches, ['https://example.com/*']);
  assert.deepEqual(Array.from(registrationDetails?.js ?? []), ['selection-icon.js']);
});

test('rejects the 101st selection-icon site and revokes its unused permission', async () => {
  const existingSites = Array.from({ length: 100 }, (_, index) => `https://site-${index}.example/*`);
  const newSite = 'https://site-100.example/*';
  const worker = await createWorkerContext({
    storageEntries: [[
      'lingoflash_extension_settings',
      {
        autoSpeak: false,
        bubbleDurationMs: 12000,
        recentLookupsEnabled: true,
        quickTranslateSource: 'auto',
        quickTranslateTarget: 'vi',
        selectionIconSites: existingSites,
      },
    ]],
    permissionOrigins: [...existingSites, newSite],
  });

  const response = await sendRuntimeMessage(worker, {
    type: 'ENABLE_SELECTION_ICON_SITE',
    pattern: newSite,
  });

  assert.equal(response.ok, false);
  assert.match(response.error, /100/);
  const settings = worker.storageValues.get('lingoflash_extension_settings');
  assert.equal(settings.selectionIconSites.length, 100);
  assert.equal(settings.selectionIconSites.includes(newSite), false);
  const permissionStillGranted = await new Promise(resolve => {
    worker.context.LingoFlashExtension.extensionApi.permissions.contains(
      { origins: [newSite] },
      resolve,
    );
  });
  assert.equal(permissionStillGranted, false);
});

test('rejects protected sites and ungranted floating messages', async () => {
  const worker = await createWorkerContext({ activeTabUrl: 'https://encoded-hangout-433912-h2.web.app/?view=library' });
  const protectedResponse = await sendRuntimeMessage(worker, {
    type: 'ENABLE_SELECTION_ICON_SITE',
    pattern: 'https://encoded-hangout-433912-h2.web.app/*',
  });
  assert.equal(protectedResponse.ok, false);
  const storeResponse = await sendRuntimeMessage(worker, {
    type: 'ENABLE_SELECTION_ICON_SITE',
    pattern: 'https://chromewebstore.google.com/*',
  });
  assert.equal(storeResponse.ok, false);

  const forged = await sendRuntimeMessage(worker, {
    type: 'FLOATING_SELECTION_ADD',
    text: 'resilient',
  }, { url: 'https://example.com/article', tab: { id: 7, url: 'https://example.com/article' } });
  assert.equal(forged.ok, false);
  assert.match(forged.error, /chưa được bật/);
});

test('rolls back site permission and settings when dynamic registration fails', async () => {
  const worker = await createWorkerContext({
    activeTabUrl: 'https://example.com/article',
    permissionOrigins: ['https://example.com/*'],
    registerContentScriptError: 'registration failed',
  });
  const response = await sendRuntimeMessage(worker, {
    type: 'ENABLE_SELECTION_ICON_SITE',
    pattern: 'https://example.com/*',
  });
  assert.equal(response.ok, false);
  assert.deepEqual(Array.from(worker.storageValues.get('lingoflash_extension_settings').selectionIconSites), []);
  const state = await sendRuntimeMessage(worker, { type: 'GET_SELECTION_ICON_SITES' });
  assert.deepEqual(Array.from(state.permittedSites), []);
  const permissionStillGranted = await new Promise(resolve => {
    worker.context.LingoFlashExtension.extensionApi.permissions.contains(
      { origins: ['https://example.com/*'] },
      resolve,
    );
  });
  assert.equal(permissionStillGranted, false);
});

test('permission revocation removes the allowlist, unregisters the script and disables open tabs', async () => {
  const worker = await createWorkerContext({
    activeTabUrl: 'https://example.com/article',
    permissionOrigins: ['https://example.com/*'],
  });
  await sendRuntimeMessage(worker, { type: 'ENABLE_SELECTION_ICON_SITE', pattern: 'https://example.com/*' });
  worker.calls.length = 0;
  const removed = await sendRuntimeMessage(worker, {
    type: 'DISABLE_SELECTION_ICON_SITE',
    pattern: 'https://example.com/*',
  });
  assert.equal(removed.ok, true);
  assert.deepEqual(Array.from(removed.sites), []);
  assert.equal(worker.storageValues.get('lingoflash_extension_settings').selectionIconSites.length, 0);
  assert.ok(worker.calls.some(call => call.type === 'scripting.unregisterContentScripts'));

  await sendRuntimeMessage(worker, { type: 'ENABLE_SELECTION_ICON_SITE', pattern: 'https://example.com/*' });
  worker.calls.length = 0;
  await new Promise(resolve => {
    worker.context.LingoFlashExtension.extensionApi.permissions.remove(
      { origins: ['https://example.com/*'] },
      () => resolve(),
    );
  });
  await flushMicrotasks();
  assert.deepEqual(Array.from(worker.storageValues.get('lingoflash_extension_settings').selectionIconSites), []);
  assert.ok(worker.calls.some(call => call.type === 'tabs.sendMessage' && call.message.type === 'FLOATING_SELECTION_DISABLED'));
  assert.ok(worker.calls.some(call => call.type === 'scripting.unregisterContentScripts'));
});
