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
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => { resolve = resolvePromise; reject = rejectPromise; });
  return { promise, resolve, reject };
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
    loadProgressEvidence: vi.fn(async () => ({})),
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
  it('loads Progress evidence only when Progress explicitly requests it', async () => {
    const { adapter, cache } = createFakes();
    const controller = createCloudLibraryPageController({ adapter, cache });
    controller.activate({ ownerId: 'owner-a', query: filters, queryKey: 'all', page: 1 });

    await controller.requestStats();
    expect(adapter.loadProgressEvidence).not.toHaveBeenCalled();

    await controller.requestProgressEvidence();
    expect(adapter.loadProgressEvidence).toHaveBeenCalledOnce();
    expect(controller.getSnapshot().stats).toEqual(expect.objectContaining({}));
  });
  it('ignores an old-language Progress response after the active course changes', async () => {
    const { adapter, cache } = createFakes();
    const en = deferred<Pick<typeof EMPTY_LIBRARY_STATS, 'dueForecast' | 'recentlyMastered'>>();
    const ko = deferred<Pick<typeof EMPTY_LIBRARY_STATS, 'dueForecast' | 'recentlyMastered'>>();
    vi.mocked(adapter.loadProgressEvidence).mockImplementation((_ownerId, language) => language === 'en' ? en.promise : ko.promise);
    const controller = createCloudLibraryPageController({ adapter, cache });
    controller.activate({ ownerId: 'owner-a', query: filters, queryKey: 'all', page: 1 });

    const enTask = controller.requestProgressEvidence('en');
    const koTask = controller.requestProgressEvidence('ko');
    en.resolve({ dueForecast: [{ date: '2026-09-28', count: 9 }] });
    ko.resolve({ dueForecast: [{ date: '2026-09-28', count: 2 }] });
    await Promise.all([enTask, koTask]);

    expect(controller.getSnapshot().stats.dueForecast).toEqual([{ date: '2026-09-28', count: 2 }]);
  });

  it('keeps current Progress evidence when a base stats request resolves later', async () => {
    const { adapter, cache } = createFakes();
    const stats = deferred<typeof EMPTY_LIBRARY_STATS>();
    const evidence = deferred<Pick<typeof EMPTY_LIBRARY_STATS, 'dueForecast' | 'recentlyMastered'>>();
    vi.mocked(adapter.loadStats).mockReturnValue(stats.promise);
    vi.mocked(adapter.loadProgressEvidence).mockReturnValue(evidence.promise);
    const controller = createCloudLibraryPageController({ adapter, cache });
    controller.activate({ ownerId: 'owner-a', query: filters, queryKey: 'all', page: 1 });

    const statsTask = controller.requestStats('en');
    const evidenceTask = controller.requestProgressEvidence('en');
    evidence.resolve({ dueForecast: [{ date: '2026-09-28', count: 3 }] });
    await evidenceTask;
    stats.resolve({ ...EMPTY_LIBRARY_STATS, total: 5 });
    await statsTask;

    expect(controller.getSnapshot().stats).toMatchObject({
      total: 5,
      dueForecast: [{ date: '2026-09-28', count: 3 }],
    });
  });

  it('does not publish old-course personal counts while a new-course read is delayed or fails', async () => {
    const { adapter, cache } = createFakes();
    const koreanStats = deferred<typeof EMPTY_LIBRARY_STATS>();
    vi.mocked(adapter.loadStats).mockImplementation((_ownerId, language) => language === 'ko'
      ? koreanStats.promise
      : Promise.resolve({ ...EMPTY_LIBRARY_STATS, total: 8, easy: 3 }));
    const controller = createCloudLibraryPageController({ adapter, cache });
    controller.activate({ ownerId: 'owner-a', query: { ...filters, targetLanguage: 'en' }, queryKey: 'all-en', page: 1 });
    await controller.requestStats('en');
    expect(controller.getSnapshot()).toMatchObject({ statsTargetLanguage: 'en', stats: { total: 8, easy: 3 } });

    controller.activate({ ownerId: 'owner-a', query: { ...filters, targetLanguage: 'ko' }, queryKey: 'all-ko', page: 1 });
    const pending = controller.requestStats('ko');
    expect(controller.getSnapshot()).toMatchObject({ stats: { total: 0, easy: 0 }, isStatsLoading: true });
    expect(controller.getSnapshot().statsTargetLanguage).toBeUndefined();

    koreanStats.reject(new Error('Cloud stats unavailable'));
    await pending;
    expect(controller.getSnapshot().statsTargetLanguage).toBeUndefined();
    expect(controller.getSnapshot()).toMatchObject({ stats: { total: 0, easy: 0 }, isStatsLoading: false });
  });

  it('writes an in-flight stats response to the language that started its request', async () => {
    const { adapter, cache } = createFakes();
    const englishStats = deferred<typeof EMPTY_LIBRARY_STATS>();
    const saved = new Map<string, ReturnType<CloudLibraryCachePort['readStats']>>();
    vi.mocked(cache.readStats).mockImplementation((_ownerId, language) => saved.get(language ?? '') ?? null);
    vi.mocked(cache.writeStats).mockImplementation((_ownerId, language, stats, cachedAt) => {
      saved.set(language ?? '', { stats, cachedAt });
    });
    vi.mocked(adapter.loadStats).mockImplementation((_ownerId, language) => language === 'en'
      ? englishStats.promise
      : Promise.resolve({ ...EMPTY_LIBRARY_STATS, total: 2 }));
    const controller = createCloudLibraryPageController({ adapter, cache });
    controller.activate({ ownerId: 'owner-a', query: { ...filters, targetLanguage: 'en' }, queryKey: 'all-en', page: 1 });
    const oldRequest = controller.requestStats('en');

    controller.activate({ ownerId: 'owner-a', query: { ...filters, targetLanguage: 'ko' }, queryKey: 'all-ko', page: 1 });
    englishStats.resolve({ ...EMPTY_LIBRARY_STATS, total: 8 });
    await oldRequest;
    expect(saved.get('en')?.stats.total).toBe(8);
    expect(saved.has('ko')).toBe(false);
    expect(controller.getSnapshot().statsTargetLanguage).toBe('en');

    await controller.requestStats('ko');
    expect(controller.getSnapshot()).toMatchObject({ statsTargetLanguage: 'ko', stats: { total: 2 } });
    expect(saved.get('ko')?.stats.total).toBe(2);
  });

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

  it('resolves a deep-linked page beyond 1 by walking the cursor chain forward with one-shot reads', async () => {
    const { adapter, cache, subscriptions } = createFakes();
    const controller = createCloudLibraryPageController({ adapter, cache });

    // A bookmark, shared URL, or restored browser history can land directly
    // on page 2+ with no cursor ever resolved for this scope in this session.
    controller.activate({ ownerId: 'owner-a', query: filters, queryKey: 'all', page: 2 });

    expect(subscriptions).toHaveLength(1);
    expect(subscriptions[0].request).toMatchObject({ ownerId: 'owner-a', pageSize: 9, cursor: null });

    await subscriptions[0].page({
      items: [card('a'), card('b')], hasNext: true, cursor: 'opaque-1',
      changeTypes: [], fromCache: false, hasPendingWrites: false,
    });

    await vi.waitFor(() => expect(subscriptions).toHaveLength(2));
    expect(subscriptions[0].unsubscribe).toHaveBeenCalledOnce();
    expect(subscriptions[1].request).toMatchObject({ ownerId: 'owner-a', pageSize: 9, cursor: 'opaque-1' });

    await subscriptions[1].page({
      items: [card('c')], hasNext: false, cursor: null,
      changeTypes: [], fromCache: false, hasPendingWrites: false,
    });

    expect(controller.getSnapshot()).toMatchObject({
      page: 2, items: [card('c')], hasNext: false, isLoading: false, cloudUnavailable: false,
    });
  });

  it('falls back instead of resolving a deep-linked page past the end of a shorter result set', async () => {
    const { adapter, cache, subscriptions } = createFakes();
    const controller = createCloudLibraryPageController({ adapter, cache });

    controller.activate({ ownerId: 'owner-a', query: filters, queryKey: 'all', page: 3 });
    await subscriptions[0].page({
      items: [card('a')], hasNext: false, cursor: null,
      changeTypes: [], fromCache: false, hasPendingWrites: false,
    });

    await vi.waitFor(() => expect(controller.getSnapshot().isLoading).toBe(false));
    expect(subscriptions).toHaveLength(1);
    expect(controller.getSnapshot()).toMatchObject({
      page: 3, items: [], hasNext: false, cloudUnavailable: true,
    });
  });

  it('publishes existing cards before a slow count refresh completes', async () => {
    const { adapter, cache, subscriptions } = createFakes();
    const count = deferred<number>();
    vi.mocked(adapter.countCards).mockReturnValue(count.promise);
    const controller = createCloudLibraryPageController({ adapter, cache });

    controller.activate({ ownerId: 'owner-a', query: filters, queryKey: 'all', page: 1 });
    const pagePublication = subscriptions[0].page({
      items: [card('existing')],
      hasNext: false,
      cursor: null,
      changeTypes: [],
      fromCache: false,
      hasPendingWrites: false,
    });
    await Promise.resolve();

    expect(controller.getSnapshot()).toMatchObject({
      items: [card('existing')],
      isLoading: false,
    });

    count.resolve(1);
    await pagePublication;
  });

  it('keeps the newest realtime page in cache when an older count resolves late', async () => {
    const { adapter, cache, subscriptions } = createFakes();
    const count = deferred<number>();
    vi.mocked(adapter.countCards).mockReturnValue(count.promise);
    const controller = createCloudLibraryPageController({ adapter, cache });

    controller.activate({ ownerId: 'owner-a', query: filters, queryKey: 'all', page: 1 });
    const initialPage = subscriptions[0].page({
      items: [card('old')], hasNext: false, cursor: null,
      changeTypes: [], fromCache: false, hasPendingWrites: false,
    });
    await Promise.resolve();
    await subscriptions[0].page({
      items: [card('new')], hasNext: false, cursor: null,
      changeTypes: ['modified'], fromCache: false, hasPendingWrites: false,
    });

    count.resolve(1);
    await initialPage;

    expect(cache.writePage).toHaveBeenLastCalledWith(expect.objectContaining({
      items: [card('new')],
    }));
  });

  it('recounts a server change that arrives while an older count is in flight', async () => {
    const { adapter, cache, subscriptions } = createFakes();
    const staleCount = deferred<number>();
    vi.mocked(adapter.countCards)
      .mockReturnValueOnce(staleCount.promise)
      .mockResolvedValueOnce(9);
    const controller = createCloudLibraryPageController({ adapter, cache });

    controller.activate({ ownerId: 'owner-a', query: filters, queryKey: 'all', page: 1 });
    const initialPage = subscriptions[0].page({
      items: [card('a'), card('b')], hasNext: true, cursor: 'cursor-1',
      changeTypes: [], fromCache: false, hasPendingWrites: false,
    });
    await vi.waitFor(() => expect(adapter.countCards).toHaveBeenCalledOnce());
    await subscriptions[0].page({
      items: [card('a')], hasNext: true, cursor: 'cursor-2',
      changeTypes: ['removed'], fromCache: false, hasPendingWrites: false,
    });

    staleCount.resolve(10);
    await initialPage;

    expect(adapter.countCards).toHaveBeenCalledTimes(2);
    expect(controller.getSnapshot()).toMatchObject({ items: [card('a')], total: 9 });
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
    await Promise.resolve();
    const oldPageWrites = vi.mocked(cache.writePage).mock.calls
      .filter(([value]) => value.queryKey === 'old').length;
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
    expect(vi.mocked(cache.writePage).mock.calls.filter(([value]) => value.queryKey === 'old'))
      .toHaveLength(oldPageWrites);
  });

  it('uses bounded cached fallback on failure and derives facets only when no facet cache exists', async () => {
    const { adapter, cache, subscriptions } = createFakes();
    vi.mocked(cache.readPage).mockResolvedValue({ items: [card('cached', 'Travel')], total: 1, hasNext: false });
    const controller = createCloudLibraryPageController({ adapter, cache });

    controller.activate({ ownerId: 'owner-a', query: filters, queryKey: 'all', page: 1 });
    await subscriptions[0].error(new Error('network unavailable'));

    expect(controller.getSnapshot()).toMatchObject({
      items: [card('cached', 'Travel')], total: 1, cloudUnavailable: true,
      facets: { Travel: 1 }, facetsComplete: false, isLoading: false, error: null,
    });
  });

  it('keeps the last successful page but marks it stale when its realtime listener dies', async () => {
    const { adapter, cache, subscriptions } = createFakes();
    const controller = createCloudLibraryPageController({ adapter, cache });

    controller.activate({ ownerId: 'owner-a', query: filters, queryKey: 'all', page: 1 });
    await subscriptions[0].page({
      items: [card('live')], hasNext: true, cursor: 'cursor-1',
      changeTypes: [], fromCache: false, hasPendingWrites: false,
    });

    await subscriptions[0].error(new Error('listener disconnected'));

    expect(controller.getSnapshot()).toMatchObject({
      items: [card('live')],
      hasNext: true,
      isLoading: false,
      cloudUnavailable: true,
      error: null,
    });
  });

  it('subscribes again after a refreshed activation clears cloud backoff', async () => {
    const { adapter, cache, subscriptions } = createFakes();
    vi.mocked(cache.isBackoffActive)
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(true)
      .mockReturnValue(false);
    const controller = createCloudLibraryPageController({ adapter, cache });
    const request = { ownerId: 'owner-a', query: filters, queryKey: 'all', page: 1 };

    controller.activate(request);
    await vi.waitFor(() => expect(controller.getSnapshot().isLoading).toBe(false));
    expect(subscriptions).toHaveLength(0);

    controller.activate(request);

    expect(subscriptions).toHaveLength(1);
    expect(subscriptions[0].request).toMatchObject({ ownerId: 'owner-a', cursor: null });
  });

  it('does not recount modified/cache/pending snapshots but recounts a server add or remove', async () => {
    const { adapter, cache, subscriptions } = createFakes();
    let statsCache: ReturnType<CloudLibraryCachePort['readStats']> = {
      stats: { ...EMPTY_LIBRARY_STATS, total: 5, unrated: 4 },
      cachedAt: -100_000_000,
    };
    vi.mocked(cache.readStats).mockImplementation(() => statsCache);
    vi.mocked(cache.writeStats).mockImplementation((_ownerId, _targetLanguage, stats, cachedAt) => {
      statsCache = { stats, cachedAt };
    });
    vi.mocked(adapter.loadStats).mockResolvedValue({
      ...EMPTY_LIBRARY_STATS,
      total: 1,
      reviewed: 1,
    });
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

    vi.mocked(adapter.countCards).mockResolvedValue(1);
    await subscriptions[0].page({ items: [card('a')], hasNext: false, cursor: null, changeTypes: ['removed'], fromCache: false, hasPendingWrites: false });
    expect(adapter.countCards).toHaveBeenCalledTimes(2);
    expect(controller.getSnapshot().total).toBe(1);
    expect(controller.getSnapshot().stats.total).toBe(1);
    expect(controller.getSnapshot().stats.unrated).toBe(4);
    expect(cache.writeStats).toHaveBeenLastCalledWith(
      'owner-a',
      null,
      expect.objectContaining({ total: 1 }),
      -100_000_000,
    );

    await controller.requestStats();
    expect(adapter.loadStats).toHaveBeenCalledOnce();
    expect(controller.getSnapshot().stats.reviewed).toBe(1);
  });

  it('does not fabricate a full stats cache from a count when no stats cache exists', async () => {
    const { adapter, cache, subscriptions } = createFakes();
    let statsCache: ReturnType<CloudLibraryCachePort['readStats']> = null;
    vi.mocked(cache.readStats).mockImplementation(() => statsCache);
    vi.mocked(cache.writeStats).mockImplementation((_ownerId, _targetLanguage, stats, cachedAt) => {
      statsCache = { stats, cachedAt };
    });
    vi.mocked(adapter.countCards).mockResolvedValue(2);
    vi.mocked(adapter.loadStats).mockResolvedValue({
      ...EMPTY_LIBRARY_STATS,
      total: 2,
      reviewed: 1,
    });
    const controller = createCloudLibraryPageController({ adapter, cache, now: () => 1_000 });

    controller.activate({ ownerId: 'owner-a', query: filters, queryKey: 'all', page: 1 });
    await subscriptions[0].page({
      items: [card('a'), card('b')],
      hasNext: false,
      cursor: null,
      changeTypes: [],
      fromCache: false,
      hasPendingWrites: false,
    });

    expect(controller.getSnapshot().stats.total).toBe(2);
    expect(cache.writeStats).not.toHaveBeenCalled();

    await controller.requestStats();

    expect(adapter.loadStats).toHaveBeenCalledOnce();
    expect(cache.writeStats).toHaveBeenCalledWith(
      'owner-a',
      null,
      expect.objectContaining({ total: 2, reviewed: 1 }),
      1_000,
    );
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
      stats: { ...EMPTY_LIBRARY_STATS, total: 1 },
    });
    expect(cache.writeStats).not.toHaveBeenCalledWith('owner-a', null, expect.anything(), expect.anything());
  });

  it('keeps the route usable when every browser-backed cache operation is denied', async () => {
    const { adapter, cache, subscriptions, facetSubscriptions } = createFakes();
    const denied = () => { throw new DOMException('Access denied', 'SecurityError'); };
    vi.mocked(cache.readCount).mockImplementation(denied);
    vi.mocked(cache.readStats).mockImplementation(denied);
    vi.mocked(cache.readFacets).mockImplementation(denied);
    vi.mocked(cache.writePage).mockImplementation(async () => denied());
    vi.mocked(cache.writeStats).mockImplementation(denied);
    vi.mocked(cache.writeFacets).mockImplementation(denied);
    vi.mocked(cache.isBackoffActive).mockImplementation(denied);
    vi.mocked(cache.markBackoff).mockImplementation(denied);
    vi.mocked(adapter.loadStats).mockResolvedValue({ ...EMPTY_LIBRARY_STATS, total: 1 });
    const controller = createCloudLibraryPageController({ adapter, cache });

    expect(() => controller.activate({ ownerId: 'owner-a', query: filters, queryKey: 'all', page: 1 }))
      .not.toThrow();
    await expect(subscriptions[0].page({
      items: [card('safe')], hasNext: false, cursor: null,
      changeTypes: [], fromCache: false, hasPendingWrites: false,
    })).resolves.toBeUndefined();
    expect(() => facetSubscriptions[0].publish({ categories: { Safe: 1 }, complete: true }))
      .not.toThrow();
    await expect(controller.requestStats()).resolves.toBeUndefined();

    expect(controller.getSnapshot()).toMatchObject({
      ownerId: 'owner-a',
      items: [card('safe')],
      isLoading: false,
      facets: { Safe: 1 },
      stats: { ...EMPTY_LIBRARY_STATS, total: 1 },
    });
  });
});
