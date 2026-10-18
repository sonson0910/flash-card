import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import type { CardData } from '../../types/card';

const mocks = vi.hoisted(() => ({ fetchWebWordsPage: vi.fn(), promoteCardsToActiveSessionNewStage: vi.fn() }));

vi.mock('../../lib/firebase', () => ({ db: {} }));
vi.mock('./webWordsQuery', () => ({ fetchWebWordsPage: mocks.fetchWebWordsPage }));
vi.mock('../dailyLearning/webWordsSessionPriority', () => ({
  promoteCardsToActiveSessionNewStage: mocks.promoteCardsToActiveSessionNewStage,
}));

import { useWebWordsPage } from './useWebWordsPage';

const installMinimalReactDom = () => {
  const documentLike: Record<string, unknown> = {
    nodeType: 9, activeElement: null, addEventListener: vi.fn(), removeEventListener: vi.fn(), defaultView: globalThis,
  };
  const container = {
    nodeType: 1, ownerDocument: documentLike, addEventListener: vi.fn(), removeEventListener: vi.fn(), nodeName: 'DIV', tagName: 'DIV', namespaceURI: 'http://www.w3.org/1999/xhtml',
  };
  documentLike.documentElement = container;
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('window', globalThis);
  vi.stubGlobal('document', documentLike);
  vi.stubGlobal('HTMLIFrameElement', class HTMLIFrameElement {});
  vi.stubGlobal('HTMLElement', class HTMLElement {});
  vi.stubGlobal('Node', class Node {});
  return container as unknown as Element;
};

const card = (id: string, language: string, translationLanguage: string | undefined = 'vi'): CardData => ({
  id, word: id, translation: `${id}-translation`, language, createdAt: '2026-09-28T00:00:00.000Z', reviews: 0,
  ...(translationLanguage ? { translationLanguage } : {}),
  source: { url: 'https://example.com/article', capturedAt: '2026-09-28T00:00:00.000Z' },
} as CardData);

afterEach(() => {
  vi.unstubAllGlobals();
  mocks.fetchWebWordsPage.mockReset();
  mocks.promoteCardsToActiveSessionNewStage.mockReset();
});

it('ignores a first-page response after the owner or active language pair changes', async () => {
  let resolveFirst: (value: { items: readonly CardData[]; cursor: null; hasNext: boolean }) => void = () => undefined;
  const first = new Promise<{ items: readonly CardData[]; cursor: null; hasNext: boolean }>(resolve => { resolveFirst = resolve; });
  mocks.fetchWebWordsPage
    .mockReturnValueOnce(first)
    .mockResolvedValueOnce({ items: [card('english-card', 'en', 'en')], cursor: null, hasNext: false });

  const captured: { current: ReturnType<typeof useWebWordsPage> | null } = { current: null };
  const root = createRoot(installMinimalReactDom());
  function Harness({ ownerId, targetLanguage, translationLanguage }: { ownerId: string | null; targetLanguage: string | null; translationLanguage: string | null }) {
    captured.current = useWebWordsPage({ ownerId, targetLanguage, translationLanguage });
    return null;
  }

  await act(async () => { root.render(<Harness ownerId="owner-a" targetLanguage="en" translationLanguage="vi" />); });
  await act(async () => { root.render(<Harness ownerId="owner-a" targetLanguage="en" translationLanguage="en" />); });
  await act(async () => { resolveFirst({ items: [card('english-card', 'en')], cursor: null, hasNext: false }); await Promise.resolve(); });
  await act(async () => { await vi.waitFor(() => expect(captured.current?.state.status).toBe('ready')); });

  expect(mocks.fetchWebWordsPage).toHaveBeenNthCalledWith(1, expect.objectContaining({ ownerId: 'owner-a', targetLanguage: 'en', translationLanguage: 'vi' }));
  expect(mocks.fetchWebWordsPage).toHaveBeenNthCalledWith(2, expect.objectContaining({ ownerId: 'owner-a', targetLanguage: 'en', translationLanguage: 'en' }));
  expect(captured.current?.state.groups.flatMap(group => group.cards).map(candidate => candidate.id)).toEqual(['english-card']);

  await act(async () => root.unmount());
});

