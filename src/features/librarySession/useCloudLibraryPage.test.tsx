import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import type { CardQueryState } from '../../lib/cardQuery';
import type { DevicePendingOperation } from '../../lib/deviceSync';
import type { CardData } from '../../types/card';
import { ALL_PRACTICE_DECK_SCOPE } from '../../lib/practiceScope';
import type { CloudLibraryPageAdapter } from './cloudLibraryPageController';

const deviceSyncMocks = vi.hoisted(() => ({
  loadDevicePending: vi.fn<() => Promise<DevicePendingOperation[]>>(async () => []),
}));
const cloudMocks = vi.hoisted(() => ({
  available: false,
  subscribePage: vi.fn<CloudLibraryPageAdapter['subscribePage']>(() => vi.fn()),
}));

vi.mock('../../lib/firebase', () => ({ db: null, isFirebaseConfigured: false }));
vi.mock('../../lib/deviceSync', async () => {
  const actual = await vi.importActual<typeof import('../../lib/deviceSync')>('../../lib/deviceSync');
  return { ...actual, loadDevicePending: deviceSyncMocks.loadDevicePending };
});
vi.mock('./cloudLibraryPageFirebaseAdapter', () => ({
  createCloudLibraryPageFirebaseAdapter: () => ({
    get available() { return cloudMocks.available; },
    subscribePage: cloudMocks.subscribePage,
    countCards: vi.fn(async () => 0),
    loadStats: vi.fn(async () => ({
      total: 0, reviewed: 0, easy: 0, good: 0, hard: 0,
      unrated: 0, bookmarked: 0, due: 0, legacyUnindexed: 0,
    })),
    subscribeFacets: vi.fn(() => vi.fn()),
  }),
}));

import { useCloudLibraryPage } from './useCloudLibraryPage';

const query: CardQueryState = {
  category: null,
    customDeck: ALL_PRACTICE_DECK_SCOPE,
  difficulty: null,
  partOfSpeech: null,
  bookmarkedOnly: false,
  createdDate: null,
  wordPrefix: '',
};

const card = (id: string): CardData => ({
  id,
  word: id,
  normalizedWord: id,
  translation: `${id}-vi`,
  explanation: '',
  phonetic: '',
  emoji: '📝',
  category: 'General',
  audioUrl: null,
  imageUrl: null,
});

const installMinimalReactDom = () => {
  const documentLike: Record<string, unknown> = {
    nodeType: 9,
    activeElement: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    defaultView: globalThis,
  };
  const container = {
    nodeType: 1,
    ownerDocument: documentLike,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    nodeName: 'DIV',
    tagName: 'DIV',
    namespaceURI: 'http://www.w3.org/1999/xhtml',
  };
  documentLike.documentElement = container;
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('window', globalThis);
  vi.stubGlobal('document', documentLike);
  vi.stubGlobal('HTMLIFrameElement', class HTMLIFrameElement {});
  vi.stubGlobal('HTMLElement', class HTMLElement {});
  vi.stubGlobal('Node', class Node {});
  vi.stubGlobal('addEventListener', vi.fn());
  vi.stubGlobal('removeEventListener', vi.fn());
  return container as unknown as Element;
};

afterEach(() => {
  vi.useRealTimers();
  cloudMocks.available = false;
  cloudMocks.subscribePage.mockReset();
  cloudMocks.subscribePage.mockImplementation(() => vi.fn());
  deviceSyncMocks.loadDevicePending.mockReset();
  deviceSyncMocks.loadDevicePending.mockResolvedValue([]);
  vi.unstubAllGlobals();
});

it('retries a paused read without pending writes, respecting backoff and unmount', async () => {
  vi.useFakeTimers();
  const container = installMinimalReactDom();
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
  const fallback = vi.fn(async () => ({ items: [card('cached')], total: 1, hasNext: false }));
  cloudMocks.available = true;
  cloudMocks.subscribePage.mockImplementation((_request, onPage, onError) => {
    if (cloudMocks.subscribePage.mock.calls.length === 1) void onError({ code: 'unavailable' });
    else void onPage({ items: [card('cloud')], hasNext: false, cursor: null,
      fromCache: false, hasPendingWrites: false, changeTypes: [] });
    return vi.fn();
  });
  let snapshot: ReturnType<typeof useCloudLibraryPage> | undefined;
  const root = createRoot(container);
  function Harness() {
    snapshot = useCloudLibraryPage({ ownerId: 'user-a', query, queryKey: 'all', page: 1, pageSize: 9,
      refreshKey: 0, statsOpen: false, getDeviceFallback: fallback, getPromotedCards: () => [] });
    return null;
  }
  await act(async () => root.render(<Harness />));
  expect(snapshot?.cloudUnavailable).toBe(true);
  values.set('lingoflash_cloud_backoff_until_user-a', String(Date.now() + 60_000));
  await act(async () => vi.advanceTimersByTimeAsync(30_000));
  expect(cloudMocks.subscribePage).toHaveBeenCalledTimes(1);
  await act(async () => vi.advanceTimersByTimeAsync(30_000));
  expect(cloudMocks.subscribePage).toHaveBeenCalledTimes(2);
  expect(snapshot?.cloudUnavailable).toBe(false);
  expect(snapshot?.items.map(item => item.id)).toEqual(['cloud']);
  await act(async () => vi.advanceTimersByTimeAsync(60_000));
  expect(cloudMocks.subscribePage).toHaveBeenCalledTimes(2);
  await act(async () => root.unmount());
  const calls = fallback.mock.calls.length;
  await vi.advanceTimersByTimeAsync(60_000);
  expect(fallback).toHaveBeenCalledTimes(calls);
});

