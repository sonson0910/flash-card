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

test('keeps the job lifetime beyond the complete bridge path', () => {
  const values = Object.fromEntries([...backgroundSource.matchAll(/const (FALLBACK_GRACE_MS|FALLBACK_FORM_TIMEOUT_MS|FALLBACK_HANDOFF_MS|FALLBACK_BUTTON_READY_TIMEOUT_MS|BRIDGE_GENERATION_TIMEOUT_MS|JOB_CLEANUP_MARGIN_MS|JOB_TIMEOUT_MS) = ([\d_]+);/g)]
    .map(([, name, value]) => [name, Number(value.replaceAll('_', ''))]));
  assert.equal(values.BRIDGE_GENERATION_TIMEOUT_MS, 135_000);
  assert.equal(values.JOB_TIMEOUT_MS, values.FALLBACK_GRACE_MS + values.FALLBACK_FORM_TIMEOUT_MS
    + values.FALLBACK_HANDOFF_MS + values.FALLBACK_BUTTON_READY_TIMEOUT_MS
    + values.BRIDGE_GENERATION_TIMEOUT_MS + values.JOB_CLEANUP_MARGIN_MS);
  assert.ok(values.JOB_TIMEOUT_MS > 147_580);
});

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

const createWorkerContext = async ({
  executeScriptError = '',
  executeScriptRenderResult = { ok: true },
  executeScriptCaptureResult = { text: '', anchor: null, context: '' },
  captureSelectionGate = null,
  fetchImpl = null,
  storageEntries = [],
  storageGetError = '',
  storageGetFailures = null,
  storageSetError = '',
  storageSetErrorAfter = null,
  storageRemoveGate = null,
  storageRemoveError = '',
  emitTabRemovalOnRemove = false,
  timerCapMs = null,
  permissionOrigins = [],
  activeTabUrl = '',
  activeTabTitle = '',
  permissionsRequestResult = true,
  actionApiAvailable = true,
  actionBadgeError = '',
  actionBadgeGate = null,
  hasSessionStorage = true,
  registerContentScriptError = '',
  userAgent = 'Mozilla/5.0 Chrome/127.0.0.0 Safari/537.36',
  now = null,
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
    connects: makeEvent(),
  };
  const grantedOrigins = new Set(permissionOrigins);
  const storage = {
    get(key, callback) {
      if (storageGetError && (storageGetFailures === null || storageGetFailures-- > 0)) {
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
      onConnect: events.connects,
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
        callback([{ id: 7, ...(activeTabUrl ? { url: activeTabUrl } : {}), ...(activeTabTitle ? { title: activeTabTitle } : {}) }]);
      },
      get(id, callback) {
        calls.push({ type: 'tabs.get', id });
        callback(id === 7 ? { id, ...(activeTabUrl ? { url: activeTabUrl } : {}), ...(activeTabTitle ? { title: activeTabTitle } : {}) } : { id });
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
      const result = details.func?.name === 'renderInlineBubble'
        ? [{ result: executeScriptRenderResult }]
        : details.func?.name === 'captureSelectionFromPage'
          ? [{ result: executeScriptCaptureResult }]
          : [];
      if (details.func?.name === 'captureSelectionFromPage' && captureSelectionGate) {
        captureSelectionGate.then(() => callback(result));
        return;
      }
      callback(result);
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
    ...(actionApiAvailable ? {
      action: {
        setBadgeText(details, callback) {
          calls.push({ type: 'action.setBadgeText', details });
          const complete = () => {
            if (actionBadgeError) {
              chrome.runtime.lastError = { message: actionBadgeError };
              callback?.();
              chrome.runtime.lastError = null;
              return;
            }
            callback?.();
          };
          if (actionBadgeGate) actionBadgeGate.then(complete);
          else complete();
        },
      },
    } : {}),
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
    Date: now === null ? Date : { now: () => now },
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
  const connectProvider = sender => {
    const disconnect = makeEvent();
    const messages = makeEvent();
    const posted = [];
    const port = {
      name: 'sonflash-app-bridge',
      sender,
      onMessage: messages,
      onDisconnect: disconnect,
      postMessage(message) {
        posted.push(message);
        calls.push({ type: 'runtime.port.postMessage', message });
      },
      disconnect() {
        for (const listener of disconnect.listeners) listener();
      },
      posted,
    };
    for (const listener of events.connects.listeners) listener(port);
    return port;
  };
  const appPort = connectProvider({
    url: context.LingoFlashExtension.DEFAULT_APP_URL,
    tab: { id: 7 },
    frameId: 0,
  });
  await flushMicrotasks();
  calls.length = 0;

  return {
    context,
    calls,
    events,
    storageValues,
    providerId: appPort.posted.find(message => message.type === 'LINGOFLASH_EXTENSION_PROVIDER')?.providerId ?? '',
    appPort,
    connectProvider,
    failStorageReads(count) { storageGetError = 'storage unavailable'; storageGetFailures = count; },
  };
};

const sendRuntimeMessageRaw = (worker, message, sender = {}) => new Promise(resolve => {
  const [listener] = worker.events.messages.listeners;
  assert.ok(listener, 'background worker did not register a runtime message listener');
  const metadataMessageTypes = new Set([
    'GET_DECK_METADATA_GENERATION', 'SYNC_DECK_METADATA', 'CLEAR_DECK_METADATA',
    'SYNC_DUE_COUNT', 'CLEAR_DUE_COUNT',
    'SYNC_COURSE_LOCALE', 'CLEAR_COURSE_LOCALE',
  ]);
  const messageForWorker = metadataMessageTypes.has(message?.type) && message.providerId === undefined
    ? { ...message, providerId: worker.providerId }
    : message;
  const senderForWorker = metadataMessageTypes.has(message?.type) && sender.frameId === undefined
    ? { ...sender, frameId: 0 }
    : sender;
  assert.equal(listener(messageForWorker, senderForWorker, resolve), true);
});

const deckSessions = new WeakMap();
const sendRuntimeMessage = async (worker, message, sender = {}) => {
  if (['SYNC_DECK_METADATA', 'CLEAR_DECK_METADATA'].includes(message?.type)
    && message.payload?.generation === undefined) {
    const providerId = message.providerId ?? worker.providerId;
    const sessions = deckSessions.get(worker) ?? new Map();
    deckSessions.set(worker, sessions);
    let session = sessions.get(providerId);
    if (session?.scope !== message.payload.scope) {
      const issued = await sendRuntimeMessageRaw(worker, { type: 'GET_DECK_METADATA_GENERATION', providerId }, sender);
      if (!issued.ok) return issued;
      session = { scope: message.payload.scope, generation: issued.generation };
      sessions.set(providerId, session);
    }
    const response = await sendRuntimeMessageRaw(worker, {
      ...message, payload: { ...message.payload, generation: session.generation },
    }, sender);
    if (message.type === 'CLEAR_DECK_METADATA' && response.ok) sessions.delete(providerId);
    return response;
  }
  return sendRuntimeMessageRaw(worker, message, sender);
};

const startQuickAdd = worker => sendRuntimeMessage(worker, {
  type: 'ADD_SELECTION',
  text: 'resilient',
});

test('installs both Canvas context-menu actions with the localized SonFlash labels', async () => {
  const worker = await createWorkerContext();

  worker.events.installed.listeners.forEach(listener => listener());
  await flushMicrotasks();

  const menus = worker.calls.filter(call => call.type === 'contextMenus.create').map(call => call.details);
  assert.deepEqual(menus.map(menu => menu.id), ['lingoflash-translate-only', 'lingoflash-translate-save']);
  assert.equal(menus[0].title, 'SonFlash: Dịch “%s”');
  assert.equal(menus[1].title, 'SonFlash: Dịch + tạo flashcard');
  assert.deepEqual(menus.map(menu => [...menu.contexts]), [['selection'], ['selection']]);
});

test('opens the browser shortcut configuration on request', async () => {
  const worker = await createWorkerContext();

  const response = await sendRuntimeMessage(worker, { type: 'OPEN_SHORTCUTS' });

  assert.equal(response.ok, true);
  assert.ok(worker.calls.some(call => call.type === 'tabs.create'
    && call.details.url === 'chrome://extensions/shortcuts'));
});

test('opens the plain app URL when OPEN_APP has no target', async () => {
  const worker = await createWorkerContext();

  const response = await sendRuntimeMessage(worker, { type: 'OPEN_APP' });

  assert.equal(response.ok, true);
  assert.equal(response.url, worker.context.LingoFlashExtension.DEFAULT_APP_URL);
  assert.ok(worker.calls.some(call => call.type === 'tabs.create'
    && call.details.url === worker.context.LingoFlashExtension.DEFAULT_APP_URL));
});

test('opens the app on the WebWords route when OPEN_APP carries target: webWords, reusing the same message type', async () => {
  const worker = await createWorkerContext();

  const response = await sendRuntimeMessage(worker, { type: 'OPEN_APP', target: 'webWords' });

  const expectedUrl = new URL(worker.context.LingoFlashExtension.DEFAULT_APP_URL);
  expectedUrl.searchParams.set('webWords', '1');
  assert.equal(response.ok, true);
  assert.equal(response.url, expectedUrl.toString());
  assert.ok(worker.calls.some(call => call.type === 'tabs.create' && call.details.url === expectedUrl.toString()));
});

test('opens the app on the Today session route when OPEN_APP carries target: today (07.6 due-count badge)', async () => {
  const worker = await createWorkerContext();

  const response = await sendRuntimeMessage(worker, { type: 'OPEN_APP', target: 'today' });

  const expectedUrl = new URL(worker.context.LingoFlashExtension.DEFAULT_APP_URL);
  expectedUrl.searchParams.set('view', 'today');
  assert.equal(response.ok, true);
  assert.equal(response.url, expectedUrl.toString());
  assert.ok(worker.calls.some(call => call.type === 'tabs.create' && call.details.url === expectedUrl.toString()));
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

const issueDeckGeneration = (worker, sender) => sendRuntimeMessage(worker, {
  type: 'GET_DECK_METADATA_GENERATION',
}, sender).then(response => {
  assert.equal(response.ok, true);
  return response.generation;
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
  storedJob.createdAt = Date.now() - 200_000;

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
  const generation = await issueDeckGeneration(worker, sender);
  const longDeck = `  ${'Reading '.repeat(30)}  `;
  const response = await sendRuntimeMessage(worker, {
    type: 'SYNC_DECK_METADATA',
    payload: {
      scope: 'opaque_scope_a_123456',
      decks: ['Reading', 'Reading', longDeck, ...Array.from({ length: 120 }, (_, i) => `Deck ${i}`)],
      generation,
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
    payload: { scope: 'attacker_scope_123456', decks: ['Injected'], generation },
  }, { ...sender, url: 'https://example.com/?view=library' });
  assert.equal(wrongOrigin.ok, false);
  assert.match(wrongOrigin.error, /Nguồn metadata deck/);
  assert.equal(worker.storageValues.get('lingoflash_extension_deck_metadata').scope, 'opaque_scope_a_123456');
});

test('binds persisted deck generations to the live app document and rejects missing proof', async () => {
  const worker = await createWorkerContext();
  const sender = appSender(worker, 7);
  const generation = await issueDeckGeneration(worker, sender);
  assert.equal(worker.storageValues.get('lingoflash_extension_deck_metadata_generation'), generation);
  const forged = await sendRuntimeMessage(worker, { type: 'GET_DECK_METADATA_GENERATION' }, {
    ...sender, url: 'https://example.com/',
  });
  assert.equal(forged.ok, false);
  const missing = await sendRuntimeMessageRaw(worker, {
    type: 'SYNC_DECK_METADATA', payload: { scope: 'opaque_scope_generation_123456', decks: ['Reading'] },
  }, sender);
  assert.equal(missing.ok, false);
  const secondSender = appSender(worker, 8);
  assert.equal((await sendRuntimeMessage(worker, { type: 'GET_DECK_METADATA_GENERATION' }, secondSender)).ok, false);
  const secondPort = worker.connectProvider(secondSender);
  const providerId = secondPort.posted.find(message => message.type === 'LINGOFLASH_EXTENSION_PROVIDER').providerId;
  const issued = await sendRuntimeMessage(worker, { type: 'GET_DECK_METADATA_GENERATION', providerId }, secondSender);
  assert.equal(issued.ok, true);
  assert.equal((await sendRuntimeMessage(worker, {
    type: 'SYNC_DECK_METADATA', providerId,
    payload: { scope: 'opaque_scope_generation_123456', decks: ['Writing'], generation: issued.generation },
  }, secondSender)).ok, true);
  assert.equal((await sendRuntimeMessage(worker, {
    type: 'SYNC_DECK_METADATA', payload: { scope: 'opaque_scope_generation_123456', decks: ['Stale'], generation },
  }, sender)).ok, false);
});

test('does not let an evicted retired scope revive through a stale deck publisher generation', async () => {
  const worker = await createWorkerContext();
  const sender = { url: worker.context.LingoFlashExtension.DEFAULT_APP_URL, tab: { id: 7 } };
  const staleGeneration = await issueDeckGeneration(worker, sender);
  await sendRuntimeMessage(worker, {
    type: 'SYNC_DECK_METADATA', payload: { scope: 'opaque_scope_0_123456', decks: ['Owner 0'], generation: staleGeneration },
  }, sender);
  await sendRuntimeMessage(worker, {
    type: 'CLEAR_DECK_METADATA', payload: { scope: 'opaque_scope_0_123456', generation: staleGeneration },
  }, sender);
  const currentGeneration = await issueDeckGeneration(worker, sender);
  for (let index = 1; index <= 17; index += 1) {
    const response = await sendRuntimeMessage(worker, {
      type: 'SYNC_DECK_METADATA', payload: { scope: `opaque_scope_${index}_123456`, decks: [`Owner ${index}`], generation: currentGeneration },
    }, sender);
    assert.equal(response.ok, true);
  }
  const stale = await sendRuntimeMessage(worker, {
    type: 'SYNC_DECK_METADATA', payload: { scope: 'opaque_scope_0_123456', decks: ['Stale owner'], generation: staleGeneration },
  }, sender);
  assert.equal(stale.ok, false);
  assert.match(stale.error, /hết hiệu lực/);
});

test('keeps deck metadata in memory when session storage is unavailable', async () => {
  const worker = await createWorkerContext({ hasSessionStorage: false });
  const sender = {
    url: worker.context.LingoFlashExtension.DEFAULT_APP_URL,
    tab: { id: 7 },
  };
  const generation = await issueDeckGeneration(worker, sender);

  const synced = await sendRuntimeMessage(worker, {
    type: 'SYNC_DECK_METADATA',
    payload: { scope: 'opaque_memory_scope_123456', decks: ['Reading'], generation },
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
  const generation = await issueDeckGeneration(worker, sender);
  await sendRuntimeMessage(worker, {
    type: 'SYNC_DECK_METADATA',
    payload: { scope: 'opaque_scope_a_123456', decks: ['Owner A'], generation },
  }, sender);
  await sendRuntimeMessage(worker, {
    type: 'SYNC_DECK_METADATA',
    payload: { scope: 'opaque_scope_b_123456', decks: ['Owner B'], generation },
  }, sender);
  const delayedOldOwner = await sendRuntimeMessage(worker, {
    type: 'SYNC_DECK_METADATA',
    payload: { scope: 'opaque_scope_a_123456', decks: ['Stale owner A'], generation },
  }, sender);
  assert.equal(delayedOldOwner.ok, false);
  const listed = await sendRuntimeMessage(worker, { type: 'GET_DECKS' });
  assert.deepEqual([...listed.decks], ['Owner B']);

  const cleared = await sendRuntimeMessage(worker, {
    type: 'CLEAR_DECK_METADATA',
    payload: { scope: 'opaque_scope_b_123456', generation },
  }, sender);
  assert.equal(cleared.ok, true);
  assert.equal(worker.storageValues.has('lingoflash_extension_deck_metadata'), false);
  const delayedAfterSignOut = await sendRuntimeMessage(worker, {
    type: 'SYNC_DECK_METADATA',
    payload: { scope: 'opaque_scope_b_123456', decks: ['Stale after sign-out'], generation },
  }, sender);
  assert.equal(delayedAfterSignOut.ok, false);
  assert.equal(worker.storageValues.has('lingoflash_extension_deck_metadata'), false);
  assert.equal((await sendRuntimeMessage(worker, { type: 'GET_DECKS' })).ok, false);
});

test('fails closed for popup deck reads after clear delivery fails and the worker restarts', async () => {
  const worker = await createWorkerContext();
  const sender = { url: worker.context.LingoFlashExtension.DEFAULT_APP_URL, tab: { id: 7 } };
  await sendRuntimeMessage(worker, {
    type: 'SYNC_DECK_METADATA',
    payload: { scope: 'opaque_scope_a_123456', decks: ['Owner A'] },
  }, sender);

  // The clear delivery never reached the first worker. The replacement has
  // session metadata but no active app-scope proof, so the popup gets no
  // prior-owner names before the app re-synchronizes.
  const restarted = await createWorkerContext({ storageEntries: [...worker.storageValues.entries()] });
  const decks = await sendRuntimeMessage(restarted, { type: 'GET_DECKS' });
  assert.equal(decks.ok, false);
  assert.doesNotMatch(JSON.stringify(decks), /Owner A/);

  const reproof = await sendRuntimeMessage(restarted, {
    type: 'SYNC_DECK_METADATA',
    payload: { scope: 'opaque_scope_b_123456', decks: ['Owner B'] },
  }, { url: restarted.context.LingoFlashExtension.DEFAULT_APP_URL, tab: { id: 7 } });
  assert.equal(reproof.ok, true);
  assert.deepEqual([...(await sendRuntimeMessage(restarted, { type: 'GET_DECKS' })).decks], ['Owner B']);
});

test('clears all document-scoped metadata and the badge when the app bridge disconnects', async () => {
  const worker = await createWorkerContext();
  const sender = { url: worker.context.LingoFlashExtension.DEFAULT_APP_URL, tab: { id: 7 }, frameId: 0 };
  await sendRuntimeMessage(worker, {
    type: 'SYNC_DECK_METADATA',
    payload: { scope: 'opaque_scope_a_123456', decks: ['Owner A'] },
  }, sender);
  await sendRuntimeMessage(worker, {
    type: 'SYNC_DUE_COUNT',
    payload: { scope: 'opaque_scope_a_123456', count: 12 },
  }, sender);
  await sendRuntimeMessage(worker, {
    type: 'SYNC_COURSE_LOCALE',
    payload: { scope: 'opaque_scope_a_123456', nativeLanguage: 'en', targetLanguage: 'ko' },
  }, sender);
  assert.equal((await sendRuntimeMessage(worker, { type: 'GET_DUE_COUNT' })).count, 12);

  worker.appPort.disconnect();
  await flushMicrotasks();

  const invalidation = worker.calls
    .filter(call => call.type === 'runtime.sendMessage'
      && call.message?.type === 'LINGOFLASH_EXTENSION_METADATA_INVALIDATED')
    .at(-1)?.message;
  assert.equal(invalidation?.generation, 1);
  assert.equal(JSON.stringify(invalidation?.scopes), JSON.stringify({
    deck: 'opaque_scope_a_123456',
    due: 'opaque_scope_a_123456',
    locale: 'opaque_scope_a_123456',
  }));
  assert.equal((await sendRuntimeMessage(worker, { type: 'GET_DECKS' })).ok, false);
  assert.equal((await sendRuntimeMessage(worker, { type: 'GET_DUE_COUNT' })).count, null);
  const locale = await sendRuntimeMessage(worker, { type: 'GET_COURSE_LOCALE' });
  assert.equal(locale.nativeLanguage, null);
  assert.equal(locale.targetLanguage, null);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(worker.calls.filter(call => call.type === 'action.setBadgeText').at(-1)?.details?.text, '');
  assert.equal(worker.storageValues.has('lingoflash_extension_deck_metadata'), false);
  assert.equal(worker.storageValues.has('lingoflash_extension_due_count'), false);
  assert.equal(worker.storageValues.has('lingoflash_extension_course_locale'), false);
});

test('retires the old provider on a new document connection before the new document is ready', async () => {
  const worker = await createWorkerContext();
  const senderA = { url: worker.context.LingoFlashExtension.DEFAULT_APP_URL, tab: { id: 7 }, frameId: 0 };
  await sendRuntimeMessage(worker, {
    type: 'SYNC_DECK_METADATA',
    payload: { scope: 'opaque_scope_a_123456', decks: ['Owner A'] },
  }, senderA);
  await sendRuntimeMessage(worker, {
    type: 'SYNC_DUE_COUNT',
    payload: { scope: 'opaque_scope_a_due_123456', count: 12 },
  }, senderA);

  const providerA = worker.providerId;
  const portB = worker.connectProvider({
    url: worker.context.LingoFlashExtension.DEFAULT_APP_URL,
    tab: { id: 8 },
    frameId: 0,
  });
  const providerB = portB.posted.find(message => message.type === 'LINGOFLASH_EXTENSION_PROVIDER')?.providerId;
  assert.ok(providerB);
  assert.notEqual(providerB, providerA);

  assert.equal((await sendRuntimeMessage(worker, { type: 'GET_DECKS' })).ok, false);
  assert.equal((await sendRuntimeMessage(worker, { type: 'GET_DUE_COUNT' })).count, null);
  const beforeReady = await sendRuntimeMessage(worker, { type: 'GET_COURSE_LOCALE' });
  assert.equal(beforeReady.nativeLanguage, null);
  assert.equal(beforeReady.targetLanguage, null);

  const staleA = await sendRuntimeMessage(worker, {
    type: 'SYNC_DECK_METADATA',
    providerId: providerA,
    payload: { scope: 'opaque_scope_a_stale_123456', decks: ['Stale A'] },
  }, senderA);
  assert.equal(staleA.ok, false);

  const senderB = { url: worker.context.LingoFlashExtension.DEFAULT_APP_URL, tab: { id: 8 }, frameId: 0 };
  const fresh = await sendRuntimeMessage(worker, {
    type: 'SYNC_DECK_METADATA',
    providerId: providerB,
    payload: { scope: 'opaque_scope_b_123456', decks: ['Owner B'] },
  }, senderB);
  assert.equal(fresh.ok, true);
  const freshDue = await sendRuntimeMessage(worker, {
    type: 'SYNC_DUE_COUNT',
    providerId: providerB,
    payload: { scope: 'opaque_scope_b_due_123456', count: 3 },
  }, senderB);
  assert.equal(freshDue.ok, true);
  const freshLocale = await sendRuntimeMessage(worker, {
    type: 'SYNC_COURSE_LOCALE',
    providerId: providerB,
    payload: { scope: 'opaque_scope_b_locale_123456', nativeLanguage: 'en', targetLanguage: 'ja' },
  }, senderB);
  assert.equal(freshLocale.ok, true);
  assert.deepEqual([...(await sendRuntimeMessage(worker, { type: 'GET_DECKS' })).decks], ['Owner B']);
  assert.equal((await sendRuntimeMessage(worker, { type: 'GET_DUE_COUNT' })).count, 3);
  const currentLocale = await sendRuntimeMessage(worker, { type: 'GET_COURSE_LOCALE' });
  assert.equal(currentLocale.nativeLanguage, 'en');
  assert.equal(currentLocale.targetLanguage, 'ja');

  const lateClear = await sendRuntimeMessage(worker, {
    type: 'CLEAR_DUE_COUNT',
    providerId: providerA,
    payload: { scope: 'opaque_scope_b_due_123456' },
  }, senderA);
  assert.equal(lateClear.ok, false);
  assert.equal((await sendRuntimeMessage(worker, { type: 'GET_DUE_COUNT' })).count, 3);
});

test('does not let a stale provider write after a newer provider claims the bridge', async () => {
  const worker = await createWorkerContext();
  const senderA = { url: worker.context.LingoFlashExtension.DEFAULT_APP_URL, tab: { id: 7 }, frameId: 0 };
  const providerA = worker.providerId;
  const stale = sendRuntimeMessage(worker, {
    type: 'SYNC_DECK_METADATA',
    providerId: providerA,
    payload: { scope: 'opaque_scope_a_async_123456', decks: ['Stale A'] },
  }, senderA);

  const portB = worker.connectProvider({
    url: worker.context.LingoFlashExtension.DEFAULT_APP_URL,
    tab: { id: 8 },
    frameId: 0,
  });
  const providerB = portB.posted.find(message => message.type === 'LINGOFLASH_EXTENSION_PROVIDER')?.providerId;
  assert.ok(providerB);
  assert.equal((await stale).ok, false);
  assert.equal(worker.storageValues.has('lingoflash_extension_deck_metadata'), false);

  const fresh = await sendRuntimeMessage(worker, {
    type: 'SYNC_DUE_COUNT',
    providerId: providerB,
    payload: { scope: 'opaque_scope_b_async_123456', count: 3 },
  }, { url: worker.context.LingoFlashExtension.DEFAULT_APP_URL, tab: { id: 8 }, frameId: 0 });
  assert.equal(fresh.ok, true);
  assert.equal((await sendRuntimeMessage(worker, { type: 'GET_DUE_COUNT' })).count, 3);
});

test('rejects metadata writes from the wrong origin or frame without disturbing the live provider', async () => {
  const worker = await createWorkerContext();
  const validSender = { url: worker.context.LingoFlashExtension.DEFAULT_APP_URL, tab: { id: 7 }, frameId: 0 };
  await sendRuntimeMessage(worker, {
    type: 'SYNC_DUE_COUNT',
    payload: { scope: 'opaque_scope_valid_123456', count: 4 },
  }, validSender);

  const wrongOrigin = await sendRuntimeMessage(worker, {
    type: 'SYNC_DUE_COUNT',
    providerId: worker.providerId,
    payload: { scope: 'opaque_scope_evil_123456', count: 999 },
  }, { url: 'https://example.com/?view=library', tab: { id: 7 }, frameId: 0 });
  assert.equal(wrongOrigin.ok, false);

  const wrongFrame = await sendRuntimeMessage(worker, {
    type: 'SYNC_COURSE_LOCALE',
    providerId: worker.providerId,
    payload: { scope: 'opaque_scope_frame_123456', nativeLanguage: 'en', targetLanguage: 'ja' },
  }, { ...validSender, frameId: 2 });
  assert.equal(wrongFrame.ok, false);
  assert.equal((await sendRuntimeMessage(worker, { type: 'GET_DUE_COUNT' })).count, 4);
});

test('does not register app bridge ports from the wrong origin or a child frame', async () => {
  const worker = await createWorkerContext();
  const wrongOrigin = worker.connectProvider({
    url: 'https://example.com/?view=library',
    tab: { id: 8 },
    frameId: 0,
  });
  const wrongFrame = worker.connectProvider({
    url: worker.context.LingoFlashExtension.DEFAULT_APP_URL,
    tab: { id: 8 },
    frameId: 1,
  });

  assert.equal(wrongOrigin.posted.length, 0);
  assert.equal(wrongFrame.posted.length, 0);
  assert.equal((await sendRuntimeMessage(worker, { type: 'GET_DUE_COUNT' })).count, null);
  const fresh = await sendRuntimeMessage(worker, {
    type: 'SYNC_DUE_COUNT',
    payload: { scope: 'opaque_scope_valid_after_reject_123456', count: 2 },
  }, { url: worker.context.LingoFlashExtension.DEFAULT_APP_URL, tab: { id: 7 }, frameId: 0 });
  assert.equal(fresh.ok, true);
});

test('keeps the visible Korean provider through a hidden import-tab handoff and its second capture', async () => {
  const worker = await createWorkerContext();
  const visibleSender = {
    url: worker.context.LingoFlashExtension.DEFAULT_APP_URL,
    tab: { id: 7 },
    frameId: 0,
  };
  await sendRuntimeMessage(worker, {
    type: 'SYNC_COURSE_LOCALE',
    payload: { scope: 'opaque_scope_korean_123456', nativeLanguage: 'vi', targetLanguage: 'ko' },
  }, visibleSender);

  const first = await startQuickAdd(worker);
  assert.equal(worker.storageValues.get(`lingoflash_quick_add_job_${first.id}`).sourceLanguage, 'ko');
  const failed = await sendRuntimeMessage(worker, {
    type: 'APP_IMPORT_RESULT',
    bridgeType: 'LINGOFLASH_EXTENSION_RESULT',
    payload: appResultPayload(worker, first.id, { status: 'error', message: 'retry later' }),
  }, appSender(worker));
  assert.equal(failed.ok, true);

  const handoffPort = worker.connectProvider({
    url: `${worker.context.LingoFlashExtension.DEFAULT_APP_URL}#lf-import=handoff_123456789012345678`,
    tab: { id: 99 },
    frameId: 0,
  });
  handoffPort.disconnect();
  assert.equal(handoffPort.posted.length, 0);

  const second = await startQuickAdd(worker);
  assert.equal(worker.storageValues.get(`lingoflash_quick_add_job_${second.id}`).sourceLanguage, 'ko');
});

test('rejects a provider-bound capture when a replacement provider claims the app before import verification', async () => {
  const worker = await createWorkerContext();
  const visibleSender = {
    url: worker.context.LingoFlashExtension.DEFAULT_APP_URL,
    tab: { id: 7 },
    frameId: 0,
  };
  await sendRuntimeMessage(worker, {
    type: 'SYNC_DECK_METADATA',
    payload: { scope: 'opaque_scope_bound_a_123456', decks: ['Owner A'] },
  }, visibleSender);
  const started = await startQuickAdd(worker);
  const job = worker.storageValues.get(`lingoflash_quick_add_job_${started.id}`);
  assert.equal(job.providerScope, 'opaque_scope_bound_a_123456');
  const intent = readStartedIntent(worker, started.id);

  const replacementPort = worker.connectProvider({
    url: worker.context.LingoFlashExtension.DEFAULT_APP_URL,
    tab: { id: 8 },
    frameId: 0,
  });
  const replacementProvider = replacementPort.posted.find(message => message.type === 'LINGOFLASH_EXTENSION_PROVIDER')?.providerId;
  await sendRuntimeMessage(worker, {
    type: 'SYNC_DECK_METADATA',
    providerId: replacementProvider,
    payload: { scope: 'opaque_scope_bound_b_123456', decks: ['Owner B'] },
  }, { url: worker.context.LingoFlashExtension.DEFAULT_APP_URL, tab: { id: 8 }, frameId: 0 });

  const verified = await verifyIntent(worker, intent, appSender(worker));
  assert.equal(verified.verified, false);
  assert.equal(worker.storageValues.get(`lingoflash_quick_add_job_${started.id}`).importClaimedAt, undefined);
});

test('binds a capture to the current provider before deck metadata is ready', async () => {
  const worker = await createWorkerContext();
  const senderA = {
    url: worker.context.LingoFlashExtension.DEFAULT_APP_URL,
    tab: { id: 7 },
    frameId: 0,
  };
  await sendRuntimeMessage(worker, {
    type: 'SYNC_DUE_COUNT',
    payload: { scope: 'opaque_scope_capture_owner_a_123456', count: 4 },
  }, senderA);

  const started = await startQuickAdd(worker);
  const job = worker.storageValues.get(`lingoflash_quick_add_job_${started.id}`);
  assert.equal(typeof job.providerId, 'string');
  assert.equal(Number.isSafeInteger(job.providerGeneration), true);
  assert.equal(job.providerScope, 'opaque_scope_capture_owner_a_123456');
  assert.equal(job.providerScopeChannel, 'due');
  const intent = readStartedIntent(worker, started.id);

  const replacementPort = worker.connectProvider({
    url: worker.context.LingoFlashExtension.DEFAULT_APP_URL,
    tab: { id: 8 },
    frameId: 0,
  });
  const replacementProvider = replacementPort.posted.find(message => message.type === 'LINGOFLASH_EXTENSION_PROVIDER')?.providerId;
  await sendRuntimeMessage(worker, {
    type: 'SYNC_DUE_COUNT',
    providerId: replacementProvider,
    payload: { scope: 'opaque_scope_capture_owner_b_123456', count: 9 },
  }, { url: worker.context.LingoFlashExtension.DEFAULT_APP_URL, tab: { id: 8 }, frameId: 0 });

  const verified = await verifyIntent(worker, intent, appSender(worker));
  assert.equal(verified.verified, false);
  assert.equal(worker.storageValues.get(`lingoflash_quick_add_job_${started.id}`).importClaimedAt, undefined);
});

test('leaves the language of an unbound capture unknown even when a provider appears during it', async () => {
  let releaseCapture;
  const captureSelectionGate = new Promise(resolve => { releaseCapture = resolve; });
  const worker = await createWorkerContext({ captureSelectionGate });
  const pendingCapture = startQuickAdd(worker);
  await flushMicrotasks();

  const providerPort = worker.connectProvider({
    url: worker.context.LingoFlashExtension.DEFAULT_APP_URL,
    tab: { id: 8 },
    frameId: 0,
  });
  const providerId = providerPort.posted.find(message => message.type === 'LINGOFLASH_EXTENSION_PROVIDER')?.providerId;
  assert.ok(providerId);
  const synced = await sendRuntimeMessage(worker, {
    type: 'SYNC_COURSE_LOCALE',
    providerId,
    payload: { scope: 'opaque_scope_mid_capture_123456', nativeLanguage: 'en', targetLanguage: 'ko' },
  }, {
    url: worker.context.LingoFlashExtension.DEFAULT_APP_URL,
    tab: { id: 8 },
    frameId: 0,
  });
  assert.equal(synced.ok, true);

  releaseCapture();
  const started = await pendingCapture;
  const job = worker.storageValues.get(`lingoflash_quick_add_job_${started.id}`);
  assert.equal(job.sourceLanguage, undefined);
  assert.equal(job.providerId, undefined);
  assert.equal(job.providerScope, undefined);

  const verified = await verifyIntent(worker, readStartedIntent(worker, started.id), appSender(worker));
  assert.equal(verified.verified, true);
  assert.equal('sourceLanguage' in verified.intent, false);
});

test('rejects a capture after the same app port rotates its confirmed owner scope', async () => {
  const worker = await createWorkerContext();
  const sender = {
    url: worker.context.LingoFlashExtension.DEFAULT_APP_URL,
    tab: { id: 7 },
    frameId: 0,
  };
  await sendRuntimeMessage(worker, {
    type: 'SYNC_DUE_COUNT',
    payload: { scope: 'opaque_scope_same_port_owner_a_123456', count: 4 },
  }, sender);

  const started = await startQuickAdd(worker);
  const job = worker.storageValues.get(`lingoflash_quick_add_job_${started.id}`);
  assert.equal(job.providerScope, 'opaque_scope_same_port_owner_a_123456');
  assert.equal(job.providerScopeChannel, 'due');
  const intent = readStartedIntent(worker, started.id);

  const rotated = await sendRuntimeMessage(worker, {
    type: 'SYNC_DUE_COUNT',
    payload: { scope: 'opaque_scope_same_port_owner_b_123456', count: 8 },
  }, sender);
  assert.equal(rotated.ok, true);
  assert.equal((await sendRuntimeMessage(worker, { type: 'GET_DUE_COUNT' })).count, 8);

  const verified = await verifyIntent(worker, intent, appSender(worker));
  assert.equal(verified.verified, false);
  assert.equal(worker.storageValues.get(`lingoflash_quick_add_job_${started.id}`).importClaimedAt, undefined);
});

test('syncs a real due count from the app origin and scopes it like deck metadata (07.6)', async () => {
  const worker = await createWorkerContext();
  const sender = { url: worker.context.LingoFlashExtension.DEFAULT_APP_URL, tab: { id: 7 } };

  const before = await sendRuntimeMessage(worker, { type: 'GET_DUE_COUNT' });
  assert.equal(before.ok, true);
  assert.equal(before.count, null);

  const synced = await sendRuntimeMessage(worker, {
    type: 'SYNC_DUE_COUNT',
    payload: { scope: 'opaque_scope_a_123456', count: 12 },
  }, sender);
  assert.equal(synced.ok, true);
  assert.equal(synced.count, 12);

  const after = await sendRuntimeMessage(worker, { type: 'GET_DUE_COUNT' });
  assert.equal(after.ok, true);
  assert.equal(after.count, 12);

  const wrongOrigin = await sendRuntimeMessage(worker, {
    type: 'SYNC_DUE_COUNT',
    payload: { scope: 'attacker_scope_123456', count: 999 },
  }, { ...sender, url: 'https://example.com/?view=library' });
  assert.equal(wrongOrigin.ok, false);
  assert.match(wrongOrigin.error, /Nguồn due-count/);
  assert.equal((await sendRuntimeMessage(worker, { type: 'GET_DUE_COUNT' })).count, 12);
});

test('mirrors only confirmed due counts to the browser action badge and clears it on scope retirement', async () => {
  const worker = await createWorkerContext();
  const sender = { url: worker.context.LingoFlashExtension.DEFAULT_APP_URL, tab: { id: 7 } };

  await sendRuntimeMessage(worker, {
    type: 'SYNC_DUE_COUNT',
    payload: { scope: 'opaque_scope_a_123456', count: 12 },
  }, sender);
  assert.equal(worker.calls.filter(call => call.type === 'action.setBadgeText').at(-1)?.details?.text, '12');

  await sendRuntimeMessage(worker, {
    type: 'CLEAR_DUE_COUNT',
    payload: { scope: 'opaque_scope_a_123456' },
  }, sender);
  assert.equal(worker.calls.filter(call => call.type === 'action.setBadgeText').at(-1)?.details?.text, '');

  await sendRuntimeMessage(worker, {
    type: 'SYNC_DUE_COUNT',
    payload: { scope: 'opaque_scope_b_123456', count: 0 },
  }, sender);
  assert.equal(worker.calls.filter(call => call.type === 'action.setBadgeText').at(-1)?.details?.text, '');
});

test('ignores a stale clear after the next account has synchronized its badge', async () => {
  const worker = await createWorkerContext();
  const sender = { url: worker.context.LingoFlashExtension.DEFAULT_APP_URL, tab: { id: 7 } };
  await sendRuntimeMessage(worker, {
    type: 'SYNC_DUE_COUNT',
    payload: { scope: 'opaque_scope_a_123456', count: 12 },
  }, sender);
  await sendRuntimeMessage(worker, {
    type: 'SYNC_DUE_COUNT',
    payload: { scope: 'opaque_scope_b_123456', count: 3 },
  }, sender);
  await sendRuntimeMessage(worker, {
    type: 'CLEAR_DUE_COUNT',
    payload: { scope: 'opaque_scope_a_123456' },
  }, sender);

  assert.equal((await sendRuntimeMessage(worker, { type: 'GET_DUE_COUNT' })).count, 3);
  assert.equal(worker.calls.filter(call => call.type === 'action.setBadgeText').at(-1)?.details?.text, '3');
});

test('serializes the startup badge reset before the first due-count sync', async () => {
  let releaseBadgeGate;
  const actionBadgeGate = new Promise(resolve => { releaseBadgeGate = resolve; });
  const worker = await createWorkerContext({ actionBadgeGate });
  const sender = { url: worker.context.LingoFlashExtension.DEFAULT_APP_URL, tab: { id: 7 } };
  const synced = sendRuntimeMessage(worker, {
    type: 'SYNC_DUE_COUNT',
    payload: { scope: 'opaque_scope_a_123456', count: 12 },
  }, sender);

  await flushMicrotasks();
  assert.equal(worker.calls.filter(call => call.type === 'action.setBadgeText').length, 0);
  releaseBadgeGate();
  assert.equal((await synced).ok, true);
  assert.equal(worker.calls.filter(call => call.type === 'action.setBadgeText').at(-1)?.details?.text, '12');
});

test('keeps the scoped popup count when action badges are unsupported or fail', async () => {
  const senderFor = worker => ({ url: worker.context.LingoFlashExtension.DEFAULT_APP_URL, tab: { id: 7 } });
  for (const worker of [
    await createWorkerContext({ actionApiAvailable: false }),
    await createWorkerContext({ actionBadgeError: 'Badge API failed' }),
  ]) {
    const synced = await sendRuntimeMessage(worker, {
      type: 'SYNC_DUE_COUNT',
      payload: { scope: 'opaque_scope_a_123456', count: 12 },
    }, senderFor(worker));
    assert.equal(synced.ok, true);
    assert.equal((await sendRuntimeMessage(worker, { type: 'GET_DUE_COUNT' })).count, 12);
  }
});

test('never leaks a previous account due count after reconnect/account switch (07.6)', async () => {
  const worker = await createWorkerContext();
  const sender = { url: worker.context.LingoFlashExtension.DEFAULT_APP_URL, tab: { id: 7 } };
  await sendRuntimeMessage(worker, {
    type: 'SYNC_DUE_COUNT',
    payload: { scope: 'opaque_scope_a_123456', count: 12 },
  }, sender);

  // The clear delivery never reached the first worker. A restarted worker has
  // the session metadata but no active-scope proof, so the popup gets no
  // prior-owner count until the app re-syncs.
  const restarted = await createWorkerContext({ storageEntries: [...worker.storageValues.entries()] });
  const stale = await sendRuntimeMessage(restarted, { type: 'GET_DUE_COUNT' });
  assert.equal(stale.ok, true);
  assert.equal(stale.count, null);

  const reproof = await sendRuntimeMessage(restarted, {
    type: 'SYNC_DUE_COUNT',
    payload: { scope: 'opaque_scope_b_123456', count: 3 },
  }, { url: restarted.context.LingoFlashExtension.DEFAULT_APP_URL, tab: { id: 7 } });
  assert.equal(reproof.ok, true);
  assert.equal((await sendRuntimeMessage(restarted, { type: 'GET_DUE_COUNT' })).count, 3);

  const cleared = await sendRuntimeMessage(restarted, {
    type: 'CLEAR_DUE_COUNT',
    payload: { scope: 'opaque_scope_b_123456' },
  }, { url: restarted.context.LingoFlashExtension.DEFAULT_APP_URL, tab: { id: 7 } });
  assert.equal(cleared.ok, true);
  assert.equal(cleared.cleared, true);
  assert.equal((await sendRuntimeMessage(restarted, { type: 'GET_DUE_COUNT' })).count, null);

  // A retired scope can never resurface a due count even if replayed.
  const replay = await sendRuntimeMessage(restarted, {
    type: 'SYNC_DUE_COUNT',
    payload: { scope: 'opaque_scope_b_123456', count: 3 },
  }, { url: restarted.context.LingoFlashExtension.DEFAULT_APP_URL, tab: { id: 7 } });
  assert.equal(replay.ok, false);
  assert.match(replay.error, /hết hiệu lực/);
});

test('syncs a real course locale from the app origin and scopes it like deck metadata/due count (07.5)', async () => {
  const worker = await createWorkerContext();
  const sender = { url: worker.context.LingoFlashExtension.DEFAULT_APP_URL, tab: { id: 7 } };

  const before = await sendRuntimeMessage(worker, { type: 'GET_COURSE_LOCALE' });
  assert.equal(before.ok, true);
  assert.equal(before.nativeLanguage, null);
  assert.equal(before.targetLanguage, null);

  const synced = await sendRuntimeMessage(worker, {
    type: 'SYNC_COURSE_LOCALE',
    payload: { scope: 'opaque_scope_a_123456', nativeLanguage: 'en', targetLanguage: 'ko' },
  }, sender);
  assert.equal(synced.ok, true);
  assert.equal(synced.nativeLanguage, 'en');
  assert.equal(synced.targetLanguage, 'ko');

  const after = await sendRuntimeMessage(worker, { type: 'GET_COURSE_LOCALE' });
  assert.equal(after.ok, true);
  assert.equal(after.nativeLanguage, 'en');
  assert.equal(after.targetLanguage, 'ko');

  const wrongOrigin = await sendRuntimeMessage(worker, {
    type: 'SYNC_COURSE_LOCALE',
    payload: { scope: 'attacker_scope_123456', nativeLanguage: 'vi', targetLanguage: 'en' },
  }, { ...sender, url: 'https://example.com/?view=library' });
  assert.equal(wrongOrigin.ok, false);
  assert.match(wrongOrigin.error, /Nguồn course locale/);
  const stillAfter = await sendRuntimeMessage(worker, { type: 'GET_COURSE_LOCALE' });
  assert.equal(stillAfter.nativeLanguage, 'en');
  assert.equal(stillAfter.targetLanguage, 'ko');

  const invalidPair = await sendRuntimeMessage(worker, {
    type: 'SYNC_COURSE_LOCALE',
    payload: { scope: 'opaque_scope_c_123456', nativeLanguage: 'fr', targetLanguage: 'ko' },
  }, sender);
  assert.equal(invalidPair.ok, false);
  assert.match(invalidPair.error, /Course locale/);
});

test('never leaks a previous account course locale after reconnect/account switch (07.5)', async () => {
  const worker = await createWorkerContext();
  const sender = { url: worker.context.LingoFlashExtension.DEFAULT_APP_URL, tab: { id: 7 } };
  await sendRuntimeMessage(worker, {
    type: 'SYNC_COURSE_LOCALE',
    payload: { scope: 'opaque_scope_a_123456', nativeLanguage: 'vi', targetLanguage: 'en' },
  }, sender);

  // The clear delivery never reached the first worker. A restarted worker has
  // the session metadata but no active-scope proof, so the popup/capture get
  // no prior-owner course locale until the app re-syncs.
  const restarted = await createWorkerContext({ storageEntries: [...worker.storageValues.entries()] });
  const stale = await sendRuntimeMessage(restarted, { type: 'GET_COURSE_LOCALE' });
  assert.equal(stale.ok, true);
  assert.equal(stale.nativeLanguage, null);
  assert.equal(stale.targetLanguage, null);

  const reproof = await sendRuntimeMessage(restarted, {
    type: 'SYNC_COURSE_LOCALE',
    payload: { scope: 'opaque_scope_b_123456', nativeLanguage: 'en', targetLanguage: 'ja' },
  }, { url: restarted.context.LingoFlashExtension.DEFAULT_APP_URL, tab: { id: 7 } });
  assert.equal(reproof.ok, true);
  const afterReproof = await sendRuntimeMessage(restarted, { type: 'GET_COURSE_LOCALE' });
  assert.equal(afterReproof.nativeLanguage, 'en');
  assert.equal(afterReproof.targetLanguage, 'ja');

  const cleared = await sendRuntimeMessage(restarted, {
    type: 'CLEAR_COURSE_LOCALE',
    payload: { scope: 'opaque_scope_b_123456' },
  }, { url: restarted.context.LingoFlashExtension.DEFAULT_APP_URL, tab: { id: 7 } });
  assert.equal(cleared.ok, true);
  assert.equal(cleared.cleared, true);
  const afterClear = await sendRuntimeMessage(restarted, { type: 'GET_COURSE_LOCALE' });
  assert.equal(afterClear.nativeLanguage, null);
  assert.equal(afterClear.targetLanguage, null);
  const notReadyCapture = await startQuickAdd(restarted);
  assert.equal(notReadyCapture.ok, false);
  assert.match(notReadyCapture.error, /chưa xác nhận metadata/);
  restarted.appPort.disconnect();
  await flushMicrotasks();
  const freshCapture = await startQuickAdd(restarted);
  assert.equal(restarted.storageValues.get(`lingoflash_quick_add_job_${freshCapture.id}`).sourceLanguage, undefined);

  // A retired scope can never resurface a course locale even if replayed.
  const replay = await sendRuntimeMessage(restarted, {
    type: 'SYNC_COURSE_LOCALE',
    payload: { scope: 'opaque_scope_b_123456', nativeLanguage: 'en', targetLanguage: 'ja' },
  }, { url: restarted.context.LingoFlashExtension.DEFAULT_APP_URL, tab: { id: 7 } });
  assert.equal(replay.ok, false);
  assert.match(replay.error, /hết hiệu lực/);
});

test('a fresh capture assumes the synced course target language instead of the fixed English default (07.5)', async () => {
  const worker = await createWorkerContext();
  const sender = { url: worker.context.LingoFlashExtension.DEFAULT_APP_URL, tab: { id: 7 } };
  await sendRuntimeMessage(worker, {
    type: 'SYNC_COURSE_LOCALE',
    payload: { scope: 'opaque_scope_a_123456', nativeLanguage: 'en', targetLanguage: 'ko' },
  }, sender);

  const started = await startQuickAdd(worker);
  assert.equal(worker.storageValues.get(`lingoflash_quick_add_job_${started.id}`).sourceLanguage, 'ko');

  const intent = readStartedIntent(worker, started.id);
  const verified = await verifyIntent(worker, intent, { url: sender.url, tab: { id: 99 }, frameId: 0 });
  assert.equal(verified.verified, true);
  assert.equal(verified.intent.sourceLanguage, 'ko');

  const valid = await sendRuntimeMessage(worker, {
    type: 'APP_IMPORT_RESULT',
    bridgeType: 'LINGOFLASH_EXTENSION_RESULT',
    payload: appResultPayload(worker, started.id, { status: 'created', translation: '회복력' }),
  }, appSender(worker));
  assert.equal(valid.ignored, false);
  const statusCall = worker.calls.find(call => call.type === 'runtime.sendMessage'
    && call.message.payload?.status === 'created');
  assert.equal(statusCall?.message.payload?.sourceLanguage, 'ko');
  assert.equal(statusCall?.message.payload?.speechLocale, 'ko-KR');
});

test('relays a known failure reason to the bubble and popup and drops an unknown one', async () => {
  for (const [reason, expected] of [['quota-daily', 'quota-daily'], ['not-in-the-list', undefined]]) {
    const worker = await createWorkerContext();
    const started = await startQuickAdd(worker);
    const result = await sendRuntimeMessage(worker, {
      type: 'APP_IMPORT_RESULT',
      bridgeType: 'LINGOFLASH_EXTENSION_RESULT',
      payload: appResultPayload(worker, started.id, { status: 'error', message: 'Anything', reason }),
    }, appSender(worker));
    assert.equal(result.ignored, false);
    const popupStatus = worker.calls.find(call => call.type === 'runtime.sendMessage'
      && call.message.payload?.status === 'error');
    assert.equal(popupStatus?.message.payload?.reason, expected);
    assert.equal(popupStatus?.message.payload?.message, 'Anything');
    const bubble = worker.calls.filter(call => call.type === 'scripting.executeScript')
      .map(call => call.details.args?.[0]).find(args => args?.status === 'error');
    assert.equal(bubble?.reason, expected);
  }
});

test('a fresh capture reports no language when no course locale has ever been synced', async () => {
  const worker = await createWorkerContext();
  const started = await startQuickAdd(worker);
  assert.equal(worker.storageValues.get(`lingoflash_quick_add_job_${started.id}`).sourceLanguage, undefined);

  const intent = readStartedIntent(worker, started.id);
  const verified = await verifyIntent(worker, intent, {
    url: worker.context.LingoFlashExtension.DEFAULT_APP_URL,
    tab: { id: 99 },
    frameId: 0,
  });
  assert.equal(verified.verified, true);
  assert.equal('sourceLanguage' in verified.intent, false);
});

test('a context-menu save with no app tab open reports no language instead of English', async () => {
  const worker = await createWorkerContext({
    executeScriptCaptureResult: { text: '회복력', anchor: null, context: '회복력이 중요하다.' },
  });
  const sender = { url: worker.context.LingoFlashExtension.DEFAULT_APP_URL, tab: { id: 7 } };
  await sendRuntimeMessage(worker, {
    type: 'SYNC_COURSE_LOCALE',
    payload: { scope: 'opaque_scope_korean_learner_123456', nativeLanguage: 'vi', targetLanguage: 'ko' },
  }, sender);
  worker.appPort.disconnect();
  await flushMicrotasks();

  for (const listener of worker.events.menuClicks.listeners) {
    listener({ menuItemId: 'lingoflash-translate-save', selectionText: '회복력' }, { id: 12 });
  }
  for (let round = 0; round < 20; round += 1) await flushMicrotasks();
  const jobs = [...worker.storageValues.entries()]
    .filter(([key]) => key.startsWith('lingoflash_quick_add_job_'))
    .map(([, value]) => value);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].sourceLanguage, undefined);

  const verified = await verifyIntent(worker, {
    v: jobs[0].v, id: jobs[0].id, nonce: jobs[0].nonce, text: jobs[0].text, createdAt: jobs[0].createdAt, mode: 'silent',
  }, appSender(worker));
  assert.equal(verified.verified, true);
  assert.equal('sourceLanguage' in verified.intent, false);
});

test('a capture bound only through the due-count channel reports no language', async () => {
  const worker = await createWorkerContext();
  await sendRuntimeMessage(worker, {
    type: 'SYNC_DUE_COUNT',
    payload: { scope: 'opaque_scope_due_only_owner_123456', count: 3 },
  }, { url: worker.context.LingoFlashExtension.DEFAULT_APP_URL, tab: { id: 7 }, frameId: 0 });

  const started = await startQuickAdd(worker);
  const job = worker.storageValues.get(`lingoflash_quick_add_job_${started.id}`);
  assert.equal(job.providerScopeChannel, 'due');
  assert.equal(job.sourceLanguage, undefined);

  const verified = await verifyIntent(worker, readStartedIntent(worker, started.id), appSender(worker));
  assert.equal(verified.verified, true);
  assert.equal('sourceLanguage' in verified.intent, false);
});

test('still delivers the language a job queued by the previous extension version was stored with', async () => {
  const worker = await createWorkerContext();
  const started = await startQuickAdd(worker);
  const key = `lingoflash_quick_add_job_${started.id}`;
  worker.storageValues.set(key, { ...worker.storageValues.get(key), sourceLanguage: 'en' });

  const verified = await verifyIntent(worker, readStartedIntent(worker, started.id), appSender(worker));
  assert.equal(verified.verified, true);
  assert.equal(verified.intent.sourceLanguage, 'en');
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

test('captures the source tab URL and title, delivers them through the verified intent, and ignores a forged override', async () => {
  const worker = await createWorkerContext({
    activeTabUrl: 'https://example.com/article?utm=1#frag',
    activeTabTitle: 'An Example Article',
  });

  const started = await startQuickAdd(worker);
  const job = worker.storageValues.get(`lingoflash_quick_add_job_${started.id}`);
  assert.equal(job.sourceUrl, 'https://example.com/article');
  assert.equal(job.pageTitle, 'An Example Article');
  assert.ok(worker.calls.some(call => call.type === 'tabs.get' && call.id === 7));

  const intent = readStartedIntent(worker, started.id);
  const verified = await verifyIntent(worker, {
    ...intent,
    sourceUrl: 'https://forged.example/',
    pageTitle: 'Forged title',
  }, {
    url: worker.context.LingoFlashExtension.DEFAULT_APP_URL,
    tab: { id: 99 },
    frameId: 0,
  });
  assert.equal(verified.verified, true);
  assert.equal(verified.intent.sourceUrl, 'https://example.com/article');
  assert.equal(verified.intent.pageTitle, 'An Example Article');
});

test('never captures a non-http(s) source URL and bounds an oversized page title', async () => {
  const worker = await createWorkerContext({
    activeTabUrl: 'chrome://extensions/',
    activeTabTitle: `Extensions ${'x'.repeat(400)}`,
  });

  const started = await startQuickAdd(worker);
  const job = worker.storageValues.get(`lingoflash_quick_add_job_${started.id}`);
  assert.equal(job.sourceUrl, '');
  assert.equal(job.pageTitle.length, 256);
});

test('omits source metadata entirely when the active tab exposes neither a URL nor a title', async () => {
  const worker = await createWorkerContext();

  const started = await startQuickAdd(worker);
  const job = worker.storageValues.get(`lingoflash_quick_add_job_${started.id}`);
  assert.equal(job.sourceUrl, '');
  assert.equal(job.pageTitle, '');

  const intent = readStartedIntent(worker, started.id);
  const verified = await verifyIntent(worker, intent, {
    url: worker.context.LingoFlashExtension.DEFAULT_APP_URL,
    tab: { id: 99 },
    frameId: 0,
  });
  assert.equal(verified.verified, true);
  assert.equal('sourceUrl' in verified.intent, false);
  assert.equal('pageTitle' in verified.intent, false);
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
      aiGenerated: true,
      language: 'en',
    },
  }, appSender(worker));

  assert.equal(valid.ignored, false);
  const statusCall = worker.calls.find(call => call.type === 'runtime.sendMessage'
    && call.message.payload?.status === 'created');
  assert.equal(statusCall?.message.payload?.phonetic, '/bɛːn/');
  assert.equal(statusCall?.message.payload?.explanation, 'Có khả năng phục hồi.');
  assert.equal(statusCall?.message.payload?.exampleSentence, 'She is resilient.');
  assert.equal(statusCall?.message.payload?.exampleTranslation, 'Cô ấy kiên cường.');
  assert.equal(statusCall?.message.payload?.aiGenerated, true);
  assert.equal(statusCall?.message.payload?.sourceLanguage, 'en');
  assert.equal(statusCall?.message.payload?.speechLocale, 'en-US');
});

test('labels a capture of unknown language with the language of the card the app saved', async () => {
  const worker = await createWorkerContext();
  const started = await startQuickAdd(worker);
  assert.equal(worker.storageValues.get(`lingoflash_quick_add_job_${started.id}`).sourceLanguage, undefined);

  const valid = await sendRuntimeMessage(worker, {
    type: 'APP_IMPORT_RESULT',
    bridgeType: 'LINGOFLASH_EXTENSION_RESULT',
    payload: appResultPayload(worker, started.id, { status: 'created', translation: 'khả năng phục hồi', language: 'ko' }),
  }, appSender(worker));

  assert.equal(valid.ignored, false);
  const statusCall = worker.calls.find(call => call.type === 'runtime.sendMessage'
    && call.message.payload?.status === 'created');
  assert.equal(statusCall?.message.payload?.sourceLanguage, 'ko');
  assert.equal(statusCall?.message.payload?.speechLocale, 'ko-KR');
  const renderCall = worker.calls.find(call => call.type === 'scripting.executeScript'
    && call.details.args?.[0]?.status === 'created');
  assert.equal(renderCall?.details.args[0].sourceLanguage, 'ko');
  assert.equal(renderCall?.details.args[0].speechLocale, 'ko-KR');
  const recent = worker.storageValues.get('lingoflash_recent_lookups');
  assert.equal(recent?.[0]?.kind, 'create');
  assert.equal(recent?.[0]?.sourceLanguage, 'ko');
});

test('does not label a capture as English when neither the capture nor the app reported a language', async () => {
  const worker = await createWorkerContext();
  const started = await startQuickAdd(worker);

  const valid = await sendRuntimeMessage(worker, {
    type: 'APP_IMPORT_RESULT',
    bridgeType: 'LINGOFLASH_EXTENSION_RESULT',
    payload: appResultPayload(worker, started.id, { status: 'created', translation: 'khả năng phục hồi', language: 'not a language' }),
  }, appSender(worker));

  assert.equal(valid.ignored, false);
  const statusCall = worker.calls.find(call => call.type === 'runtime.sendMessage'
    && call.message.payload?.status === 'created');
  assert.equal(statusCall?.message.payload?.sourceLanguage, '');
  const recent = worker.storageValues.get('lingoflash_recent_lookups');
  // 'auto' is how the lookup history records a language it does not know.
  assert.equal(recent?.[0]?.sourceLanguage, 'auto');
});

test('retries a failed capture with its original word, context, and operation ID', async () => {
  const worker = await createWorkerContext({
    executeScriptCaptureResult: { text: 'resilient', context: 'Original passage sentence.', anchor: { left: 42, top: 60 } },
  });
  const started = await startQuickAdd(worker);
  const firstJob = worker.storageValues.get(`lingoflash_quick_add_job_${started.id}`);
  const failed = await sendRuntimeMessage(worker, {
    type: 'APP_IMPORT_RESULT',
    bridgeType: 'LINGOFLASH_EXTENSION_RESULT',
    payload: appResultPayload(worker, started.id, { status: 'error', message: 'Dịch vụ AI đang bận.' }),
  }, appSender(worker));
  assert.equal(failed.ok, true);
  assert.equal(worker.storageValues.has(`lingoflash_quick_add_job_${started.id}`), false);
  assert.equal(worker.storageValues.get('lingoflash_quick_add_retry_7')?.id, started.id);

  const retried = await sendRuntimeMessage(worker, { type: 'RETRY_QUICK_ADD', id: started.id }, { tab: { id: 7 } });
  assert.equal(retried.ok, true);
  assert.equal(retried.id, started.id);
  const retryJob = worker.storageValues.get(`lingoflash_quick_add_job_${started.id}`);
  assert.equal(retryJob.text, 'resilient');
  assert.equal(retryJob.context, 'Original passage sentence.');
  assert.notEqual(retryJob.nonce, firstJob.nonce);

  const done = await sendRuntimeMessage(worker, {
    type: 'APP_IMPORT_RESULT',
    bridgeType: 'LINGOFLASH_EXTENSION_RESULT',
    payload: appResultPayload(worker, started.id, { status: 'created', translation: 'kiên cường' }),
  }, appSender(worker));
  assert.equal(done.ok, true);
  assert.equal(worker.storageValues.has('lingoflash_quick_add_retry_7'), false);
});

test('retries a failed capture with its original source language after the active course changes', async () => {
  const worker = await createWorkerContext();
  const sender = { url: worker.context.LingoFlashExtension.DEFAULT_APP_URL, tab: { id: 7 } };
  await sendRuntimeMessage(worker, {
    type: 'SYNC_COURSE_LOCALE',
    payload: { scope: 'opaque_scope_ko_123456', nativeLanguage: 'en', targetLanguage: 'ko' },
  }, sender);
  const started = await startQuickAdd(worker);
  const failed = await sendRuntimeMessage(worker, {
    type: 'APP_IMPORT_RESULT',
    bridgeType: 'LINGOFLASH_EXTENSION_RESULT',
    payload: appResultPayload(worker, started.id, { status: 'error', message: 'Dịch vụ AI đang bận.' }),
  }, appSender(worker));
  assert.equal(failed.ok, true);
  assert.equal(worker.storageValues.get('lingoflash_quick_add_retry_7')?.sourceLanguage, 'ko');

  await sendRuntimeMessage(worker, {
    type: 'SYNC_COURSE_LOCALE',
    payload: { scope: 'opaque_scope_ko_123456', nativeLanguage: 'vi', targetLanguage: 'en' },
  }, sender);
  const retried = await sendRuntimeMessage(worker, { type: 'RETRY_QUICK_ADD', id: started.id }, { tab: { id: 7 } });
  assert.equal(retried.ok, true);
  assert.equal(worker.storageValues.get(`lingoflash_quick_add_job_${started.id}`)?.sourceLanguage, 'ko');

  const verified = await verifyIntent(worker, readStartedIntent(worker, started.id), appSender(worker));
  assert.equal(verified.verified, true);
  assert.equal(verified.intent.sourceLanguage, 'ko');
});

test('retries a failed capture whose language was unknown without inventing one', async () => {
  const worker = await createWorkerContext();
  const started = await startQuickAdd(worker);
  const failed = await sendRuntimeMessage(worker, {
    type: 'APP_IMPORT_RESULT',
    bridgeType: 'LINGOFLASH_EXTENSION_RESULT',
    payload: appResultPayload(worker, started.id, { status: 'error', message: 'Dịch vụ AI đang bận.' }),
  }, appSender(worker));
  assert.equal(failed.ok, true);
  assert.equal(worker.storageValues.get('lingoflash_quick_add_retry_7')?.id, started.id);

  const sender = { url: worker.context.LingoFlashExtension.DEFAULT_APP_URL, tab: { id: 7 } };
  await sendRuntimeMessage(worker, {
    type: 'SYNC_COURSE_LOCALE',
    payload: { scope: 'opaque_scope_ko_123456', nativeLanguage: 'vi', targetLanguage: 'ko' },
  }, sender);
  const retried = await sendRuntimeMessage(worker, { type: 'RETRY_QUICK_ADD', id: started.id }, { tab: { id: 7 } });
  assert.equal(retried.ok, true);
  assert.equal(worker.storageValues.get(`lingoflash_quick_add_job_${started.id}`)?.sourceLanguage, undefined);

  const verified = await verifyIntent(worker, readStartedIntent(worker, started.id), appSender(worker));
  assert.equal(verified.verified, true);
  assert.equal('sourceLanguage' in verified.intent, false);
});

test('rejects retry receipts without a captured source language', async () => {
  const worker = await createWorkerContext({
    storageEntries: [['lingoflash_quick_add_retry_7', {
      id: 'legacy_123', text: 'resilient', context: '', expiresAt: Date.now() + 86_400_000,
    }]],
  });
  const sender = { url: worker.context.LingoFlashExtension.DEFAULT_APP_URL, tab: { id: 7 } };
  await sendRuntimeMessage(worker, {
    type: 'SYNC_COURSE_LOCALE',
    payload: { scope: 'opaque_scope_ko_123456', nativeLanguage: 'en', targetLanguage: 'ko' },
  }, sender);

  const retried = await sendRuntimeMessage(worker, { type: 'RETRY_QUICK_ADD', id: 'legacy_123' }, { tab: { id: 7 } });
  assert.equal(retried.ok, false);
  assert.match(retried.error, /Không thể xác minh ngôn ngữ/);
  assert.equal(worker.storageValues.has('lingoflash_quick_add_job_legacy_123'), false);
});

test('rejects retry receipts with a malformed captured source language', async () => {
  const worker = await createWorkerContext({
    storageEntries: [['lingoflash_quick_add_retry_7', {
      id: 'malformed_123', text: 'resilient', context: '', sourceLanguage: 'xx', expiresAt: Date.now() + 86_400_000,
    }]],
  });

  const retried = await sendRuntimeMessage(worker, { type: 'RETRY_QUICK_ADD', id: 'malformed_123' }, { tab: { id: 7 } });
  assert.equal(retried.ok, false);
  assert.match(retried.error, /Không thể xác minh ngôn ngữ/);
  assert.equal(worker.storageValues.has('lingoflash_quick_add_job_malformed_123'), false);
});

test('retries a failed capture from the popup, which has no sender.tab, by falling back to the active tab', async () => {
  const worker = await createWorkerContext({
    executeScriptCaptureResult: { text: 'resilient', context: 'Original passage sentence.', anchor: { left: 42, top: 60 } },
  });
  const started = await startQuickAdd(worker);
  const failed = await sendRuntimeMessage(worker, {
    type: 'APP_IMPORT_RESULT',
    bridgeType: 'LINGOFLASH_EXTENSION_RESULT',
    payload: appResultPayload(worker, started.id, { status: 'error', message: 'Dịch vụ AI đang bận.' }),
  }, appSender(worker));
  assert.equal(failed.ok, true);
  assert.equal(worker.storageValues.get('lingoflash_quick_add_retry_7')?.id, started.id);

  // The popup is not a content script, so it has no sender.tab at all — unlike
  // the in-page bubble's retry above, which always supplies { tab: { id: 7 } }.
  // sendRuntimeMessage defaults its sender to {}, exercising the RETRY_QUICK_ADD
  // fallback that resolves the source tab via activeTab() instead.
  const retried = await sendRuntimeMessage(worker, { type: 'RETRY_QUICK_ADD', id: started.id });
  assert.equal(retried.ok, true);
  assert.equal(retried.id, started.id);
  const retryJob = worker.storageValues.get(`lingoflash_quick_add_job_${started.id}`);
  assert.equal(retryJob.text, 'resilient');
  assert.equal(retryJob.context, 'Original passage sentence.');
});

test('rejects a popup retry when there is no active tab to resolve as the fallback source', async () => {
  const worker = await createWorkerContext();
  const originalQuery = worker.context.chrome.tabs.query;
  worker.context.chrome.tabs.query = (_query, callback) => callback([]);

  const rejected = await sendRuntimeMessage(worker, { type: 'RETRY_QUICK_ADD', id: 'job_missing' });
  assert.equal(rejected.ok, false);
  assert.match(rejected.error, /Không tìm thấy tab nguồn/);

  worker.context.chrome.tabs.query = originalQuery;
});

const syncCourseLocale = (worker, scope, { providerId, tabId = 7, targetLanguage = 'ko', owner } = {}) => sendRuntimeMessage(worker, {
  type: 'SYNC_COURSE_LOCALE',
  ...(providerId ? { providerId } : {}),
  payload: { scope, nativeLanguage: 'vi', targetLanguage, ...(owner ? { owner } : {}) },
}, { url: worker.context.LingoFlashExtension.DEFAULT_APP_URL, tab: { id: tabId }, frameId: 0 });

const failBoundCapture = async (worker, scope, owner) => {
  assert.equal((await syncCourseLocale(worker, scope, { owner })).ok, true);
  const started = await startQuickAdd(worker);
  const failed = await sendRuntimeMessage(worker, {
    type: 'APP_IMPORT_RESULT',
    bridgeType: 'LINGOFLASH_EXTENSION_RESULT',
    payload: appResultPayload(worker, started.id, { status: 'error', message: 'AI busy' }),
  }, appSender(worker));
  assert.equal(failed.ok, true);
  assert.equal(worker.storageValues.get('lingoflash_quick_add_retry_7')?.providerId, worker.providerId);
  return started.id;
};

test('retries a failed capture after the worker restarted when the same app document re-publishes its scope', async () => {
  const first = await createWorkerContext();
  const id = await failBoundCapture(first, 'opaque_scope_retry_restart_123456');

  const second = await createWorkerContext({ storageEntries: [...first.storageValues] });
  assert.notEqual(second.providerId, first.providerId);
  assert.equal((await syncCourseLocale(second, 'opaque_scope_retry_restart_123456')).ok, true);

  const retried = await sendRuntimeMessage(second, { type: 'RETRY_QUICK_ADD', id }, { tab: { id: 7 } });
  assert.equal(retried.ok, true);
  const retryJob = second.storageValues.get(`lingoflash_quick_add_job_${id}`);
  assert.equal(retryJob.providerId, second.providerId);
  assert.equal(retryJob.providerScope, 'opaque_scope_retry_restart_123456');
  const verified = await verifyIntent(second, readStartedIntent(second, id), appSender(second));
  assert.equal(verified.verified, true);
});

test('refuses a retry at once when its app session can no longer be verified', async () => {
  const first = await createWorkerContext();
  const id = await failBoundCapture(first, 'opaque_scope_retry_before_123456');

  const second = await createWorkerContext({ storageEntries: [...first.storageValues] });
  assert.equal((await syncCourseLocale(second, 'opaque_scope_retry_after_1234567')).ok, true);

  const retried = await sendRuntimeMessage(second, { type: 'RETRY_QUICK_ADD', id }, { tab: { id: 7 } });
  assert.equal(retried.ok, false);
  assert.match(retried.error, /Hãy chọn lại văn bản/);
  assert.equal(second.storageValues.has(`lingoflash_quick_add_job_${id}`), false);
  assert.equal(second.storageValues.has('lingoflash_quick_add_retry_7'), false);
  assert.equal(second.calls.some(call => call.type === 'tabs.create' || call.type === 'alarms.create'), false);
});

test('reports the card the app saved when another app tab connects during generation', async () => {
  const worker = await createWorkerContext();
  assert.equal((await syncCourseLocale(worker, 'opaque_scope_saved_first_123456', { owner: 'owner_marker_same_123456' })).ok, true);
  const started = await startQuickAdd(worker);
  const verified = await verifyIntent(worker, readStartedIntent(worker, started.id), appSender(worker));
  assert.equal(verified.verified, true);

  const secondPort = worker.connectProvider({ url: worker.context.LingoFlashExtension.DEFAULT_APP_URL, tab: { id: 8 }, frameId: 0 });
  const secondProviderId = secondPort.posted.find(message => message.type === 'LINGOFLASH_EXTENSION_PROVIDER')?.providerId;
  assert.equal((await syncCourseLocale(worker, 'opaque_scope_saved_second_12345', { providerId: secondProviderId, tabId: 8, owner: 'owner_marker_same_123456' })).ok, true);

  const delivered = await sendRuntimeMessage(worker, {
    type: 'APP_IMPORT_RESULT',
    bridgeType: 'LINGOFLASH_EXTENSION_RESULT',
    payload: appResultPayload(worker, started.id, { status: 'created', translation: 'kiên cường' }),
  }, appSender(worker));
  assert.equal(delivered.ok, true);
  assert.equal(delivered.ignored, false);
  assert.equal(worker.storageValues.has(`lingoflash_quick_add_job_${started.id}`), false);
  assert.equal(worker.storageValues.has('lingoflash_quick_add_retry_7'), false);
  assert.ok(worker.calls.some(call => call.type === 'runtime.sendMessage'
    && call.message.type === 'QUICK_ADD_STATUS' && call.message.payload.status === 'created'));
  assert.ok(worker.calls.some(call => call.type === 'tabs.remove' && call.id === 99));
  // Another tab of the same account is not a new owner: the saved word stays in the history.
  const history = (await sendRuntimeMessage(worker, { type: 'GET_RECENT_LOOKUPS' })).items;
  assert.deepEqual(Array.from(history, item => [item.kind, item.status]), [['create', 'created']]);
});

test('keeps the saved words and retry receipts when the same account reconnects, opens another tab or switches course', async () => {
  const worker = await createWorkerContext();
  const owner = 'owner_marker_same_123456';
  assert.equal((await syncCourseLocale(worker, 'opaque_scope_same_owner_a_12345', { owner })).ok, true);
  const saved = await startQuickAdd(worker);
  await sendRuntimeMessage(worker, {
    type: 'APP_IMPORT_RESULT',
    bridgeType: 'LINGOFLASH_EXTENSION_RESULT',
    payload: appResultPayload(worker, saved.id, { status: 'created', translation: 'bền bỉ' }),
  }, appSender(worker));
  await failBoundCapture(worker, 'opaque_scope_same_owner_a_12345', owner);

  const portB = worker.connectProvider({ url: worker.context.LingoFlashExtension.DEFAULT_APP_URL, tab: { id: 8 }, frameId: 0 });
  const providerB = portB.posted.find(message => message.type === 'LINGOFLASH_EXTENSION_PROVIDER')?.providerId;
  assert.equal((await syncCourseLocale(worker, 'opaque_scope_same_owner_b_12345', { providerId: providerB, tabId: 8, owner })).ok, true);
  await sendRuntimeMessageRaw(worker, { type: 'CLEAR_DUE_COUNT', providerId: providerB, payload: { scope: 'opaque_scope_same_owner_b_12345' } }, { url: worker.context.LingoFlashExtension.DEFAULT_APP_URL, tab: { id: 8 }, frameId: 0 });
  assert.equal((await syncCourseLocale(worker, 'opaque_scope_same_owner_c_12345', { providerId: providerB, tabId: 8, owner })).ok, true);
  await flushMicrotasks();

  const history = (await sendRuntimeMessage(worker, { type: 'GET_RECENT_LOOKUPS' })).items;
  assert.deepEqual(Array.from(history, item => item.kind), ['create']);
  assert.ok(worker.storageValues.has('lingoflash_quick_add_retry_7'));
});

test('does not record a card finished after another account took over the browser', async () => {
  const worker = await createWorkerContext();
  assert.equal((await syncCourseLocale(worker, 'opaque_scope_takeover_a_12345', { owner: 'owner_marker_first_123456' })).ok, true);
  const started = await startQuickAdd(worker);

  const portB = worker.connectProvider({ url: worker.context.LingoFlashExtension.DEFAULT_APP_URL, tab: { id: 8 }, frameId: 0 });
  const providerB = portB.posted.find(message => message.type === 'LINGOFLASH_EXTENSION_PROVIDER')?.providerId;
  assert.equal((await syncCourseLocale(worker, 'opaque_scope_takeover_b_12345', { providerId: providerB, tabId: 8, owner: 'owner_marker_second_12345' })).ok, true);

  const delivered = await sendRuntimeMessage(worker, {
    type: 'APP_IMPORT_RESULT',
    bridgeType: 'LINGOFLASH_EXTENSION_RESULT',
    payload: appResultPayload(worker, started.id, { status: 'created', translation: 'kiên cường' }),
  }, appSender(worker));
  assert.equal(delivered.ok, true);
  assert.deepEqual([...(await sendRuntimeMessage(worker, { type: 'GET_RECENT_LOOKUPS' })).items], []);
});

test('hides the saved words and retry receipts of a signed-out account from the next account', async () => {
  const worker = await createWorkerContext();
  const appTab = { url: worker.context.LingoFlashExtension.DEFAULT_APP_URL, tab: { id: 7 }, frameId: 0 };
  await sendRuntimeMessage(worker, { type: 'SYNC_DUE_COUNT', payload: { scope: 'opaque_scope_owner_a_123456', count: 3, owner: 'owner_marker_first_123456' } }, appTab);
  await sendRuntimeMessage(worker, { type: 'SYNC_DECK_METADATA', payload: { scope: 'opaque_scope_owner_a_123456', decks: ['A deck'] } }, appTab);

  const saved = await startQuickAdd(worker);
  await sendRuntimeMessage(worker, {
    type: 'APP_IMPORT_RESULT',
    bridgeType: 'LINGOFLASH_EXTENSION_RESULT',
    payload: appResultPayload(worker, saved.id, { status: 'created', translation: 'bền bỉ' }),
  }, appSender(worker));
  await sendRuntimeMessage(worker, { type: 'ADD_SELECTION', text: 'persistent' });
  const failedJob = [...worker.storageValues.entries()].find(([name, value]) => name.startsWith('lingoflash_quick_add_job_') && value.text === 'persistent')[1];
  await sendRuntimeMessage(worker, {
    type: 'APP_IMPORT_RESULT',
    bridgeType: 'LINGOFLASH_EXTENSION_RESULT',
    payload: { id: failedJob.id, nonce: failedJob.nonce, status: 'error', message: 'AI busy' },
  }, appSender(worker));
  assert.equal((await sendRuntimeMessage(worker, { type: 'GET_RECENT_LOOKUPS' })).items.length, 1);
  assert.ok(worker.storageValues.has('lingoflash_quick_add_retry_7'));

  await sendRuntimeMessage(worker, { type: 'CLEAR_DECK_METADATA', payload: { scope: 'opaque_scope_owner_a_123456' } }, appTab);
  await sendRuntimeMessage(worker, { type: 'CLEAR_DUE_COUNT', payload: { scope: 'opaque_scope_owner_a_123456' } }, appTab);
  worker.appPort.disconnect();
  await flushMicrotasks();

  const portB = worker.connectProvider(appTab);
  const providerB = portB.posted.find(message => message.type === 'LINGOFLASH_EXTENSION_PROVIDER')?.providerId;
  const synced = await sendRuntimeMessageRaw(worker, { type: 'SYNC_DUE_COUNT', providerId: providerB, payload: { scope: 'opaque_scope_owner_b_123456', count: 0, owner: 'owner_marker_second_12345' } }, appTab);
  assert.equal(synced.ok, true);
  await flushMicrotasks();

  const history = await sendRuntimeMessage(worker, { type: 'GET_RECENT_LOOKUPS' });
  assert.deepEqual([...history.items], []);
  assert.equal([...worker.storageValues.keys()].some(name => name.startsWith('lingoflash_quick_add_retry_')), false);
});

test('drops saved-word history only when another account is confirmed, and keeps translate-only lookups', async () => {
  const worker = await createWorkerContext({ fetchImpl: async () => ({ ok: true, json: async () => [[['xin chào', 'hello']], null, 'en'] }) });
  assert.equal((await syncCourseLocale(worker, 'opaque_scope_replaced_a_123456', { targetLanguage: 'en', owner: 'owner_marker_first_123456' })).ok, true);
  const translated = await sendRuntimeMessage(worker, { type: 'TRANSLATE_SELECTION', text: 'hello' });
  assert.equal(translated.ok, true);
  const started = await startQuickAdd(worker);
  await sendRuntimeMessage(worker, {
    type: 'APP_IMPORT_RESULT',
    bridgeType: 'LINGOFLASH_EXTENSION_RESULT',
    payload: appResultPayload(worker, started.id, { status: 'created', translation: 'bền bỉ' }),
  }, appSender(worker));
  const before = (await sendRuntimeMessage(worker, { type: 'GET_RECENT_LOOKUPS' })).items;
  assert.deepEqual(Array.from(before, item => item.kind).sort(), ['create', 'translate']);

  assert.equal((await syncCourseLocale(worker, 'opaque_scope_replaced_b_123456', { targetLanguage: 'en', owner: 'owner_marker_first_123456' })).ok, true);
  await flushMicrotasks();
  const sameOwner = (await sendRuntimeMessage(worker, { type: 'GET_RECENT_LOOKUPS' })).items;
  assert.deepEqual(Array.from(sameOwner, item => item.kind).sort(), ['create', 'translate']);

  assert.equal((await syncCourseLocale(worker, 'opaque_scope_replaced_c_123456', { targetLanguage: 'en', owner: 'owner_marker_second_12345' })).ok, true);
  await flushMicrotasks();
  const after = (await sendRuntimeMessage(worker, { type: 'GET_RECENT_LOOKUPS' })).items;
  assert.deepEqual(Array.from(after, item => item.kind), ['translate']);
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

test('retires the worker resources when successful cleanup cannot remove its job', async () => {
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
  assert.equal(worker.calls.some(call => call.type === 'tabs.remove' && call.id === 99), true);
  assert.equal(worker.calls.some(call => call.type === 'alarms.clear'
    && call.name === `lingoflash_quick_add_timeout_${started.id}`), true);
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

const koreanTranslateWorker = (options = {}) => createWorkerContext({
  storageEntries: [['lingoflash_extension_settings', {
    autoSpeak: false,
    bubbleDurationMs: 12_000,
    recentLookupsEnabled: true,
    quickTranslateSource: 'auto',
    quickTranslateTarget: 'vi',
  }]],
  executeScriptCaptureResult: {
    text: '결정', anchor: { left: 10, bottom: 20 }, context: '중앙은행이 기준금리를 동결하기로 결정하면서', pageLanguage: 'ko',
  },
  fetchImpl: async url => {
    options.requests?.push(String(url));
    return { ok: true, json: async () => [[['quyết định', '결정', null, null, 10], [null, null, 'quyết định', 'gyeoljeong']], null, 'ko'] };
  },
});
const syncKoreanCourse = (worker, targetLanguage = 'ko') => sendRuntimeMessage(worker, {
  type: 'SYNC_COURSE_LOCALE',
  payload: { scope: 'opaque_scope_ko_123456', nativeLanguage: 'vi', targetLanguage },
}, { url: worker.context.LingoFlashExtension.DEFAULT_APP_URL, tab: { id: 7 } });
const translatedRender = worker => worker.calls.find(call => call.type === 'scripting.executeScript'
  && call.details.args?.[0]?.status === 'translated')?.details.args[0];

test('gives the in-page translation its reading, page context and detected language', async () => {
  const requests = [];
  const worker = await koreanTranslateWorker({ requests });

  const response = await sendRuntimeMessage(worker, { type: 'TRANSLATE_SELECTION', text: '결정' });
  const payload = translatedRender(worker);
  const query = new URL(requests[0]).searchParams;

  assert.equal(response.ok, true);
  assert.equal(response.romanization, 'gyeoljeong');
  assert.equal(response.sourceLanguage, 'ko');
  assert.deepEqual(query.getAll('dt'), ['t', 'rm']);
  assert.equal(payload.translation, 'quyết định');
  assert.equal(payload.romanization, 'gyeoljeong');
  assert.equal(payload.sourceLanguage, 'ko');
  assert.equal(payload.translationLanguage, 'vi');
  assert.equal(payload.pageLanguage, 'ko');
  assert.equal(payload.context, '중앙은행이 기준금리를 동결하기로 결정하면서');
  // No confirmed course: the bubble names none and offers no save.
  assert.equal(payload.courseLanguage, undefined);
  assert.equal(payload.saveId, undefined);
});

test('offers an in-page save only when the selection is in the confirmed course language', async () => {
  const matching = await koreanTranslateWorker();
  await syncKoreanCourse(matching);
  await sendRuntimeMessage(matching, { type: 'TRANSLATE_SELECTION', text: '결정' });
  const offered = translatedRender(matching);
  assert.equal(offered.courseLanguage, 'ko');
  assert.equal(offered.nativeLanguage, 'vi');
  assert.match(offered.saveId, /\S/);
  const receipt = matching.storageValues.get('lingoflash_inline_save_7');
  assert.equal(receipt?.id, offered.saveId);
  assert.equal(receipt?.text, '결정');
  assert.equal(receipt?.courseLanguage, 'ko');

  const otherCourse = await koreanTranslateWorker();
  await syncKoreanCourse(otherCourse, 'ja');
  await sendRuntimeMessage(otherCourse, { type: 'TRANSLATE_SELECTION', text: '결정' });
  const notOffered = translatedRender(otherCourse);
  assert.equal(notOffered.courseLanguage, 'ja');
  assert.equal(notOffered.saveId, undefined);
  assert.equal(otherCourse.storageValues.has('lingoflash_inline_save_7'), false);
});

test('saves from the in-page bubble only with its one-time id, from its own tab, into the same course', async () => {
  const worker = await koreanTranslateWorker();
  await syncKoreanCourse(worker);
  await sendRuntimeMessage(worker, { type: 'TRANSLATE_SELECTION', text: '결정' });
  const { saveId } = translatedRender(worker);

  const noTab = await sendRuntimeMessage(worker, { type: 'INLINE_SELECTION_ADD', id: saveId });
  assert.equal(noTab.ok, false);
  const wrongId = await sendRuntimeMessage(worker, { type: 'INLINE_SELECTION_ADD', id: 'forged' }, { tab: { id: 7 } });
  assert.equal(wrongId.ok, false);
  assert.match(wrongId.error, /hết hạn/);
  const otherTab = await sendRuntimeMessage(worker, { type: 'INLINE_SELECTION_ADD', id: saveId }, { tab: { id: 8 } });
  assert.equal(otherTab.ok, false);

  const saved = await sendRuntimeMessage(worker, { type: 'INLINE_SELECTION_ADD', id: saveId, text: 'ignored' }, { tab: { id: 7 } });
  assert.equal(saved.ok, true);
  const job = [...worker.storageValues.entries()].find(([key]) => key.startsWith('lingoflash_quick_add_job_'))?.[1];
  assert.equal(job?.text, '결정');
  assert.equal(job?.sourceLanguage, 'ko');
  assert.equal(worker.storageValues.has('lingoflash_inline_save_7'), false);

  const replay = await sendRuntimeMessage(worker, { type: 'INLINE_SELECTION_ADD', id: saveId }, { tab: { id: 7 } });
  assert.equal(replay.ok, false);
});

test('refuses an in-page save after the active course changed', async () => {
  const worker = await koreanTranslateWorker();
  await syncKoreanCourse(worker);
  await sendRuntimeMessage(worker, { type: 'TRANSLATE_SELECTION', text: '결정' });
  const { saveId } = translatedRender(worker);
  await syncKoreanCourse(worker, 'ja');

  const refused = await sendRuntimeMessage(worker, { type: 'INLINE_SELECTION_ADD', id: saveId }, { tab: { id: 7 } });
  assert.equal(refused.ok, false);
  assert.match(refused.error, /Khóa học đang dùng đã thay đổi/);
  assert.equal([...worker.storageValues.keys()].some(key => key.startsWith('lingoflash_quick_add_job_')), false);
});

test('passes the saved theme family and colour scheme to the injected renderer', async () => {
  const worker = await createWorkerContext({
    storageEntries: [['lingoflash_extension_settings', {
      autoSpeak: false,
      bubbleDurationMs: 12_000,
      recentLookupsEnabled: true,
      quickTranslateSource: 'auto',
      quickTranslateTarget: 'vi',
      themeFamily: 'crystal',
      colorScheme: 'light',
    }]],
    fetchImpl: async () => ({
      ok: true,
      json: async () => [[['kiên cường']], null, 'en'],
    }),
  });

  await sendRuntimeMessage(worker, { type: 'TRANSLATE_SELECTION', text: 'resilient' });
  const renderCall = worker.calls.find(call => call.type === 'scripting.executeScript'
    && call.details.args?.[0]?.status === 'translated');

  assert.equal(renderCall?.details.args[0].themeFamily, 'crystal');
  assert.equal(renderCall?.details.args[0].colorScheme, 'light');
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
    createdAt: Date.now() - 200_000,
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
  worker.storageValues.get(`lingoflash_quick_add_job_${started.id}`).createdAt = Date.now() - 200_000;
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

test('does not let an early alarm terminate a valid bridge request', async () => {
  const worker = await createWorkerContext({ now: 1_000_000 });
  const started = await startQuickAdd(worker);
  const jobKey = `lingoflash_quick_add_job_${started.id}`;
  worker.storageValues.get(jobKey).createdAt = 1_000_000 - 147_580;
  const alarmName = `lingoflash_quick_add_timeout_${started.id}`;

  for (const listener of worker.events.alarms.listeners) listener({ name: alarmName });
  await flushMicrotasks();

  assert.equal(worker.storageValues.has(jobKey), true);
  assert.equal(worker.calls.some(call => call.type === 'runtime.sendMessage'
    && call.message.payload?.status === 'error'), false);
  const rescheduled = worker.calls.filter(call => call.type === 'alarms.create' && call.name === alarmName).at(-1);
  assert.ok(rescheduled);
  assert.equal(rescheduled.details.delayInMinutes, 5_000 / (60 * 1000));
});

test('ignores a valid result at the terminal deadline and never imports twice', async () => {
  const worker = await createWorkerContext();
  const started = await startQuickAdd(worker);
  const jobKey = `lingoflash_quick_add_job_${started.id}`;
  const alarmName = `lingoflash_quick_add_timeout_${started.id}`;
  worker.storageValues.get(jobKey).createdAt = Date.now() - 152_580;

  const latePending = sendRuntimeMessage(worker, {
    type: 'APP_IMPORT_RESULT',
    bridgeType: 'LINGOFLASH_EXTENSION_RESULT',
    payload: appResultPayload(worker, started.id, { status: 'created', translation: 'muộn' }),
  }, appSender(worker));
  for (const listener of worker.events.alarms.listeners) listener({ name: alarmName });
  const late = await latePending;
  assert.equal(late.ignored, true);
  assert.equal(worker.storageValues.get(jobKey).resultClaimedAt, undefined);

  await flushMicrotasks();
  const afterTerminal = await sendRuntimeMessage(worker, {
    type: 'APP_IMPORT_RESULT',
    bridgeType: 'LINGOFLASH_EXTENSION_RESULT',
    payload: appResultPayload(worker, started.id, { status: 'created', translation: 'muộn' }),
  }, appSender(worker));
  assert.equal(afterTerminal.ignored, true);
  assert.equal(worker.calls.filter(call => call.type === 'runtime.sendMessage'
    && call.message.payload?.status === 'created').length, 0);
  assert.equal(worker.calls.filter(call => call.type === 'runtime.sendMessage'
    && call.message.payload?.status === 'error').length, 1);
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
    const intent = readStartedIntent(worker, started.id);
    const alarmName = `lingoflash_quick_add_timeout_${started.id}`;

    for (const listener of worker.events.tabsRemoved.listeners) listener(closedTabId);
    await flushMicrotasks();
    await flushMicrotasks();

    const lateVerification = await verifyIntent(worker, intent, appSender(worker));
    assert.equal(lateVerification.verified, false, 'a terminal claim must suppress a late import verification');

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

test('retries an alarm cleanup after its first job read fails', async () => {
  const worker = await createWorkerContext();
  const started = await startQuickAdd(worker);
  const job = worker.storageValues.get(`lingoflash_quick_add_job_${started.id}`);
  job.createdAt = Date.now() - 200_000;
  const name = `lingoflash_quick_add_timeout_${started.id}`;
  worker.failStorageReads(1);
  for (const listener of worker.events.alarms.listeners) listener({ name });
  await flushMicrotasks();
  assert.ok(worker.calls.some(call => call.type === 'alarms.create' && call.name === name));
  for (const listener of worker.events.alarms.listeners) listener({ name });
  await flushMicrotasks();
  await flushMicrotasks();
  assert.equal(worker.storageValues.has(`lingoflash_quick_add_job_${started.id}`), false);
  assert.ok(worker.calls.some(call => call.type === 'tabs.remove' && call.id === 99));
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

test('without session storage a restart removes expired retry and in-page save receipts and keeps live ones', async () => {
  const live = Date.now() + 60_000;
  const gone = Date.now() - 1_000;
  const worker = await createWorkerContext({
    hasSessionStorage: false,
    storageEntries: [
      ['lingoflash_quick_add_retry_7', { id: 'retry_expired_1', text: 'resilient', context: 'private', expiresAt: gone }],
      ['lingoflash_quick_add_retry_8', { id: 'retry_live_123456', text: 'resilient', context: '', expiresAt: live }],
      ['lingoflash_quick_add_retry_9', { id: 'retry_malformed_1', text: 'resilient' }],
      ['lingoflash_inline_save_7', { id: 'inline_expired_1', text: 'resilient', courseLanguage: 'en', expiresAt: gone }],
      ['lingoflash_inline_save_8', { id: 'inline_live_12345', text: 'resilient', courseLanguage: 'en', expiresAt: live }],
    ],
  });
  for (const listener of worker.events.startup.listeners) listener();
  await flushMicrotasks();

  assert.deepEqual(
    [...worker.storageValues.keys()].filter(name => /retry_|inline_save_/.test(name)).sort(),
    ['lingoflash_inline_save_8', 'lingoflash_quick_add_retry_8'],
  );
});