it('only queues active-pair cards if a stale mixed result reaches Add to Today', async () => {
  mocks.fetchWebWordsPage.mockResolvedValueOnce({
    items: [card('current', 'en', 'vi'), card('other-native', 'en', 'en'), card('legacy-vietnamese', 'en', undefined)],
    cursor: null,
    hasNext: false,
  });
  mocks.promoteCardsToActiveSessionNewStage.mockReturnValue('no-active-session');

  const captured: { current: ReturnType<typeof useWebWordsPage> | null } = { current: null };
  const root = createRoot(installMinimalReactDom());
  function Harness() {
    captured.current = useWebWordsPage({ ownerId: 'owner-a', targetLanguage: 'en', translationLanguage: 'vi' });
    return null;
  }

  await act(async () => { root.render(<Harness />); });
  await act(async () => { await vi.waitFor(() => expect(captured.current?.state.status).toBe('ready')); });
  await act(async () => { captured.current?.actions.addAllFilteredToToday(); });

  expect(mocks.promoteCardsToActiveSessionNewStage).toHaveBeenCalledWith(
    'owner-a',
    expect.arrayContaining([expect.objectContaining({ id: 'current' }), expect.objectContaining({ id: 'legacy-vietnamese' })]),
    { targetLanguage: 'en', translationLanguage: 'vi' },
  );
  expect(mocks.promoteCardsToActiveSessionNewStage.mock.calls[0]?.[1].map((candidate: CardData) => candidate.id)).toEqual(['current', 'legacy-vietnamese']);

  await act(async () => root.unmount());
});

it('keeps a zero-capacity selection and reports that it was queued', async () => {
  mocks.fetchWebWordsPage.mockResolvedValueOnce({ items: [card('deferred', 'en', 'vi')], cursor: null, hasNext: false });
  mocks.promoteCardsToActiveSessionNewStage.mockReturnValue('deferred-capped');

  const captured: { current: ReturnType<typeof useWebWordsPage> | null } = { current: null };
  const root = createRoot(installMinimalReactDom());
  function Harness() {
    captured.current = useWebWordsPage({ ownerId: 'owner-a', targetLanguage: 'en', translationLanguage: 'vi' });
    return null;
  }

  await act(async () => { root.render(<Harness />); });
  await act(async () => { await vi.waitFor(() => expect(captured.current?.state.status).toBe('ready')); });
  await act(async () => { captured.current?.actions.toggleSelected('deferred'); });
  await act(async () => { captured.current?.actions.addSelectedToToday(); });

  expect(captured.current?.state.addToTodayStatus).toBe('added-capped');
  expect(captured.current?.state.selectedCardIds).toEqual(new Set(['deferred']));
  await act(async () => root.unmount());
});

it('leaves learned cards with a future review out of the new-word queue', async () => {
  mocks.fetchWebWordsPage.mockResolvedValueOnce({
    items: [{ ...card('scheduled', 'en', 'vi'), reviews: 1, difficulty: 'good', nextReviewDate: '2099-01-01T00:00:00.000Z' }],
    cursor: null,
    hasNext: false,
  });

  const captured: { current: ReturnType<typeof useWebWordsPage> | null } = { current: null };
  const root = createRoot(installMinimalReactDom());
  function Harness() {
    captured.current = useWebWordsPage({ ownerId: 'owner-a', targetLanguage: 'en', translationLanguage: 'vi' });
    return null;
  }

  await act(async () => { root.render(<Harness />); });
  await act(async () => { await vi.waitFor(() => expect(captured.current?.state.status).toBe('ready')); });
  await act(async () => { captured.current?.actions.toggleSelected('scheduled'); });
  await act(async () => { captured.current?.actions.addSelectedToToday(); });

  expect(mocks.promoteCardsToActiveSessionNewStage).not.toHaveBeenCalled();
  expect(captured.current?.state.addToTodayStatus).toBe('scheduled-normal-review');
  expect(captured.current?.state.addToTodayHasNormallyScheduledCards).toBe(true);
  await act(async () => root.unmount());
});

