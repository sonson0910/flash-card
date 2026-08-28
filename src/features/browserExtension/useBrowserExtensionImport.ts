import { useEffect, useRef } from 'react';
import {
  BROWSER_EXTENSION_IMPORT_BRIDGE_SOURCE,
  BROWSER_EXTENSION_IMPORT_READY_MESSAGE,
  BROWSER_EXTENSION_IMPORT_UNVERIFIED_STORAGE_KEY,
  BROWSER_EXTENSION_IMPORT_UNVERIFIED_MESSAGE,
  isBrowserExtensionImportTopFrame,
  parseBrowserExtensionImportValue,
  readPendingBrowserExtensionImport,
  type BrowserExtensionImportIntent,
} from './browserExtensionImport';
import type { BrowserExtensionImportRuntime } from './browserExtensionImportRuntime';
import type { BrowserExtensionImportOptions } from './browserExtensionImportRuntime';

const DECK_METADATA_MESSAGE = 'LINGOFLASH_EXTENSION_DECK_METADATA';
const DECK_METADATA_CLEAR_MESSAGE = 'LINGOFLASH_EXTENSION_DECK_METADATA_CLEAR';
const MAX_DECKS = 100;
const MAX_DECK_NAME_LENGTH = 128;

const hasVerifiedPendingImport = (): boolean => {
  try {
    return readPendingBrowserExtensionImport(globalThis.sessionStorage ?? null)?.mode === 'silent';
  } catch {
    return false;
  }
};

const readPendingUnverifiedDraft = (): BrowserExtensionImportIntent | null => {
  try {
    const raw = globalThis.sessionStorage?.getItem(BROWSER_EXTENSION_IMPORT_UNVERIFIED_STORAGE_KEY);
    if (!raw) return null;
    const intent = parseBrowserExtensionImportValue(JSON.parse(raw));
    if (!intent) globalThis.sessionStorage?.removeItem(BROWSER_EXTENSION_IMPORT_UNVERIFIED_STORAGE_KEY);
    return intent;
  } catch {
    return null;
  }
};

const createOpaqueDeckScope = (): string => {
  try {
    if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  } catch { /* Fall through to the non-identity fallback. */ }
  return `scope_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 18)}`;
};

const normalizeDecksForExtension = (value: readonly string[]): string[] => {
  const seen = new Set<string>();
  for (const entry of value) {
    const deck = entry.replace(/\s+/g, ' ').trim().slice(0, MAX_DECK_NAME_LENGTH);
    if (!deck || seen.has(deck)) continue;
    seen.add(deck);
    if (seen.size >= MAX_DECKS) break;
  }
  return [...seen];
};

const postDeckMetadata = (type: string, payload: unknown): void => {
  try {
    globalThis.postMessage?.({ source: 'lingoflash-web-app', type, payload }, globalThis.location?.origin || '*');
  } catch { /* The optional bridge may race navigation. */ }
};

export function useBrowserExtensionImport(options: BrowserExtensionImportOptions): void {
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const runtimeRef = useRef<BrowserExtensionImportRuntime | null>(null);
  const deckScopeRef = useRef<{ ownerId: string; scope: string } | null>(null);

  useEffect(() => {
    if (!isBrowserExtensionImportTopFrame()) return;
    const previous = deckScopeRef.current;
    if (previous && previous.ownerId !== options.ownerId) {
      postDeckMetadata(DECK_METADATA_CLEAR_MESSAGE, { scope: previous.scope });
      deckScopeRef.current = null;
    }
    if (!options.ownerId) return;
    if (!deckScopeRef.current) {
      deckScopeRef.current = { ownerId: options.ownerId, scope: createOpaqueDeckScope() };
    }
    if (!options.libraryReady) return;
    postDeckMetadata(DECK_METADATA_MESSAGE, {
      scope: deckScopeRef.current.scope,
      decks: normalizeDecksForExtension(options.customDecks),
    });
  }, [options.customDecks, options.libraryReady, options.ownerId]);

  useEffect(() => {
    runtimeRef.current?.update(options);
  });

  useEffect(() => {
    if (!isBrowserExtensionImportTopFrame()) return undefined;
    let disposed = false;
    let loading = false;
    let verifiedIntent: BrowserExtensionImportIntent | null = null;

    const applyUnverifiedDraft = (intent: BrowserExtensionImportIntent) => {
      optionsRef.current.openLibrary();
      optionsRef.current.changeDraft(intent.text);
      try { globalThis.sessionStorage?.removeItem(BROWSER_EXTENSION_IMPORT_UNVERIFIED_STORAGE_KEY); } catch { /* Storage is optional. */ }
    };

    const startWhenNeeded = () => {
      if (loading || runtimeRef.current || (!verifiedIntent && !hasVerifiedPendingImport())) return;
      loading = true;
      void import('./browserExtensionImportRuntime').then(module => {
        if (disposed) return;
        runtimeRef.current = module.startBrowserExtensionImportRuntime(optionsRef.current);
        if (verifiedIntent) runtimeRef.current.acceptVerifiedIntent(verifiedIntent);
      }).catch(() => {
        loading = false;
      });
    };

    const handleBridgeMessage = (event: MessageEvent) => {
      if (event.source !== (globalThis as unknown as MessageEventSource)
        || event.origin !== globalThis.location?.origin) return;
      const message = event.data;
      if (!message || typeof message !== 'object' || Array.isArray(message)) return;
      if (message.source !== BROWSER_EXTENSION_IMPORT_BRIDGE_SOURCE) return;
      if (message.type === BROWSER_EXTENSION_IMPORT_UNVERIFIED_MESSAGE) {
        const intent = parseBrowserExtensionImportValue(message.payload);
        if (!intent) return;
        applyUnverifiedDraft(intent);
        return;
      }
      if (message.type !== BROWSER_EXTENSION_IMPORT_READY_MESSAGE) return;
      const intent = parseBrowserExtensionImportValue(message.payload);
      if (!intent || intent.mode !== 'silent') return;
      verifiedIntent = intent;
      runtimeRef.current?.acceptVerifiedIntent(intent);
      startWhenNeeded();
    };

    globalThis.addEventListener?.('message', handleBridgeMessage);
    const pendingUnverifiedDraft = readPendingUnverifiedDraft();
    if (pendingUnverifiedDraft) applyUnverifiedDraft(pendingUnverifiedDraft);
    startWhenNeeded();
    return () => {
      disposed = true;
      globalThis.removeEventListener?.('message', handleBridgeMessage);
      runtimeRef.current?.dispose();
      runtimeRef.current = null;
    };
  }, []);
}
