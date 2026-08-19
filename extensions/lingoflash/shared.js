(() => {
  'use strict';

  const DEFAULT_APP_URL = 'https://encoded-hangout-433912-h2.web.app/?view=library';
  const APP_ORIGIN = new URL(DEFAULT_APP_URL).origin;
  const APP_URL_STORAGE_KEY = 'lingoflashAppUrl';
  const IMPORT_HASH_KEY = 'lf-import';
  const MAX_TEXT_LENGTH = 80;

  const promiseExtensionApi = globalThis.browser ?? null;
  const extensionApi = promiseExtensionApi ?? globalThis.chrome;
  const settingsStorage = extensionApi?.storage?.sync ?? extensionApi?.storage?.local ?? null;
  const transientStorage = extensionApi?.storage?.session ?? extensionApi?.storage?.local ?? null;

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
      v: 1,
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

  const readConfiguredAppUrl = async () => {
    try {
      const values = await apiCall(settingsStorage, 'get', {
        [APP_URL_STORAGE_KEY]: DEFAULT_APP_URL,
      });
      const validated = validateAppUrl(values?.[APP_URL_STORAGE_KEY]);
      return validated.ok ? validated.url : DEFAULT_APP_URL;
    } catch {
      return DEFAULT_APP_URL;
    }
  };

  globalThis.LingoFlashExtension = Object.freeze({
    DEFAULT_APP_URL,
    APP_ORIGIN,
    APP_URL_STORAGE_KEY,
    IMPORT_HASH_KEY,
    MAX_TEXT_LENGTH,
    extensionApi,
    settingsStorage,
    transientStorage,
    usesPromiseApi: Boolean(promiseExtensionApi),
    normalizeSelectedText,
    selectionValidation,
    validateAppUrl,
    createIntentId,
    buildImportUrl,
    decodeImportIntentFromUrl,
    apiCall,
    readConfiguredAppUrl,
  });
})();