it('clears a selected card when the native language changes for the same owner and target', async () => {
  mocks.fetchWebWordsPage
    .mockResolvedValueOnce({ items: [card('vietnamese-meaning', 'en', 'vi')], cursor: null, hasNext: false })
    .mockResolvedValueOnce({ items: [card('english-meaning', 'en', 'en')], cursor: null, hasNext: false });

  const captured: { current: ReturnType<typeof useWebWordsPage> | null } = { current: null };
  const root = createRoot(installMinimalReactDom());
  function Harness({ translationLanguage }: { translationLanguage: string }) {
    captured.current = useWebWordsPage({ ownerId: 'owner-a', targetLanguage: 'en', translationLanguage });
    return null;
  }

  await act(async () => { root.render(<Harness translationLanguage="vi" />); });
  await act(async () => { await vi.waitFor(() => expect(captured.current?.state.status).toBe('ready')); });
  await act(async () => { captured.current?.actions.toggleSelected('vietnamese-meaning'); });
  expect(captured.current?.state.selectedCardIds).toEqual(new Set(['vietnamese-meaning']));

  await act(async () => { root.render(<Harness translationLanguage="en" />); });
  await act(async () => { await vi.waitFor(() => expect(captured.current?.state.groups.flatMap(group => group.cards).map(candidate => candidate.id)).toEqual(['english-meaning'])); });

  expect(captured.current?.state.selectedCardIds).toEqual(new Set());
  await act(async () => root.unmount());
});

it('keeps a filtered empty batch loadable, then reaches active-pair cards on the next bounded page', async () => {
  mocks.fetchWebWordsPage
    .mockResolvedValueOnce({ items: [], cursor: {} as never, hasNext: true })
    .mockResolvedValueOnce({ items: [card('current-pair', 'en', 'vi')], cursor: null, hasNext: false });

  const captured: { current: ReturnType<typeof useWebWordsPage> | null } = { current: null };
  const root = createRoot(installMinimalReactDom());
  function Harness() {
    captured.current = useWebWordsPage({ ownerId: 'owner-a', targetLanguage: 'en', translationLanguage: 'vi' });
    return null;
  }

  await act(async () => { root.render(<Harness />); });
  await act(async () => { await vi.waitFor(() => expect(captured.current?.state.status).toBe('ready')); });
  expect(captured.current?.state.groups).toEqual([]);
  expect(captured.current?.state.hasNext).toBe(true);

  await act(async () => { captured.current?.actions.loadMore(); });
  await act(async () => { await vi.waitFor(() => expect(captured.current?.state.groups.flatMap(group => group.cards).map(candidate => candidate.id)).toEqual(['current-pair'])); });
  expect(captured.current?.state.hasNext).toBe(false);

  await act(async () => root.unmount());
});

it('becomes empty once filtered batches are exhausted without an active-pair card', async () => {
  mocks.fetchWebWordsPage
    .mockResolvedValueOnce({ items: [], cursor: {} as never, hasNext: true })
    .mockResolvedValueOnce({ items: [], cursor: null, hasNext: false });

  const captured: { current: ReturnType<typeof useWebWordsPage> | null } = { current: null };
  const root = createRoot(installMinimalReactDom());
  function Harness() {
    captured.current = useWebWordsPage({ ownerId: 'owner-a', targetLanguage: 'en', translationLanguage: 'vi' });
    return null;
  }

  await act(async () => { root.render(<Harness />); });
  await act(async () => { await vi.waitFor(() => expect(captured.current?.state.status).toBe('ready')); });
  await act(async () => { captured.current?.actions.loadMore(); });
  await act(async () => { await vi.waitFor(() => expect(captured.current?.state.status).toBe('empty')); });

  await act(async () => root.unmount());
});
