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
  const APP_BRIDGE_PORT_NAME = 'sonflash-app-bridge';
  const APP_BRIDGE_PROVIDER_TYPE = 'LINGOFLASH_EXTENSION_PROVIDER';
  const APP_BRIDGE_PROVIDER_READY_TYPE = 'LINGOFLASH_EXTENSION_PROVIDER_READY';
  const APP_BRIDGE_RECONNECT_DELAY_MS = 250;
  const APP_BRIDGE_RECONNECT_ATTEMPTS = 3;
  const DECK_METADATA_TYPE = 'LINGOFLASH_EXTENSION_DECK_METADATA';
  const DECK_METADATA_CLEAR_TYPE = 'LINGOFLASH_EXTENSION_DECK_METADATA_CLEAR';
  // 07.6: due count follows the exact same app -> bridge -> background relay
  // as deck metadata and shares the bridge document lifetime.
  const DUE_COUNT_TYPE = 'LINGOFLASH_EXTENSION_DUE_COUNT';
  const DUE_COUNT_CLEAR_TYPE = 'LINGOFLASH_EXTENSION_DUE_COUNT_CLEAR';
  // Course locale follows the exact same app -> bridge -> background relay as
  // deck metadata and due count (07.5). The extension uses it to follow the
  // active course's native language in its own UI and to tag a fresh capture
  // with the course's target language instead of a fixed English assumption.
  const COURSE_LOCALE_TYPE = 'LINGOFLASH_EXTENSION_COURSE_LOCALE';
  const COURSE_LOCALE_CLEAR_TYPE = 'LINGOFLASH_EXTENSION_COURSE_LOCALE_CLEAR';
  const CAPTURE_SOURCE_LANGUAGES = ['en', 'ko', 'ja', 'zh'];
  const IMPORT_HASH_KEY = 'lf-import';
  const IMPORT_STORAGE_KEY = 'lingoflash_browser_extension_import';
  const UNVERIFIED_STORAGE_KEY = 'lingoflash_browser_extension_draft_import';
  const IMPORT_PROTOCOL_VERSION = 3;
  const MAX_TEXT_LENGTH = 80;
  const MAX_CONTEXT_LENGTH = 500;
  const MAX_PAGE_TITLE_LENGTH = 256;
  const MAX_SOURCE_URL_LENGTH = 2048;
  const MAX_ENCODED_IMPORT_LENGTH = 2048;
  const IMPORT_NONCE_PATTERN = /^[A-Za-z0-9_-]{22,64}$/;
  const FALLBACK_GRACE_MS = 1_500;
  const FALLBACK_FORM_TIMEOUT_MS = 8_000;
  // The app retries its 65s AI request once after 500ms. Keep the DOM
  // fallback alive for that full budget plus a response/render allowance.
  const AI_ATTEMPT_TIMEOUT_MS = 65_000;
  const AI_RETRY_DELAY_MS = 500;
  const APP_RESPONSE_RENDER_MARGIN_MS = 4_500;
  const FALLBACK_GENERATION_TIMEOUT_MS = 135_000;
  if (FALLBACK_GENERATION_TIMEOUT_MS !== AI_ATTEMPT_TIMEOUT_MS * 2
    + AI_RETRY_DELAY_MS + APP_RESPONSE_RENDER_MARGIN_MS) {
    throw new Error('LingoFlash compatibility timeout no longer matches the AI retry budget.');
  }
  const DECK_METADATA_CLEAR_RETRY_MS = 250;
  const DECK_METADATA_CLEAR_RETRIES = 3;
  const POLL_INTERVAL_MS = 120;
  const WORD_INPUT_SELECTOR = '[data-extension-target="word-input"]';
  const LEGACY_WORD_INPUT_SELECTOR = '#new-word';
  const CARD_FORM_SELECTOR = '[data-extension-target="card-create-form"]';
  const SUBMIT_BUTTON_SELECTOR = '[data-extension-target="word-submit"]';
  const LEGACY_SUBMIT_BUTTON_SELECTOR = 'button[type="submit"]';

  const isTopFrame = () => {
    try { return globalThis.top != null && globalThis.self != null && globalThis.top === globalThis.self; } catch { return false; }
  };
  if (!isTopFrame()) return;

  let appBridgeResponded = false;
  let fallbackStarted = false;
  let initialRoute = null;
  let verifiedIntent = null;
  let appBridgePort = null;
  let providerId = '';
  let reconnectTimer = null;
  let reconnectAttempts = 0;
  const queuedProviderMessages = [];

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

  const dispatchProviderMessage = (type, payload, token) => {
    if (!token || token !== providerId || !appBridgePort) {
      return Promise.reject(new Error('The LingoFlash app bridge is no longer connected.'));
    }
    return sendRuntimeMessage({ type, providerId: token, payload })
      .then(response => ({ response, providerId: token }));
  };
  const flushProviderMessages = () => {
    if (!providerId) return;
    const token = providerId;
    for (const queued of queuedProviderMessages.splice(0)) {
      void dispatchProviderMessage(queued.type, queued.payload, token)
        .then(queued.resolve, queued.reject);
    }
  };
  const sendProviderMessage = (type, payload, token = providerId) => {
    if (token) return dispatchProviderMessage(type, payload, token);
    if (!appBridgePort) return Promise.reject(new Error('The LingoFlash app bridge is unavailable.'));
    return new Promise((resolve, reject) => {
      queuedProviderMessages.push({ type, payload, resolve, reject });
    });
  };
  const notifyProviderReady = generation => {
    try {
      globalThis.postMessage?.({
        source: BRIDGE_SOURCE,
        type: APP_BRIDGE_PROVIDER_READY_TYPE,
        generation,
      }, globalThis.location.origin);
    } catch { /* The app may be navigating away. */ }
  };
  const scheduleAppBridgeReconnect = () => {
    if (reconnectTimer !== null || reconnectAttempts >= APP_BRIDGE_RECONNECT_ATTEMPTS) return;
    reconnectAttempts += 1;
    reconnectTimer = globalThis.setTimeout(() => {
      reconnectTimer = null;
      if (!appBridgePort) connectAppBridge();
    }, APP_BRIDGE_RECONNECT_DELAY_MS);
  };
  const connectAppBridge = () => {
    if (typeof extensionApi?.runtime?.connect !== 'function') return;
    try {
      const port = extensionApi.runtime.connect({ name: APP_BRIDGE_PORT_NAME });
      appBridgePort = port;
      port.onMessage?.addListener?.(message => {
        if (appBridgePort !== port) return;
        if (!message || typeof message !== 'object' || Array.isArray(message)
          || message.type !== APP_BRIDGE_PROVIDER_TYPE || typeof message.providerId !== 'string') return;
        providerId = message.providerId;
        reconnectAttempts = 0;
        flushProviderMessages();
        notifyProviderReady(message.generation);
      });
      port.onDisconnect?.addListener?.(() => {
        if (appBridgePort !== port) return;
        appBridgePort = null;
        providerId = '';
        for (const queued of queuedProviderMessages.splice(0)) {
          queued.reject(new Error('The LingoFlash app bridge was disconnected.'));
        }
        scheduleAppBridgeReconnect();
      });
    } catch {
      appBridgePort = null;
      providerId = '';
      scheduleAppBridgeReconnect();
    }
  };

  const sendResult = (intent, payload) => {
    if (!intent || !payload || payload.id !== intent.id
      || (payload.nonce !== undefined && payload.nonce !== intent.nonce)) return;
    void sendRuntimeMessage({
      type: 'APP_IMPORT_RESULT',
      bridgeType: APP_RESULT_TYPE,
      payload: { ...payload, nonce: intent.nonce },
    }).catch(() => undefined);
  };

  const relayDeckMetadataClear = (payload, attemptsRemaining = DECK_METADATA_CLEAR_RETRIES) => {
    void sendProviderMessage('CLEAR_DECK_METADATA', payload).then(({ response }) => {
      if (response?.ok !== true) throw new Error('Deck metadata clear was not acknowledged.');
    }).catch(() => {
      if (attemptsRemaining > 0) {
        globalThis.setTimeout(() => relayDeckMetadataClear(payload, attemptsRemaining - 1), DECK_METADATA_CLEAR_RETRY_MS);
      }
    });
  };

  const relayDueCountClear = (payload, attemptsRemaining = DECK_METADATA_CLEAR_RETRIES) => {
    void sendProviderMessage('CLEAR_DUE_COUNT', payload).then(({ response }) => {
      if (response?.ok !== true) throw new Error('Due count clear was not acknowledged.');
    }).catch(() => {
      if (attemptsRemaining > 0) {
        globalThis.setTimeout(() => relayDueCountClear(payload, attemptsRemaining - 1), DECK_METADATA_CLEAR_RETRY_MS);
      }
    });
  };

  const relayCourseLocaleClear = (payload, attemptsRemaining = DECK_METADATA_CLEAR_RETRIES) => {
    void sendProviderMessage('CLEAR_COURSE_LOCALE', payload).then(({ response }) => {
      if (response?.ok !== true) throw new Error('Course locale clear was not acknowledged.');
    }).catch(() => {
      if (attemptsRemaining > 0) {
        globalThis.setTimeout(() => relayCourseLocaleClear(payload, attemptsRemaining - 1), DECK_METADATA_CLEAR_RETRY_MS);
      }
    });
  };

  const decodeBase64UrlUtf8 = encoded => {
    try {
      if (typeof encoded !== 'string' || encoded.length > MAX_ENCODED_IMPORT_LENGTH) return '';
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

  // Re-applies the same rule the background worker and the server enforce:
  // http/https only, credentials/query/fragment stripped. This app-bridge
  // copy only re-validates what the worker already sanitized before relaying
  // it into sessionStorage for the app to read.
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

  const normalizeSilentIntent = value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const text = normalizeText(value.text);
    if (
      value.v !== IMPORT_PROTOCOL_VERSION
      || value.mode !== 'silent'
      || typeof value.id !== 'string'
      || !/^[A-Za-z0-9_-]{8,128}$/.test(value.id)
      || typeof value.nonce !== 'string'
      || !IMPORT_NONCE_PATTERN.test(value.nonce)
      || !text
      || text.length > MAX_TEXT_LENGTH
      || !Number.isSafeInteger(value.createdAt)
      || value.createdAt <= 0
    ) return null;
    return { v: IMPORT_PROTOCOL_VERSION, id: value.id, nonce: value.nonce, text, createdAt: value.createdAt, mode: 'silent' };
  };

  const normalizeLegacyDraftIntent = value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const text = normalizeText(value.text);
    if (
      value.v !== 2
      || value.mode !== undefined
      || value.nonce !== undefined
      || typeof value.id !== 'string'
      || !/^[A-Za-z0-9_-]{8,128}$/.test(value.id)
      || !text
      || text.length > MAX_TEXT_LENGTH
      || !Number.isSafeInteger(value.createdAt)
      || value.createdAt <= 0
    ) return null;
    return { v: 2, id: value.id, text, createdAt: value.createdAt };
  };

  const normalizeImportCandidate = value => normalizeSilentIntent(value) ?? normalizeLegacyDraftIntent(value);

  const normalizeVerifiedIntent = value => {
    const intent = normalizeSilentIntent(value);
    const text = normalizeText(value?.text);
    const context = value?.context === undefined ? '' : normalizeText(value.context).slice(0, MAX_CONTEXT_LENGTH);
    const requestedDeck = value?.requestedDeck === undefined ? '' : normalizeText(value.requestedDeck).slice(0, 128);
    const sourceUrl = value?.sourceUrl === undefined ? '' : sanitizeSourceUrl(value.sourceUrl);
    const pageTitle = value?.pageTitle === undefined ? '' : normalizeText(value.pageTitle).slice(0, MAX_PAGE_TITLE_LENGTH);
    // Unlike the other optional fields above, an unrecognized sourceLanguage
    // is dropped rather than rejecting the whole intent: it is a soft hint
    // (07.5), and a future target language this extension build does not
    // know about yet must not break capture, it just skips the hint.
    const sourceLanguage = typeof value?.sourceLanguage === 'string' && CAPTURE_SOURCE_LANGUAGES.includes(value.sourceLanguage)
      ? value.sourceLanguage
      : '';
    if (!intent
      || (value.context !== undefined && typeof value.context !== 'string')
      || (value.requestedDeck !== undefined && typeof value.requestedDeck !== 'string')
      || (value.sourceUrl !== undefined && typeof value.sourceUrl !== 'string')
      || (value.pageTitle !== undefined && typeof value.pageTitle !== 'string')
      || !text || text.length > MAX_TEXT_LENGTH || !Number.isSafeInteger(value.createdAt) || value.createdAt <= 0) return null;
    return {
      v: IMPORT_PROTOCOL_VERSION,
      id: value.id,
      nonce: value.nonce,
      text,
      ...(context ? { context } : {}),
      ...(requestedDeck ? { requestedDeck } : {}),
      ...(sourceUrl ? { sourceUrl } : {}),
      ...(pageTitle ? { pageTitle } : {}),
      ...(sourceLanguage ? { sourceLanguage } : {}),
      createdAt: value.createdAt,
      mode: 'silent',
    };
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

  const captureInitialIntent = () => {
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
      && intent.id === candidate.id
      && intent.nonce === candidate.nonce
      && intent.text === candidate.text
      && intent.createdAt === candidate.createdAt;
    if (!matchesCandidate) {
      notifyUnverifiedIntent(candidate);
      return;
    }
    verifiedIntent = intent;
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

  const rejectStructuredCompatibilityFallback = intent => {
    // The legacy DOM form cannot carry or validate structured intent fields.
    // Remove the verified hand-off before reporting the failure so a late app
    // runtime cannot silently save a card without its verified metadata.
    appBridgeResponded = true;
    try { globalThis.sessionStorage?.removeItem(IMPORT_STORAGE_KEY); } catch { /* Storage may be unavailable. */ }
    const reason = intent.requestedDeck
      ? `Deck “${intent.requestedDeck}” requires the current LingoFlash app runtime.`
      : 'Sentence context requires the current LingoFlash app runtime.';
    sendResult(intent, {
      v: 1,
      id: intent.id,
      status: 'error',
      word: intent.text,
      message: `${reason} Open the app and try again.`,
    });
  };

  const fallbackThroughLibraryUi = async intent => {
    if (fallbackStarted || appBridgeResponded || !isSameRoute() || !intent) return;
    fallbackStarted = true;
    await sleep(FALLBACK_GRACE_MS);
    if (appBridgeResponded || !isSameRoute()) return;

    if (intent.requestedDeck || intent.context || intent.sourceUrl || intent.pageTitle) {
      rejectStructuredCompatibilityFallback(intent);
      return;
    }

    const input = await waitFor(queryWordInput, FALLBACK_FORM_TIMEOUT_MS);
    if (appBridgeResponded || !isSameRoute()) return;

    if (!(input instanceof HTMLInputElement)) {
      sendResult(intent, { v: 1, id: intent.id, status: 'auth-required', word: intent.text, message: 'Open LingoFlash and sign in once, then retry.' });
      return;
    }

    setReactInputValue(input, intent.text);
    await sleep(80);

    const form = queryCardForm(input);
    const submit = querySubmitButton(form);
    if (!(form instanceof HTMLFormElement) || !(submit instanceof HTMLButtonElement)) {
      sendResult(intent, { v: 1, id: intent.id, status: 'error', word: intent.text, message: 'Could not find the LingoFlash card creation form.' });
      return;
    }

    const readyButton = await waitFor(() => (!submit.disabled ? submit : null), 3_000);
    if (!readyButton || appBridgeResponded || !isSameRoute()) {
      sendResult(intent, { v: 1, id: intent.id, status: 'error', word: intent.text, message: 'LingoFlash card creation is currently unavailable.' });
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
      sendResult(intent, { v: 1, id: intent.id, status: 'created', word: intent.text, translation: '', message: 'Saved through the LingoFlash UI compatibility bridge.' });
      return;
    }
    sendResult(intent, { v: 1, id: intent.id, status: 'error', word: intent.text, message: 'LingoFlash did not finish creating this card. Open the app once to check sign-in or AI availability.' });
  };

  function scheduleFallback(intent) {
    const start = () => { void fallbackThroughLibraryUi(intent); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
    else start();
  }

  const initialIntent = captureInitialIntent();
  const isImportHandoffDocument = hasImportHash();
  if (!isImportHandoffDocument) connectAppBridge();
  globalThis.addEventListener('message', event => {
    if (event.source !== globalThis || event.origin !== globalThis.location.origin) return;
    const message = event.data;
    if (!message || typeof message !== 'object' || Array.isArray(message)) return;
    if (message.source === APP_SOURCE && message.type === IMPORT_CLAIMED_TYPE) {
      if (message.payload?.id === verifiedIntent?.id && message.payload?.nonce === verifiedIntent?.nonce) {
        appBridgeResponded = true;
      }
      return;
    }
    if (message.source !== APP_SOURCE) return;
    if (message.type === DECK_METADATA_TYPE) {
      void sendProviderMessage('SYNC_DECK_METADATA', message.payload).catch(() => undefined);
      return;
    }
    if (message.type === DECK_METADATA_CLEAR_TYPE) {
      relayDeckMetadataClear(message.payload);
      return;
    }
    if (message.type === DUE_COUNT_TYPE) {
      void sendProviderMessage('SYNC_DUE_COUNT', message.payload).catch(() => undefined);
      return;
    }
    if (message.type === DUE_COUNT_CLEAR_TYPE) {
      relayDueCountClear(message.payload);
      return;
    }
    if (message.type === COURSE_LOCALE_TYPE) {
      void sendProviderMessage('SYNC_COURSE_LOCALE', message.payload).catch(() => undefined);
      return;
    }
    if (message.type === COURSE_LOCALE_CLEAR_TYPE) {
      relayCourseLocaleClear(message.payload);
      return;
    }
    if (message.type !== APP_RESULT_TYPE) return;
    if (message.payload?.id !== verifiedIntent?.id || message.payload?.nonce !== verifiedIntent?.nonce) return;
    appBridgeResponded = true;
    sendResult(verifiedIntent, message.payload);
  });

  try {
    const initialUrl = new URL(globalThis.location.href);
    initialRoute = { pathname: initialUrl.pathname, search: initialUrl.search };
  } catch {
    initialRoute = null;
  }
  if (initialIntent && initialIntent.mode === undefined) notifyUnverifiedIntent(initialIntent);
  if (isImportHandoffDocument) removeImportHash();
  if (initialIntent?.mode === 'silent') void verifyAndDispatch(initialIntent);
})();
