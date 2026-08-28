import {
  beginCardMirrorSync,
  deleteMirroredCard,
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
  acquireDevicePendingFlush,
  deleteDeviceCardBackupIfNotNewerThan,
  DeviceBackupOwnerConflictError,
  loadDevicePending,
  mergeDeviceCardsStrict,
  mergePendingOperations,
  queueDeviceDeletes,
  queueDevicePatches,
  queueDeviceUpserts,
  releaseDevicePendingFlush,
  type DeviceDeleteContext,
  type DevicePendingOperation,
} from '../../lib/deviceSync';
import {
  applyCardPatchIfCurrent,
  CardMutationPreconditionError,
  createCardIfAbsent,
  deleteCardWithTombstone,
  findCardByNormalizedWord,
  getLibraryEpoch,
  streamAllCardsInBatches,
} from '../../lib/cardRepository';
import type { CardData } from '../../types/card';
import { db, isFirebaseConfigured } from '../../lib/firebase';
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
): Promise<void> => {
  try {
    await mergeDeviceCardsStrict([authoritativeCard], 1, userId);
  } catch (cause) {
    if (!(cause instanceof DeviceBackupOwnerConflictError)) throw cause;
  }
  await upsertMirroredCardIfNotOlderThan(userId, authoritativeCard);
  if (operation.card.id !== authoritativeCard.id) {
    const maximum = pendingUpsertCleanupBoundary(operation, activeEpoch);
    await deleteDeviceCardBackupIfNotNewerThan(userId, operation.card.id, maximum);
    await deleteMirroredCardIfNotNewerThan(userId, operation.card.id, maximum);
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
  publish: (epoch: LibraryEpoch) => void,
): LibraryEpoch | null {
  if (
    activeUserId !== expectedUserId
    || !Number.isSafeInteger(value)
    || value < 0
  ) return null;
  const verified = { userId: expectedUserId, value };
  publish(verified);
  return verified;
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
  verifyEpoch: (epoch: LibraryEpoch) => void;
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
  getEpoch: () => LibraryEpoch | null;
  getCards: () => readonly CardData[];
  getEvents: () => LibraryReplicaEvents;
  getMirrorTotals: () => { cloudTotal: number; cloudStatsTotal: number };
  isOwnerCurrent: () => boolean;
  onError: (error: string | null) => void;
  onPendingCount: (count: number) => void;
  onSyncing: (syncing: boolean) => void;
}

export interface LibraryReplicaFlushOptions {
  manualRetry?: boolean;
  verifiedEpoch?: CloudSyncEpoch | null;
  isBrowserOnline: boolean;
}

export function createLibraryReplica({
  ownerId,
  getEpoch,
  getCards,
  getEvents,
  getMirrorTotals,
  isOwnerCurrent,
  onError,
  onPendingCount,
  onSyncing,
}: LibraryReplicaOptions) {
  let pendingFlush: Promise<void> | null = null;
  let pendingMirrorRefresh: Promise<number> | null = null;

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

  const acknowledge = async (operations: readonly DevicePendingOperation[]) => {
    await acknowledgeDevicePending([...operations]);
    if (operations.some(operation => operation.ownerUserId === ownerId)) {
      await refreshPending();
    }
  };

  const refreshVerifiedEpoch = async (minimumEpoch = 0): Promise<LibraryEpoch | null> => {
    if (!db) return null;
    const value = await waitForCloudSyncStep(getLibraryEpoch(db, ownerId));
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
        ? [{ card: normalizedCard, fields: normalizedFields, operation }]
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

  const runFlush = async ({
    manualRetry = false,
    verifiedEpoch = null,
    isBrowserOnline,
  }: LibraryReplicaFlushOptions): Promise<void> => {
    const events = getEvents();
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
    );
    if (activeEpoch === null) {
      try {
        const refreshed = await refreshVerifiedEpoch();
        activeEpoch = refreshed?.value ?? null;
      } catch (cause) {
        if (isOwnerCurrent()) {
          onError(getSyncErrorMessage(cause));
          events.setCloudAvailable(false);
        }
        await refreshPending();
        return;
      }
      if (activeEpoch === null) {
        if (isOwnerCurrent()) {
          onError('Cloud generation could not be verified. Your changes remain safe on this device.');
        }
        await refreshPending();
        return;
      }
      if (isOwnerCurrent()) onError(null);
    }
    const database = db;
    let acquired = false;
    try {
      acquired = await acquireDevicePendingFlush(ownerId, manualRetry);
    } catch (cause) {
      console.warn('The device sync coordinator could not acquire a flush lease.', cause);
      const message = 'The device sync coordinator could not be reached. Your changes remain safe on this device; retry after checking the local app connection.';
      if (isOwnerCurrent()) {
        onError(message);
        events.reportError(message);
      }
      await refreshPending();
      return;
    }
    if (!acquired) {
      if (isOwnerCurrent()) {
        onError('Another SonFlash tab is syncing these changes. They remain safe on this device; close the other tab or retry in a moment.');
      }
      await refreshPending();
      return;
    }
    if (isOwnerCurrent()) {
      onSyncing(true);
      onError(null);
    }
    try {
      const pending = mergePendingOperations(await loadDevicePending(ownerId))
        .filter(operation => operation.ownerUserId === ownerId);
      let plan = partitionPendingOperationsByLibraryEpoch(pending, activeEpoch);
      if (plan.future.length) {
        const refreshed = await refreshVerifiedEpoch(activeEpoch);
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
          });
          await deleteMirroredCardIfOlderThan(ownerId, cardId, activeEpoch);
        }
        await acknowledge(plan.stale);
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
          card.normalizedWord || card.word,
          writeEpoch,
        )),
      );
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
          );
        }
      }
      const writes = partitionPendingOperationsForFlush(verified.operationsToWrite);
      const acknowledgedOperations = new Set<DevicePendingOperation>();
      for (const creation of writes.creates) {
        let result;
        try {
          result = await waitForCloudSyncStep(
            createCardIfAbsent(database, ownerId, creation.card, {
              libraryEpoch: activeEpoch,
              baseRevision: creation.baseRevision,
              opId: creation.opId,
              operationCreatedAt: creation.updatedAt,
            }),
          );
        } catch (cause) {
          if (cause instanceof CardMutationPreconditionError && cause.reason === 'deleted') {
            const maximum = {
              libraryEpoch: creation.libraryEpoch ?? activeEpoch,
              revision: creation.baseRevision ?? 0,
            };
            try {
              await deleteDeviceCardBackupIfNotNewerThan(ownerId, creation.card.id, maximum);
              await deleteMirroredCardIfNotNewerThan(ownerId, creation.card.id, maximum);
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
        );
        flushed.push(creation);
      }
      for (const deletion of writes.deletes) {
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
        if (result.deleted) {
          const maximum = {
            libraryEpoch: result.tombstone.libraryEpoch,
            revision: Math.max(0, result.tombstone.revision - 1),
          };
          await deleteDeviceCardBackupIfNotNewerThan(ownerId, deletion.cardId, maximum);
          await deleteMirroredCardIfNotNewerThan(ownerId, deletion.cardId, maximum);
          flushed.push(deletion);
        } else if (result.reason === 'stale-library-epoch') {
          const verifiedEpoch = await refreshVerifiedEpoch(activeEpoch);
          if (!verifiedEpoch) return;
          const latestEpoch = verifiedEpoch.value;
          await deleteDeviceCardBackupIfNotNewerThan(ownerId, deletion.cardId, {
            libraryEpoch: Math.max(0, latestEpoch - 1),
            revision: Number.MAX_SAFE_INTEGER,
          });
          await deleteMirroredCardIfOlderThan(ownerId, deletion.cardId, latestEpoch);
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
        const result = lastReview
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
          if (isOwnerCurrent()) {
            events.advanceCard(patch.cardId, advance);
            events.advancePracticeCard(patch.cardId, advance);
          }
          if (lastReview) {
            await acknowledge([patch]);
            acknowledgedOperations.add(patch);
          }
          flushed.push(patch);
        } else if (result.reason === 'stale-library-epoch') {
          const verifiedEpoch = await refreshVerifiedEpoch(activeEpoch);
          if (!verifiedEpoch) return;
          const latestEpoch = verifiedEpoch.value;
          await deleteDeviceCardBackupIfNotNewerThan(ownerId, patch.cardId, {
            libraryEpoch: Math.max(0, latestEpoch - 1),
            revision: Number.MAX_SAFE_INTEGER,
          });
          await deleteMirroredCardIfOlderThan(ownerId, patch.cardId, latestEpoch);
          flushed.push(patch);
        } else if (result.reason === 'missing') {
          const maximum = {
            libraryEpoch: patch.libraryEpoch ?? activeEpoch,
            revision: patch.baseRevision ?? 0,
          };
          await deleteDeviceCardBackupIfNotNewerThan(ownerId, patch.cardId, maximum);
          await deleteMirroredCardIfNotNewerThan(ownerId, patch.cardId, maximum);
          if (isOwnerCurrent()) {
            events.removeCard(patch.cardId);
            events.removePracticeCard(patch.cardId);
          }
          flushed.push(patch);
        } else if (isOwnerCurrent()) {
          events.reportError(result.reason === 'future-library-epoch'
            ? 'Cloud changed; update remains queued.'
            : 'Card changed; update remains queued.');
        }
      }
      const pendingAcknowledgements = flushed.filter(operation => !acknowledgedOperations.has(operation));
      if (pendingAcknowledgements.length) await acknowledge(pendingAcknowledgements);
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
      await releaseDevicePendingFlush(ownerId);
      await refreshPending();
      if (isOwnerCurrent()) onSyncing(false);
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
          await deleteMirroredCard(ownerId, operation.cardId);
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
    if (isOwnerCurrent()) {
      onError(null);
      onSyncing(true);
    }
    let verifiedEpoch: CloudSyncEpoch | null = null;
    try {
      const renderedEpoch = getEpoch();
      const minimumEpoch = renderedEpoch?.userId === ownerId ? renderedEpoch.value : 0;
      verifiedEpoch = await refreshVerifiedEpoch(minimumEpoch);
      if (verifiedEpoch) await refreshPending();
    } catch (cause) {
      if (isOwnerCurrent()) {
        onError(getSyncErrorMessage(cause) || 'Cloud generation unverified. Changes remain safe on this device.');
      }
    } finally {
      if (isOwnerCurrent()) onSyncing(false);
    }
    if (!verifiedEpoch || !isOwnerCurrent()) return;
    await flush({ manualRetry: true, verifiedEpoch, isBrowserOnline: true });
  };

  return { acknowledge, flush, refreshMirror, refreshPending, retry, stage };
}

export type { DeviceDeleteContext, DevicePendingOperation };
