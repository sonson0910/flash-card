import type { CardIntakeActions } from '../intake/useCardIntake';
import { captureFailureMessage } from '../../lib/captureFailureMessage';
import {
  BROWSER_EXTENSION_IMPORT_APP_SOURCE,
  BROWSER_EXTENSION_IMPORT_BRIDGE_SOURCE,
  BROWSER_EXTENSION_IMPORT_CLAIMED_MESSAGE,
  BROWSER_EXTENSION_IMPORT_READY_MESSAGE,
  clearPendingBrowserExtensionImport,
  getBrowserExtensionImportBrowser,
  parseBrowserExtensionImportValue,
  readPendingBrowserExtensionImportOwner,
  readPendingBrowserExtensionImport,
  writePendingBrowserExtensionImportOwner,
  type BrowserExtensionImportBrowser,
  type BrowserExtensionImportIntent,
  type BrowserExtensionImportStorage,
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
  /**
   * The signed-in owner's active course native/target language, when known.
   * `useBrowserExtensionImport` syncs this pair to the extension the same
   * way it already syncs deck metadata (07.5, `LINGOFLASH_EXTENSION_COURSE_
   * LOCALE`), which the extension uses to follow the course's native
   * language in its own popup/options UI and to tag a fresh capture with the
   * course's target language. Omitting either field (or passing `null`)
   * sends no course-locale sync at all, so the extension keeps its today's
   * Chrome-i18n UI locale and fixed English capture assumption unchanged.
   */
  courseNativeLanguage?: string | null;
  courseTargetLanguage?: string | null;
  /**
   * Runs immediately before a silent (one-click, no-review) capture is
   * generated. Receives the target language the extension captured this
   * word under — the active course's target language when the extension had
   * one synced (07.5), else `'en'`, the extension's original fixed
   * assumption for a build (or a not-yet-synced session) that never reports
   * one. When the active course targets a different language, this is the
   * only point where a human ever sees the mismatch — manual (non-silent)
   * captures instead land in the library view, where the real course
   * switcher is already visible before the user generates anything.
   * Returning `'cancel'` drops the capture with no side effects: nothing is
   * generated, the pending storage entry is cleared, and the extension
   * receives a clean error result. Omitting this option (or resolving
   * `'proceed'`) keeps generation byte-for-byte identical to before this
   * option existed.
   */
  ensureCaptureCourse?(targetLanguage: NonNullable<BrowserExtensionImportIntent['sourceLanguage']>): Promise<'proceed' | 'cancel'>;
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
      origin?: unknown;
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
      aiGenerated: card?.origin === 'ai',
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
  // A verified capture belongs to the owner that was signed in when it was
  // claimed. When startup begins anonymously, the first resolved owner claims
  // it. A later owner must never inherit that capture.
  let pendingOwnerId: string | null = initialOptions.ownerId;
  const intentKey = (intent: BrowserExtensionImportIntent): string =>
    `${intent.id}:${intent.nonce ?? ''}`;
  let preparedIntentKey: string | null = null;
  let activeIntentKey: string | null = null;
  let signedOutNoticeKey: string | null = null;
  let retryTimer: ReturnType<typeof globalThis.setTimeout> | null = null;
  let disposed = false;
  let generationEpoch = 0;
  const terminalIntentKeys = new Set<string>();

  const publishTerminalError = (intent: BrowserExtensionImportIntent, message: string) => {
    const key = intentKey(intent);
    if (terminalIntentKeys.has(key)) return;
    terminalIntentKeys.add(key);
    publishSilentResult(intent, { status: 'error', message });
  };

  const clearRetry = () => {
    if (retryTimer !== null) globalThis.clearTimeout(retryTimer);
    retryTimer = null;
  };

  const invalidatePendingIntent = (ownerChanged = false) => {
    const intent = pendingIntent;
    generationEpoch += 1;
    clearRetry();
    pendingIntent = null;
    pendingOwnerId = null;
    preparedIntentKey = null;
    activeIntentKey = null;
    if (intent) {
      clearPendingBrowserExtensionImport(browser.getSessionStorage(), intent.id, intent.nonce);
      if (ownerChanged) {
        publishTerminalError(intent, 'Import cancelled because the signed-in account changed. Capture the word again.');
      }
    }
  };

  const rejectBeforeClaim = (
    intent: BrowserExtensionImportIntent,
    storage: BrowserExtensionImportStorage | null,
    message: string,
  ) => {
    clearPendingBrowserExtensionImport(storage, intent.id, intent.nonce);
    publishTerminalError(intent, message);
  };

  const finishIntent = (intent: BrowserExtensionImportIntent) => {
    const key = intentKey(intent);
    if (pendingIntent && intentKey(pendingIntent) === key) {
      pendingIntent = null;
      pendingOwnerId = null;
    }
    if (activeIntentKey === key) activeIntentKey = null;
  };

  const claimVerifiedIntent = (candidate: unknown) => {
    const intent = parseBrowserExtensionImportValue(candidate);
    if (!intent || intent.mode !== 'silent') return;
    let storage;
    try { storage = browser.getSessionStorage(); } catch {
      publishTerminalError(intent, 'Could not securely verify this import. Capture the word again.');
      return;
    }
    const storedOwnerId = readPendingBrowserExtensionImportOwner(storage, intent);
    if (storedOwnerId && options.ownerId && storedOwnerId !== options.ownerId) {
      rejectBeforeClaim(intent, storage, 'Import cancelled because the signed-in account changed. Capture the word again.');
      return;
    }
    const key = intentKey(intent);
    if ((pendingIntent && intentKey(pendingIntent) === key)
      || activeIntentKey === key
      || preparedIntentKey === key) return;
    pendingIntent = intent;
    pendingOwnerId = storedOwnerId ?? options.ownerId;
    if (!storedOwnerId && pendingOwnerId
      && !writePendingBrowserExtensionImportOwner(storage, intent, pendingOwnerId)) {
      rejectBeforeClaim(intent, storage, 'Could not securely prepare this import. Capture the word again.');
      pendingIntent = null;
      pendingOwnerId = null;
      return;
    }
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
      && (pending.requestedDeck ?? '') === (intent.requestedDeck ?? '')
      && (pending.sourceUrl ?? '') === (intent.sourceUrl ?? '')
      && (pending.pageTitle ?? '') === (intent.pageTitle ?? '')
      && (pending.sourceLanguage ?? '') === (intent.sourceLanguage ?? '');
  };

  const processPending = () => {
    if (disposed || !pendingIntent) return;
    const intent = pendingIntent;

    const key = intentKey(intent);
    if (pendingOwnerId && options.ownerId && pendingOwnerId !== options.ownerId) {
      invalidatePendingIntent(true);
      return;
    }
    if (!pendingOwnerId && options.ownerId) {
      pendingOwnerId = options.ownerId;
      if (!writePendingBrowserExtensionImportOwner(browser.getSessionStorage(), intent, pendingOwnerId)) {
        invalidatePendingIntent();
        return;
      }
    }

    if (options.identityLoading) return;
    if (!options.ownerId) {
      if (intent.mode === 'silent') {
        clearPendingBrowserExtensionImport(browser.getSessionStorage(), intent.id, intent.nonce);
        publishSilentResult(intent, {
          status: 'auth-required',
          message: 'Đăng nhập Google vào SonFlash rồi thử lại từ đã chọn.',
        });
        finishIntent(intent);
        return;
      }
      if (signedOutNoticeKey !== key) {
        signedOutNoticeKey = key;
        options.notify('Đăng nhập Google vào SonFlash để tạo và lưu thẻ từ đã chọn.');
      }
      return;
    }

    if (preparedIntentKey !== key) {
      preparedIntentKey = key;
      if (intent.mode !== 'silent') options.openLibrary();
      options.changeDraft(intent.text);
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
    const ownerId = pendingOwnerId;
    const epoch = generationEpoch;
    const isCurrent = () => !disposed
      && pendingIntent === intent
      && pendingOwnerId === ownerId
      && options.ownerId === ownerId
      && generationEpoch === epoch;

    const runGeneration = () => {
      if (!isCurrent()) return;
      clearPendingBrowserExtensionImport(browser.getSessionStorage(), intent.id, intent.nonce);

      void options.generate({
        operationId: intent.id,
        surface: 'extension',
        ...(intent.context ? { context: intent.context } : {}),
        ...(intent.sourceUrl ? { sourceUrl: intent.sourceUrl } : {}),
        ...(intent.pageTitle ? { pageTitle: intent.pageTitle } : {}),
        capturedAt: new Date(intent.createdAt).toISOString(),
        ...(requestedDeck ? {
          requestedDeck,
          requestedDeckAvailable: (deck: string) => options.customDecks.includes(deck),
        } : {}),
      }).then(result => {
        if (!isCurrent()) return;
        if (result.status === 'busy') {
          if (activeIntentKey === key) activeIntentKey = null;
          clearRetry();
          retryTimer = globalThis.setTimeout(() => {
            retryTimer = null;
            if (isCurrent()) processPending();
          }, 250);
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
            message: captureFailureMessage(result.error),
          });
        }
      }).catch(error => {
        if (!isCurrent()) return;
        finishIntent(intent);
        publishSilentResult(intent, {
          status: 'error',
          message: captureFailureMessage(error),
        });
        if (intent.mode !== 'silent') {
          options.reportError(captureFailureMessage(error));
        }
      });
    };

    const ensureCaptureCourse = options.ensureCaptureCourse;
    if (!ensureCaptureCourse) {
      runGeneration();
      return;
    }
    void ensureCaptureCourse(intent.sourceLanguage ?? 'en').then(decision => {
      if (!isCurrent()) return;
      if (decision === 'cancel') {
        // No half-done side effects: nothing was generated, the pending
        // storage entry is dropped so a reload can't resurrect it, and the
        // extension gets a clean, terminal result instead of hanging.
        clearPendingBrowserExtensionImport(browser.getSessionStorage(), intent.id, intent.nonce);
        finishIntent(intent);
        publishSilentResult(intent, {
          status: 'error',
          message: 'Import cancelled: switch to a matching course, then capture the word again.',
        });
        return;
      }
      runGeneration();
    }).catch(() => {
      if (!isCurrent()) return;
      clearPendingBrowserExtensionImport(browser.getSessionStorage(), intent.id, intent.nonce);
      finishIntent(intent);
      publishSilentResult(intent, {
        status: 'error',
        message: 'Could not prepare the matching course. The word was not saved.',
      });
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
    if (intent?.mode === 'silent') {
      if (isBackedByVerifiedStorage(intent)) claimVerifiedIntent(intent);
      else publishTerminalError(intent, 'Could not securely verify this import. Capture the word again.');
    }
  });
  capturePending();

  return {
    update(nextOptions) {
      const priorOwnerId = options.ownerId;
      options = nextOptions;
      if (pendingIntent && pendingOwnerId && nextOptions.ownerId && pendingOwnerId !== nextOptions.ownerId) {
        invalidatePendingIntent(true);
        return;
      }
      if (pendingIntent && !pendingOwnerId && !priorOwnerId && nextOptions.ownerId) {
        pendingOwnerId = nextOptions.ownerId;
      }
      processPending();
    },
    acceptVerifiedIntent(intent) {
      if (isBackedByVerifiedStorage(intent)) claimVerifiedIntent(intent);
      else publishTerminalError(intent, 'Could not securely verify this import. Capture the word again.');
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
      clearRetry();
    },
  };
};
