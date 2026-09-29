import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { i18n } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import { useUiLocale } from '../../i18n/I18nProvider';
import type { CardData } from '../../types/card';
import type { CloudLibraryStats } from '../librarySession/cloudLibraryPageController';
import { readDailyPaceForEta } from '../settings/dailyPacePreference';
import type { CatalogLearningStatus, CatalogWorkspaceSummary } from '../catalogCache/catalogSummary';
import { CatalogCacheOpenError, type HydratedCatalogEntry } from '../catalogCache/catalogCache';
import type { IntakeSharingSessionActions } from '../intake/useIntakeSharingSession';
import { CatalogScreen } from './CatalogScreen';
import {
  catalogTierMessages,
  catalogTrackMessages,
  type CatalogAvailabilityStatus,
  type CatalogScreenActions,
  type CatalogScreenModel,
} from './catalogPresentation';
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
import { projectCatalogPathUnits, readCatalogProgressProjection, type CatalogPathUnitProgress } from './catalogProgressProjectionService';
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
  catalogEntryToLibraryCard,
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
  readonly targetLanguage: string;
  readonly headingRef?: RefObject<HTMLHeadingElement | null>;
  readonly focusIntent?: number;
  readonly cards?: readonly CardData[];
  readonly adoptCards?: IntakeSharingSessionActions['adoptCards'];
  readonly notify?: (message: string) => void;
  readonly libraryStats?: PersonalLibraryPathInput;
  readonly cloudStats?: CloudLibraryStats;
  readonly cloudStatsTargetLanguage?: string | null;
  readonly openVocabulary?: () => void;
  readonly continueReview?: () => void | Promise<void>;
  readonly continueCatalogUnit?: (cards: readonly CardData[], isCurrent: () => boolean) => Promise<'started' | 'stale' | 'partial' | 'unavailable'>;
  readonly database?: Parameters<typeof readCatalogProgressProjection>[0] | null;
  readonly verifiedLibraryEpoch?: number | null;
}

interface CatalogProgressQueryInput {
  readonly ownerId: string;
  readonly catalogId: string;
  readonly releaseId: string;
  readonly targetLanguage: string;
  readonly libraryEpoch: number;
}

export function createCatalogProgressQueryCache() {
  const pending = new Map<string, Promise<ReadonlyMap<string, CatalogLearningStatus>>>();
  return {
    read(
      input: CatalogProgressQueryInput,
      load: (input: CatalogProgressQueryInput) => Promise<ReadonlyMap<string, CatalogLearningStatus>>,
    ): Promise<ReadonlyMap<string, CatalogLearningStatus>> {
      const key = [input.ownerId, input.catalogId, input.releaseId, input.targetLanguage, input.libraryEpoch].join('\u0000');
      const existing = pending.get(key);
      if (existing) return existing;
      const result = load(input);
      pending.set(key, result);
      return result;
    },
    clear(): void {
      pending.clear();
    },
  };
}

const browserLocation = (): string => globalThis.location?.href ?? '/?view=catalog';
const browserOnline = (): boolean => globalThis.navigator?.onLine ?? true;
const pathUnitKey = (unit: CatalogPathUnitProgress['unit']): string => `${unit.trackId}\u0000${unit.unitId}`;

