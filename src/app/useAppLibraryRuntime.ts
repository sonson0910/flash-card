import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CLOUD_PAGE_SIZE, queryStateKey, type CardQueryState } from '../lib/cardQuery';
import type { CardData } from '../types/card';
import { dateLabelToQueryDate } from '../features/library/libraryPresentation';
import { cloudFacetsCacheKey, writeLocalValue } from '../features/library/libraryStorage';
import { useBrowserCapabilities } from '../features/browser/useBrowserCapabilities';
import { useLibraryCatalogQuery } from '../features/catalog/useLibraryCatalogQuery';
import { useLibraryExport } from '../features/importExport/useLibraryExport';
import { useLibraryCloudProjection } from '../features/librarySession/useLibraryCloudProjection';
import { useLibrarySession } from '../features/librarySession/useLibrarySession';
import {
  useLibrarySessionPorts,
  type LibrarySessionPortStats,
} from '../features/librarySession/useLibrarySessionPorts';
import type { AppViewMode } from '../features/navigation/useAppNavigation';
import { appDependencies } from './appDependencies';

interface PracticePublication {
  findCard(cardId: string): CardData | undefined;
  updateCard(cardId: string, update: Partial<CardData> | ((card: CardData) => CardData)): void;
  removeCard(cardId: string): void;
}

const EMPTY_PRACTICE_PUBLICATION: PracticePublication = {
  findCard: () => undefined,
  updateCard: () => undefined,
  removeCard: () => undefined,
};

const EMPTY_CLOUD_STATS: LibrarySessionPortStats = {
  total: 0,
  reviewed: 0,
  easy: 0,
  good: 0,
  hard: 0,
  unrated: 0,
  bookmarked: 0,
  due: 0,
  legacyUnindexed: 0,
};

interface UseAppLibraryRuntimeOptions {
  viewMode: AppViewMode;
  isStatsOpen: boolean;
  reportError(message: string | null): void;
  notify(message: string | null): void;
}

