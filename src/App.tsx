import React, { lazy, Suspense, useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { buildVocabularyImageQuery, fetchImageUrl, isSupportedImageUrl } from './lib/images';
import { CLOUD_PAGE_SIZE, queryStateKey, type CardQueryState } from './lib/cardQuery';
import { getReducedMotionScrollBehavior } from './lib/motion';
import type { CardData } from './types/card';
import { cardWordKey } from './lib/cardIdentity';
import { retainCardsForSession } from './lib/sessionCards';
import { dateLabelToQueryDate, existingCardRevealState } from './features/library/libraryPresentation';
import { canStartLibraryClear } from './features/library/libraryMutationRecovery';
import { useCustomDeckWorkspace } from './features/library/useCustomDeckWorkspace';
import { PracticeScreen } from './features/practice/PracticeScreen';
import { usePracticeWorkspace } from './features/practice/usePracticeWorkspace';
import { ENGLISH_TO_VIETNAMESE_PROFILE } from './features/language/languageProfile';
import { useLibrarySession } from './features/librarySession/useLibrarySession';
import { useLibrarySessionPorts } from './features/librarySession/useLibrarySessionPorts';
import { useLibraryCloudProjection } from './features/librarySession/useLibraryCloudProjection';
import { useLearningWorkspace, type LearningWorkspaceActions } from './features/learning/useLearningWorkspace';
import { LibraryScreen } from './features/library/LibraryScreen';
import { useCardMediaHydration } from './features/library/useCardMediaHydration';
import { useLibraryScreenContract } from './features/library/useLibraryScreenContract';
import { cardsToSpreadsheetRows } from './features/importExport/spreadsheetModel';
import { useIntakeSharingSession } from './features/intake/useIntakeSharingSession';
import { useBrowserCapabilities } from './features/browser/useBrowserCapabilities';
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
  localCardsOwnerKey,
} from './features/library/libraryStorage';
import { appDependencies } from './app/appDependencies';
import { AppViewStage } from './app/AppViewStage';

const AppOverlays = lazy(() => import('./components/AppOverlays').then(module => ({ default: module.AppOverlays })));
const AppShellMotion = lazy(() => import('./components/motion/AppShellMotion').then(module => ({ default: module.AppShellMotion })));

