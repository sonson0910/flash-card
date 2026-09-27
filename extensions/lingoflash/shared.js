(() => {
  'use strict';

  const DEFAULT_APP_URL = 'https://encoded-hangout-433912-h2.web.app/?view=library';
  const APP_ORIGIN = new URL(DEFAULT_APP_URL).origin;
  const IMPORT_HASH_KEY = 'lf-import';
  const MAX_TEXT_LENGTH = 80;
  const MAX_CONTEXT_LENGTH = 500;
  const MAX_SOURCE_URL_LENGTH = 2048;
  const MAX_PAGE_TITLE_LENGTH = 256;
  const IMPORT_PROTOCOL_VERSION = 3;
  const IMPORT_PROTOCOL_V3 = 3;
  const MAX_ENCODED_IMPORT_LENGTH = 2048;
  const IMPORT_NONCE_PATTERN = /^[A-Za-z0-9_-]{22,64}$/;
  const SETTINGS_STORAGE_KEY = 'lingoflash_extension_settings';
  const RECENT_LOOKUPS_STORAGE_KEY = 'lingoflash_recent_lookups';
  const DECK_METADATA_STORAGE_KEY = 'lingoflash_extension_deck_metadata';
  const DECK_METADATA_RETIRED_SCOPES_STORAGE_KEY = 'lingoflash_extension_deck_retired_scopes';
  // Due count follows the exact same session-only, scope-retirement pattern as
  // deck metadata: it is real study state synced from the signed-in app, never
  // fabricated, and must not leak a previous account's number after
  // reconnect/account switch (07.6).
  const DUE_COUNT_STORAGE_KEY = 'lingoflash_extension_due_count';
  const DUE_COUNT_RETIRED_SCOPES_STORAGE_KEY = 'lingoflash_extension_due_count_retired_scopes';
  const MAX_DUE_COUNT = 9_999;
  // Course locale follows the exact same session-only, scope-retirement
  // pattern as deck metadata and due count: it is real course state synced
  // from the signed-in app, never fabricated, and must not leak a previous
  // account's language pair after reconnect/account switch (07.5). The two
  // lists below duplicate `COURSE_TARGET_LANGUAGES`/`COURSE_NATIVE_LANGUAGES`
  // from functions/src/course-profile-contract.ts; this file has no module
  // system to import from it, so keep both lists in sync with that contract.
  const COURSE_LOCALE_STORAGE_KEY = 'lingoflash_extension_course_locale';
  const COURSE_LOCALE_RETIRED_SCOPES_STORAGE_KEY = 'lingoflash_extension_course_locale_retired_scopes';
  const COURSE_TARGET_LANGUAGES = ['en', 'ko', 'ja', 'zh'];
  const COURSE_NATIVE_LANGUAGES = ['vi', 'en'];
  const MAX_DECKS = 100;
  const MAX_DECK_NAME_LENGTH = 128;
  const MAX_DECK_SCOPE_LENGTH = 128;
  const MAX_SELECTION_ICON_SITES = 100;
  const MAX_RECENT_LOOKUPS = 10;
  const RECENT_LOOKUP_TTL_MS = 7 * 24 * 60 * 60 * 1000;
  const THEME_FAMILIES = ['classic', 'crystal'];
  const COLOR_SCHEMES = ['system', 'dark', 'light'];
  const DEFAULT_SETTINGS = Object.freeze({
    autoSpeak: false,
    bubbleDurationMs: 12_000,
    recentLookupsEnabled: true,
    quickTranslateSource: 'auto',
    quickTranslateTarget: 'vi',
    selectionIconSites: [],
    // Appearance mirrors the app's Classic/Crystal Star theme families so the
    // extension can move onto the same Canvas boards in both (07.1). Purely a
    // local display preference; never sent anywhere.
    themeFamily: 'classic',
    colorScheme: 'system',
  });

  const promiseExtensionApi = globalThis.browser ?? null;
  const extensionApi = promiseExtensionApi ?? globalThis.chrome;
  const usesPromiseApi = Boolean(promiseExtensionApi);
  const transientStorage = extensionApi?.storage?.session ?? extensionApi?.storage?.local ?? null;
  const settingsStorage = extensionApi?.storage?.sync ?? extensionApi?.storage?.local ?? null;
  const usesSessionStorage = Boolean(extensionApi?.storage?.session);

  const createMemoryStorage = promiseMode => {
    const values = new Map();
    const read = key => key === null
      ? Object.fromEntries(values)
      : { [key]: values.get(key) };
    return {
      get(key, callback) {
        const result = read(key);
        if (promiseMode) return Promise.resolve(result);
        callback?.(result);
        return undefined;
      },
      set(entries, callback) {
        Object.entries(entries ?? {}).forEach(([key, value]) => values.set(key, value));
        if (promiseMode) return Promise.resolve();
        callback?.();
        return undefined;
      },
      remove(key, callback) {
        values.delete(key);
        if (promiseMode) return Promise.resolve();
        callback?.();
        return undefined;
      },
    };
  };

  // Deck names are transient metadata. Never fall back to storage.local:
  // browsers without storage.session must lose this cache with the worker.
  const deckMetadataStorage = extensionApi?.storage?.session
    ?? createMemoryStorage(usesPromiseApi);
  let settingsMutationTail = Promise.resolve();
  let recentLookupMutationTail = Promise.resolve();

  const withSettingsMutationLock = async work => {
    const previous = settingsMutationTail;
    let release;
    settingsMutationTail = new Promise(resolve => { release = resolve; });
    await previous.catch(() => undefined);
    try { return await work(); } finally { release(); }
  };

  const withRecentLookupMutationLock = async work => {
    const previous = recentLookupMutationTail;
    let release;
    recentLookupMutationTail = new Promise(resolve => { release = resolve; });
    await previous.catch(() => undefined);
    try { return await work(); } finally { release(); }
  };

  const normalizeSelectedText = value => String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();

  const normalizeContext = value => normalizeSelectedText(value).slice(0, MAX_CONTEXT_LENGTH);
  const boundedPageTitle = value => normalizeSelectedText(value).slice(0, MAX_PAGE_TITLE_LENGTH);

  // Strip credentials, the query string, and the fragment before this URL
  // ever leaves the page/worker context. Query and fragment routinely carry
  // session tokens, auth codes, or tracking identifiers with no value for
  // "which page did this word come from" but real privacy exposure; origin +
  // pathname is enough to recognize or revisit the page. http/https only.
  // The server (`parseCardSourceMetadata`) re-applies the exact same rule, so
  // this is the write-side sanitization, not the only line of defense.
  const sanitizeSourceUrl = value => {
    if (typeof value !== 'string' || !value || value.length > MAX_SOURCE_URL_LENGTH) return '';
    try {
      const url = new URL(value);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
      url.username = '';
      url.password = '';
      url.search = '';
      url.hash = '';
      const serialized = url.toString();
      return serialized.length <= MAX_SOURCE_URL_LENGTH ? serialized : '';
    } catch {
      return '';
    }
  };

  const selectionValidation = value => {
    const text = normalizeSelectedText(value);
    if (!text) {
      return { ok: false, error: 'Hãy bôi đen một từ hoặc cụm từ tiếng Anh trước.' };
    }
    if (text.length > MAX_TEXT_LENGTH) {
      return {
        ok: false,
        error: `Đoạn đã chọn dài ${text.length} ký tự. LingoFlash hỗ trợ tối đa ${MAX_TEXT_LENGTH} ký tự.`,
      };
    }
    return { ok: true, text };
  };

  const normalizeSettings = value => {
    const candidate = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const rawDuration = candidate.bubbleDurationMs;
    const duration = rawDuration === null || rawDuration === undefined
      || (typeof rawDuration === 'string' && rawDuration.trim() === '')
      ? Number.NaN
      : Number(rawDuration);
    const bubbleDurationMs = Number.isFinite(duration)
      ? Math.min(60_000, Math.max(0, Math.round(duration / 1_000) * 1_000))
      : DEFAULT_SETTINGS.bubbleDurationMs;
    return {
      autoSpeak: candidate.autoSpeak === true,
      bubbleDurationMs,
      recentLookupsEnabled: candidate.recentLookupsEnabled !== false,
      quickTranslateSource: candidate.quickTranslateSource === 'en' ? 'en' : DEFAULT_SETTINGS.quickTranslateSource,
      quickTranslateTarget: candidate.quickTranslateTarget === 'vi' ? 'vi' : DEFAULT_SETTINGS.quickTranslateTarget,
      selectionIconSites: normalizeSelectionIconSites(candidate.selectionIconSites),
      themeFamily: THEME_FAMILIES.includes(candidate.themeFamily) ? candidate.themeFamily : DEFAULT_SETTINGS.themeFamily,
      colorScheme: COLOR_SCHEMES.includes(candidate.colorScheme) ? candidate.colorScheme : DEFAULT_SETTINGS.colorScheme,
    };
  };

  const isProtectedSelectionIconUrl = value => {
    try {
      const url = new URL(String(value ?? ''));
      const protectedHosts = new Set([
        'chrome.google.com',
        'chromewebstore.google.com',
        'edge.microsoft.com',
        'microsoftedge.microsoft.com',
        'addons.mozilla.org',
      ]);
      return url.protocol !== 'http:' && url.protocol !== 'https:'
        || url.origin === APP_ORIGIN
        || protectedHosts.has(url.hostname.toLowerCase())
        || Boolean(url.username || url.password);
    } catch {
      return true;
    }
  };

  const normalizeSelectionIconSitePattern = value => {
    if (typeof value !== 'string' || !value.trim()) return '';
    const candidate = value.trim();
    if (!/^(?:https?:)\/\/[^/*?#]+(?:\:\d+)?\/\*$/i.test(candidate)) return '';
    try {
      const url = new URL(candidate.slice(0, -1));
      if (isProtectedSelectionIconUrl(url.toString())) return '';
      return `${url.protocol}//${url.host}/*`;
    } catch {
      return '';
    }
  };

  const normalizeSelectionIconSites = value => {
    if (!Array.isArray(value)) return [];
    const seen = new Set();
    for (const entry of value) {
      const pattern = normalizeSelectionIconSitePattern(entry);
      if (!pattern || seen.has(pattern)) continue;
      seen.add(pattern);
      if (seen.size >= MAX_SELECTION_ICON_SITES) break;
    }
    return [...seen];
  };

  const selectionIconSitePatternFromUrl = value => {
    if (isProtectedSelectionIconUrl(value)) return '';
    try {
      const url = new URL(String(value));
      return `${url.protocol}//${url.host}/*`;
    } catch {
      return '';
    }
  };

  const validateAppUrl = value => {
    try {
      const url = new URL(String(value ?? '').trim());
      if (url.origin !== APP_ORIGIN) {
        return { ok: false, error: 'Bản extension này chỉ kết nối với LingoFlash production.' };
      }
      if (url.username || url.password) {
        return { ok: false, error: 'URL ứng dụng không được chứa thông tin đăng nhập.' };
      }
      url.hash = '';
      url.searchParams.set('view', 'library');
      return { ok: true, url: url.toString() };
    } catch {
      return { ok: false, error: 'URL ứng dụng không hợp lệ.' };
    }
  };

  const encodeBase64UrlUtf8 = value => {
    const bytes = new TextEncoder().encode(value);
    let binary = '';
    bytes.forEach(byte => { binary += String.fromCharCode(byte); });
    return btoa(binary)
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/g, '');
  };

  const decodeBase64UrlUtf8 = encoded => {
    if (typeof encoded !== 'string' || encoded.length > MAX_ENCODED_IMPORT_LENGTH) {
      throw new Error('Encoded import payload is too large.');
    }
    if (!/^[A-Za-z0-9_-]+$/.test(encoded)) throw new Error('Invalid base64url payload.');
    const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  };

  const createIntentId = () => {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    const random = globalThis.crypto?.getRandomValues
      ? globalThis.crypto.getRandomValues(new Uint32Array(4))
      : [Date.now(), Math.random() * 0xFFFFFFFF, Math.random() * 0xFFFFFFFF, Math.random() * 0xFFFFFFFF];
    return Array.from(random, value => Math.floor(Number(value)).toString(36)).join('_');
  };

  const isValidIntentId = value => typeof value === 'string'
    && /^[A-Za-z0-9_-]{8,128}$/.test(value);

  const isValidImportNonce = value => typeof value === 'string' && IMPORT_NONCE_PATTERN.test(value);

  const createImportNonce = () => {
    const secureCrypto = globalThis.crypto;
    if (typeof secureCrypto?.randomUUID === 'function') {
      const nonce = secureCrypto.randomUUID();
      if (isValidImportNonce(nonce)) return nonce;
    }
    if (typeof secureCrypto?.getRandomValues === 'function') {
      const bytes = secureCrypto.getRandomValues(new Uint8Array(24));
      let binary = '';
      bytes.forEach(byte => { binary += String.fromCharCode(byte); });
      const nonce = btoa(binary)
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/g, '');
      if (isValidImportNonce(nonce)) return nonce;
    }
    throw new Error('Secure import nonce generation is unavailable.');
  };

  const normalizeSilentImportIntent = value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const candidate = value;
    const text = normalizeSelectedText(candidate.text);
    if (candidate.v !== IMPORT_PROTOCOL_VERSION || candidate.mode !== 'silent') return null;
    if (!isValidIntentId(candidate.id) || !text || text.length > MAX_TEXT_LENGTH) return null;
    if (!isValidImportNonce(candidate.nonce)) return null;
    if (!Number.isSafeInteger(candidate.createdAt) || candidate.createdAt <= 0) return null;
    return {
      v: IMPORT_PROTOCOL_VERSION,
      id: candidate.id,
      nonce: candidate.nonce,
      text,
      createdAt: candidate.createdAt,
      mode: 'silent',
    };
  };

  const normalizeBuildOptions = value => {
    if (typeof value === 'number') return { createdAt: value };
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return value;
  };

  const buildImportUrl = (appUrl, selectedText, optionsOrCreatedAt = {}) => {
    const selection = selectionValidation(selectedText);
    if (!selection.ok) throw new Error(selection.error);
    const validatedUrl = validateAppUrl(appUrl);
    if (!validatedUrl.ok) throw new Error(validatedUrl.error);

    const options = normalizeBuildOptions(optionsOrCreatedAt);
    const id = options.id === undefined ? createIntentId() : options.id;
    if (!isValidIntentId(id)) throw new Error('Operation ID is invalid.');
    if (options.mode !== undefined && options.mode !== 'silent') {
      throw new Error('Import mode is invalid.');
    }
    const createdAt = options.createdAt === undefined ? Date.now() : options.createdAt;
    if (!Number.isSafeInteger(createdAt) || createdAt <= 0) {
      throw new Error('Import timestamp is invalid.');
    }
    if (options.mode === 'silent' && !isValidImportNonce(options.nonce)) {
      throw new Error('Import nonce is invalid.');
    }

    const url = new URL(validatedUrl.url);
    const payload = {
      v: IMPORT_PROTOCOL_VERSION,
      id,
      text: selection.text,
      createdAt,
      ...(options.mode === 'silent' ? { mode: 'silent', nonce: options.nonce } : {}),
    };
    const hash = new URLSearchParams();
    hash.set(IMPORT_HASH_KEY, encodeBase64UrlUtf8(JSON.stringify(payload)));
    url.hash = hash.toString();
    return url.toString();
  };

  const decodeImportIntentFromUrl = value => {
    const url = new URL(value);
    const hash = new URLSearchParams(url.hash.slice(1));
    const encoded = hash.get(IMPORT_HASH_KEY);
    if (!encoded) return null;
    return JSON.parse(decodeBase64UrlUtf8(encoded));
  };

  const apiCall = (namespace, methodName, ...args) => {
    if (!namespace || typeof namespace[methodName] !== 'function') {
      return Promise.reject(new Error(`Extension API ${methodName} is unavailable.`));
    }

    if (promiseExtensionApi) {
      try {
        return Promise.resolve(namespace[methodName](...args));
      } catch (error) {
        return Promise.reject(error instanceof Error ? error : new Error(String(error)));
      }
    }

    return new Promise((resolve, reject) => {
      let settled = false;
      const settle = (callback, value) => {
        if (settled) return;
        settled = true;
        callback(value);
      };
      const callback = result => {
        const error = extensionApi?.runtime?.lastError;
        if (error) settle(reject, new Error(error.message || String(error)));
        else settle(resolve, result);
      };
      try {
        const returned = namespace[methodName](...args, callback);
        if (returned && typeof returned.then === 'function') {
          returned.then(
            result => settle(resolve, result),
            error => settle(reject, error instanceof Error ? error : new Error(String(error))),
          );
        }
      } catch (error) {
        settle(reject, error instanceof Error ? error : new Error(String(error)));
      }
    });
  };

  const readSettings = async () => {
    if (!settingsStorage) return { ...DEFAULT_SETTINGS };
    try {
      const stored = await apiCall(settingsStorage, 'get', SETTINGS_STORAGE_KEY);
      return normalizeSettings(stored?.[SETTINGS_STORAGE_KEY]);
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  };

  const persistSettings = async settings => {
    if (settingsStorage) await apiCall(settingsStorage, 'set', { [SETTINGS_STORAGE_KEY]: settings });
    return settings;
  };

  const writeSettings = value => withSettingsMutationLock(async () => {
    const settings = normalizeSettings(value);
    return persistSettings(settings);
  });

  const writeUserSettings = value => withSettingsMutationLock(async () => {
    const current = await readSettings();
    const settings = normalizeSettings({
      ...current,
      ...(value && typeof value === 'object' ? value : {}),
      // The allowlist is owned by the background permission flow. Options must
      // never replace it with a snapshot from when the page was opened.
      selectionIconSites: current.selectionIconSites,
    });
    return persistSettings(settings);
  });

  const updateSelectionIconSites = updater => withSettingsMutationLock(async () => {
    const current = await readSettings();
    const previousSites = [...current.selectionIconSites];
    const proposed = typeof updater === 'function' ? updater(previousSites) : previousSites;
    const settings = normalizeSettings({
      ...current,
      selectionIconSites: proposed,
    });
    await persistSettings(settings);
    return { settings, previousSites };
  });

  const normalizeRecentLookup = value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const text = normalizeSelectedText(value.text);
    const translation = boundedRecentText(value.translation, 256);
    const sourceCandidate = typeof value.sourceLanguage === 'string' ? value.sourceLanguage.trim().toLowerCase() : '';
    const sourceLanguage = sourceCandidate === 'auto'
      ? 'auto'
      : /^[a-z]{2,3}(?:-[a-z]{2,4})?$/.test(sourceCandidate) ? sourceCandidate : 'auto';
    const targetLanguage = value.targetLanguage === 'vi' ? 'vi' : '';
    const kind = value.kind === 'create' ? 'create' : value.kind === 'translate' ? 'translate' : '';
    const status = ['translated', 'created', 'existing'].includes(value.status) ? value.status : '';
    if (!text || text.length > MAX_TEXT_LENGTH || !translation || !targetLanguage || !kind || !status) return null;
    if (!Number.isSafeInteger(value.timestamp) || value.timestamp <= 0) return null;
    return { text, translation, sourceLanguage, targetLanguage, kind, status, timestamp: value.timestamp };
  };

  const boundedRecentText = (value, maxLength) => typeof value === 'string'
    ? value.replace(/\s+/g, ' ').trim().slice(0, maxLength)
    : '';

  const normalizeDeckScope = value => typeof value === 'string'
    && /^[A-Za-z0-9_-]{8,128}$/.test(value.trim())
    ? value.trim().slice(0, MAX_DECK_SCOPE_LENGTH)
    : '';

  const normalizeDeckCollection = value => {
    if (!Array.isArray(value)) return [];
    const seen = new Set();
    for (const entry of value) {
      const name = typeof entry === 'string' ? entry.replace(/\s+/g, ' ').trim().slice(0, MAX_DECK_NAME_LENGTH) : '';
      if (!name || seen.has(name)) continue;
      seen.add(name);
      if (seen.size >= MAX_DECKS) break;
    }
    return [...seen];
  };

  const normalizeDeckMetadata = value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const scope = normalizeDeckScope(value.scope);
    if (!scope || !Array.isArray(value.decks)) return null;
    return { scope, decks: normalizeDeckCollection(value.decks) };
  };

  const normalizeRetiredDeckScopes = value => {
    if (!Array.isArray(value)) return [];
    const seen = new Set();
    for (const entry of value) {
      const scope = normalizeDeckScope(entry);
      if (!scope || seen.has(scope)) continue;
      seen.add(scope);
      if (seen.size >= 16) break;
    }
    return [...seen];
  };

  const normalizeDueCount = value => Number.isSafeInteger(value) && value >= 0
    ? Math.min(value, MAX_DUE_COUNT)
    : null;

  const normalizeDueCountMetadata = value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const scope = normalizeDeckScope(value.scope);
    const count = normalizeDueCount(value.count);
    if (!scope || count === null) return null;
    return { scope, count };
  };

  // Reuses the deck-metadata retirement pattern so a due count synced under a
  // previous scope can never resurface after reconnect/account switch.
  const normalizeRetiredDueCountScopes = normalizeRetiredDeckScopes;

  const normalizeCourseTargetLanguage = value => COURSE_TARGET_LANGUAGES.includes(value) ? value : '';
  const normalizeCourseNativeLanguage = value => COURSE_NATIVE_LANGUAGES.includes(value) ? value : '';

  const normalizeCourseLocaleMetadata = value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const scope = normalizeDeckScope(value.scope);
    const nativeLanguage = normalizeCourseNativeLanguage(value.nativeLanguage);
    const targetLanguage = normalizeCourseTargetLanguage(value.targetLanguage);
    if (!scope || !nativeLanguage || !targetLanguage) return null;
    return { scope, nativeLanguage, targetLanguage };
  };

  // Reuses the deck-metadata retirement pattern so a course locale synced
  // under a previous scope can never resurface after reconnect/account switch.
  const normalizeRetiredCourseLocaleScopes = normalizeRetiredDeckScopes;

  // Applies data-i18n* attributes to a static document. Every localizable
  // element ships its default_locale (vi) copy directly in the markup so the
  // page is correct even before this runs; this only upgrades it when the
  // browser's i18n runtime resolves a different UI language (en).
  // Only writes back when the resolved text actually differs from the
  // shipped default_locale copy already in the DOM. This keeps rich markup
  // (e.g. <strong> emphasis) intact for the vi default and for any test/dev
  // context without a real i18n runtime, while still fully replacing text
  // (flattening inline markup, an accepted trade-off) when the browser's UI
  // language resolves a different message.
  const localizeIfChanged = (current, resolved, apply) => { if (resolved !== current) apply(resolved); };
  const localizeElement = element => {
    const dataset = element?.dataset;
    if (!dataset) return;
    if (dataset.i18n) {
      const current = element.textContent;
      localizeIfChanged(current, t(dataset.i18n, undefined, current), value => { element.textContent = value; });
    }
    if (dataset.i18nAriaLabel) {
      const current = element.getAttribute('aria-label') || '';
      localizeIfChanged(current, t(dataset.i18nAriaLabel, undefined, current), value => element.setAttribute('aria-label', value));
    }
    if (dataset.i18nPlaceholder && 'placeholder' in element) {
      const current = element.placeholder || '';
      localizeIfChanged(current, t(dataset.i18nPlaceholder, undefined, current), value => { element.placeholder = value; });
    }
    if (dataset.i18nTitle) {
      const current = element.title || '';
      localizeIfChanged(current, t(dataset.i18nTitle, undefined, current), value => { element.title = value; });
    }
  };
  // Applies the saved colorScheme (system/dark/light) as a data-scheme
  // attribute design-tokens.css reads. "system" removes any override so the
  // prefers-color-scheme media query in design-tokens.css decides.
  const applyColorScheme = scheme => {
    const root = globalThis.document?.documentElement;
    if (!root?.setAttribute) return;
    if (scheme === 'dark' || scheme === 'light') root.setAttribute('data-scheme', scheme);
    else root.removeAttribute('data-scheme');
  };

  // Sets documentElement[data-theme-family] so design-tokens.css can scope its
  // Crystal Star variable block independently of the light/dark data-scheme
  // attribute above. Always writes a bounded value, defaulting to classic for
  // anything outside THEME_FAMILIES.
  const applyThemeFamily = family => {
    const root = globalThis.document?.documentElement;
    if (!root?.setAttribute) return;
    root.setAttribute('data-theme-family', THEME_FAMILIES.includes(family) ? family : 'classic');
  };

  const localizeDocument = (root = globalThis.document) => {
    if (typeof root?.querySelectorAll !== 'function') return;
    root.querySelectorAll('[data-i18n],[data-i18n-aria-label],[data-i18n-placeholder],[data-i18n-title]').forEach(localizeElement);
  };

  const i18nApi = () => (globalThis.browser ?? globalThis.chrome)?.i18n ?? null;

  // Set only by `applyCourseUiLocale` below, once a fetched `_locales/{locale}
  // /messages.json` catalog is ready. `t()` prefers this catalog over the
  // browser's own UI locale so the popup/options UI can follow the active
  // course's native language (07.5) without needing a page reload.
  let localeOverrideCatalog = null;

  // Chrome's own `chrome.i18n.getMessage` resolves `$NAME$` placeholders
  // against a message's declared `placeholders` map itself; this reimplements
  // that same substitution so a manually fetched catalog behaves identically.
  const applyMessageCatalogSubstitutions = (template, placeholders, substitutions) => {
    if (!placeholders || typeof placeholders !== 'object') return template;
    const args = substitutions === undefined || substitutions === null
      ? []
      : Array.isArray(substitutions) ? substitutions : [substitutions];
    let result = template;
    for (const [name, definition] of Object.entries(placeholders)) {
      const content = String(definition?.content ?? '');
      const positional = content.match(/^\$(\d)$/);
      const resolved = positional ? String(args[Number(positional[1]) - 1] ?? '') : content;
      result = result.replaceAll(new RegExp(`\\$${name}\\$`, 'gi'), resolved);
    }
    return result;
  };

  // Fetches this extension's own bundled `_locales/{locale}/messages.json`.
  // Always a request for a file the extension ships itself, never a network
  // call to a third party. Returns null on any failure so the caller safely
  // keeps today's Chrome-i18n-resolved locale.
  const loadLocaleMessageCatalog = async locale => {
    try {
      const url = extensionApi?.runtime?.getURL?.(`_locales/${locale}/messages.json`);
      if (!url || typeof fetch !== 'function') return null;
      const response = await fetch(url);
      if (!response?.ok) return null;
      const data = await response.json();
      return data && typeof data === 'object' && !Array.isArray(data) ? data : null;
    } catch {
      return null;
    }
  };

  // Overrides t()'s message source with the active course's native language,
  // when the app has told the extension about a signed-in owner's active
  // course (07.5, GET_COURSE_LOCALE). Returns false — no catalog fetched, no
  // override applied, today's Chrome-i18n behavior kept exactly as-is —
  // whenever there is no confirmed course locale, or it already matches the
  // browser's own resolved UI language.
  const applyCourseUiLocale = async () => {
    try {
      const response = await apiCall(extensionApi.runtime, 'sendMessage', { type: 'GET_COURSE_LOCALE' });
      const nativeLanguage = response?.ok ? normalizeCourseNativeLanguage(response.nativeLanguage) : '';
      if (!nativeLanguage) return false;
      const uiLanguage = String(i18nApi()?.getUILanguage?.() || '').toLowerCase().split('-')[0];
      if (uiLanguage === nativeLanguage) return false;
      const catalog = await loadLocaleMessageCatalog(nativeLanguage);
      if (!catalog) return false;
      localeOverrideCatalog = catalog;
      return true;
    } catch {
      return false;
    }
  };

  // Chrome/Firefox resolve getMessage() against the browser's own UI locale
  // automatically; outside a real extension runtime (unit tests, Node) this
  // safely degrades to the caller-supplied fallback so behavior never regresses.
  const t = (name, substitutions, fallback = '') => {
    if (localeOverrideCatalog) {
      const entry = localeOverrideCatalog[name];
      if (entry && typeof entry.message === 'string' && entry.message) {
        return applyMessageCatalogSubstitutions(entry.message, entry.placeholders, substitutions);
      }
    }
    try {
      const resolved = i18nApi()?.getMessage(name, substitutions);
      return typeof resolved === 'string' && resolved ? resolved : fallback;
    } catch {
      return fallback;
    }
  };

  const recentLookupKey = value => `${value.text.toLocaleLowerCase()}::${value.sourceLanguage}->${value.targetLanguage}`;

  const readRecentLookupsUnlocked = async () => {
    const settings = await readSettings();
    if (!transientStorage) return [];
    try {
      const stored = await apiCall(transientStorage, 'get', RECENT_LOOKUPS_STORAGE_KEY);
      const now = Date.now();
      const values = Array.isArray(stored?.[RECENT_LOOKUPS_STORAGE_KEY])
        ? stored[RECENT_LOOKUPS_STORAGE_KEY].map(normalizeRecentLookup).filter(Boolean)
        : [];
      const fresh = values
        .filter(item => usesSessionStorage || now - item.timestamp < RECENT_LOOKUP_TTL_MS)
        .sort((left, right) => right.timestamp - left.timestamp)
        .slice(0, MAX_RECENT_LOOKUPS);
      if (fresh.length !== values.length && !usesSessionStorage) {
        await apiCall(transientStorage, 'set', { [RECENT_LOOKUPS_STORAGE_KEY]: fresh });
      }
      return settings.recentLookupsEnabled ? fresh : [];
    } catch {
      return [];
    }
  };

  const readRecentLookups = () => withRecentLookupMutationLock(readRecentLookupsUnlocked);

  const recordRecentLookup = value => withRecentLookupMutationLock(async () => {
    const normalized = normalizeRecentLookup(value);
    if (!normalized || !transientStorage) return [];
    const settings = await readSettings();
    if (!settings.recentLookupsEnabled) {
      await readRecentLookupsUnlocked();
      return [];
    }
    const current = await readRecentLookupsUnlocked();
    const next = [normalized, ...current.filter(item => recentLookupKey(item) !== recentLookupKey(normalized))]
      .slice(0, MAX_RECENT_LOOKUPS);
    try {
      await apiCall(transientStorage, 'set', { [RECENT_LOOKUPS_STORAGE_KEY]: next });
    } catch {
      return current;
    }
    return next;
  });

  const clearRecentLookups = () => withRecentLookupMutationLock(async () => {
    if (transientStorage) {
      try { await apiCall(transientStorage, 'remove', RECENT_LOOKUPS_STORAGE_KEY); } catch {}
    }
    return [];
  });

  globalThis.LingoFlashExtension = Object.freeze({
    DEFAULT_APP_URL,
    APP_ORIGIN,
    IMPORT_HASH_KEY,
    IMPORT_PROTOCOL_VERSION,
    IMPORT_PROTOCOL_V3,
    MAX_ENCODED_IMPORT_LENGTH,
    MAX_TEXT_LENGTH,
    MAX_CONTEXT_LENGTH,
    MAX_SOURCE_URL_LENGTH,
    MAX_PAGE_TITLE_LENGTH,
    SETTINGS_STORAGE_KEY,
    DECK_METADATA_STORAGE_KEY,
    DECK_METADATA_RETIRED_SCOPES_STORAGE_KEY,
    DUE_COUNT_STORAGE_KEY,
    DUE_COUNT_RETIRED_SCOPES_STORAGE_KEY,
    MAX_DUE_COUNT,
    COURSE_LOCALE_STORAGE_KEY,
    COURSE_LOCALE_RETIRED_SCOPES_STORAGE_KEY,
    COURSE_TARGET_LANGUAGES,
    COURSE_NATIVE_LANGUAGES,
    MAX_DECKS,
    MAX_DECK_NAME_LENGTH,
    MAX_DECK_SCOPE_LENGTH,
    MAX_SELECTION_ICON_SITES,
    RECENT_LOOKUPS_STORAGE_KEY,
    MAX_RECENT_LOOKUPS,
    RECENT_LOOKUP_TTL_MS,
    THEME_FAMILIES,
    COLOR_SCHEMES,
    DEFAULT_SETTINGS,
    extensionApi,
    transientStorage,
    settingsStorage,
    usesSessionStorage,
    usesPromiseApi,
    deckMetadataStorage,
    normalizeSelectedText,
    normalizeContext,
    boundedPageTitle,
    sanitizeSourceUrl,
    selectionValidation,
    normalizeSettings,
    normalizeSelectionIconSites,
    selectionIconSitePatternFromUrl,
    isProtectedSelectionIconUrl,
    readSettings,
    writeSettings,
    writeUserSettings,
    updateSelectionIconSites,
    normalizeRecentLookup,
    normalizeDeckScope,
    normalizeDeckCollection,
    normalizeDeckMetadata,
    normalizeRetiredDeckScopes,
    normalizeDueCount,
    normalizeDueCountMetadata,
    normalizeRetiredDueCountScopes,
    normalizeCourseTargetLanguage,
    normalizeCourseNativeLanguage,
    normalizeCourseLocaleMetadata,
    normalizeRetiredCourseLocaleScopes,
    t,
    localizeDocument,
    applyColorScheme,
    applyThemeFamily,
    applyCourseUiLocale,
    readRecentLookups,
    recordRecentLookup,
    clearRecentLookups,
    validateAppUrl,
    createIntentId,
    createImportNonce,
    isValidImportNonce,
    normalizeSilentImportIntent,
    buildImportUrl,
    decodeImportIntentFromUrl,
    apiCall,
  });
})();
