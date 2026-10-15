import { useEffect, useRef } from 'react';
import {
  BROWSER_EXTENSION_IMPORT_BRIDGE_SOURCE,
  BROWSER_EXTENSION_IMPORT_READY_MESSAGE,
  BROWSER_EXTENSION_IMPORT_UNVERIFIED_STORAGE_KEY,
  BROWSER_EXTENSION_IMPORT_UNVERIFIED_MESSAGE,
  clearPendingBrowserExtensionImport,
  isBrowserExtensionImportTopFrame,
  parseBrowserExtensionImportValue,
  readPendingBrowserExtensionImport,
  readPendingBrowserExtensionImportOwner,
  type BrowserExtensionImportIntent,
  writePendingBrowserExtensionImportOwner,
} from './browserExtensionImport';
import type { BrowserExtensionImportRuntime } from './browserExtensionImportRuntime';
import type { BrowserExtensionImportOptions } from './browserExtensionImportRuntime';

const DECK_METADATA_MESSAGE = 'LINGOFLASH_EXTENSION_DECK_METADATA';
const DECK_METADATA_CLEAR_MESSAGE = 'LINGOFLASH_EXTENSION_DECK_METADATA_CLEAR';
// Follows the exact same app -> bridge -> background relay as deck metadata
// (07.5, extensions/lingoflash/app-bridge.js + background-core.js). Reuses
// the same per-owner scope deck metadata already mints below: it is just a
// correlation id for "this owner's current app-bridge sync", not a security
// boundary by itself — the background's own origin check is.
const COURSE_LOCALE_MESSAGE = 'LINGOFLASH_EXTENSION_COURSE_LOCALE';
const COURSE_LOCALE_CLEAR_MESSAGE = 'LINGOFLASH_EXTENSION_COURSE_LOCALE_CLEAR';
const EXTENSION_RESULT_TYPE = 'LINGOFLASH_EXTENSION_RESULT';
const EXTENSION_PROVIDER_READY_MESSAGE = 'LINGOFLASH_EXTENSION_PROVIDER_READY';
const MAX_DECKS = 100;
const MAX_DECK_NAME_LENGTH = 128;

const hasVerifiedPendingImport = (): boolean => {
  try {
    return readPendingBrowserExtensionImport(globalThis.sessionStorage ?? null)?.mode === 'silent';
  } catch {
    return false;
  }
};

const verifiedIntentKey = (intent: BrowserExtensionImportIntent): string =>
  `${intent.id}:${intent.nonce ?? ''}`;

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

// A generic app -> extension-bridge postMessage, shared by deck metadata and
// course locale sync (07.5): both follow the exact same envelope shape and
// same-origin relay through extensions/lingoflash/app-bridge.js.
const postExtensionBridgeMessage = (type: string, payload: unknown): void => {
  try {
    globalThis.postMessage?.({ source: 'lingoflash-web-app', type, payload }, globalThis.location?.origin || '*');
  } catch { /* The optional bridge may race navigation. */ }
};

const rejectVerifiedImport = (intent: BrowserExtensionImportIntent, message: string): void => {
  clearPendingBrowserExtensionImport(globalThis.sessionStorage ?? null, intent.id, intent.nonce);
  postExtensionBridgeMessage(EXTENSION_RESULT_TYPE, {
    v: 1,
    id: intent.id,
    nonce: intent.nonce,
    status: 'error',
    word: intent.text,
    translation: '',
    phonetic: '',
    explanation: '',
    exampleSentence: '',
    exampleTranslation: '',
    aiGenerated: false,
    message,
  });
};

