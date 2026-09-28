import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import type { CardData } from '../../types/card';

const mocks = vi.hoisted(() => ({ fetchWebWordsPage: vi.fn() }));

vi.mock('../../lib/firebase', () => ({ db: {} }));
vi.mock('./webWordsQuery', () => ({ fetchWebWordsPage: mocks.fetchWebWordsPage }));

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

const card = (id: string, language: string): CardData => ({
  id, word: id, translation: `${id}-translation`, language, createdAt: '2026-09-28T00:00:00.000Z', reviews: 0,
  source: { url: 'https://example.com/article', capturedAt: '2026-09-28T00:00:00.000Z' },
} as CardData);

afterEach(() => {
  vi.unstubAllGlobals();
  mocks.fetchWebWordsPage.mockReset();
});

it('ignores a first-page response after the owner or active target language changes', async () => {
  let resolveFirst: (value: { items: readonly CardData[]; cursor: null; hasNext: boolean }) => void = () => undefined;
  const first = new Promise<{ items: readonly CardData[]; cursor: null; hasNext: boolean }>(resolve => { resolveFirst = resolve; });
  mocks.fetchWebWordsPage
    .mockReturnValueOnce(first)
    .mockResolvedValueOnce({ items: [card('korean-card', 'ko')], cursor: null, hasNext: false });

  const captured: { current: ReturnType<typeof useWebWordsPage> | null } = { current: null };
  const root = createRoot(installMinimalReactDom());
  function Harness({ ownerId, targetLanguage }: { ownerId: string | null; targetLanguage: string | null }) {
    captured.current = useWebWordsPage({ ownerId, targetLanguage });
    return null;
  }

  await act(async () => { root.render(<Harness ownerId="owner-a" targetLanguage="en" />); });
  await act(async () => { root.render(<Harness ownerId="owner-b" targetLanguage="ko" />); });
  await act(async () => { resolveFirst({ items: [card('english-card', 'en')], cursor: null, hasNext: false }); await Promise.resolve(); });
  await act(async () => { await vi.waitFor(() => expect(captured.current?.state.status).toBe('ready')); });

  expect(mocks.fetchWebWordsPage).toHaveBeenNthCalledWith(1, expect.objectContaining({ ownerId: 'owner-a', targetLanguage: 'en' }));
  expect(mocks.fetchWebWordsPage).toHaveBeenNthCalledWith(2, expect.objectContaining({ ownerId: 'owner-b', targetLanguage: 'ko' }));
  expect(captured.current?.state.groups.flatMap(group => group.cards).map(candidate => candidate.id)).toEqual(['korean-card']);

  await act(async () => root.unmount());
});
