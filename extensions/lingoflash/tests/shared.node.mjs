import assert from 'node:assert/strict';
import test from 'node:test';

await import('../shared.js');

const {
  APP_ORIGIN,
  DEFAULT_SETTINGS,
  DEFAULT_APP_URL,
  IMPORT_PROTOCOL_VERSION,
  MAX_RECENT_LOOKUPS,
  MAX_TEXT_LENGTH,
  buildImportUrl,
  decodeImportIntentFromUrl,
  normalizeSilentImportIntent,
  normalizeSettings,
  normalizeRecentLookup,
  recordRecentLookup,
  readRecentLookups,
  normalizeSelectedText,
  selectionValidation,
  validateAppUrl,
} = globalThis.LingoFlashExtension;

test('normalizes browser selection', () => {
  assert.equal(normalizeSelectedText('  spaced\n   repetition '), 'spaced repetition');
});

test('rejects empty and oversized selection', () => {
  assert.equal(selectionValidation('   ').ok, false);
  assert.equal(selectionValidation('x'.repeat(MAX_TEXT_LENGTH + 1)).ok, false);
});

test('normalizes settings to safe bounded defaults', () => {
  assert.deepEqual(normalizeSettings({
    autoSpeak: 'yes',
    bubbleDurationMs: 99_999,
    recentLookupsEnabled: false,
    quickTranslateSource: 'invalid',
    quickTranslateTarget: 'en',
  }), {
    autoSpeak: false,
    bubbleDurationMs: 60_000,
    recentLookupsEnabled: false,
    quickTranslateSource: 'auto',
    quickTranslateTarget: 'vi',
  });
  assert.deepEqual(normalizeSettings(null), DEFAULT_SETTINGS);
});

test('normalizes recent lookup metadata and rejects unsafe records', () => {
  const item = normalizeRecentLookup({
    text: '  resilient  ',
    translation: '  bền\n bỉ ',
    sourceLanguage: 'auto',
    targetLanguage: 'vi',
    kind: 'translate',
    status: 'translated',
    timestamp: Date.now(),
  });
  assert.equal(item.text, 'resilient');
  assert.equal(item.translation, 'bền bỉ');
  assert.equal(normalizeRecentLookup({ ...item, text: 'x'.repeat(MAX_TEXT_LENGTH + 1) }), null);
});

test('keeps recent lookups bounded and deduplicated', async () => {
  const { readFile } = await import('node:fs/promises');
  const { runInNewContext } = await import('node:vm');
  const values = new Map();
  const storage = {
    get(key, callback) { callback(key === null ? Object.fromEntries(values) : { [key]: values.get(key) }); },
    set(input, callback) { Object.entries(input).forEach(([key, value]) => values.set(key, value)); callback?.(); },
    remove(key, callback) { values.delete(key); callback?.(); },
  };
  const source = await readFile(new URL('../shared.js', import.meta.url), 'utf8');
  const context = {
    chrome: { runtime: { lastError: null }, storage: { session: storage, sync: storage } },
    URL, URLSearchParams, TextEncoder, TextDecoder, Uint8Array, Uint32Array,
    Promise, Error, String, Number, Array, Object, Math, Date,
    crypto: globalThis.crypto, btoa, atob,
  };
  context.globalThis = context;
  runInNewContext(source, context);
  const api = context.LingoFlashExtension;
  for (let index = 0; index < MAX_RECENT_LOOKUPS + 2; index += 1) {
    await api.recordRecentLookup({
      text: `word-${index}`,
      translation: `dịch-${index}`,
      sourceLanguage: 'auto',
      targetLanguage: 'vi',
      kind: 'translate',
      status: 'translated',
      timestamp: Date.now() + index,
    });
  }
  const history = await api.readRecentLookups();
  assert.equal(history.length, MAX_RECENT_LOOKUPS);
  assert.equal(new Set(history.map(item => item.text)).size, MAX_RECENT_LOOKUPS);
  assert.equal(history[0].text, 'word-11');
});

test('expires stale recent lookups when storage falls back to local', async () => {
  const { readFile } = await import('node:fs/promises');
  const { runInNewContext } = await import('node:vm');
  const values = new Map([['lingoflash_recent_lookups', [
    { text: 'old', translation: 'cũ', sourceLanguage: 'auto', targetLanguage: 'vi', kind: 'translate', status: 'translated', timestamp: Date.now() - 8 * 24 * 60 * 60 * 1000 },
    { text: 'new', translation: 'mới', sourceLanguage: 'auto', targetLanguage: 'vi', kind: 'translate', status: 'translated', timestamp: Date.now() },
  ]]]);
  const storage = {
    get(key, callback) { callback({ [key]: values.get(key) }); },
    set(input, callback) { Object.entries(input).forEach(([key, value]) => values.set(key, value)); callback?.(); },
    remove(key, callback) { values.delete(key); callback?.(); },
  };
  const source = await readFile(new URL('../shared.js', import.meta.url), 'utf8');
  const context = {
    chrome: { runtime: { lastError: null }, storage: { local: storage } },
    URL, URLSearchParams, TextEncoder, TextDecoder, Uint8Array, Uint32Array,
    Promise, Error, String, Number, Array, Object, Math, Date,
    crypto: globalThis.crypto, btoa, atob,
  };
  context.globalThis = context;
  runInNewContext(source, context);
  const history = await context.LingoFlashExtension.readRecentLookups();
  assert.deepEqual(history.map(item => item.text), ['new']);
  assert.equal(values.get('lingoflash_recent_lookups').length, 1);
});