export default function App() {
  const { model: catalog, actions: catalogActions } = useLibraryCatalogQuery();
  const { category: activeCategory, debouncedSearch, date: activeDate, deck: activeCustomDeck,
    difficulty: activeDifficulty, partOfSpeech: activePartOfSpeech,
    starred: showStarredOnly, page: currentPage } = catalog;
  const [cards, setCards] = useState<CardData[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { notice, setNotice, isPracticeMenuOpen, setIsPracticeMenuOpen, isStatsOpen, setIsStatsOpen,
    showClearConfirm, setShowClearConfirm, hasMountedOverlays, shareOpenerRef, practiceOpenerRef,
    statsOpenerRef, clearOpenerRef, rememberOpener, openPractice,
    openClearConfirm: openClearOverlay } = useOverlayState();
  const [cloudTotal, setCloudTotal] = useState(0);
  const [cloudStats, setCloudStats] = useState({ total: 0, easy: 0, good: 0, hard: 0, unrated: 0, bookmarked: 0, due: 0, legacyUnindexed: 0 });
  const [, setCloudCategoryCounts] = useState<Record<string, number>>({});
  const [, setCloudFacetsComplete] = useState(false);
  const [, setHasNextCloudPage] = useState(false);
  const [isPageLoading, setIsPageLoading] = useState(false);
  const [cloudReadUnavailable, setCloudReadUnavailable] = useState(false);
  const [cloudRefresh, setCloudRefresh] = useState(0);
  const [browserOwnerKey, setBrowserOwnerKey] = useState<string | null>(null);
  const cardsRef = useRef(cards);
  const activeOwnerIdRef = useRef<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const recentlyPromotedCardsRef = useRef(new Map<string, CardData>());
  const appShellRef = useRef<HTMLDivElement | null>(null);
  const navigationRef = useRef<HTMLElement | null>(null);
  const viewStageRef = useRef<HTMLDivElement | null>(null);
  const cardsPerPage = CLOUD_PAGE_SIZE;
  const { viewMode, setViewMode, viewHeading, viewHeadingRef, isDarkMode, toggleTheme } =
    useAppNavigation({ practiceOpenerRef });
  const browserCapabilities = useBrowserCapabilities({
    ownerKey: browserOwnerKey,
    page: currentPage,
    pageLoading: isPageLoading,
    view: viewMode,
    libraryBusy: isLoading,
  });
  const isBrowserOnline = browserCapabilities.model.isOnline;
  const libraryHeadingRef = browserCapabilities.refs.libraryHeading;
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
  const sessionPorts = useLibrarySessionPorts({
    ownerAdapter: appDependencies.adapters.ownerLibrary,
    publications: {
      library: {
        replace: setCards,
        advance: (cardId, advance) => setCards(previous => previous.map(card =>
          card.id === cardId ? advance(card) : card)),
        remove: cardId => setCards(previous => previous.filter(card => card.id !== cardId)),
      },
      practice: {
        find: cardId => practiceSnapshotRef.current.findCard(cardId),
        advance: (cardId, advance) => practiceSnapshotRef.current.updateCard(cardId, advance),
        remove: cardId => practiceSnapshotRef.current.removeCard(cardId),
      },
      cloud: {
        total: setCloudTotal,
        stats: setCloudStats,
        facets: (categories, complete) => {
          setCloudCategoryCounts(categories);
          setCloudFacetsComplete(complete);
        },
        hasNextPage: setHasNextCloudPage,
        unavailable: setCloudReadUnavailable,
        refresh: () => setCloudRefresh(previous => previous + 1),
      },
      navigation: { resetPage: () => catalogActions.goToPage(1), previousPage: catalogActions.goToPreviousPage },
      feedback: { error: setError, notice: setNotice },
      promotedCards: () => [...recentlyPromotedCardsRef.current.values()],
    },
  });
  const librarySession = useLibrarySession({
    catalog: {
      query: cloudQueryState, queryKey: cloudQueryKey, page: currentPage,
      pageSize: cardsPerPage, refreshKey: cloudRefresh, statsOpen: isStatsOpen || viewMode === 'progress',
    },
    library: {
      cards, knownTotal: Math.max(cloudTotal, cloudStats.total, cards.length),
      cloudTotal, cloudStatsTotal: cloudStats.total,
      browserOnline: isBrowserOnline, cloudUnavailable: cloudReadUnavailable,
    },
    ports: sessionPorts.ports.session,
  }, appDependencies.sessions.libraryHooks);
  const identitySession = librarySession.model.identity;
  sessionPorts.actions.connectVerifiedEpoch(librarySession.actions.identity.acceptVerifiedOwnerEpoch);
  const user = useMemo(() => identitySession.owner ? {
    uid: identitySession.owner.id,
    displayName: identitySession.owner.displayName,
    email: identitySession.owner.email,
    photoURL: identitySession.owner.photoUrl,
  } : null, [identitySession.owner]);
  activeOwnerIdRef.current = user?.uid ?? null;
  const isAuthLoading = identitySession.status === 'loading';
  const authError = identitySession.error;
  const isSigningIn = identitySession.isSigningIn;
  const libraryEpochState = identitySession.ownerEpoch
    ? { userId: identitySession.ownerEpoch.ownerId, value: identitySession.ownerEpoch.value }
    : null;
  const ownerLibrary = librarySession.model.owner;
  const { acknowledge: acknowledgeDevicePending, upsert: upsertDeviceCards,
    patch: patchDeviceCards, remove: removeDeviceCard } = librarySession.ports.cards;
  const { isSyncing: isDeviceSyncing } = librarySession.model.sync;
  const { syncNow: handleDeviceSyncNow } = librarySession.actions.sync;
  const knownLibraryTotal = user ? Math.max(cloudTotal, cloudStats.total, cards.length) : cards.length;
  cardsRef.current = cards;
  const cloudProjectionPublication = useMemo(() => ({
    presentCards: setCards,
    presentCloud: (value: { total: number; hasNext: boolean; isLoading: boolean; unavailable: boolean;
      stats: typeof cloudStats; facets: Record<string, number>; facetsComplete: boolean }) => {
      setCloudTotal(value.total);
      setHasNextCloudPage(value.hasNext);
      setIsPageLoading(value.isLoading);
      setCloudReadUnavailable(value.unavailable);
      setCloudStats(value.stats);
      setCloudCategoryCounts(value.facets);
      setCloudFacetsComplete(value.facetsComplete);
    },
    resetCloud: () => {
      setCloudTotal(0);
      setCloudCategoryCounts({});
      setCloudFacetsComplete(false);
    },
    resetPage: () => catalogActions.goToPage(1),
    previousPage: catalogActions.goToPreviousPage,
    reportError: setError,
    notify: setNotice,
  }), [catalogActions, setNotice]);
  useLibraryCloudProjection({ session: librarySession.model, cards, page: currentPage,
    publication: cloudProjectionPublication });

  useEffect(() => {
    setBrowserOwnerKey(user?.uid ?? null);
    recentlyPromotedCardsRef.current.clear();
  }, [user?.uid]);

  const openClearConfirm = (event: React.MouseEvent<HTMLButtonElement>) =>
    openClearOverlay(event.currentTarget, canStartLibraryClear(isLoading));

  const updateCategoryFacets = useCallback(async (deltas: Record<string, number>) => {
    if (!user) return;
    const ownerId = user.uid;
    const facets = await appDependencies.library.updateCategoryFacets(ownerId, deltas);
    if (!facets || activeOwnerIdRef.current !== ownerId) return;
    setCloudCategoryCounts(facets.categories);
    setCloudFacetsComplete(facets.complete);
    localStorage.setItem(cloudFacetsCacheKey(ownerId), JSON.stringify(facets));
  }, [user]);

  const learningActionsRef = useRef<LearningWorkspaceActions | null>(null);
  const practiceLearning = useMemo(() => ({
    reviewCard: (...args: Parameters<LearningWorkspaceActions['reviewCard']>) => learningActionsRef.current?.reviewCard(...args) ?? Promise.resolve(),
    toggleBookmark: (...args: Parameters<LearningWorkspaceActions['toggleBookmark']>) => learningActionsRef.current?.toggleBookmark(...args),
    assignDeck: (...args: Parameters<LearningWorkspaceActions['assignDeck']>) => learningActionsRef.current?.assignDeck(...args),
    updateCard: (cardId: string, fields: Partial<CardData>) => learningActionsRef.current?.updateCard(cardId, fields),
  }), []);
  const practiceWorkspace = usePracticeWorkspace({
    mode: viewMode === 'study' || viewMode === 'quiz' || viewMode === 'spelling' || viewMode === 'story' ? viewMode : 'library',
    openView: nextView => setViewMode(nextView),
    onSessionStarted: () => setIsPracticeMenuOpen(false),
    ownerId: user?.uid ?? null,
    cloudBackoffActive: Boolean(user && isCloudBackoffActive(user.uid)),
    cards,
    poolSource: appDependencies.practice.pool,
    gamificationStore: appDependencies.practice.gamification,
    learning: practiceLearning,
    languageProfile: ENGLISH_TO_VIETNAMESE_PROFILE,
    reportError: setError,
  });
  const practiceSnapshotRef = practiceWorkspace.snapshotRef;
  const { streak, xp, xpHistory, level, addXp: handleAddXp } = practiceWorkspace.model.gamification;
  const mediaHydration = useCardMediaHydration({
    ownerKey: user?.uid ?? null,
    cards,
    enabled: viewMode === 'library',
    port: {
      hasMedia: card => isSupportedImageUrl(card.imageUrl),
      fetchMedia: async card => {
        try {
          const context = {
            word: (card.normalizedWord || card.word).trim(),
            searchQuery: card.imageSearchQuery,
            category: card.category,
            partOfSpeech: card.partOfSpeech,
            explanation: card.explanation,
          };
          if (!context.word) return null;
          const imageUrl = await fetchImageUrl(context);
          if (!isSupportedImageUrl(imageUrl)) return null;
          const imageSearchQuery = card.imageSearchQuery?.trim() || buildVocabularyImageQuery(context);
          return { imageUrl, ...(imageSearchQuery ? { imageSearchQuery } : {}) };
        } catch (cause) {
          console.warn('The missing card image could not be loaded yet.', cause);
          return null;
        }
      },
      updateCard: async (cardId, fields, options) => {
        const promoted = recentlyPromotedCardsRef.current.get(cardWordKey(options.source));
        if (promoted) {
          recentlyPromotedCardsRef.current.set(cardWordKey(options.source), { ...promoted, ...fields });
        }
        await learningActionsRef.current?.updateCard(cardId, fields, options);
      },
    },
  });
  const learningCommands = useLearningWorkspace({
    owner: { id: user?.uid ?? null,
      verifiedEpoch: user && libraryEpochState?.userId === user.uid ? libraryEpochState.value : null },
    library: {
      knownTotal: knownLibraryTotal,
      findCard: cardId => cardsRef.current.find(card => card.id === cardId),
      isPatchCurrent: (cardId, expectedLifecycle) => !expectedLifecycle
        || mediaHydration.actions.isLifecycleCurrent(cardId, expectedLifecycle),
      publication: {
        patch: (cardId, fields) => setCards(current => {
          const updated = current.map(card => card.id === cardId ? { ...card, ...fields } : card);
          localStorage.setItem('lingoflash_cards', JSON.stringify(
            retainCardsForSession(updated, Boolean(user), cardsPerPage),
          ));
          return updated;
        }),
        remove: cardId => {
          mediaHydration.actions.invalidateCard(cardId);
          setCards(current => current.filter(card => card.id !== cardId));
        },
        clear: () => {
          browserCapabilities.actions.bumpHydrationSession();
          cardsRef.current.forEach(card => mediaHydration.actions.invalidateCard(card.id));
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
      resetCloudState: sessionPorts.actions.resetCloudState,
      resetCloudPage: () => catalogActions.goToPage(1),
      refreshCloud: sessionPorts.actions.refreshCloud,
      cloudAvailabilityChanged: sessionPorts.actions.markCloudUnavailable,
      mutationPendingChanged: setIsLoading,
      reportError: setError,
      addXp: handleAddXp,
    },
  }, appDependencies.sessions.learningWorkspace).actions;
  learningActionsRef.current = learningCommands;
  const deckWorkspace = useCustomDeckWorkspace({
    identityReady: identitySession.status !== 'loading',
    owner: { id: user?.uid ?? null,
      remoteAvailable: Boolean(appDependencies.configuration.cloudAvailable && user) },
    remoteDecks: user && ownerLibrary.ownerId === user.uid ? ownerLibrary.decks : null,
    cards,
    activeDeck: activeCustomDeck,
    knownLibraryTotal,
    mutations: appDependencies.adapters.ownerDecks,
    ports: {
      assignCard: learningCommands.assignDeck,
      patchDeviceCards,
      acknowledgeDevicePending,
      publishCards: (cardIds, fields) => setCards(previous => previous.map(card =>
        cardIds.has(card.id) ? { ...card, ...fields } : card)),
      publishPractice: (cardIds, fields) => practiceSnapshotRef.current.updateCards(cardIds, fields),
      chooseAllDecks: () => catalogActions.chooseDeck('All'),
      recoverCloud: (ownerId, message) => {
        setCloudReadUnavailable(true);
        localStorage.removeItem(cloudPageCacheKey(ownerId));
        localStorage.removeItem(cloudStatsCacheKey(ownerId));
        localStorage.removeItem(cloudFacetsCacheKey(ownerId));
        catalogActions.goToPage(1);
        setCloudRefresh(value => value + 1);
        setError(message);
      },
      reportError: setError,
      warn: (message, cause) => console.warn(message, cause),
      confirmDelete: message => window.confirm(message),
    },
  });
  const { decks: customDecks, newDeckInput } = deckWorkspace.model;

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

  const resetSpreadsheetSource = useCallback(() => {
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);
  const sharingDependencies = useMemo(() => appDependencies.intake.forOwner(user?.uid ?? null), [user?.uid]);
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
      hydrateExisting: card => void mediaHydration.actions.hydrateCard(card, { force: true }),
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
    sharing: sharingDependencies,
    language: ENGLISH_TO_VIETNAMESE_PROFILE,
    resetSpreadsheetSource,
    feedback: { reportError: setError, notify: setNotice },
    externalBusy: isLoading,
  }, appDependencies.sessions.intakeSharing);
  const isLibraryBusy = intakeSharing.model.isBusy;
  const handleMigrateLegacyCards = async () => {
    const result = await librarySession.actions.owner.migrateLegacy();
    if (result.status === 'completed' && result.complete) {
      catalogActions.goToPage(1);
      setCloudRefresh(value => value + 1);
    }
    return result;
  };

  const handleSignIn = async () => { await librarySession.actions.identity.signIn(); };
  const handleSignOut = async () => {
    const result = await librarySession.actions.identity.signOut();
    if (result.status !== 'completed') return;
    localStorage.removeItem('lingoflash_cards');
    localStorage.removeItem(localCardsOwnerKey);
    setCards([]);
  };
  const practiceSession = practiceWorkspace.model.session;
  const {
    startStudy,
    startQuiz,
    startSpelling,
    generateStory: handleGenerateStory,
  } = practiceWorkspace.actions;

  const handleShareCategory = async (category: string) => {
    rememberOpener(shareOpenerRef);
    return intakeSharing.actions.shareCategory(category);
  };
  const deleteCard = useCallback(async (id: string) => {
    try {
      await learningCommands.deleteCard(id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The card could not be deleted. Please try again.');
    }
  }, [learningCommands]);
  const libraryScreen = useLibraryScreenContract({
    workspace: {
      catalog: { model: catalog, actions: catalogActions },
      session: {
        model: librarySession.model,
        actions: {
          ...librarySession.actions,
          owner: { migrateLegacy: handleMigrateLegacyCards },
        },
      },
      intake: {
        model: intakeSharing.model,
        actions: { ...intakeSharing.actions, shareCategory: handleShareCategory },
      },
      learning: { actions: { ...learningCommands, deleteCard } },
    },
    library: {
      cards,
      knownTotal: knownLibraryTotal,
      usesCloudPagination: appDependencies.configuration.cloudAvailable,
      customDecks,
      pageSize: cardsPerPage,
    },
    gamification: { streak, level, xp, xpHistory },
    ui: {
      isOnline: isBrowserOnline,
      isLibraryBusy,
      newDeckInput,
      libraryHeadingRef,
      fileInputRef,
    },
    commands: {
      startStudy,
      openCardCreator: () => {
        const scrollBehavior = getReducedMotionScrollBehavior();
        document.getElementById('library-tools')?.scrollIntoView({ behavior: scrollBehavior, block: 'start' });
        window.setTimeout(() => document.getElementById('new-word')?.focus(), scrollBehavior === 'auto' ? 0 : 350);
      },
      changeNewDeckInput: deckWorkspace.actions.changeNewDeckInput,
      createCustomDeck: deckWorkspace.actions.createDeck,
      deleteCustomDeck: deckWorkspace.actions.deleteDeck,
    },
  });
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
    if (knownLibraryTotal === 0 || (user && cloudReadUnavailable && libraryScreen.overlays.visibleLibraryCount === 0)) return;
    setIsLoading(true);
    try {
      const XLSX = await import('@e965/xlsx');
      const exportCards = await appDependencies.library.loadAllCards(user?.uid ?? null) ?? cards;
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

  return (
    <div ref={appShellRef} className={`app-canvas min-h-dvh h-dvh text-[var(--sf-text)] font-sans flex flex-col overflow-hidden selection:bg-cyan-500/20 transition-colors relative ${isDarkMode ? 'dark' : ''}`}>
      <div className="ambient-orb ambient-orb-a" aria-hidden="true" />
      <div className="ambient-orb ambient-orb-b" aria-hidden="true" />
      <div className="ambient-orb ambient-orb-c" aria-hidden="true" />
      
      <DesktopNavigation
        navigationRef={navigationRef} viewMode={viewMode}
        syncIdentity={isAuthLoading
          ? { status: 'loading' }
          : user
            ? {
                status: 'authenticated',
                displayName: user.displayName,
                email: user.email,
                photoUrl: user.photoURL,
              }
            : { status: 'signed-out', isConfigured: appDependencies.configuration.cloudConfigured, isSigningIn }}
        isDeviceSyncVisible={import.meta.env.DEV} isDeviceSyncing={isDeviceSyncing} isDarkMode={isDarkMode}
        canManageLibrary={libraryScreen.navigation.canUseVisibleLibrary && viewMode === 'library'}
        isLibraryMutationPending={isLoading} libraryCountLabel={libraryScreen.navigation.libraryCountLabel}
        onOpenToday={() => setViewMode('today')} onOpenLibrary={() => setViewMode('library')}
        onOpenCatalog={() => setViewMode('catalog')} onOpenProgress={() => setViewMode('progress')}
        onDeviceSync={handleDeviceSyncNow}
        onSignIn={handleSignIn} onSignOut={handleSignOut} onToggleTheme={toggleTheme}
        onExportLibrary={exportToExcel} onClearLibrary={openClearConfirm}
      />

      <AppFeedback
        authError={authError} error={error} notice={notice}
        onDismissAuthError={librarySession.actions.identity.clearError}
        onDismissError={() => setError(null)}
        onDismissNotice={() => setNotice(null)}
      />
      <main tabIndex={0} aria-label="Learning workspace" className="flex-1 relative w-full max-w-[1560px] mx-auto p-4 sm:px-6 sm:py-6 lg:px-8 pb-24 lg:pb-8 overflow-y-auto z-10 scrollbar-thin">
        {viewMode !== 'catalog' && viewMode !== 'today' && viewMode !== 'progress' && <h1 ref={viewHeadingRef} tabIndex={-1} className="sr-only">{viewHeading}</h1>}
        <div ref={viewStageRef} data-app-view-stage className="min-h-full">
        <AppViewStage
          viewMode={viewMode} ownerId={user?.uid ?? null} isOffline={!isBrowserOnline} isDarkMode={isDarkMode}
          headingRef={viewHeadingRef} stats={libraryScreen.overlays.stats}
          isStatsLoading={librarySession.model.cloud.isStatsLoading} statsError={librarySession.model.cloud.error}
          loadPracticePool={practiceWorkspace.ports.loadPracticePool} reviewCard={practiceLearning.reviewCard}
          openVocabulary={() => setViewMode('library')} openPaths={() => setViewMode('catalog')} continueReview={startStudy}
          openMorePractice={openPractice}
          libraryContent={<LibraryScreen model={libraryScreen.model} actions={libraryScreen.actions} />}
          practiceContent={<PracticeScreen session={practiceSession} actions={practiceWorkspace.actions} customDecks={customDecks} />}
        />
        </div>
      </main>

      <AppFooter
        viewMode={viewMode} libraryCountLabel={libraryScreen.navigation.libraryCountLabel}
        isBrowserOnline={isBrowserOnline} cloudReadUnavailable={cloudReadUnavailable}
      />

      <MobileNavigation
        viewMode={viewMode} onOpenToday={() => setViewMode('today')} onOpenLibrary={() => setViewMode('library')}
        onOpenCatalog={() => setViewMode('catalog')} onOpenProgress={() => setViewMode('progress')}
      />

      {hasMountedOverlays && (
        <Suspense fallback={<span className="sr-only" role="status">Opening dialog</span>}>
          <AppOverlays
            shareLink={intakeSharing.model.share.shareLink}
            setShareLink={value => { if (!value) intakeSharing.actions.dismissShareLink(); }}
            canRevokeShare={Boolean(intakeSharing.model.share.activeShareId)}
            revokeShare={async () => { await intakeSharing.actions.revokeShare(); }}
            isSharing={intakeSharing.model.share.isLoading} isPracticeMenuOpen={isPracticeMenuOpen}
            setIsPracticeMenuOpen={setIsPracticeMenuOpen} startQuiz={startQuiz} startSpelling={startSpelling}
            visibleLibraryCount={libraryScreen.navigation.practiceLibraryCount}
            generateStory={handleGenerateStory} isStatsOpen={isStatsOpen} setIsStatsOpen={setIsStatsOpen}
            statsData={libraryScreen.overlays.stats} isDarkMode={isDarkMode}
            showClearConfirm={showClearConfirm} setShowClearConfirm={setShowClearConfirm}
            clearAll={clearAll} isLoading={isLoading} shareOpenerRef={shareOpenerRef}
            practiceOpenerRef={practiceOpenerRef} statsOpenerRef={statsOpenerRef} clearOpenerRef={clearOpenerRef}
          />
        </Suspense>
      )}
      <Suspense fallback={null}>
        <AppShellMotion
          appShellRef={appShellRef} navigationRef={navigationRef}
          viewMode={viewMode} viewStageRef={viewStageRef}
        />
      </Suspense>
    </div>
  );
}