const copy = {
  checking: msg({ id: 'catalog.workspace.checking', message: 'Checking this device for a reviewed catalog…' }),
  ready: msg({ id: 'catalog.workspace.ready', message: 'Reviewed catalog {releaseId} is ready on this device.' }),
  personalWithCards: msg({ id: 'catalog.workspace.personal-with-cards', message: 'Your path is built from {count, number} cards already in your library.' }),
  personalEmpty: msg({ id: 'catalog.workspace.personal-empty', message: 'Add your first vocabulary cards to start a personal path.' }),
  personalUnavailable: msg({ id: 'catalog.workspace.personal-unavailable', message: 'Your library summary is unavailable for this course. Open vocabulary to see your cards.' }),
  languageUnavailable: msg({ id: 'catalog.workspace.language-unavailable', message: 'This language does not have a reviewed release yet.' }),
  releaseMissingOnline: msg({ id: 'catalog.workspace.release-missing-online', message: 'No reviewed catalog release is installed. You can check the same-origin release channel.' }),
  releaseMissingOffline: msg({ id: 'catalog.workspace.release-missing-offline', message: 'No reviewed catalog is stored on this device. Connect once to download it.' }),
  catalogOpenError: msg({ id: 'catalog.workspace.open-error', message: 'The catalog could not be opened safely.' }),
  vocabularyReadError: msg({ id: 'catalog.workspace.read-error', message: 'Vocabulary could not be read safely.' }),
  downloading: msg({ id: 'catalog.workspace.downloading', message: 'Downloading and verifying the reviewed catalog…' }),
  installed: msg({ id: 'catalog.workspace.installed', message: 'Verified catalog installed.' }),
  installError: msg({ id: 'catalog.workspace.install-error', message: 'The reviewed catalog was not installed. Any earlier release is unchanged.' }),
  storageBlocked: msg({ id: 'catalog.workspace.storage-blocked', message: 'Catalog storage is blocked by another SonFlash tab. Close older SonFlash tabs, then try again.' }),
  storageTimeout: msg({ id: 'catalog.workspace.storage-timeout', message: 'Catalog storage did not respond in time. Close older SonFlash tabs, then try again.' }),
  updating: msg({ id: 'catalog.workspace.updating', message: 'Updating vocabulary…' }),
  emptyResults: msg({ id: 'catalog.workspace.empty-results', message: 'No words match all selected filters.' }),
  unitUnavailable: msg({ id: 'paths.unit.continue-scope-unavailable', message: 'This unit is unavailable. Reopen Paths and try again.' }),
  unitPartial: msg({ id: 'paths.unit.continue-partial', message: 'Some words could not be confirmed. Try again to continue this unit.' }),
  unitReadError: msg({ id: 'paths.unit.continue-read-error', message: 'This unit could not be prepared. Check your connection and try again.' }),
  resultSummary: msg({ id: 'catalog.workspace.result-summary', message: 'Showing {count, number}{more} {track} {tier} {count, plural, one {word} other {words}}.' }),
};

type WorkspaceStatus = CatalogAvailabilityStatus & {
  messageKey?: keyof typeof copy;
  messageValues?: Record<string, string | number>;
};

const errorDetail = (error: unknown): string => (
  error instanceof Error ? error.message : i18n._(msg({ id: 'catalog.workspace.unknown-error', message: 'Unknown catalog error.' }))
);

export const catalogErrorStatus = (
  error: unknown,
  isOnline: boolean,
  fallbackKey: 'catalogOpenError' | 'vocabularyReadError' | 'installError',
): WorkspaceStatus => error instanceof CatalogCacheOpenError
  ? {
      kind: 'error', isOnline,
      message: i18n._(error.reason === 'blocked' ? copy.storageBlocked : copy.storageTimeout),
      messageKey: error.reason === 'blocked' ? 'storageBlocked' : 'storageTimeout',
    }
  : { kind: 'error', isOnline, message: i18n._(copy[fallbackKey]), messageKey: fallbackKey, detail: errorDetail(error) };

