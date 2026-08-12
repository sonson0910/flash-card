import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { appDependencies } from '../../app/appDependencies';
import type { CardData } from '../../types/card';
import type { CatalogWorkspaceSummary } from '../catalogCache/catalogSummary';
import { CatalogCacheOpenError, type HydratedCatalogEntry } from '../catalogCache/catalogCache';
import type { IntakeSharingSessionActions } from '../intake/useIntakeSharingSession';
import { CatalogScreen } from './CatalogScreen';
import type { CatalogAvailabilityStatus, CatalogScreenActions, CatalogScreenModel } from './catalogPresentation';
import {
  catalogCacheQueryFromWorkspaceQuery,
  catalogFiltersFromSummary,
  catalogLanguagesPresentation,
  catalogTiersFromSummary,
  catalogTracksFromSummary,
  presentHydratedCatalogEntry,
} from './catalogWorkspacePresenter';
import {
  readCatalogWorkspaceQuery,
  type CatalogWorkspaceQuery,
  type CatalogWorkspaceQueryPatch,
} from './catalogWorkspaceQuery';
import { createCatalogWorkspaceService } from './catalogWorkspaceService';
import { catalogReleaseManifestPath, type CatalogTierId } from './catalogWorkspaceRegistry';
import {
  inspectInstalledCatalog,
  navigateCatalogWorkspaceQuery,
  synchronizeCatalogHistoryInspection,
} from './catalogWorkspaceOrchestration';
import {
  beginCatalogLibraryAdd,
  createCatalogOptimisticLibraryState,
  scopeCatalogOptimisticLibraryState,
  settleCatalogLibraryAdd,
} from './catalogLearningFlow';
import { createCatalogPagingGuard } from './catalogPagingGuard';
import { createCatalogSearchDebouncer } from './catalogSearchDebouncer';
import { useCatalogLibraryActions } from './useCatalogLibraryActions';
import {
  createPersonalLibraryPathPresentation,
  type PersonalLibraryPathInput,
} from './personalLibraryPaths';

export interface CatalogWorkspaceProps {
  readonly ownerId: string | null;
  readonly headingRef?: RefObject<HTMLHeadingElement | null>;
  readonly focusIntent?: number;
  readonly cards?: readonly CardData[];
  readonly adoptCards?: IntakeSharingSessionActions['adoptCards'];
  readonly notify?: (message: string) => void;
  readonly libraryStats?: PersonalLibraryPathInput;
  readonly openVocabulary?: () => void;
  readonly continueReview?: () => void | Promise<void>;
}

const browserLocation = (): string => globalThis.location?.href ?? '/?view=catalog';
const browserOnline = (): boolean => globalThis.navigator?.onLine ?? true;

const errorDetail = (error: unknown): string => (
  error instanceof Error ? error.message : 'Unknown catalog error.'
);

const catalogErrorStatus = (
  error: unknown,
  isOnline: boolean,
  fallbackMessage: string,
): CatalogAvailabilityStatus => error instanceof CatalogCacheOpenError
  ? { kind: 'error', isOnline, message: error.message }
  : { kind: 'error', isOnline, message: fallbackMessage, detail: errorDetail(error) };

