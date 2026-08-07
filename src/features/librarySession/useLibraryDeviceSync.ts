import { useCallback, useEffect, useRef, useState } from 'react';
import { withTimeout } from '../../lib/async';
import { applyCardPatchWithConflictRecovery, deleteCardWithConflictRecovery } from '../../lib/cardConflictRecovery';
import { applySuccessfulPatchMetadata, partitionPendingOperationsByLibraryEpoch, partitionPendingOperationsForFlush, verifyPendingCardOperations } from '../../lib/cardCreation';
import {
  beginCardMirrorSync, deleteMirroredCard, finishCardMirrorSync, getCardMirrorStatus,
  isCardMirrorFresh, patchMirroredCardBatch, queryMirroredCardPage, upsertMirroredCardBatch,
} from '../../lib/cardMirror';
import { selectMutableCardPatch } from '../../lib/cardMutationProtocol';
import type { CardQueryState } from '../../lib/cardQuery';
import { createLocalCardPage } from '../../lib/cardQuery';
import {
  acknowledgeDevicePending as acknowledgeStoredDevicePending, acquireDevicePendingFlush,
  loadDeviceCards, loadDevicePending, mergeDeviceCards, mergePendingOperations,
  queueDeviceDeletes, queueDevicePatches, queueDeviceUpserts, releaseDevicePendingFlush,
  subscribeToDeviceCards,
  type DevicePendingOperation,
} from '../../lib/deviceSync';
import {
  applyCardPatchIfCurrent, createCardIfAbsent, deleteCardWithTombstone, findCardByNormalizedWord,
  getLibraryEpoch, streamAllCardsInBatches,
} from '../../lib/cardRepository';
import { canUseDeviceBackupForSession } from '../../lib/sessionCards';
import type { CardData } from '../../types/card';
import { db, isFirebaseConfigured } from '../../lib/firebase';
import { canAttemptCloudSync, countPendingSyncOperations, getSyncErrorMessage, resolveSyncEpoch, type CloudSyncEpoch } from '../sync/syncHealthModel';
import {
  cloudBackoffCacheKey, isCloudBackoffActive, isQuotaError, normalizeCardForStorage,
  normalizeLocalCards, persistLocalCardBackup, removeLocalValue, writeLocalValue,
} from '../library/libraryStorage';
import { shouldResetLibraryPageAfterSync } from '../library/libraryPresentation';
import { overlayRecentlyPromotedCards } from '../library/libraryPresentation';

const CLOUD_SYNC_STEP_TIMEOUT_MS = 15_000;
const cloudSyncTimeoutMessage = 'Firebase did not respond in time. Your changes remain safe on this device; retry when the connection is stable.';
const waitForCloudSyncStep = <T,>(operation: Promise<T>): Promise<T> =>
  withTimeout(operation, CLOUD_SYNC_STEP_TIMEOUT_MS, cloudSyncTimeoutMessage);

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

