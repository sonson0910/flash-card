'use strict';

(() => {
  const extensionApi = globalThis.browser ?? globalThis.chrome;
  const EXPECTED_SOURCE = 'lingoflash-web-app';
  const EXPECTED_TYPE = 'LINGOFLASH_EXTENSION_RESULT';
  const IMPORT_HASH_KEY = 'lf-import';
  const FALLBACK_GRACE_MS = 1_500;
  const FALLBACK_FORM_TIMEOUT_MS = 8_000;
  const FALLBACK_GENERATION_TIMEOUT_MS = 38_000;
  const POLL_INTERVAL_MS = 120;

  let appBridgeResponded = false;
  let fallbackStarted = false;

  const sendResult = payload => {
    try {
      const pending = extensionApi.runtime.sendMessage({
        type: 'APP_IMPORT_RESULT',
        bridgeType: EXPECTED_TYPE,
        payload,
      });
      if (pending && typeof pending.catch === 'function') pending.catch(() => undefined);
    } catch {
      // The extension may have reloaded while the background app tab was working.
    }
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

  const captureSilentIntent = () => {
    try {
      const hash = new URLSearchParams(globalThis.location.hash.slice(1));
      const encoded = hash.get(IMPORT_HASH_KEY);
      if (!encoded) return null;
      const parsed = JSON.parse(decodeBase64UrlUtf8(encoded));
      if (!parsed || parsed.v !== 1 || parsed.mode !== 'silent') return null;
      if (typeof parsed.id !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(parsed.id)) return null;
      const text = typeof parsed.text === 'string' ? parsed.text.replace(/\s+/g, ' ').trim() : '';
      if (!text || text.length > 80) return null;
      return { id: parsed.id, text };
    } catch {
      return null;
    }
  };

  // Capture before the React app has a chance to clean the fragment. If the
  // current Hosting build understands the protocol it will remove lf-import;
  // that is our signal to leave the canonical app bridge in control.
  const initialIntent = captureSilentIntent();

  const importHashStillPresent = () => {
    try {
      return new URLSearchParams(globalThis.location.hash.slice(1)).has(IMPORT_HASH_KEY);
    } catch {
      return false;
    }
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

  const fallbackThroughLibraryUi = async intent => {
    if (fallbackStarted || appBridgeResponded || !intent) return;
    fallbackStarted = true;

    // Give a protocol-aware Hosting build a real grace period before touching
    // the UI. If it captures lf-import it removes the hash and owns generation.
    await sleep(FALLBACK_GRACE_MS);
    if (appBridgeResponded || !importHashStillPresent()) return;

    const input = await waitFor(() => document.querySelector('#new-word'), FALLBACK_FORM_TIMEOUT_MS);
    if (appBridgeResponded || !importHashStillPresent()) return;

    if (!(input instanceof HTMLInputElement)) {
      sendResult({
        v: 1,
        id: intent.id,
        status: 'auth-required',
        word: intent.text,
        message: 'Open LingoFlash and sign in once, then retry.',
      });
      return;
    }

    setReactInputValue(input, intent.text);
    await sleep(80);

    const form = input.closest('form');
    const submit = form?.querySelector('button[type="submit"]');
    if (!(form instanceof HTMLFormElement) || !(submit instanceof HTMLButtonElement)) {
      sendResult({
        v: 1,
        id: intent.id,
        status: 'error',
        word: intent.text,
        message: 'Could not find the LingoFlash card creation form.',
      });
      return;
    }

    const readyButton = await waitFor(
      () => (!submit.disabled ? submit : null),
      3_000,
    );
    if (!readyButton || appBridgeResponded) {
      sendResult({
        v: 1,
        id: intent.id,
        status: 'error',
        word: intent.text,
        message: 'LingoFlash card creation is currently unavailable.',
      });
      return;
    }

    // Check once more immediately before submission. If a new Hosting build
    // captured the protocol while the UI was booting, do not create twice.
    if (!importHashStillPresent()) return;
    form.requestSubmit(submit);

    const completed = await waitFor(() => {
      const currentInput = document.querySelector('#new-word');
      if (!(currentInput instanceof HTMLInputElement)) return null;
      return !currentInput.disabled && currentInput.value.trim() === '' ? true : null;
    }, FALLBACK_GENERATION_TIMEOUT_MS);

    if (appBridgeResponded) return;
    if (completed) {
      sendResult({
        v: 1,
        id: intent.id,
        status: 'created',
        word: intent.text,
        // Older Hosting builds cannot expose the generated CardData directly.
        // background.js fills the inline meaning with the free translator.
        translation: '',
        message: 'Saved through the LingoFlash UI compatibility bridge.',
      });
      return;
    }

    sendResult({
      v: 1,
      id: intent.id,
      status: 'error',
      word: intent.text,
      message: 'LingoFlash did not finish creating this card. Open the app once to check sign-in or AI availability.',
    });
  };

  globalThis.addEventListener('message', event => {
    if (event.source !== globalThis || event.origin !== globalThis.location.origin) return;
    const message = event.data;
    if (!message || typeof message !== 'object' || Array.isArray(message)) return;
    if (message.source !== EXPECTED_SOURCE || message.type !== EXPECTED_TYPE) return;

    appBridgeResponded = true;
    sendResult(message.payload);
  });

  if (initialIntent) {
    const start = () => { void fallbackThroughLibraryUi(initialIntent); };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', start, { once: true });
    } else {
      start();
    }
  }
})();
