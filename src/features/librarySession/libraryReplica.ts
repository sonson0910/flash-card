import {
  beginCardMirrorSync,
  deleteMirroredCard,
  deleteMirroredCardIfOlderThan,
  deleteMirroredCardIfNotNewerThan,
  findMirroredCardByWord,
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
import { normalizeCardWord } from '../../lib/cardIdentity';
import {
  applySuccessfulPatchMetadata,
  partitionPendingOperationsByLibraryEpoch,
  partitionPendingOperationsForFlush,
  verifyPendingCardOperations,
} from '../../lib/cardCreation';
import { isRetryableCloudError } from '../../lib/cloudError';
import { selectMutableCardPatch } from '../../lib/cardMutationProtocol';
import {
  acknowledgeDevicePending,
  acquireDevicePendingFlush,
  deleteDeviceCardBackupIfNotNewerThan,
  DeviceBackupOwnerConflictError,
  loadDeviceCards,
  loadDevicePending,
  mergeDeviceCards,
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
  findCardsByNormalizedWords,
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
  readLocalCardCache,
  writeLocalValue,
} from '../library/libraryStorage';
import { canUseDeviceBackupForSession, selectCardsVisibleForSession } from '../../lib/sessionCards';
import { shouldResetLibraryPageAfterSync } from '../library/libraryPresentation';
import {
  canAttemptCloudSync,
  countPendingSyncOperations,
  getSyncErrorMessage,
  resolveSyncEpoch,
  type CloudSyncEpoch,
} from '../sync/syncHealthModel';
import type {
  LibraryReplicaCreateIntent,
  LibraryReplicaCreateReceipt,
  LibraryReplicaExistingSettlementIntent,
  LibraryReplicaIntakePort,
  LibraryReplicaIntakeResolution,
  LibraryReplicaSettlementIntent,
  LibraryReplicaSettlementReceipt,
} from './libraryReplicaIntakeContract';

const CLOUD_SYNC_STEP_TIMEOUT_MS = 15_000;
const INTAKE_CREATE_TIMEOUT_MS = 8_000;
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

interface LocalIntakeCardSelectionOptions {
  currentCards: readonly CardData[];
  cachedCards: unknown;
  cachedOwnerId: string | null | undefined;
  currentOwnerId: string | null;
  libraryEpoch: number | null;
}

const belongsToLibraryEpoch = (card: CardData, libraryEpoch: number | null): boolean =>
  libraryEpoch === null
  || card.libraryEpoch === libraryEpoch
  || (libraryEpoch === 0 && card.libraryEpoch === undefined);

export function selectLocalIntakeCards({
  currentCards,
  cachedCards,
  cachedOwnerId,
  currentOwnerId,
  libraryEpoch,
}: LocalIntakeCardSelectionOptions): CardData[] {
  const current = normalizeLocalCards(currentCards)
    .filter(card => belongsToLibraryEpoch(card, libraryEpoch));
  const cached = cachedOwnerId === undefined
    ? []
    : selectCardsVisibleForSession(
      normalizeLocalCards(cachedCards),
      cachedOwnerId,
      currentOwnerId,
    ).filter(card => belongsToLibraryEpoch(card, libraryEpoch));
  return normalizeLocalCards([...current, ...cached]);
}

export interface LibraryReplicaFlushOptions {
  manualRetry?: boolean;
  verifiedEpoch?: CloudSyncEpoch | null;
  isBrowserOnline: boolean;
}

export interface LibraryReplicaPersistencePort extends LibraryReplicaIntakePort {
  stage: (mutation: LibraryReplicaMutation) => Promise<DevicePendingOperation[]>;
}

export interface AnonymousLibraryReplicaOptions {
  getCards: () => readonly CardData[];
}

/**
 * Local-only replica used before authentication. It deliberately shares the
 * same intent and staging boundary as the owner-scoped replica; the storage
 * adapter remains an implementation detail of this factory.
 */
export function createAnonymousLibraryReplica({
  getCards,
}: AnonymousLibraryReplicaOptions): LibraryReplicaPersistencePort {
  const findExisting = async (words: readonly string[]): Promise<Map<string, CardData>> => {
    const normalizedWords = [...new Set(words.map(normalizeCardWord).filter(Boolean))];
    const matches = new Map<string, CardData>();
    const cached = readLocalCardCache();
    selectLocalIntakeCards({
      currentCards: getCards(),
      cachedCards: cached.cards,
      cachedOwnerId: cached.ownerId,
      currentOwnerId: null,
      libraryEpoch: null,
    }).forEach(card => {
      const key = normalizeCardWord(card.normalizedWord || card.word);
      if (key && !matches.has(key)) matches.set(key, card);
    });
    const backup = await loadDeviceCards();
    if (backup && (backup.ownerUserId === undefined || canUseDeviceBackupForSession(backup.ownerUserId, null))) {
      normalizeLocalCards(backup.cards).forEach(card => {
        const key = normalizeCardWord(card.normalizedWord || card.word);
        if (key && !matches.has(key)) matches.set(key, card);
      });
    }
    return new Map(normalizedWords.flatMap(word =>
      matches.has(word) ? [[word, matches.get(word)!]] : []));
  };

  const createIntakeBatch = async (
    inputs: readonly LibraryReplicaCreateIntent[],
  ): Promise<LibraryReplicaCreateReceipt[]> => {
    if (inputs.length === 0) return [];
    const normalized = inputs.map(({ card }) => normalizeCardForStorage({ ...card, libraryEpoch: 0 }));
    const total = Math.max(...inputs.map(input => input.knownLibraryTotal ?? 0), normalized.length);
    const pending = await queueDeviceUpserts(normalized, total, undefined, false);
    return inputs.map((input, index) => ({
      status: 'queued' as const,
      card: pending[index]?.type === 'upsert' ? pending[index].card : normalized[index],
      libraryEpoch: input.libraryEpoch,
      operationId: pending[index]?.opId ?? null,
    }));
  };

  const createIntake = async (
    input: LibraryReplicaCreateIntent,
  ): Promise<LibraryReplicaCreateReceipt> => {
    const [receipt] = await createIntakeBatch([input]);
    return receipt;
  };

  const resolveIntake = async (
    receipt: LibraryReplicaCreateReceipt,
  ): Promise<LibraryReplicaIntakeResolution> => receipt.status === 'stale'
    ? {
        status: 'stale',
        card: receipt.card,
        created: false,
        queued: false,
        receipt,
        acknowledged: false,
      }
    : {
        status: 'queued',
        card: receipt.card,
        created: true,
        queued: true,
        receipt,
        acknowledged: false,
      };

  const settleIntake = async ({
    receipt,
    outcome,
  }: LibraryReplicaSettlementIntent): Promise<LibraryReplicaSettlementReceipt> => ({
    status: receipt.status === 'stale' ? 'stale' : outcome.status,
    card: outcome.card,
    libraryEpoch: outcome.libraryEpoch,
    revision: outcome.revision,
    acknowledged: false,
  });

  const settleExisting = async ({
    card,
    knownLibraryTotal = 0,
  }: LibraryReplicaExistingSettlementIntent): Promise<void> => {
    try {
      await mergeDeviceCards([card], Math.max(1, knownLibraryTotal), null);
    } catch (cause) {
      console.warn('The existing card could not be copied to the device cache.', cause);
    }
  };

  const stage = async (mutation: LibraryReplicaMutation): Promise<DevicePendingOperation[]> => {
    if (mutation.type === 'create') {
      const normalized = normalizeLocalCards(mutation.cards.map(card => ({ ...card, libraryEpoch: 0 })));
      if (normalized.length === 0) return [];
      return queueDeviceUpserts(
        normalized.map(normalizeCardForStorage),
        Math.max(mutation.nextTotal ?? 0, normalized.length),
        undefined,
        false,
      );
    }
    if (mutation.type === 'patch') {
      const normalized = mutation.changes.flatMap(({ card, fields }) => {
        const normalizedCard = normalizeCardForStorage({ ...card, libraryEpoch: 0 });
        const normalizedFields = Object.fromEntries(
          (Object.keys(fields) as Array<keyof CardData>).flatMap(key =>
            normalizedCard[key] === undefined ? [] : [[key, normalizedCard[key]]]),
        ) as Partial<CardData>;
        return Object.keys(normalizedFields).length
          ? [{ card: normalizedCard, fields: normalizedFields }]
          : [];
      });
      if (normalized.length === 0) return [];
      return queueDevicePatches(
        normalized,
        Math.max(mutation.nextTotal ?? 0, normalized.length),
        undefined,
        mutation.operationId,
        false,
      );
    }
    return queueDeviceDeletes([mutation.cardId], undefined, {
      libraryEpoch: mutation.context?.libraryEpoch,
      baseRevisions: mutation.context?.baseRevisions,
    });
  };

  return {
    findExisting,
    createIntake,
    createIntakeBatch,
    resolveIntake,
    settleIntake,
    settleExisting,
    stage,
  };
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
  const intakeOperations = new Map<string, {
    operation: Extract<DevicePendingOperation, { type: 'upsert' }>;
    knownLibraryTotal: number;
  }>();

  const readActiveEpoch = () => {
    const epoch = getEpoch();
    return epoch?.userId === ownerId
      ? { value: epoch.value, verified: true }
      : { value: 0, verified: false };
  };

  const isReplicaEpochCurrent = (expected: { value: number; verified: boolean }): boolean => {
    const current = readActiveEpoch();
    return isOwnerCurrent()
      && current.value === expected.value
      && current.verified === expected.verified;
  };

  const recoverIntakeOperation = async (operationId: string | null) => {
    let stored = operationId ? intakeOperations.get(operationId) : undefined;
    if (!stored && operationId) {
      try {
        const pending = mergePendingOperations(await loadDevicePending(ownerId));
        const recovered = pending.find(operation =>
          operation.type === 'upsert'
          && operation.ownerUserId === ownerId
          && operation.opId === operationId,
        );
        if (recovered && recovered.type === 'upsert') {
          stored = {
            operation: recovered,
            knownLibraryTotal: 0,
          };
          intakeOperations.set(operationId, stored);
        }
      } catch (cause) {
        console.warn('The queued intake operation could not be recovered yet.', cause);
      }
    }
    return stored;
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
    if (!isReplicaEpochCurrent(epoch)) return [];
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
  ): Promise<DevicePendingOperation[]> => {
    const epoch = readActiveEpoch();
    const normalized = changes.flatMap(({ card, fields }) => {
      const normalizedCard = normalizeCardForStorage({ ...card, libraryEpoch: epoch.value });
      const normalizedFields = Object.fromEntries(
        (Object.keys(fields) as Array<keyof CardData>).flatMap(key =>
          normalizedCard[key] === undefined ? [] : [[key, normalizedCard[key]]]),
      ) as Partial<CardData>;
      return Object.keys(normalizedFields).length
        ? [{ card: normalizedCard, fields: normalizedFields }]
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
    const queued = await queueDevicePatches(
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
      return stagePatch(mutation.changes, mutation.nextTotal, mutation.operationId);
    }
    return stageDelete(mutation.cardId, mutation.context);
  };

  const findExisting = async (words: readonly string[]): Promise<Map<string, CardData>> => {
    const normalizedWords = [...new Set(words.map(normalizeCardWord).filter(Boolean))];
    const activeEpoch = readActiveEpoch();
    const visibleEpoch = activeEpoch.verified ? activeEpoch.value : null;
    const cached = readLocalCardCache();
    const matches = new Map<string, CardData>();
    selectLocalIntakeCards({
      currentCards: getCards(),
      cachedCards: cached.cards,
      cachedOwnerId: cached.ownerId,
      currentOwnerId: ownerId,
      libraryEpoch: visibleEpoch,
    })
      .forEach(card => {
        const key = normalizeCardWord(card.normalizedWord || card.word);
        if (key && !matches.has(key)) matches.set(key, card);
      });

    for (const word of normalizedWords) {
      if (matches.has(word)) continue;
      try {
        const mirrored = await findMirroredCardByWord(ownerId, word);
        if (!isReplicaEpochCurrent(activeEpoch)) return new Map();
        if (mirrored && belongsToLibraryEpoch(mirrored, visibleEpoch)) matches.set(word, mirrored);
      } catch (cause) {
        if (!isOwnerCurrent()) return new Map();
        console.warn('Exact lookup in the local mirror is unavailable.', cause);
      }
    }
    if (db && isFirebaseConfigured && visibleEpoch !== null) {
      try {
        const cloud = await findCardsByNormalizedWords(db, ownerId, normalizedWords, visibleEpoch);
        if (!isReplicaEpochCurrent(activeEpoch)) return new Map();
        cloud.forEach((card, word) => matches.set(word, card));
      } catch (cause) {
        if (!isOwnerCurrent()) return new Map();
        const allWordsFoundLocally = normalizedWords.every(word => matches.has(word));
        if (!allWordsFoundLocally && !isRetryableCloudError(cause)) throw cause;
      }
    }
    if (!isReplicaEpochCurrent(activeEpoch)) return new Map();
    return new Map(normalizedWords.flatMap(word =>
      matches.has(word) ? [[word, matches.get(word)!]] : []));
  };

  const settleExisting = async ({
    card,
    knownLibraryTotal = 0,
  }: LibraryReplicaExistingSettlementIntent): Promise<void> => {
    try {
      await mergeDeviceCardsStrict([card], Math.max(1, knownLibraryTotal), ownerId);
    } catch (cause) {
      if (!(cause instanceof DeviceBackupOwnerConflictError)) {
        console.warn('The existing card could not be copied to the device cache.', cause);
      }
    }
    try {
      await upsertMirroredCardIfNotOlderThan(ownerId, card);
    } catch (cause) {
      console.warn('The existing card mirror could not be refreshed.', cause);
    }
  };

  const createIntakeBatch = async (
    inputs: readonly LibraryReplicaCreateIntent[],
  ): Promise<LibraryReplicaCreateReceipt[]> => {
    if (inputs.length === 0) return [];
    const activeEpoch = readActiveEpoch();
    const staleReceipts = (): LibraryReplicaCreateReceipt[] => inputs.map(input => ({
      status: 'stale' as const,
      card: input.card,
      libraryEpoch: input.libraryEpoch,
      operationId: null,
    }));
    if (!isReplicaEpochCurrent(activeEpoch)) return staleReceipts();
    const receipts: Array<LibraryReplicaCreateReceipt | null> = inputs.map(input =>
      input.libraryEpoch !== activeEpoch.value
        ? {
            status: 'stale',
            card: input.card,
            libraryEpoch: input.libraryEpoch,
            operationId: null,
          }
        : null,
    );
    const currentInputs = inputs.flatMap((input, index) => receipts[index] ? [] : [{ input, index }]);
    if (currentInputs.length === 0) return receipts as LibraryReplicaCreateReceipt[];
    const nextTotal = Math.max(...currentInputs.map(({ input }) => input.knownLibraryTotal ?? 0));
    const queued = await stage({
      type: 'create',
      cards: currentInputs.map(({ input }) => ({ ...input.card, libraryEpoch: input.libraryEpoch })),
      nextTotal,
    });
    if (!isReplicaEpochCurrent(activeEpoch)) return staleReceipts();
    const queuedByWord = new Map<string, Extract<DevicePendingOperation, { type: 'upsert' }>>();
    queued.forEach(operation => {
      if (operation.type !== 'upsert') return;
      const key = normalizeCardWord(operation.card.normalizedWord || operation.card.word);
      if (key) queuedByWord.set(key, operation);
    });
    currentInputs.forEach(({ input, index }, queuedIndex) => {
      const inputKey = normalizeCardWord(input.card.normalizedWord || input.card.word);
      const operation = (inputKey ? queuedByWord.get(inputKey) : undefined) ?? queued[queuedIndex];
      if (!operation || operation.type !== 'upsert') {
        receipts[index] = {
          status: 'queued',
          card: { ...input.card, libraryEpoch: input.libraryEpoch },
          libraryEpoch: input.libraryEpoch,
          operationId: null,
        };
        return;
      }
      const operationId = operation.opId ?? null;
      if (operationId) {
        intakeOperations.set(operationId, {
          operation,
          knownLibraryTotal: input.knownLibraryTotal ?? 0,
        });
      }
      receipts[index] = {
        status: 'queued',
        card: operation.card,
        libraryEpoch: input.libraryEpoch,
        operationId,
      };
    });
    return receipts as LibraryReplicaCreateReceipt[];
  };

  const createIntake = async (input: LibraryReplicaCreateIntent): Promise<LibraryReplicaCreateReceipt> => {
    const [receipt] = await createIntakeBatch([input]);
    return receipt;
  };

  const settleIntake = async ({
    receipt,
    outcome,
  }: LibraryReplicaSettlementIntent): Promise<LibraryReplicaSettlementReceipt> => {
    const activeEpoch = readActiveEpoch();
    const staleSettlement = (): LibraryReplicaSettlementReceipt => ({
      status: 'stale',
      card: outcome.card,
      libraryEpoch: outcome.libraryEpoch,
      revision: outcome.revision,
      acknowledged: false,
    });
    const stored = await recoverIntakeOperation(receipt.operationId);
    if (!isReplicaEpochCurrent(activeEpoch)) return staleSettlement();
    const operation = stored?.operation;
    const contextIsStale = !isReplicaEpochCurrent(activeEpoch);
    const inputIsStale = receipt.status === 'stale'
      || receipt.libraryEpoch !== activeEpoch.value
      || outcome.libraryEpoch !== activeEpoch.value;
    const status = contextIsStale || inputIsStale ? 'stale' : outcome.status;
    const cleanupBoundary = operation
      ? pendingUpsertCleanupBoundary(operation, activeEpoch.value)
      : { libraryEpoch: Math.max(0, outcome.libraryEpoch), revision: Math.max(0, outcome.revision) };
    const cleanupCardId = operation?.card.id ?? outcome.card.id;
    if (status === 'deleted' || status === 'stale') {
      await deleteDeviceCardBackupIfNotNewerThan(ownerId, cleanupCardId, cleanupBoundary);
      await deleteMirroredCardIfNotNewerThan(ownerId, cleanupCardId, cleanupBoundary);
      if (!isReplicaEpochCurrent(activeEpoch)) return staleSettlement();
      if (operation) await acknowledge([operation]);
      if (receipt.operationId) intakeOperations.delete(receipt.operationId);
      return {
        status,
        card: outcome.card,
        libraryEpoch: outcome.libraryEpoch,
        revision: outcome.revision,
        acknowledged: Boolean(operation),
      };
    }

    if (operation) {
      await reconcilePendingUpsertWithAuthoritativeCard(
        ownerId,
        operation,
        outcome.card,
        activeEpoch.value,
      );
      if (!isReplicaEpochCurrent(activeEpoch)) return staleSettlement();
      await acknowledge([operation]);
    } else {
      try {
        await mergeDeviceCardsStrict([outcome.card], Math.max(1, stored?.knownLibraryTotal ?? 0), ownerId);
      } catch (cause) {
        if (!(cause instanceof DeviceBackupOwnerConflictError)) throw cause;
      }
      await upsertMirroredCardIfNotOlderThan(ownerId, outcome.card);
      if (!isReplicaEpochCurrent(activeEpoch)) return staleSettlement();
    }
    if (receipt.operationId) intakeOperations.delete(receipt.operationId);
    return {
      status,
      card: outcome.card,
      libraryEpoch: outcome.libraryEpoch,
      revision: outcome.revision,
      acknowledged: receipt.operationId
        ? Boolean(operation)
        : status === 'created' || status === 'existing',
    };
  };

  const resolveIntake = async (
    receipt: LibraryReplicaCreateReceipt,
  ): Promise<LibraryReplicaIntakeResolution> => {
    const staleResolution = (): LibraryReplicaIntakeResolution => ({
      status: 'stale',
      card: receipt.card,
      created: false,
      queued: false,
      receipt,
      acknowledged: false,
    });
    if (receipt.status === 'stale') {
      return staleResolution();
    }
    const activeEpoch = readActiveEpoch();
    if (!db || !isFirebaseConfigured || !activeEpoch.verified || activeEpoch.value !== receipt.libraryEpoch) {
      return {
        status: 'queued',
        card: receipt.card,
        created: true,
        queued: true,
        receipt,
        acknowledged: false,
      };
    }
    const stored = await recoverIntakeOperation(receipt.operationId);
    if (receipt.operationId && !stored) {
      return {
        status: 'queued',
        card: receipt.card,
        created: true,
        queued: true,
        receipt,
        acknowledged: false,
      };
    }
    if (!isReplicaEpochCurrent(activeEpoch)) return staleResolution();
    const operation = stored?.operation;
    try {
      const result = await withTimeout(
        createCardIfAbsent(db, ownerId, receipt.card, {
          libraryEpoch: receipt.libraryEpoch,
          baseRevision: operation?.baseRevision ?? receipt.card.revision ?? 0,
          ...(operation?.opId || receipt.operationId
            ? { opId: operation?.opId ?? receipt.operationId ?? undefined }
            : {}),
          ...(operation?.updatedAt ? { operationCreatedAt: operation.updatedAt } : {}),
        }),
        INTAKE_CREATE_TIMEOUT_MS,
        'Saving the card took too long. It will remain queued on this device.',
      );
      if (!isReplicaEpochCurrent(activeEpoch)) return staleResolution();
      const status = result.created ? 'created' : 'existing';
      const settled = await settleIntake({
        receipt,
        outcome: {
          status,
          card: result.card,
          libraryEpoch: receipt.libraryEpoch,
          revision: result.card.revision ?? receipt.card.revision ?? 0,
        },
      });
      if (settled.status === 'stale') return staleResolution();
      return {
        status,
        card: result.card,
        created: result.created,
        queued: false,
        receipt,
        acknowledged: settled.acknowledged,
      };
    } catch {
      return {
        status: 'queued',
        card: receipt.card,
        created: true,
        queued: true,
        receipt,
        acknowledged: false,
      };
    }
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
      if (!plan.current.length) return;
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
        const result = await waitForCloudSyncStep(
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
      await acknowledge(flushed);
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

  const intake = {
    findExisting,
    createIntake,
    createIntakeBatch,
    resolveIntake,
    settleIntake,
    settleExisting,
  } satisfies LibraryReplicaIntakePort;
  return { acknowledge, flush, refreshMirror, refreshPending, retry, stage, ...intake };
}

export type { DeviceDeleteContext, DevicePendingOperation };
