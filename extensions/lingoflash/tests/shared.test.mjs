import assert from 'node:assert/strict';
import test from 'node:test';

await import('../shared.js');

const {
  DEFAULT_APP_URL,
  MAX_TEXT_LENGTH,
  buildImportUrl,
  decodeImportIntentFromUrl,
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

test('accepts HTTPS and local development URLs only', () => {
  assert.equal(validateAppUrl(DEFAULT_APP_URL).ok, true);
  assert.equal(validateAppUrl('http://localhost:3000').ok, true);
  assert.equal(validateAppUrl('http://example.com').ok, false);
  assert.equal(validateAppUrl('javascript:alert(1)').ok, false);
});

test('builds a Unicode-safe import payload compatible with the app protocol', () => {
  const createdAt = Date.UTC(2026, 7, 19, 8, 0, 0);
  const url = buildImportUrl(DEFAULT_APP_URL, 'café culture', createdAt);
  const intent = decodeImportIntentFromUrl(url);
  assert.equal(new URL(url).searchParams.get('view'), 'library');
  assert.equal(intent.v, 1);
  assert.match(intent.id, /^[A-Za-z0-9_-]{8,128}$/);
  assert.equal(intent.text, 'café culture');
  assert.equal(intent.createdAt, createdAt);
});

test('uses Promise-style browser APIs without appending a callback', async () => {
  const { readFile } = await import('node:fs/promises');
  const { runInNewContext } = await import('node:vm');
  const source = await readFile(new URL('../shared.js', import.meta.url), 'utf8');
  const calls = [];
  const localStorageArea = {};
  const context = {
    browser: { runtime: {}, storage: { local: localStorageArea } },
    URL,
    URLSearchParams,
    TextEncoder,
    TextDecoder,
    Uint8Array,
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
  assert.equal(context.LingoFlashExtension.settingsStorage, localStorageArea);
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
