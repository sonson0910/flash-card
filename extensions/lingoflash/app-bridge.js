'use strict';

(() => {
  const extensionApi = globalThis.browser ?? globalThis.chrome;
  const EXPECTED_SOURCE = 'lingoflash-web-app';
  const EXPECTED_TYPE = 'LINGOFLASH_EXTENSION_RESULT';

  globalThis.addEventListener('message', event => {
    if (event.source !== globalThis || event.origin !== globalThis.location.origin) return;
    const message = event.data;
    if (!message || typeof message !== 'object' || Array.isArray(message)) return;
    if (message.source !== EXPECTED_SOURCE || message.type !== EXPECTED_TYPE) return;

    try {
      const pending = extensionApi.runtime.sendMessage({
        type: 'APP_IMPORT_RESULT',
        bridgeType: EXPECTED_TYPE,
        payload: message.payload,
      });
      if (pending && typeof pending.catch === 'function') pending.catch(() => undefined);
    } catch {
      // The extension may have reloaded while the background app tab was working.
    }
  });
})();
