import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import type { CardQueryState } from '../../lib/cardQuery';
import type { CardData } from '../../types/card';
import { overlayRecentlyPromotedCards } from '../library/libraryPresentation';
import {
  cloudBackoffCacheKey, cloudFacetsCacheKey, cloudPageCacheKey, cloudStatsCacheKey,
  isCloudBackoffActive, normalizeLocalCards,
  readCachedCloudStats, readCachedCloudTotal, readLocalJson, writeLocalValue,
  type CachedCloudPage, type CachedCloudStats,
} from '../library/libraryStorage';
import { createCloudLibraryPageController, type CloudLibraryCachePort } from './cloudLibraryPageController';
import { createCloudLibraryPageFirebaseAdapter } from './cloudLibraryPageFirebaseAdapter';
import { db, isFirebaseConfigured } from '../../lib/firebase';

export function useCloudLibraryPage({
  ownerId,
  query,
  queryKey,
  page,
  pageSize,
  refreshKey,
  statsOpen,
  progressEvidenceOpen,
  getPromotedCards,
}: {
  ownerId: string | null;
  query: CardQueryState;
  queryKey: string;
  page: number;
  pageSize: number;
  refreshKey: number;
  statsOpen: boolean;
  progressEvidenceOpen: boolean;
  getPromotedCards: () => readonly CardData[];
}) {
  const promotedRef = useRef(getPromotedCards);
  const queryRef = useRef(query);
  promotedRef.current = getPromotedCards;
  queryRef.current = query;

  const transformPage = useCallback(async (request: { query: CardQueryState; page: number; pageSize: number }, items: CardData[]) =>
    overlayRecentlyPromotedCards({
      pageCards: items,
      promotedCards: [...promotedRef.current()],
      filters: request.query,
      page: request.page,
      pageSize: request.pageSize,
    }), []);

  const controller = useMemo(() => {
    // The cache reads the current course without recreating its controller.
    const getTargetLanguage = () => queryRef.current.targetLanguage ?? null;
    const adapter = createCloudLibraryPageFirebaseAdapter({ database: db, configured: isFirebaseConfigured, transformPage });
    const cache: CloudLibraryCachePort = {
      readPage: async request => {
        const cachedValue = readLocalJson<unknown>(cloudPageCacheKey(request.ownerId), null);
        const cachedPage = cachedValue && typeof cachedValue === 'object' && !Array.isArray(cachedValue)
          ? cachedValue as Partial<CachedCloudPage>
          : null;
        if (!cachedPage || cachedPage.queryKey !== request.queryKey || cachedPage.page !== request.page
          || !Array.isArray(cachedPage.items) || typeof cachedPage.total !== 'number') return null;
        const items = normalizeLocalCards(cachedPage.items).slice(0, request.pageSize);
        if (items.length === 0) return null;
        return {
          items: await transformPage(request, items),
          total: ((request.page - 1) * request.pageSize) + items.length,
          hasNext: false,
        };
      },
      writePage: value => {
        writeLocalValue(cloudPageCacheKey(value.ownerId), JSON.stringify({
          queryKey: value.queryKey,
          page: value.page,
          items: value.items,
          total: value.total,
          hasNext: value.hasNext,
          updatedAt: new Date().toISOString(),
          countedAt: value.countedAt === null ? null : new Date(value.countedAt).toISOString(),
        } satisfies CachedCloudPage));
      },
      readCount: readCachedCloudTotal,
      // Course-scoped: a stats cache written for course A must never answer
      // a read for course B, so both sides key off the active target language.
      readStats: id => readCachedCloudStats(id, getTargetLanguage()),
      writeStats: (id, stats, updatedAt) => { writeLocalValue(cloudStatsCacheKey(id, getTargetLanguage()), JSON.stringify({ stats, updatedAt: new Date(updatedAt).toISOString() } satisfies CachedCloudStats)); },
      readFacets: id => {
        const value = readLocalJson<unknown>(cloudFacetsCacheKey(id), null);
        if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
        const source = value as { categories?: unknown; complete?: unknown };
        return source.categories && typeof source.categories === 'object' && !Array.isArray(source.categories)
          ? { categories: source.categories as Record<string, number>, complete: source.complete === true }
          : null;
      },
      writeFacets: (id, facets) => { writeLocalValue(cloudFacetsCacheKey(id), JSON.stringify(facets)); },
      isBackoffActive: isCloudBackoffActive,
      markBackoff: id => { writeLocalValue(cloudBackoffCacheKey(id), String(Date.now() + 5 * 60 * 1000)); },
    };
    return createCloudLibraryPageController({ adapter, cache, pageSize });
  }, [pageSize, transformPage]);

  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);

  useEffect(() => {
    if (!ownerId) { controller.stop(); return; }
    // queryKey is the canonical identity of query. Depending on the object as
    // well would restart the Firestore listener for unrelated UI renders.
    return controller.activate({ ownerId, query: queryRef.current, queryKey, page });
  }, [controller, ownerId, page, queryKey, refreshKey]);

  useEffect(() => {
    // Depending on targetLanguage (not the whole query) means an unrelated
    // catalog filter change never re-triggers a stats read; only opening the
    // panel or switching the active course does.
    if (statsOpen && ownerId) void controller.requestStats(query.targetLanguage ?? null);
  }, [controller, ownerId, statsOpen, query.targetLanguage]);

  useEffect(() => {
    if (progressEvidenceOpen && ownerId) void controller.requestProgressEvidence(query.targetLanguage ?? null);
  }, [controller, ownerId, progressEvidenceOpen, query.targetLanguage]);

  useEffect(() => () => controller.stop(), [controller]);
  return snapshot;
}
