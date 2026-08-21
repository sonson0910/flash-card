'use strict';

(() => {
  const extensionApi = globalThis.browser ?? globalThis.chrome;
  const usesPromiseApi = Boolean(globalThis.browser);
  const APP_SOURCE = 'lingoflash-web-app';
  const BRIDGE_SOURCE = 'lingoflash-extension-bridge';
  const APP_RESULT_TYPE = 'LINGOFLASH_EXTENSION_RESULT';
  const IMPORT_READY_TYPE = 'LINGOFLASH_EXTENSION_IMPORT_READY';
  const IMPORT_UNVERIFIED_TYPE = 'LINGOFLASH_EXTENSION_IMPORT_UNVERIFIED';
  const IMPORT_CLAIMED_TYPE = 'LINGOFLASH_EXTENSION_IMPORT_CLAIMED';
  const VERIFY_IMPORT_TYPE = 'VERIFY_IMPORT_INTENT';
  const IMPORT_HASH_KEY = 'lf-import';
  const IMPORT_STORAGE_KEY = 'lingoflash_browser_extension_import';
  const UNVERIFIED_STORAGE_KEY = 'lingoflash_browser_extension_draft_import';
  const IMPORT_PROTOCOL_VERSION = 2;
  const IMPORT_PROTOCOL_V3 = 3;
  const MAX_TEXT_LENGTH = 80;
  const FALLBACK_GRACE_MS = 1_500;
  const FALLBACK_FORM_TIMEOUT_MS = 8_000;
  const FALLBACK_GENERATION_TIMEOUT_MS = 38_000;
  const POLL_INTERVAL_MS = 120;
  const WORD_INPUT_SELECTOR = '[data-extension-target="word-input"]';
  const LEGACY_WORD_INPUT_SELECTOR = '#new-word';
  const CARD_FORM_SELECTOR = '[data-extension-target="card-create-form"]';
  const SUBMIT_BUTTON_SELECTOR = '[data-extension-target="word-submit"]';
  const LEGACY_SUBMIT_BUTTON_SELECTOR = 'button[type="submit"]';

  let appBridgeResponded = false;
  let fallbackStarted = false;
  let initialRoute = null;

  const sendRuntimeMessage = message => {
    if (!extensionApi?.runtime?.sendMessage) return Promise.reject(new Error('Extension runtime is unavailable.'));
    if (usesPromiseApi) {
      try { return Promise.resolve(extensionApi.runtime.sendMessage(message)); }
      catch (error) { return Promise.reject(error instanceof Error ? error : new Error(String(error))); }
    }
    return new Promise((resolve, reject) => {
      let settled = false;
      const settle = (callback, value) => {
        if (settled) return;
        settled = true;
        callback(value);
      };
      const callback = response => {
        const error = extensionApi.runtime.lastError;
        if (error) settle(reject, new Error(error.message || String(error)));
        else settle(resolve, response);
      };
      try {
        const returned = extensionApi.runtime.sendMessage(message, callback);
        if (returned && typeof returned.then === 'function') {
          returned.then(
            response => settle(resolve, response),
            error => settle(reject, error instanceof Error ? error : new Error(String(error))),
          );
        }
      } catch (error) {
        settle(reject, error instanceof Error ? error : new Error(String(error)));
      }
    });
  };

  const sendResult = payload => {
    void sendRuntimeMessage({
      type: 'APP_IMPORT_RESULT',
      bridgeType: APP_RESULT_TYPE,
      payload,
    }).catch(() => undefined);
  };

  const decodeBase64UrlUtf8 = encoded => {
    try {
      if (!/^[A-Za-z0-9_-]+$/.test(encoded)) return '';
      const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
      const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
      const binary = atob(padded);
      const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
      return new TextDecoder().decode(bytes);
    } catch {
      return '';
    }
  };

  const normalizeText = value => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';

  const normalizeSilentIntent = value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const text = normalizeText(value.text);
    if (
      value.v !== IMPORT_PROTOCOL_VERSION
      || value.mode !== 'silent'
      || typeof value.id !== 'string'
      || !/^[A-Za-z0-9_-]{8,128}$/.test(value.id)
      || !text
      || text.length > MAX_TEXT_LENGTH
      || !Number.isSafeInteger(value.createdAt)
      || value.createdAt <= 0
    ) return null;
    return { v: IMPORT_PROTOCOL_VERSION, id: value.id, text, createdAt: value.createdAt, mode: 'silent' };
  };

  const normalizeImportTicket = value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    if (value.v !== IMPORT_PROTOCOL_V3 || value.mode !== 'silent' || typeof value.ticket !== 'string'
      || !/^[A-Za-z0-9_-]{8,128}$/.test(value.ticket)) return null;
    return { v: IMPORT_PROTOCOL_V3, ticket: value.ticket, mode: 'silent' };
  };

  const normalizeImportCandidate = value => normalizeSilentIntent(value) ?? normalizeImportTicket(value);

  const normalizeVerifiedIntent = value => {
    const v2 = normalizeSilentIntent(value);
    if (v2) return v2;
    const ticket = normalizeImportTicket(value);
    const text = normalizeText(value?.text);
    if (!ticket || typeof value.id !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(value.id)
      || !text || text.length > MAX_TEXT_LENGTH || !Number.isSafeInteger(value.createdAt) || value.createdAt <= 0) return null;
    return { v: IMPORT_PROTOCOL_V3, id: value.id, text, createdAt: value.createdAt, mode: 'silent', ticket: ticket.ticket };
  };

  const hasImportHash = () => {
    try {
      return new URLSearchParams(globalThis.location.hash.slice(1)).has(IMPORT_HASH_KEY);
    } catch {
      return false;
    }
  };

  const isSameRoute = () => {
    if (!initialRoute) return true;
    try {
      const current = new URL(globalThis.location.href);
      return current.pathname === initialRoute.pathname && current.search === initialRoute.search;
    } catch {
      return false;
    }
  };

  const captureSilentIntent = () => {
    try {
      const hash = new URLSearchParams(globalThis.location.hash.slice(1));
      const encoded = hash.get(IMPORT_HASH_KEY);
      if (!encoded) return null;
      return normalizeImportCandidate(JSON.parse(decodeBase64UrlUtf8(encoded)));
    } catch {
      return null;
    }
  };

  const removeImportHash = () => {
    try {
      const url = new URL(globalThis.location.href);
      const parameters = new URLSearchParams(url.hash.slice(1));
      parameters.delete(IMPORT_HASH_KEY);
      const remainingHash = parameters.toString();
      const cleanLocation = `${url.pathname}${url.search}${remainingHash ? `#${remainingHash}` : ''}`;
      globalThis.history?.replaceState(globalThis.history.state, '', cleanLocation);
    } catch {
      // A malformed location is not an import intent and must not reach the app.
    }
  };

  const writeVerifiedIntent = intent => {
    try {
      globalThis.sessionStorage?.setItem(IMPORT_STORAGE_KEY, JSON.stringify(intent));
      globalThis.sessionStorage?.removeItem(UNVERIFIED_STORAGE_KEY);
    } catch {
      // The postMessage path below still works when storage is unavailable.
    }
  };

  const notifyApp = (type, payload) => {
    try { globalThis.postMessage?.({ source: BRIDGE_SOURCE, type, payload }, globalThis.location.origin); }
    catch { /* The app may have navigated away. */ }
  };

  const notifyUnverifiedIntent = intent => {
    try { globalThis.sessionStorage?.setItem(UNVERIFIED_STORAGE_KEY, JSON.stringify(intent)); } catch { /* Draft delivery can still use postMessage. */ }
    notifyApp(IMPORT_UNVERIFIED_TYPE, intent);
  };

  const verifyAndDispatch = async candidate => {
    let response;
    try { response = await sendRuntimeMessage({ type: VERIFY_IMPORT_TYPE, payload: candidate }); }
    catch {
      notifyUnverifiedIntent(candidate);
      return;
    }
    if (!response?.ok || response.verified !== true) {
      notifyUnverifiedIntent(candidate);
      return;
    }
    const intent = normalizeVerifiedIntent(response.intent ?? candidate);
    const matchesCandidate = intent
      && intent.v === candidate.v
      && (candidate.v === IMPORT_PROTOCOL_V3
        ? intent.ticket === candidate.ticket
        : intent.id === candidate.id && intent.text === candidate.text && intent.createdAt === candidate.createdAt);
    if (!matchesCandidate) {
      notifyUnverifiedIntent(candidate);
      return;
    }
    writeVerifiedIntent(intent);
    notifyApp(IMPORT_READY_TYPE, intent);
    scheduleFallback(intent);
  };

  const sleep = milliseconds => new Promise(resolve => globalThis.setTimeout(resolve, milliseconds));

  const waitFor = async (predicate, timeoutMs) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (appBridgeResponded) return null;
      const value = predicate();
      if (value) return value;
      await sleep(POLL_INTERVAL_MS);
    }
    return null;
  };

  const setReactInputValue = (input, value) => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis.HTMLInputElement.prototype, 'value');
    descriptor?.set?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  };

  const queryWordInput = () => document.querySelector(WORD_INPUT_SELECTOR)
    ?? document.querySelector(LEGACY_WORD_INPUT_SELECTOR);

  const queryCardForm = input => input.closest(CARD_FORM_SELECTOR) ?? input.closest('form');

  const querySubmitButton = form => form?.querySelector(SUBMIT_BUTTON_SELECTOR)
    ?? form?.querySelector(LEGACY_SUBMIT_BUTTON_SELECTOR);

  const fallbackThroughLibraryUi = async intent => {
    if (fallbackStarted || appBridgeResponded || !isSameRoute() || !intent) return;
    fallbackStarted = true;
    await sleep(FALLBACK_GRACE_MS);
    if (appBridgeResponded || !isSameRoute()) return;

    const input = await waitFor(queryWordInput, FALLBACK_FORM_TIMEOUT_MS);
    if (appBridgeResponded || !isSameRoute()) return;

    if (!(input instanceof HTMLInputElement)) {
      sendResult({ v: 1, id: intent.id, status: 'auth-required', word: intent.text, message: 'Open LingoFlash and sign in once, then retry.' });
      return;
    }

    setReactInputValue(input, intent.text);
    await sleep(80);

    const form = queryCardForm(input);
    const submit = querySubmitButton(form);
    if (!(form instanceof HTMLFormElement) || !(submit instanceof HTMLButtonElement)) {
      sendResult({ v: 1, id: intent.id, status: 'error', word: intent.text, message: 'Could not find the LingoFlash card creation form.' });
      return;
    }

    const readyButton = await waitFor(() => (!submit.disabled ? submit : null), 3_000);
    if (!readyButton || appBridgeResponded || !isSameRoute()) {
      sendResult({ v: 1, id: intent.id, status: 'error', word: intent.text, message: 'LingoFlash card creation is currently unavailable.' });
      return;
    }

    form.requestSubmit(submit);
    const completed = await waitFor(() => {
      const currentInput = queryWordInput();
      if (!(currentInput instanceof HTMLInputElement)) return null;
      return !currentInput.disabled && currentInput.value.trim() === '' ? true : null;
    }, FALLBACK_GENERATION_TIMEOUT_MS);
    if (appBridgeResponded || !isSameRoute()) return;
    if (completed) {
      sendResult({ v: 1, id: intent.id, status: 'created', word: intent.text, translation: '', message: 'Saved through the LingoFlash UI compatibility bridge.' });
      return;
    }
    sendResult({ v: 1, id: intent.id, status: 'error', word: intent.text, message: 'LingoFlash did not finish creating this card. Open the app once to check sign-in or AI availability.' });
  };

  function scheduleFallback(intent) {
    const start = () => { void fallbackThroughLibraryUi(intent); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
    else start();
  }

  globalThis.addEventListener('message', event => {
    if (event.source !== globalThis || event.origin !== globalThis.location.origin) return;
    const message = event.data;
    if (!message || typeof message !== 'object' || Array.isArray(message)) return;
    if (message.source === APP_SOURCE && message.type === IMPORT_CLAIMED_TYPE) {
      appBridgeResponded = true;
      return;
    }
    if (message.source !== APP_SOURCE || message.type !== APP_RESULT_TYPE) return;
    appBridgeResponded = true;
    sendResult(message.payload);
  });

  const initialIntent = captureSilentIntent();
  try {
    const initialUrl = new URL(globalThis.location.href);
    initialRoute = { pathname: initialUrl.pathname, search: initialUrl.search };
  } catch {
    initialRoute = null;
  }
  if (hasImportHash()) removeImportHash();
  if (initialIntent) void verifyAndDispatch(initialIntent);
})();
