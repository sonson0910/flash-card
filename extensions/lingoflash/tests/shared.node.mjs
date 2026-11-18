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
  createImportNonce,
  decodeImportIntentFromUrl,
  IMPORT_PROTOCOL_V3,
  normalizeSilentImportIntent,
  isValidImportNonce,
  normalizeSettings,
  normalizeSelectionIconSites,
  selectionIconSitePatternFromUrl,
  isProtectedSelectionIconUrl,
  normalizeRecentLookup,
  recordRecentLookup,
  readRecentLookups,
  normalizeSelectedText,
  selectionValidation,
  validateAppUrl,
  t,
  normalizeDueCount,
  normalizeDueCountMetadata,
  MAX_DUE_COUNT,
  applyThemeFamily,
  normalizeCourseTargetLanguage,
  normalizeCourseNativeLanguage,
  normalizeCourseLocaleMetadata,
  normalizeRetiredCourseLocaleScopes,
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
    selectionIconSites: [],
    themeFamily: 'classic',
    colorScheme: 'system',
  });
  assert.deepEqual(normalizeSettings(null), DEFAULT_SETTINGS);
  assert.deepEqual(normalizeSettings({ themeFamily: 'crystal', colorScheme: 'dark' }), {
    ...DEFAULT_SETTINGS,
    themeFamily: 'crystal',
    colorScheme: 'dark',
  });
  assert.equal(normalizeSettings({ themeFamily: 'neon' }).themeFamily, 'classic');
  assert.equal(normalizeSettings({ colorScheme: 'midnight' }).colorScheme, 'system');
  assert.equal(normalizeSettings({ bubbleDurationMs: null }).bubbleDurationMs, DEFAULT_SETTINGS.bubbleDurationMs);
  assert.equal(normalizeSettings({ bubbleDurationMs: '' }).bubbleDurationMs, DEFAULT_SETTINGS.bubbleDurationMs);
});

test('applyThemeFamily sets a bounded data-theme-family attribute, defaulting unknown families to classic', () => {
  const attributes = new Map();
  const previousDocument = globalThis.document;
  globalThis.document = {
    documentElement: {
      setAttribute: (name, value) => attributes.set(name, value),
      removeAttribute: name => attributes.delete(name),
    },
  };
  try {
    applyThemeFamily('crystal');
    assert.equal(attributes.get('data-theme-family'), 'crystal');
    applyThemeFamily('classic');
    assert.equal(attributes.get('data-theme-family'), 'classic');
    applyThemeFamily('not-a-real-family');
    assert.equal(attributes.get('data-theme-family'), 'classic');
    applyThemeFamily(undefined);
    assert.equal(attributes.get('data-theme-family'), 'classic');
  } finally {
    globalThis.document = previousDocument;
  }
});

test('applyThemeFamily is a no-op without a document (e.g. before the DOM is ready)', () => {
  const previousDocument = globalThis.document;
  globalThis.document = undefined;
  try {
    assert.doesNotThrow(() => applyThemeFamily('crystal'));
  } finally {
    globalThis.document = previousDocument;
  }
});

