import type { Firestore } from 'firebase/firestore';
import { app as firebaseApp, isFirebaseConfigured, protectedFunctionsCapability } from './firebase';
import { ProtectedFunctionError, runProtectedFunction } from './protectedFunctionsCapability';

/**
 * Fields the bulk-mutation callable accepts. This intentionally mirrors the
 * server allowlist in `functions/src/bulkCardMutationPersistence.ts`: only
 * the fields real multi-card UI actions mutate today. Any other field patch
 * still goes through the single-card path.
 */
export type BulkPatchableField = 'customDeck' | 'bookmarked';

export type BulkCardPatchCommand = {
  cardId: string;
  baseRevision: number;
  fields: { customDeck?: string | null; bookmarked?: boolean };
  fieldMask: readonly BulkPatchableField[];
};

export type BulkCardDeleteCommand = {
  cardId: string;
  baseRevision: number;
  opId: string;
};

export type BulkMutationConflictReason =
  | 'missing'
  | 'requires-migration'
  | 'stale-library-epoch'
  | 'future-library-epoch'
  | 'revision-conflict';

export type BulkCardMutationItemResult =
  | { cardId: string; op: 'patch'; applied: true; revision: number }
  | { cardId: string; op: 'patch'; applied: false; reason: BulkMutationConflictReason; currentRevision?: number }
  | { cardId: string; op: 'delete'; applied: true; revision: number; deletedAt: string }
  | { cardId: string; op: 'delete'; applied: false; reason: 'revision-conflict'; currentRevision: number };

// Extends ProtectedFunctionError (not plain Error) so `runProtectedFunction`'s
// catch-all classifier passes it through unchanged instead of collapsing it
// into a generic "failed safely" message; mirrors ProtectedCardMutationError
// in cardRepository.ts, the existing pattern for a typed precondition that
// must survive the protected-call error pipeline.
export class BulkMutationEpochConflictError extends ProtectedFunctionError {
  constructor(public readonly reason: 'stale-library-epoch' | 'future-library-epoch') {
    super({
      message: `Bulk card mutation rejected: ${reason}.`,
      kind: 'configuration',
      code: 'failed-precondition',
      retryable: false,
      reason,
    });
    this.name = 'BulkMutationEpochConflictError';
  }
}

const isConflictReason = (value: unknown): value is BulkMutationConflictReason =>
  typeof value === 'string'
  && ['missing', 'requires-migration', 'stale-library-epoch', 'future-library-epoch', 'revision-conflict'].includes(value);

const parseItemResult = (value: unknown): BulkCardMutationItemResult => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('The protected bulk mutation service returned an invalid result.');
  }
  const source = value as Record<string, unknown>;
  if (typeof source.cardId !== 'string' || !source.cardId) {
    throw new Error('The protected bulk mutation service returned an invalid result.');
  }
  if (source.op !== 'patch' && source.op !== 'delete') {
    throw new Error('The protected bulk mutation service returned an invalid result.');
  }
  if (source.applied === true) {
    if (!Number.isSafeInteger(source.revision) || Number(source.revision) < 0) {
      throw new Error('The protected bulk mutation service returned an invalid result.');
    }
    if (source.op === 'delete' && typeof source.deletedAt !== 'string') {
      throw new Error('The protected bulk mutation service returned an invalid result.');
    }
    return source.op === 'delete'
      ? { cardId: source.cardId, op: 'delete', applied: true, revision: Number(source.revision), deletedAt: source.deletedAt as string }
      : { cardId: source.cardId, op: 'patch', applied: true, revision: Number(source.revision) };
  }
  if (source.applied !== false || !isConflictReason(source.reason)) {
    throw new Error('The protected bulk mutation service returned an invalid result.');
  }
  if (source.op === 'delete') {
    if (source.reason !== 'revision-conflict' || !Number.isSafeInteger(source.currentRevision)) {
      throw new Error('The protected bulk mutation service returned an invalid result.');
    }
    return { cardId: source.cardId, op: 'delete', applied: false, reason: 'revision-conflict', currentRevision: Number(source.currentRevision) };
  }
  return {
    cardId: source.cardId,
    op: 'patch',
    applied: false,
    reason: source.reason,
    ...(source.currentRevision === undefined ? {} : { currentRevision: Number(source.currentRevision) }),
  };
};

const readEpochConflict = (error: unknown): BulkMutationEpochConflictError | null => {
  if (!error || typeof error !== 'object') return null;
  const source = error as Record<string, unknown>;
  const code = typeof source.code === 'string'
    ? source.code.trim().toLowerCase().replace(/^firebase\//, '').replace(/^functions\//, '')
    : '';
  if (code !== 'failed-precondition' || !source.details || typeof source.details !== 'object') return null;
  const reason = (source.details as Record<string, unknown>).reason;
  return reason === 'stale-library-epoch' || reason === 'future-library-epoch'
    ? new BulkMutationEpochConflictError(reason)
    : null;
};

export async function bulkMutateCardsViaCallable(
  database: Firestore,
  userId: string,
  libraryEpoch: number,
  patches: readonly BulkCardPatchCommand[],
  deletes: readonly BulkCardDeleteCommand[] = [],
): Promise<BulkCardMutationItemResult[]> {
  void database;
  void userId;
  if (!isFirebaseConfigured || !firebaseApp) {
    throw new ProtectedFunctionError({
      message: 'Bulk card update is unavailable because protected cloud features are not configured for this build.',
      kind: 'configuration',
      code: 'firebase-unconfigured',
      retryable: false,
    });
  }
  return runProtectedFunction(protectedFunctionsCapability, 'Bulk card update', async () => {
    const { getFunctions, httpsCallable } = await import('firebase/functions');
    const app = firebaseApp;
    if (!app) throw new Error('Firebase is not initialized.');
    const callable = httpsCallable<
      { libraryEpoch: number; patches: BulkCardPatchCommand[]; deletes: BulkCardDeleteCommand[] },
      unknown
    >(getFunctions(app, 'asia-southeast1'), 'bulkMutateCards');
    try {
      const response = await callable({
        libraryEpoch,
        patches: patches.map(patch => ({ ...patch, fieldMask: [...patch.fieldMask] })),
        deletes: [...deletes],
      });
      const value = response.data;
      if (!value || typeof value !== 'object' || Array.isArray(value) || !Array.isArray((value as Record<string, unknown>).results)) {
        throw new Error('Invalid bulk mutation response.');
      }
      return (value as { results: unknown[] }).results.map(parseItemResult);
    } catch (error) {
      const epochConflict = readEpochConflict(error);
      if (epochConflict) throw epochConflict;
      throw error;
    }
  });
}