it('overlays a promoted duplicate onto a paused-cloud fallback without requiring reload', async () => {
  const cachedPage = Array.from({ length: 9 }, (_, index) => card(`cached-${index + 1}`));
  const promoted = { ...card('existing-hidden'), sortTouchedAt: '2026-08-12T00:00:00.000Z' };
  const captured: { current: ReturnType<typeof useCloudLibraryPage> | null } = { current: null };
  const container = installMinimalReactDom();
  const root = createRoot(container);

  function Harness() {
    captured.current = useCloudLibraryPage({
      ownerId: 'user-a',
      query,
      queryKey: 'all',
      page: 1,
      pageSize: 9,
      refreshKey: 0,
      statsOpen: false,
      getDeviceFallback: async () => ({ items: cachedPage, total: 10, hasNext: true }),
      getPromotedCards: () => [promoted],
    });
    return null;
  }

  await act(async () => { root.render(<Harness />); });
  await act(async () => {
    await vi.waitFor(() => expect(captured.current?.isLoading).toBe(false));
  });

  expect(captured.current?.items).toHaveLength(9);
  expect(captured.current?.items[0]?.id).toBe(promoted.id);
  expect(captured.current?.items.some(candidate => candidate.id === promoted.id)).toBe(true);

  await act(async () => root.unmount());
});

it('keeps a locally deleted promoted card hidden while the cloud page is stale', async () => {
  const deleted = { ...card('recently-promoted'), sortTouchedAt: '2026-08-12T00:00:00.000Z' };
  deviceSyncMocks.loadDevicePending.mockResolvedValue([{
    type: 'delete',
    cardId: deleted.id,
    ownerUserId: 'user-a',
    updatedAt: '2026-08-12T00:01:00.000Z',
  }]);
  const captured: { current: ReturnType<typeof useCloudLibraryPage> | null } = { current: null };
  const container = installMinimalReactDom();
  const root = createRoot(container);

  function Harness() {
    captured.current = useCloudLibraryPage({
      ownerId: 'user-a',
      query,
      queryKey: 'all',
      page: 1,
      pageSize: 9,
      refreshKey: 0,
      statsOpen: false,
      getDeviceFallback: async () => ({ items: [deleted, card('still-visible')], total: 2, hasNext: false }),
      getPromotedCards: () => [deleted],
    });
    return null;
  }

  await act(async () => { root.render(<Harness />); });
  await act(async () => {
    await vi.waitFor(() => expect(captured.current?.isLoading).toBe(false));
  });

  expect(captured.current?.items.map(candidate => candidate.id)).toEqual(['still-visible']);

  await act(async () => root.unmount());
});

it('does not restart the cloud page when only the query object identity changes', async () => {
  const getDeviceFallback = vi.fn(async () => ({
    items: [card('stable')],
    total: 1,
    hasNext: false,
  }));
  const captured: { current: ReturnType<typeof useCloudLibraryPage> | null } = { current: null };
  const container = installMinimalReactDom();
  const root = createRoot(container);

  function Harness({ filters }: { filters: CardQueryState }) {
    captured.current = useCloudLibraryPage({
      ownerId: 'user-a',
      query: filters,
      queryKey: 'all',
      page: 1,
      pageSize: 9,
      refreshKey: 0,
      statsOpen: false,
      getDeviceFallback,
      getPromotedCards: () => [],
    });
    return null;
  }

  await act(async () => { root.render(<Harness filters={query} />); });
  await act(async () => {
    await vi.waitFor(() => expect(captured.current?.isLoading).toBe(false));
  });
  expect(getDeviceFallback).toHaveBeenCalledOnce();

  await act(async () => { root.render(<Harness filters={{ ...query }} />); });
  await act(async () => { await Promise.resolve(); });

  expect(getDeviceFallback).toHaveBeenCalledOnce();
  expect(captured.current?.items.map(candidate => candidate.id)).toEqual(['stable']);

  await act(async () => root.unmount());
});
