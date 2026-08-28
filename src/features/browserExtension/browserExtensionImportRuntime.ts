import type { CardIntakeActions } from '../intake/useCardIntake';
import {
  BROWSER_EXTENSION_IMPORT_APP_SOURCE,
  BROWSER_EXTENSION_IMPORT_BRIDGE_SOURCE,
  BROWSER_EXTENSION_IMPORT_CLAIMED_MESSAGE,
  BROWSER_EXTENSION_IMPORT_READY_MESSAGE,
  clearPendingBrowserExtensionImport,
  getBrowserExtensionImportBrowser,
  parseBrowserExtensionImportValue,
  readPendingBrowserExtensionImport,
  type BrowserExtensionImportBrowser,
  type BrowserExtensionImportIntent,
} from './browserExtensionImport';

export interface BrowserExtensionImportOptions {
  ownerId: string | null;
  identityLoading: boolean;
  customDecks: string[];
  libraryReady: boolean;
  isBusy: boolean;
  changeDraft: CardIntakeActions['changeDraft'];
  generate: CardIntakeActions['generate'];
  openLibrary(): void;
  notify(message: string): void;
  reportError(message: string): void;
}

export interface BrowserExtensionImportRuntime {
  update(options: BrowserExtensionImportOptions): void;
  acceptVerifiedIntent(intent: BrowserExtensionImportIntent): void;
  acceptUnverifiedIntent(intent: BrowserExtensionImportIntent): void;
  dispose(): void;
}

const EXTENSION_RESULT_SOURCE = 'lingoflash-web-app';
const EXTENSION_RESULT_TYPE = 'LINGOFLASH_EXTENSION_RESULT';

const boundedText = (value: unknown, maximum: number): string =>
  (typeof value === 'string' ? value : '').trim().slice(0, maximum);

const publishSilentResult = (
  intent: BrowserExtensionImportIntent,
  payload: {
    status: 'created' | 'existing' | 'auth-required' | 'error';
    message?: string;
    card?: {
      word?: unknown;
      translation?: unknown;
      phonetic?: unknown;
      explanation?: unknown;
      exampleSentence?: unknown;
      exampleTranslation?: unknown;
    };
  },
): void => {
  if (intent.mode !== 'silent') return;
  const card = payload.card;
  const message = {
    source: EXTENSION_RESULT_SOURCE,
    type: EXTENSION_RESULT_TYPE,
    payload: {
      v: 1,
      id: intent.id,
      nonce: intent.nonce,
      status: payload.status,
      word: boundedText(card?.word ?? intent.text, 80),
      translation: boundedText(card?.translation, 256),
      phonetic: boundedText(card?.phonetic, 256),
      explanation: boundedText(card?.explanation, 1024),
      exampleSentence: boundedText(card?.exampleSentence, 1024),
      exampleTranslation: boundedText(card?.exampleTranslation, 1024),
      message: boundedText(payload.message, 512),
    },
  };
  const targetOrigin = globalThis.location?.origin || '*';
  globalThis.postMessage?.(message, targetOrigin);
};

