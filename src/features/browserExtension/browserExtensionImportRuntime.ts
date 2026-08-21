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
  let options = initialOptions;
  let pendingIntent: BrowserExtensionImportIntent | null = null;
  let preparedIntentId: string | null = null;
  let activeIntentId: string | null = null;
  let signedOutNoticeId: string | null = null;
  let retryTimer: ReturnType<typeof globalThis.setTimeout> | null = null;
  let disposed = false;

  const finishIntent = (intent: BrowserExtensionImportIntent) => {
    if (pendingIntent?.id === intent.id) pendingIntent = null;
    activeIntentId = null;
  };

  const claimVerifiedIntent = (candidate: unknown) => {
    const intent = parseBrowserExtensionImportValue(candidate);
    if (!intent || intent.mode !== 'silent') return;
    if (pendingIntent?.id === intent.id || activeIntentId === intent.id || preparedIntentId === intent.id) return;
    pendingIntent = intent;
    browser.postMessage({
      source: BROWSER_EXTENSION_IMPORT_APP_SOURCE,
      type: BROWSER_EXTENSION_IMPORT_CLAIMED_MESSAGE,
      payload: { id: intent.id },
    });
    processPending();
  };

  const isBackedByVerifiedStorage = (intent: BrowserExtensionImportIntent): boolean => {
    let storage;
    try { storage = browser.getSessionStorage(); } catch { return true; }
    if (!storage) return true;
    const pending = readPendingBrowserExtensionImport(storage);
    return pending?.mode === 'silent'
      && pending.id === intent.id
      && pending.text === intent.text
      && pending.createdAt === intent.createdAt;
  };

  const processPending = () => {
    if (disposed || !pendingIntent) return;
    const intent = pendingIntent;

    if (preparedIntentId !== intent.id) {
      preparedIntentId = intent.id;
      if (intent.mode !== 'silent') options.openLibrary();
      options.changeDraft(intent.text);
    }

    if (options.identityLoading) return;
    if (!options.ownerId) {
      if (intent.mode === 'silent') {
        clearPendingBrowserExtensionImport(browser.getSessionStorage(), intent.id);
        publishSilentResult(intent, {
          status: 'auth-required',
          message: 'Sign in to LingoFlash once, then retry the selected word.',
        });
        finishIntent(intent);
        return;
      }
      if (signedOutNoticeId !== intent.id) {
        signedOutNoticeId = intent.id;
        options.notify('Sign in to LingoFlash to translate and save the selected word.');
      }
      return;
    }
    if (options.isBusy || activeIntentId === intent.id) return;

    activeIntentId = intent.id;
    clearPendingBrowserExtensionImport(browser.getSessionStorage(), intent.id);

    void options.generate().then(result => {
      if (disposed) return;
      if (result.status === 'busy') {
        activeIntentId = null;
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