export default function CatalogWorkspace({
  ownerId,
  targetLanguage,
  database = null,
  verifiedLibraryEpoch = null,
  headingRef,
  focusIntent = 0,
  cards: libraryCards = [],
  adoptCards,
  notify = () => undefined,
  libraryStats,
  cloudStats,
  cloudStatsTargetLanguage,
  openVocabulary = () => undefined,
  continueReview = () => undefined,
  continueCatalogUnit,
}: CatalogWorkspaceProps) {
  const uiLocale = useUiLocale();
  const libraryActions = useCatalogLibraryActions({ cards: libraryCards, adoptCards, notify });
  const service = useMemo(() => createCatalogWorkspaceService({
    origin: globalThis.location?.origin ?? 'https://sonflash.invalid',
  }), []);
  const [query, setQuery] = useState<CatalogWorkspaceQuery>(() => readCatalogWorkspaceQuery(browserLocation()));
  const [termDraft, setTermDraft] = useState(query.term);
  const [summary, setSummary] = useState<CatalogWorkspaceSummary | null>(null);
  const [progressAvailable, setProgressAvailable] = useState(false);
  const [hydrated, setHydrated] = useState<readonly HydratedCatalogEntry[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [isLoadingPage, setIsLoadingPage] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [selectedPathUnitId, setSelectedPathUnitId] = useState<string | null>(null);
  const [confirmationUnitId, setConfirmationUnitId] = useState<string | null>(null);
  const [isContinuingUnit, setIsContinuingUnit] = useState(false);
  const [continueError, setContinueError] = useState<string | null>(null);
  const continueGeneration = useRef(0);
  const continuingUnitRef = useRef(false);
  const progressQueries = useRef(createCatalogProgressQueryCache());
  const ownerScope = useRef({ ownerId, version: 0 });
  if (ownerScope.current.ownerId !== ownerId) {
    ownerScope.current = { ownerId, version: ownerScope.current.version + 1 };
    progressQueries.current.clear();
  }
  const ownerVersion = ownerScope.current.version;
  const continuationScope = useRef({ ownerId, libraryEpoch: verifiedLibraryEpoch, query });
  continuationScope.current = { ownerId, libraryEpoch: verifiedLibraryEpoch, query };
  const [optimisticLibrary, setOptimisticLibrary] = useState(() => (
    createCatalogOptimisticLibraryState(ownerId, ownerVersion)
  ));
  const [isOnline, setIsOnline] = useState(browserOnline);
  const [status, setStatus] = useState<WorkspaceStatus>({
    kind: 'checking', message: i18n._(copy.checking), messageKey: 'checking',
  });
  const mounted = useRef(true);
  const workflowGeneration = useRef(0);
  const pagingGuard = useRef<ReturnType<typeof createCatalogPagingGuard> | null>(null);
  if (!pagingGuard.current) pagingGuard.current = createCatalogPagingGuard();
  const personalLibrary = useMemo(() => ownerId && cloudStats && cloudStatsTargetLanguage !== targetLanguage
    ? null
    : createPersonalLibraryPathPresentation(
    ownerId && cloudStats ? {
      total: cloudStats.total,
      dueToday: cloudStats.due,
      learning: cloudStats.good + cloudStats.hard + cloudStats.unrated,
      learned: cloudStats.easy,
    } : libraryStats ?? {
      total: libraryCards.length,
      dueToday: 0,
      learning: libraryCards.length,
      learned: 0,
    },
  ), [cloudStats, cloudStatsTargetLanguage, libraryCards.length, libraryStats, ownerId, targetLanguage]);

  const readyStatus = useCallback((releaseId: string): WorkspaceStatus => ({
    kind: 'ready',
    isOnline,
    message: i18n._(copy.ready.id, { releaseId }),
    messageKey: 'ready', messageValues: { releaseId },
  }), [isOnline]);

  const inspect = useCallback(async () => {
    const generation = ++workflowGeneration.current;
    setStatus({ kind: 'checking', message: i18n._(copy.checking), messageKey: 'checking' });
    try {
      if (!query.catalogId || !query.releaseId) {
        setSummary(null);
        setProgressAvailable(false);
        setHydrated([]);
        setIsLoadingPage(false);
        if (query.mode === 'personal' && query.languageCode !== targetLanguage) return;
        setStatus(query.mode === 'personal'
          ? {
              kind: 'personal',
              message: personalLibrary === null
                ? i18n._(copy.personalUnavailable)
                : personalLibrary.total > 0
                ? i18n._(copy.personalWithCards.id, { count: personalLibrary.total })
                : i18n._(copy.personalEmpty),
              messageKey: personalLibrary === null ? 'personalUnavailable' : personalLibrary.total > 0 ? 'personalWithCards' : 'personalEmpty',
              messageValues: { count: personalLibrary?.total ?? 0 },
            }
          : {
              kind: 'unavailable',
              isOnline,
              canDownload: false,
              message: i18n._(copy.languageUnavailable),
              messageKey: 'languageUnavailable',
            });
        return;
      }
      const catalogId = query.catalogId;
      const releaseId = query.releaseId;
      const progressOwner = ownerId;
      const progressDatabase = database;
      const progressEpoch = verifiedLibraryEpoch;
      const loadProgress = progressOwner && progressDatabase && progressEpoch !== null && progressEpoch !== undefined
        ? () => progressQueries.current.read({
            ownerId: progressOwner, catalogId, releaseId,
            targetLanguage: query.languageCode, libraryEpoch: progressEpoch,
          }, input => readCatalogProgressProjection(progressDatabase, input.ownerId, input.targetLanguage, input.libraryEpoch))
        : undefined;
      const inspection = await inspectInstalledCatalog({
        service,
        catalogId,
        releaseId,
        loadProgress,
        isCurrent: () => mounted.current && workflowGeneration.current === generation,
      });
      if (inspection.status === 'stale' || !mounted.current) return;
      if (inspection.status === 'missing') {
        setSummary(null);
        setProgressAvailable(false);
        setHydrated([]);
        setIsLoadingPage(false);
        setStatus({
          kind: 'unavailable', isOnline, canDownload: true,
          message: isOnline ? i18n._(copy.releaseMissingOnline) : i18n._(copy.releaseMissingOffline),
          messageKey: isOnline ? 'releaseMissingOnline' : 'releaseMissingOffline',
        });
        return;
      }
      const nextSummary = inspection.summary;
      setSummary(nextSummary);
      setConfirmationUnitId(null);
      setContinueError(null);
      setProgressAvailable(inspection.progressAvailable);
      setStatus(readyStatus(nextSummary.release.releaseId));
    } catch (error) {
      if (!mounted.current) return;
      setIsLoadingPage(false);
      setStatus(catalogErrorStatus(error, isOnline, 'catalogOpenError'));
    }
  }, [database, isOnline, ownerId, personalLibrary, query.catalogId, query.languageCode, query.mode, query.releaseId, readyStatus, service, targetLanguage, verifiedLibraryEpoch]);

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
      setStatus(catalogErrorStatus(error, isOnline, 'vocabularyReadError'));
    } finally {
      if (mounted.current && pagingGuard.current!.isCurrent(pageToken)) {
        if (append) setIsLoadingMore(false);
        else setIsLoadingPage(false);
      }
    }
  }, [isOnline, query, readyStatus, service, summary]);

  const updateQuery = useCallback((patch: CatalogWorkspaceQueryPatch, replace = false) => {
    workflowGeneration.current += 1;
    continueGeneration.current += 1;
    setConfirmationUnitId(null);
    setContinueError(null);
    setIsContinuingUnit(false);
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

  useEffect(() => {
    if (query.mode !== 'personal' || query.languageCode === targetLanguage) return;
    searchDebouncer.cancel();
    setTermDraft('');
    updateQuery({ languageCode: targetLanguage, mode: 'personal', term: '' }, true);
  }, [query.languageCode, query.mode, searchDebouncer, targetLanguage, updateQuery]);

  useLayoutEffect(() => {
    if (focusIntent > 0) headingRef?.current?.focus({ preventScroll: true });
  }, [focusIntent, headingRef]);

  useEffect(() => {
    mounted.current = true;
    void inspect();
    return () => {
      mounted.current = false;
      workflowGeneration.current += 1;
      continueGeneration.current += 1;
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
      continueGeneration.current += 1;
      setConfirmationUnitId(null);
      setContinueError(null);
      setIsContinuingUnit(false);
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
    setStatus({ kind: 'downloading', progressPercent: 10, message: i18n._(copy.downloading), messageKey: 'downloading' });
    try {
      const result = await service.download(manifestPath, {
        catalogId: query.catalogId,
        releaseId: query.releaseId,
      }, progress => {
        if (mounted.current) setStatus({
          kind: 'downloading',
          progressPercent: progress.progressPercent,
          message: progress.phase === 'complete' ? i18n._(copy.installed) : i18n._(copy.downloading),
          messageKey: progress.phase === 'complete' ? 'installed' : 'downloading',
        });
      });
      if (result.status === 'stale' || !mounted.current) return;
      await inspect();
    } catch (error) {
      if (!mounted.current) return;
      setStatus(catalogErrorStatus(
        error,
        isOnline,
        'installError',
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
  const pathUnits = projectCatalogPathUnits(summary, progressAvailable);
  const trackUnits = pathUnits?.filter(progress => progress.unit.trackId === selectedTrack) ?? [];
  const nextUnit = trackUnits.find(progress => progress.status === 'active')
    ?? trackUnits.find(progress => progress.status === 'not-started');
  const selectedUnit = trackUnits.find(progress => pathUnitKey(progress.unit) === selectedPathUnitId)
    ?? nextUnit ?? trackUnits[0];
  const selectedUnitKey = selectedUnit ? pathUnitKey(selectedUnit.unit) : null;
  const allUnitsComplete = trackUnits.length > 0 && trackUnits.every(progress => progress.status === 'complete');
  const pace = readDailyPaceForEta();
  const etaDays = pace && selectedUnit?.introduced !== null && selectedUnit?.introduced !== undefined
    ? Math.ceil((selectedUnit.unit.total - selectedUnit.introduced) / pace)
    : null;
  const focusUnitPreview = () => globalThis.requestAnimationFrame?.(() => {
    globalThis.document?.getElementById('catalog-unit-preview')?.focus({ preventScroll: false });
  });
  const selectPathUnit = (trackId: string, unitId: string) => {
    continueGeneration.current += 1;
    setSelectedPathUnitId(`${trackId}\u0000${unitId}`);
    setConfirmationUnitId(null);
    setContinueError(null);
    setIsContinuingUnit(false);
  };
  const openNextUnitPreview = () => {
    if (!nextUnit || !progressAvailable || continuingUnitRef.current) return;
    selectPathUnit(nextUnit.unit.trackId, nextUnit.unit.unitId);
    setConfirmationUnitId(pathUnitKey(nextUnit.unit));
    focusUnitPreview();
  };
  const prepareSelectedUnit = () => {
    if (!selectedUnit || continuingUnitRef.current
      || selectedUnit.status === 'complete' || selectedUnit.status === 'unavailable') return;
    setConfirmationUnitId(pathUnitKey(selectedUnit.unit));
    setContinueError(null);
    focusUnitPreview();
  };
  const confirmSelectedUnit = async () => {
    if (!selectedUnit || !selectedUnitKey || confirmationUnitId !== selectedUnitKey
      || continuingUnitRef.current || !continueCatalogUnit || !query.catalogId || !query.releaseId
      || !ownerId || verifiedLibraryEpoch === null || !progressAvailable
      || selectedUnit.status === 'complete' || selectedUnit.status === 'unavailable') return;
    const generation = ++continueGeneration.current;
    continuingUnitRef.current = true;
    const scope = { ownerId, libraryEpoch: verifiedLibraryEpoch, query };
    const isCurrent = () => mounted.current && continueGeneration.current === generation
      && continuationScope.current.ownerId === scope.ownerId
      && continuationScope.current.libraryEpoch === scope.libraryEpoch
      && continuationScope.current.query.catalogId === scope.query.catalogId
      && continuationScope.current.query.releaseId === scope.query.releaseId
      && continuationScope.current.query.languageCode === scope.query.languageCode
      && continuationScope.current.query.trackId === scope.query.trackId;
    setIsContinuingUnit(true);
    setContinueError(null);
    try {
      const result = await service.readUnit({
        catalogId: query.catalogId,
        releaseId: query.releaseId,
        language: query.languageCode,
        trackId: selectedUnit.unit.trackId,
        unitId: selectedUnit.unit.unitId,
      });
      if (!isCurrent() || result.status === 'stale') return;
      const unit = result.value;
      if (!unit || unit.descriptor.unitId !== selectedUnit.unit.unitId
        || unit.descriptor.trackId !== selectedUnit.unit.trackId
        || unit.descriptor.tier !== selectedUnit.unit.tier
        || unit.descriptor.ordinal !== selectedUnit.unit.ordinal
        || unit.entries.length !== selectedUnit.unit.total
        || unit.entries.length > 20
        || unit.entries.some(entry => entry.membership.language !== query.languageCode
          || entry.lexeme.language !== query.languageCode
          || entry.membership.lexemeId !== entry.lexeme.id)) {
        setContinueError(i18n._(copy.unitUnavailable));
        return;
      }
      const candidates = unit.entries.map(entry => catalogEntryToLibraryCard(presentHydratedCatalogEntry(entry)));
      if (new Set(candidates.map(card => card.lexemeId)).size !== candidates.length) {
        setContinueError(i18n._(copy.unitUnavailable));
        return;
      }
      const outcome = await continueCatalogUnit(candidates, isCurrent);
      if (!isCurrent()) return;
      if (outcome !== 'started') {
        setContinueError(i18n._(outcome === 'partial' ? copy.unitPartial : copy.unitUnavailable));
      }
    } catch {
      if (isCurrent()) setContinueError(i18n._(copy.unitReadError));
    } finally {
      continuingUnitRef.current = false;
      if (isCurrent()) setIsContinuingUnit(false);
    }
  };
  const model: CatalogScreenModel = {
    headingRef,
    mode: query.mode,
    status: status.messageKey
      ? { ...status, message: i18n._(copy[status.messageKey].id, status.messageValues) }
      : status,
    selectedLanguage: query.languageCode,
    uiLocale,
    progressAvailable,
    languages: catalogLanguagesPresentation(),
    selectedTrack,
    tracks,
    selectedTier,
    tiers: summary ? catalogTiersFromSummary(summary, selectedTrack) : [],
    filters,
    cards,
    resultSummary: isLoadingPage
      ? i18n._(copy.updating)
      : cards.length === 0
      ? i18n._(copy.emptyResults)
      : i18n._(copy.resultSummary.id, {
        count: cards.length,
        more: hasMore ? i18n._(msg({ id: 'catalog.workspace.or-more', message: ' or more' })) : '',
        track: i18n._(catalogTrackMessages[selectedTrack].label),
        tier: i18n._(catalogTierMessages[selectedTier].label),
      }),
    hasMore,
    isLoadingPage,
    isLoadingMore,
    ...(status.kind === 'personal' && personalLibrary ? { personalLibrary } : {}),
    pathUnits,
    selectedPathUnitId: selectedUnitKey,
    pathUnitContinue: {
      selectedUnitId: selectedUnitKey,
      confirmationUnitId,
      busy: isContinuingUnit,
      error: continueError,
      etaDays,
      allComplete: allUnitsComplete,
    },
  };
  const actions: CatalogScreenActions = {
    selectMode: mode => {
      searchDebouncer.cancel();
      setTermDraft('');
      updateQuery({ mode, languageCode: mode === 'personal' ? targetLanguage : query.languageCode, trackId: null, tier: null, cefrLevel: null, topic: null, partOfSpeech: null, skill: null, term: '' });
    },
    selectLanguage: languageCode => updateQuery({ languageCode }),
    selectTrack: trackId => {
      setSelectedPathUnitId(null);
      setConfirmationUnitId(null);
      setContinueError(null);
      continueGeneration.current += 1;
      updateQuery({ trackId, tier: 'foundation' });
    },
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
    selectPathUnit,
    openNextUnitPreview,
    prepareSelectedUnit,
    confirmSelectedUnit: () => { void confirmSelectedUnit(); },
  };

  return <CatalogScreen model={model} actions={actions} />;
}