export function useBrowserExtensionImport(options: BrowserExtensionImportOptions): void {
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const runtimeRef = useRef<BrowserExtensionImportRuntime | null>(null);
  const pendingOwnerRef = useRef<{ key: string; ownerId: string | null; invalidated: boolean } | null>(null);
  const deckScopeRef = useRef<{ ownerId: string; scope: string } | null>(null);
  const courseLocaleScopeRef = useRef<string | null>(null);

  const publishCurrentMetadata = (): void => {
    if (!isBrowserExtensionImportTopFrame()) return;
    const current = optionsRef.current;
    const previous = deckScopeRef.current;
    if (previous && (previous.ownerId !== current.ownerId || !current.libraryReady)) {
      postExtensionBridgeMessage(DECK_METADATA_CLEAR_MESSAGE, { scope: previous.scope });
      postExtensionBridgeMessage(COURSE_LOCALE_CLEAR_MESSAGE, { scope: previous.scope });
      deckScopeRef.current = null;
      courseLocaleScopeRef.current = null;
    }
    if (!current.ownerId) return;
    if ((!current.courseNativeLanguage || !current.courseTargetLanguage)
      && deckScopeRef.current?.scope === courseLocaleScopeRef.current) {
      postExtensionBridgeMessage(DECK_METADATA_CLEAR_MESSAGE, { scope: deckScopeRef.current.scope });
      postExtensionBridgeMessage(COURSE_LOCALE_CLEAR_MESSAGE, { scope: deckScopeRef.current.scope });
      deckScopeRef.current = null;
      courseLocaleScopeRef.current = null;
    }
    if (!deckScopeRef.current) {
      deckScopeRef.current = { ownerId: current.ownerId, scope: createOpaqueDeckScope() };
    }
    postExtensionBridgeMessage(DECK_METADATA_MESSAGE, {
      scope: deckScopeRef.current.scope,
      ...(current.libraryReady ? { decks: normalizeDecksForExtension(current.customDecks) } : {}),
    });
    if (current.courseNativeLanguage && current.courseTargetLanguage) {
      postExtensionBridgeMessage(COURSE_LOCALE_MESSAGE, {
        scope: deckScopeRef.current.scope,
        nativeLanguage: current.courseNativeLanguage,
        targetLanguage: current.courseTargetLanguage,
      });
      courseLocaleScopeRef.current = deckScopeRef.current.scope;
    }
  };

  const reconcilePendingOwner = (): boolean => {
    let intent: BrowserExtensionImportIntent | null = null;
    try {
      const pending = readPendingBrowserExtensionImport(globalThis.sessionStorage ?? null);
      if (pending?.mode === 'silent') intent = pending;
    } catch { /* Storage is optional. */ }
    let binding = pendingOwnerRef.current;
    if (intent) {
      const key = verifiedIntentKey(intent);
      const storedOwnerId = readPendingBrowserExtensionImportOwner(globalThis.sessionStorage ?? null, intent);
      if (!binding || binding.key !== key) {
        binding = { key, ownerId: storedOwnerId ?? optionsRef.current.ownerId, invalidated: false };
        pendingOwnerRef.current = binding;
      }
      const ownerId = optionsRef.current.ownerId;
      if (storedOwnerId && ownerId && storedOwnerId !== ownerId) {
        if (!runtimeRef.current) {
          rejectVerifiedImport(intent, 'Import cancelled because the signed-in account changed. Capture the word again.');
        }
        binding.invalidated = true;
        return false;
      }
    }
    if (!binding || binding.invalidated) return !binding;
    const ownerId = optionsRef.current.ownerId;
    if (!binding.ownerId && ownerId) binding.ownerId = ownerId;
    if (intent && binding.ownerId
      && !readPendingBrowserExtensionImportOwner(globalThis.sessionStorage ?? null, intent)) {
      if (!writePendingBrowserExtensionImportOwner(globalThis.sessionStorage ?? null, intent, binding.ownerId)) {
        if (!runtimeRef.current) {
          rejectVerifiedImport(intent, 'Could not securely prepare this import. Capture the word again.');
        }
        binding.invalidated = true;
        return false;
      }
    }
    if (binding.ownerId && ownerId && binding.ownerId !== ownerId) {
      if (intent && !runtimeRef.current) {
        rejectVerifiedImport(intent, 'Import cancelled because the signed-in account changed. Capture the word again.');
      }
      binding.invalidated = true;
      return false;
    }
    return true;
  };

  useEffect(() => {
    publishCurrentMetadata();
  }, [
    options.courseNativeLanguage,
    options.courseTargetLanguage,
    options.customDecks,
    options.libraryReady,
    options.ownerId,
  ]);

  useEffect(() => {
    if (!isBrowserExtensionImportTopFrame()) return;
    const handleBridgeMessage = (event: MessageEvent): void => {
      if (event.source !== (globalThis as unknown as Window)
        || event.origin !== globalThis.location?.origin) return;
      const message = event.data;
      if (!message || typeof message !== 'object' || Array.isArray(message)
        || message.source !== BROWSER_EXTENSION_IMPORT_BRIDGE_SOURCE
        || message.type !== EXTENSION_PROVIDER_READY_MESSAGE) return;
      publishCurrentMetadata();
    };
    globalThis.addEventListener?.('message', handleBridgeMessage);
    return () => {
      globalThis.removeEventListener?.('message', handleBridgeMessage);
      const previous = deckScopeRef.current;
      if (!previous) return;
      deckScopeRef.current = null;
      courseLocaleScopeRef.current = null;
      postExtensionBridgeMessage(DECK_METADATA_CLEAR_MESSAGE, { scope: previous.scope });
      postExtensionBridgeMessage(COURSE_LOCALE_CLEAR_MESSAGE, { scope: previous.scope });
    };
  }, []);

  useEffect(() => {
    reconcilePendingOwner();
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
      if (!reconcilePendingOwner()) return;
      loading = true;
      void import('./browserExtensionImportRuntime').then(module => {
        if (disposed || !reconcilePendingOwner()) {
          loading = false;
          return;
        }
        runtimeRef.current = module.startBrowserExtensionImportRuntime(optionsRef.current);
        if (verifiedIntent && reconcilePendingOwner()) runtimeRef.current.acceptVerifiedIntent(verifiedIntent);
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
      if (!reconcilePendingOwner()) return;
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
