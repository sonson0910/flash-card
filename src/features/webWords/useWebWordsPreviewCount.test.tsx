import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ fetchWebWordsPage: vi.fn() }));

vi.mock('../../lib/firebase', () => ({ db: {} }));
vi.mock('./webWordsQuery', () => ({ fetchWebWordsPage: mocks.fetchWebWordsPage }));

import { STRIP_PREVIEW_COUNT, useWebWordsPreviewCount } from './useWebWordsPreviewCount';

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

afterEach(() => {
  vi.unstubAllGlobals();
  mocks.fetchWebWordsPage.mockReset();
});

it('uses the active owner and course language, ignoring a retired request result', async () => {
  let resolveFirst: (value: { items: readonly unknown[] }) => void = () => undefined;
  let resolveSecond: (value: { items: readonly unknown[] }) => void = () => undefined;
  const first = new Promise<{ items: readonly unknown[] }>(resolve => { resolveFirst = resolve; });
  const second = new Promise<{ items: readonly unknown[] }>(resolve => { resolveSecond = resolve; });
  mocks.fetchWebWordsPage.mockReturnValueOnce(first).mockReturnValueOnce(second);

  const captured: { current: number | null } = { current: null };
  const root = createRoot(installMinimalReactDom());
  function Harness({ ownerId, targetLanguage }: { ownerId: string | null; targetLanguage: string | null }) {
    captured.current = useWebWordsPreviewCount(ownerId, targetLanguage);
    return null;
  }

  await act(async () => { root.render(<Harness ownerId="owner-a" targetLanguage="en" />); });
  await act(async () => { root.render(<Harness ownerId="owner-b" targetLanguage="ko" />); });
  await act(async () => { resolveFirst({ items: [{ id: 'english-card' }] }); await Promise.resolve(); });

  expect(mocks.fetchWebWordsPage).toHaveBeenNthCalledWith(1, expect.objectContaining({
    ownerId: 'owner-a', targetLanguage: 'en', pageSize: STRIP_PREVIEW_COUNT, detectHasNext: false,
  }));
  expect(mocks.fetchWebWordsPage).toHaveBeenNthCalledWith(2, expect.objectContaining({
    ownerId: 'owner-b', targetLanguage: 'ko', pageSize: STRIP_PREVIEW_COUNT, detectHasNext: false,
  }));
  expect(captured.current).toBe(0);

  await act(async () => { resolveSecond({ items: [{ id: 'korean-card' }] }); await Promise.resolve(); });
  await act(async () => { await vi.waitFor(() => expect(captured.current).toBe(1)); });
  await act(async () => root.unmount());
});
