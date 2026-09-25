import {
  beginCardMirrorSync,
  deleteMirroredCardForGeneration,
  deleteMirroredCardIfOlderThan,
  deleteMirroredCardIfNotNewerThan,
  finishCardMirrorSync,
  getCardMirrorStatus,
  invalidateCardMirrorGeneration,
  isCardMirrorFresh,
  patchMirroredCardBatch,
  upsertMirroredCardBatch,
  upsertMirroredCardIfNotOlderThan,
} from '../../lib/cardMirror';
import { withTimeout } from '../../lib/async';
import { REVIEW_XP } from '../../lib/review-xp';
import { applyCardPatchWithConflictRecovery, deleteCardWithConflictRecovery } from '../../lib/cardConflictRecovery';
import { applyReviewViaCallable, applyReviewWithConflictRecovery } from '../../lib/cardReviewRepository';
import {
  applySuccessfulPatchMetadata,
  partitionPendingOperationsByLibraryEpoch,
  partitionPendingOperationsForFlush,
  verifyPendingCardOperations,
} from '../../lib/cardCreation';
import { selectMutableCardPatch } from '../../lib/cardMutationProtocol';
import {
  acknowledgeDevicePending,
  deleteDeviceCardBackupIfNotNewerThan,
  DeviceBackupOwnerConflictError,
  loadDevicePending,
  mergeDeviceCardsStrict,
  mergePendingOperations,
  queueDeviceDeletes,
  queueDevicePatches,
  queueDeviceUpserts,
  withDevicePendingFlush,
  type DeviceDeleteContext,
  type DevicePendingOperation,
  type DeviceReviewEffect,
  type DeviceUpsertContext,
} from '../../lib/deviceSync';
import {
  applyCardPatchIfCurrent,
  CardMutationPreconditionError,
  createCardIfAbsent,
  deleteCardWithTombstone,
  findCardById,
  findCardByNormalizedWord,
  getLibraryEpoch,
  streamAllCardsInBatches,
} from '../../lib/cardRepository';
import type { CardData } from '../../types/card';
import { db, isFirebaseConfigured } from '../../lib/firebase';
import {
  ProtectedFunctionError,
  getProtectedFunctionUserMessage,
} from '../../lib/protectedFunctionsCapability';
import {
  cloudBackoffCacheKey,
  isCloudBackoffActive,
  isQuotaError,
  normalizeCardForStorage,
  normalizeLocalCards,
  removeLocalValue,
  writeLocalValue,
} from '../library/libraryStorage';
import { shouldResetLibraryPageAfterSync } from '../library/libraryPresentation';
import {
  canAttemptCloudSync,
  countPendingSyncOperations,
  getSyncErrorMessage,
  resolveSyncEpoch,
  type CloudSyncEpoch,
} from '../sync/syncHealthModel';

const CLOUD_SYNC_STEP_TIMEOUT_MS = 15_000;
const CARD_MIRROR_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1_000;
export const CLOUD_QUOTA_BACKOFF_MS = 5 * 60 * 1_000;
export const CLOUD_TRANSIENT_BACKOFF_MS = 60 * 1_000;
const cloudSyncTimeoutMessage = 'Firebase did not respond in time. Your changes remain safe on this device; retry when the connection is stable.';
const mirrorEpochChangedMessage = 'Cloud library changed while the local mirror was syncing.';
const mirrorInterruptedMessage = 'The local card mirror sync was interrupted.';
const CLOUD_WRITES_PAUSED = Symbol('cloud-writes-paused');
const waitForCloudSyncStep = <T,>(operation: Promise<T>): Promise<T> =>
  withTimeout(operation, CLOUD_SYNC_STEP_TIMEOUT_MS, cloudSyncTimeoutMessage);

export const getCloudBackoffDurationMs = (error: unknown): number =>
  isQuotaError(error) ? CLOUD_QUOTA_BACKOFF_MS : CLOUD_TRANSIENT_BACKOFF_MS;

const pendingOperationCardId = (operation: DevicePendingOperation): string =>
  operation.type === 'upsert' ? operation.card.id : operation.cardId;

const REVIEW_FIELDS = [
  'difficulty', 'nextReviewDate', 'reviews', 'interval', 'easeFactor',
  'fsrs', 'reviewHistory', 'correctStreak',
] as const;

const isValidReviewEntry = (value: unknown): value is NonNullable<CardData['reviewHistory']>[number] => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const entry = value as Record<string, unknown>;
  const keys = Object.keys(entry).sort();
  return keys.length === 4
    && keys.join(',') === 'elapsedDays,rating,reviewedAt,scheduledDays'
    && typeof entry.rating === 'string'
    && ['again', 'hard', 'good', 'easy'].includes(entry.rating)
    && typeof entry.reviewedAt === 'string'
    && Number.isFinite(Date.parse(entry.reviewedAt))
    && typeof entry.scheduledDays === 'number'
    && Number.isFinite(entry.scheduledDays)
    && entry.scheduledDays >= 0
    && typeof entry.elapsedDays === 'number'
    && Number.isFinite(entry.elapsedDays)
    && entry.elapsedDays >= 0;
};

const pendingUpsertCleanupBoundary = (
  operation: Extract<DevicePendingOperation, { type: 'upsert' }>,
  activeEpoch: number,
): { libraryEpoch: number; revision: number } => ({
  libraryEpoch: Number.isSafeInteger(operation.libraryEpoch) && Number(operation.libraryEpoch) >= 0
    ? Number(operation.libraryEpoch)
    : activeEpoch,
  revision: Number.isSafeInteger(operation.baseRevision) && Number(operation.baseRevision) >= 0
    ? Number(operation.baseRevision)
    : Number.isSafeInteger(operation.card.revision) && Number(operation.card.revision) >= 0
      ? Number(operation.card.revision)
      : 0,
});