test('normalizes the opt-in selection-icon site allowlist and excludes protected URLs', () => {
  assert.deepEqual(normalizeSelectionIconSites([
    'https://example.com/*',
    'https://example.com/*',
    'javascript:alert(1)',
    'https://other.example:8443/*',
  ]), ['https://example.com/*', 'https://other.example:8443/*']);
  assert.equal(selectionIconSitePatternFromUrl('https://example.com/article'), 'https://example.com/*');
  assert.equal(selectionIconSitePatternFromUrl('chrome://settings'), '');
  assert.equal(isProtectedSelectionIconUrl('https://encoded-hangout-433912-h2.web.app/?view=library'), true);
  assert.equal(isProtectedSelectionIconUrl('https://chromewebstore.google.com/detail/lingoflash'), true);
  assert.equal(selectionIconSitePatternFromUrl('https://chrome.google.com/webstore/detail/lingoflash'), '');
  assert.equal(isProtectedSelectionIconUrl('https://example.com/article'), false);
  assert.equal(isProtectedSelectionIconUrl('file:///tmp/example.html'), true);
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

test('preserves concurrent recent lookup writes', async () => {
  const { readFile } = await import('node:fs/promises');
  const { runInNewContext } = await import('node:vm');
  const values = new Map();
  const storage = {
    get(key, callback) {
      setTimeout(() => callback(key === null ? Object.fromEntries(values) : { [key]: values.get(key) }), 2);
    },
    set(input, callback) {
      setTimeout(() => {
        Object.entries(input).forEach(([key, value]) => values.set(key, value));
        callback?.();
      }, 2);
    },
    remove(key, callback) { values.delete(key); callback?.(); },
  };
  const source = await readFile(new URL('../shared.js', import.meta.url), 'utf8');
  const context = {
    chrome: { runtime: { lastError: null }, storage: { session: storage, sync: storage } },
    URL, URLSearchParams, TextEncoder, TextDecoder, Uint8Array, Uint32Array,
    Promise, Error, String, Number, Array, Object, Math, Date, setTimeout,
    crypto: globalThis.crypto, btoa, atob,
  };
  context.globalThis = context;
  runInNewContext(source, context);
  const api = context.LingoFlashExtension;

  await Promise.all([
    api.recordRecentLookup({ text: 'alpha', translation: 'al-pha', sourceLanguage: 'auto', targetLanguage: 'vi', kind: 'translate', status: 'translated', timestamp: Date.now() + 1 }),
    api.recordRecentLookup({ text: 'beta', translation: 'be-ta', sourceLanguage: 'auto', targetLanguage: 'vi', kind: 'translate', status: 'translated', timestamp: Date.now() + 2 }),
  ]);

  assert.deepEqual(
    Array.from((await api.readRecentLookups()).map(item => item.text)).sort(),
    ['alpha', 'beta'],
  );
});

test('preserves selection-icon sites when stale user settings save concurrently', async () => {
  const { readFile } = await import('node:fs/promises');
  const { runInNewContext } = await import('node:vm');
  const values = new Map([['lingoflash_extension_settings', {
    autoSpeak: false,
    selectionIconSites: ['https://alpha.example/*'],
  }]]);
  const storage = {
    get(key, callback) { setTimeout(() => callback({ [key]: values.get(key) }), 2); },
    set(input, callback) {
      setTimeout(() => {
        Object.entries(input).forEach(([key, value]) => values.set(key, value));
        callback?.();
      }, 2);
    },
    remove(key, callback) { values.delete(key); callback?.(); },
  };
  const source = await readFile(new URL('../shared.js', import.meta.url), 'utf8');
  const context = {
    chrome: { runtime: { lastError: null }, storage: { session: storage, sync: storage } },
    URL, URLSearchParams, TextEncoder, TextDecoder, Uint8Array, Uint32Array,
    Promise, Error, String, Number, Array, Object, Math, Date, setTimeout,
    crypto: globalThis.crypto, btoa, atob,
  };
  context.globalThis = context;
  runInNewContext(source, context);
  const api = context.LingoFlashExtension;

  await Promise.all([
    api.updateSelectionIconSites(sites => [...sites, 'https://beta.example/*']),
    api.writeUserSettings({ autoSpeak: true, selectionIconSites: ['https://alpha.example/*'] }),
  ]);

  const settings = await api.readSettings();
  assert.equal(settings.autoSpeak, true);
  assert.deepEqual(Array.from(settings.selectionIconSites).sort(), [
    'https://alpha.example/*',
    'https://beta.example/*',
  ]);
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

test('purges stale local history even when the history setting is disabled', async () => {
  const { readFile } = await import('node:fs/promises');
  const { runInNewContext } = await import('node:vm');
  const values = new Map([
    ['lingoflash_extension_settings', { recentLookupsEnabled: false }],
    ['lingoflash_recent_lookups', [
      { text: 'old', translation: 'cũ', sourceLanguage: 'en', targetLanguage: 'vi', kind: 'translate', status: 'translated', timestamp: Date.now() - 8 * 24 * 60 * 60 * 1000 },
      { text: 'new', translation: 'mới', sourceLanguage: 'fr', targetLanguage: 'vi', kind: 'translate', status: 'translated', timestamp: Date.now() },
    ]],
  ]);
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

  assert.equal(history.length, 0);
  assert.deepEqual(values.get('lingoflash_recent_lookups').map(item => item.text), ['new']);
});

test('falls back to the caller-supplied text outside a real i18n runtime', () => {
  assert.equal(t('missingKey', [], 'Chưa gán'), 'Chưa gán');
  assert.equal(t('missingKey'), '');
});

test('localizeDocument upgrades text only when a real i18n runtime resolves a different message', async () => {
  const { readFile } = await import('node:fs/promises');
  const { runInNewContext } = await import('node:vm');
  const source = await readFile(new URL('../shared.js', import.meta.url), 'utf8');
  const makeElement = (i18nKey, textContent) => ({
    dataset: { i18n: i18nKey },
    textContent,
    children: [],
  });
  const untouched = makeElement('shortcutConfigure', 'Cấu hình phím tắt');
  const translated = makeElement('shortcutConfigure', 'Cấu hình phím tắt');
  const document = {
    querySelectorAll: () => [untouched],
  };
  const contextNoI18n = {
    chrome: undefined,
    browser: undefined,
    document,
    URL, URLSearchParams, TextEncoder, TextDecoder, Uint8Array, Uint32Array,
    Promise, Error, String, Number, Array, Object, Math, Date,
    crypto: globalThis.crypto, btoa, atob,
  };
  contextNoI18n.globalThis = contextNoI18n;
  runInNewContext(source, contextNoI18n);
  contextNoI18n.LingoFlashExtension.localizeDocument(document);
  assert.equal(untouched.textContent, 'Cấu hình phím tắt');

  const contextWithI18n = {
    chrome: { i18n: { getMessage: name => (name === 'shortcutConfigure' ? 'Configure shortcuts' : '') } },
    document: { querySelectorAll: () => [translated] },
    URL, URLSearchParams, TextEncoder, TextDecoder, Uint8Array, Uint32Array,
    Promise, Error, String, Number, Array, Object, Math, Date,
    crypto: globalThis.crypto, btoa, atob,
  };
  contextWithI18n.globalThis = contextWithI18n;
  runInNewContext(source, contextWithI18n);
  contextWithI18n.LingoFlashExtension.localizeDocument(contextWithI18n.document);
  assert.equal(translated.textContent, 'Configure shortcuts');
});

test('bounds and validates due-count metadata like deck metadata', () => {
  assert.equal(normalizeDueCount(12), 12);
  assert.equal(normalizeDueCount(-1), null);
  assert.equal(normalizeDueCount(1.5), null);
  assert.equal(normalizeDueCount(MAX_DUE_COUNT + 500), MAX_DUE_COUNT);
  assert.deepEqual(normalizeDueCountMetadata({ scope: 'a'.repeat(12), count: 7 }), { scope: 'a'.repeat(12), count: 7 });
  assert.equal(normalizeDueCountMetadata({ scope: '', count: 7 }), null);
  assert.equal(normalizeDueCountMetadata({ scope: 'a'.repeat(12), count: -1 }), null);
  assert.equal(normalizeDueCountMetadata(null), null);
});

test('normalizes course target/native languages to the known contract lists, dropping anything else (07.5)', () => {
  assert.equal(normalizeCourseTargetLanguage('ko'), 'ko');
  assert.equal(normalizeCourseTargetLanguage('fr'), '');
  assert.equal(normalizeCourseTargetLanguage(undefined), '');
  assert.equal(normalizeCourseNativeLanguage('en'), 'en');
  assert.equal(normalizeCourseNativeLanguage('vi'), 'vi');
  assert.equal(normalizeCourseNativeLanguage('fr'), '');
});

test('bounds and validates course-locale metadata like deck metadata and due count (07.5)', () => {
  assert.deepEqual(
    normalizeCourseLocaleMetadata({ scope: 'a'.repeat(12), nativeLanguage: 'en', targetLanguage: 'ko' }),
    { scope: 'a'.repeat(12), nativeLanguage: 'en', targetLanguage: 'ko' },
  );
  assert.equal(normalizeCourseLocaleMetadata({ scope: '', nativeLanguage: 'en', targetLanguage: 'ko' }), null);
  assert.equal(normalizeCourseLocaleMetadata({ scope: 'a'.repeat(12), nativeLanguage: 'fr', targetLanguage: 'ko' }), null);
  assert.equal(normalizeCourseLocaleMetadata({ scope: 'a'.repeat(12), nativeLanguage: 'en', targetLanguage: 'fr' }), null);
  assert.equal(normalizeCourseLocaleMetadata(null), null);
});

test('retires course-locale scopes with the same bounded dedup rules as deck metadata (07.5)', () => {
  assert.deepEqual(
    normalizeRetiredCourseLocaleScopes(['a'.repeat(12), 'a'.repeat(12), 'b'.repeat(12)]),
    ['a'.repeat(12), 'b'.repeat(12)],
  );
  assert.deepEqual(normalizeRetiredCourseLocaleScopes(null), []);
});

test('ignores a delayed locale catalog after its provider scope is retired', async () => {
  const { readFile } = await import('node:fs/promises');
  const { runInNewContext } = await import('node:vm');
  const source = await readFile(new URL('../shared.js', import.meta.url), 'utf8');
  let resolveLocaleResponse;
  let resolveCatalog;
  const context = {
    browser: {
      runtime: {
        sendMessage: () => new Promise(resolve => { resolveLocaleResponse = resolve; }),
        getURL: path => `chrome-extension://test/${path}`,
      },
      i18n: {
        getUILanguage: () => 'vi',
        getMessage: () => '',
      },
      storage: {
        session: { get: () => Promise.resolve({}), set: () => Promise.resolve(), remove: () => Promise.resolve() },
        sync: { get: () => Promise.resolve({}), set: () => Promise.resolve(), remove: () => Promise.resolve() },
      },
    },
    fetch: () => Promise.resolve({
      ok: true,
      json: () => new Promise(resolve => { resolveCatalog = resolve; }),
    }),
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
  const api = context.LingoFlashExtension;
  const applying = api.applyCourseUiLocale();
  resolveLocaleResponse({
    ok: true,
    nativeLanguage: 'en',
    targetLanguage: 'ko',
    generation: 1,
    scope: 'opaque_scope_locale_a_123456',
  });
  await Promise.resolve();
  await Promise.resolve();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(typeof resolveCatalog, 'function');

  api.invalidateExtensionMetadata({
    generation: 1,
    scopes: { locale: 'opaque_scope_locale_a_123456' },
  });
  resolveCatalog({
    dueCountBadge: { message: '$COUNT$ cards due' },
  });

  assert.equal(await applying, false);
  assert.equal(api.getActiveCourseTargetLanguage(), '');
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
  const nonce = 'nonce_1234567890123456789012';
  const url = buildImportUrl(DEFAULT_APP_URL, 'resilient', {
    id: 'job_123456789',
    nonce,
    mode: 'silent',
    createdAt,
  });
  assert.deepEqual(decodeImportIntentFromUrl(url), {
    v: IMPORT_PROTOCOL_VERSION,
    id: 'job_123456789',
    nonce,
    text: 'resilient',
    createdAt,
    mode: 'silent',
  });
});

test('builds the v1.6 quick-add handoff with a secure session nonce', () => {
  const nonce = createImportNonce();
  assert.equal(isValidImportNonce(nonce), true);
  const createdAt = Date.UTC(2026, 7, 28, 8, 0, 0);
  const url = buildImportUrl(DEFAULT_APP_URL, 'resilient', {
    id: 'job_123456789',
    nonce,
    mode: 'silent',
    createdAt,
  });
  assert.deepEqual(decodeImportIntentFromUrl(url), {
    v: IMPORT_PROTOCOL_V3,
    id: 'job_123456789',
    nonce,
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
    nonce: 'nonce_1234567890123456789012',
    text: '  resilient\nlearning  ',
    createdAt: Date.UTC(2026, 7, 19, 8, 0, 0),
    mode: 'silent',
  });
  assert.deepEqual(candidate, {
    v: IMPORT_PROTOCOL_VERSION,
    id: 'job_123456789',
    nonce: 'nonce_1234567890123456789012',
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


test('retains the newest sixteen retired scopes', () => {
  const scopes = Array.from({length: 100}, (_, i) => `opaque_scope_${i}_123456`);
  assert.deepEqual(globalThis.LingoFlashExtension.normalizeRetiredDeckScopes(scopes), scopes.slice(-16));
});