export default function CatalogWorkspace({
  ownerId,
  headingRef,
  focusIntent = 0,
  cards: libraryCards = [],
  adoptCards,
  notify = () => undefined,
  libraryStats,
  openVocabulary = () => undefined,
  continueReview = () => undefined,
}: CatalogWorkspaceProps) {
  const libraryActions = useCatalogLibraryActions({ cards: libraryCards, adoptCards, notify });
  const service = useMemo(() => createCatalogWorkspaceService({
    origin: globalThis.location?.origin ?? 'https://sonflash.invalid',
  }), []);
  const [query, setQuery] = useState<CatalogWorkspaceQuery>(() => readCatalogWorkspaceQuery(browserLocation()));
  const [termDraft, setTermDraft] = useState(query.term);
  const [summary, setSummary] = useState<CatalogWorkspaceSummary | null>(null);
  const [hydrated, setHydrated] = useState<readonly HydratedCatalogEntry[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [isLoadingPage, setIsLoadingPage] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const ownerScope = useRef({ ownerId, version: 0 });
  if (ownerScope.current.ownerId !== ownerId) {
    ownerScope.current = { ownerId, version: ownerScope.current.version + 1 };
  }
  const ownerVersion = ownerScope.current.version;
  const [optimisticLibrary, setOptimisticLibrary] = useState(() => (
    createCatalogOptimisticLibraryState(ownerId, ownerVersion)
  ));
  const [isOnline, setIsOnline] = useState(browserOnline);
  const [status, setStatus] = useState<CatalogAvailabilityStatus>({
    kind: 'checking', message: 'Checking this device for a reviewed catalog…',
  });
  const mounted = useRef(true);
  const workflowGeneration = useRef(0);
  const pagingGuard = useRef<ReturnType<typeof createCatalogPagingGuard> | null>(null);
  if (!pagingGuard.current) pagingGuard.current = createCatalogPagingGuard();
  const personalLibrary = useMemo(() => createPersonalLibraryPathPresentation(
    libraryStats ?? {
      total: libraryCards.length,
      dueToday: 0,
      learning: libraryCards.length,
      learned: 0,
    },
  ), [libraryCards.length, libraryStats]);

  const readyStatus = useCallback((releaseId: string): CatalogAvailabilityStatus => ({
    kind: 'ready',
    isOnline,
    isAvailableOffline: true,
    message: `Reviewed catalog ${releaseId} is ready on this device.`,
  }), [isOnline]);

  const inspect = useCallback(async () => {
    const generation = ++workflowGeneration.current;
    setStatus({ kind: 'checking', message: 'Checking this device for a reviewed catalog…' });
    try {
      if (!query.catalogId || !query.releaseId) {
        setSummary(null);
        setHydrated([]);
        setIsLoadingPage(false);
        setStatus(query.languageCode === 'en'
          ? {
              kind: 'personal',
              message: personalLibrary.total > 0
                ? `Your path is built from ${personalLibrary.total.toLocaleString('en-US')} cards already in your library.`
                : 'Add your first vocabulary cards to start a personal path.',
            }
          : {
              kind: 'unavailable',
              isOnline,
              canDownload: false,
              message: 'This language does not have a reviewed release yet.',
            });
        return;
      }
      const inspection = await inspectInstalledCatalog({
        service,
        catalogId: query.catalogId,
        releaseId: query.releaseId,
        loadLearningStates: () => appDependencies.catalog.loadLearningStates(ownerId, 10_000),
        isCurrent: () => mounted.current && workflowGeneration.current === generation,
      });
      if (inspection.status === 'stale' || !mounted.current) return;
      if (inspection.status === 'missing') {
        setSummary(null);
        setHydrated([]);
        setIsLoadingPage(false);
        setStatus({
          kind: 'unavailable', isOnline, canDownload: true,
          message: isOnline
            ? 'No reviewed catalog release is installed. You can check the same-origin release channel.'
            : 'No reviewed catalog is stored on this device. Connect once to download it.',
        });
        return;
      }
      const nextSummary = inspection.summary;
      setSummary(nextSummary);
      setStatus(readyStatus(nextSummary.release.releaseId));
    } catch (error) {
      if (!mounted.current) return;
      setIsLoadingPage(false);
      setStatus(catalogErrorStatus(error, isOnline, 'The catalog could not be opened safely.'));
    }
  }, [isOnline, ownerId, personalLibrary, query.catalogId, query.languageCode, query.releaseId, readyStatus, service]);

  const loadPage = useCallback(async (cursor: string | null, append: boolean) => {
    if (!query.catalogId || !query.trackId || !summary) return;
    const pageToken = pagingGuard.current!.capture();
    if (append) setIsLoadingMore(true);
    else setIsLoadingPage(true);
    try {
      const page = await service.readPage(catalogCacheQueryFromWorkspaceQuery(query, cursor));
      if (
        page.status === 'stale'
        || !mounted.current
        || !pagingGuard.current!.isCurrent(pageToken)
      ) return;
      setHydrated(previous => append ? [...previous, ...page.value.items] : page.value.items);
      setNextCursor(page.value.nextCursor);
      setHasMore(page.value.hasMore);
      setStatus(readyStatus(summary.release.releaseId));
    } catch (error) {
      if (!mounted.current || !pagingGuard.current!.isCurrent(pageToken)) return;
      setStatus(catalogErrorStatus(error, isOnline, 'Vocabulary could not be read safely.'));
    } finally {
      if (mounted.current && pagingGuard.current!.isCurrent(pageToken)) {
        if (append) setIsLoadingMore(false);
        else setIsLoadingPage(false);
      }
    }
  }, [isOnline, query, readyStatus, service, summary]);

  const updateQuery = useCallback((patch: CatalogWorkspaceQueryPatch, replace = false) => {
    workflowGeneration.current += 1;
    pagingGuard.current!.invalidate();
    setIsLoadingPage(true);
    setNextCursor(null);
    setHasMore(false);
    setIsLoadingMore(false);
    setQuery(current => navigateCatalogWorkspaceQuery({
      service,
      current,
      patch,
      currentLocation: browserLocation(),
      navigate: nextLocation => {
        if (replace) globalThis.history?.replaceState(globalThis.history.state, '', nextLocation);
        else globalThis.history?.pushState(globalThis.history.state, '', nextLocation);
      },
    }));
  }, [service]);
  const searchDebouncer = useMemo(() => createCatalogSearchDebouncer(
    term => updateQuery({ term }, true),
  ), [updateQuery]);

  useLayoutEffect(() => {
    if (focusIntent > 0) headingRef?.current?.focus({ preventScroll: true });
  }, [focusIntent, headingRef]);

  useEffect(() => {
    mounted.current = true;
    void inspect();
    return () => {
      mounted.current = false;
      workflowGeneration.current += 1;
      service.invalidate();
    };
  }, [inspect, service]);

  useEffect(() => {
    if (summary) void loadPage(null, false);
  }, [loadPage, summary]);

  useEffect(() => () => searchDebouncer.dispose(), [searchDebouncer]);

  useEffect(() => {
    const updateOnline = () => setIsOnline(browserOnline());
    const restoreUrl = () => {
      const restored = readCatalogWorkspaceQuery(browserLocation());
      if (synchronizeCatalogHistoryInspection({ service, current: query, restored })) {
        workflowGeneration.current += 1;
      }
      pagingGuard.current!.invalidate();
      searchDebouncer.cancel();
      setIsLoadingPage(true);
      setNextCursor(null);
      setHasMore(false);
      setIsLoadingMore(false);
      setTermDraft(restored.term);
      setQuery(restored);
    };
    globalThis.addEventListener?.('online', updateOnline);
    globalThis.addEventListener?.('offline', updateOnline);
    globalThis.addEventListener?.('popstate', restoreUrl);
    return () => {
      globalThis.removeEventListener?.('online', updateOnline);
      globalThis.removeEventListener?.('offline', updateOnline);
      globalThis.removeEventListener?.('popstate', restoreUrl);
    };
  }, [query.catalogId, query.releaseId, searchDebouncer, service]);

  const download = useCallback(async () => {
    const manifestPath = catalogReleaseManifestPath({
      catalogId: query.catalogId,
      releaseId: query.releaseId,
      availability: query.catalogId && query.releaseId ? 'available' : 'unavailable',
    });
    if (!isOnline || !query.catalogId || !query.releaseId || !manifestPath) return;
    setStatus({ kind: 'downloading', progressPercent: 10, message: 'Downloading and verifying the reviewed catalog…' });
    try {
      const result = await service.download(manifestPath, {
        catalogId: query.catalogId,
        releaseId: query.releaseId,
      }, progress => {
        if (mounted.current) setStatus({
          kind: 'downloading',
          progressPercent: progress.progressPercent,
          message: progress.phase === 'complete'
            ? 'Verified catalog installed.'
            : 'Downloading and verifying the reviewed catalog…',
        });
      });
      if (result.status === 'stale' || !mounted.current) return;
      await inspect();
    } catch (error) {
      if (!mounted.current) return;
      setStatus(catalogErrorStatus(
        error,
        isOnline,
        'The reviewed catalog was not installed. Any earlier release is unchanged.',
      ));
    }
  }, [inspect, isOnline, query.catalogId, query.releaseId, service]);

  const tracks = summary ? catalogTracksFromSummary(summary) : [];
  const selectedTrack = (query.trackId === 'toeic' || query.trackId === 'general') ? query.trackId : 'ielts';
  const selectedTier: CatalogTierId = query.tier ?? 'foundation';
  const queryFilters = summary
    ? catalogFiltersFromSummary(summary, selectedTrack, query)
    : catalogFiltersFromSummary({
      release: {
        catalogId: query.catalogId ?? 'unavailable', releaseId: 'unavailable', schemaVersion: 1,
        contentLanguage: query.languageCode, chunkCount: 1, membershipCount: 1, encodedBytes: 1,
      }, scannedMemberships: 0, tracks: [],
    }, selectedTrack, query);
  const filters = {
    ...queryFilters,
    term: termDraft,
    hasActiveFilters: Boolean(
      termDraft.trim()
      || queryFilters.cefr
      || queryFilters.topic
      || queryFilters.partOfSpeech
      || queryFilters.skill
    ),
  };
  const scopedOptimisticLibrary = scopeCatalogOptimisticLibraryState(
    optimisticLibrary,
    ownerId,
    ownerVersion,
  );
  const cards = hydrated.map(entry => {
    const card = presentHydratedCatalogEntry(entry);
    return {
      ...card,
      libraryState: scopedOptimisticLibrary.addingCardIds.has(card.id)
        ? 'adding' as const
        : scopedOptimisticLibrary.addedCardIds.has(card.id) || libraryActions.isInLibrary(card)
          ? 'added' as const
          : scopedOptimisticLibrary.failedCardIds.has(card.id)
            ? 'failed' as const
            : 'available' as const,
    };
  });
  const model: CatalogScreenModel = {
    headingRef,
    status,
    selectedLanguage: query.languageCode,
    languages: catalogLanguagesPresentation(),
    selectedTrack,
    tracks,
    selectedTier,
    tiers: summary ? catalogTiersFromSummary(summary, selectedTrack) : [],
    filters,
    cards,
    resultSummary: isLoadingPage
      ? 'Updating vocabulary…'
      : cards.length === 0
      ? 'No words match all selected filters.'
      : `Showing ${cards.length}${hasMore ? ' or more' : ''} ${selectedTrack.toUpperCase()} ${selectedTier} word${cards.length === 1 ? '' : 's'}.`,
    hasMore,
    isLoadingPage,
    isLoadingMore,
    ...(status.kind === 'personal' ? { personalLibrary } : {}),
  };
  const actions: CatalogScreenActions = {
    selectLanguage: languageCode => updateQuery({ languageCode }),
    selectTrack: trackId => updateQuery({ trackId, tier: 'foundation' }),
    selectTier: tier => updateQuery({ tier }),
    changeTerm: term => {
      setTermDraft(term);
      searchDebouncer.schedule(term);
    },
    changeCefr: cefrLevel => updateQuery({ cefrLevel: cefrLevel || null }),
    changeTopic: topic => updateQuery({ topic: topic || null }),
    changePartOfSpeech: partOfSpeech => updateQuery({ partOfSpeech: partOfSpeech || null }),
    changeSkill: skill => updateQuery({ skill: skill || null }),
    resetFilters: () => {
      searchDebouncer.cancel();
      setTermDraft('');
      updateQuery({ term: '', cefrLevel: null, topic: null, partOfSpeech: null, skill: null });
    },
    download: () => { void download(); },
    retry: () => { void inspect(); },
    loadMore: () => { if (nextCursor && !isLoadingMore) void loadPage(nextCursor, true); },
    addToLibrary: cardId => {
      const card = cards.find(candidate => candidate.id === cardId);
      if (!card || card.libraryState !== 'available') return;
      const pending = beginCatalogLibraryAdd(scopedOptimisticLibrary, ownerId, ownerVersion, cardId);
      setOptimisticLibrary(pending.state);
      void libraryActions.addToLibrary(card)
        .then(result => {
          setOptimisticLibrary(current => settleCatalogLibraryAdd(
            current,
            ownerScope.current.ownerId,
            ownerScope.current.version,
            pending.token,
            result,
          ));
        })
        .catch(() => {
          setOptimisticLibrary(current => settleCatalogLibraryAdd(
            current,
            ownerScope.current.ownerId,
            ownerScope.current.version,
            pending.token,
            'failed',
          ));
        });
    },
    openVocabulary,
    continueReview: () => { void continueReview(); },
  };

  return <CatalogScreen model={model} actions={actions} />;
}