const reconcilePendingUpsertWithAuthoritativeCard = async (
  userId: string,
  operation: Extract<DevicePendingOperation, { type: 'upsert' }>,
  authoritativeCard: CardData,
  activeEpoch: number,
  lease: import('../../lib/deviceSync').DevicePendingFlushLease,
): Promise<void> => {
  try {
    await lease.assertOwnership();
    await mergeDeviceCardsStrict([authoritativeCard], 1, userId, lease);
  } catch (cause) {
    if (!(cause instanceof DeviceBackupOwnerConflictError)) throw cause;
  }
  await upsertMirroredCardIfNotOlderThan(userId, authoritativeCard);
  if (operation.card.id !== authoritativeCard.id) {
    const maximum = pendingUpsertCleanupBoundary(operation, activeEpoch);
    await lease.assertOwnership();
    await deleteDeviceCardBackupIfNotNewerThan(userId, operation.card.id, maximum, lease);
    await deleteMirroredCardIfNotNewerThan(userId, operation.card.id, maximum);
  }
};

const restoreQueuedReviewFromAuthoritativeCard = async (
  userId: string,
  operation: Extract<DevicePendingOperation, { type: 'patch' }>,
  authoritativeCard: CardData | null,
  events: LibraryReplicaEvents,
  isOwnerCurrent: () => boolean,
  lease: import('../../lib/deviceSync').DevicePendingFlushLease,
): Promise<void> => {
  if (authoritativeCard) {
    try {
      await lease.assertOwnership();
      await mergeDeviceCardsStrict([authoritativeCard], 1, userId, lease);
    } catch (cause) {
      if (!(cause instanceof DeviceBackupOwnerConflictError)) throw cause;
    }
    await upsertMirroredCardIfNotOlderThan(userId, authoritativeCard);
    if (isOwnerCurrent()) {
      const restore = (card: CardData) => card.id === authoritativeCard.id ? authoritativeCard : card;
      events.advanceCard(authoritativeCard.id, restore);
      events.advancePracticeCard(authoritativeCard.id, restore);
    }
    return;
  }
  const maximum = {
    libraryEpoch: operation.libraryEpoch ?? 0,
    revision: operation.baseRevision ?? 0,
  };
  await lease.assertOwnership();
  await deleteDeviceCardBackupIfNotNewerThan(userId, operation.cardId, maximum, lease);
  await deleteMirroredCardIfNotNewerThan(userId, operation.cardId, maximum);
  if (isOwnerCurrent()) {
    events.removeCard(operation.cardId);
    events.removePracticeCard(operation.cardId);
  }
};

export interface LibraryEpoch {
  readonly userId: string;
  readonly value: number;
}

export function publishVerifiedEpochIfOwnerCurrent(
  expectedUserId: string,
  activeUserId: string | null,
  value: number,
  publish: (epoch: LibraryEpoch) => boolean,
): LibraryEpoch | null {
  if (
    activeUserId !== expectedUserId
    || !Number.isSafeInteger(value)
    || value < 0
  ) return null;
  const verified = { userId: expectedUserId, value };
  return publish(verified) ? verified : null;
}

export interface LibraryReplicaEvents {
  advanceCard: (cardId: string, advance: (card: CardData) => CardData) => void;
  removeCard: (cardId: string) => void;
  findPracticeCard: (cardId: string) => CardData | undefined;
  advancePracticeCard: (cardId: string, advance: (card: CardData) => CardData) => void;
  removePracticeCard: (cardId: string) => void;
  resetPage: () => void;
  refreshCloud: () => void;
  setCloudAvailable: (available: boolean) => void;
  setCloudTotal: (total: number) => void;
  reportError: (message: string) => void;
  notify: (message: string) => void;
  settleReview: (opId: string, effect: DeviceReviewEffect) => void;
  verifyEpoch: (epoch: LibraryEpoch) => boolean;
}

export type LibraryReplicaMutation =
  | { type: 'create'; cards: CardData[]; nextTotal?: number }
  | {
      type: 'patch';
      changes: readonly { card: CardData; fields: Partial<CardData> }[];
      nextTotal?: number;
      operationId?: string;
      operation?: 'patch' | 'review';
    }
  | { type: 'delete'; cardId: string; context?: DeviceDeleteContext };

export interface LibraryReplicaOptions {
  ownerId: string;
  isBrowserOnline: () => boolean;
  getEpoch: () => LibraryEpoch | null;
  getCards: () => readonly CardData[];
  getEvents: () => LibraryReplicaEvents;
  getMirrorTotals: () => { cloudTotal: number; cloudStatsTotal: number };
  isOwnerCurrent: () => boolean;
  canVerifyEpoch: () => boolean;
  canPublishMutations: () => boolean;
  onError: (error: string | null) => void;
  onPendingCount: (count: number) => void;
  onSyncing: (syncing: boolean) => void;
}

export interface RestoreDeviceCardOptions {
  ownerId: string | null;
  expectedLibraryEpoch: number;
  operationId: string;
  operationCreatedAt: string;
}

export type RestoreDeviceCardResult =
  | { status: 'restored' | 'queued' | 'existing'; card: CardData }
  | {
    status: 'conflict';
    reason: 'owner-changed' | 'epoch-changed' | 'deleted-again' | 'unsafe-existing';
    card?: CardData;
  };

export interface LibraryReplicaFlushOptions {
  manualRetry?: boolean;
  verifiedEpoch?: CloudSyncEpoch | null;
  isBrowserOnline: boolean;
}

