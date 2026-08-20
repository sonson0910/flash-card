import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const sourceFiles = [
  '../shared.js',
  '../background-v132-ui.js',
  '../background-v132-core.js',
];

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

const createWorkerContext = async () => {
  const calls = [];
  const storageValues = new Map();
  const events = {
    installed: makeEvent(),
    startup: makeEvent(),
    messages: makeEvent(),
    menuClicks: makeEvent(),
    commands: makeEvent(),
    alarms: makeEvent(),
    tabsRemoved: makeEvent(),
  };
  const storage = {
    get(key, callback) {
      if (key === null) {
        callback(Object.fromEntries(storageValues));
        return;
      }
      callback({ [key]: storageValues.get(key) });
    },
    set(values, callback) {
      calls.push({ type: 'storage.set', values });
      for (const [key, value] of Object.entries(values)) storageValues.set(key, value);
      callback?.();
    },
    remove(key, callback) {
      calls.push({ type: 'storage.remove', key });
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
      sendMessage: () => Promise.resolve(),
    },
    storage: { session: storage },
    tabs: {
      query(_query, callback) {
        callback([{ id: 7 }]);
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
        callback?.();
      },
      onRemoved: events.tabsRemoved,
    },
    scripting: {
      executeScript(details, callback) {
        calls.push({ type: 'scripting.executeScript', details });
        callback([]);
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
  };

  const context = {
    Array,
    ArrayBuffer,
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
    fetch: () => { throw new Error('fetch should not be called by this test'); },
    setTimeout,
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

const readStartedIntent = (worker, id) => {
  const navigation = [...worker.calls].reverse().find(call => call.type === 'tabs.update');
  assert.ok(navigation, 'quick-add worker navigation was not recorded');
  const intent = worker.context.LingoFlashExtension.decodeImportIntentFromUrl(
    navigation.details.url,
  );
  assert.equal(intent.id, id);
  return intent;
};

const verifyIntent = (worker, intent, sender = {}) => sendRuntimeMessage(worker, {
  type: 'VERIFY_IMPORT_INTENT',
  payload: intent,
}, sender);

test('verifies a silent import only for its origin, worker tab and exact job payload', async () => {
  const worker = await createWorkerContext();
  const started = await startQuickAdd(worker);
  const intent = readStartedIntent(worker, started.id);
  const sender = {
    url: worker.context.LingoFlashExtension.DEFAULT_APP_URL,
    tab: { id: 99 },
  };

  const verified = await verifyIntent(worker, intent, sender);
  assert.equal(verified.ok, true);
  assert.equal(verified.verified, true);
  assert.deepEqual(verified.intent, intent);

  const forged = await verifyIntent(worker, {
    ...intent,
    text: 'forged',
  }, sender);
  assert.equal(forged.ok, true);
  assert.equal(forged.verified, false);

  const wrongTimestamp = await verifyIntent(worker, {
    ...intent,
    createdAt: intent.createdAt + 1,
  }, sender);
  assert.equal(wrongTimestamp.ok, true);
  assert.equal(wrongTimestamp.verified, false);

  const wrongMode = await verifyIntent(worker, {
    ...intent,
    mode: 'open',
  }, sender);
  assert.equal(wrongMode.ok, true);
  assert.equal(wrongMode.verified, false);

  const wrongVersion = await verifyIntent(worker, {
    ...intent,
    v: 1,
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
  storedJob.createdAt = Date.now() - 60_000;

  const response = await verifyIntent(worker, {
    ...intent,
    createdAt: storedJob.createdAt,
  }, {
    url: worker.context.LingoFlashExtension.DEFAULT_APP_URL,
    tab: { id: 99 },
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
  assert.equal(intent.id, response.id);
  assert.equal(intent.mode, 'silent');
  assert.equal(intent.text, 'resilient');
});

test('rejects an app result from the wrong worker tab and cleans up a valid result', async () => {
  const worker = await createWorkerContext();
  const started = await startQuickAdd(worker);

  const wrongTab = await sendRuntimeMessage(worker, {
    type: 'APP_IMPORT_RESULT',
    bridgeType: 'LINGOFLASH_EXTENSION_RESULT',
    payload: { id: started.id, status: 'created', translation: 'bền bỉ' },
  }, {
    url: worker.context.LingoFlashExtension.DEFAULT_APP_URL,
    tab: { id: 123 },
  });
  assert.equal(wrongTab.ok, false);
  assert.match(wrongTab.error, /Tab trả kết quả không khớp/);
  assert.equal(worker.storageValues.size, 1);
  assert.equal(worker.calls.some(call => call.type === 'tabs.remove'), false);

  const wrongOrigin = await sendRuntimeMessage(worker, {
    type: 'APP_IMPORT_RESULT',
    bridgeType: 'LINGOFLASH_EXTENSION_RESULT',
    payload: { id: started.id, status: 'created', translation: 'bền bỉ' },
  }, {
    url: 'https://example.com/?view=library',
    tab: { id: 99 },
  });
  assert.equal(wrongOrigin.ok, false);
  assert.match(wrongOrigin.error, /Nguồn kết quả LingoFlash không hợp lệ/);
  assert.equal(worker.storageValues.size, 1);
  assert.equal(worker.calls.some(call => call.type === 'tabs.remove'), false);

  const valid = await sendRuntimeMessage(worker, {
    type: 'APP_IMPORT_RESULT',
    bridgeType: 'LINGOFLASH_EXTENSION_RESULT',
    payload: { id: started.id, status: 'created', translation: 'bền bỉ' },
  }, {
    url: worker.context.LingoFlashExtension.DEFAULT_APP_URL,
    tab: { id: 99 },
  });
  assert.equal(valid.ok, true);
  assert.equal(valid.ignored, false);
  assert.equal(worker.storageValues.size, 0);
  assert.ok(worker.calls.some(call => call.type === 'storage.remove'));
  assert.ok(worker.calls.some(call => call.type === 'alarms.clear'));
  assert.ok(worker.calls.some(call => call.type === 'tabs.remove' && call.id === 99));
});

test('ignores a result for a job that is no longer pending', async () => {
  const worker = await createWorkerContext();

  const response = await sendRuntimeMessage(worker, {
    type: 'APP_IMPORT_RESULT',
    bridgeType: 'LINGOFLASH_EXTENSION_RESULT',
    payload: { id: 'missing_job_123', status: 'existing', translation: 'đã có' },
  }, {
    url: worker.context.LingoFlashExtension.DEFAULT_APP_URL,
    tab: { id: 99 },
  });

  assert.equal(response.ok, true);
  assert.equal(response.ignored, true);
  assert.equal(worker.calls.some(call => call.type === 'tabs.remove'), false);
});
