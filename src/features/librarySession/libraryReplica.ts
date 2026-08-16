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
  claimDevicePendingForFlush,
  deleteDeviceCardBackupIfNotNewerThan,
  DeviceBackupOwnerConflictError,
  loadDevicePending,
  mergeDeviceCardsStrict,
  mergePendingOperations,
  PendingMutationSettlementCapacityError,
  queueDeviceDeletes,
  queueDevicePatches,
  queueDeviceUpserts,
  releaseDevicePendingFlush,
  publishPendingCreateSettlement,
  recordDeviceCardAlias,
  settleDevicePending,
  retargetPendingCardPatches,
  type DeviceDeleteContext,
  type DeviceMutationAccounting,
  type DevicePendingOperation,
  type PendingCreateSettlement,
  type PendingCreateSettlementOutcome,
  type PendingMutationSettlement,
  type PendingMutationSettlementOutcome,
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
const cloudSyncTimeoutMessage = 'Firebase did not respond in time. Your changes remain safe on this device; retry when the connection is stable.';
const mirrorEpochChangedMessage = 'Cloud library changed while the local mirror was syncing.';
const mirrorInterruptedMessage = 'The local card mirror sync was interrupted.';
const waitForCloudSyncStep = <T,>(operation: Promise<T>): Promise<T> =>
  withTimeout(operation, CLOUD_SYNC_STEP_TIMEOUT_MS, cloudSyncTimeoutMessage);

const pendingOperationCardId = (operation: DevicePendingOperation): string =>
  operation.type === 'upsert' ? operation.card.id : operation.cardId;

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

export function classifyPendingCreateSettlement(
  operation: Extract<DevicePendingOperation, { type: 'upsert' }>,
  authoritativeCard: CardData,
  created: boolean,
): PendingCreateSettlementOutcome {
  if (created) return 'created';
  const candidateCreatedAt = operation.card.createdAt;
  return typeof candidateCreatedAt === 'string'
    && candidateCreatedAt.length > 0
    && candidateCreatedAt === authoritativeCard.createdAt
    ? 'replayed'
    : 'duplicate';
}

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
  settleCreate: (settlement: PendingCreateSettlement) => void | Promise<void>;
}

