import type { CardIntakeActions } from '../intake/useCardIntake';
import {
  captureBrowserExtensionImport,
  clearPendingBrowserExtensionImport,
  getBrowserExtensionImportBrowser,
  readPendingBrowserExtensionImport,
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
  dispose(): void;
}

export const startBrowserExtensionImportRuntime = (
  initialOptions: BrowserExtensionImportOptions,
): BrowserExtensionImportRuntime => {
  const browser = getBrowserExtensionImportBrowser();
  let options = initialOptions;
  let pendingIntent: BrowserExtensionImportIntent | null = null;
  let preparedIntentId: string | null = null;
  let activeIntentId: string | null = null;
  let signedOutNoticeId: string | null = null;
  let retryTimer: ReturnType<typeof globalThis.setTimeout> | null = null;
  let disposed = false;

  const processPending = () => {
    if (disposed || !pendingIntent) return;
    const intent = pendingIntent;

    if (preparedIntentId !== intent.id) {
      preparedIntentId = intent.id;
      options.openLibrary();
      options.changeDraft(intent.text);
    }

    if (options.identityLoading) return;
    if (!options.ownerId) {
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

      if (pendingIntent?.id === intent.id) pendingIntent = null;
      activeIntentId = null;
      if (result.status === 'created') {
        options.notify(`Added “${intent.text}” to your LingoFlash library.`);
      } else if (result.status === 'existing') {
        options.notify(`“${intent.text}” is already in your LingoFlash library.`);
      } else if (result.status === 'invalid') {
        options.reportError('The selected text could not be added. Select an English word or short phrase.');
      }
      // A failed generation already leaves the draft in place and publishes its own actionable error.
    }).catch(error => {
      if (disposed) return;
      activeIntentId = null;
      if (pendingIntent?.id === intent.id) pendingIntent = null;
      options.reportError(error instanceof Error
        ? error.message
        : 'The selected text could not be added to LingoFlash.');
    });
  };

  const capture = () => {
    const captured = captureBrowserExtensionImport(browser);
    const pending = captured ?? readPendingBrowserExtensionImport(browser.getSessionStorage());
    if (!pending) return;
    pendingIntent = pending;
    processPending();
  };

  const stopHashListener = browser.listenHashChange(capture);
  capture();

  return {
    update(nextOptions) {
      options = nextOptions;
      processPending();
    },
    dispose() {
      disposed = true;
      stopHashListener();
      if (retryTimer !== null) globalThis.clearTimeout(retryTimer);
    },
  };
};
