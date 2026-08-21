import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  getCardMirrorStatus, queryMirroredCardPage,
} from '../../lib/cardMirror';
import type { CardQueryState } from '../../lib/cardQuery';
import { createLocalCardPage } from '../../lib/cardQuery';
import {
  acknowledgeDevicePending as acknowledgeStoredDevicePending,
  loadDeviceCards,
  mergeDeviceCards,
  subscribeToDeviceCards,
  type DeviceDeleteContext,
  type DevicePendingOperation,
} from '../../lib/deviceSync';
import { canUseDeviceBackupForSession } from '../../lib/sessionCards';
import type { CardData } from '../../types/card';
import { db, isFirebaseConfigured } from '../../lib/firebase';
import { getSyncErrorMessage, type CloudSyncEpoch } from '../sync/syncHealthModel';
import {
  isCloudBackoffActive,
  normalizeLocalCards, persistLocalCardBackup,
  writeLocalCardCache,
} from '../library/libraryStorage';
import { overlayRecentlyPromotedCards } from '../library/libraryPresentation';
import {
  createLibraryReplica,
  createAnonymousLibraryReplica,
  type LibraryReplicaPersistencePort,
  type LibraryEpoch as ReplicaEpoch,
  type LibraryReplicaEvents,
} from './libraryReplica';
export interface LibraryDeviceOwner { readonly uid: string }
export type LibraryEpoch = ReplicaEpoch;
export interface LibraryDeviceSyncEvents extends LibraryReplicaEvents {
  publishDeviceCards: (cards: CardData[]) => void;
  publishDevicePage: (cards: CardData[], total: number, hasNext: boolean) => void;
  previousPage: () => void;
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
  const ownerId = owner?.uid ?? null;
  const epochUserId = epoch?.userId ?? null;
  const epochValue = epoch?.value ?? null;
  const ownerRef = useRef(ownerId);
  const cardsRef = useRef(cards);
  const epochRef = useRef(epoch);
  const eventsRef = useRef(events);
  const cloudTotalRef = useRef(cloudTotal);
  const cloudStatsTotalRef = useRef(cloudStatsTotal);
  ownerRef.current = ownerId;
  cardsRef.current = cards;
  epochRef.current = epoch;
  eventsRef.current = events;
  cloudTotalRef.current = cloudTotal;
  cloudStatsTotalRef.current = cloudStatsTotal;

  const replica = useMemo(() => ownerId ? createLibraryReplica({
    ownerId,
    getEpoch: () => epochRef.current,
    getCards: () => cardsRef.current,
    getEvents: () => eventsRef.current,
    getMirrorTotals: () => ({
      cloudTotal: cloudTotalRef.current,
      cloudStatsTotal: cloudStatsTotalRef.current,
    }),
    isOwnerCurrent: () => ownerRef.current === ownerId,
    onError: setError,
    onPendingCount: setPendingCount,
    onSyncing: setIsSyncing,
  }) : null, [ownerId]);

  const anonymousReplica = useMemo<LibraryReplicaPersistencePort>(() => createAnonymousLibraryReplica({
    getCards: () => cardsRef.current,
  }), []);
  const persistenceReplica = replica ?? anonymousReplica;

  const refreshPending = useCallback(async (userId: string) => {
    if (!replica || userId !== ownerId) return 0;
    return replica.refreshPending();
  }, [ownerId, replica]);

  const acknowledge = useCallback(async (operations: readonly DevicePendingOperation[]) => {
    if (replica) return replica.acknowledge(operations);
    await acknowledgeStoredDevicePending([...operations]);
    const userId = ownerRef.current;
    if (userId && operations.some(operation => operation.ownerUserId === userId)) await refreshPending(userId);
  }, [refreshPending, replica]);

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
    return persistenceReplica.stage({ type: 'create', cards: changedCards, nextTotal });
  }, [persistenceReplica]);

  const patchCards = useCallback(async (changes: readonly { card: CardData; fields: Partial<CardData> }[], nextTotal?: number, operationId?: string) => {
    return persistenceReplica.stage({ type: 'patch', changes, nextTotal, operationId });
  }, [persistenceReplica]);

  const removeCard = useCallback(async (cardId: string, context: DeviceDeleteContext = {}) => {
    return persistenceReplica.stage({ type: 'delete', cardId, context });
  }, [persistenceReplica]);

  const flush = useCallback((
    manualRetry = false,
    verifiedEpoch: CloudSyncEpoch | null = null,
  ): Promise<void> => {
    if (!replica) return Promise.resolve();
    return replica.flush({ manualRetry, verifiedEpoch, isBrowserOnline });
  }, [isBrowserOnline, replica]);

  useEffect(() => {
    if (!ownerId || !db || !isFirebaseConfigured || !isBrowserOnline || pendingCount < 1) return;
    const tryFlush = () => void flush();
    tryFlush();
    window.addEventListener('focus', tryFlush);
    const interval = window.setInterval(tryFlush, 60_000);
    return () => { window.removeEventListener('focus', tryFlush); window.clearInterval(interval); };
  }, [flush, isBrowserOnline, ownerId, pendingCount]);

  const syncMirror = useCallback((force = false): Promise<number> => {
    if (!replica) return Promise.resolve(0);
    return replica.refreshMirror(force);
  }, [replica]);

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
        const count = await syncMirror(false);
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
    if (!replica || isSyncing) return;
    setError(null);
    if (!db || !isFirebaseConfigured) return flush(true);
    await replica.retry();
  }, [flush, isSyncing, replica]);

  return {
    isSyncing,
    pendingCount,
    error,
    getFallback,
    refreshPending,
    acknowledge,
    upsertCards,
    patchCards,
    removeCard,
    intake: persistenceReplica,
    flush,
    syncMirror,
    syncNow,
    retry,
  };
}

export type { DevicePendingOperation };
export { publishVerifiedEpochIfOwnerCurrent } from './libraryReplica';
