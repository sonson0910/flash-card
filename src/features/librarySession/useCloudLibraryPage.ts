import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import type { CardQueryState } from '../../lib/cardQuery';
import { loadDevicePending, mergePendingOperations } from '../../lib/deviceSync';
import { overlayPendingCardsOnPage } from '../../lib/pendingCardOverlay';
import { upsertMirroredCardBatch } from '../../lib/cardMirror';
import type { CardData } from '../../types/card';
import { overlayRecentlyPromotedCards } from '../library/libraryPresentation';
import {
  cloudBackoffCacheKey, cloudFacetsCacheKey, cloudPageCacheKey, cloudStatsCacheKey,
  getBoundedCloudFallback, isCloudBackoffActive, persistLocalCardBackup,
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
  getDeviceFallback,
  getPromotedCards,
}: {
  ownerId: string | null;
  query: CardQueryState;
  queryKey: string;
  page: number;
  pageSize: number;
  refreshKey: number;
  statsOpen: boolean;
  getDeviceFallback: (query: CardQueryState, page: number) => Promise<{ items: CardData[]; total: number; hasNext: boolean } | null>;
  getPromotedCards: () => readonly CardData[];
}) {
  const fallbackRef = useRef(getDeviceFallback);
  const promotedRef = useRef(getPromotedCards);
  fallbackRef.current = getDeviceFallback;
  promotedRef.current = getPromotedCards;

  const transformPage = useCallback(async (request: { ownerId: string; query: CardQueryState; page: number; pageSize: number }, items: CardData[]) => {
    const pending = mergePendingOperations(await loadDevicePending(request.ownerId))
      .filter(operation => operation.ownerUserId === request.ownerId);
    return overlayRecentlyPromotedCards({
      pageCards: overlayPendingCardsOnPage({ cloudCards: items, pendingOperations: pending, filters: request.query, page: request.page, pageSize: request.pageSize }),
      promotedCards: [...promotedRef.current()],
      filters: request.query,
      page: request.page,
      pageSize: request.pageSize,
    });
  }, []);

  const controller = useMemo(() => {
    const adapter = createCloudLibraryPageFirebaseAdapter({ database: db, configured: isFirebaseConfigured, transformPage });
    const cache: CloudLibraryCachePort = {
      readPage: async request => await fallbackRef.current(request.query, request.page)
        ?? getBoundedCloudFallback(request.ownerId, request.queryKey, request.page, request.query, request.pageSize),
      writePage: async value => {
        persistLocalCardBackup(value.items, pageSize, value.total, value.ownerId);
        writeLocalValue(cloudPageCacheKey(value.ownerId), JSON.stringify({
          queryKey: value.queryKey,
          page: value.page,
          items: value.items,
          total: value.total,
          hasNext: value.hasNext,
          updatedAt: new Date().toISOString(),
          countedAt: value.countedAt === null ? null : new Date(value.countedAt).toISOString(),
        } satisfies CachedCloudPage));
        try { await upsertMirroredCardBatch(value.ownerId, value.items); }
        catch (cause) { console.warn('The visible page could not be copied to the local IndexedDB mirror.', cause); }
      },
      readCount: readCachedCloudTotal,
      readStats: readCachedCloudStats,
      writeStats: (id, stats, updatedAt) => { writeLocalValue(cloudStatsCacheKey(id), JSON.stringify({ stats, updatedAt: new Date(updatedAt).toISOString() } satisfies CachedCloudStats)); },
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
    return controller.activate({ ownerId, query, queryKey, page });
  }, [controller, ownerId, page, query, queryKey, refreshKey]);

  useEffect(() => {
    if (statsOpen && ownerId) void controller.requestStats();
  }, [controller, ownerId, statsOpen]);

  useEffect(() => () => controller.stop(), [controller]);
  return snapshot;
}