export function useLibraryDeviceSync({
  owner, epoch, cards, knownLibraryTotal, cloudTotal, cloudStatsTotal, cardsPerPage,
  isBrowserOnline, cloudReadUnavailable, query, queryKey, currentPage, getPromotedCards, events,
}: UseLibraryDeviceSyncOptions) {
  const [isSyncing, setIsSyncing] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const ownerRef = useRef(owner?.uid ?? null);
  const cardsRef = useRef(cards);
  const mirrorSyncRef = useRef<{ userId: string; promise: Promise<number> } | null>(null);
  ownerRef.current = owner?.uid ?? null;
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

  const acknowledge = useCallback(async (operations: readonly DevicePendingOperation[]) => {
    await acknowledgeStoredDevicePending([...operations]);
    const userId = ownerRef.current;
    if (userId && operations.some(operation => operation.ownerUserId === userId)) await refreshPending(userId);
  }, [refreshPending]);

  useEffect(() => {
    setIsSyncing(false);
    if (!owner) {
      setPendingCount(0);
      setError(null);
      return;
    }
    void refreshPending(owner.uid);
  }, [owner, refreshPending]);

  const getFallback = useCallback(async (filters: CardQueryState, page: number) => {
    if (owner) {
      try {
        const status = await getCardMirrorStatus(owner.uid);
        if (status?.complete) return await queryMirroredCardPage(owner.uid, filters, page, cardsPerPage)
          ?? { items: [], total: 0, hasNext: false };
      } catch (cause) {
        console.warn('The IndexedDB card mirror is unavailable; trying the shared device backup.', cause);
      }
    }
    const backup = await loadDeviceCards();
    if (backup?.ownerUserId === undefined || !canUseDeviceBackupForSession(backup.ownerUserId, owner?.uid ?? null)) return null;
    const localCards = normalizeLocalCards(backup.cards);
    return localCards.length > 0 ? createLocalCardPage(localCards, filters, page, cardsPerPage) : null;
  }, [cardsPerPage, owner]);

  useEffect(() => {
    if (owner && !cloudReadUnavailable) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const refresh = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void loadDeviceCards().then(backup => {
        if (disposed || !backup) return;
        const sharedCards = normalizeLocalCards(backup.cards);
        if (!owner) {
          if (backup.ownerUserId === undefined || !canUseDeviceBackupForSession(backup.ownerUserId, null)) return;
          const visible = overlayRecentlyPromotedCards({ pageCards: sharedCards, promotedCards: [...getPromotedCards()], filters: query, page: currentPage, pageSize: Math.max(cardsPerPage, sharedCards.length) });
          writeLocalValue('lingoflash_cards', JSON.stringify(visible));
          events.publishDeviceCards(visible);
          return;
        }
        if (!cloudReadUnavailable || backup.cloudSync?.userId !== owner.uid) return;
        const page = createLocalCardPage(sharedCards, query, currentPage, cardsPerPage);
        if (page) {
          const visible = overlayRecentlyPromotedCards({ pageCards: page.items, promotedCards: [...getPromotedCards()], filters: query, page: currentPage, pageSize: cardsPerPage });
          writeLocalValue('lingoflash_cards', JSON.stringify(visible));
          events.publishDevicePage(visible, page.total, page.hasNext);
        } else if (currentPage > 1) events.previousPage();
      }), 80);
    };
    const unsubscribe = subscribeToDeviceCards(refresh);
    refresh();
    return () => { disposed = true; if (timer) clearTimeout(timer); unsubscribe(); };
  }, [cardsPerPage, cloudReadUnavailable, currentPage, events, getPromotedCards, owner, query, queryKey]);

  const upsertCards = useCallback(async (changedCards: CardData[], nextTotal?: number) => {
    const epochVerified = !owner || epoch?.userId === owner.uid;
    const activeEpoch = owner && epoch?.userId === owner.uid ? epoch.value : 0;
    const normalized = normalizeLocalCards(changedCards.map(card => ({ ...card, libraryEpoch: activeEpoch })));
    if (normalized.length === 0) return [];
    if (owner) {
      try {
        for (let offset = 0; offset < normalized.length; offset += 100) await upsertMirroredCardBatch(owner.uid, normalized.slice(offset, offset + 100));
      } catch (cause) { console.warn('Cards were queued safely, but the local IndexedDB mirror could not be updated.', cause); }
    }
    const queued = await queueDeviceUpserts(
      normalized.map(normalizeCardForStorage),
      Math.max(nextTotal ?? 0, normalized.length),
      owner?.uid,
      !epochVerified,
    );
    if (owner) void refreshPending(owner.uid);
    return queued;
  }, [epoch, owner, refreshPending]);

  const patchCards = useCallback(async (changes: readonly { card: CardData; fields: Partial<CardData> }[], nextTotal?: number, operationId?: string) => {
    const epochVerified = !owner || epoch?.userId === owner.uid;
    const activeEpoch = owner && epoch?.userId === owner.uid ? epoch.value : 0;
    const normalized = changes.flatMap(({ card, fields }) => {
      const normalizedCard = normalizeCardForStorage({ ...card, libraryEpoch: activeEpoch });
      const normalizedFields = Object.fromEntries((Object.keys(fields) as Array<keyof CardData>).flatMap(key =>
        normalizedCard[key] === undefined ? [] : [[key, normalizedCard[key]]])) as Partial<CardData>;
      return Object.keys(normalizedFields).length ? [{ card: normalizedCard, fields: normalizedFields }] : [];
    });
    if (!normalized.length) return [];
    if (owner) {
      try {
        for (let offset = 0; offset < normalized.length; offset += 100) await patchMirroredCardBatch(owner.uid, normalized.slice(offset, offset + 100).map(change => ({ cardId: change.card.id, fields: change.fields })));
      } catch (cause) { console.warn('Card patches were queued safely, but the local IndexedDB mirror could not be updated.', cause); }
    }
    const queued = await queueDevicePatches(
      normalized,
      Math.max(nextTotal ?? 0, normalized.length),
      owner?.uid,
      operationId,
      !epochVerified,
    );
    if (owner) void refreshPending(owner.uid);
    return queued;
  }, [epoch, owner, refreshPending]);

  const removeCard = useCallback(async (cardId: string) => {
    if (owner && epoch?.userId !== owner.uid) throw new Error('Cloud sync generation is not verified for this account.');
    const activeEpoch = owner && epoch?.userId === owner.uid ? epoch.value : 0;
    const source = cardsRef.current.find(card => card.id === cardId) ?? events.findPracticeCard(cardId);
    const queued = await queueDeviceDeletes([cardId], owner?.uid, { libraryEpoch: activeEpoch, baseRevisions: { [cardId]: source?.revision ?? 0 } });
    if (owner) {
      try { await deleteMirroredCard(owner.uid, cardId); }
      catch (cause) { console.warn('The card delete was queued, but the local IndexedDB mirror could not be updated.', cause); }
      void refreshPending(owner.uid);
    }
    return queued;
  }, [epoch, events, owner, refreshPending]);

  const flush = useCallback(async (
    manualRetry = false,
    verifiedEpoch: CloudSyncEpoch | null = null,
  ) => {
    if (!db || !owner || !isFirebaseConfigured) return;
    if (!canAttemptCloudSync(isCloudBackoffActive(owner.uid), manualRetry)) return;
    const activeEpoch = resolveSyncEpoch(owner.uid, epoch, verifiedEpoch);
    if (activeEpoch === null) {
      setError('Cloud pending; saved locally.');
      await refreshPending(owner.uid);
      return;
    }
    const database = db;
    const userId = owner.uid;
    if (!await acquireDevicePendingFlush(userId, manualRetry)) { await refreshPending(userId); return; }
    setIsSyncing(true);
    setError(null);
    try {
      const pending = mergePendingOperations(await loadDevicePending(userId))
        .filter(operation => operation.ownerUserId === userId);
      const plan = partitionPendingOperationsByLibraryEpoch(pending, activeEpoch);
      if (plan.stale.length) await acknowledge(plan.stale);
      if (plan.future.length && ownerRef.current === userId) setError('Newer changes await cloud check.');
      if (!plan.current.length) return;
      const verified = await waitForCloudSyncStep(
        verifyPendingCardOperations(plan.current, card => findCardByNormalizedWord(database, userId, card.normalizedWord || card.word)),
      );
      const flushed = [...verified.operationsAlreadyExisting];
      for (let index = 0; index < verified.operationsAlreadyExisting.length; index += 1) {
        const operation = verified.operationsAlreadyExisting[index];
        const existing = verified.existingCards[index];
        if (operation.type === 'upsert') {
          if (operation.card.id !== existing.id) await deleteMirroredCard(userId, operation.card.id);
          await upsertMirroredCardBatch(userId, [existing]);
        }
      }
      const writes = partitionPendingOperationsForFlush(verified.operationsToWrite);
      for (const creation of writes.creates) {
        const result = await waitForCloudSyncStep(
          createCardIfAbsent(database, userId, creation.card, { libraryEpoch: activeEpoch, baseRevision: creation.baseRevision, opId: creation.opId }),
        );
        if (!result.created && creation.card.id !== result.card.id) await deleteMirroredCard(userId, creation.card.id);
        await upsertMirroredCardBatch(userId, [result.card]);
        flushed.push(creation);
      }
      for (const deletion of writes.deletes) {
        const result = await waitForCloudSyncStep(
          deleteCardWithConflictRecovery({ cardId: deletion.cardId, opId: deletion.opId ?? `legacy-delete-${deletion.cardId}-${deletion.updatedAt}`, libraryEpoch: deletion.libraryEpoch ?? 0, baseRevision: deletion.baseRevision ?? 0 }, command => deleteCardWithTombstone(database, userId, command)),
        );
        if (result.deleted || result.reason === 'stale-library-epoch') flushed.push(deletion);
        else if (ownerRef.current === userId) events.reportError(result.reason === 'future-library-epoch' ? 'Cloud changed; delete remains queued.' : 'Card changed; delete remains queued.');
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
        } else if (result.reason === 'stale-library-epoch') flushed.push(patch);
        else if (result.reason === 'missing') {
          await deleteMirroredCard(userId, patch.cardId);
          if (ownerRef.current === userId) { events.removeCard(patch.cardId); events.removePracticeCard(patch.cardId); }
          flushed.push(patch);
        } else if (ownerRef.current === userId) events.reportError(result.reason === 'future-library-epoch' ? 'Cloud changed; update remains queued.' : 'Card changed; update remains queued.');
      }
      await acknowledge(flushed);
      if (ownerRef.current === userId) {
        if (!plan.future.length) setError(null);
        removeLocalValue(cloudBackoffCacheKey(userId));
        events.setCloudAvailable(true);
        if (shouldResetLibraryPageAfterSync(flushed)) events.resetPage();
        events.refreshCloud();
        if (verified.operationsAlreadyExisting.length) events.notify('Cloud card restored; no duplicate.');
      }
    } catch (cause) {
      console.warn('Pending local changes could not be synced to Firebase yet.', cause);
      if (isQuotaError(cause)) writeLocalValue(cloudBackoffCacheKey(owner.uid), String(Date.now() + 5 * 60 * 1000));
      if (ownerRef.current === owner.uid) { setError(getSyncErrorMessage(cause)); events.setCloudAvailable(false); }
    } finally {
      await releaseDevicePendingFlush(owner.uid);
      await refreshPending(owner.uid);
      if (ownerRef.current === owner.uid) setIsSyncing(false);
    }
  }, [acknowledge, epoch, events, owner, refreshPending]);

  useEffect(() => {
    if (!owner || !db || !isFirebaseConfigured) return;
    const tryFlush = () => void flush();
    tryFlush();
    window.addEventListener('focus', tryFlush);
    const interval = window.setInterval(tryFlush, 60_000);
    return () => { window.removeEventListener('focus', tryFlush); window.clearInterval(interval); };
  }, [flush, owner]);

  const syncMirror = useCallback(async (force = false) => {
    if (!db || !owner || !isFirebaseConfigured) return 0;
    const userId = owner.uid;
    const existing = mirrorSyncRef.current;
    if (existing?.userId === userId) return existing.promise;
    const expectedTotal = Math.max(cloudTotal, cloudStatsTotal, cardsRef.current.length);
    const promise = (async () => {
      if (isCloudBackoffActive(userId)) throw new Error('Cloud reads are temporarily paused.');
      const status = await getCardMirrorStatus(userId);
      if (!force && isCardMirrorFresh(status, expectedTotal) && status) return status.loaded;
      const generation = await beginCardMirrorSync(userId, expectedTotal);
      const loaded = await waitForCloudSyncStep(
        streamAllCardsInBatches(db, userId, page => upsertMirroredCardBatch(userId, page, generation), 100),
      );
      const pending = mergePendingOperations(await loadDevicePending(userId)).filter(operation => !operation.ownerUserId || operation.ownerUserId === userId);
      for (const operation of pending) {
        if (operation.type === 'upsert') await upsertMirroredCardBatch(userId, [operation.card], generation);
        else if (operation.type === 'patch') await patchMirroredCardBatch(userId, [{ cardId: operation.cardId, fields: operation.fields }], generation);
        else await deleteMirroredCard(userId, operation.cardId);
      }
      await finishCardMirrorSync(userId, generation, loaded);
      if (ownerRef.current === userId) { events.setCloudTotal(Math.max(cloudTotal, loaded)); events.refreshCloud(); }
      return loaded;
    })();
    mirrorSyncRef.current = { userId, promise };
    try { return await promise; }
    finally { if (mirrorSyncRef.current?.promise === promise) mirrorSyncRef.current = null; }
  }, [cloudStatsTotal, cloudTotal, events, owner]);

  useEffect(() => {
    if (!owner || !isBrowserOnline || isCloudBackoffActive(owner.uid)) return;
    void syncMirror(false).catch(cause => console.warn('Local mirror will retry.', cause));
  }, [isBrowserOnline, owner, syncMirror]);

  const syncNow = useCallback(async () => {
    if (isSyncing) return;
    setIsSyncing(true);
    setError(null);
    try {
      await flush();
      if (owner) {
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
      if (owner) await refreshPending(owner.uid);
      setIsSyncing(false);
    }
  }, [cardsPerPage, events, flush, isSyncing, knownLibraryTotal, owner, refreshPending, syncMirror]);

  const retry = useCallback(async () => {
    if (!owner || isSyncing) return;
    setError(null);
    if (!db || !isFirebaseConfigured) return flush(true);
    if (epoch?.userId !== owner.uid) {
      setIsSyncing(true);
      let verifiedEpoch: CloudSyncEpoch | null = null;
      try {
        const value = await waitForCloudSyncStep(getLibraryEpoch(db, owner.uid));
        if (ownerRef.current !== owner.uid) return;
        verifiedEpoch = { userId: owner.uid, value };
        events.verifyEpoch(verifiedEpoch);
        await refreshPending(owner.uid);
      } catch (cause) { if (ownerRef.current === owner.uid) setError(getSyncErrorMessage(cause) || 'Cloud generation unverified. Changes remain safe on this device.'); }
      finally { if (ownerRef.current === owner.uid) setIsSyncing(false); }
      if (!verifiedEpoch || ownerRef.current !== owner.uid) return;
      await flush(true, verifiedEpoch);
      return;
    }
    await flush(true);
  }, [epoch, events, flush, isSyncing, owner, refreshPending]);

  return { isSyncing, pendingCount, error, getFallback, refreshPending, acknowledge, upsertCards, patchCards, removeCard, flush, syncMirror, syncNow, retry };
}

export type { DevicePendingOperation };
