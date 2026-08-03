import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import type { CardQueryState } from '../../lib/cardQuery';
import type { CardData } from '../../types/card';
import {
  createCloudLibraryPageController,
  EMPTY_LIBRARY_STATS,
  type CloudLibraryCachePort,
  type CloudLibraryPageAdapter,
  type CloudPage,
} from './cloudLibraryPageController';

const filters: CardQueryState = {
  category: null,
  customDeck: null,
  difficulty: null,
  partOfSpeech: null,
  bookmarkedOnly: false,
  createdDate: null,
  wordPrefix: '',
};

const card = (id: string, category = 'General'): CardData => ({
  id,
  word: id,
  normalizedWord: id,
  translation: `${id}-vi`,
  explanation: '',
  phonetic: '',
  emoji: '📝',
  category,
  audioUrl: null,
  imageUrl: null,
  createdAt: '2026-08-03T00:00:00.000Z',
});

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(resolvePromise => { resolve = resolvePromise; });
  return { promise, resolve };
};

const createFakes = () => {
  const subscriptions: Array<{
    request: { ownerId: string; query: CardQueryState; queryKey: string; pageSize: number; cursor: string | null };
    page: (value: CloudPage) => void | Promise<void>;
    error: (cause: unknown) => void | Promise<void>;
    unsubscribe: ReturnType<typeof vi.fn>;
  }> = [];
  const facetSubscriptions: Array<{
    ownerId: string;
    publish: (facets: { categories: Record<string, number>; complete: boolean }) => void;
    unsubscribe: ReturnType<typeof vi.fn>;
  }> = [];
  const adapter: CloudLibraryPageAdapter = {
    available: true,
    subscribePage: vi.fn((request, page, error) => {
      const unsubscribe = vi.fn();
      subscriptions.push({ request, page, error, unsubscribe });
      return unsubscribe;
    }),
    countCards: vi.fn(async () => 0),
    loadStats: vi.fn(async () => EMPTY_LIBRARY_STATS),
    subscribeFacets: vi.fn((ownerId, publish) => {
      const unsubscribe = vi.fn();
      facetSubscriptions.push({ ownerId, publish, unsubscribe });
      return unsubscribe;
    }),
  };
  const cache: CloudLibraryCachePort = {
    readPage: vi.fn(async () => null),
    writePage: vi.fn(async () => undefined),
    readCount: vi.fn(() => null),
    readStats: vi.fn(() => null),
    writeStats: vi.fn(),
    readFacets: vi.fn(() => null),
    writeFacets: vi.fn(),
    isBackoffActive: vi.fn(() => false),
    markBackoff: vi.fn(),
  };
  return { adapter, cache, subscriptions, facetSubscriptions };
};

