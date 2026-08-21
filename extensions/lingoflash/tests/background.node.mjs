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
  fetchImpl = null,
  storageEntries = [],
  storageSetError = '',
  timerCapMs = null,
} = {}) => {
  const calls = [];
  const storageValues = new Map(storageEntries);
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
      if (storageSetError) {
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
        return { version: '1.4.0' };
      },
      sendMessage: message => {
        calls.push({ type: 'runtime.sendMessage', message });
        return Promise.resolve();
      },
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
  assert.equal(intent.v, 3);
  assert.equal(typeof intent.ticket, 'string');
  assert.equal(worker.storageValues.get(`lingoflash_quick_add_job_${id}`).ticket, intent.ticket);
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
  assert.equal(verified.intent.v, 3);
  assert.equal(verified.intent.id, started.id);
  assert.equal(verified.intent.text, 'resilient');
  assert.equal(verified.intent.ticket, intent.ticket);

  const forged = await verifyIntent(worker, {
    ...intent,
    ticket: 'forged_ticket_123456',
  }, sender);
  assert.equal(forged.ok, true);
  assert.equal(forged.verified, false);

  const wrongTicket = await verifyIntent(worker, {
    ...intent,
    ticket: 'wrong_ticket_123456',
  }, sender);
  assert.equal(wrongTicket.ok, true);
  assert.equal(wrongTicket.verified, false);

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

test('keeps the legacy v2 verifier available during the v3 rollout', async () => {
  const createdAt = Date.now();
  const worker = await createWorkerContext({ storageEntries: [[
    'lingoflash_quick_add_job_legacy_12345678',
    {
      v: 2,
      id: 'legacy_12345678',
      text: 'resilient',
      mode: 'silent',
      sourceTabId: 7,
      workerTabId: 99,
      createdAt,
    },
  ]] });
  const intent = worker.context.LingoFlashExtension.decodeImportIntentFromUrl(
    worker.context.LingoFlashExtension.buildImportUrl(
      worker.context.LingoFlashExtension.DEFAULT_APP_URL,
      'resilient',
      { id: 'legacy_12345678', mode: 'silent', createdAt },
    ),
  );
  const response = await verifyIntent(worker, intent, {
    url: worker.context.LingoFlashExtension.DEFAULT_APP_URL,
    tab: { id: 99 },
  });
  assert.equal(response.verified, true);
  assert.equal(response.intent.v, 2);
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
  assert.equal(intent.v, 3);
  assert.equal(typeof intent.ticket, 'string');
  assert.equal(worker.storageValues.get(`lingoflash_quick_add_job_${response.id}`).ticket, intent.ticket);
  assert.equal(intent.mode, 'silent');
  assert.equal('text' in intent, false);
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
  assert.equal(worker.storageValues.has(`lingoflash_quick_add_job_${started.id}`), false);
  assert.ok(worker.calls.some(call => call.type === 'storage.remove'));
  assert.ok(worker.calls.some(call => call.type === 'alarms.clear'));
  assert.ok(worker.calls.some(call => call.type === 'tabs.remove' && call.id === 99));
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
    payload: { id: started.id, status: 'created', translation: '' },
  };
  const sender = {
    url: worker.context.LingoFlashExtension.DEFAULT_APP_URL,
    tab: { id: 99 },
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
    payload: { id: started.id, status: 'created', translation: 'bền bỉ' },
  };

  const [wrong, valid] = await Promise.all([
    sendRuntimeMessage(worker, result, {
      url: worker.context.LingoFlashExtension.DEFAULT_APP_URL,
      tab: { id: 123 },
    }),
    sendRuntimeMessage(worker, result, {
      url: worker.context.LingoFlashExtension.DEFAULT_APP_URL,
      tab: { id: 99 },
    }),
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
    payload: { id: 'missing_job_123', status: 'existing', translation: 'đã có' },
  }, {
    url: worker.context.LingoFlashExtension.DEFAULT_APP_URL,
    tab: { id: 99 },
  });

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
    createdAt: Date.now() - 60_000,
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
