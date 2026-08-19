import { useEffect, useRef, useState } from 'react';
import type { CardIntakeActions } from '../intake/useCardIntake';
import {
  captureBrowserExtensionImport,
  clearPendingBrowserExtensionImport,
  getBrowserExtensionImportBrowser,
  readPendingBrowserExtensionImport,
  type BrowserExtensionImportIntent,
} from './browserExtensionImport';

interface UseBrowserExtensionImportOptions {
  ownerId: string | null;
  identityLoading: boolean;
  isBusy: boolean;
  changeDraft: CardIntakeActions['changeDraft'];
  generate: CardIntakeActions['generate'];
  openLibrary(): void;
  notify(message: string): void;
  reportError(message: string): void;
}

export function useBrowserExtensionImport(options: UseBrowserExtensionImportOptions): void {
  const browser = getBrowserExtensionImportBrowser();
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const [pendingIntent, setPendingIntent] = useState<BrowserExtensionImportIntent | null>(null);
  const preparedIntentIdRef = useRef<string | null>(null);
  const activeIntentIdRef = useRef<string | null>(null);
  const signedOutNoticeIdRef = useRef<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const capture = () => {
      const captured = captureBrowserExtensionImport(browser);
      const pending = captured ?? readPendingBrowserExtensionImport(browser.getSessionStorage());
      if (pending) setPendingIntent(pending);
    };
    capture();
    return browser.listenHashChange(capture);
  }, [browser]);

  useEffect(() => {
    if (!pendingIntent) return;
    const current = optionsRef.current;

    if (preparedIntentIdRef.current !== pendingIntent.id) {
      preparedIntentIdRef.current = pendingIntent.id;
      current.openLibrary();
      current.changeDraft(pendingIntent.text);
    }

    if (current.identityLoading) return;
    if (!current.ownerId) {
      if (signedOutNoticeIdRef.current !== pendingIntent.id) {
        signedOutNoticeIdRef.current = pendingIntent.id;
        current.notify('Sign in to LingoFlash to translate and save the selected word.');
      }
      return;
    }
    if (current.isBusy || activeIntentIdRef.current === pendingIntent.id) return;

    const operationIntent = pendingIntent;
    activeIntentIdRef.current = operationIntent.id;
    clearPendingBrowserExtensionImport(browser.getSessionStorage(), operationIntent.id);

    void current.generate().then(result => {
      if (!mountedRef.current) return;
      if (result.status === 'busy') {
        activeIntentIdRef.current = null;
        globalThis.setTimeout(() => {
          if (mountedRef.current) setPendingIntent({ ...operationIntent });
        }, 250);
        return;
      }

      setPendingIntent(previous => previous?.id === operationIntent.id ? null : previous);
      activeIntentIdRef.current = null;
      if (result.status === 'created') {
        current.notify(`Added “${operationIntent.text}” to your LingoFlash library.`);
      } else if (result.status === 'existing') {
        current.notify(`“${operationIntent.text}” is already in your LingoFlash library.`);
      } else if (result.status === 'invalid') {
        current.reportError('The selected text could not be added. Select an English word or short phrase.');
      }
      // A failed generation already leaves the draft in place and publishes its own actionable error.
    }).catch(error => {
      if (!mountedRef.current) return;
      activeIntentIdRef.current = null;
      setPendingIntent(previous => previous?.id === operationIntent.id ? null : previous);
      current.reportError(error instanceof Error
        ? error.message
        : 'The selected text could not be added to LingoFlash.');
    });
  }, [browser, pendingIntent, options.ownerId, options.identityLoading, options.isBusy]);
}