export function useAppLibraryRuntime({
  viewMode,
  isStatsOpen,
  reportError,
  notify,
}: UseAppLibraryRuntimeOptions) {
  const { model: catalog, actions: catalogActions } = useLibraryCatalogQuery();
  const [cards, setCards] = useState<CardData[]>([]);
  const [isLibraryMutationPending, setIsLibraryMutationPending] = useState(false);
  const [cloudTotal, setCloudTotal] = useState(0);
  const [cloudStats, setCloudStats] = useState(EMPTY_CLOUD_STATS);
  const [, setCloudCategoryCounts] = useState<Record<string, number>>({});
  const [, setCloudFacetsComplete] = useState(false);
  const [, setHasNextCloudPage] = useState(false);
  const [isPageLoading, setIsPageLoading] = useState(false);
  const [cloudReadUnavailable, setCloudReadUnavailable] = useState(false);
  const [cloudRefresh, setCloudRefresh] = useState(0);
  const [browserOwnerKey, setBrowserOwnerKey] = useState<string | null>(null);
  const cardsRef = useRef(cards);
  const activeOwnerIdRef = useRef<string | null>(null);
  const recentlyPromotedCardsRef = useRef(new Map<string, CardData>());
  const practicePublicationRef = useRef<PracticePublication>(EMPTY_PRACTICE_PUBLICATION);
  const cardsPerPage = CLOUD_PAGE_SIZE;
  const exportMinimum = browserOwnerKey
    ? Math.max(cloudTotal, cloudStats.total, cards.length)
    : cards.length;
  const { exportLibrary, isExporting } = useLibraryExport({
    ownerId: browserOwnerKey,
    cards,
    minimumExpectedCards: exportMinimum,
    loadAllCards: appDependencies.library.loadAllCards,
    reportError,
    notify,
  });
  const externalLibraryBusy = isLibraryMutationPending || isExporting;
  const browserCapabilities = useBrowserCapabilities({
    ownerKey: browserOwnerKey,
    page: catalog.page,
    pageLoading: isPageLoading,
    view: viewMode,
    libraryBusy: externalLibraryBusy,
  });
  const cloudQueryState = useMemo<CardQueryState>(() => ({
    category: catalog.category === 'All' ? null : catalog.category,
    customDeck: catalog.deck === 'All' ? null : catalog.deck === 'Unassigned' ? 'unassigned' : catalog.deck,
    difficulty: catalog.difficulty === 'All' ? null : catalog.difficulty as CardQueryState['difficulty'],
    partOfSpeech: catalog.partOfSpeech === 'All' ? null : catalog.partOfSpeech,
    bookmarkedOnly: catalog.starred,
    createdDate: dateLabelToQueryDate(catalog.date),
    wordPrefix: catalog.debouncedSearch,
  }), [
    catalog.category,
    catalog.date,
    catalog.deck,
    catalog.debouncedSearch,
    catalog.difficulty,
    catalog.partOfSpeech,
    catalog.starred,
  ]);
  const cloudQueryKey = useMemo(() => queryStateKey(cloudQueryState), [cloudQueryState]);
  const sessionPorts = useLibrarySessionPorts({
    ownerAdapter: appDependencies.adapters.ownerLibrary,
    publications: {
      library: {
        replace: setCards,
        advance: (cardId, advance) => setCards(previous => previous.map(card => card.id === cardId ? advance(card) : card)),
        remove: cardId => setCards(previous => previous.filter(card => card.id !== cardId)),
      },
      practice: {
        find: cardId => practicePublicationRef.current.findCard(cardId),
        advance: (cardId, advance) => practicePublicationRef.current.updateCard(cardId, advance),
        remove: cardId => practicePublicationRef.current.removeCard(cardId),
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
      feedback: { error: reportError, notice: notify },
      promotedCards: () => [...recentlyPromotedCardsRef.current.values()],
    },
  });
  const librarySession = useLibrarySession({
    catalog: {
      query: cloudQueryState,
      queryKey: cloudQueryKey,
      page: catalog.page,
      pageSize: cardsPerPage,
      refreshKey: cloudRefresh,
      statsOpen: isStatsOpen || viewMode === 'progress',
    },
    library: {
      cards,
      knownTotal: Math.max(cloudTotal, cloudStats.total, cards.length),
      cloudTotal,
      cloudStatsTotal: cloudStats.total,
      browserOnline: browserCapabilities.model.isOnline,
      cloudUnavailable: cloudReadUnavailable,
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
  const libraryEpochState = identitySession.ownerEpoch
    ? { userId: identitySession.ownerEpoch.ownerId, value: identitySession.ownerEpoch.value }
    : null;
  const knownLibraryTotal = user ? Math.max(cloudTotal, cloudStats.total, cards.length) : cards.length;
  const shellSyncStatus = {
    isOnline: browserCapabilities.model.isOnline,
    isSyncing: librarySession.model.sync.isSyncing,
    pendingCount: librarySession.model.sync.pendingCount,
    error: user && libraryEpochState?.userId !== user.uid
      ? librarySession.model.sync.error ?? identitySession.error ?? 'Cloud generation could not be verified; changes remain safe on this device.'
      : librarySession.model.sync.error,
    cloudUnavailable: cloudReadUnavailable,
  };
  cardsRef.current = cards;
  const cloudProjectionPublication = useMemo(() => ({
    presentCards: setCards,
    presentCloud: (value: { total: number; hasNext: boolean; isLoading: boolean; unavailable: boolean;
      stats: LibrarySessionPortStats; facets: Record<string, number>; facetsComplete: boolean }) => {
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
    reportError,
    notify,
  }), [catalogActions, notify, reportError]);
  useLibraryCloudProjection({
    session: librarySession.model,
    cards,
    page: catalog.page,
    publication: cloudProjectionPublication,
  });

  useEffect(() => {
    setBrowserOwnerKey(user?.uid ?? null);
    recentlyPromotedCardsRef.current.clear();
  }, [user?.uid]);

  const updateCategoryFacets = useCallback(async (deltas: Record<string, number>) => {
    if (!user) return;
    const ownerId = user.uid;
    const facets = await appDependencies.library.updateCategoryFacets(ownerId, deltas);
    if (!facets || activeOwnerIdRef.current !== ownerId) return;
    setCloudCategoryCounts(facets.categories);
    setCloudFacetsComplete(facets.complete);
    writeLocalValue(cloudFacetsCacheKey(ownerId), JSON.stringify(facets));
  }, [user]);
  const migrateLegacyCards = async () => {
    const result = await librarySession.actions.owner.migrateLegacy();
    if (result.status === 'completed' && result.complete) {
      catalogActions.goToPage(1);
      setCloudRefresh(value => value + 1);
    }
    return result;
  };
  const signOut = async () => {
    const result = await librarySession.actions.identity.signOut();
    if (result.status !== 'completed') return;
    librarySession.actions.owner.discardCards();
    setCards([]);
  };

  return {
    model: {
      catalog,
      cards,
      user,
      cloudStats,
      knownLibraryTotal,
      libraryEpochState,
      ownerLibrary: librarySession.model.owner,
      librarySession: librarySession.model,
      shellSyncStatus,
      isBrowserOnline: browserCapabilities.model.isOnline,
      isExporting,
      externalLibraryBusy,
      cardsPerPage,
    },
    actions: {
      catalog: catalogActions,
      exportLibrary,
      syncNow: librarySession.actions.sync.syncNow,
      signIn: librarySession.actions.identity.signIn,
      signOut,
      migrateLegacyCards,
      clearAuthError: librarySession.actions.identity.clearError,
      retrySync: librarySession.actions.sync.retry,
    },
    ports: {
      setCards,
      cardsRef,
      activeOwnerIdRef,
      recentlyPromotedCardsRef,
      practicePublicationRef,
      setCloudStats,
      setCloudTotal,
      setCloudReadUnavailable,
      refreshCloud: () => setCloudRefresh(value => value + 1),
      setLibraryMutationPending: setIsLibraryMutationPending,
      updateCategoryFacets,
      browser: browserCapabilities,
      session: librarySession,
      sessionPorts: sessionPorts.actions,
    },
  };
}

export type AppLibraryRuntime = ReturnType<typeof useAppLibraryRuntime>;
