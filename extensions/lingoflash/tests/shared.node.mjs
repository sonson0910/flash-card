import assert from 'node:assert/strict';
import test from 'node:test';

await import('../shared.js');

const {
  APP_ORIGIN,
  DEFAULT_APP_URL,
  IMPORT_PROTOCOL_VERSION,
  MAX_ENCODED_IMPORT_LENGTH,
  MAX_TEXT_LENGTH,
  buildImportUrl,
  decodeImportIntentFromUrl,
  normalizeSilentImportIntent,
  normalizeSelectedText,
  selectionValidation,
  validateAppUrl,
} = globalThis.LingoFlashExtension;
const NONCE = 'nonce_123456789012345678';

test('normalizes browser selection', () => {
  assert.equal(normalizeSelectedText('  spaced\n   repetition '), 'spaced repetition');
});

test('rejects empty and oversized selection', () => {
  assert.equal(selectionValidation('   ').ok, false);
  assert.equal(selectionValidation('x'.repeat(MAX_TEXT_LENGTH + 1)).ok, false);
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
    nonce: NONCE,
    mode: 'silent',
    createdAt,
  });
  assert.deepEqual(decodeImportIntentFromUrl(url), {
    v: IMPORT_PROTOCOL_VERSION,
    id: 'job_123456789',
    nonce: NONCE,
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
    nonce: NONCE,
    text: '  resilient\nlearning  ',
    createdAt: Date.UTC(2026, 7, 19, 8, 0, 0),
    mode: 'silent',
  });
  assert.deepEqual(candidate, {
    v: IMPORT_PROTOCOL_VERSION,
    id: 'job_123456789',
    nonce: NONCE,
    text: 'resilient learning',
    createdAt: Date.UTC(2026, 7, 19, 8, 0, 0),
    mode: 'silent',
  });
  assert.equal(normalizeSilentImportIntent({ ...candidate, mode: 'open' }), null);
  assert.equal(normalizeSilentImportIntent({ ...candidate, createdAt: 0 }), null);
  assert.equal(normalizeSilentImportIntent({ ...candidate, nonce: undefined }), null);
  assert.equal(normalizeSilentImportIntent({ ...candidate, v: 2 }), null);
});

test('rejects oversized encoded imports before invoking atob', () => {
  const originalAtob = globalThis.atob;
  let calls = 0;
  globalThis.atob = value => { calls += 1; return originalAtob(value); };
  try {
    assert.throws(() => decodeImportIntentFromUrl(
      `${DEFAULT_APP_URL}#lf-import=${'a'.repeat(MAX_ENCODED_IMPORT_LENGTH + 1)}`,
    ));
    assert.equal(calls, 0);
  } finally {
    globalThis.atob = originalAtob;
  }
});

test('fails closed when secure nonce generation is unavailable', async () => {
  const { readFile } = await import('node:fs/promises');
  const { runInNewContext } = await import('node:vm');
  const source = await readFile(new URL('../shared.js', import.meta.url), 'utf8');
  const context = {
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
    crypto: null,
    btoa,
    atob,
  };
  context.globalThis = context;
  runInNewContext(source, context);
  assert.throws(() => context.LingoFlashExtension.createImportNonce(), /Secure import nonce/);
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
  assert.equal('settingsStorage' in context.LingoFlashExtension, false);
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
