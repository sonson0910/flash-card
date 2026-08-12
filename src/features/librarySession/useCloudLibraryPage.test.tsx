import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import type { CardQueryState } from '../../lib/cardQuery';
import type { CardData } from '../../types/card';

vi.mock('../../lib/firebase', () => ({ db: null, isFirebaseConfigured: false }));
vi.mock('../../lib/deviceSync', async () => {
  const actual = await vi.importActual<typeof import('../../lib/deviceSync')>('../../lib/deviceSync');
  return { ...actual, loadDevicePending: vi.fn(async () => []) };
});
vi.mock('./cloudLibraryPageFirebaseAdapter', () => ({
  createCloudLibraryPageFirebaseAdapter: () => ({
    available: false,
    subscribePage: vi.fn(() => vi.fn()),
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
  customDeck: null,
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
  vi.unstubAllGlobals();
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
