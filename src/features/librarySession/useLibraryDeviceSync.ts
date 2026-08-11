import { useCallback, useEffect, useRef, useState } from 'react';
import { withTimeout } from '../../lib/async';
import { applyCardPatchWithConflictRecovery, deleteCardWithConflictRecovery } from '../../lib/cardConflictRecovery';
import { applySuccessfulPatchMetadata, partitionPendingOperationsByLibraryEpoch, partitionPendingOperationsForFlush, verifyPendingCardOperations } from '../../lib/cardCreation';
import {
  beginCardMirrorSync, deleteMirroredCard, deleteMirroredCardIfNotNewerThan,
  deleteMirroredCardIfOlderThan,
  finishCardMirrorSync, getCardMirrorStatus, invalidateCardMirrorGeneration,
  isCardMirrorFresh, patchMirroredCardBatch, queryMirroredCardPage,
  upsertMirroredCardBatch, upsertMirroredCardIfNotOlderThan,
} from '../../lib/cardMirror';
import { selectMutableCardPatch } from '../../lib/cardMutationProtocol';
import type { CardQueryState } from '../../lib/cardQuery';
import { createLocalCardPage } from '../../lib/cardQuery';
import {
  acknowledgeDevicePending as acknowledgeStoredDevicePending, acquireDevicePendingFlush,
  deleteDeviceCardBackupIfNotNewerThan, loadDeviceCards, loadDevicePending,
  DeviceBackupOwnerConflictError, mergeDeviceCards, mergeDeviceCardsStrict, mergePendingOperations,
  queueDeviceDeletes, queueDevicePatches, queueDeviceUpserts, releaseDevicePendingFlush,
  subscribeToDeviceCards,
  type DeviceDeleteContext,
  type DevicePendingOperation,
} from '../../lib/deviceSync';
import {
  applyCardPatchIfCurrent, CardMutationPreconditionError, createCardIfAbsent,
  deleteCardWithTombstone, findCardByNormalizedWord,
  getLibraryEpoch, streamAllCardsInBatches,
} from '../../lib/cardRepository';
import { canUseDeviceBackupForSession } from '../../lib/sessionCards';
import type { CardData } from '../../types/card';
import { db, isFirebaseConfigured } from '../../lib/firebase';
import { canAttemptCloudSync, countPendingSyncOperations, getSyncErrorMessage, resolveSyncEpoch, type CloudSyncEpoch } from '../sync/syncHealthModel';
import {
  cloudBackoffCacheKey, isCloudBackoffActive, isQuotaError, normalizeCardForStorage,
  normalizeLocalCards, persistLocalCardBackup, removeLocalValue,
  writeLocalCardCache, writeLocalValue,
} from '../library/libraryStorage';
import { shouldResetLibraryPageAfterSync } from '../library/libraryPresentation';
import { overlayRecentlyPromotedCards } from '../library/libraryPresentation';

const CLOUD_SYNC_STEP_TIMEOUT_MS = 15_000;
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

export interface LibraryDeviceOwner { readonly uid: string }
export interface LibraryEpoch { readonly userId: string; readonly value: number }
export interface LibraryDeviceSyncEvents {
  advanceCard: (cardId: string, advance: (card: CardData) => CardData) => void;
  removeCard: (cardId: string) => void;
  findPracticeCard: (cardId: string) => CardData | undefined;
  advancePracticeCard: (cardId: string, advance: (card: CardData) => CardData) => void;
  removePracticeCard: (cardId: string) => void;
  resetPage: () => void;
  refreshCloud: () => void;
  setCloudAvailable: (available: boolean) => void;
  setCloudTotal: (total: number) => void;
  publishDeviceCards: (cards: CardData[]) => void;
  publishDevicePage: (cards: CardData[], total: number, hasNext: boolean) => void;
  previousPage: () => void;
  reportError: (message: string) => void;
  notify: (message: string) => void;
  verifyEpoch: (epoch: LibraryEpoch) => void;
}