export type LibraryReplicaMutation =
  | { type: 'create'; cards: CardData[]; nextTotal?: number }
  | {
      type: 'patch';
      changes: readonly { card: CardData; fields: Partial<CardData> }[];
      nextTotal?: number;
      operationId?: string;
      accounting?: DeviceMutationAccounting;
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

export interface LibraryReplicaFlushReport {
  settlements: PendingMutationSettlement[];
}

const emptyFlushReport = (): LibraryReplicaFlushReport => ({ settlements: [] });

function mutationSettlementsFor(
  operation: DevicePendingOperation,
  outcome: PendingMutationSettlementOutcome,
  settledAt = new Date().toISOString(),
): PendingMutationSettlement[] {
  if (!operation.ownerUserId || !operation.logicalOperations?.length) return [];
  const cardId = pendingOperationCardId(operation);
  return operation.logicalOperations.map(logicalOperation => ({
    ownerUserId: operation.ownerUserId as string,
    logicalOperationId: logicalOperation.id,
    kind: logicalOperation.kind,
    cardId,
    outcome: operation.type === logicalOperation.kind
      ? outcome
      : 'discarded-superseded',
    settledAt,
    ...(logicalOperation.accounting ? { accounting: logicalOperation.accounting } : {}),
  }));
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
  let pendingFlush: Promise<LibraryReplicaFlushReport> | null = null;
  let pendingMirrorRefresh: Promise<number> | null = null;

  const readActiveEpoch = () => {
    const epoch = getEpoch();
    return epoch?.userId === ownerId
      ? { value: epoch.value, verified: true }
      : { value: 0, verified: false };
  };

  const readPendingCount = async (): Promise<number | null> => {
    try {
      const pending = mergePendingOperations(await loadDevicePending(ownerId));
      const count = countPendingSyncOperations(pending, ownerId);
      if (isOwnerCurrent()) onPendingCount(count);
      return count;
    } catch (cause) {
      if (isOwnerCurrent()) onError(getSyncErrorMessage(cause));
      return null;
    }
  };

  const refreshPending = async () => (await readPendingCount()) ?? 0;

  const clearErrorWhenQueueIsEmpty = async (): Promise<void> => {
    const count = await readPendingCount();
    if (count === 0 && isOwnerCurrent()) onError(null);
  };

  const acknowledge = async (operations: readonly DevicePendingOperation[]) => {
    await acknowledgeDevicePending([...operations]);
    if (operations.some(operation => operation.ownerUserId === ownerId)) {
      await clearErrorWhenQueueIsEmpty();
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
    const queued = await queueDeviceUpserts(
      normalized.map(normalizeCardForStorage),
      Math.max(nextTotal ?? 0, normalized.length),
      ownerId,
      !epoch.verified,
    );
    try {
      for (let offset = 0; offset < normalized.length; offset += 100) {
        await upsertMirroredCardBatch(ownerId, normalized.slice(offset, offset + 100));
      }
    } catch (cause) {
      console.warn('Cards were queued safely, but the local IndexedDB mirror could not be updated.', cause);
    }
    void refreshPending();
    return queued;
  };

  const stagePatch = async (
    changes: readonly { card: CardData; fields: Partial<CardData> }[],
    nextTotal?: number,
    operationId?: string,
    accounting?: DeviceMutationAccounting,
  ): Promise<DevicePendingOperation[]> => {
    const epoch = readActiveEpoch();
    const currentCards = getCards();
    const events = getEvents();
    const normalized = changes.flatMap(({ card, fields }) => {
      const normalizedCard = normalizeCardForStorage({ ...card, libraryEpoch: epoch.value });
      const normalizedFields = Object.fromEntries(
        (Object.keys(fields) as Array<keyof CardData>).flatMap(key =>
          normalizedCard[key] === undefined ? [] : [[key, normalizedCard[key]]]),
      ) as Partial<CardData>;
      if (Object.keys(normalizedFields).length === 0) return [];
      const sourceCard = currentCards.find(candidate => candidate.id === card.id)
        ?? events.findPracticeCard(card.id);
      const normalizedSource = sourceCard
        ? normalizeCardForStorage({ ...sourceCard, libraryEpoch: epoch.value })
        : undefined;
      const baseFields = normalizedSource
        ? Object.fromEntries((Object.keys(normalizedFields) as Array<keyof CardData>).flatMap(key =>
            Object.prototype.hasOwnProperty.call(normalizedSource, key)
              ? [[key, normalizedSource[key]]]
              : [])) as Partial<CardData>
        : undefined;
      return [{
        card: normalizedCard,
        fields: normalizedFields,
        ...(baseFields && Object.keys(baseFields).length === Object.keys(normalizedFields).length
          ? { baseFields }
          : {}),
      }];
    });
    if (normalized.length === 0) return [];
    const queued = await queueDevicePatches(
      normalized,
      Math.max(nextTotal ?? 0, normalized.length),
      ownerId,
      operationId,
      !epoch.verified,
      accounting,
    );
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
      ...(context.logicalOperationId ? {
        logicalOperationId: context.logicalOperationId,
      } : {}),
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
      return stagePatch(
        mutation.changes,
        mutation.nextTotal,
        mutation.operationId,
        mutation.accounting,
      );
    }
    return stageDelete(mutation.cardId, mutation.context);
  };

  const runFlush = async ({
    manualRetry = false,
    verifiedEpoch = null,
    isBrowserOnline,
  }: LibraryReplicaFlushOptions): Promise<LibraryReplicaFlushReport> => {
    const report = emptyFlushReport();
    const events = getEvents();
    const settleMutations = async (
      operations: readonly DevicePendingOperation[],
      settlements: readonly PendingMutationSettlement[],
    ): Promise<void> => {
      const committed = await settleDevicePending(ownerId, operations, settlements);
      report.settlements.push(...committed);
      if (operations.some(operation => operation.ownerUserId === ownerId)) {
        await clearErrorWhenQueueIsEmpty();
      }
    };
    if (!db || !isFirebaseConfigured) {
      if (isOwnerCurrent()) onError('Cloud sync is not configured. Your changes remain safe on this device.');
      await refreshPending();
      return report;
    }
    if (!manualRetry && !isBrowserOnline) return report;
    if (!canAttemptCloudSync(isCloudBackoffActive(ownerId), manualRetry)) {
      if (isOwnerCurrent()) {
        onError('Cloud sync is paused briefly after a service limit. Your changes are safe; retry now or wait a few minutes.');
      }
      await refreshPending();
      return report;
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
        return report;
      }
      if (activeEpoch === null) {
        if (isOwnerCurrent()) {
          onError('Cloud generation could not be verified. Your changes remain safe on this device.');
        }
        await refreshPending();
        return report;
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
      return report;
    }
    if (!acquired) {
      if (isOwnerCurrent()) {
        onError('Another SonFlash tab is syncing these changes. They remain safe on this device; close the other tab or retry in a moment.');
      }
      await refreshPending();
      return report;
    }
    if (isOwnerCurrent()) {
      onSyncing(true);
      onError(null);
    }
    try {
      await loadDevicePending(ownerId);
      const pending = (await claimDevicePendingForFlush(ownerId))
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
        const settledAt = new Date().toISOString();
        await settleMutations(
          plan.stale,
          plan.stale.flatMap(operation => mutationSettlementsFor(
            operation,
            'discarded-stale-library-epoch',
            settledAt,
          )),
        );
      }
      if (plan.future.length && isOwnerCurrent()) {
        onError('Some changes belong to a newer library version than the cloud currently reports. They remain safe on this device; retry after cloud recovery.');
      }
      if (!plan.current.length) return report;
      const writeEpoch = activeEpoch;
      const verified = await waitForCloudSyncStep(
        verifyPendingCardOperations(plan.current, card => findCardByNormalizedWord(
          database,
          ownerId,
          card.normalizedWord || card.word,
          writeEpoch,
        )),
      );
      const settledCreates: Extract<DevicePendingOperation, { type: 'upsert' }>[] = [];
      const createSettlements: PendingCreateSettlement[] = [];
      const acknowledgeSettledCreates = async (): Promise<DevicePendingOperation[]> => {
        if (!settledCreates.length) return [];
        const operations = [...settledCreates];
        const settlements = [...createSettlements];
        const settledAt = new Date().toISOString();
        await settleMutations(
          operations,
          operations.flatMap(operation => mutationSettlementsFor(
            operation,
            'discarded-superseded',
            settledAt,
          )),
        );
        settledCreates.length = 0;
        createSettlements.length = 0;
        for (const settlement of settlements) {
          try {
            await events.settleCreate(settlement);
          } catch (cause) {
            console.warn('A synced create could not publish its local intake settlement.', cause);
          }
          publishPendingCreateSettlement(settlement);
        }
        return operations;
      };
      let deferredSyncError: string | null = null;
      const writes = partitionPendingOperationsForFlush(verified.operationsToWrite);
      const duplicateCreateBaseRevisions = new Map<string, number>();
      const prepareDependentPatches = async (
        creation: Extract<DevicePendingOperation, { type: 'upsert' }>,
        authoritativeCard: CardData,
        outcome: PendingCreateSettlementOutcome,
      ): Promise<void> => {
        const baseRevision = Number.isSafeInteger(creation.baseRevision)
          && Number(creation.baseRevision) >= 0
          ? Number(creation.baseRevision)
          : Number.isSafeInteger(creation.card.revision)
            && Number(creation.card.revision) >= 0
            ? Number(creation.card.revision)
            : 0;
        if (outcome === 'duplicate') {
          duplicateCreateBaseRevisions.set(creation.card.id, baseRevision);
          return;
        }
        if (creation.card.id === authoritativeCard.id) return;
        await recordDeviceCardAlias(
          ownerId,
          creation.card.id,
          authoritativeCard,
          baseRevision,
          creation.libraryEpoch ?? writeEpoch,
        );
        writes.patches = retargetPendingCardPatches(
          writes.patches,
          creation.card.id,
          authoritativeCard,
          baseRevision,
        );
      };
      try {
        for (let index = 0; index < verified.operationsAlreadyExisting.length; index += 1) {
          const operation = verified.operationsAlreadyExisting[index];
          const existing = verified.existingCards[index];
          if (operation.type === 'upsert') {
            const outcome = classifyPendingCreateSettlement(operation, existing, false);
            await prepareDependentPatches(operation, existing, outcome);
            await reconcilePendingUpsertWithAuthoritativeCard(
              ownerId,
              operation,
              existing,
              activeEpoch,
            );
            settledCreates.push(operation);
            createSettlements.push({
              operation,
              authoritativeCard: existing,
              outcome,
            });
          }
        }
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
                settledCreates.push(creation);
              } catch (cleanupCause) {
                console.warn('A create superseded by a cloud delete could not be cleaned up locally.', cleanupCause);
                deferredSyncError = 'One outdated create is still awaiting safe local cleanup; newer changes continued syncing.';
              }
              continue;
            }
            throw cause;
          }
          const outcome = classifyPendingCreateSettlement(
            creation,
            result.card,
            result.created,
          );
          await prepareDependentPatches(creation, result.card, outcome);
          await reconcilePendingUpsertWithAuthoritativeCard(
            ownerId,
            creation,
            result.card,
            activeEpoch,
          );
          settledCreates.push(creation);
          createSettlements.push({
            operation: creation,
            authoritativeCard: result.card,
            outcome,
          });
        }
      } catch (cause) {
        await acknowledgeSettledCreates();
        throw cause;
      }
      const acknowledgedCreates = await acknowledgeSettledCreates();
      const flushed: DevicePendingOperation[] = [...acknowledgedCreates];
      const settledMutations: DevicePendingOperation[] = [];
      const mutationSettlementOutcomes: Array<{
        operation: DevicePendingOperation;
        outcome: PendingMutationSettlementOutcome;
      }> = [];
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
          settledMutations.push(deletion);
          mutationSettlementOutcomes.push({ operation: deletion, outcome: 'applied' });
        } else if (result.reason === 'stale-library-epoch') {
          const verifiedEpoch = await refreshVerifiedEpoch(activeEpoch);
          if (!verifiedEpoch) return report;
          const latestEpoch = verifiedEpoch.value;
          await deleteDeviceCardBackupIfNotNewerThan(ownerId, deletion.cardId, {
            libraryEpoch: Math.max(0, latestEpoch - 1),
            revision: Number.MAX_SAFE_INTEGER,
          });
          await deleteMirroredCardIfOlderThan(ownerId, deletion.cardId, latestEpoch);
          flushed.push(deletion);
          settledMutations.push(deletion);
          mutationSettlementOutcomes.push({
            operation: deletion,
            outcome: 'discarded-stale-library-epoch',
          });
        } else if (isOwnerCurrent()) {
          events.reportError(result.reason === 'future-library-epoch'
            ? 'Cloud changed; delete remains queued.'
            : 'Card changed; delete remains queued.');
        }
      }
      for (const patch of writes.patches) {
        const duplicateBaseRevision = duplicateCreateBaseRevisions.get(patch.cardId);
        if (
          duplicateBaseRevision !== undefined
          && (patch.baseRevision ?? 0) === duplicateBaseRevision
        ) {
          flushed.push(patch);
          settledMutations.push(patch);
          mutationSettlementOutcomes.push({
            operation: patch,
            outcome: 'discarded-superseded',
          });
          continue;
        }
        const fieldMask = patch.fieldMask ?? Object.keys(patch.fields) as Array<keyof CardData>;
        const masked = selectMutableCardPatch(patch.fields, fieldMask);
        const result = await waitForCloudSyncStep(
          applyCardPatchWithConflictRecovery(
            {
              cardId: patch.cardId,
              fields: patch.fields,
              ...(patch.baseFields ? { baseFields: patch.baseFields } : {}),
              fieldMask,
              ...(patch.opId ? { opId: patch.opId } : {}),
              baseRevision: patch.baseRevision ?? 0,
              libraryEpoch: patch.libraryEpoch ?? 0,
            },
            command => applyCardPatchIfCurrent(database, ownerId, command),
          ),
        );
        if (result.applied) {
          if (!result.replayed) {
            const metadata = {
              revision: result.revision,
              libraryEpoch: patch.libraryEpoch ?? activeEpoch,
              updatedAt: new Date().toISOString(),
            };
            const advance = (card: CardData) => card.id === patch.cardId
              ? applySuccessfulPatchMetadata(card, patch.fields, metadata, fieldMask)
              : card;
            await patchMirroredCardBatch(ownerId, [{
              cardId: patch.cardId,
              fields: { ...masked, schemaVersion: 2, ...metadata },
            }]);
            if (isOwnerCurrent()) {
              events.advanceCard(patch.cardId, advance);
              events.advancePracticeCard(patch.cardId, advance);
            }
          }
          flushed.push(patch);
          settledMutations.push(patch);
          mutationSettlementOutcomes.push({
            operation: patch,
            outcome: 'applied',
          });
        } else if (result.reason === 'stale-library-epoch') {
          const verifiedEpoch = await refreshVerifiedEpoch(activeEpoch);
          if (!verifiedEpoch) return report;
          const latestEpoch = verifiedEpoch.value;
          await deleteDeviceCardBackupIfNotNewerThan(ownerId, patch.cardId, {
            libraryEpoch: Math.max(0, latestEpoch - 1),
            revision: Number.MAX_SAFE_INTEGER,
          });
          await deleteMirroredCardIfOlderThan(ownerId, patch.cardId, latestEpoch);
          flushed.push(patch);
          settledMutations.push(patch);
          mutationSettlementOutcomes.push({
            operation: patch,
            outcome: 'discarded-stale-library-epoch',
          });
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
          settledMutations.push(patch);
          mutationSettlementOutcomes.push({
            operation: patch,
            outcome: 'discarded-missing',
          });
        } else if (isOwnerCurrent()) {
          events.reportError(result.reason === 'future-library-epoch'
            ? 'Cloud changed; update remains queued.'
            : 'Card changed; update remains queued.');
        }
      }
      if (settledMutations.length) {
        const settledAt = new Date().toISOString();
        await settleMutations(
          settledMutations,
          mutationSettlementOutcomes.flatMap(({ operation, outcome }) =>
            mutationSettlementsFor(operation, outcome, settledAt)),
        );
      }
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
      if (cause instanceof PendingMutationSettlementCapacityError) {
        console.warn('Pending local changes are paused until learning settlements are drained.', cause);
        if (isOwnerCurrent()) {
          onError('Local learning settlement capacity is full. Cloud changes remain queued safely and will retry after queued XP is stored.');
          events.setCloudAvailable(true);
        }
      } else {
        if (cause instanceof CardMutationPreconditionError && cause.reason === 'stale-library-epoch') {
          try {
            await refreshVerifiedEpoch(activeEpoch);
          } catch (epochCause) {
            console.warn('The current cloud library generation could not be refreshed.', epochCause);
          }
        }
        console.warn('Pending local changes could not be synced to Firebase yet.', cause);
        if (isQuotaError(cause)) {
          writeLocalValue(cloudBackoffCacheKey(ownerId), String(Date.now() + 5 * 60 * 1_000));
        }
        if (isOwnerCurrent()) {
          onError(getSyncErrorMessage(cause));
          events.setCloudAvailable(false);
        }
      }
    } finally {
      await releaseDevicePendingFlush(ownerId);
      await clearErrorWhenQueueIsEmpty();
      if (isOwnerCurrent()) onSyncing(false);
    }
    return report;
  };

  const flush = (options: LibraryReplicaFlushOptions): Promise<LibraryReplicaFlushReport> => {
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
    // Both totals count raw cloud documents. The active-epoch mirror intentionally publishes
    // fewer records when old or future generations coexist during a destructive refresh.
    const expectedTotal = Math.max(cloudTotal, cloudStatsTotal);
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
    let mirrorEpochChanged = false;
    try {
      const streamedCloudDocumentTotal = await waitForCloudSyncStep(
        streamAllCardsInBatches(db, ownerId, async page => {
          const currentPage = page.filter(card =>
            card.libraryEpoch === undefined || card.libraryEpoch === capturedMirrorEpoch);
          loaded += currentPage.length;
          await upsertMirroredCardBatch(ownerId, currentPage, generation);
        }, 100),
      );
      const streamedMirrorEpoch = await waitForCloudSyncStep(getLibraryEpoch(db, ownerId));
      if (streamedMirrorEpoch !== capturedMirrorEpoch) {
        mirrorEpochChanged = true;
        throw new Error(mirrorEpochChangedMessage);
      }
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
      if (overlaidMirrorEpoch !== capturedMirrorEpoch) {
        mirrorEpochChanged = true;
        throw new Error(mirrorEpochChangedMessage);
      }
      const completed = await finishCardMirrorSync(
        ownerId,
        generation,
        expectedTotal,
        streamedCloudDocumentTotal,
      );
      if (!completed) throw new Error(mirrorInterruptedMessage);
      const publishedMirrorEpoch = await waitForCloudSyncStep(getLibraryEpoch(db, ownerId));
      if (publishedMirrorEpoch !== capturedMirrorEpoch) {
        mirrorEpochChanged = true;
        throw new Error(mirrorEpochChangedMessage);
      }
    } catch (cause) {
      try {
        if (mirrorEpochChanged) {
          await invalidateCardMirrorGeneration(ownerId, generation, false);
        } else {
          await invalidateCardMirrorGeneration(ownerId, generation);
        }
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