test('locks the extension to the production LingoFlash origin', () => {
  assert.equal(validateAppUrl(DEFAULT_APP_URL).ok, true);
  assert.equal(validateAppUrl(`${APP_ORIGIN}/another-path`).ok, true);
  assert.equal(validateAppUrl('https://example.com').ok, false);
  assert.equal(validateAppUrl('javascript:alert(1)').ok, false);
});

test('builds a Unicode-safe open import payload', () => {
  const createdAt = Date.UTC(2026, 7, 19, 8, 0, 0);
  const url = buildImportUrl(DEFAULT_APP_URL, 'café culture', createdAt);
  const intent = decodeImportIntentFromUrl(url);
  assert.equal(new URL(url).searchParams.get('view'), 'library');
  assert.equal(intent.v, IMPORT_PROTOCOL_VERSION);
  assert.match(intent.id, /^[A-Za-z0-9_-]{8,128}$/);
  assert.equal(intent.text, 'café culture');
  assert.equal(intent.createdAt, createdAt);
  assert.equal(intent.mode, undefined);
});

test('builds a silent import with a caller-owned operation id', () => {
  const createdAt = Date.UTC(2026, 7, 19, 8, 0, 0);
  const url = buildImportUrl(DEFAULT_APP_URL, 'resilient', {
    id: 'job_123456789',
    mode: 'silent',
    createdAt,
  });
  assert.deepEqual(decodeImportIntentFromUrl(url), {
    v: IMPORT_PROTOCOL_VERSION,
    id: 'job_123456789',
    text: 'resilient',
    createdAt,
    mode: 'silent',
  });
});

test('rejects invalid silent-import options', () => {
  assert.throws(() => buildImportUrl(DEFAULT_APP_URL, 'word', { id: 'bad', mode: 'silent' }));
  assert.throws(() => buildImportUrl(DEFAULT_APP_URL, 'word', { id: 'job_123456789', mode: 'other' }));
});

test('normalizes only complete silent import candidates at the extension boundary', () => {
  const candidate = normalizeSilentImportIntent({
    v: IMPORT_PROTOCOL_VERSION,
    id: 'job_123456789',
    text: '  resilient\nlearning  ',
    createdAt: Date.UTC(2026, 7, 19, 8, 0, 0),
    mode: 'silent',
  });
  assert.deepEqual(candidate, {
    v: IMPORT_PROTOCOL_VERSION,
    id: 'job_123456789',
    text: 'resilient learning',
    createdAt: Date.UTC(2026, 7, 19, 8, 0, 0),
    mode: 'silent',
  });
  assert.equal(normalizeSilentImportIntent({ ...candidate, mode: 'open' }), null);
  assert.equal(normalizeSilentImportIntent({ ...candidate, createdAt: 0 }), null);
});

test('uses Promise-style browser APIs without appending a callback', async () => {
  const { readFile } = await import('node:fs/promises');
  const { runInNewContext } = await import('node:vm');
  const source = await readFile(new URL('../shared.js', import.meta.url), 'utf8');
  const calls = [];
  const sessionStorageArea = {};
  const context = {
    browser: { runtime: {}, storage: { session: sessionStorageArea } },
    URL,
    URLSearchParams,
    TextEncoder,
    TextDecoder,
    Uint8Array,
    Uint32Array,
    Promise,
    Error,
    String,
    Number,
    Array,
    Object,
    Math,
    Date,
    crypto: globalThis.crypto,
    btoa,
    atob,
  };
  context.globalThis = context;
  runInNewContext(source, context);
  const result = await context.LingoFlashExtension.apiCall({
    example: (...args) => {
      calls.push(args);
      return Promise.resolve('promise-result');
    },
  }, 'example', 'input');
  assert.equal(result, 'promise-result');
  assert.deepEqual(calls, [['input']]);
  assert.equal(context.LingoFlashExtension.settingsStorage, null);
  assert.equal('readConfiguredAppUrl' in context.LingoFlashExtension, false);
  assert.equal(context.LingoFlashExtension.transientStorage, sessionStorageArea);
});

test('wraps callback-style Chrome APIs', async () => {
  const { readFile } = await import('node:fs/promises');
  const { runInNewContext } = await import('node:vm');
  const source = await readFile(new URL('../shared.js', import.meta.url), 'utf8');
  const context = {
    chrome: { runtime: { lastError: null } },
    URL,
    URLSearchParams,
    TextEncoder,
    TextDecoder,
    Uint8Array,
    Uint32Array,
    Promise,
    Error,
    String,
    Number,
    Array,
    Object,
    Math,
    Date,
    crypto: globalThis.crypto,
    btoa,
    atob,
  };
  context.globalThis = context;
  runInNewContext(source, context);
  const result = await context.LingoFlashExtension.apiCall({
    example: (input, callback) => callback(`${input}-callback-result`),
  }, 'example', 'input');
  assert.equal(result, 'input-callback-result');
});
