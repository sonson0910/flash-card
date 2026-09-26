import { useEffect, useRef } from 'react';
import { isBrowserExtensionImportTopFrame } from '../browserExtension/browserExtensionImport';
import {
  createOpaqueExtensionDueCountScope,
  EXTENSION_DUE_COUNT_CLEAR_MESSAGE,
  EXTENSION_DUE_COUNT_MESSAGE,
  normalizeExtensionDueCount,
  postExtensionDueCountMessage,
  type ExtensionDueCountScope,
} from './extensionDueCountBridge';

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

  useEffect(() => {
    if (!isBrowserExtensionImportTopFrame()) return;
    const previous = scopeRef.current;
    if (previous && previous.ownerId !== ownerId) {
      postExtensionDueCountMessage(EXTENSION_DUE_COUNT_CLEAR_MESSAGE, { scope: previous.scope });
      scopeRef.current = null;
    }
    if (!ownerId) return;
    if (!scopeRef.current) {
      scopeRef.current = { ownerId, scope: createOpaqueExtensionDueCountScope() };
    }
    if (!ready) return;
    const normalized = normalizeExtensionDueCount(dueCount);
    if (normalized === null) return;
    postExtensionDueCountMessage(EXTENSION_DUE_COUNT_MESSAGE, {
      scope: scopeRef.current.scope,
      count: normalized,
    });
  }, [dueCount, ownerId, ready]);
}