describe('cloud library page controller', () => {
  it('keeps controller and cursor contracts free of Firebase vendor types', () => {
    const controllerSource = readFileSync(fileURLToPath(new URL('./cloudLibraryPageController.ts', import.meta.url)), 'utf8');
    const adapterSource = readFileSync(fileURLToPath(new URL('./cloudLibraryPageFirebaseAdapter.ts', import.meta.url)), 'utf8');

    expect(controllerSource).not.toMatch(/from\s+['"]firebase(?:\/|['"])/);
    expect(controllerSource).not.toMatch(/QueryDocumentSnapshot|DocumentSnapshot|\bdb\b/);
    expect(adapterSource).toMatch(/from\s+['"]firebase\/firestore['"]/);
  });

  it('subscribes to one bounded page, refreshes first-page count, and stores an opaque cursor', async () => {
    const { adapter, cache, subscriptions } = createFakes();
    vi.mocked(adapter.countCards).mockResolvedValue(14);
    const controller = createCloudLibraryPageController({ adapter, cache, now: () => 1_000_000 });

    controller.activate({ ownerId: 'owner-a', query: filters, queryKey: 'all', page: 1 });
    await subscriptions[0].page({
      items: [card('a'), card('b')], hasNext: true, cursor: 'opaque-1',
      changeTypes: ['added'], fromCache: false, hasPendingWrites: false,
    });

    expect(subscriptions[0].request).toMatchObject({ ownerId: 'owner-a', pageSize: 9, cursor: null });
    expect(controller.getSnapshot()).toMatchObject({ items: [card('a'), card('b')], total: 14, hasNext: true, isLoading: false });
    expect(cache.writePage).toHaveBeenCalledWith(expect.objectContaining({ ownerId: 'owner-a', queryKey: 'all', page: 1, total: 14 }));

    controller.activate({ ownerId: 'owner-a', query: filters, queryKey: 'all', page: 2 });
    expect(subscriptions[1].request.cursor).toBe('opaque-1');
    expect(adapter.countCards).toHaveBeenCalledTimes(1);
  });

  it('unsubscribes the old query and ignores its late page/count publication', async () => {
    const { adapter, cache, subscriptions } = createFakes();
    const oldCount = deferred<number>();
    vi.mocked(adapter.countCards).mockImplementation((_owner, query) =>
      query.wordPrefix === 'old' ? oldCount.promise : Promise.resolve(1));
    const controller = createCloudLibraryPageController({ adapter, cache });
    const oldQuery = { ...filters, wordPrefix: 'old' };
    const newQuery = { ...filters, wordPrefix: 'new' };

    const cleanupOld = controller.activate({ ownerId: 'owner-a', query: oldQuery, queryKey: 'old', page: 1 });
    const oldPage = subscriptions[0].page({
      items: [card('old')], hasNext: false, cursor: null,
      changeTypes: [], fromCache: false, hasPendingWrites: false,
    });
    controller.activate({ ownerId: 'owner-a', query: newQuery, queryKey: 'new', page: 1 });
    expect(subscriptions[0].unsubscribe).toHaveBeenCalledOnce();
    cleanupOld();
    expect(subscriptions[1].unsubscribe).not.toHaveBeenCalled();
    await subscriptions[1].page({
      items: [card('new')], hasNext: false, cursor: null,
      changeTypes: [], fromCache: false, hasPendingWrites: false,
    });
    oldCount.resolve(99);
    await oldPage;

    expect(controller.getSnapshot()).toMatchObject({ items: [card('new')], total: 1 });
    expect(cache.writePage).not.toHaveBeenCalledWith(expect.objectContaining({ queryKey: 'old' }));
  });

  it('uses bounded cached fallback on failure and derives facets only when no facet cache exists', async () => {
    const { adapter, cache, subscriptions } = createFakes();
    vi.mocked(cache.readPage).mockResolvedValue({ items: [card('cached', 'Travel')], total: 1, hasNext: false });
    const controller = createCloudLibraryPageController({ adapter, cache });

    controller.activate({ ownerId: 'owner-a', query: filters, queryKey: 'all', page: 1 });
    await subscriptions[0].error(new Error('network unavailable'));

    expect(controller.getSnapshot()).toMatchObject({
      items: [card('cached', 'Travel')], total: 1, cloudUnavailable: true,
      facets: { Travel: 1 }, facetsComplete: false, isLoading: false,
    });
  });

  it('does not recount modified/cache/pending snapshots but recounts a server add or remove', async () => {
    const { adapter, cache, subscriptions } = createFakes();
    vi.mocked(cache.readCount).mockReturnValue({ total: 2, cachedAt: 1_000_000 });
    const controller = createCloudLibraryPageController({ adapter, cache, now: () => 1_000_001 });
    controller.activate({ ownerId: 'owner-a', query: filters, queryKey: 'all', page: 1 });
    await subscriptions[0].page({ items: [card('a')], hasNext: false, cursor: null, changeTypes: [], fromCache: false, hasPendingWrites: false });
    await subscriptions[0].page({ items: [card('a')], hasNext: false, cursor: null, changeTypes: ['modified'], fromCache: false, hasPendingWrites: false });
    await subscriptions[0].page({ items: [card('a')], hasNext: false, cursor: null, changeTypes: ['added'], fromCache: true, hasPendingWrites: false });
    await subscriptions[0].page({ items: [card('a')], hasNext: false, cursor: null, changeTypes: ['removed'], fromCache: false, hasPendingWrites: true });
    expect(adapter.countCards).not.toHaveBeenCalled();

    vi.mocked(adapter.countCards).mockResolvedValue(3);
    await subscriptions[0].page({ items: [card('a'), card('b')], hasNext: false, cursor: null, changeTypes: ['added'], fromCache: false, hasPendingWrites: false });
    expect(adapter.countCards).toHaveBeenCalledOnce();
    expect(controller.getSnapshot().total).toBe(3);
  });

  it('switches owner facet subscriptions and ignores stale facets and stats', async () => {
    const { adapter, cache, subscriptions, facetSubscriptions } = createFakes();
    const oldStats = deferred<typeof EMPTY_LIBRARY_STATS>();
    vi.mocked(cache.readStats).mockReturnValue(null);
    vi.mocked(adapter.loadStats).mockImplementation(ownerId =>
      ownerId === 'owner-a' ? oldStats.promise : Promise.resolve({ ...EMPTY_LIBRARY_STATS, total: 2 }));
    const controller = createCloudLibraryPageController({ adapter, cache });

    controller.activate({ ownerId: 'owner-a', query: filters, queryKey: 'all', page: 1 });
    const statsTask = controller.requestStats();
    controller.activate({ ownerId: 'owner-b', query: filters, queryKey: 'all', page: 1 });
    expect(facetSubscriptions[0].unsubscribe).toHaveBeenCalledOnce();
    facetSubscriptions[0].publish({ categories: { Stale: 9 }, complete: true });
    facetSubscriptions[1].publish({ categories: { Current: 2 }, complete: true });
    await subscriptions[1].page({ items: [card('b')], hasNext: false, cursor: null, changeTypes: [], fromCache: false, hasPendingWrites: false });
    oldStats.resolve({ ...EMPTY_LIBRARY_STATS, total: 99 });
    await statsTask;

    expect(controller.getSnapshot()).toMatchObject({
      ownerId: 'owner-b',
      facets: { Current: 2 },
      stats: { ...EMPTY_LIBRARY_STATS, total: 1, unrated: 1 },
    });
    expect(cache.writeStats).not.toHaveBeenCalledWith('owner-a', expect.anything(), expect.anything());
  });
});
