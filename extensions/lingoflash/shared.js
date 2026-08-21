(() => {
  'use strict';

  const DEFAULT_APP_URL = 'https://encoded-hangout-433912-h2.web.app/?view=library';
  const APP_ORIGIN = new URL(DEFAULT_APP_URL).origin;
  const IMPORT_HASH_KEY = 'lf-import';
  const MAX_TEXT_LENGTH = 80;
  const IMPORT_PROTOCOL_VERSION = 2;
  const IMPORT_PROTOCOL_V3 = 3;
  const SETTINGS_STORAGE_KEY = 'lingoflash_extension_settings';
  const RECENT_LOOKUPS_STORAGE_KEY = 'lingoflash_recent_lookups';
  const MAX_RECENT_LOOKUPS = 10;
  const RECENT_LOOKUP_TTL_MS = 7 * 24 * 60 * 60 * 1000;
  const DEFAULT_SETTINGS = Object.freeze({
    autoSpeak: false,
    bubbleDurationMs: 12_000,
    recentLookupsEnabled: true,
    quickTranslateSource: 'auto',
    quickTranslateTarget: 'vi',
  });

  const promiseExtensionApi = globalThis.browser ?? null;
  const extensionApi = promiseExtensionApi ?? globalThis.chrome;
  const transientStorage = extensionApi?.storage?.session ?? extensionApi?.storage?.local ?? null;
  const settingsStorage = extensionApi?.storage?.sync ?? extensionApi?.storage?.local ?? null;
  const usesSessionStorage = Boolean(extensionApi?.storage?.session);

  const normalizeSelectedText = value => String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();

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
    };
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

  const normalizeImportTicket = value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    if (value.v !== IMPORT_PROTOCOL_V3 || value.mode !== 'silent' || !isValidIntentId(value.ticket)) return null;
    return { v: IMPORT_PROTOCOL_V3, ticket: value.ticket, mode: 'silent' };
  };

  const normalizeSilentImportIntent = value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const candidate = value;
    const text = normalizeSelectedText(candidate.text);
    if (candidate.v !== IMPORT_PROTOCOL_VERSION || candidate.mode !== 'silent') return null;
    if (!isValidIntentId(candidate.id) || !text || text.length > MAX_TEXT_LENGTH) return null;
    if (!Number.isSafeInteger(candidate.createdAt) || candidate.createdAt <= 0) return null;
    return {
      v: IMPORT_PROTOCOL_VERSION,
      id: candidate.id,
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

    const url = new URL(validatedUrl.url);
    const payload = {
      v: IMPORT_PROTOCOL_VERSION,
      id,
      text: selection.text,
      createdAt,
      ...(options.mode === 'silent' ? { mode: 'silent' } : {}),
    };
    const hash = new URLSearchParams();
    hash.set(IMPORT_HASH_KEY, encodeBase64UrlUtf8(JSON.stringify(payload)));
    url.hash = hash.toString();
    return url.toString();
  };

  const buildImportTicketUrl = (appUrl, ticket) => {
    const validatedUrl = validateAppUrl(appUrl);
    if (!validatedUrl.ok) throw new Error(validatedUrl.error);
    if (!isValidIntentId(ticket)) throw new Error('Import ticket is invalid.');
    const url = new URL(validatedUrl.url);
    const hash = new URLSearchParams();
    hash.set(IMPORT_HASH_KEY, encodeBase64UrlUtf8(JSON.stringify({
      v: IMPORT_PROTOCOL_V3,
      ticket,
      mode: 'silent',
    })));
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

  const writeSettings = async value => {
    const settings = normalizeSettings(value);
    if (settingsStorage) await apiCall(settingsStorage, 'set', { [SETTINGS_STORAGE_KEY]: settings });
    return settings;
  };

  const normalizeRecentLookup = value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const text = normalizeSelectedText(value.text);
    const translation = boundedRecentText(value.translation, 256);
    const sourceLanguage = value.sourceLanguage === 'en' ? 'en' : 'auto';
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

  const recentLookupKey = value => `${value.text.toLocaleLowerCase()}::${value.sourceLanguage}->${value.targetLanguage}`;

  const readRecentLookups = async () => {
    const settings = await readSettings();
    if (!settings.recentLookupsEnabled || !transientStorage) return [];
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
      return fresh;
    } catch {
      return [];
    }
  };

  const recordRecentLookup = async value => {
    const normalized = normalizeRecentLookup(value);
    if (!normalized || !transientStorage) return [];
    const settings = await readSettings();
    if (!settings.recentLookupsEnabled) return [];
    const current = await readRecentLookups();
    const next = [normalized, ...current.filter(item => recentLookupKey(item) !== recentLookupKey(normalized))]
      .slice(0, MAX_RECENT_LOOKUPS);
    try {
      await apiCall(transientStorage, 'set', { [RECENT_LOOKUPS_STORAGE_KEY]: next });
    } catch {
      return current;
    }
    return next;
  };

  const clearRecentLookups = async () => {
    if (transientStorage) {
      try { await apiCall(transientStorage, 'remove', RECENT_LOOKUPS_STORAGE_KEY); } catch {}
    }
    return [];
  };

  globalThis.LingoFlashExtension = Object.freeze({
    DEFAULT_APP_URL,
    APP_ORIGIN,
    IMPORT_HASH_KEY,
    IMPORT_PROTOCOL_VERSION,
    IMPORT_PROTOCOL_V3,
    MAX_TEXT_LENGTH,
    SETTINGS_STORAGE_KEY,
    RECENT_LOOKUPS_STORAGE_KEY,
    MAX_RECENT_LOOKUPS,
    RECENT_LOOKUP_TTL_MS,
    DEFAULT_SETTINGS,
    extensionApi,
    transientStorage,
    settingsStorage,
    usesSessionStorage,
    usesPromiseApi: Boolean(promiseExtensionApi),
    normalizeSelectedText,
    selectionValidation,
    normalizeSettings,
    readSettings,
    writeSettings,
    normalizeRecentLookup,
    readRecentLookups,
    recordRecentLookup,
    clearRecentLookups,
    validateAppUrl,
    createIntentId,
    normalizeSilentImportIntent,
    normalizeImportTicket,
    buildImportUrl,
    buildImportTicketUrl,
    decodeImportIntentFromUrl,
    apiCall,
  });
})();
