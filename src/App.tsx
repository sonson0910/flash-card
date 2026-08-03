import React, { lazy, Suspense, useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { fetchAudioUrl } from './lib/audio';
import { fetchImageUrl, isSupportedImageUrl } from './lib/images';
import { hydrateMissingCardImage } from './lib/cardImageHydration';
import {
  applyCardPatchWithConflictRecovery,
  deleteCardWithConflictRecovery,
} from './lib/cardConflictRecovery';
import { selectMutableCardPatch } from './lib/cardMutationProtocol';
import { isCardDue } from './lib/srs';
import { scheduleReview, type ReviewRating } from './lib/reviewScheduler';
import { CLOUD_PAGE_SIZE, calculateTotalPages, normalizePartOfSpeech, queryStateKey, sortCardsByActivity, type CardQueryState } from './lib/cardQuery';
import { mapWithConcurrency } from './lib/asyncPool';
import { OperationTimeoutError, withTimeout } from './lib/async';
import { acquireDevicePendingFlush, clearDevicePending, loadDeviceCards, mergeDeviceCards, queueDeviceUpserts, releaseDevicePendingFlush, saveDeviceCards, type DevicePendingOperation } from './lib/deviceSync';
import { getReducedMotionScrollBehavior } from './lib/motion';
import {
  countPageableCards,
  clearCustomDeckAssignments,
  applyCardPatchIfCurrent,
  createCardIfAbsent,
  deleteCardWithTombstone,
  applyCategoryDeltas,
  deleteAllCards,
  fetchAllCardsOnDemand,
  fetchCardPage,
  fetchPracticeCards,
  findCardByNormalizedWord,
  findCardsByNormalizedWords,
  incrementLibraryEpoch,
  migrateLegacyCardQueryFields,
} from './lib/cardRepository';
import {
  clearMirroredCards,
  deleteMirroredCard,
  findMirroredCardByWord,
  getCardMirrorStatus,
  patchMirroredCardBatch,
  upsertMirroredCardBatch,
} from './lib/cardMirror';
import type { CardData } from './types/card';
import { CardUniquenessCheckError, resolveExistingCard } from './lib/cardUniqueness';
import {
  canDeferRemoteUniquenessFailure,
  applySuccessfulPatchMetadata,
  persistCardWithMirrorFallback,
  shouldAttemptRemoteUniquenessCheck,
  shouldRequireRemoteUniquenessCheck,
} from './lib/cardCreation';
import { cardWordKey, createWordCardId as createStableWordCardId, dedupeCardsByNormalizedWord, normalizeCardWord } from './lib/cardIdentity';
import {
  isActiveUserSession,
  isCardUpdateLifecycleCurrent,
  resolveCardUpdateSource,
} from './lib/cardUpdates';
import { canUseDeviceBackupForSession, planCardsForSignedInSession, retainCardsForSession, selectCardsVisibleForSession } from './lib/sessionCards';
import { resolvePracticeLibraryCount } from './lib/practiceAvailability';
import { dateLabelToQueryDate, existingCardRevealState, formatCardDate, groupCardsByDate, promoteExistingCard } from './features/library/libraryPresentation';
import { normalizeAssignedDeckName, normalizeCustomDeckCollection, planCustomDeckCreation } from './features/library/customDecks';
import {
  canStartLibraryClear,
  planClearFailureRecovery,
  planDeckDeletionFailureRecovery,
  runEpochProtectedLibraryClear,
} from './features/library/libraryMutationRecovery';
import { useGamification } from './features/gamification/useGamification';
import { PracticeScreen } from './features/practice/PracticeScreen';
import {
  usePracticeSession,
  type PracticeSnapshotPort,
} from './features/practice/usePracticeSession';
import { ENGLISH_TO_VIETNAMESE_PROFILE } from './features/language/languageProfile';
import { useLibraryDeviceSync } from './features/librarySession/useLibraryDeviceSync';
import { useCloudLibraryPage } from './features/librarySession/useCloudLibraryPage';
import { useIdentitySession } from './features/session/useIdentitySession';
import { LibraryScreen, type LibraryScreenActions, type LibraryScreenModel } from './features/library/LibraryScreen';
import { cardsToSpreadsheetRows } from './features/importExport/spreadsheetModel';
import { useSpreadsheetImport } from './features/importExport/useSpreadsheetImport';
import { createSharedDeckShare, revokeSharedDeckShare } from './features/sharing/sharedDeckService';
import { type LibraryDifficulty } from './features/catalog/libraryCatalogQuery';
import { useLibraryCatalogQuery } from './features/catalog/useLibraryCatalogQuery';
import { AppFeedback } from './components/shell/AppFeedback';
import { AppFooter } from './components/shell/AppFooter';
import { DesktopNavigation } from './components/shell/DesktopNavigation';
import { MobileNavigation } from './components/shell/MobileNavigation';
import { useAppNavigation } from './features/navigation/useAppNavigation';
import { useOverlayState } from './features/overlays/useOverlayState';
import {
  cloudBackoffCacheKey,
  cloudFacetsCacheKey,
  cloudMigrationCacheKey,
  cloudPageCacheKey,
  cloudStatsCacheKey,
  isCloudBackoffActive,
  isQuotaError,
  isRetryableSyncError,
  localCardsOwnerKey,
  localDecksOwnerKey,
  normalizeCardForStorage,
  normalizeLocalCards,
  readLocalJson,
  waitForInitialMedia,
} from './features/library/libraryStorage';

// Firebase imports
import { 
  app,
  db, 
  isFirebaseConfigured, 
  handleFirestoreError, 
  OperationType 
} from './lib/firebase';
import { 
  doc, 
  setDoc, 
  getDoc,
  onSnapshot,
  arrayRemove,
  arrayUnion,
} from 'firebase/firestore';

const AppOverlays = lazy(() => import('./components/AppOverlays').then(module => ({ default: module.AppOverlays })));
const AppShellMotion = lazy(() => import('./components/motion/AppShellMotion').then(module => ({ default: module.AppShellMotion })));

const emptyPracticeSnapshot: PracticeSnapshotPort = {
  findCard: () => undefined,
  getCards: () => [],
  updateCard: () => undefined,
  updateCards: () => undefined,
  removeCard: () => undefined,
  restoreCard: () => undefined,
  clear: () => undefined,
};

interface SaveDataConnection {
  saveData?: boolean;
  addEventListener?: (type: 'change', listener: () => void) => void;
  removeEventListener?: (type: 'change', listener: () => void) => void;
}

function removeUrlParam(key: string) {
  const url = new URL(window.location.href);
  url.searchParams.delete(key);
  window.history.replaceState(window.history.state, document.title, `${url.pathname}${url.search}${url.hash}`);
}

export default function App() {
  const { model: catalog, actions: catalogActions } = useLibraryCatalogQuery();
  const {
    category: activeCategory,
    search: searchQuery,
    debouncedSearch,
    date: activeDate,
    deck: activeCustomDeck,
    difficulty: activeDifficulty,
    partOfSpeech: activePartOfSpeech,
    starred: showStarredOnly,
    page: currentPage,
  } = catalog;
  const [wordInput, setWordInput] = useState(() => {
    try {
      return sessionStorage.getItem('lingoflash_word_draft') ?? '';
    } catch {
      return '';
    }
  });
  const [cards, setCards] = useState<CardData[]>([]);

  const identitySession = useIdentitySession({ app, configured: isFirebaseConfigured });
  const user = useMemo(() => identitySession.owner ? {
    uid: identitySession.owner.id,
    displayName: identitySession.owner.displayName,
    email: identitySession.owner.email,
    photoURL: identitySession.owner.photoUrl,
  } : null, [identitySession.owner]);
  const isAuthLoading = identitySession.status === 'loading';
  const authError = identitySession.error;
  const isSigningIn = identitySession.isSigningIn;
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const {
    notice,
    setNotice,
    shareLink,
    setShareLink,
    isPracticeMenuOpen,
    setIsPracticeMenuOpen,
    isStatsOpen,
    setIsStatsOpen,
    showClearConfirm,
    setShowClearConfirm,
    hasMountedOverlays,
    shareOpenerRef,
    practiceOpenerRef,
    statsOpenerRef,
    clearOpenerRef,
    rememberOpener,
    openPractice,
    openStats: openStatsOverlay,
    openClearConfirm: openClearOverlay,
  } = useOverlayState();
  const [customDecks, setCustomDecks] = useState<string[]>(() => {
    const saved = readLocalJson<unknown>('lingoflash_custom_decks', []);
    return normalizeCustomDeckCollection(saved);
  });
  const [newDeckInput, setNewDeckInput] = useState<string>('');
  const [libraryFocusRequest, setLibraryFocusRequest] = useState(0);
  const [cloudTotal, setCloudTotal] = useState(0);
  const [cloudStats, setCloudStats] = useState({ total: 0, easy: 0, good: 0, hard: 0, unrated: 0, bookmarked: 0, due: 0, legacyUnindexed: 0 });
  const [cloudCategoryCounts, setCloudCategoryCounts] = useState<Record<string, number>>({});
  const [cloudFacetsComplete, setCloudFacetsComplete] = useState(false);
  const [legacyCardsPending, setLegacyCardsPending] = useState(0);
  const [isMigratingLegacy, setIsMigratingLegacy] = useState(false);
  const [hasNextCloudPage, setHasNextCloudPage] = useState(false);
  const [isPageLoading, setIsPageLoading] = useState(false);
  const [cloudReadUnavailable, setCloudReadUnavailable] = useState(false);
  const [isBrowserOnline, setIsBrowserOnline] = useState(() => navigator.onLine);
  const [cloudRefresh, setCloudRefresh] = useState(0);
  const libraryEpochState = identitySession.ownerEpoch
    ? { userId: identitySession.ownerEpoch.ownerId, value: identitySession.ownerEpoch.value }
    : null;
  const lastFocusedPageRef = useRef(1);
  const cardsRef = useRef(cards);
  const imageHydrationAttemptedRef = useRef(new Set<string>());
  const imageHydrationInFlightRef = useRef(new Map<string, Promise<Partial<CardData> | null>>());
  const cardLifecycleVersionRef = useRef(new Map<string, number>());
  const hydrationSessionVersionRef = useRef(0);
  const generationInFlightRef = useRef(false);
  const mirrorSyncInFlightRef = useRef<{ userId: string; promise: Promise<number> } | null>(null);
  const libraryClearInFlightUserRef = useRef<string | null>(null);
  const activeUserIdRef = useRef<string | null>(null);
  const adoptedIdentityRef = useRef<string | null | undefined>(undefined);
  const recentlyPromotedCardsRef = useRef(new Map<string, CardData>());
  const appShellRef = useRef<HTMLDivElement | null>(null);
  const navigationRef = useRef<HTMLElement | null>(null);
  const viewStageRef = useRef<HTMLDivElement | null>(null);
  const cardsPerPage = CLOUD_PAGE_SIZE;
  const knownLibraryTotal = user ? Math.max(cloudTotal, cloudStats.total, cards.length) : cards.length;
  const knownLibraryTotalRef = useRef(knownLibraryTotal);
  cardsRef.current = cards;
  knownLibraryTotalRef.current = knownLibraryTotal;
  activeUserIdRef.current = user?.uid ?? null;

  useEffect(() => {
    hydrationSessionVersionRef.current += 1;
    recentlyPromotedCardsRef.current.clear();
  }, [user?.uid]);

  useEffect(() => {
    try {
      if (wordInput) sessionStorage.setItem('lingoflash_word_draft', wordInput);
      else sessionStorage.removeItem('lingoflash_word_draft');
    } catch {
      // A private browser session may deny storage; generation still works in memory.
    }
  }, [wordInput]);

  useEffect(() => {
    const handleOnline = () => setIsBrowserOnline(true);
    const handleOffline = () => setIsBrowserOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    const connection = (navigator as Navigator & { connection?: SaveDataConnection }).connection;
    const syncSaveDataPreference = () => {
      if (connection?.saveData) document.documentElement.dataset.saveData = 'true';
      else delete document.documentElement.dataset.saveData;
    };

    syncSaveDataPreference();
    connection?.addEventListener?.('change', syncSaveDataPreference);

    return () => {
      connection?.removeEventListener?.('change', syncSaveDataPreference);
      delete document.documentElement.dataset.saveData;
    };
  }, []);

  const {
    viewMode,
    setViewMode,
    viewHeading,
    viewHeadingRef,
    libraryHeadingRef,
    focusLibraryHeading,
    isDarkMode,
    toggleTheme,
  } = useAppNavigation({ practiceOpenerRef });

  useEffect(() => {
    if (isPageLoading || currentPage === lastFocusedPageRef.current) return;
    lastFocusedPageRef.current = currentPage;
    return focusLibraryHeading();
  }, [currentPage, focusLibraryHeading, isPageLoading]);

  useEffect(() => {
    if (libraryFocusRequest === 0 || viewMode !== 'library' || isLoading) return;
    const heading = libraryHeadingRef.current;
    if (!heading) return;

    const focusHeading = () => {
      if (!heading.isConnected || window.getComputedStyle(heading).visibility === 'hidden') return false;
      heading.focus({ preventScroll: true });
      return document.activeElement === heading;
    };

    if (focusHeading()) return;

    // GSAP briefly hides this container when the promoted card reorders the grid;
    // WebKit ignores focus() while an ancestor has visibility: hidden.
    const animatedHeading = heading.closest('[data-gsap-library-heading]') ?? heading;
    const observer = new MutationObserver(() => {
      if (focusHeading()) observer.disconnect();
    });
    observer.observe(animatedHeading, { attributes: true, attributeFilter: ['class', 'style'] });
    return () => observer.disconnect();
  }, [isLoading, libraryFocusRequest, viewMode]);

  const practiceSnapshotRef = useRef<PracticeSnapshotPort>(emptyPracticeSnapshot);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importProgress, setImportProgress] = useState<{current: number, total: number, word: string} | null>(null);

  const { streak, xp, xpHistory, level, addXp: handleAddXp } = useGamification(
    user,
    Boolean(user && isCloudBackoffActive(user.uid)),
  );

  const [activeShareId, setActiveShareId] = useState<string | null>(null);
  const [isSharing, setIsSharing] = useState(false);

  const openPracticeMenu = (event: React.MouseEvent<HTMLButtonElement>) => {
    openPractice(event.currentTarget);
  };

  const openStats = (event: React.MouseEvent<HTMLButtonElement>) => {
    openStatsOverlay(event.currentTarget);
  };

  const openClearConfirm = (event: React.MouseEvent<HTMLButtonElement>) => {
    openClearOverlay(event.currentTarget, canStartLibraryClear(isLoading));
  };

  const updateCategoryFacets = useCallback(async (deltas: Record<string, number>) => {
    if (!db || !user || !isFirebaseConfigured || Object.keys(deltas).length === 0) return;
    const facets = await applyCategoryDeltas(db, user.uid, deltas);
    setCloudCategoryCounts(facets.categories);
    setCloudFacetsComplete(facets.complete);
    localStorage.setItem(cloudFacetsCacheKey(user.uid), JSON.stringify(facets));
  }, [user]);

  const handleMigrateLegacyCards = useCallback(async () => {
    if (!db || !user || !isFirebaseConfigured || isMigratingLegacy) return;
    setIsMigratingLegacy(true);
    setError(null);
    try {
      const result = await migrateLegacyCardQueryFields(db, user.uid, 100);
      setLegacyCardsPending(previous => result.complete ? 0 : Math.max(0, previous - result.migrated));
      if (result.complete) {
        localStorage.setItem(cloudMigrationCacheKey(user.uid), 'true');
        catalogActions.goToPage(1);
        setCloudRefresh(value => value + 1);
      }
    } catch (migrationError) {
      console.error('Legacy card migration failed', migrationError);
      setError('Could not optimise this legacy card batch. Please try again.');
    } finally {
      setIsMigratingLegacy(false);
    }
  }, [catalogActions, user, isMigratingLegacy]);

  const cloudQueryState = useMemo<CardQueryState>(() => ({
    category: activeCategory === 'All' ? null : activeCategory,
    customDeck: activeCustomDeck === 'All'
      ? null
      : activeCustomDeck === 'Unassigned'
        ? 'unassigned'
        : activeCustomDeck,
    difficulty: activeDifficulty === 'All' ? null : activeDifficulty as CardQueryState['difficulty'],
    partOfSpeech: activePartOfSpeech === 'All' ? null : activePartOfSpeech,
    bookmarkedOnly: showStarredOnly,
    createdDate: dateLabelToQueryDate(activeDate),
    wordPrefix: debouncedSearch,
  }), [activeCategory, activeCustomDeck, activeDifficulty, activePartOfSpeech, showStarredOnly, activeDate, debouncedSearch]);
  const cloudQueryKey = useMemo(() => queryStateKey(cloudQueryState), [cloudQueryState]);

  const deviceSyncEvents = useMemo(() => ({
    advanceCard: (cardId: string, advance: (card: CardData) => CardData) =>
      setCards(previous => previous.map(card => card.id === cardId ? advance(card) : card)),
    removeCard: (cardId: string) => setCards(previous => previous.filter(card => card.id !== cardId)),
    findPracticeCard: (cardId: string) => practiceSnapshotRef.current.findCard(cardId),
    advancePracticeCard: (cardId: string, advance: (card: CardData) => CardData) =>
      practiceSnapshotRef.current.updateCard(cardId, advance),
    removePracticeCard: (cardId: string) => practiceSnapshotRef.current.removeCard(cardId),
    resetPage: () => catalogActions.goToPage(1),
    refreshCloud: () => setCloudRefresh(previous => previous + 1),
    setCloudAvailable: (available: boolean) => setCloudReadUnavailable(!available),
    setCloudTotal,
    publishDeviceCards: setCards,
    publishDevicePage: (items: CardData[], total: number, hasNext: boolean) => {
      setCards(items);
      setCloudTotal(total);
      setHasNextCloudPage(hasNext);
    },
    previousPage: catalogActions.goToPreviousPage,
    reportError: setError,
    notify: setNotice,
    verifyEpoch: (verified: { userId: string; value: number }) => {
      identitySession.acceptVerifiedOwnerEpoch(verified.userId, verified.value);
    },
  }), [catalogActions, identitySession.acceptVerifiedOwnerEpoch, setNotice]);
  const deviceSync = useLibraryDeviceSync({
    owner: user,
    epoch: libraryEpochState,
    cards,
    knownLibraryTotal,
    cloudTotal,
    cloudStatsTotal: cloudStats.total,
    cardsPerPage,
    isBrowserOnline,
    cloudReadUnavailable,
    query: cloudQueryState,
    queryKey: cloudQueryKey,
    currentPage,
    getPromotedCards: () => [...recentlyPromotedCardsRef.current.values()],
    events: deviceSyncEvents,
  });
  const {
    isSyncing: isDeviceSyncing,
    pendingCount: pendingSyncCount,
    error: syncHealthError,
    getFallback: getDeviceFallback,
    refreshPending: refreshPendingSyncState,
    acknowledge: acknowledgeDevicePending,
    upsertCards: upsertDeviceCards,
    patchCards: patchDeviceCards,
    removeCard: removeDeviceCard,
    flush: flushDevicePendingToCloud,
    syncNow: handleDeviceSyncNow,
    retry: handleSyncHealthRetry,
  } = deviceSync;

  const cloudPage = useCloudLibraryPage({
    ownerId: user?.uid ?? null,
    query: cloudQueryState,
    queryKey: cloudQueryKey,
    page: currentPage,
    pageSize: cardsPerPage,
    refreshKey: cloudRefresh,
    statsOpen: isStatsOpen,
    getDeviceFallback,
    getPromotedCards: () => [...recentlyPromotedCardsRef.current.values()],
  });

  useEffect(() => {
    if (!user || cloudPage.ownerId !== user.uid) return;
    setCards(cloudPage.items);
    setCloudTotal(cloudPage.total);
    setHasNextCloudPage(cloudPage.hasNext);
    setIsPageLoading(cloudPage.isLoading);
    setCloudReadUnavailable(cloudPage.cloudUnavailable);
    if (cloudPage.error) setError(cloudPage.error);
    if (!cloudPage.isLoading && currentPage > 1 && cloudPage.items.length === 0 && !cloudPage.hasNext) {
      catalogActions.goToPreviousPage();
    }
  }, [catalogActions, cloudPage, currentPage, user]);

  useEffect(() => {
    if (!user || cloudPage.ownerId !== user.uid) return;
    setCloudStats(cloudPage.stats);
    setLegacyCardsPending(current => Math.max(current, cloudPage.stats.legacyUnindexed));
  }, [cloudPage.ownerId, cloudPage.stats, user]);

  useEffect(() => {
    if (!user || cloudPage.ownerId !== user.uid) return;
    setCloudCategoryCounts(cloudPage.facets);
    setCloudFacetsComplete(cloudPage.facetsComplete);
  }, [cloudPage.facets, cloudPage.facetsComplete, cloudPage.ownerId, user]);

  useEffect(() => {
    if (identitySession.status === 'loading') return;
    const ownerId = user?.uid ?? null;
    if (adoptedIdentityRef.current === ownerId) return;
    adoptedIdentityRef.current = ownerId;
    setIsLoading(false);

    if (!user) {
      const localCards = normalizeLocalCards(readLocalJson<unknown>('lingoflash_cards', []));
      setCards(selectCardsVisibleForSession(localCards, localStorage.getItem(localCardsOwnerKey), null));
      setCustomDecks([]);
      setCloudCategoryCounts({});
      setCloudFacetsComplete(false);
      setLegacyCardsPending(0);
      return;
    }

    const currentEpoch = libraryEpochState?.userId === user.uid ? libraryEpochState.value : null;
    const localCards = normalizeLocalCards(readLocalJson<unknown>('lingoflash_cards', []));
    const cardPlan = planCardsForSignedInSession(localCards, localStorage.getItem(localCardsOwnerKey), user.uid);
    const localDecks = normalizeCustomDeckCollection(readLocalJson<unknown>('lingoflash_custom_decks', []));
    const deckPlan = planCardsForSignedInSession(localDecks, localStorage.getItem(localDecksOwnerKey), user.uid);

    if (cardPlan.discardLocalCache) localStorage.removeItem('lingoflash_cards');
    else if (cardPlan.visibleCards.length > 0) localStorage.setItem('lingoflash_cards', JSON.stringify(cardPlan.visibleCards));
    localStorage.setItem(localCardsOwnerKey, user.uid);
    setCards(cardPlan.visibleCards);
    if (cardPlan.cardsToMigrate.length > 0 && currentEpoch !== null) {
      void queueDeviceUpserts(
        cardPlan.cardsToMigrate.map(card => normalizeCardForStorage({ ...card, libraryEpoch: currentEpoch })),
        cardPlan.cardsToMigrate.length,
        user.uid,
      ).then(() => {
        void refreshPendingSyncState(user.uid);
        setNotice(`${cardPlan.cardsToMigrate.length} local card${cardPlan.cardsToMigrate.length === 1 ? '' : 's'} queued for secure cloud sync.`);
      });
    }

    if (deckPlan.discardLocalCache) localStorage.removeItem('lingoflash_custom_decks');
    else localStorage.setItem('lingoflash_custom_decks', JSON.stringify(deckPlan.visibleCards));
    localStorage.setItem(localDecksOwnerKey, user.uid);
    setCustomDecks(deckPlan.visibleCards);
    if (db && deckPlan.cardsToMigrate.length > 0) {
      void setDoc(doc(db, 'users', user.uid, 'profile', 'custom_decks'), { decks: arrayUnion(...deckPlan.cardsToMigrate) }, { merge: true })
        .catch(cause => console.warn('Local deck migration is queued for retry.', cause));
    }
    setCloudTotal(0);
    setCloudCategoryCounts({});
    setCloudFacetsComplete(false);
    setLegacyCardsPending(0);
    catalogActions.goToPage(1);
  }, [catalogActions, identitySession.status, libraryEpochState, refreshPendingSyncState, setNotice, user]);

  useEffect(() => {
    if (!db || !user || !isFirebaseConfigured || currentPage !== 1 || cloudPage.total <= 0
      || cloudQueryState.wordPrefix || cloudQueryState.category || cloudQueryState.customDeck
      || cloudQueryState.difficulty || cloudQueryState.partOfSpeech || cloudQueryState.bookmarkedOnly
      || cloudQueryState.createdDate || localStorage.getItem(cloudMigrationCacheKey(user.uid)) === 'true') return;
    let cancelled = false;
    void countPageableCards(db, user.uid).then(pageableCount => {
      if (cancelled) return;
      setLegacyCardsPending(Math.max(0, cloudPage.total - pageableCount));
      if (pageableCount === cloudPage.total) localStorage.setItem(cloudMigrationCacheKey(user.uid), 'true');
    });
    return () => { cancelled = true; };
  }, [cloudPage.total, cloudQueryKey, currentPage, user]);
  // Save custom decks local backup
  useEffect(() => {
    if (user && localStorage.getItem(localDecksOwnerKey) === user.uid) {
      localStorage.setItem('lingoflash_custom_decks', JSON.stringify(customDecks));
    }
  }, [customDecks, user]);

  // Sync custom decks from cloud
  useEffect(() => {
    if (!db || !user || !isFirebaseConfigured) return;
    if (isCloudBackoffActive(user.uid)) return;
    const decksRef = doc(db, 'users', user.uid, 'profile', 'custom_decks');
    return onSnapshot(decksRef, snapshot => {
      if (snapshot.exists()) {
        const rawDecks = snapshot.data()?.decks;
        const decks = normalizeCustomDeckCollection(rawDecks);
        setCustomDecks(decks);
        localStorage.setItem(localDecksOwnerKey, user.uid);
        return;
      }
      const localDecks = localStorage.getItem(localDecksOwnerKey) === user.uid
        ? readLocalJson<unknown>('lingoflash_custom_decks', [])
        : [];
      const normalizedLocalDecks = normalizeCustomDeckCollection(localDecks);
      if (normalizedLocalDecks.length > 0) {
        void setDoc(decksRef, { decks: normalizedLocalDecks });
      } else {
        setCustomDecks([]);
      }
    }, syncError => console.error('Failed to sync custom decks', syncError));
  }, [user]);

  // Keep local storage cards in sync as offline backup when working offline/online
  useEffect(() => {
    if (!isAuthLoading && !user && !authError) {
      localStorage.removeItem(localCardsOwnerKey);
      localStorage.setItem('lingoflash_cards', JSON.stringify(cards));
    }
  }, [cards, user, isAuthLoading, authError]);

  useEffect(() => {
    if (isAuthLoading || user || cards.length > 0) return;
    let cancelled = false;
    loadDeviceCards().then(backup => {
      if (cancelled || !backup || backup.cards.length === 0) return;
      if (backup.ownerUserId === undefined || !canUseDeviceBackupForSession(backup.ownerUserId, null)) return;
      const localCards = normalizeLocalCards(backup.cards);
      setCards(localCards);
      localStorage.setItem('lingoflash_cards', JSON.stringify(localCards));
    });
    return () => { cancelled = true; };
  }, [cards.length, isAuthLoading, user]);

  // Handle Share link logic
  useEffect(() => {
    const checkSharedDeck = async () => {
      const params = new URLSearchParams(window.location.search);
      const shareId = params.get('share');
      if (!shareId || !db) return;
      const database = db;

      try {
        const docRef = doc(database, 'shared_decks', shareId);
        const docSnap = await getDoc(docRef);
        
        if (docSnap.exists()) {
          const data = docSnap.data();
          const sharedCards = Array.isArray(data.cards) ? data.cards.slice(0, 100) : [];
          const catName = typeof data.category === 'string' ? data.category.slice(0, 128) : 'Shared';
          
          if (window.confirm(`Do you want to download the deck "${catName}" with ${sharedCards.length} words?`)) {
            const candidateCards: CardData[] = dedupeCardsByNormalizedWord(sharedCards
              .filter((c: unknown): c is Partial<CardData> => Boolean(c && typeof c === 'object'))
              .filter(c => typeof c.word === 'string' && typeof c.translation === 'string')
              .map(c => {
                const normalizedWord = normalizeCardWord(c.word!).slice(0, 80);
                return normalizeCardForStorage({
              word: normalizedWord,
              normalizedWord,
              translation: c.translation!.slice(0, 256),
              explanation: typeof c.explanation === 'string' ? c.explanation.slice(0, 2048) : '',
              phonetic: typeof c.phonetic === 'string' ? c.phonetic.slice(0, 256) : '',
              category: typeof c.category === 'string' ? c.category.slice(0, 128) : 'Shared',
              partOfSpeech: normalizePartOfSpeech(c.partOfSpeech),
              emoji: typeof c.emoji === 'string' ? c.emoji.slice(0, 64) : '📝',
              audioUrl: typeof c.audioUrl === 'string' ? c.audioUrl : null,
              imageUrl: typeof c.imageUrl === 'string' ? c.imageUrl : null,
              id: createStableWordCardId(normalizedWord),
              createdAt: new Date().toISOString()
                });
              })
              .filter(card => Boolean(card.normalizedWord)));
            const knownWords = new Set(
              normalizeLocalCards([
                ...cards,
                ...readLocalJson<unknown[]>('lingoflash_cards', []),
              ]).map(cardWordKey),
            );
            if (user) {
              const cloudMatches = await findCardsByNormalizedWords(
                database,
                user.uid,
                candidateCards.map(card => card.word),
              );
              cloudMatches.forEach((_card, word) => knownWords.add(word));
            }
            const newCardsToSave = candidateCards.filter(card => !knownWords.has(cardWordKey(card)));
            const existingCount = candidateCards.length - newCardsToSave.length;

            if (newCardsToSave.length === 0) {
              setNotice(`All ${candidateCards.length} shared card${candidateCards.length === 1 ? ' is' : 's are'} already in your library. Nothing new was created.`);
              removeUrlParam('share');
              return;
            }

            const pendingOperations = await upsertDeviceCards(
              newCardsToSave,
              Math.max(knownLibraryTotal, cloudStats.total) + newCardsToSave.length,
            );

            // Sync to Firebase if logged in
            if (user) {
              const currentEpoch = libraryEpochState?.userId === user.uid
                ? libraryEpochState.value
                : 0;
              const creationResults = [];
              for (let index = 0; index < newCardsToSave.length; index += 1) {
                const result = await createCardIfAbsent(
                  database,
                  user.uid,
                  newCardsToSave[index],
                  { libraryEpoch: currentEpoch },
                );
                creationResults.push(result);
                const pending = pendingOperations[index];
                if (pending) await acknowledgeDevicePending([pending]);
              }
              const createdCards = creationResults.flatMap(result => result.created ? [result.card] : []);
              const categoryDeltas = createdCards.reduce<Record<string, number>>((deltas, card) => {
                const category = card.category || 'Other';
                deltas[category] = (deltas[category] || 0) + 1;
                return deltas;
              }, {});
              if (createdCards.length > 0) await updateCategoryFacets(categoryDeltas);
              setCloudStats(previous => ({
                ...previous,
                total: previous.total + createdCards.length,
                unrated: previous.unrated + createdCards.length,
              }));
              catalogActions.goToPage(1);
              const reusedDuringCreate = creationResults.length - createdCards.length;
              setNotice(`Added ${createdCards.length} new card${createdCards.length === 1 ? '' : 's'} from the shared link${existingCount + reusedDuringCreate > 0 ? `; reused ${existingCount + reusedDuringCreate} already in your library` : ''}.`);
            } else {
              setCards(prev => [...newCardsToSave, ...prev]);
              setNotice(`Added ${newCardsToSave.length} new card${newCardsToSave.length === 1 ? '' : 's'} from the shared link${existingCount > 0 ? `; reused ${existingCount} already in your library` : ''}.`);
            }
            
            // Remove only the consumed share token; library filters and unrelated params remain intact.
            removeUrlParam('share');
          }
        }
      } catch (err) {
        console.error("Error fetching shared deck:", err);
        setError('Could not verify the complete library for this shared deck, so no cards were created.');
      }
    };
    checkSharedDeck();
  }, [catalogActions, db, user, updateCategoryFacets, upsertDeviceCards, knownLibraryTotal, cloudStats.total]);

  const toggleBookmark = useCallback(async (id: string) => {
    const card = cardsRef.current.find(candidate => candidate.id === id)
      ?? practiceSnapshotRef.current.findCard(id);
    if (!card) return;
    const newBookmarked = !card.bookmarked;
    const updatedCard = { ...card, bookmarked: newBookmarked };
    setCards(prev => prev.map(c => c.id === id ? { ...c, bookmarked: newBookmarked } : c));
    practiceSnapshotRef.current.updateCard(id, { bookmarked: newBookmarked });
    await patchDeviceCards(
      [{ card: updatedCard, fields: { bookmarked: newBookmarked } }],
      knownLibraryTotalRef.current,
    );
    if (isFirebaseConfigured && db && user) {
      await flushDevicePendingToCloud();
      setCloudStats(previous => ({
        ...previous,
        bookmarked: Math.max(0, previous.bookmarked + (newBookmarked ? 1 : -1)),
      }));
    }
  }, [user, patchDeviceCards, flushDevicePendingToCloud]);

  const handleAssignDeck = useCallback(async (cardId: string, deckName: string | null) => {
    const normalizedDeckName = normalizeAssignedDeckName(deckName);
    const card = cardsRef.current.find(candidate => candidate.id === cardId)
      ?? practiceSnapshotRef.current.findCard(cardId);
    setCards(prev => prev.map(card => card.id === cardId ? { ...card, customDeck: normalizedDeckName } : card));
    practiceSnapshotRef.current.updateCard(cardId, { customDeck: normalizedDeckName });
    if (card) {
      await patchDeviceCards([{
        card: { ...card, customDeck: normalizedDeckName },
        fields: { customDeck: normalizedDeckName },
      }], knownLibraryTotalRef.current);
    }
    if (isFirebaseConfigured && db && user) {
      await flushDevicePendingToCloud();
    }
  }, [user, patchDeviceCards, flushDevicePendingToCloud]);

  const handleCreateCustomDeck = useCallback(async (deckName: string) => {
    const plan = planCustomDeckCreation(customDecks, deckName);
    if (plan.status === 'empty' || plan.status === 'duplicate') return;
    if (plan.status === 'limit') {
      setError('You can create up to 100 custom decks. Delete an existing deck before adding another.');
      return;
    }

    const updated = plan.decks;
    if (user) localStorage.setItem(localDecksOwnerKey, user.uid);
    else localStorage.removeItem(localDecksOwnerKey);
    setCustomDecks(updated);
    localStorage.setItem('lingoflash_custom_decks', JSON.stringify(updated));
    
    if (isFirebaseConfigured && db && user) {
      setDoc(doc(db, 'users', user.uid, 'profile', 'custom_decks'), { decks: arrayUnion(plan.name) }, { merge: true }).catch(console.error);
    }
  }, [customDecks, user]);

  const handleDeleteCustomDeck = useCallback(async (deckName: string) => {
    if (!window.confirm(`Are you sure you want to delete the collection "${deckName}"? All cards in this collection will be marked as unassigned.`)) return;
    
    const updated = customDecks.filter(d => d !== deckName);
    if (user) localStorage.setItem(localDecksOwnerKey, user.uid);
    const changedCards = cards
      .filter(card => card.customDeck === deckName)
      .map(card => ({ ...card, customDeck: null }));
    const changedIds = new Set(changedCards.map(card => card.id));

    let assignmentsCleared = false;
    let deckProfileRemoved = false;
    if (isFirebaseConfigured && db && user) {
      try {
        await clearCustomDeckAssignments(db, user.uid, deckName);
        assignmentsCleared = true;
        await setDoc(doc(db, 'users', user.uid, 'profile', 'custom_decks'), { decks: arrayRemove(deckName) }, { merge: true });
        deckProfileRemoved = true;
        const pendingOperations = await patchDeviceCards(
          changedCards.map(card => ({ card, fields: { customDeck: null } })),
          knownLibraryTotal,
        );
        await acknowledgeDevicePending(pendingOperations);
      } catch (err) {
        console.warn('Deck deletion could not complete atomically.', err);
        const recovery = planDeckDeletionFailureRecovery(assignmentsCleared, deckProfileRemoved);
        setCloudReadUnavailable(true);
        localStorage.removeItem(cloudPageCacheKey(user.uid));
        localStorage.removeItem(cloudStatsCacheKey(user.uid));
        localStorage.removeItem(cloudFacetsCacheKey(user.uid));
        catalogActions.goToPage(1);
        setCloudRefresh(value => value + 1);
        setError(recovery.message);
        if (recovery.applyLocalResult) {
          setCustomDecks(updated);
          localStorage.setItem('lingoflash_custom_decks', JSON.stringify(updated));
          setCards(previous => previous.map(card => changedIds.has(card.id) ? { ...card, customDeck: null } : card));
          practiceSnapshotRef.current.updateCards(changedIds, { customDeck: null });
          if (activeCustomDeck === deckName) catalogActions.chooseDeck('All');
        }
        return;
      }
    }

    setCustomDecks(updated);
    localStorage.setItem('lingoflash_custom_decks', JSON.stringify(updated));
    setCards(previous => previous.map(card => changedIds.has(card.id) ? { ...card, customDeck: null } : card));
    practiceSnapshotRef.current.updateCards(changedIds, { customDeck: null });
    
    if (activeCustomDeck === deckName) {
      catalogActions.chooseDeck('All');
    }
  }, [catalogActions, customDecks, activeCustomDeck, user, cards, patchDeviceCards, knownLibraryTotal]);

  const updateCardDifficulty = useCallback(async (id: string, rating: ReviewRating) => {
    const card = cards.find(candidate => candidate.id === id) ?? practiceSnapshotRef.current.findCard(id);
    if (!card) return;
    const srsUpdates = scheduleReview(card, rating);
    const difficulty = srsUpdates.difficulty || 'hard';
    const previousDifficulty = card.difficulty && card.difficulty !== 'unrated' ? card.difficulty : 'unrated';
    const updatedCard = { ...card, ...srsUpdates };
    setCards(prev => prev.map(candidate => candidate.id === id ? { ...candidate, ...srsUpdates } : candidate));
    practiceSnapshotRef.current.updateCard(id, srsUpdates);
    await patchDeviceCards([{ card: updatedCard, fields: srsUpdates }], knownLibraryTotal);
    if (isFirebaseConfigured && db && user) {
      await flushDevicePendingToCloud();
      setCloudStats(previous => previousDifficulty === difficulty
        ? {
            ...previous,
            due: card.nextReviewDate && isCardDue(card) ? Math.max(0, previous.due - 1) : previous.due,
          }
        : {
            ...previous,
            [previousDifficulty]: Math.max(0, previous[previousDifficulty] - 1),
            [difficulty]: previous[difficulty] + 1,
            due: card.nextReviewDate && isCardDue(card) ? Math.max(0, previous.due - 1) : previous.due,
          });
    }
    handleAddXp(2);
  }, [user, cards, handleAddXp, patchDeviceCards, knownLibraryTotal, flushDevicePendingToCloud]);

  const handleUpdateCard = useCallback(async (
    cardId: string,
    updatedFields: Partial<CardData>,
    explicitSource?: CardData,
    expectedLifecycle?: string,
  ) => {
    const currentLifecycle = () => `${hydrationSessionVersionRef.current}:${cardLifecycleVersionRef.current.get(cardId) ?? 0}`;
    if (!isCardUpdateLifecycleCurrent(expectedLifecycle, currentLifecycle())) return;
    const ownerUserId = user?.uid ?? null;
    const existingCard = resolveCardUpdateSource(
      cardId,
      explicitSource,
      cardsRef.current,
      practiceSnapshotRef.current.getCards(),
    );
    if (!existingCard) return;
    const updatedCard = { ...existingCard, ...updatedFields };
    const pendingOperations = await patchDeviceCards(
      [{ card: updatedCard, fields: updatedFields }],
      knownLibraryTotalRef.current,
    );
    if (!isCardUpdateLifecycleCurrent(expectedLifecycle, currentLifecycle())) return;
    if (activeUserIdRef.current !== ownerUserId) return;
    setCards(prev => {
      const updatedCards = prev.map(card => card.id === cardId ? { ...card, ...updatedFields } : card);
      localStorage.setItem('lingoflash_cards', JSON.stringify(
        retainCardsForSession(updatedCards, Boolean(user), cardsPerPage),
      ));
      return updatedCards;
    });
    practiceSnapshotRef.current.updateCard(cardId, updatedFields);
    if (isFirebaseConfigured && db && ownerUserId) {
      const database = db;
      try {
        const pendingPatch = pendingOperations.find(operation => operation.type === 'patch');
        if (!pendingPatch) throw new Error('The patch command could not be queued safely.');
        const fieldMask = pendingPatch.fieldMask
          ?? Object.keys(pendingPatch.fields) as Array<keyof CardData>;
        const maskedFields = selectMutableCardPatch(pendingPatch.fields, fieldMask);
        const result = await applyCardPatchWithConflictRecovery({
          cardId,
          fields: pendingPatch.fields,
          fieldMask,
          baseRevision: pendingPatch.baseRevision ?? 0,
          libraryEpoch: pendingPatch.libraryEpoch ?? 0,
        }, command => applyCardPatchIfCurrent(database, ownerUserId, command));
        if (result.applied) {
          const metadata = {
            revision: result.revision,
            libraryEpoch: pendingPatch.libraryEpoch ?? 0,
            updatedAt: new Date().toISOString(),
          };
          const advanceCard = (card: CardData) => card.id === cardId
            ? applySuccessfulPatchMetadata(card, pendingPatch.fields, metadata, fieldMask)
            : card;
          setCards(previous => previous.map(advanceCard));
          practiceSnapshotRef.current.updateCard(cardId, advanceCard);
          await patchMirroredCardBatch(ownerUserId, [{
            cardId,
            fields: {
              ...maskedFields,
              schemaVersion: 2,
              revision: result.revision,
              libraryEpoch: metadata.libraryEpoch,
              updatedAt: metadata.updatedAt,
            },
          }]);
          await acknowledgeDevicePending([pendingPatch]);
        } else if (result.reason === 'stale-library-epoch' || result.reason === 'missing') {
          await acknowledgeDevicePending([pendingPatch]);
        } else {
          setError(result.reason === 'future-library-epoch'
            ? 'Cloud library generation changed. Your local update is still queued while sync state refreshes.'
            : 'The card changed again during conflict recovery. Your local update remains safely queued.');
        }
      } catch (err) {
        console.warn('Card update stayed local because cloud sync failed.', err);
        setCloudReadUnavailable(true);
      }
    }
  }, [user?.uid, patchDeviceCards, cardsPerPage]);

  const hydrateExistingCardImage = useCallback(async (card: CardData, force = false) => {
    const ownerUserId = user?.uid ?? null;
    const hydrationSessionVersion = hydrationSessionVersionRef.current;
    const lifecycleVersion = cardLifecycleVersionRef.current.get(card.id) ?? 0;
    const scopeKey = ownerUserId ?? 'guest';
    const canPersist = () => activeUserIdRef.current === ownerUserId
      && hydrationSessionVersionRef.current === hydrationSessionVersion
      && (cardLifecycleVersionRef.current.get(card.id) ?? 0) === lifecycleVersion;
    try {
      await hydrateMissingCardImage({
        card,
        force,
        scopeKey,
        attemptedCardIds: imageHydrationAttemptedRef.current,
        inFlightRequests: imageHydrationInFlightRef.current,
        fetchImage: fetchImageUrl,
        canPersist,
        persistUpdate: async (sourceCard, updatedFields) => {
          const updatedCard = { ...sourceCard, ...updatedFields };
          await patchDeviceCards(
            [{ card: updatedCard, fields: updatedFields }],
            knownLibraryTotalRef.current,
          );
          if (!canPersist()) return;
          const promotedKey = cardWordKey(sourceCard);
          const promotedCard = recentlyPromotedCardsRef.current.get(promotedKey);
          if (promotedCard) {
            recentlyPromotedCardsRef.current.set(promotedKey, { ...promotedCard, ...updatedFields });
          }
          setCards(previous => {
            const hasCard = previous.some(candidate => candidate.id === sourceCard.id);
            const updatedCards = hasCard
              ? previous.map(candidate => candidate.id === sourceCard.id
                ? { ...candidate, ...updatedFields }
                : candidate)
              : [updatedCard, ...previous.filter(candidate => cardWordKey(candidate) !== cardWordKey(sourceCard))]
                .slice(0, cardsPerPage);
            localStorage.setItem('lingoflash_cards', JSON.stringify(updatedCards));
            return updatedCards;
          });
          practiceSnapshotRef.current.updateCard(sourceCard.id, updatedFields);
          if (isFirebaseConfigured && db && ownerUserId) {
            await flushDevicePendingToCloud();
          }
        },
      });
    } catch (imageHydrationError) {
      console.warn('The missing card image could not be saved locally yet.', imageHydrationError);
    }
  }, [user?.uid, patchDeviceCards, cardsPerPage, flushDevicePendingToCloud]);

  useEffect(() => {
    if (viewMode !== 'library' || cards.length === 0) return;
    const scopeKey = user?.uid ?? 'guest';
    const cardsMissingImages = cards
      .filter(card => !isSupportedImageUrl(card.imageUrl)
        && !imageHydrationAttemptedRef.current.has(`${scopeKey}:${card.id}`));
    if (cardsMissingImages.length === 0) return;

    void mapWithConcurrency(cardsMissingImages, 3, card => hydrateExistingCardImage(card));
  }, [cards, viewMode, user?.uid, hydrateExistingCardImage]);

  const handleSignIn = async () => { await identitySession.signIn(); };
  const handleSignOut = async () => {
    const result = await identitySession.signOut();
    if (result.status !== 'completed') return;
    localStorage.removeItem('lingoflash_cards');
    localStorage.removeItem(localCardsOwnerKey);
    setCards([]);
  };
  const loadPracticePool = useCallback(async (maximum = 50, includeFuture = true): Promise<CardData[]> => {
    if (isFirebaseConfigured && db && user && !isCloudBackoffActive(user.uid)) {
      try {
        return await fetchPracticeCards(db, user.uid, maximum, { includeFuture });
      } catch (practiceError) {
        console.warn('Cloud practice queue unavailable; using the visible cached page.', practiceError);
        setError(isQuotaError(practiceError)
          ? 'Firebase has reached today’s read quota. Practice is using cards cached on this device.'
          : 'Could not load the cloud queue. Practice is using cards cached on this device.');
      }
    }
    const candidates = includeFuture ? cards : cards.filter(card => isCardDue(card));
    return candidates.slice(0, maximum);
  }, [user, cards]);

  const practiceLearningActions = useMemo(() => ({
    reviewCard: updateCardDifficulty,
    toggleBookmark,
    assignDeck: handleAssignDeck,
    updateCard: handleUpdateCard,
  }), [handleAssignDeck, handleUpdateCard, toggleBookmark, updateCardDifficulty]);
  const practiceSession = usePracticeSession({
    mode: viewMode,
    openView: setViewMode,
    onSessionStarted: () => setIsPracticeMenuOpen(false),
    loadPracticePool,
    learning: practiceLearningActions,
    languageProfile: ENGLISH_TO_VIETNAMESE_PROFILE,
    addXp: handleAddXp,
    reportError: setError,
  });
  practiceSnapshotRef.current = practiceSession.snapshot;
  const {
    startStudy,
    startQuiz,
    startSpelling,
    generateStory: handleGenerateStory,
  } = practiceSession.commands;

  const handleShareCategory = async () => {
    if (!isFirebaseConfigured || !app || !db || !user) {
      setError('Sign in and connect Firebase before sharing a deck.');
      return;
    }
    rememberOpener(shareOpenerRef);
    
    setIsSharing(true);
    try {
      const shareFilters: CardQueryState = {
        category: activeCategory === 'All' ? null : activeCategory,
        customDeck: null,
        difficulty: null,
        partOfSpeech: null,
        bookmarkedOnly: false,
        createdDate: null,
        wordPrefix: '',
      };
      const sharePage = await fetchCardPage({ db, userId: user.uid, filters: shareFilters, pageSize: 100 });
      const cardsToShare = sharePage.items;
      if (cardsToShare.length === 0) return;
      const { shareId } = await createSharedDeckShare(app, activeCategory, cardsToShare);
      const link = `${window.location.origin}?share=${shareId}`;
      setActiveShareId(shareId);
      setShareLink(link);
    } catch (err) {
      console.error("Error sharing deck:", err);
      setError('Could not create a share link right now. Please try again.');
    } finally {
      setIsSharing(false);
    }
  };

  const handleRevokeShare = async () => {
    if (!app || !activeShareId) return;
    setIsSharing(true);
    try {
      await revokeSharedDeckShare(app, activeShareId);
      setActiveShareId(null);
      setShareLink(null);
      setNotice('The shared deck link has been revoked.');
    } catch (shareError) {
      console.warn('Shared deck revocation failed.', shareError);
      setError('Could not revoke this share link right now. Please try again.');
    } finally {
      setIsSharing(false);
    }
  };

  const categoryCounts = useMemo(() => {
    if (user) {
      const visibleCounts: Record<string, number> = {};
      cards.forEach(card => {
        const category = card.category || 'Other';
        visibleCounts[category] = (visibleCounts[category] || 0) + 1;
      });
      return { All: Math.max(cloudTotal, cloudStats.total, cards.length), ...visibleCounts, ...cloudCategoryCounts };
    }
    const counts: Record<string, number> = { All: user ? Math.max(cloudTotal, cloudStats.total, cards.length) : cards.length };
    cards.forEach(c => {
      const cat = c.category || 'Other';
      counts[cat] = (counts[cat] || 0) + 1;
    });
    return counts;
  }, [cards, user, cloudTotal, cloudStats.total, cloudCategoryCounts]);

  const sortedCategories = useMemo(() => {
    const uniqueCategories = (user
      ? Array.from(new Set([...Object.keys(cloudCategoryCounts), ...cards.map(card => card.category || 'Other')]))
      : Array.from(new Set(cards.map(c => c.category || 'Other'))))
      .filter(Boolean)
      .sort((a, b) => (a as string).localeCompare(b as string));
    return ['All', ...uniqueCategories];
  }, [cards, user, cloudCategoryCounts]);

  const availableDates = useMemo(() => {
    return ['All', ...new Set(cards.map(c => formatCardDate(c.createdAt)))];
  }, [cards]);

  const createCard = async (word: string): Promise<{
    card: CardData;
    mediaPromise: Promise<{ audioUrl: string | null; imageUrl: string | null }>;
  }> => {
    const queryWord = normalizeCardWord(word).slice(0, 80);
    const audioPromise = fetchAudioUrl(queryWord);
    const { generateWordInfo } = await import('./lib/gemini');
    const wordInfo = await generateWordInfo(queryWord);
    const mediaPromise = Promise.all([
      audioPromise,
      fetchImageUrl({
        word: queryWord,
        searchQuery: wordInfo.imageSearchQuery,
        category: wordInfo.category,
        partOfSpeech: wordInfo.partOfSpeech,
      }),
    ]).then(([audioUrl, imageUrl]) => ({ audioUrl, imageUrl }));
    const initialMedia = await waitForInitialMedia(mediaPromise);

    const card: CardData = {
      id: createStableWordCardId(queryWord),
      word: queryWord,
      normalizedWord: queryWord,
      translation: wordInfo.translation,
      explanation: wordInfo.explanation,
      explanationTranslation: wordInfo.explanationTranslation,
      phonetic: wordInfo.phonetic,
      emoji: wordInfo.emoji,
      category: wordInfo.category,
      audioUrl: initialMedia?.audioUrl ?? null,
      imageUrl: initialMedia?.imageUrl ?? null,
      imageSearchQuery: wordInfo.imageSearchQuery,
      createdAt: new Date().toISOString(),
      customDeck: null,
      difficulty: 'unrated',
      bookmarked: false,
      partOfSpeech: normalizePartOfSpeech(wordInfo.partOfSpeech),
      cefrLevel: wordInfo.cefrLevel,
      exampleSentence: wordInfo.exampleSentence,
      exampleTranslation: wordInfo.exampleTranslation,
      collocations: wordInfo.collocations,
      synonyms: wordInfo.synonyms,
      antonyms: wordInfo.antonyms,
      register: wordInfo.register,
      commonMistake: wordInfo.commonMistake,
      correctStreak: 0,
    };
    return { card, mediaPromise };
  };

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!wordInput.trim()) return;
    if (generationInFlightRef.current) return;
    if (wordInput.trim().length > 80) {
      setError('A word or phrase cannot be longer than 80 characters.');
      return;
    }
    if (user && libraryEpochState?.userId !== user.uid) {
      setError('Cloud sync safety is not verified yet. Your word is still here—try again after Firebase reconnects.');
      return;
    }

    generationInFlightRef.current = true;
    setIsLoading(true);
    setError(null);

    try {
      const queryWord = normalizeCardWord(wordInput);
      let mirroredExistingCard: CardData | null = null;
      let mirrorStatus: Awaited<ReturnType<typeof getCardMirrorStatus>> = null;
      if (user) {
        try {
          mirrorStatus = await getCardMirrorStatus(user.uid);
          mirroredExistingCard = await findMirroredCardByWord(user.uid, queryWord);
        } catch (mirrorError) {
          mirrorStatus = null;
          console.warn('Exact lookup in the IndexedDB mirror is unavailable; verifying against Firebase.', mirrorError);
        }
      }
      const deviceBackup = user ? null : await loadDeviceCards();
      const deviceCachedCards = deviceBackup
        && deviceBackup.ownerUserId !== undefined
        && canUseDeviceBackupForSession(deviceBackup.ownerUserId, user?.uid ?? null)
        ? normalizeLocalCards(deviceBackup.cards)
        : [];
      // The create form can be submitted while the initial auth/cache effects are
      // still settling. Read the durable guest cache as an additional exact-match
      // source so an existing word is never sent to AI or duplicated in that gap.
      const sessionCachedCards = user
        ? []
        : normalizeLocalCards(readLocalJson<unknown>('lingoflash_cards', []));
      const cachedCards = mirroredExistingCard
        ? [mirroredExistingCard, ...deviceCachedCards, ...sessionCachedCards]
        : [...deviceCachedCards, ...sessionCachedCards];
      const database = db;
      const currentUser = user;
      const verifyRemote = isFirebaseConfigured && database && currentUser
        ? () => findCardByNormalizedWord(database, currentUser.uid, queryWord)
        : undefined;
      const mirrorRequiresRemoteVerification = shouldRequireRemoteUniquenessCheck(mirrorStatus);
      const shouldAttemptRemoteVerification = shouldAttemptRemoteUniquenessCheck({
        mirrorStatus,
        cloudAvailable: Boolean(
          currentUser
          && isBrowserOnline
          && !cloudReadUnavailable
          && !isCloudBackoffActive(currentUser.uid),
        ),
        verifierAvailable: Boolean(verifyRemote),
      });
      let uniquenessVerified = !mirrorRequiresRemoteVerification;
      let existingCard: CardData | null = null;
      try {
        existingCard = await resolveExistingCard({
          word: queryWord,
          visibleCards: cards,
          cachedCards,
          requireRemoteVerification: shouldAttemptRemoteVerification,
          verifyRemote,
        });
        uniquenessVerified = Boolean(existingCard)
          || !mirrorRequiresRemoteVerification
          || shouldAttemptRemoteVerification;
      } catch (uniquenessError) {
        if (!canDeferRemoteUniquenessFailure(uniquenessError)) {
          throw uniquenessError;
        }
        uniquenessVerified = false;
      }

      const revealExistingCard = (card: CardData) => {
        const revealState = existingCardRevealState();
        const promotion = promoteExistingCard(card);
        const promotedCard = promotion.card;
        recentlyPromotedCardsRef.current.set(cardWordKey(promotedCard), promotedCard);
        if (user) {
          void upsertMirroredCardBatch(user.uid, [promotedCard]).catch(mirrorError => {
            console.warn('The existing card was opened, but its local mirror entry could not be refreshed.', mirrorError);
          });
        }
        setCards(previous => {
          const nextCards = retainCardsForSession(
            [promotedCard, ...previous.filter(candidate => cardWordKey(candidate) !== queryWord)],
            Boolean(user),
            cardsPerPage,
          );
          localStorage.setItem('lingoflash_cards', JSON.stringify(nextCards));
          return nextCards;
        });
        void mergeDeviceCards([promotedCard], knownLibraryTotalRef.current, user?.uid ?? null);
        catalogActions.replaceQuery(revealState);
        setNotice(`“${promotedCard.word}” is already in your library. It has been moved to the top of page 1.`);
        setWordInput('');
        setLibraryFocusRequest(previous => previous + 1);
        void handleUpdateCard(promotedCard.id, promotion.fields, promotedCard);
        void hydrateExistingCardImage(promotedCard, true);
      };

      // Existing learning content is surfaced without regeneration or rewriting it.
      if (existingCard) {
        revealExistingCard(existingCard);
        return;
      }

      if (!import.meta.env.DEV && !currentUser) {
        setError('Sign in to generate AI cards and sync them safely across devices.');
        return;
      }

      const { card: newCard, mediaPromise } = await withTimeout(
        createCard(wordInput),
        22_000,
        'Card generation took too long. Your word is still here, so please try again.',
      );
      let cardQueuedForCloud = false;
      let persistedCard = newCard;
      if (isFirebaseConfigured && db && user) {
        const creationDatabase = db;
        const creationUserId = user.uid;
        const creation = await persistCardWithMirrorFallback({
          card: newCard,
          uniquenessVerified,
          createInCloud: () => withTimeout(
            createCardIfAbsent(
              creationDatabase,
              creationUserId,
              newCard,
              {
                libraryEpoch: libraryEpochState?.userId === creationUserId
                  ? libraryEpochState.value
                  : 0,
              },
            ),
            8_000,
            'Saving the card took too long. It will remain queued on this device.',
          ),
        });
        if (!creation.created) {
          revealExistingCard(creation.card);
          return;
        }
        persistedCard = creation.card;
        cardQueuedForCloud = creation.queued;
        if (cardQueuedForCloud) {
          setCloudReadUnavailable(true);
          setNotice('Firebase is temporarily unavailable. The card was created locally and will sync automatically.');
        }
      }
      setCards((prev) => {
        const nextCards = retainCardsForSession(
          [persistedCard, ...prev.filter(card => card.id !== persistedCard.id)],
          Boolean(user),
          cardsPerPage,
        );
        localStorage.setItem('lingoflash_cards', JSON.stringify(nextCards));
        return nextCards;
      });
      const pendingOperations = await upsertDeviceCards([persistedCard], Math.max(knownLibraryTotal, cloudStats.total) + 1);
      if (isFirebaseConfigured && db && user) {
        if (!cardQueuedForCloud) {
          void acknowledgeDevicePending(pendingOperations);
          void updateCategoryFacets({ [persistedCard.category || 'Other']: 1 }).catch(facetError => {
            console.warn('Card synced, but category facets will update on the next refresh.', facetError);
          });
        }
        catalogActions.goToPage(1);
      }
      handleAddXp(10); // Reward for creating a card
      setWordInput('');
      const mediaLifecycle = `${hydrationSessionVersionRef.current}:${cardLifecycleVersionRef.current.get(persistedCard.id) ?? 0}`;
      void mediaPromise.then(media => handleUpdateCard(persistedCard.id, media, persistedCard, mediaLifecycle));
      if (user) {
        setCloudStats(previous => ({ ...previous, total: previous.total + 1, unrated: previous.unrated + 1 }));
        setCloudTotal(previous => Math.max(previous, cards.length + 1));
      }
    } catch (err: unknown) {
      console.error(err);
      const source = typeof err === 'object' && err !== null ? err as { code?: unknown; status?: unknown } : null;
      const status = Number(source?.status ?? 0);
      const code = String(source?.code ?? '');
      const message = err instanceof CardUniquenessCheckError
        ? 'The card could not be queued safely on this device. Reload the app and try again.'
        : err instanceof OperationTimeoutError
        ? err.message
        : status === 429 || code.includes('resource-exhausted')
          ? 'The AI rate limit has been reached. Wait a moment and try again. Your word is still saved.'
          : err instanceof TypeError && err.message === 'Failed to fetch'
            ? 'Could not connect to the AI service. Check your network and try again.'
            : 'Failed to generate the flashcard. Your word is still here, so you can try again.';
      setError(message);
    } finally {
      generationInFlightRef.current = false;
      setIsLoading(false);
    }
  };

  const handleExcelImport = useSpreadsheetImport({
    user,
    libraryEpoch: user && libraryEpochState?.userId === user.uid ? libraryEpochState.value : 0,
    cards,
    knownLibraryTotal,
    cloudStats,
    setCloudStats,
    setCards,
    resetCloudPage: () => {
      catalogActions.goToPage(1);
      setCloudRefresh(previous => previous + 1);
    },
    fileInputRef,
    setError,
    setIsLoading,
    setImportProgress,
    upsertDeviceCards,
    updateCategoryFacets,
    createCard,
    updateCard: handleUpdateCard,
    getCardUpdateLifecycle: cardId => `${hydrationSessionVersionRef.current}:${cardLifecycleVersionRef.current.get(cardId) ?? 0}`,
    addXp: handleAddXp,
  });

  const clearAll = async () => {
    if (!canStartLibraryClear(isLoading)) {
      setError('Wait for the current card generation or import to finish before clearing the library.');
      return;
    }
    hydrationSessionVersionRef.current += 1;
    setShowClearConfirm(false);
    if (isFirebaseConfigured && db && user) {
      const clearDatabase = db;
      const clearUserId = user.uid;
      libraryClearInFlightUserRef.current = clearUserId;
      setIsLoading(true);
      const acquiredClearLease = await acquireDevicePendingFlush(clearUserId);
      if (!acquiredClearLease) {
        libraryClearInFlightUserRef.current = null;
        if (isActiveUserSession(clearUserId, activeUserIdRef.current)) {
          setIsLoading(false);
          setError('Cloud sync is finishing another operation. Try clearing the library again in a moment.');
        }
        return;
      }
      let cardDeletionCompleted = false;
      try {
        const activeMirrorSync = mirrorSyncInFlightRef.current;
        if (activeMirrorSync?.userId === clearUserId) {
          await activeMirrorSync.promise.catch(mirrorError => {
            console.warn('The active local mirror sync stopped before the library was cleared.', mirrorError);
          });
        }
        await runEpochProtectedLibraryClear({
          incrementEpoch: () => incrementLibraryEpoch(clearDatabase, clearUserId),
          onEpochAdvanced: nextLibraryEpoch => {
            identitySession.acceptVerifiedOwnerEpoch(clearUserId, nextLibraryEpoch);
          },
          clearPending: () => clearDevicePending(clearUserId),
          deleteCards: () => deleteAllCards(clearDatabase, clearUserId),
        });
        cardDeletionCompleted = true;
        await clearMirroredCards(clearUserId).catch(mirrorError => {
          console.warn('Cloud cards were cleared, but the local IndexedDB mirror will be reset on the next sync.', mirrorError);
        });
        await setDoc(doc(db, 'users', clearUserId, 'profile', 'library_facets'), {
          categories: {},
          complete: true,
          version: 1,
          updatedAt: new Date().toISOString(),
        });
        if (isActiveUserSession(clearUserId, activeUserIdRef.current)) {
          setCloudCategoryCounts({});
          setCloudFacetsComplete(true);
          setLegacyCardsPending(0);
          setCloudStats({ total: 0, easy: 0, good: 0, hard: 0, unrated: 0, bookmarked: 0, due: 0, legacyUnindexed: 0 });
          setCloudTotal(0);
          setHasNextCloudPage(false);
          setCards([]);
          practiceSnapshotRef.current.clear();
          localStorage.removeItem('lingoflash_cards');
          await saveDeviceCards([], 0, [], 'replace', clearUserId);
          catalogActions.goToPage(1);
        }
      } catch (err) {
        const recovery = planClearFailureRecovery(cardDeletionCompleted);
        localStorage.removeItem(cloudPageCacheKey(clearUserId));
        localStorage.removeItem(cloudStatsCacheKey(clearUserId));
        localStorage.removeItem(cloudFacetsCacheKey(clearUserId));
        if (isActiveUserSession(clearUserId, activeUserIdRef.current)) {
          handleFirestoreError(err, OperationType.DELETE, `users/${clearUserId}/cards`);
          catalogActions.goToPage(1);
          if (recovery.clearLocalView) {
            setCloudCategoryCounts({});
            setCloudFacetsComplete(false);
            setLegacyCardsPending(0);
            setCloudStats({ total: 0, easy: 0, good: 0, hard: 0, unrated: 0, bookmarked: 0, due: 0, legacyUnindexed: 0 });
            setCloudTotal(0);
            setHasNextCloudPage(false);
            setCards([]);
            practiceSnapshotRef.current.clear();
            localStorage.removeItem('lingoflash_cards');
            await saveDeviceCards([], 0, [], 'replace', clearUserId);
          }
          setCloudRefresh(value => value + 1);
          setError(recovery.message);
        }
      } finally {
        if (libraryClearInFlightUserRef.current === clearUserId) {
          libraryClearInFlightUserRef.current = null;
        }
        if (isActiveUserSession(clearUserId, activeUserIdRef.current)) setIsLoading(false);
        await releaseDevicePendingFlush(clearUserId);
      }
    } else {
      setCards([]);
      localStorage.removeItem('lingoflash_cards');
      void saveDeviceCards([], 0, [], 'replace', null);
    }
  };

  const exportToExcel = async () => {
    if (knownLibraryTotal === 0 || (user && cloudReadUnavailable && visibleLibraryCount === 0)) return;
    setIsLoading(true);
    try {
      const XLSX = await import('@e965/xlsx');
      const exportCards = isFirebaseConfigured && db && user
        ? await fetchAllCardsOnDemand(db, user.uid)
        : cards;
      const data = cardsToSpreadsheetRows(exportCards);
      const ws = XLSX.utils.json_to_sheet(data);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Flashcards");
      XLSX.writeFile(wb, "SonFlash_Export.xlsx");
    } catch (exportError) {
      console.warn('Library export failed.', exportError);
      setError('Could not export the library. Check your connection and try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const deleteCard = useCallback(async (id: string) => {
    if (user && libraryEpochState?.userId !== user.uid) {
      setError('Cloud sync state is not verified yet. Try deleting the card again after synchronization reconnects.');
      return;
    }
    const deletedCard = cardsRef.current.find(card => card.id === id)
      ?? practiceSnapshotRef.current.findCard(id);
    let pendingOperations: DevicePendingOperation[];
    try {
      pendingOperations = await removeDeviceCard(id);
    } catch (queueError) {
      console.warn('The card was not removed because its delete command could not be stored safely.', queueError);
      setError('The delete could not be stored safely, so the card was left unchanged. Please try again.');
      return;
    }
    cardLifecycleVersionRef.current.set(id, (cardLifecycleVersionRef.current.get(id) ?? 0) + 1);
    setCards(prev => prev.filter(c => c.id !== id));
    practiceSnapshotRef.current.removeCard(id);
    if (isFirebaseConfigured && db && user) {
      const database = db;
      try {
        const pendingDelete = pendingOperations.find(operation => operation.type === 'delete');
        if (!pendingDelete) throw new Error('The delete command could not be queued safely.');
        const deleteResult = await deleteCardWithConflictRecovery({
          cardId: id,
          opId: pendingDelete.opId ?? `legacy-delete-${id}-${pendingDelete.updatedAt}`,
          libraryEpoch: pendingDelete.libraryEpoch ?? 0,
          baseRevision: pendingDelete.baseRevision ?? 0,
        }, command => deleteCardWithTombstone(database, user.uid, command));
        if (!deleteResult.deleted && deleteResult.reason !== 'stale-library-epoch') {
          setError(deleteResult.reason === 'future-library-epoch'
            ? 'Cloud library generation changed. The delete is still queued while sync state refreshes.'
            : 'The card changed again during delete recovery. The delete remains safely queued.');
          return;
        }
        await deleteMirroredCard(user.uid, id).catch(mirrorError => {
          console.warn('The cloud delete succeeded, but the local IndexedDB mirror will catch up on the next sync.', mirrorError);
        });
        await acknowledgeDevicePending(pendingOperations);
        if (deletedCard) {
          const deletedDifficulty = deletedCard.difficulty && deletedCard.difficulty !== 'unrated'
            ? deletedCard.difficulty
            : 'unrated';
          setCloudStats(previous => ({
            ...previous,
            total: Math.max(0, previous.total - 1),
            [deletedDifficulty]: Math.max(0, previous[deletedDifficulty] - 1),
            bookmarked: deletedCard.bookmarked ? Math.max(0, previous.bookmarked - 1) : previous.bookmarked,
            due: deletedCard.nextReviewDate && isCardDue(deletedCard) ? Math.max(0, previous.due - 1) : previous.due,
          }));
          void updateCategoryFacets({ [deletedCard.category || 'Other']: -1 });
        }
      } catch (err) {
        handleFirestoreError(err, OperationType.DELETE, `users/${user.uid}/cards/${id}`);
        if (isRetryableSyncError(err)) {
          setCloudReadUnavailable(true);
          if (isQuotaError(err)) {
            localStorage.setItem(cloudBackoffCacheKey(user.uid), String(Date.now() + 5 * 60 * 1000));
          }
          setError('The card was deleted locally and queued. It will sync automatically when Firebase is available.');
        } else {
          await acknowledgeDevicePending(pendingOperations);
          if (deletedCard) {
            setCards(previous => [deletedCard, ...previous.filter(card => card.id !== deletedCard.id)].slice(0, cardsPerPage));
            practiceSnapshotRef.current.restoreCard(deletedCard);
          }
          setError('Firebase rejected the delete. The card has been restored on screen.');
        }
      }
    }
  }, [user, libraryEpochState, updateCategoryFacets, removeDeviceCard, cardsPerPage]);

  const filteredCards = useMemo(() => {
    if (user && db && isFirebaseConfigured) return cards;
    return cards.filter(c => {
      const matchCategory = activeCategory === 'All' || c.category === activeCategory;
      const matchCustomDeck = activeCustomDeck === 'All' ||
                              (activeCustomDeck === 'Unassigned' ? !c.customDeck : c.customDeck === activeCustomDeck);
      const matchDate = activeDate === 'All' || formatCardDate(c.createdAt) === activeDate;
      const matchDifficulty = activeDifficulty === 'All' || 
                              (activeDifficulty === 'unrated' ? !c.difficulty : 
                               (activeDifficulty === 'due' ? isCardDue(c) : c.difficulty === activeDifficulty));
      const matchPartOfSpeech = activePartOfSpeech === 'All' || normalizePartOfSpeech(c.partOfSpeech) === activePartOfSpeech;
      const matchStarred = !showStarredOnly || c.bookmarked === true;
      const searchLower = searchQuery.toLowerCase();
      const matchSearch = !searchQuery || 
                          c.word.toLowerCase().includes(searchLower) || 
                          c.translation.toLowerCase().includes(searchLower);
      return matchCategory && matchCustomDeck && matchDate && matchDifficulty && matchPartOfSpeech && matchStarred && matchSearch;
    });
  }, [cards, activeCategory, activeCustomDeck, activeDate, activeDifficulty, activePartOfSpeech, showStarredOnly, searchQuery, user]);
  const pageableLibraryCount = user ? Math.max(cloudTotal, filteredCards.length) : filteredCards.length;
  const totalPages = calculateTotalPages(
    pageableLibraryCount,
    cardsPerPage,
    currentPage,
    Boolean(user && hasNextCloudPage),
  );
  const paginatedCards = useMemo(() => {
    if (user && db && isFirebaseConfigured) return filteredCards;
    return filteredCards.slice((currentPage - 1) * cardsPerPage, currentPage * cardsPerPage);
  }, [filteredCards, currentPage, user]);
  const libraryCount = user ? Math.max(cloudTotal, cloudStats.total, cards.length) : cards.length;
  const visibleLibraryCount = filteredCards.length;
  const practiceLibraryCount = resolvePracticeLibraryCount(visibleLibraryCount, knownLibraryTotal);
  const canUseVisibleLibrary = visibleLibraryCount > 0;
  const libraryCountLabel = user && cloudReadUnavailable
    ? pageableLibraryCount > 0
      ? `${pageableLibraryCount} CACHED / ${libraryCount} CLOUD`
      : 'CLOUD PAUSED'
    : `${libraryCount} CARDS`;
  const effectiveSyncHealthError = user && libraryEpochState?.userId !== user.uid
    ? 'Cloud generation could not be verified; changes remain safe on this device.'
    : syncHealthError;
  const difficultySummary = useMemo(() => user ? cloudStats : {
    total: cards.length,
    easy: cards.filter(card => card.difficulty === 'easy').length,
    good: cards.filter(card => card.difficulty === 'good').length,
    hard: cards.filter(card => card.difficulty === 'hard').length,
    unrated: cards.filter(card => !card.difficulty || card.difficulty === 'unrated').length,
    bookmarked: cards.filter(card => card.bookmarked).length,
    due: cards.filter(card => isCardDue(card)).length,
  }, [cards, user, cloudStats]);

  // Reorder only the cards already present on this bounded page; cloud page membership stays unchanged.
  const presentationCards = useMemo(
    () => sortCardsByActivity(paginatedCards),
    [paginatedCards],
  );
  const groupedCards = useMemo(() => groupCardsByDate(presentationCards), [presentationCards]);

  const statsData = useMemo(() => {
    const total = difficultySummary.total;
    const learned = difficultySummary.easy;
    const learning = difficultySummary.good + difficultySummary.hard + difficultySummary.unrated;
    const dueToday = difficultySummary.due;
    
    const categoryCounts = user && cloudFacetsComplete
      ? cloudCategoryCounts
      : cards.reduce((acc, c) => {
          const cat = c.category || 'Uncategorized';
          acc[cat] = (acc[cat] || 0) + 1;
          return acc;
        }, {} as Record<string, number>);

    const categoryChart = Object.keys(categoryCounts).map(k => ({ name: k, value: categoryCounts[k] }));

    const difficultyCounts = {
      easy: difficultySummary.easy,
      good: difficultySummary.good,
      hard: difficultySummary.hard,
      unrated: difficultySummary.unrated,
    };

    const difficultyChart = [
      { name: 'Mastered', value: difficultyCounts.easy, color: '#10b981' },
      { name: 'Learning', value: difficultyCounts.good + difficultyCounts.hard, color: '#f59e0b' },
      { name: 'Not reviewed', value: difficultyCounts.unrated, color: '#94a3b8' },
    ].filter(d => d.value > 0);

    // Format XP History chronologically
    const historyDates = Object.keys(xpHistory);
    let xpChartData = historyDates.map(dateStr => {
      return {
        date: dateStr,
        XP: xpHistory[dateStr] || 0
      };
    });

    xpChartData.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    if (xpChartData.length === 0) {
      const todayStr = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      xpChartData = [{ date: todayStr, XP: 0 }];
    }

    return { total, learned, learning, dueToday, categoryChart, categoryChartIsPartial: Boolean(user && !cloudFacetsComplete), difficultyChart, xpChartData };
  }, [cards, xpHistory, difficultySummary, user, cloudFacetsComplete, cloudCategoryCounts]);

  const libraryScreenModel: LibraryScreenModel = {
    isAuthenticated: Boolean(user),
    sync: {
      isOnline: isBrowserOnline,
      isSyncing: Boolean(user && isDeviceSyncing),
      pendingCount: user ? pendingSyncCount : 0,
      error: user ? effectiveSyncHealthError : null,
    },
    overview: {
      total: libraryCount, due: difficultySummary.due, mastered: difficultySummary.easy,
      streak, level, xp, canStudy: canUseVisibleLibrary,
    },
    grid: {
      searchQuery, legacyCardsPending, isMigratingLegacy, libraryHeadingRef, activeCategory,
      filteredCards, isSharing, currentPage, paginatedCards, isPageLoading,
      cloudReadUnavailable, importProgress, groupedCards, customDecks, totalPages,
      hasNextCloudPage, libraryCount,
    },
    tools: {
      fileInputRef, wordInput, isLoading, importProgress, libraryCount, searchQuery,
      showStarredOnly, activeDifficulty, activePartOfSpeech, activeDate, availableDates,
      customDecks, newDeckInput, activeCustomDeck, cards, cloudFacetsComplete,
      sortedCategories, categoryCounts, activeCategory,
    },
  };
  const libraryScreenActions: LibraryScreenActions = {
    retrySync: user ? () => void handleSyncHealthRetry() : undefined,
    startStudy,
    openCardCreator: () => {
      const scrollBehavior = getReducedMotionScrollBehavior();
      document.getElementById('library-tools')?.scrollIntoView({ behavior: scrollBehavior, block: 'start' });
      window.setTimeout(() => document.getElementById('new-word')?.focus(), scrollBehavior === 'auto' ? 0 : 350);
    },
    grid: {
      changeSearch: catalogActions.changeSearch,
      migrateLegacyCards: handleMigrateLegacyCards,
      shareCategory: handleShareCategory,
      deleteCard,
      toggleBookmark,
      assignDeck: handleAssignDeck,
      updateCard: handleUpdateCard,
      changePage: catalogActions.goToPage,
      clearFilters: () => catalogActions.replaceQuery(existingCardRevealState()),
    },
    tools: {
      importCards: handleExcelImport,
      generateCard: handleGenerate,
      changeWordInput: setWordInput,
      changeSearch: catalogActions.changeSearch,
      changeStarredOnly: catalogActions.toggleStarred,
      changeDifficulty: value => catalogActions.chooseDifficulty(value as LibraryDifficulty),
      changePartOfSpeech: catalogActions.choosePartOfSpeech,
      changeDate: catalogActions.chooseDate,
      changeNewDeckInput: setNewDeckInput,
      createCustomDeck: handleCreateCustomDeck,
      changeCustomDeck: catalogActions.chooseDeck,
      deleteCustomDeck: handleDeleteCustomDeck,
      changeCategory: catalogActions.chooseCategory,
    },
  };

  return (
    <div ref={appShellRef} className={`app-canvas min-h-dvh h-dvh text-[var(--sf-text)] font-sans flex flex-col overflow-hidden selection:bg-cyan-500/20 transition-colors relative ${isDarkMode ? 'dark' : ''}`}>
      <div className="ambient-orb ambient-orb-a" aria-hidden="true" />
      <div className="ambient-orb ambient-orb-b" aria-hidden="true" />
      <div className="ambient-orb ambient-orb-c" aria-hidden="true" />
      
      <DesktopNavigation
        navigationRef={navigationRef}
        viewMode={viewMode}
        canUseVisibleLibrary={canUseVisibleLibrary}
        practiceLibraryCount={practiceLibraryCount}
        isPracticeMenuOpen={isPracticeMenuOpen}
        isStatsOpen={isStatsOpen}
        syncIdentity={isAuthLoading
          ? { status: 'loading' }
          : user
            ? {
                status: 'authenticated',
                displayName: user.displayName,
                email: user.email,
                photoUrl: user.photoURL,
              }
            : { status: 'signed-out', isConfigured: isFirebaseConfigured, isSigningIn }}
        isDeviceSyncVisible={import.meta.env.DEV}
        isDeviceSyncing={isDeviceSyncing}
        isDarkMode={isDarkMode}
        canManageLibrary={canUseVisibleLibrary && viewMode === 'library'}
        isLibraryMutationPending={isLoading}
        libraryCountLabel={libraryCountLabel}
        onOpenLibrary={practiceSession.commands.close}
        onStartStudy={startStudy}
        onOpenPractice={openPracticeMenu}
        onOpenInsights={openStats}
        onDeviceSync={handleDeviceSyncNow}
        onSignIn={handleSignIn}
        onSignOut={handleSignOut}
        onToggleTheme={toggleTheme}
        onExportLibrary={exportToExcel}
        onClearLibrary={openClearConfirm}
      />

      <AppFeedback
        authError={authError}
        error={error}
        notice={notice}
        onDismissAuthError={identitySession.clearError}
        onDismissError={() => setError(null)}
        onDismissNotice={() => setNotice(null)}
      />
      <main className="flex-1 relative w-full max-w-[1560px] mx-auto p-4 sm:px-6 sm:py-6 lg:px-8 pb-24 lg:pb-8 overflow-y-auto z-10 scrollbar-thin">
        <h1 ref={viewHeadingRef} tabIndex={-1} className="sr-only">{viewHeading}</h1>
        <div ref={viewStageRef} data-app-view-stage className="min-h-full">
        {viewMode !== 'library' ? (
          <PracticeScreen session={practiceSession} customDecks={customDecks} />
        ) : (
          <LibraryScreen model={libraryScreenModel} actions={libraryScreenActions} />
        )}
        </div>
      </main>

      <AppFooter
        viewMode={viewMode}
        libraryCountLabel={libraryCountLabel}
        isBrowserOnline={isBrowserOnline}
        cloudReadUnavailable={cloudReadUnavailable}
      />

      <MobileNavigation
        viewMode={viewMode}
        canUseVisibleLibrary={canUseVisibleLibrary}
        practiceLibraryCount={practiceLibraryCount}
        isPracticeMenuOpen={isPracticeMenuOpen}
        isStatsOpen={isStatsOpen}
        onOpenLibrary={practiceSession.commands.close}
        onStartStudy={startStudy}
        onOpenPractice={openPracticeMenu}
        onOpenInsights={openStats}
      />

      {hasMountedOverlays && (
        <Suspense fallback={<span className="sr-only" role="status">Opening dialog</span>}>
          <AppOverlays
            shareLink={shareLink}
            setShareLink={value => {
              setShareLink(value);
              if (!value) setActiveShareId(null);
            }}
            canRevokeShare={Boolean(activeShareId)}
            revokeShare={handleRevokeShare}
            isSharing={isSharing}
            isPracticeMenuOpen={isPracticeMenuOpen}
            setIsPracticeMenuOpen={setIsPracticeMenuOpen}
            startQuiz={startQuiz}
            startSpelling={startSpelling}
            visibleLibraryCount={practiceLibraryCount}
            generateStory={handleGenerateStory}
            isStatsOpen={isStatsOpen}
            setIsStatsOpen={setIsStatsOpen}
            statsData={statsData}
            isDarkMode={isDarkMode}
            showClearConfirm={showClearConfirm}
            setShowClearConfirm={setShowClearConfirm}
            clearAll={clearAll}
            isLoading={isLoading}
            shareOpenerRef={shareOpenerRef}
            practiceOpenerRef={practiceOpenerRef}
            statsOpenerRef={statsOpenerRef}
            clearOpenerRef={clearOpenerRef}
          />
        </Suspense>
      )}
      <Suspense fallback={null}>
        <AppShellMotion
          appShellRef={appShellRef}
          navigationRef={navigationRef}
          viewMode={viewMode}
          viewStageRef={viewStageRef}
        />
      </Suspense>
    </div>
  );
}
