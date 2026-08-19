(() => {
  'use strict';

  const DEFAULT_APP_URL = 'https://encoded-hangout-433912-h2.web.app/?view=library';
  const APP_URL_STORAGE_KEY = 'lingoflashAppUrl';
  const IMPORT_HASH_KEY = 'lf-import';
  const MAX_TEXT_LENGTH = 80;

  const promiseExtensionApi = globalThis.browser ?? null;
  const extensionApi = promiseExtensionApi ?? globalThis.chrome;
  const settingsStorage = extensionApi?.storage?.sync ?? extensionApi?.storage?.local ?? null;

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

  const isLocalHostname = hostname => hostname === 'localhost'
    || hostname === '127.0.0.1'
    || hostname === '[::1]';

  const validateAppUrl = value => {
    try {
      const url = new URL(String(value ?? '').trim());
      const isSecure = url.protocol === 'https:';
      const isLocalDevelopment = url.protocol === 'http:' && isLocalHostname(url.hostname);
      if (!isSecure && !isLocalDevelopment) {
        return { ok: false, error: 'URL ứng dụng phải dùng HTTPS (HTTP chỉ được phép với localhost).' };
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

  const createImportIntent = (text, createdAt = Date.now()) => ({
    v: 1,
    id: createIntentId(),
    text,
    createdAt,
  });

  const buildImportUrl = (appUrl, selectedText, createdAt = Date.now()) => {
    const selection = selectionValidation(selectedText);
    if (!selection.ok) throw new Error(selection.error);
    const validatedUrl = validateAppUrl(appUrl);
    if (!validatedUrl.ok) throw new Error(validatedUrl.error);
    const url = new URL(validatedUrl.url);
    const payload = encodeBase64UrlUtf8(JSON.stringify(createImportIntent(selection.text, createdAt)));
    const hash = new URLSearchParams();
    hash.set(IMPORT_HASH_KEY, payload);
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
    APP_URL_STORAGE_KEY,
    IMPORT_HASH_KEY,
    MAX_TEXT_LENGTH,
    extensionApi,
    settingsStorage,
    usesPromiseApi: Boolean(promiseExtensionApi),
    normalizeSelectedText,
    selectionValidation,
    validateAppUrl,
    buildImportUrl,
    decodeImportIntentFromUrl,
    apiCall,
    readConfiguredAppUrl,
  });
})();