export interface UseLibraryDeviceSyncOptions {
  owner: LibraryDeviceOwner | null;
  epoch: LibraryEpoch | null;
  cards: readonly CardData[];
  knownLibraryTotal: number;
  cloudTotal: number;
  cloudStatsTotal: number;
  cardsPerPage: number;
  isBrowserOnline: boolean;
  cloudReadUnavailable: boolean;
  query: CardQueryState;
  queryKey: string;
  currentPage: number;
  getPromotedCards: () => readonly CardData[];
  events: LibraryDeviceSyncEvents;
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

export function useLibraryDeviceSync({
  owner, epoch, cards, knownLibraryTotal, cloudTotal, cloudStatsTotal, cardsPerPage,
  isBrowserOnline, cloudReadUnavailable, query, queryKey, currentPage, getPromotedCards, events,
}: UseLibraryDeviceSyncOptions) {
  const [isSyncing, setIsSyncing] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const ownerId = owner?.uid ?? null;
  const epochUserId = epoch?.userId ?? null;
  const epochValue = epoch?.value ?? null;
  const ownerRef = useRef(ownerId);
  const cardsRef = useRef(cards);
  const mirrorSyncRef = useRef<{ userId: string; promise: Promise<number> } | null>(null);
  const pendingFlushRef = useRef<{ userId: string; promise: Promise<void> } | null>(null);
  ownerRef.current = ownerId;
  cardsRef.current = cards;

  const refreshPending = useCallback(async (userId: string) => {
    try {
      const count = countPendingSyncOperations(mergePendingOperations(await loadDevicePending(userId)), userId);
      if (ownerRef.current === userId) setPendingCount(count);
      return count;
    } catch (cause) {
      if (ownerRef.current === userId) setError(getSyncErrorMessage(cause));
      return 0;
    }
  }, []);

  const refreshVerifiedEpoch = useCallback(async (
    userId: string,
    minimumEpoch = 0,
  ): Promise<LibraryEpoch | null> => {
    if (!db) return null;
    const value = await waitForCloudSyncStep(getLibraryEpoch(db, userId));
    if (value < minimumEpoch) {
      throw new CardMutationPreconditionError('future-library-epoch');
    }
    return publishVerifiedEpochIfOwnerCurrent(
      userId,
      ownerRef.current,
      value,
      events.verifyEpoch,
    );
  }, [events]);

  const acknowledge = useCallback(async (operations: readonly DevicePendingOperation[]) => {
    await acknowledgeStoredDevicePending([...operations]);
    const userId = ownerRef.current;
    if (userId && operations.some(operation => operation.ownerUserId === userId)) await refreshPending(userId);
  }, [refreshPending]);

  useEffect(() => {
    setIsSyncing(false);
    setPendingCount(0);
    setError(null);
    if (!ownerId) {
      return;
    }
    void refreshPending(ownerId);
  }, [ownerId, refreshPending]);

  const getFallback = useCallback(async (filters: CardQueryState, page: number) => {
    if (ownerId) {
      try {
        const status = await getCardMirrorStatus(ownerId);
        const activeEpoch = epochUserId === ownerId ? epochValue : null;
        const statusEpoch = Number.isSafeInteger(status?.libraryEpoch)
          && Number(status?.libraryEpoch) >= 0
          ? Number(status?.libraryEpoch)
          : 0;
        if (status?.complete && (activeEpoch === null || statusEpoch === activeEpoch)) {
          return await queryMirroredCardPage(ownerId, filters, page, cardsPerPage)
          ?? { items: [], total: 0, hasNext: false };
        }
      } catch (cause) {
        console.warn('The IndexedDB card mirror is unavailable; trying the shared device backup.', cause);
      }
    }
    const backup = await loadDeviceCards();
    if (backup?.ownerUserId === undefined || !canUseDeviceBackupForSession(backup.ownerUserId, ownerId)) return null;
    const localCards = normalizeLocalCards(backup.cards);
    return localCards.length > 0 ? createLocalCardPage(localCards, filters, page, cardsPerPage) : null;
  }, [cardsPerPage, epochUserId, epochValue, ownerId]);

  useEffect(() => {
    if (ownerId && !cloudReadUnavailable) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const refresh = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void loadDeviceCards().then(backup => {
        if (disposed || !backup) return;
        const sharedCards = normalizeLocalCards(backup.cards);
        if (!ownerId) {
          if (backup.ownerUserId === undefined || !canUseDeviceBackupForSession(backup.ownerUserId, null)) return;
          const visible = overlayRecentlyPromotedCards({ pageCards: sharedCards, promotedCards: [...getPromotedCards()], filters: query, page: currentPage, pageSize: Math.max(cardsPerPage, sharedCards.length) });
          writeLocalCardCache(visible, null);
          events.publishDeviceCards(visible);
          return;
        }
        if (!cloudReadUnavailable || backup.cloudSync?.userId !== ownerId) return;
        const page = createLocalCardPage(sharedCards, query, currentPage, cardsPerPage);
        if (page) {
          const visible = overlayRecentlyPromotedCards({ pageCards: page.items, promotedCards: [...getPromotedCards()], filters: query, page: currentPage, pageSize: cardsPerPage });
          writeLocalCardCache(visible, ownerId);
          events.publishDevicePage(visible, page.total, page.hasNext);
        } else if (currentPage > 1) events.previousPage();
      }), 80);
    };
    const unsubscribe = subscribeToDeviceCards(refresh);
    refresh();
    return () => { disposed = true; if (timer) clearTimeout(timer); unsubscribe(); };
  }, [cardsPerPage, cloudReadUnavailable, currentPage, events, getPromotedCards, ownerId, query, queryKey]);

  const upsertCards = useCallback(async (changedCards: CardData[], nextTotal?: number) => {
    const epochVerified = !ownerId || epochUserId === ownerId;
    const activeEpoch = ownerId && epochUserId === ownerId ? epochValue ?? 0 : 0;
    const normalized = normalizeLocalCards(changedCards.map(card => ({ ...card, libraryEpoch: activeEpoch })));
    if (normalized.length === 0) return [];
    if (ownerId) {
      try {
        for (let offset = 0; offset < normalized.length; offset += 100) await upsertMirroredCardBatch(ownerId, normalized.slice(offset, offset + 100));
      } catch (cause) { console.warn('Cards were queued safely, but the local IndexedDB mirror could not be updated.', cause); }
    }
    const queued = await queueDeviceUpserts(
      normalized.map(normalizeCardForStorage),
      Math.max(nextTotal ?? 0, normalized.length),
      ownerId ?? undefined,
      !epochVerified,
    );
    if (ownerId) void refreshPending(ownerId);
    return queued;
  }, [epochUserId, epochValue, ownerId, refreshPending]);

  const patchCards = useCallback(async (changes: readonly { card: CardData; fields: Partial<CardData> }[], nextTotal?: number, operationId?: string) => {
    const epochVerified = !ownerId || epochUserId === ownerId;
    const activeEpoch = ownerId && epochUserId === ownerId ? epochValue ?? 0 : 0;
    const normalized = changes.flatMap(({ card, fields }) => {
      const normalizedCard = normalizeCardForStorage({ ...card, libraryEpoch: activeEpoch });
      const normalizedFields = Object.fromEntries((Object.keys(fields) as Array<keyof CardData>).flatMap(key =>
        normalizedCard[key] === undefined ? [] : [[key, normalizedCard[key]]])) as Partial<CardData>;
      return Object.keys(normalizedFields).length ? [{ card: normalizedCard, fields: normalizedFields }] : [];
    });
    if (!normalized.length) return [];
    if (ownerId) {
      try {
        for (let offset = 0; offset < normalized.length; offset += 100) await patchMirroredCardBatch(ownerId, normalized.slice(offset, offset + 100).map(change => ({ cardId: change.card.id, fields: change.fields })));
      } catch (cause) { console.warn('Card patches were queued safely, but the local IndexedDB mirror could not be updated.', cause); }
    }
    const queued = await queueDevicePatches(
      normalized,
      Math.max(nextTotal ?? 0, normalized.length),
      ownerId ?? undefined,
      operationId,
      !epochVerified,
    );
    if (ownerId) void refreshPending(ownerId);
    return queued;
  }, [epochUserId, epochValue, ownerId, refreshPending]);

  const removeCard = useCallback(async (cardId: string, context: DeviceDeleteContext = {}) => {
    if (ownerId && epochUserId !== ownerId) throw new Error('Cloud sync generation is not verified for this account.');
    const activeEpoch = ownerId && epochUserId === ownerId ? epochValue ?? 0 : 0;
    const source = cardsRef.current.find(card => card.id === cardId) ?? events.findPracticeCard(cardId);
    const cleanupBoundary = {
      libraryEpoch: context.libraryEpoch ?? activeEpoch,
      revision: context.baseRevisions?.[cardId] ?? source?.revision ?? 0,
    };
    const queued = await queueDeviceDeletes([cardId], ownerId ?? undefined, {
      libraryEpoch: cleanupBoundary.libraryEpoch,
      baseRevisions: { [cardId]: cleanupBoundary.revision },
    });
    if (ownerId) {
      try {
        await deleteDeviceCardBackupIfNotNewerThan(ownerId, cardId, cleanupBoundary);
        await deleteMirroredCardIfNotNewerThan(ownerId, cardId, cleanupBoundary);
      } catch (cause) {
        console.warn('The card delete was queued, but local cleanup could not be completed.', cause);
      }
      void refreshPending(ownerId);
    }
    return queued;
  }, [epochUserId, epochValue, events, ownerId, refreshPending]);

  const runFlush = useCallback(async (
    manualRetry = false,
    verifiedEpoch: CloudSyncEpoch | null = null,
  ) => {
    if (!ownerId) return;
    const userId = ownerId;
    if (!db || !isFirebaseConfigured) {
      setError('Cloud sync is not configured. Your changes remain safe on this device.');
      await refreshPending(userId);
      return;
    }
    if (!manualRetry && !isBrowserOnline) return;
    if (!canAttemptCloudSync(isCloudBackoffActive(userId), manualRetry)) {
      setError('Cloud sync is paused briefly after a service limit. Your changes are safe; retry now or wait a few minutes.');
      await refreshPending(userId);
      return;
    }
    const renderedEpoch = epochUserId === userId && epochValue !== null
      ? { userId: epochUserId, value: epochValue }
      : null;
    let activeEpoch = resolveSyncEpoch(userId, renderedEpoch, verifiedEpoch);
    if (activeEpoch === null) {
      try {
        const refreshed = await refreshVerifiedEpoch(userId);
        activeEpoch = refreshed?.value ?? null;
      } catch (cause) {
        if (ownerRef.current === userId) {
          setError(getSyncErrorMessage(cause));
          events.setCloudAvailable(false);
        }
        await refreshPending(userId);
        return;
      }
      if (activeEpoch === null) {
        setError('Cloud generation could not be verified. Your changes remain safe on this device.');
        await refreshPending(userId);
        return;
      }
      if (ownerRef.current === userId) setError(null);
    }
    const database = db;
    let acquired = false;
    try {
      acquired = await acquireDevicePendingFlush(userId, manualRetry);
    } catch (cause) {
      console.warn('The device sync coordinator could not acquire a flush lease.', cause);
      const message = 'The device sync coordinator could not be reached. Your changes remain safe on this device; retry after checking the local app connection.';
      if (ownerRef.current === userId) {
        setError(message);
        events.reportError(message);
      }
      await refreshPending(userId);
      return;
    }
    if (!acquired) {
      if (ownerRef.current === userId) {
        setError('Another SonFlash tab is syncing these changes. They remain safe on this device; close the other tab or retry in a moment.');
      }
      await refreshPending(userId);
      return;
    }
    setIsSyncing(true);
    setError(null);
    try {
      const pending = mergePendingOperations(await loadDevicePending(userId))
        .filter(operation => operation.ownerUserId === userId);
      let plan = partitionPendingOperationsByLibraryEpoch(pending, activeEpoch);
      if (plan.future.length) {
        const refreshed = await refreshVerifiedEpoch(userId, activeEpoch);
        if (refreshed && refreshed.value > activeEpoch) {
          activeEpoch = refreshed.value;
          plan = partitionPendingOperationsByLibraryEpoch(pending, activeEpoch);
        }
      }
      if (plan.stale.length) {
        const staleCardIds = [...new Set(plan.stale.map(pendingOperationCardId))];
        for (const cardId of staleCardIds) {
          await deleteDeviceCardBackupIfNotNewerThan(userId, cardId, {
            libraryEpoch: Math.max(0, activeEpoch - 1),
            revision: Number.MAX_SAFE_INTEGER,
          });
          await deleteMirroredCardIfOlderThan(userId, cardId, activeEpoch);
        }
        await acknowledge(plan.stale);
      }
      if (plan.future.length && ownerRef.current === userId) {
        setError('Some changes belong to a newer library version than the cloud currently reports. They remain safe on this device; retry after cloud recovery.');
      }
      if (!plan.current.length) return;
      const writeEpoch = activeEpoch;
      const verified = await waitForCloudSyncStep(
        verifyPendingCardOperations(plan.current, card => findCardByNormalizedWord(
          database,
          userId,
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
            userId,
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
            createCardIfAbsent(database, userId, creation.card, {
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
              await deleteDeviceCardBackupIfNotNewerThan(
                userId,
                creation.card.id,
                maximum,
              );
              await deleteMirroredCardIfNotNewerThan(
                userId,
                creation.card.id,
                maximum,
              );
              if (ownerRef.current === userId) {
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
          userId,
          creation,
          result.card,
          activeEpoch,
        );
        flushed.push(creation);
      }
      for (const deletion of writes.deletes) {
        const result = await waitForCloudSyncStep(
          deleteCardWithConflictRecovery({ cardId: deletion.cardId, opId: deletion.opId ?? `legacy-delete-${deletion.cardId}-${deletion.updatedAt}`, libraryEpoch: deletion.libraryEpoch ?? 0, baseRevision: deletion.baseRevision ?? 0 }, command => deleteCardWithTombstone(database, userId, command)),
        );
        if (result.deleted) {
          const maximum = {
            libraryEpoch: result.tombstone.libraryEpoch,
            revision: Math.max(0, result.tombstone.revision - 1),
          };
          await deleteDeviceCardBackupIfNotNewerThan(userId, deletion.cardId, maximum);
          await deleteMirroredCardIfNotNewerThan(userId, deletion.cardId, maximum);
          flushed.push(deletion);
        } else if (result.reason === 'stale-library-epoch') {
          const verifiedEpoch = await refreshVerifiedEpoch(userId, activeEpoch);
          if (!verifiedEpoch) return;
          const latestEpoch = verifiedEpoch.value;
          await deleteDeviceCardBackupIfNotNewerThan(userId, deletion.cardId, {
            libraryEpoch: Math.max(0, latestEpoch - 1),
            revision: Number.MAX_SAFE_INTEGER,
          });
          await deleteMirroredCardIfOlderThan(userId, deletion.cardId, latestEpoch);
          flushed.push(deletion);
        } else if (ownerRef.current === userId) events.reportError(result.reason === 'future-library-epoch' ? 'Cloud changed; delete remains queued.' : 'Card changed; delete remains queued.');
      }
      for (const patch of writes.patches) {
        const fieldMask = patch.fieldMask ?? Object.keys(patch.fields) as Array<keyof CardData>;
        const masked = selectMutableCardPatch(patch.fields, fieldMask);
        const result = await waitForCloudSyncStep(
          applyCardPatchWithConflictRecovery({ cardId: patch.cardId, fields: patch.fields, fieldMask, baseRevision: patch.baseRevision ?? 0, libraryEpoch: patch.libraryEpoch ?? 0 }, command => applyCardPatchIfCurrent(database, userId, command)),
        );
        if (result.applied) {
          const metadata = { revision: result.revision, libraryEpoch: patch.libraryEpoch ?? activeEpoch, updatedAt: new Date().toISOString() };
          const advance = (card: CardData) => card.id === patch.cardId ? applySuccessfulPatchMetadata(card, patch.fields, metadata, fieldMask) : card;
          await patchMirroredCardBatch(userId, [{ cardId: patch.cardId, fields: { ...masked, schemaVersion: 2, ...metadata } }]);
          if (ownerRef.current === userId) { events.advanceCard(patch.cardId, advance); events.advancePracticeCard(patch.cardId, advance); }
          flushed.push(patch);
        } else if (result.reason === 'stale-library-epoch') {
          const verifiedEpoch = await refreshVerifiedEpoch(userId, activeEpoch);
          if (!verifiedEpoch) return;
          const latestEpoch = verifiedEpoch.value;
          await deleteDeviceCardBackupIfNotNewerThan(userId, patch.cardId, {
            libraryEpoch: Math.max(0, latestEpoch - 1),
            revision: Number.MAX_SAFE_INTEGER,
          });
          await deleteMirroredCardIfOlderThan(userId, patch.cardId, latestEpoch);
          flushed.push(patch);
        }
        else if (result.reason === 'missing') {
          const maximum = {
            libraryEpoch: patch.libraryEpoch ?? activeEpoch,
            revision: patch.baseRevision ?? 0,
          };
          await deleteDeviceCardBackupIfNotNewerThan(userId, patch.cardId, maximum);
          await deleteMirroredCardIfNotNewerThan(userId, patch.cardId, maximum);
          if (ownerRef.current === userId) { events.removeCard(patch.cardId); events.removePracticeCard(patch.cardId); }
          flushed.push(patch);
        } else if (ownerRef.current === userId) events.reportError(result.reason === 'future-library-epoch' ? 'Cloud changed; update remains queued.' : 'Card changed; update remains queued.');
      }
      await acknowledge(flushed);
      if (ownerRef.current === userId) {
        if (deferredSyncError) setError(deferredSyncError);
        else if (!plan.future.length) setError(null);
        removeLocalValue(cloudBackoffCacheKey(userId));
        events.setCloudAvailable(true);
        if (shouldResetLibraryPageAfterSync(flushed)) events.resetPage();
        events.refreshCloud();
        if (verified.operationsAlreadyExisting.length) events.notify('Cloud card restored; no duplicate.');
      }
    } catch (cause) {
      if (
        cause instanceof CardMutationPreconditionError
        && cause.reason === 'stale-library-epoch'
      ) {
        try {
          await refreshVerifiedEpoch(userId, activeEpoch);
        } catch (epochCause) {
          console.warn('The current cloud library generation could not be refreshed.', epochCause);
        }
      }
      console.warn('Pending local changes could not be synced to Firebase yet.', cause);
      if (isQuotaError(cause)) writeLocalValue(cloudBackoffCacheKey(userId), String(Date.now() + 5 * 60 * 1000));
      if (ownerRef.current === userId) { setError(getSyncErrorMessage(cause)); events.setCloudAvailable(false); }
    } finally {
      await releaseDevicePendingFlush(userId);
      await refreshPending(userId);
      if (ownerRef.current === userId) setIsSyncing(false);
    }
  }, [acknowledge, epochUserId, epochValue, events, isBrowserOnline, ownerId, refreshPending, refreshVerifiedEpoch]);

  const flush = useCallback((
    manualRetry = false,
    verifiedEpoch: CloudSyncEpoch | null = null,
  ): Promise<void> => {
    if (!ownerId) return Promise.resolve();
    const active = pendingFlushRef.current;
    if (active?.userId === ownerId) return active.promise;
    const promise = runFlush(manualRetry, verifiedEpoch).finally(() => {
      if (pendingFlushRef.current?.promise === promise) pendingFlushRef.current = null;
    });
    pendingFlushRef.current = { userId: ownerId, promise };
    return promise;
  }, [ownerId, runFlush]);

  useEffect(() => {
    if (!ownerId || !db || !isFirebaseConfigured || !isBrowserOnline || pendingCount < 1) return;
    const tryFlush = () => void flush();
    tryFlush();
    window.addEventListener('focus', tryFlush);
    const interval = window.setInterval(tryFlush, 60_000);
    return () => { window.removeEventListener('focus', tryFlush); window.clearInterval(interval); };
  }, [flush, isBrowserOnline, ownerId, pendingCount]);

  const syncMirror = useCallback(async (force = false) => {
    if (!db || !ownerId || !isFirebaseConfigured) return 0;
    const userId = ownerId;
    const existing = mirrorSyncRef.current;
    if (existing?.userId === userId) return existing.promise;
      const expectedTotal = Math.max(cloudTotal, cloudStatsTotal, cardsRef.current.length);
      const promise = (async () => {
        if (isCloudBackoffActive(userId)) throw new Error('Cloud reads are temporarily paused.');
        const capturedMirrorEpoch = await waitForCloudSyncStep(getLibraryEpoch(db, userId));
        const status = await getCardMirrorStatus(userId);
        if (!force && isCardMirrorFresh(
          status,
          expectedTotal,
          Date.now(),
          15 * 60 * 1000,
          capturedMirrorEpoch,
        ) && status) return status.loaded;
        const generation = await beginCardMirrorSync(userId, expectedTotal, capturedMirrorEpoch);
        let loaded = 0;
        try {
          await waitForCloudSyncStep(
            streamAllCardsInBatches(db, userId, async page => {
              const currentPage = page.filter(card =>
                card.libraryEpoch === undefined || card.libraryEpoch === capturedMirrorEpoch);
              loaded += currentPage.length;
              await upsertMirroredCardBatch(userId, currentPage, generation);
            }, 100),
          );
          const streamedMirrorEpoch = await waitForCloudSyncStep(getLibraryEpoch(db, userId));
          if (streamedMirrorEpoch !== capturedMirrorEpoch) throw new Error(mirrorEpochChangedMessage);
          const pending = mergePendingOperations(await loadDevicePending(userId)).filter(operation => !operation.ownerUserId || operation.ownerUserId === userId);
          const pendingPlan = partitionPendingOperationsByLibraryEpoch(pending, capturedMirrorEpoch);
          for (const operation of pendingPlan.current) {
            if (operation.type === 'upsert') await upsertMirroredCardBatch(userId, [operation.card], generation);
            else if (operation.type === 'patch') await patchMirroredCardBatch(userId, [{ cardId: operation.cardId, fields: operation.fields }], generation);
            else await deleteMirroredCard(userId, operation.cardId);
          }
          const overlaidMirrorEpoch = await waitForCloudSyncStep(getLibraryEpoch(db, userId));
          if (overlaidMirrorEpoch !== capturedMirrorEpoch) throw new Error(mirrorEpochChangedMessage);
          const completed = await finishCardMirrorSync(userId, generation, loaded);
          if (!completed) throw new Error(mirrorInterruptedMessage);
          const publishedMirrorEpoch = await waitForCloudSyncStep(getLibraryEpoch(db, userId));
          if (publishedMirrorEpoch !== capturedMirrorEpoch) throw new Error(mirrorEpochChangedMessage);
        } catch (cause) {
          try {
            await invalidateCardMirrorGeneration(userId, generation);
          } catch (invalidationCause) {
            console.warn('The interrupted card mirror generation could not be invalidated.', invalidationCause);
          }
          throw cause;
        }
      if (ownerRef.current === userId) {
        setError(null);
        events.setCloudAvailable(true);
        events.setCloudTotal(Math.max(cloudTotal, loaded));
        events.refreshCloud();
      }
      return loaded;
    })();
    mirrorSyncRef.current = { userId, promise };
    try { return await promise; }
    finally { if (mirrorSyncRef.current?.promise === promise) mirrorSyncRef.current = null; }
  }, [cloudStatsTotal, cloudTotal, events, ownerId]);

  useEffect(() => {
    if (!ownerId || !isBrowserOnline || isCloudBackoffActive(ownerId)) return;
    void syncMirror(false).catch(cause => console.warn('Local mirror will retry.', cause));
  }, [isBrowserOnline, ownerId, syncMirror]);

  const syncNow = useCallback(async () => {
    if (isSyncing) return;
    setIsSyncing(true);
    setError(null);
    try {
      await flush();
      if (ownerId) {
        const count = await syncMirror(true);
        events.notify(`Saved ${count} cards locally.`);
      } else if (!cardsRef.current.length) events.reportError('No browser cards to save locally.');
      else {
        const total = Math.max(cardsRef.current.length, knownLibraryTotal);
        await mergeDeviceCards([...cardsRef.current], total, null);
        persistLocalCardBackup([...cardsRef.current], cardsPerPage, total, null);
        const backup = await loadDeviceCards();
        events.notify(`${backup?.cards.length ?? cardsRef.current.length} cards saved locally.`);
      }
    } catch (cause) {
      console.warn('Device sync could not finish.', cause);
      setError(getSyncErrorMessage(cause));
      events.reportError('Sync is temporarily unavailable. Your changes remain queued and will retry automatically.');
    } finally {
      if (ownerId) await refreshPending(ownerId);
      setIsSyncing(false);
    }
  }, [cardsPerPage, events, flush, isSyncing, knownLibraryTotal, ownerId, refreshPending, syncMirror]);

  const retry = useCallback(async () => {
    if (!ownerId || isSyncing) return;
    setError(null);
    if (!db || !isFirebaseConfigured) return flush(true);
    setIsSyncing(true);
    let verifiedEpoch: CloudSyncEpoch | null = null;
    try {
      const minimumEpoch = epochUserId === ownerId ? epochValue ?? 0 : 0;
      verifiedEpoch = await refreshVerifiedEpoch(ownerId, minimumEpoch);
      if (verifiedEpoch) await refreshPending(ownerId);
    } catch (cause) {
      if (ownerRef.current === ownerId) {
        setError(getSyncErrorMessage(cause) || 'Cloud generation unverified. Changes remain safe on this device.');
      }
    } finally {
      if (ownerRef.current === ownerId) setIsSyncing(false);
    }
    if (!verifiedEpoch || ownerRef.current !== ownerId) return;
    await flush(true, verifiedEpoch);
  }, [epochUserId, epochValue, flush, isSyncing, ownerId, refreshPending, refreshVerifiedEpoch]);

  return { isSyncing, pendingCount, error, getFallback, refreshPending, acknowledge, upsertCards, patchCards, removeCard, flush, syncMirror, syncNow, retry };
}

export type { DevicePendingOperation };