export const startBrowserExtensionImportRuntime = (
  initialOptions: BrowserExtensionImportOptions,
  suppliedBrowser: BrowserExtensionImportBrowser = getBrowserExtensionImportBrowser(),
): BrowserExtensionImportRuntime => {
  const browser = suppliedBrowser;
  try {
    if (!browser.isTopFrame()) {
      return {
        update: () => undefined,
        acceptVerifiedIntent: () => undefined,
        acceptUnverifiedIntent: () => undefined,
        dispose: () => undefined,
      };
    }
  } catch {
    return {
      update: () => undefined,
      acceptVerifiedIntent: () => undefined,
      acceptUnverifiedIntent: () => undefined,
      dispose: () => undefined,
    };
  }
  let options = initialOptions;
  let pendingIntent: BrowserExtensionImportIntent | null = null;
  const intentKey = (intent: BrowserExtensionImportIntent): string =>
    `${intent.id}:${intent.nonce ?? ''}`;
  let preparedIntentKey: string | null = null;
  let activeIntentKey: string | null = null;
  let signedOutNoticeKey: string | null = null;
  let retryTimer: ReturnType<typeof globalThis.setTimeout> | null = null;
  let disposed = false;

  const finishIntent = (intent: BrowserExtensionImportIntent) => {
    const key = intentKey(intent);
    if (pendingIntent && intentKey(pendingIntent) === key) pendingIntent = null;
    if (activeIntentKey === key) activeIntentKey = null;
  };

  const claimVerifiedIntent = (candidate: unknown) => {
    const intent = parseBrowserExtensionImportValue(candidate);
    if (!intent || intent.mode !== 'silent') return;
    const key = intentKey(intent);
    if ((pendingIntent && intentKey(pendingIntent) === key)
      || activeIntentKey === key
      || preparedIntentKey === key) return;
    pendingIntent = intent;
    browser.postMessage({
      source: BROWSER_EXTENSION_IMPORT_APP_SOURCE,
      type: BROWSER_EXTENSION_IMPORT_CLAIMED_MESSAGE,
      payload: { id: intent.id, nonce: intent.nonce },
    });
    processPending();
  };

  const isBackedByVerifiedStorage = (intent: BrowserExtensionImportIntent): boolean => {
    let storage;
    try { storage = browser.getSessionStorage(); } catch { return false; }
    if (!storage) return false;
    const pending = readPendingBrowserExtensionImport(storage);
    return pending?.mode === 'silent'
      && pending.id === intent.id
      && pending.nonce === intent.nonce
      && pending.text === intent.text
      && pending.createdAt === intent.createdAt
      && (pending.context ?? '') === (intent.context ?? '')
      && (pending.requestedDeck ?? '') === (intent.requestedDeck ?? '');
  };

  const processPending = () => {
    if (disposed || !pendingIntent) return;
    const intent = pendingIntent;

    const key = intentKey(intent);
    if (preparedIntentKey !== key) {
      preparedIntentKey = key;
      if (intent.mode !== 'silent') options.openLibrary();
      options.changeDraft(intent.text);
    }

    if (options.identityLoading) return;
    if (!options.ownerId) {
      if (intent.mode === 'silent') {
        clearPendingBrowserExtensionImport(browser.getSessionStorage(), intent.id, intent.nonce);
        publishSilentResult(intent, {
          status: 'auth-required',
          message: 'Sign in to LingoFlash once, then retry the selected word.',
        });
        finishIntent(intent);
        return;
      }
      if (signedOutNoticeKey !== key) {
        signedOutNoticeKey = key;
        options.notify('Sign in to LingoFlash to translate and save the selected word.');
      }
      return;
    }
    if (!options.libraryReady) return;
    const requestedDeck = intent.requestedDeck?.trim() ?? '';
    if (requestedDeck && !options.customDecks.includes(requestedDeck)) {
      clearPendingBrowserExtensionImport(browser.getSessionStorage(), intent.id, intent.nonce);
      publishSilentResult(intent, {
        status: 'error',
        message: `Deck “${requestedDeck}” không còn tồn tại. Hãy chọn lại deck rồi thử lại.`,
      });
      finishIntent(intent);
      return;
    }
    if (options.isBusy || activeIntentKey === key) return;

    activeIntentKey = key;
    clearPendingBrowserExtensionImport(browser.getSessionStorage(), intent.id, intent.nonce);

    void options.generate({
      ...(intent.context ? { context: intent.context } : {}),
      ...(requestedDeck ? {
        requestedDeck,
        requestedDeckAvailable: (deck: string) => options.customDecks.includes(deck),
      } : {}),
    }).then(result => {
      if (disposed) return;
      if (result.status === 'busy') {
        if (activeIntentKey === key) activeIntentKey = null;
        retryTimer = globalThis.setTimeout(processPending, 250);
        return;
      }

      finishIntent(intent);
      if (result.status === 'created') {
        publishSilentResult(intent, { status: 'created', card: result.card });
        if (intent.mode !== 'silent') {
          options.notify(`Added “${intent.text}” to your LingoFlash library.`);
        }
      } else if (result.status === 'existing') {
        publishSilentResult(intent, { status: 'existing', card: result.card });
        if (intent.mode !== 'silent') {
          options.notify(`“${intent.text}” is already in your LingoFlash library.`);
        }
      } else if (result.status === 'invalid') {
        publishSilentResult(intent, {
          status: 'error',
          message: 'Select an English word or short phrase of at most 80 characters.',
        });
        if (intent.mode !== 'silent') {
          options.reportError('The selected text could not be added. Select an English word or short phrase.');
        }
      } else if (result.status === 'failed') {
        publishSilentResult(intent, {
          status: 'error',
          message: 'LingoFlash could not translate or save this word. Please try again.',
        });
      }
    }).catch(error => {
      if (disposed) return;
      finishIntent(intent);
      publishSilentResult(intent, {
        status: 'error',
        message: 'LingoFlash could not translate or save this word. Please try again.',
      });
      if (intent.mode !== 'silent') {
        options.reportError(error instanceof Error
          ? error.message
          : 'The selected text could not be added to LingoFlash.');
      }
    });
  };

  const capturePending = () => {
    const pending = readPendingBrowserExtensionImport(browser.getSessionStorage());
    if (pending?.mode === 'silent') claimVerifiedIntent(pending);
  };

  const stopMessageListener = browser.listenMessage(event => {
    const message = event.data;
    if (!message || typeof message !== 'object' || Array.isArray(message)) return;
    const candidate = message as Record<string, unknown>;
    if (candidate.source !== BROWSER_EXTENSION_IMPORT_BRIDGE_SOURCE
      || candidate.type !== BROWSER_EXTENSION_IMPORT_READY_MESSAGE) return;
    const intent = parseBrowserExtensionImportValue(candidate.payload);
    if (intent?.mode === 'silent' && isBackedByVerifiedStorage(intent)) claimVerifiedIntent(intent);
  });
  capturePending();

  return {
    update(nextOptions) {
      options = nextOptions;
      processPending();
    },
    acceptVerifiedIntent(intent) {
      if (isBackedByVerifiedStorage(intent)) claimVerifiedIntent(intent);
    },
    acceptUnverifiedIntent(candidate) {
      const intent = parseBrowserExtensionImportValue(candidate);
      if (!intent) return;
      options.openLibrary();
      options.changeDraft(intent.text);
    },
    dispose() {
      disposed = true;
      stopMessageListener();
      if (retryTimer !== null) globalThis.clearTimeout(retryTimer);
    },
  };
};