export function createLibraryReplica({
  ownerId,
  isBrowserOnline,
  getEpoch,
  getCards,
  getEvents,
  getMirrorTotals,
  isOwnerCurrent,
  canVerifyEpoch,
  canPublishMutations,
  onError,
  onPendingCount,
  onSyncing,
}: LibraryReplicaOptions) {
  let pendingFlush: Promise<void> | null = null;
  let pendingMirrorRefresh: Promise<number> | null = null;
  const canVerifyCloudEpoch = () => isOwnerCurrent() && canVerifyEpoch();
  const canWriteCloud = () => isOwnerCurrent() && canPublishMutations();

  const readActiveEpoch = () => {
    const epoch = getEpoch();
    return epoch?.userId === ownerId
      ? { value: epoch.value, verified: true }
      : { value: 0, verified: false };
  };

  const refreshPending = async () => {
    try {
      const pending = mergePendingOperations(await loadDevicePending(ownerId));
      const count = countPendingSyncOperations(pending, ownerId);
      if (isOwnerCurrent()) onPendingCount(count);
      return count;
    } catch (cause) {
      if (isOwnerCurrent()) onError(getSyncErrorMessage(cause));
      return 0;
    }
  };

  const acknowledge = async (operations: readonly DevicePendingOperation[], lease?: import('../../lib/deviceSync').DevicePendingFlushLease) => {
    if (lease) await lease.assertOwnership();
    await acknowledgeDevicePending([...operations], lease);
    if (operations.some(operation => operation.ownerUserId === ownerId)) {
      await refreshPending();
    }
  };

  const refreshVerifiedEpoch = async (minimumEpoch = 0): Promise<LibraryEpoch | null> => {
    if (!db || !canVerifyCloudEpoch()) return null;
    const value = await waitForCloudSyncStep(getLibraryEpoch(db, ownerId));
    if (!canVerifyCloudEpoch()) return null;
    if (value < minimumEpoch) {
      throw new CardMutationPreconditionError('future-library-epoch');
    }
    return publishVerifiedEpochIfOwnerCurrent(
      ownerId,
      isOwnerCurrent() ? ownerId : null,
      value,
      getEvents().verifyEpoch,
    );
  };

  const stageCreate = async (
    cards: CardData[],
    nextTotal?: number,
  ): Promise<DevicePendingOperation[]> => {
    const epoch = readActiveEpoch();
    const normalized = normalizeLocalCards(cards.map(card => ({
      ...card,
      libraryEpoch: epoch.value,
    })));
    if (normalized.length === 0) return [];
    try {
      for (let offset = 0; offset < normalized.length; offset += 100) {
        await upsertMirroredCardBatch(ownerId, normalized.slice(offset, offset + 100));
      }
    } catch (cause) {
      console.warn('Cards were queued safely, but the local IndexedDB mirror could not be updated.', cause);
    }
    const queued = await queueDeviceUpserts(
      normalized.map(normalizeCardForStorage),
      Math.max(nextTotal ?? 0, normalized.length),
      ownerId,
      !epoch.verified,
    );
    void refreshPending();
    return queued;
  };

  const stagePatch = async (
    changes: readonly { card: CardData; fields: Partial<CardData> }[],
    nextTotal?: number,
    operationId?: string,
    operation: 'patch' | 'review' = 'patch',
  ): Promise<DevicePendingOperation[]> => {
    const epoch = readActiveEpoch();
    const normalized = changes.flatMap(({ card, fields }) => {
      const normalizedCard = normalizeCardForStorage({ ...card, ...fields, libraryEpoch: epoch.value });
      const normalizedFields = Object.fromEntries(
        (Object.keys(fields) as Array<keyof CardData>).flatMap(key =>
          normalizedCard[key] === undefined ? [] : [[key, normalizedCard[key]]]),
      ) as Partial<CardData>;
      return Object.keys(normalizedFields).length
        ? [{ card: normalizedCard, fields: normalizedFields, operation,
          ...(operation === 'review' ? { reviewEffect: { xp: REVIEW_XP } } : {}) }]
        : [];
    });
    if (normalized.length === 0) return [];
    try {
      for (let offset = 0; offset < normalized.length; offset += 100) {
        await patchMirroredCardBatch(
          ownerId,
          normalized.slice(offset, offset + 100).map(change => ({
            cardId: change.card.id,
            fields: change.fields,
          })),
        );
      }
    } catch (cause) {
      console.warn('Card patches were queued safely, but the local IndexedDB mirror could not be updated.', cause);
    }
    const queued = operation === 'review'
      ? await queueDevicePatches(
        normalized,
        Math.max(nextTotal ?? 0, normalized.length),
        ownerId,
        operationId,
        !epoch.verified,
        'review',
      )
      : await queueDevicePatches(
        normalized,
        Math.max(nextTotal ?? 0, normalized.length),
        ownerId,
        operationId,
        !epoch.verified,
      );
    void refreshPending();
    return queued;
  };

  const stageDelete = async (
    cardId: string,
    context: DeviceDeleteContext = {},
  ): Promise<DevicePendingOperation[]> => {
    const epoch = readActiveEpoch();
    const source = getCards().find(card => card.id === cardId)
      ?? getEvents().findPracticeCard(cardId);
    const cleanupBoundary = {
      libraryEpoch: context.libraryEpoch ?? source?.libraryEpoch ?? epoch.value,
      revision: context.baseRevisions?.[cardId] ?? source?.revision ?? 0,
    };
    const queued = await queueDeviceDeletes([cardId], ownerId, {
      libraryEpoch: epoch.verified ? cleanupBoundary.libraryEpoch : -1,
      baseRevisions: { [cardId]: cleanupBoundary.revision },
    });
    try {
      await deleteDeviceCardBackupIfNotNewerThan(ownerId, cardId, cleanupBoundary);
      await deleteMirroredCardIfNotNewerThan(ownerId, cardId, cleanupBoundary);
    } catch (cause) {
      console.warn('The card delete was queued, but local cleanup could not be completed.', cause);
    }
    void refreshPending();
    return queued;
  };

  const stage = (mutation: LibraryReplicaMutation): Promise<DevicePendingOperation[]> => {
    if (mutation.type === 'create') return stageCreate(mutation.cards, mutation.nextTotal);
    if (mutation.type === 'patch') {
      return stagePatch(mutation.changes, mutation.nextTotal, mutation.operationId, mutation.operation);
    }
    return stageDelete(mutation.cardId, mutation.context);
  };

  const restoreDeviceCard = async (
    originalCard: CardData,
    options: RestoreDeviceCardOptions,
  ): Promise<RestoreDeviceCardResult> => {
    if (options.ownerId !== ownerId || !isOwnerCurrent()) {
      return { status: 'conflict', reason: 'owner-changed' };
    }
    if (!canWriteCloud()) return { status: 'conflict', reason: 'epoch-changed' };
    if (
      !Number.isSafeInteger(options.expectedLibraryEpoch)
      || options.expectedLibraryEpoch < 0
      || !/^[A-Za-z0-9_-]{1,128}$/.test(options.operationId)
      || !Number.isFinite(Date.parse(options.operationCreatedAt))
    ) return { status: 'conflict', reason: 'unsafe-existing' };
    const activeEpoch = getEpoch();
    if (
      !activeEpoch
      || activeEpoch.userId !== ownerId
      || activeEpoch.value !== options.expectedLibraryEpoch
    ) return { status: 'conflict', reason: 'epoch-changed' };

    const restoredCandidate: CardData = {
      ...originalCard,
      libraryEpoch: options.expectedLibraryEpoch,
    };
    const operationContext: DeviceUpsertContext = {
      operationId: options.operationId,
      operationCreatedAt: options.operationCreatedAt,
      libraryEpoch: options.expectedLibraryEpoch,
      baseRevisions: { [restoredCandidate.id]: restoredCandidate.revision ?? 0 },
      restore: true,
    };
    const cleanupCandidate = async () => {
      const maximum = {
        libraryEpoch: options.expectedLibraryEpoch,
        revision: restoredCandidate.revision ?? 0,
      };
      await Promise.all([
        deleteDeviceCardBackupIfNotNewerThan(ownerId, restoredCandidate.id, maximum).catch(cause => {
          console.warn('An obsolete restore could not be removed from the device backup.', cause);
        }),
        deleteMirroredCardIfNotNewerThan(ownerId, restoredCandidate.id, maximum).catch(cause => {
          console.warn('An obsolete restore could not be removed from the local mirror.', cause);
        }),
      ]);
    };
    const reconcileAuthoritativeCard = async (authoritativeCard: CardData) => {
      try {
        await mergeDeviceCardsStrict([authoritativeCard], 1, ownerId);
      } catch (cause) {
        if (!(cause instanceof DeviceBackupOwnerConflictError)) {
          console.warn('The authoritative restored card could not be merged into the device backup.', cause);
        }
      }
      try {
        await upsertMirroredCardIfNotOlderThan(ownerId, authoritativeCard);
      } catch (cause) {
        console.warn('The authoritative restored card could not be written to the local mirror.', cause);
      }
      if (restoredCandidate.id !== authoritativeCard.id) await cleanupCandidate();
    };

    let serverEpochVerified = false;
    if (db && isFirebaseConfigured && isBrowserOnline() && !isCloudBackoffActive(ownerId)) {
      try {
        const current = await waitForCloudSyncStep(getLibraryEpoch(db, ownerId));
        if (!isOwnerCurrent()) return { status: 'conflict', reason: 'owner-changed' };
        if (!canWriteCloud()) return { status: 'conflict', reason: 'epoch-changed' };
        if (current !== options.expectedLibraryEpoch) {
          return { status: 'conflict', reason: 'epoch-changed' };
        }
        serverEpochVerified = true;
      } catch (cause) {
        if (!isOwnerCurrent()) return { status: 'conflict', reason: 'owner-changed' };
        console.warn('Restore is queued until the captured cloud epoch can be verified.', cause);
      }
    }

    const queued = await queueDeviceUpserts(
      [restoredCandidate],
      Math.max(getMirrorTotals().cloudTotal, getMirrorTotals().cloudStatsTotal, getCards().length + 1),
      ownerId,
      false,
      operationContext,
    );
    if (!isOwnerCurrent()) return { status: 'conflict', reason: 'owner-changed' };
    const persistedOperation = queued.find(operation =>
      operation.type === 'upsert' && operation.opId === options.operationId,
    );
    if (!persistedOperation) {
      const pending = mergePendingOperations(await loadDevicePending(ownerId));
      const newestForCard = pending.filter(operation =>
        operation.ownerUserId === ownerId
        && pendingOperationCardId(operation) === restoredCandidate.id,
      ).at(-1);
      await cleanupCandidate();
      if (newestForCard?.type === 'delete' && newestForCard.updatedAt > options.operationCreatedAt) {
        return { status: 'conflict', reason: 'deleted-again' };
      }
      return { status: 'conflict', reason: 'unsafe-existing' };
    }

    const pending = mergePendingOperations(await loadDevicePending(ownerId));
    const newestForCard = pending.filter(operation =>
      operation.ownerUserId === ownerId
      && pendingOperationCardId(operation) === restoredCandidate.id,
    ).at(-1);
    if (newestForCard?.type === 'delete' && newestForCard.updatedAt > options.operationCreatedAt) {
      await cleanupCandidate();
      return { status: 'conflict', reason: 'deleted-again' };
    }

    try {
      await upsertMirroredCardIfNotOlderThan(ownerId, restoredCandidate);
    } catch (cause) {
      console.warn('Restore is queued, but the local card mirror could not be updated.', cause);
    }
    if (!isOwnerCurrent()) return { status: 'conflict', reason: 'owner-changed' };
    if (!canWriteCloud()) {
      void refreshPending();
      return { status: 'queued', card: restoredCandidate };
    }
    const latestEpoch = getEpoch();
    if (
      !latestEpoch
      || latestEpoch.userId !== ownerId
      || latestEpoch.value !== options.expectedLibraryEpoch
    ) {
      await cleanupCandidate();
      return { status: 'conflict', reason: 'epoch-changed' };
    }

    if (serverEpochVerified && canWriteCloud() && db && isFirebaseConfigured && isBrowserOnline() && !isCloudBackoffActive(ownerId)) {
      try {
        const result = await waitForCloudSyncStep(createCardIfAbsent(db, ownerId, restoredCandidate, {
          libraryEpoch: options.expectedLibraryEpoch,
          baseRevision: persistedOperation.baseRevision,
          opId: options.operationId,
          operationCreatedAt: options.operationCreatedAt,
          restore: true,
        }));
        if (!isOwnerCurrent()) return { status: 'conflict', reason: 'owner-changed' };
        if (!canWriteCloud()) {
          void refreshPending();
          return { status: 'queued', card: restoredCandidate };
        }
        const currentEpoch = getEpoch();
        if (
          !currentEpoch
          || currentEpoch.userId !== ownerId
          || currentEpoch.value !== options.expectedLibraryEpoch
        ) return { status: 'conflict', reason: 'epoch-changed' };
        await reconcileAuthoritativeCard(result.card);
        void refreshPending();
        return result.created
          ? { status: 'restored', card: result.card }
          : { status: 'existing', card: result.card };
      } catch (cause) {
        const reason = cause instanceof CardMutationPreconditionError
          ? cause.reason
          : cause instanceof ProtectedFunctionError
            && typeof (cause as ProtectedFunctionError & { mutationReason?: unknown }).mutationReason === 'string'
            ? (cause as ProtectedFunctionError & { mutationReason: CardMutationPreconditionError['reason'] }).mutationReason
            : null;
        if (reason) {
          await cleanupCandidate();
          void refreshPending();
          if (reason === 'deleted') return { status: 'conflict', reason: 'deleted-again' };
          if (reason === 'stale-library-epoch' || reason === 'future-library-epoch') {
            return { status: 'conflict', reason: 'epoch-changed' };
          }
          return { status: 'conflict', reason: 'unsafe-existing' };
        }
        if (isOwnerCurrent()) onError(getSyncErrorMessage(cause));
        console.warn('Restore remains queued after a cloud write failure.', cause);
      }
    }

    void refreshPending();
    return { status: 'queued', card: restoredCandidate };
  };

  const runFlush = async ({
    manualRetry = false,
    verifiedEpoch = null,
    isBrowserOnline,
  }: LibraryReplicaFlushOptions): Promise<void> => {
    const events = getEvents();
    if (!canWriteCloud()) return;
    if (!db || !isFirebaseConfigured) {
      if (isOwnerCurrent()) onError('Cloud sync is not configured. Your changes remain safe on this device.');
      await refreshPending();
      return;
    }
    if (!manualRetry && !isBrowserOnline) return;
    if (!canAttemptCloudSync(isCloudBackoffActive(ownerId), manualRetry)) {
      if (isOwnerCurrent()) {
        onError('Cloud sync is paused briefly after a sync failure. Your changes are safe; retry now or wait a minute.');
      }
      await refreshPending();
      return;
    }
    const renderedEpoch = getEpoch();
    let activeEpoch = resolveSyncEpoch(
      ownerId,
      renderedEpoch?.userId === ownerId ? renderedEpoch : null,
      verifiedEpoch,
    ) as number;
    if (activeEpoch === null) {
      try {
        const refreshed = await refreshVerifiedEpoch();
        if (!canWriteCloud()) return;
        activeEpoch = (refreshed?.value ?? null) as number;
      } catch (cause) {
        if (!canWriteCloud()) return;
        if (isOwnerCurrent()) {
          onError(getSyncErrorMessage(cause));
          events.setCloudAvailable(false);
        }
        await refreshPending();
        return;
      }
      if (activeEpoch === null) {
        if (!canWriteCloud()) return;
        if (isOwnerCurrent()) {
          onError('Cloud generation could not be verified. Your changes remain safe on this device.');
        }
        await refreshPending();
        return;
      }
      if (isOwnerCurrent()) onError(null);
    }
    const database = db;
    try {
      const result = await withDevicePendingFlush(ownerId, manualRetry, async lease => {
      const assertLease = async () => {
        await lease.assertOwnership();
        if (!canWriteCloud()) throw CLOUD_WRITES_PAUSED;
      };
      await assertLease();
      if (isOwnerCurrent()) {
        onSyncing(true);
        onError(null);
      }
      try {
      const pending = mergePendingOperations(await loadDevicePending(ownerId))
        .filter(operation => operation.ownerUserId === ownerId);
      if (!canWriteCloud()) throw CLOUD_WRITES_PAUSED;
      let plan = partitionPendingOperationsByLibraryEpoch(pending, activeEpoch);
      if (plan.future.length) {
        const refreshed = await refreshVerifiedEpoch(activeEpoch);
        if (!canWriteCloud()) throw CLOUD_WRITES_PAUSED;
        if (refreshed && refreshed.value > activeEpoch) {
          activeEpoch = refreshed.value;
          plan = partitionPendingOperationsByLibraryEpoch(pending, activeEpoch);
        }
      }
      if (plan.stale.length) {
        const staleCardIds = [...new Set(plan.stale.map(pendingOperationCardId))];
        for (const cardId of staleCardIds) {
          await deleteDeviceCardBackupIfNotNewerThan(ownerId, cardId, {
            libraryEpoch: Math.max(0, activeEpoch - 1),
            revision: Number.MAX_SAFE_INTEGER,
          }, lease);
          if (!canWriteCloud()) throw CLOUD_WRITES_PAUSED;
          await deleteMirroredCardIfOlderThan(ownerId, cardId, activeEpoch);
          if (!canWriteCloud()) throw CLOUD_WRITES_PAUSED;
        }
        await acknowledge(plan.stale, lease);
        if (!canWriteCloud()) throw CLOUD_WRITES_PAUSED;
      }
      if (plan.future.length && isOwnerCurrent()) {
        onError('Some changes belong to a newer library version than the cloud currently reports. They remain safe on this device; retry after cloud recovery.');
      }
      if (!plan.current.length) {
        if (isOwnerCurrent()) {
          if (!plan.future.length) onError(null);
          removeLocalValue(cloudBackoffCacheKey(ownerId));
          events.setCloudAvailable(true);
          events.refreshCloud();
        }
        return;
      }
      const writeEpoch = activeEpoch;
      const verified = await waitForCloudSyncStep(
        verifyPendingCardOperations(plan.current, card => findCardByNormalizedWord(
          database,
          ownerId,
          card,
          writeEpoch,
        )),
      );
      if (!canWriteCloud()) throw CLOUD_WRITES_PAUSED;
      const flushed = [...verified.operationsAlreadyExisting];
      let deferredSyncError: string | null = null;
      for (let index = 0; index < verified.operationsAlreadyExisting.length; index += 1) {
        const operation = verified.operationsAlreadyExisting[index];
        const existing = verified.existingCards[index];
        if (operation.type === 'upsert') {
          await reconcilePendingUpsertWithAuthoritativeCard(
            ownerId,
            operation,
            existing,
            activeEpoch,
            lease,
          );
          if (!canWriteCloud()) throw CLOUD_WRITES_PAUSED;
        }
      }
      const writes = partitionPendingOperationsForFlush(verified.operationsToWrite);
      const acknowledgedOperations = new Set<DevicePendingOperation>();
      for (const creation of writes.creates) {
        let result;
        try {
          await assertLease();
          result = await waitForCloudSyncStep(
            createCardIfAbsent(database, ownerId, creation.card, {
              libraryEpoch: activeEpoch,
              baseRevision: creation.baseRevision,
              opId: creation.opId,
              operationCreatedAt: creation.updatedAt,
              ...(creation.restore === true ? { restore: true as const } : {}),
            }),
          );
          if (!canWriteCloud()) throw CLOUD_WRITES_PAUSED;
        } catch (cause) {
          if (cause === CLOUD_WRITES_PAUSED) throw cause;
          if (!canWriteCloud()) throw CLOUD_WRITES_PAUSED;
          if (cause instanceof CardMutationPreconditionError && cause.reason === 'deleted') {
            const maximum = {
              libraryEpoch: creation.libraryEpoch ?? activeEpoch,
              revision: creation.baseRevision ?? 0,
            };
            try {
              await deleteDeviceCardBackupIfNotNewerThan(ownerId, creation.card.id, maximum, lease);
              if (!canWriteCloud()) throw CLOUD_WRITES_PAUSED;
              await deleteMirroredCardIfNotNewerThan(ownerId, creation.card.id, maximum);
              if (!canWriteCloud()) throw CLOUD_WRITES_PAUSED;
              if (isOwnerCurrent()) {
                events.removeCard(creation.card.id);
                events.removePracticeCard(creation.card.id);
              }
              flushed.push(creation);
            } catch (cleanupCause) {
              console.warn('A create superseded by a cloud delete could not be cleaned up locally.', cleanupCause);
              deferredSyncError = 'One outdated create is still awaiting safe local cleanup; newer changes continued syncing.';
            }
            continue;
          }
          throw cause;
        }
        await reconcilePendingUpsertWithAuthoritativeCard(
          ownerId,
          creation,
          result.card,
          activeEpoch,
          lease,
        );
        if (!canWriteCloud()) throw CLOUD_WRITES_PAUSED;
        flushed.push(creation);
      }
      for (const deletion of writes.deletes) {
        await assertLease();
        const result = await waitForCloudSyncStep(
          deleteCardWithConflictRecovery(
            {
              cardId: deletion.cardId,
              opId: deletion.opId ?? `legacy-delete-${deletion.cardId}-${deletion.updatedAt}`,
              libraryEpoch: deletion.libraryEpoch ?? 0,
              baseRevision: deletion.baseRevision ?? 0,
            },
            command => deleteCardWithTombstone(database, ownerId, command),
          ),
        );
        if (!canWriteCloud()) throw CLOUD_WRITES_PAUSED;
        if (result.deleted) {
          const maximum = {
            libraryEpoch: result.tombstone.libraryEpoch,
            revision: Math.max(0, result.tombstone.revision - 1),
          };
          await deleteDeviceCardBackupIfNotNewerThan(ownerId, deletion.cardId, maximum, lease);
          if (!canWriteCloud()) throw CLOUD_WRITES_PAUSED;
          await deleteMirroredCardIfNotNewerThan(ownerId, deletion.cardId, maximum);
          if (!canWriteCloud()) throw CLOUD_WRITES_PAUSED;
          flushed.push(deletion);
        } else if (result.reason === 'stale-library-epoch') {
          const verifiedEpoch = await refreshVerifiedEpoch(activeEpoch);
          if (!canWriteCloud()) throw CLOUD_WRITES_PAUSED;
          if (!verifiedEpoch) return;
          const latestEpoch = verifiedEpoch.value;
          await deleteDeviceCardBackupIfNotNewerThan(ownerId, deletion.cardId, {
            libraryEpoch: Math.max(0, latestEpoch - 1),
            revision: Number.MAX_SAFE_INTEGER,
          }, lease);
          if (!canWriteCloud()) throw CLOUD_WRITES_PAUSED;
          await deleteMirroredCardIfOlderThan(ownerId, deletion.cardId, latestEpoch);
          if (!canWriteCloud()) throw CLOUD_WRITES_PAUSED;
          flushed.push(deletion);
        } else if (isOwnerCurrent()) {
          events.reportError(result.reason === 'future-library-epoch'
            ? 'Cloud changed; delete remains queued.'
            : 'Card changed; delete remains queued.');
        }
      }
      for (const patch of writes.patches) {
        const fieldMask = patch.fieldMask ?? Object.keys(patch.fields) as Array<keyof CardData>;
        const masked = selectMutableCardPatch(patch.fields, fieldMask);
        const lastReviewCandidate = patch.operation === 'review' ? patch.fields.reviewHistory?.at(-1) : undefined;
        const lastReview = isValidReviewEntry(lastReviewCandidate) ? lastReviewCandidate : undefined;
        if (patch.operation === 'review' && !lastReview) {
          if (isOwnerCurrent()) {
            events.reportError('Review update stayed queued because its history entry is invalid.');
          }
          continue;
        }
        let result;
        try {
          await assertLease();
          result = lastReview
            ? await waitForCloudSyncStep(
            applyReviewWithConflictRecovery({
              cardId: patch.cardId,
              opId: patch.opId ?? `review-${patch.cardId}-${patch.updatedAt}`,
              baseRevision: patch.baseRevision ?? 0,
              libraryEpoch: patch.libraryEpoch ?? 0,
              rating: lastReview.rating,
              reviewedAt: lastReview.reviewedAt,
              fields: patch.fields,
              fieldMask,
            }, command => applyReviewViaCallable(database, ownerId, command)),
            )
            : await waitForCloudSyncStep(
            applyCardPatchWithConflictRecovery(
              {
                cardId: patch.cardId,
                fields: patch.fields,
                fieldMask,
                baseRevision: patch.baseRevision ?? 0,
                libraryEpoch: patch.libraryEpoch ?? 0,
              },
              command => applyCardPatchIfCurrent(database, ownerId, command),
            ),
            );
          if (!canWriteCloud()) throw CLOUD_WRITES_PAUSED;
        } catch (cause) {
          if (cause === CLOUD_WRITES_PAUSED || !canWriteCloud()) return;
          if (!lastReview || !(cause instanceof ProtectedFunctionError) || cause.retryable) throw cause;
          const authoritative = await waitForCloudSyncStep(findCardById(database, ownerId, patch.cardId));
          if (!canWriteCloud()) return;
          await restoreQueuedReviewFromAuthoritativeCard(ownerId, patch, authoritative, events, isOwnerCurrent, lease);
          if (!canWriteCloud()) return;
          await assertLease();
          await acknowledge([patch], lease);
          acknowledgedOperations.add(patch);
          flushed.push(patch);
          if (isOwnerCurrent()) {
            events.reportError(getProtectedFunctionUserMessage(cause) ?? cause.message);
            events.notify('A queued review was rejected and restored from the cloud.');
          }
          continue;
        }
        if (result.applied) {
          const reviewResult = 'card' in result ? result : null;
          const patchResult = 'revision' in result ? result : null;
          if (lastReview && !reviewResult) {
            throw new Error('The protected review service returned a non-authoritative result.');
          }
          const authoritativeFields = reviewResult
            ? Object.fromEntries(REVIEW_FIELDS.map(field => [field, reviewResult.card[field]]))
            : masked;
          const metadata = {
            revision: reviewResult?.card.revision ?? patchResult?.revision ?? 0,
            libraryEpoch: patch.libraryEpoch ?? activeEpoch,
            updatedAt: reviewResult?.card.updatedAt ?? new Date().toISOString(),
          };
          const advance = (card: CardData) => card.id === patch.cardId
            ? lastReview
              ? {
                  ...card,
                  ...authoritativeFields,
                  ...(reviewResult?.card.appliedReviewOperationIds
                    ? { appliedReviewOperationIds: reviewResult.card.appliedReviewOperationIds }
                    : {}),
                  schemaVersion: 2 as const,
                  ...metadata,
                  id: card.id,
                }
              : applySuccessfulPatchMetadata(card, patch.fields, metadata, fieldMask)
            : card;
          await patchMirroredCardBatch(ownerId, [{
            cardId: patch.cardId,
            fields: { ...authoritativeFields, schemaVersion: 2, ...metadata,
            ...(reviewResult ? { appliedReviewOperationIds: reviewResult.card.appliedReviewOperationIds } : {}) },
          }]);
          if (!canWriteCloud()) throw CLOUD_WRITES_PAUSED;
          if (isOwnerCurrent()) {
            events.advanceCard(patch.cardId, advance);
            events.advancePracticeCard(patch.cardId, advance);
          }
          if (lastReview) {
            if (!canWriteCloud()) throw CLOUD_WRITES_PAUSED;
            if (patch.reviewEffect) {
              events.settleReview(patch.opId ?? `review-${patch.cardId}-${patch.updatedAt}`, patch.reviewEffect);
            }
            await assertLease();
            await acknowledge([patch], lease);
            acknowledgedOperations.add(patch);
          }
          flushed.push(patch);
        } else if (result.reason === 'stale-library-epoch' && !lastReview) {
          const verifiedEpoch = await refreshVerifiedEpoch(activeEpoch);
          if (!canWriteCloud()) throw CLOUD_WRITES_PAUSED;
          if (!verifiedEpoch) return;
          const latestEpoch = verifiedEpoch.value;
          await deleteDeviceCardBackupIfNotNewerThan(ownerId, patch.cardId, {
            libraryEpoch: Math.max(0, latestEpoch - 1),
            revision: Number.MAX_SAFE_INTEGER,
          }, lease);
          if (!canWriteCloud()) throw CLOUD_WRITES_PAUSED;
          await deleteMirroredCardIfOlderThan(ownerId, patch.cardId, latestEpoch);
          if (!canWriteCloud()) throw CLOUD_WRITES_PAUSED;
          flushed.push(patch);
        } else if (result.reason === 'missing') {
          const maximum = {
            libraryEpoch: patch.libraryEpoch ?? activeEpoch,
            revision: patch.baseRevision ?? 0,
          };
          await deleteDeviceCardBackupIfNotNewerThan(ownerId, patch.cardId, maximum, lease);
          if (!canWriteCloud()) throw CLOUD_WRITES_PAUSED;
          await deleteMirroredCardIfNotNewerThan(ownerId, patch.cardId, maximum);
          if (!canWriteCloud()) throw CLOUD_WRITES_PAUSED;
          if (isOwnerCurrent()) {
            events.removeCard(patch.cardId);
            events.removePracticeCard(patch.cardId);
          }
          flushed.push(patch);
        } else if (lastReview && (result.reason === 'stale-review'
          || result.reason === 'future-review-clock-skew'
          || result.reason === 'receipt-fingerprint-conflict'
          || result.reason === 'future-library-epoch'
          || result.reason === 'stale-library-epoch')) {
          const authoritative = await waitForCloudSyncStep(findCardById(database, ownerId, patch.cardId));
          if (!canWriteCloud()) throw CLOUD_WRITES_PAUSED;
          await restoreQueuedReviewFromAuthoritativeCard(ownerId, patch, authoritative, events, isOwnerCurrent, lease);
          if (!canWriteCloud()) throw CLOUD_WRITES_PAUSED;
          await assertLease();
          await acknowledge([patch], lease);
          acknowledgedOperations.add(patch);
          flushed.push(patch);
          if (isOwnerCurrent()) events.notify('A queued review was not applied because newer progress exists.');
        } else if (isOwnerCurrent()) {
          events.reportError(result.reason === 'future-library-epoch'
            ? 'Cloud changed; update remains queued.'
            : 'Card changed; update remains queued.');
        }
      }
      const pendingAcknowledgements = flushed.filter(operation => !acknowledgedOperations.has(operation));
      if (pendingAcknowledgements.length) { await assertLease(); await acknowledge(pendingAcknowledgements, lease); }
      if (isOwnerCurrent()) {
        if (deferredSyncError) onError(deferredSyncError);
        else if (!plan.future.length) onError(null);
        removeLocalValue(cloudBackoffCacheKey(ownerId));
        events.setCloudAvailable(true);
        if (shouldResetLibraryPageAfterSync(flushed)) events.resetPage();
        events.refreshCloud();
        if (verified.operationsAlreadyExisting.length) {
          events.notify('Cloud card restored; no duplicate.');
        }
      }
      } catch (cause) {
      if (cause === CLOUD_WRITES_PAUSED || !canWriteCloud()) return;
      if (cause instanceof CardMutationPreconditionError && cause.reason === 'stale-library-epoch') {
        try {
          await refreshVerifiedEpoch(activeEpoch);
        } catch (epochCause) {
          console.warn('The current cloud library generation could not be refreshed.', epochCause);
        }
      }
      console.warn('Pending local changes could not be synced to Firebase yet.', cause);
      writeLocalValue(
        cloudBackoffCacheKey(ownerId),
        String(Date.now() + getCloudBackoffDurationMs(cause)),
      );
      if (isOwnerCurrent()) {
        onError(getSyncErrorMessage(cause));
        events.setCloudAvailable(false);
      }
      } finally {
      await refreshPending();
      if (isOwnerCurrent()) onSyncing(false);
      }
      });
      if (!canWriteCloud()) return;
      if (!result.acquired) {
        if (isOwnerCurrent()) onError('Another SonFlash tab is syncing these changes. They remain safe on this device; close the other tab or retry in a moment.');
        await refreshPending();
      }
    } catch (cause) {
      if (cause === CLOUD_WRITES_PAUSED || !canWriteCloud()) return;
      console.warn('The device sync coordinator could not acquire a flush lease.', cause);
      const message = 'The device sync coordinator could not be reached. Your changes remain safe on this device; retry after checking the local app connection.';
      if (isOwnerCurrent()) { onError(message); events.reportError(message); }
      await refreshPending();
    }
  };

  const flush = (options: LibraryReplicaFlushOptions): Promise<void> => {
    if (pendingFlush) return pendingFlush;
    const operation = runFlush(options).finally(() => {
      if (pendingFlush === operation) pendingFlush = null;
    });
    pendingFlush = operation;
    return operation;
  };

  const runMirrorRefresh = async (force = false): Promise<number> => {
    if (!db || !isFirebaseConfigured) return 0;
    if (isCloudBackoffActive(ownerId)) throw new Error('Cloud reads are temporarily paused.');
    const { cloudTotal, cloudStatsTotal } = getMirrorTotals();
    const expectedTotal = Math.max(cloudTotal, cloudStatsTotal, getCards().length);
    const capturedMirrorEpoch = await waitForCloudSyncStep(getLibraryEpoch(db, ownerId));
    const status = await getCardMirrorStatus(ownerId);
    if (!force && isCardMirrorFresh(
      status,
      expectedTotal,
      Date.now(),
      CARD_MIRROR_REFRESH_INTERVAL_MS,
      capturedMirrorEpoch,
    ) && status) return status.loaded;
    const generation = await beginCardMirrorSync(ownerId, expectedTotal, capturedMirrorEpoch);
    let loaded = 0;
    try {
      await waitForCloudSyncStep(
        streamAllCardsInBatches(db, ownerId, async page => {
          const currentPage = page.filter(card =>
            card.libraryEpoch === undefined || card.libraryEpoch === capturedMirrorEpoch);
          loaded += currentPage.length;
          await upsertMirroredCardBatch(ownerId, currentPage, generation);
        }, 100),
      );
      const streamedMirrorEpoch = await waitForCloudSyncStep(getLibraryEpoch(db, ownerId));
      if (streamedMirrorEpoch !== capturedMirrorEpoch) throw new Error(mirrorEpochChangedMessage);
      const pending = mergePendingOperations(await loadDevicePending(ownerId))
        .filter(operation => !operation.ownerUserId || operation.ownerUserId === ownerId);
      const pendingPlan = partitionPendingOperationsByLibraryEpoch(pending, capturedMirrorEpoch);
      for (const operation of pendingPlan.current) {
        if (operation.type === 'upsert') {
          await upsertMirroredCardBatch(ownerId, [operation.card], generation);
        } else if (operation.type === 'patch') {
          await patchMirroredCardBatch(ownerId, [{
            cardId: operation.cardId,
            fields: operation.fields,
          }], generation);
        } else {
          await deleteMirroredCardForGeneration(ownerId, operation.cardId, generation);
        }
      }
      const overlaidMirrorEpoch = await waitForCloudSyncStep(getLibraryEpoch(db, ownerId));
      if (overlaidMirrorEpoch !== capturedMirrorEpoch) throw new Error(mirrorEpochChangedMessage);
      const completed = await finishCardMirrorSync(ownerId, generation, loaded);
      if (!completed) throw new Error(mirrorInterruptedMessage);
      const publishedMirrorEpoch = await waitForCloudSyncStep(getLibraryEpoch(db, ownerId));
      if (publishedMirrorEpoch !== capturedMirrorEpoch) throw new Error(mirrorEpochChangedMessage);
    } catch (cause) {
      try {
        await invalidateCardMirrorGeneration(ownerId, generation);
      } catch (invalidationCause) {
        console.warn('The interrupted card mirror generation could not be invalidated.', invalidationCause);
      }
      throw cause;
    }
    if (isOwnerCurrent()) {
      const events = getEvents();
      onError(null);
      events.setCloudAvailable(true);
      events.setCloudTotal(Math.max(cloudTotal, loaded));
      events.refreshCloud();
    }
    return loaded;
  };

  const refreshMirror = (force = false): Promise<number> => {
    if (pendingMirrorRefresh) return pendingMirrorRefresh;
    const operation = runMirrorRefresh(force).finally(() => {
      if (pendingMirrorRefresh === operation) pendingMirrorRefresh = null;
    });
    pendingMirrorRefresh = operation;
    return operation;
  };

  const retry = async (): Promise<void> => {
    if (!canVerifyCloudEpoch()) return;
    if (isOwnerCurrent()) {
      onError(null);
      onSyncing(true);
    }
    let verifiedEpoch: CloudSyncEpoch | null = null;
    try {
      const renderedEpoch = getEpoch();
      const minimumEpoch = renderedEpoch?.userId === ownerId ? renderedEpoch.value : 0;
      verifiedEpoch = await refreshVerifiedEpoch(minimumEpoch);
      if (!canVerifyCloudEpoch()) return;
      if (verifiedEpoch) await refreshPending();
    } catch (cause) {
      if (!canWriteCloud()) return;
      if (isOwnerCurrent()) {
        onError(getSyncErrorMessage(cause) || 'Cloud generation unverified. Changes remain safe on this device.');
      }
    } finally {
      if (isOwnerCurrent()) onSyncing(false);
    }
    if (!verifiedEpoch || !canWriteCloud()) return;
    await flush({ manualRetry: true, verifiedEpoch, isBrowserOnline: true });
  };

  return { acknowledge, flush, refreshMirror, refreshPending, restoreDeviceCard, retry, stage };
}

export type { DeviceDeleteContext, DevicePendingOperation };
