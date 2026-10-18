import { useEffect, useRef } from 'react';
import {
  BROWSER_EXTENSION_IMPORT_BRIDGE_SOURCE,
  isBrowserExtensionImportTopFrame,
} from '../browserExtension/browserExtensionImport';
import {
  createOpaqueExtensionDueCountScope,
  EXTENSION_DUE_COUNT_CLEAR_MESSAGE,
  EXTENSION_DUE_COUNT_MESSAGE,
  normalizeExtensionDueCount,
  postExtensionDueCountMessage,
  type ExtensionDueCountScope,
} from './extensionDueCountBridge';

const EXTENSION_PROVIDER_READY_MESSAGE = 'LINGOFLASH_EXTENSION_PROVIDER_READY';

export interface ExtensionDueCountBridgeOptions {
  // The signed-in owner. Anything falsy (signed out) posts a clear for the
  // previous scope, if one existed, and never posts a count.
  readonly ownerId: string | null;
  // Gate on the same "this owner's library data is confirmed loaded" signal
  // the app already uses for its other extension bridge (deck metadata), so
  // a due count is never posted before the app itself trusts its own state
  // for this owner.
  readonly ready: boolean;
  // Real due-card count already computed by the app; this hook never reads
  // Firestore itself.
  readonly dueCount: number;
}

/**
 * Publishes the signed-in owner's real due-card count to the browser
 * extension via window.postMessage, following the exact scope/clear contract
 * extensions/lingoflash/app-bridge.js and background-core.js already expect
 * for LINGOFLASH_EXTENSION_DUE_COUNT(_CLEAR). On sign-out or account switch
 * the previous owner's scope is cleared before any new scope is created, so
 * the extension can never resurface a previous owner's number.
 */
export function useExtensionDueCountBridge({ ownerId, ready, dueCount }: ExtensionDueCountBridgeOptions): void {
  const scopeRef = useRef<ExtensionDueCountScope | null>(null);
  const optionsRef = useRef({ ownerId, ready, dueCount });
  optionsRef.current = { ownerId, ready, dueCount };

  const publishCurrentScope = (): void => {
    if (!isBrowserExtensionImportTopFrame()) return;
    const current = optionsRef.current;
    const previous = scopeRef.current;
    if (previous && (previous.ownerId !== current.ownerId || !current.ready)) {
      postExtensionDueCountMessage(EXTENSION_DUE_COUNT_CLEAR_MESSAGE, { scope: previous.scope });
      scopeRef.current = null;
    }
    if (!current.ownerId || !current.ready) return;
    if (!scopeRef.current) {
      scopeRef.current = { ownerId: current.ownerId, scope: createOpaqueExtensionDueCountScope() };
    }
    const normalized = normalizeExtensionDueCount(current.dueCount);
    if (normalized === null) return;
    postExtensionDueCountMessage(EXTENSION_DUE_COUNT_MESSAGE, {
      scope: scopeRef.current.scope,
      count: normalized,
    });
  };

  useEffect(() => {
    publishCurrentScope();
  }, [dueCount, ownerId, ready]);

  useEffect(() => {
    if (!isBrowserExtensionImportTopFrame()) return;
    const handleBridgeMessage = (event: MessageEvent): void => {
      if (event.source !== (globalThis as unknown as Window)
        || event.origin !== globalThis.location?.origin) return;
      const message = event.data;
      if (!message || typeof message !== 'object' || Array.isArray(message)
        || message.source !== BROWSER_EXTENSION_IMPORT_BRIDGE_SOURCE
        || message.type !== EXTENSION_PROVIDER_READY_MESSAGE) return;
      publishCurrentScope();
    };
    globalThis.addEventListener?.('message', handleBridgeMessage);
    return () => {
      globalThis.removeEventListener?.('message', handleBridgeMessage);
      const previous = scopeRef.current;
      if (!previous) return;
      scopeRef.current = null;
      postExtensionDueCountMessage(EXTENSION_DUE_COUNT_CLEAR_MESSAGE, { scope: previous.scope });
    };
  }, []);
}
