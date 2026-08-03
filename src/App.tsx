import React, { lazy, Suspense, useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { fetchImageUrl, isSupportedImageUrl } from './lib/images';
import { hydrateMissingCardImage } from './lib/cardImageHydration';
import { isCardDue } from './lib/srs';
import { CLOUD_PAGE_SIZE, queryStateKey, type CardQueryState } from './lib/cardQuery';
import { mapWithConcurrency } from './lib/asyncPool';
import { loadDeviceCards } from './lib/deviceSync';
import { getReducedMotionScrollBehavior } from './lib/motion';
import {
  applyCategoryDeltas,
  fetchAllCardsOnDemand,
  fetchCardPage,
  fetchPracticeCards,
} from './lib/cardRepository';
import type { CardData } from './types/card';
import { cardWordKey } from './lib/cardIdentity';
import { isCardUpdateLifecycleCurrent } from './lib/cardUpdates';
import { canUseDeviceBackupForSession, retainCardsForSession, selectCardsVisibleForSession } from './lib/sessionCards';
import { dateLabelToQueryDate, existingCardRevealState } from './features/library/libraryPresentation';
import { normalizeCustomDeckCollection, planCustomDeckCreation } from './features/library/customDecks';
import { canStartLibraryClear, planDeckDeletionFailureRecovery } from './features/library/libraryMutationRecovery';
import { useGamification } from './features/gamification/useGamification';
import { PracticeScreen } from './features/practice/PracticeScreen';
import {
  usePracticeSession,
  type PracticeSnapshotPort,
} from './features/practice/usePracticeSession';
import { ENGLISH_TO_VIETNAMESE_PROFILE } from './features/language/languageProfile';
import { createLibrarySessionHookDependencies, useLibrarySession } from './features/librarySession/useLibrarySession';
import { createOwnerDeckMutationFirebaseAdapter, createOwnerLibrarySessionFirebaseAdapter } from './features/librarySession/ownerLibrarySessionFirebaseAdapter';
import { useIdentitySession } from './features/session/useIdentitySession';
import { useLearningWorkspace } from './features/learning/useLearningWorkspace';
import { LibraryScreen, type LibraryScreenActions, type LibraryScreenModel } from './features/library/LibraryScreen';
import { buildLibraryViewModel } from './features/library/libraryViewModel';
import { cardsToSpreadsheetRows } from './features/importExport/spreadsheetModel';
import { useIntakeSharingSession } from './features/intake/useIntakeSharingSession';
import { createSharedDeckFirebaseAdapter } from './features/sharing/sharedDeckFirebaseAdapter';
import { useBrowserCapabilities } from './features/browser/useBrowserCapabilities';
import { type LibraryDifficulty } from './features/catalog/libraryCatalogQuery';
import { useLibraryCatalogQuery } from './features/catalog/useLibraryCatalogQuery';
import { AppFeedback } from './components/shell/AppFeedback';
import { AppFooter } from './components/shell/AppFooter';
import { DesktopNavigation } from './components/shell/DesktopNavigation';
import { MobileNavigation } from './components/shell/MobileNavigation';
import { useAppNavigation } from './features/navigation/useAppNavigation';
import { useOverlayState } from './features/overlays/useOverlayState';
import {
  cloudFacetsCacheKey,
  cloudPageCacheKey,
  cloudStatsCacheKey,
  isCloudBackoffActive,
  isQuotaError,
  localCardsOwnerKey,
  localDecksOwnerKey,
  normalizeLocalCards,
  readLocalJson,
} from './features/library/libraryStorage';

// Firebase imports
import { 
  app,
  db, 
  isFirebaseConfigured,
} from './lib/firebase';

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

const librarySessionHooks = createLibrarySessionHookDependencies(
  () => useIdentitySession({ app, configured: isFirebaseConfigured }),
);

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
  const [cards, setCards] = useState<CardData[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const {
    notice,
    setNotice,
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
  const [cloudTotal, setCloudTotal] = useState(0);
  const [cloudStats, setCloudStats] = useState({ total: 0, easy: 0, good: 0, hard: 0, unrated: 0, bookmarked: 0, due: 0, legacyUnindexed: 0 });
  const [cloudCategoryCounts, setCloudCategoryCounts] = useState<Record<string, number>>({});
  const [cloudFacetsComplete, setCloudFacetsComplete] = useState(false);
  const [hasNextCloudPage, setHasNextCloudPage] = useState(false);
  const [isPageLoading, setIsPageLoading] = useState(false);
  const [cloudReadUnavailable, setCloudReadUnavailable] = useState(false);
  const [cloudRefresh, setCloudRefresh] = useState(0);
  const [browserOwnerKey, setBrowserOwnerKey] = useState<string | null>(null);
  const cardsRef = useRef(cards);
  const practiceSnapshotRef = useRef<PracticeSnapshotPort>(emptyPracticeSnapshot);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageHydrationAttemptedRef = useRef(new Set<string>());
  const imageHydrationInFlightRef = useRef(new Map<string, Promise<Partial<CardData> | null>>());
  const cardLifecycleVersionRef = useRef(new Map<string, number>());
  const activeUserIdRef = useRef<string | null>(null);
  const adoptedOwnerModelRef = useRef<string | null>(null);
  const recentlyPromotedCardsRef = useRef(new Map<string, CardData>());
  const appShellRef = useRef<HTMLDivElement | null>(null);
  const navigationRef = useRef<HTMLElement | null>(null);
  const viewStageRef = useRef<HTMLDivElement | null>(null);
  const cardsPerPage = CLOUD_PAGE_SIZE;
  const {
    viewMode,
    setViewMode,
    viewHeading,
    viewHeadingRef,
    isDarkMode,
    toggleTheme,
  } = useAppNavigation({ practiceOpenerRef });
  const browserCapabilities = useBrowserCapabilities({
    ownerKey: browserOwnerKey,
    page: currentPage,
    pageLoading: isPageLoading,
    view: viewMode,
    libraryBusy: isLoading,
  });
  const isBrowserOnline = browserCapabilities.model.isOnline;
  const libraryHeadingRef = browserCapabilities.refs.libraryHeading;
  const hydrationSessionVersionRef = browserCapabilities.refs.hydrationGeneration;
  const cloudQueryState = useMemo<CardQueryState>(() => ({
    category: activeCategory === 'All' ? null : activeCategory,
    customDeck: activeCustomDeck === 'All'
      ? null
      : activeCustomDeck === 'Unassigned' ? 'unassigned' : activeCustomDeck,
    difficulty: activeDifficulty === 'All' ? null : activeDifficulty as CardQueryState['difficulty'],
    partOfSpeech: activePartOfSpeech === 'All' ? null : activePartOfSpeech,
    bookmarkedOnly: showStarredOnly,
    createdDate: dateLabelToQueryDate(activeDate),
    wordPrefix: debouncedSearch,
  }), [activeCategory, activeCustomDeck, activeDifficulty, activePartOfSpeech, showStarredOnly, activeDate, debouncedSearch]);
  const cloudQueryKey = useMemo(() => queryStateKey(cloudQueryState), [cloudQueryState]);
  const ownerLibraryAdapter = useMemo(
    () => createOwnerLibrarySessionFirebaseAdapter({ database: db, configured: isFirebaseConfigured }),
    [],
  );
  const ownerDeckMutations = useMemo(() => createOwnerDeckMutationFirebaseAdapter(db), []);
  const acceptVerifiedOwnerEpochRef = useRef<(ownerId: string, epoch: number) => boolean>(() => false);
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
    verifyEpoch: ({ userId, value }: { userId: string; value: number }) =>
      acceptVerifiedOwnerEpochRef.current(userId, value),
  }), [catalogActions, setNotice]);
  const librarySession = useLibrarySession({
    catalog: {
      query: cloudQueryState, queryKey: cloudQueryKey, page: currentPage,
      pageSize: cardsPerPage, refreshKey: cloudRefresh, statsOpen: isStatsOpen,
    },
    library: {
      cards, knownTotal: Math.max(cloudTotal, cloudStats.total, cards.length),
      cloudTotal, cloudStatsTotal: cloudStats.total,
      browserOnline: isBrowserOnline, cloudUnavailable: cloudReadUnavailable,
    },
    ports: {
      ownerAdapter: ownerLibraryAdapter,
      deviceEvents: deviceSyncEvents,
      getPromotedCards: () => [...recentlyPromotedCardsRef.current.values()],
    },
  }, librarySessionHooks);
  const identitySession = librarySession.model.identity;
  acceptVerifiedOwnerEpochRef.current = librarySession.actions.identity.acceptVerifiedOwnerEpoch;
  const user = useMemo(() => identitySession.owner ? {
    uid: identitySession.owner.id,
    displayName: identitySession.owner.displayName,
    email: identitySession.owner.email,
    photoURL: identitySession.owner.photoUrl,
  } : null, [identitySession.owner]);
  const isAuthLoading = identitySession.status === 'loading';
  const authError = identitySession.error;
  const isSigningIn = identitySession.isSigningIn;
  const libraryEpochState = identitySession.ownerEpoch
    ? { userId: identitySession.ownerEpoch.ownerId, value: identitySession.ownerEpoch.value }
    : null;
  const ownerLibrary = librarySession.model.owner;
  const legacyCardsPending = user && ownerLibrary.ownerId === user.uid ? ownerLibrary.legacyPending : 0;
  const isMigratingLegacy = Boolean(user && ownerLibrary.ownerId === user.uid && ownerLibrary.isMigratingLegacy);
  const {
    acknowledge: acknowledgeDevicePending,
    upsert: upsertDeviceCards,
    patch: patchDeviceCards,
    remove: removeDeviceCard,
  } = librarySession.ports.cards;
  const { flush: flushDevicePendingToCloud } = librarySession.ports.cloud;
  const { isSyncing: isDeviceSyncing, pendingCount: pendingSyncCount, error: syncHealthError } = librarySession.model.sync;
  const { syncNow: handleDeviceSyncNow, retry: handleSyncHealthRetry } = librarySession.actions.sync;
  const knownLibraryTotal = user ? Math.max(cloudTotal, cloudStats.total, cards.length) : cards.length;
  const knownLibraryTotalRef = useRef(knownLibraryTotal);
  cardsRef.current = cards;
  knownLibraryTotalRef.current = knownLibraryTotal;
  activeUserIdRef.current = user?.uid ?? null;

  useEffect(() => {
    setBrowserOwnerKey(user?.uid ?? null);
    recentlyPromotedCardsRef.current.clear();
  }, [user?.uid]);

  const { streak, xp, xpHistory, level, addXp: handleAddXp } = useGamification(
    user,
    Boolean(user && isCloudBackoffActive(user.uid)),
  );

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

  const learningCommands = useLearningWorkspace({
    owner: {
      id: user?.uid ?? null,
      verifiedEpoch: user && libraryEpochState?.userId === user.uid ? libraryEpochState.value : null,
    },
    library: {
      knownTotal: knownLibraryTotal,
      findCard: cardId => cardsRef.current.find(card => card.id === cardId),
      isPatchCurrent: (cardId, expectedLifecycle) => !expectedLifecycle || isCardUpdateLifecycleCurrent(
        expectedLifecycle,
        `${hydrationSessionVersionRef.current}:${cardLifecycleVersionRef.current.get(cardId) ?? 0}`,
      ),
      publication: {
        patch: (cardId, fields) => setCards(current => {
          const updated = current.map(card => card.id === cardId ? { ...card, ...fields } : card);
          localStorage.setItem('lingoflash_cards', JSON.stringify(
            retainCardsForSession(updated, Boolean(activeUserIdRef.current), cardsPerPage),
          ));
          return updated;
        }),
        remove: cardId => {
          cardLifecycleVersionRef.current.set(cardId, (cardLifecycleVersionRef.current.get(cardId) ?? 0) + 1);
          setCards(current => current.filter(card => card.id !== cardId));
        },
        clear: () => {
          browserCapabilities.actions.bumpHydrationSession();
          setCards([]);
          localStorage.removeItem('lingoflash_cards');
        },
      },
    },
    practice: {
      findCard: cardId => practiceSnapshotRef.current.findCard(cardId),
      publication: {
        patch: (cardId, fields) => practiceSnapshotRef.current.updateCard(cardId, fields),
        remove: cardId => practiceSnapshotRef.current.removeCard(cardId),
        clear: () => practiceSnapshotRef.current.clear(),
      },
    },
    ports: {
      patchDeviceCards,
      removeDeviceCard,
      acknowledgeDevicePending,
      acceptVerifiedEpoch: librarySession.actions.identity.acceptVerifiedOwnerEpoch,
      mutateCloudStats: setCloudStats,
      publishCategoryFacets: updateCategoryFacets,
      resetCloudState: facetsComplete => {
        setCloudCategoryCounts({});
        setCloudFacetsComplete(facetsComplete);
        setCloudStats({ total: 0, easy: 0, good: 0, hard: 0, unrated: 0, bookmarked: 0, due: 0, legacyUnindexed: 0 });
        setCloudTotal(0);
        setHasNextCloudPage(false);
      },
      resetCloudPage: () => catalogActions.goToPage(1),
      refreshCloud: () => setCloudRefresh(value => value + 1),
      cloudAvailabilityChanged: setCloudReadUnavailable,
      mutationPendingChanged: setIsLoading,
      reportError: setError,
      addXp: handleAddXp,
    },
  }).actions;

  const cloudPage = librarySession.model.cloud;

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
  }, [cloudPage.ownerId, cloudPage.stats, user]);

  useEffect(() => {
    if (!user || cloudPage.ownerId !== user.uid) return;
    setCloudCategoryCounts(cloudPage.facets);
    setCloudFacetsComplete(cloudPage.facetsComplete);
  }, [cloudPage.facets, cloudPage.facetsComplete, cloudPage.ownerId, user]);

  useEffect(() => {
    if (identitySession.status === 'loading') return;
    if (!user) {
      adoptedOwnerModelRef.current = null;
      const localCards = normalizeLocalCards(readLocalJson<unknown>('lingoflash_cards', []));
      setCards(selectCardsVisibleForSession(localCards, localStorage.getItem(localCardsOwnerKey), null));
      setCustomDecks([]);
      setCloudCategoryCounts({});
      setCloudFacetsComplete(false);
      return;
    }
    if (ownerLibrary.ownerId !== user.uid) return;
    setCustomDecks(ownerLibrary.decks);
    if (adoptedOwnerModelRef.current === user.uid) return;
    adoptedOwnerModelRef.current = user.uid;
    setCards(ownerLibrary.cards);
    setCloudTotal(0);
    setCloudCategoryCounts({});
    setCloudFacetsComplete(false);
    catalogActions.goToPage(1);
  }, [catalogActions, identitySession.status, ownerLibrary, user]);

  useEffect(() => {
    if (ownerLibrary.error) setError(ownerLibrary.error);
  }, [ownerLibrary.error]);
  // Save custom decks local backup
  useEffect(() => {
    if (user && localStorage.getItem(localDecksOwnerKey) === user.uid) {
      localStorage.setItem('lingoflash_custom_decks', JSON.stringify(customDecks));
    }
  }, [customDecks, user]);

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

  const toggleBookmark = useCallback(async (cardId: string) => {
    await learningCommands.toggleBookmark(cardId);
  }, [learningCommands]);
  const handleAssignDeck = useCallback(
    async (cardId: string, deckName: string | null) => {
      await learningCommands.assignDeck(cardId, deckName);
    },
    [learningCommands],
  );

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
      ownerDeckMutations.add(user.uid, plan.name).catch(console.error);
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
        await ownerDeckMutations.clearAssignments(user.uid, deckName);
        assignmentsCleared = true;
        await ownerDeckMutations.removeProfile(user.uid, deckName);
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
  }, [catalogActions, customDecks, activeCustomDeck, user, cards, ownerDeckMutations, patchDeviceCards, knownLibraryTotal]);

  const updateCardDifficulty = useCallback(async (...args: Parameters<typeof learningCommands.reviewCard>) => {
    await learningCommands.reviewCard(...args);
  }, [learningCommands]);

  const handleUpdateCard = useCallback(async (
    cardId: string,
    updatedFields: Partial<CardData>,
    explicitSource?: CardData,
    expectedLifecycle?: string,
  ) => {
    await learningCommands.updateCard(cardId, updatedFields, {
      source: explicitSource,
      expectedLifecycle,
    });
  }, [learningCommands]);

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

  const resetSpreadsheetSource = useCallback(() => {
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);
  const sharedDeckAdapter = useMemo(() => createSharedDeckFirebaseAdapter({
    app, database: db, configured: isFirebaseConfigured,
  }), []);
  const loadShareCards = useCallback(async (category: string) => {
    if (!db || !user) return [];
    const page = await fetchCardPage({
      db,
      userId: user.uid,
      filters: {
        category: category === 'All' ? null : category,
        customDeck: null, difficulty: null, partOfSpeech: null,
        bookmarkedOnly: false, createdDate: null, wordPrefix: '',
      },
      pageSize: 100,
    });
    return page.items;
  }, [user]);
  const intakeSharing = useIntakeSharingSession({
    ownerKey: user?.uid ?? null,
    intake: {
      ownerId: user?.uid ?? null,
      libraryEpoch: user && libraryEpochState?.userId === user.uid ? libraryEpochState.value : null,
      knownLibraryTotal,
      cloudStats,
      cardsPerPage,
      getCards: () => cardsRef.current,
      publishCards: setCards,
      upsertDeviceCards,
      acknowledgeDevicePending,
      patchCard: handleUpdateCard,
      hydrateExisting: card => void hydrateExistingCardImage(card, true),
      rememberPromoted: card => recentlyPromotedCardsRef.current.set(cardWordKey(card), card),
      resetCatalog: () => catalogActions.replaceQuery(existingCardRevealState()),
      resetCloudPage: () => {
        catalogActions.goToPage(1);
        setCloudRefresh(value => value + 1);
      },
      updateCloudStats: setCloudStats,
      updateCloudTotal: setCloudTotal,
      updateCategoryFacets,
      setCloudUnavailable: setCloudReadUnavailable,
      notify: setNotice,
      focusLibrary: browserCapabilities.actions.requestLibraryFocus,
      addXp: handleAddXp,
    },
    sharing: { adapter: sharedDeckAdapter, loadCards: loadShareCards },
    language: ENGLISH_TO_VIETNAMESE_PROFILE,
    resetSpreadsheetSource,
    feedback: { reportError: setError, notify: setNotice },
    externalBusy: isLoading,
  });
  const isLibraryBusy = intakeSharing.model.isBusy;
  const wordInput = intakeSharing.model.draft;
  const importProgress = intakeSharing.model.importProgress;
  const isSharing = intakeSharing.model.share.isLoading;
  const handleMigrateLegacyCards = async () => {
    const result = await librarySession.actions.owner.migrateLegacy();
    if (result.status === 'completed' && result.complete) {
      catalogActions.goToPage(1);
      setCloudRefresh(value => value + 1);
    }
  };

  const handleSignIn = async () => { await librarySession.actions.identity.signIn(); };
  const handleSignOut = async () => {
    const result = await librarySession.actions.identity.signOut();
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
    rememberOpener(shareOpenerRef);
    await intakeSharing.actions.shareCategory(activeCategory);
  };

  const handleGenerate = async (event: React.FormEvent) => {
    event.preventDefault();
    await intakeSharing.actions.generate();
  };
  const handleExcelImport = (event: React.ChangeEvent<HTMLInputElement>) => {
    void intakeSharing.actions.importFile(event.target.files?.[0] ?? null);
  };
  const clearAll = async () => {
    if (!canStartLibraryClear(isLoading)) {
      setError('Wait for the current card generation or import to finish before clearing the library.');
      return;
    }
    setShowClearConfirm(false);
    try {
      await learningCommands.clearLibrary();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The library could not be cleared. Please try again.');
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
    try {
      await learningCommands.deleteCard(id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The card could not be deleted. Please try again.');
    }
  }, [learningCommands]);

  const libraryView = useMemo(() => buildLibraryViewModel({
    cards,
    isAuthenticated: Boolean(user),
    usesCloudPagination: Boolean(db && isFirebaseConfigured),
    cloudTotal,
    cloudStats,
    cloudCategoryCounts,
    cloudFacetsComplete,
    cloudReadUnavailable,
    query: {
      category: activeCategory,
      customDeck: activeCustomDeck,
      date: activeDate,
      difficulty: activeDifficulty,
      partOfSpeech: activePartOfSpeech,
      starredOnly: showStarredOnly,
      search: searchQuery,
    },
    currentPage,
    pageSize: cardsPerPage,
    hasNextCloudPage,
    knownLibraryTotal,
    xpHistory,
  }), [
    cards, user, cloudTotal, cloudStats, cloudCategoryCounts, cloudFacetsComplete,
    cloudReadUnavailable, activeCategory, activeCustomDeck, activeDate, activeDifficulty,
    activePartOfSpeech, showStarredOnly, searchQuery, currentPage, hasNextCloudPage,
    knownLibraryTotal, xpHistory,
  ]);
  const {
    filteredCards,
    paginatedCards,
    groupedCards,
    categoryCounts,
    sortedCategories,
    availableDates,
    difficultySummary,
    stats: statsData,
    countLabel: libraryCountLabel,
  } = libraryView;
  const {
    total: libraryCount,
    visible: visibleLibraryCount,
    practice: practiceLibraryCount,
    totalPages,
  } = libraryView.counts;
  const canUseVisibleLibrary = visibleLibraryCount > 0;
  const effectiveSyncHealthError = user && libraryEpochState?.userId !== user.uid
    ? 'Cloud generation could not be verified; changes remain safe on this device.'
    : syncHealthError;

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
      fileInputRef, wordInput, isLoading: isLibraryBusy, importProgress, libraryCount, searchQuery,
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
      changeWordInput: intakeSharing.actions.changeDraft,
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
        onDismissAuthError={librarySession.actions.identity.clearError}
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
            shareLink={intakeSharing.model.share.shareLink}
            setShareLink={value => { if (!value) intakeSharing.actions.dismissShareLink(); }}
            canRevokeShare={Boolean(intakeSharing.model.share.activeShareId)}
            revokeShare={async () => { await intakeSharing.actions.revokeShare(); }}
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
