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

it('uses the active owner and course language pair, ignoring a retired request result', async () => {
  let resolveFirst: (value: { items: readonly unknown[]; scannedCount: number }) => void = () => undefined;
  let resolveSecond: (value: { items: readonly unknown[]; scannedCount: number }) => void = () => undefined;
  const first = new Promise<{ items: readonly unknown[]; scannedCount: number }>(resolve => { resolveFirst = resolve; });
  const second = new Promise<{ items: readonly unknown[]; scannedCount: number }>(resolve => { resolveSecond = resolve; });
  mocks.fetchWebWordsPage.mockReturnValueOnce(first).mockReturnValueOnce(second);

  const captured: { current: ReturnType<typeof useWebWordsPreviewCount> | null } = { current: null };
  const root = createRoot(installMinimalReactDom());
  function Harness({ ownerId, targetLanguage, translationLanguage }: { ownerId: string | null; targetLanguage: string | null; translationLanguage: string | null }) {
    captured.current = useWebWordsPreviewCount(ownerId, targetLanguage, translationLanguage);
    return null;
  }

  await act(async () => { root.render(<Harness ownerId="owner-a" targetLanguage="en" translationLanguage="vi" />); });
  await act(async () => { root.render(<Harness ownerId="owner-a" targetLanguage="en" translationLanguage="en" />); });
  await act(async () => { resolveFirst({ items: [{ id: 'english-card' }], scannedCount: 1 }); await Promise.resolve(); });

  expect(mocks.fetchWebWordsPage).toHaveBeenNthCalledWith(1, expect.objectContaining({
    ownerId: 'owner-a', targetLanguage: 'en', translationLanguage: 'vi', pageSize: STRIP_PREVIEW_COUNT, detectHasNext: false,
  }));
  expect(mocks.fetchWebWordsPage).toHaveBeenNthCalledWith(2, expect.objectContaining({
    ownerId: 'owner-a', targetLanguage: 'en', translationLanguage: 'en', pageSize: STRIP_PREVIEW_COUNT, detectHasNext: false,
  }));
  expect(captured.current).toEqual({ count: 0, isAtCap: false });

  await act(async () => { resolveSecond({ items: [{ id: 'korean-card' }], scannedCount: STRIP_PREVIEW_COUNT }); await Promise.resolve(); });
  await act(async () => { await vi.waitFor(() => expect(captured.current).toEqual({ count: 1, isAtCap: true })); });
  await act(async () => root.unmount());
});
