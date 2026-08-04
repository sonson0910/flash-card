import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { appDependencies } from '../../app/appDependencies';
import type { CatalogWorkspaceSummary } from '../catalogCache/catalogSummary';
import type { HydratedCatalogEntry } from '../catalogCache/catalogCache';
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
import type { CatalogTierId } from './catalogWorkspaceRegistry';
import { inspectInstalledCatalog, navigateCatalogWorkspaceQuery } from './catalogWorkspaceOrchestration';

const RELEASE_MANIFEST_PATH = '/catalog/english-core/release-manifest.json';

export interface CatalogWorkspaceProps {
  readonly ownerId: string | null;
  readonly headingRef?: RefObject<HTMLHeadingElement | null>;
}

const browserLocation = (): string => globalThis.location?.href ?? '/?view=catalog';
const browserOnline = (): boolean => globalThis.navigator?.onLine ?? true;

const errorDetail = (error: unknown): string => (
  error instanceof Error ? error.message : 'Unknown catalog error.'
);

export default function CatalogWorkspace({ ownerId, headingRef }: CatalogWorkspaceProps) {
  const service = useMemo(() => createCatalogWorkspaceService({
    origin: globalThis.location?.origin ?? 'https://sonflash.invalid',
  }), []);
  const [query, setQuery] = useState<CatalogWorkspaceQuery>(() => readCatalogWorkspaceQuery(browserLocation()));
  const [summary, setSummary] = useState<CatalogWorkspaceSummary | null>(null);
  const [hydrated, setHydrated] = useState<readonly HydratedCatalogEntry[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isOnline, setIsOnline] = useState(browserOnline);
  const [status, setStatus] = useState<CatalogAvailabilityStatus>({
    kind: 'checking', message: 'Checking this device for a reviewed catalog…',
  });
  const mounted = useRef(true);
  const workflowGeneration = useRef(0);

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
      if (!query.catalogId) {
        setSummary(null);
        setStatus({ kind: 'unavailable', isOnline, message: 'This language does not have a reviewed release yet.' });
        return;
      }
      const inspection = await inspectInstalledCatalog({
        service,
        catalogId: query.catalogId,
        loadLearningStates: () => appDependencies.catalog.loadLearningStates(ownerId, 10_000),
        isCurrent: () => mounted.current && workflowGeneration.current === generation,
      });
      if (inspection.status === 'stale' || !mounted.current) return;
      if (inspection.status === 'missing') {
        setSummary(null);
        setHydrated([]);
        setStatus({
          kind: 'unavailable', isOnline,
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
      setStatus({
        kind: 'error', isOnline, message: 'The catalog could not be opened safely.', detail: errorDetail(error),
      });
    }
  }, [isOnline, ownerId, query.catalogId, readyStatus, service]);

  const loadPage = useCallback(async (cursor: string | null, append: boolean) => {
    if (!query.catalogId || !query.trackId || !summary) return;
    if (append) setIsLoadingMore(true);
    try {
      const page = await service.query(catalogCacheQueryFromWorkspaceQuery(query, cursor));
      if (page.status === 'stale' || !mounted.current) return;
      const content = await service.hydrate(query.catalogId, page.value.items);
      if (content.status === 'stale' || !mounted.current) return;
      setHydrated(previous => append ? [...previous, ...content.value] : content.value);
      setNextCursor(page.value.nextCursor);
      setHasMore(page.value.hasMore);
      setStatus(readyStatus(summary.release.releaseId));
    } catch (error) {
      if (!mounted.current) return;
      setStatus({
        kind: 'error', isOnline, message: 'Vocabulary could not be read safely.', detail: errorDetail(error),
      });
    } finally {
      if (mounted.current) setIsLoadingMore(false);
    }
  }, [isOnline, query, readyStatus, service, summary]);

  useEffect(() => {
    mounted.current = true;
    const frame = globalThis.requestAnimationFrame?.(() => headingRef?.current?.focus());
    void inspect();
    return () => {
      mounted.current = false;
      workflowGeneration.current += 1;
      service.invalidate();
      if (frame !== undefined) globalThis.cancelAnimationFrame?.(frame);
    };
  }, [headingRef, inspect, service]);

  useEffect(() => {
    if (summary) void loadPage(null, false);
  }, [loadPage, summary]);

  useEffect(() => {
    const updateOnline = () => setIsOnline(browserOnline());
    const restoreUrl = () => {
      workflowGeneration.current += 1;
      service.invalidate();
      setQuery(readCatalogWorkspaceQuery(browserLocation()));
    };
    globalThis.addEventListener?.('online', updateOnline);
    globalThis.addEventListener?.('offline', updateOnline);
    globalThis.addEventListener?.('popstate', restoreUrl);
    return () => {
      globalThis.removeEventListener?.('online', updateOnline);
      globalThis.removeEventListener?.('offline', updateOnline);
      globalThis.removeEventListener?.('popstate', restoreUrl);
    };
  }, [service]);

  const updateQuery = useCallback((patch: CatalogWorkspaceQueryPatch, replace = false) => {
    workflowGeneration.current += 1;
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

  const download = useCallback(async () => {
    if (!isOnline || !query.catalogId) return;
    setStatus({ kind: 'downloading', progressPercent: 10, message: 'Downloading and verifying the reviewed catalog…' });
    try {
      const result = await service.download(RELEASE_MANIFEST_PATH, progress => {
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
      setStatus({
        kind: 'error', isOnline, message: 'The reviewed catalog was not installed. Any earlier release is unchanged.',
        detail: errorDetail(error),
      });
    }
  }, [inspect, isOnline, query.catalogId, service]);

  const tracks = summary ? catalogTracksFromSummary(summary) : [];
  const selectedTrack = (query.trackId === 'toeic' || query.trackId === 'general') ? query.trackId : 'ielts';
  const selectedTier: CatalogTierId = query.tier ?? 'foundation';
  const filters = summary
    ? catalogFiltersFromSummary(summary, selectedTrack, query)
    : catalogFiltersFromSummary({
      release: {
        catalogId: query.catalogId ?? 'unavailable', releaseId: 'unavailable', schemaVersion: 1,
        contentLanguage: query.languageCode, chunkCount: 1, membershipCount: 1, encodedBytes: 1,
      }, scannedMemberships: 0, tracks: [],
    }, selectedTrack, query);
  const cards = hydrated.map(presentHydratedCatalogEntry);
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
    resultSummary: cards.length === 0
      ? 'No words match all selected filters.'
      : `Showing ${cards.length}${hasMore ? ' or more' : ''} ${selectedTrack.toUpperCase()} ${selectedTier} word${cards.length === 1 ? '' : 's'}.`,
    hasMore,
    isLoadingMore,
  };
  const actions: CatalogScreenActions = {
    selectLanguage: languageCode => updateQuery({ languageCode }),
    selectTrack: trackId => updateQuery({ trackId, tier: 'foundation' }),
    selectTier: tier => updateQuery({ tier }),
    changeTerm: term => updateQuery({ term }, true),
    changeCefr: cefrLevel => updateQuery({ cefrLevel: cefrLevel || null }),
    changeTopic: topic => updateQuery({ topic: topic || null }),
    changePartOfSpeech: partOfSpeech => updateQuery({ partOfSpeech: partOfSpeech || null }),
    changeSkill: skill => updateQuery({ skill: skill || null }),
    resetFilters: () => updateQuery({ term: '', cefrLevel: null, topic: null, partOfSpeech: null, skill: null }),
    download: () => { void download(); },
    retry: () => { void inspect(); },
    loadMore: () => { if (nextCursor && !isLoadingMore) void loadPage(nextCursor, true); },
  };

  return <CatalogScreen model={model} actions={actions} />;
}
