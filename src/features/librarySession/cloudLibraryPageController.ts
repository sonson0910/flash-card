import { shouldRefreshCloudCount, shouldRefreshCloudStats } from '../../lib/cloudReadPolicy';
import type { CardQueryState } from '../../lib/cardQuery';
import { shouldRefreshCountForRealtimeChanges, type RealtimeChangeType } from '../../lib/realtimeSync';
import type { CardData } from '../../types/card';

export interface CloudLibraryStats {
  total: number;
  reviewed: number;
  easy: number;
  good: number;
  hard: number;
  unrated: number;
  bookmarked: number;
  due: number;
  legacyUnindexed: number;
}

export const EMPTY_LIBRARY_STATS: CloudLibraryStats = {
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

export interface CloudPage {
  items: CardData[];
  hasNext: boolean;
  cursor: string | null;
  changeTypes: RealtimeChangeType[];
  fromCache: boolean;
  hasPendingWrites: boolean;
}

export interface CloudLibraryPageRequest {
  ownerId: string;
  query: CardQueryState;
  queryKey: string;
  page: number;
}

interface CloudPageSubscriptionRequest extends CloudLibraryPageRequest {
  pageSize: number;
  cursor: string | null;
}

export interface CloudLibraryPageAdapter {
  readonly available: boolean;
  subscribePage(
    request: CloudPageSubscriptionRequest,
    onPage: (page: CloudPage) => void | Promise<void>,
    onError: (error: unknown) => void | Promise<void>,
  ): () => void;
  countCards(ownerId: string, query: CardQueryState): Promise<number>;
  loadStats(ownerId: string): Promise<CloudLibraryStats>;
  subscribeFacets(
    ownerId: string,
    onFacets: (facets: { categories: Record<string, number>; complete: boolean }) => void,
    onError: (error: unknown) => void,
  ): () => void;
}

export interface CloudLibraryCachePort {
  readPage(request: CloudLibraryPageRequest & { pageSize: number }): Promise<{
    items: CardData[];
    total: number;
    hasNext: boolean;
  } | null>;
  writePage(value: CloudLibraryPageRequest & {
    items: CardData[];
    total: number;
    hasNext: boolean;
    countedAt: number | null;
  }): void | Promise<void>;
  readCount(ownerId: string, queryKey: string): { total: number; cachedAt: number | null } | null;
  readStats(ownerId: string): { stats: CloudLibraryStats; cachedAt: number | null } | null;
  writeStats(ownerId: string, stats: CloudLibraryStats, updatedAt: number): void;
  readFacets(ownerId: string): { categories: Record<string, number>; complete: boolean } | null;
  writeFacets(ownerId: string, facets: { categories: Record<string, number>; complete: boolean }): void;
  isBackoffActive(ownerId: string): boolean;
  markBackoff(ownerId: string): void;
}

export interface CloudLibraryPageSnapshot {
  ownerId: string | null;
  queryKey: string;
  page: number;
  items: CardData[];
  total: number;
  hasNext: boolean;
  isLoading: boolean;
  cloudUnavailable: boolean;
  error: string | null;
  stats: CloudLibraryStats;
  isStatsLoading: boolean;
  facets: Record<string, number>;
  facetsComplete: boolean;
}

const quotaError = (error: unknown): boolean => {
  const source = error && typeof error === 'object' ? error as { code?: unknown; message?: unknown } : null;
  const value = `${String(source?.code ?? '')} ${String(source?.message ?? error)}`.toLocaleLowerCase();
  return value.includes('resource-exhausted') || value.includes('quota');
};

const fallbackCategories = (cards: readonly CardData[]) => cards.reduce<Record<string, number>>((counts, card) => {
  const category = card.category || 'Other';
  counts[category] = (counts[category] || 0) + 1;
  return counts;
}, {});

const safeCacheRead = <T,>(operation: () => T, fallback: T): T => {
  try { return operation(); } catch { return fallback; }
};

const safeCacheWrite = (operation: () => void): void => {
  try { operation(); } catch { /* Browser cache is optional. */ }
};

const safeCacheWriteAsync = async (operation: () => Promise<void> | void): Promise<void> => {
  try { await operation(); } catch { /* Browser cache is optional. */ }
};

export function createCloudLibraryPageController({
  adapter,
  cache,
  pageSize = 9,
  now = () => Date.now(),
}: {
  adapter: CloudLibraryPageAdapter;
  cache: CloudLibraryCachePort;
  pageSize?: number;
  now?: () => number;
}) {
  const boundedPageSize = Math.max(1, Math.min(100, Math.floor(pageSize) || 9));
  let snapshot: CloudLibraryPageSnapshot = {
    ownerId: null,
    queryKey: '',
    page: 1,
    items: [],
    total: 0,
    hasNext: false,
    isLoading: false,
    cloudUnavailable: false,
    error: null,
    stats: EMPTY_LIBRARY_STATS,
    isStatsLoading: false,
    facets: {},
    facetsComplete: false,
  };
  let pageGeneration = 0;
  let ownerGeneration = 0;
  let activeOwnerId: string | null = null;
  let unsubscribePage: (() => void) | null = null;
  let unsubscribeFacets: (() => void) | null = null;
  const cursors = new Map<string, Map<number, string | null>>();
  const listeners = new Set<(next: CloudLibraryPageSnapshot) => void>();

  const publish = (patch: Partial<CloudLibraryPageSnapshot>) => {
    snapshot = { ...snapshot, ...patch };
    listeners.forEach(listener => listener(snapshot));
  };

  const setupOwner = (ownerId: string) => {
    if (activeOwnerId === ownerId) return;
    activeOwnerId = ownerId;
    ownerGeneration += 1;
    const generation = ownerGeneration;
    unsubscribeFacets?.();
    unsubscribeFacets = null;

    const cachedStats = safeCacheRead(() => cache.readStats(ownerId), null);
    const cachedFacets = safeCacheRead(() => cache.readFacets(ownerId), null);
    publish({
      ownerId,
      stats: cachedStats?.stats ?? EMPTY_LIBRARY_STATS,
      items: [],
      total: 0,
      hasNext: false,
      isStatsLoading: false,
      facets: cachedFacets?.categories ?? {},
      facetsComplete: cachedFacets?.complete ?? false,
    });

    if (!adapter.available || safeCacheRead(() => cache.isBackoffActive(ownerId), false)) return;
    unsubscribeFacets = adapter.subscribeFacets(ownerId, facets => {
      if (generation !== ownerGeneration || activeOwnerId !== ownerId) return;
      publish({ facets: facets.categories, facetsComplete: facets.complete });
      safeCacheWrite(() => cache.writeFacets(ownerId, facets));
    }, () => undefined);
  };

  const applyFallback = async (
    request: CloudLibraryPageRequest,
    generation: number,
    error: unknown,
  ) => {
    if (quotaError(error)) safeCacheWrite(() => cache.markBackoff(request.ownerId));
    const fallback = await (async () => {
      try { return await cache.readPage({ ...request, pageSize: boundedPageSize }); }
      catch { return null; }
    })();
    if (generation !== pageGeneration) return;
    if (fallback) {
      publish({
        items: fallback.items.slice(0, boundedPageSize),
        total: fallback.total,
        hasNext: fallback.hasNext,
        isLoading: false,
        cloudUnavailable: true,
        error: quotaError(error)
          ? 'Firebase has reached today’s read quota. Showing the shared local copy on this device.'
          : 'The network or Firebase is temporarily unavailable. Showing the shared local copy on this device.',
        ...(Object.keys(snapshot.facets).length === 0
          ? { facets: fallbackCategories(fallback.items), facetsComplete: false }
          : {}),
      });
      return;
    }
    publish({
      items: request.page === 1 ? [] : snapshot.items,
      hasNext: false,
      isLoading: false,
      cloudUnavailable: true,
      error: quotaError(error)
        ? 'Firebase has reached today’s read quota and this page is not cached on the device.'
        : 'Could not load this card page. The filter may need a Firestore index or a working network connection.',
    });
  };

  const activate = (request: CloudLibraryPageRequest) => {
    unsubscribePage?.();
    unsubscribePage = null;
    const generation = ++pageGeneration;
    const continuesSameQuery = snapshot.ownerId === request.ownerId
      && snapshot.queryKey === request.queryKey;
    setupOwner(request.ownerId);
    const scope = `${request.ownerId}\u0000${request.queryKey}`;
    const pageCursors = cursors.get(scope) ?? new Map<number, string | null>([[1, null]]);
    cursors.set(scope, pageCursors);
    const cursor = pageCursors.get(request.page);
    publish({
      ownerId: request.ownerId,
      queryKey: request.queryKey,
      page: request.page,
      isLoading: true,
      cloudUnavailable: false,
      error: null,
    });

    if (!adapter.available || safeCacheRead(() => cache.isBackoffActive(request.ownerId), false) || cursor === undefined) {
      void applyFallback(request, generation, new Error(
        cursor === undefined ? 'The previous page cursor is unavailable.' : 'Cloud reads are paused.',
      ));
      return () => undefined;
    }

    let initialPage = true;
    // 0 = idle, 1 = counting, 2 = recount requested while counting.
    let countRefreshState = 0;
    let activeTotal = continuesSameQuery ? snapshot.total : 0;
    const defaultQuery = request.page === 1
      && request.query.wordPrefix === ''
      && !request.query.category
      && !request.query.customDeck
      && !request.query.difficulty
      && !request.query.partOfSpeech
      && !request.query.bookmarkedOnly
      && !request.query.createdDate;
    const activeSubscription = adapter.subscribePage(
      { ...request, pageSize: boundedPageSize, cursor },
      async page => {
        if (generation !== pageGeneration) return;
        const cachedCount = safeCacheRead(() => cache.readCount(request.ownerId, request.queryKey), null);
        let total = cachedCount?.total ?? activeTotal;
        let countedAt = cachedCount?.cachedAt ?? null;
        const refreshInitialCount = initialPage && shouldRefreshCloudCount({
          page: request.page,
          cachedAt: cachedCount?.cachedAt ?? null,
          now: now(),
        });
        const refreshRealtimeCount = !initialPage
          && !page.fromCache
          && !page.hasPendingWrites
          && shouldRefreshCountForRealtimeChanges(false, page.changeTypes);
        const requestsCountRefresh = refreshInitialCount || refreshRealtimeCount;
        const shouldRefreshCount = requestsCountRefresh && countRefreshState === 0;
        if (requestsCountRefresh) countRefreshState = countRefreshState === 0 ? 1 : 2;
        if (generation !== pageGeneration) return;
        const inferredMinimum = ((request.page - 1) * boundedPageSize)
          + page.items.length
          + (page.hasNext ? 1 : 0);
        total = Math.max(total, activeTotal, inferredMinimum);
        activeTotal = total;
        if (page.hasNext && page.cursor) pageCursors.set(request.page + 1, page.cursor);
        else {
          for (const pageNumber of [...pageCursors.keys()]) {
            if (pageNumber > request.page) pageCursors.delete(pageNumber);
          }
        }
        initialPage = false;
        publish({
          items: page.items.slice(0, boundedPageSize),
          total,
          hasNext: page.hasNext,
          isLoading: false,
          cloudUnavailable: false,
          error: null,
        });
        await safeCacheWriteAsync(() => cache.writePage({
          ...request,
          items: page.items.slice(0, boundedPageSize),
          total,
          hasNext: page.hasNext,
          countedAt,
        }));

        if (shouldRefreshCount) {
          do {
            countRefreshState = 1;
            const countedTotal = await adapter.countCards(request.ownerId, request.query).catch(() => null);
            if (generation !== pageGeneration) break;
            if (countedTotal === null) continue;
            const refreshedAt = now();
            const currentItems = snapshot.items.slice(0, boundedPageSize);
            total = Math.max(
              countedTotal,
              ((request.page - 1) * boundedPageSize)
                + currentItems.length
                + (snapshot.hasNext ? 1 : 0),
            );
            activeTotal = total;
            const cachedStats = defaultQuery
              ? safeCacheRead(() => cache.readStats(request.ownerId), null)
              : null;
            const nextStats = defaultQuery
              ? {
                ...(cachedStats?.stats ?? snapshot.stats),
                total,
              }
              : null;
            const cachedStatsAt = cachedStats?.cachedAt;
            publish(nextStats ? { total, stats: nextStats } : { total });
            if (nextStats && typeof cachedStatsAt === 'number') {
              // A count only makes `total` authoritative. Preserve the age of
              // the full stats cache so requestStats still refreshes its facets.
              safeCacheWrite(() => cache.writeStats(
                request.ownerId,
                nextStats,
                cachedStatsAt,
              ));
            }
            await safeCacheWriteAsync(() => cache.writePage({
              ...request,
              items: currentItems,
              total,
              hasNext: snapshot.hasNext,
              countedAt: refreshedAt,
            }));
          } while (countRefreshState === 2 && generation === pageGeneration);
          countRefreshState = 0;
        }
      },
      async error => {
        if (generation !== pageGeneration) return;
        if (snapshot.isLoading) await applyFallback(request, generation, error);
        else {
          if (quotaError(error)) safeCacheWrite(() => cache.markBackoff(request.ownerId));
          publish({
            isLoading: false,
            cloudUnavailable: true,
            error: quotaError(error)
              ? 'Cloud live updates paused because Firebase reached its read quota. Showing the last successful page.'
              : 'Cloud live updates stopped. Showing the last successful page while the connection recovers.',
          });
        }
      },
    );
    unsubscribePage = activeSubscription;
    return () => {
      if (generation === pageGeneration) pageGeneration += 1;
      activeSubscription();
      if (unsubscribePage === activeSubscription) unsubscribePage = null;
    };
  };

  const requestStats = async () => {
    const ownerId = activeOwnerId;
    if (!ownerId || !adapter.available) return;
    const generation = ownerGeneration;
    const cached = safeCacheRead(() => cache.readStats(ownerId), null);
    if (cached && !shouldRefreshCloudStats(cached.cachedAt, now())) {
      publish({ stats: cached.stats });
      return;
    }
    if (safeCacheRead(() => cache.isBackoffActive(ownerId), false)) return;
    publish({ isStatsLoading: true });
    try {
      const stats = await adapter.loadStats(ownerId);
      if (generation !== ownerGeneration || activeOwnerId !== ownerId) return;
      publish({ stats, isStatsLoading: false });
      safeCacheWrite(() => cache.writeStats(ownerId, stats, now()));
    } catch (error) {
      if (generation !== ownerGeneration || activeOwnerId !== ownerId) return;
      publish({
        isStatsLoading: false,
        error: quotaError(error)
          ? 'Firebase has reached today’s read quota; Insights is using cached metrics.'
          : 'Could not refresh insights; cached metrics are being used.',
      });
    }
  };

  const stop = () => {
    pageGeneration += 1;
    ownerGeneration += 1;
    unsubscribePage?.();
    unsubscribeFacets?.();
    unsubscribePage = null;
    unsubscribeFacets = null;
    activeOwnerId = null;
  };

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: (next: CloudLibraryPageSnapshot) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    activate,
    requestStats,
    stop,
  };
}
