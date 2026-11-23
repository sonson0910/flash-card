import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useLibraryCatalogQuery, type LibraryCatalogBrowser, type LibraryCatalogTimers } from './useLibraryCatalogQuery';
import { ALL_PRACTICE_DECK_SCOPE } from '../../lib/practiceScope';

const installMinimalReactDom = () => {
  const documentLike: Record<string, unknown> = {
    nodeType: 9, activeElement: null, addEventListener: vi.fn(), removeEventListener: vi.fn(), defaultView: globalThis,
  };
  const container = {
    nodeType: 1, ownerDocument: documentLike, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    nodeName: 'DIV', tagName: 'DIV', namespaceURI: 'http://www.w3.org/1999/xhtml',
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

const pushes: string[] = [];
const browser: LibraryCatalogBrowser = {
  getCurrentUrl: () => 'https://sonflash.test/library',
  getHistoryState: () => null,
  pushState: (_state, location) => { pushes.push(location); },
  listenPopState: () => () => undefined,
};
const timers: LibraryCatalogTimers = {
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

afterEach(() => {
  vi.unstubAllGlobals();
  pushes.length = 0;
});

describe('library catalog query across owners', () => {
  const run = async (owners: Array<string | null>) => {
    const captured: { current: ReturnType<typeof useLibraryCatalogQuery> | null } = { current: null };
    let currentOwner: string | null = owners[0];
    function Harness() {
      captured.current = useLibraryCatalogQuery({ browser, timers, ownerId: currentOwner });
      return null;
    }
    const root = createRoot(installMinimalReactDom());
    await act(async () => { root.render(<Harness />); });
    await act(async () => {
      captured.current!.actions.changeSearch('privateword');
      captured.current!.actions.chooseDeck('A deck');
      captured.current!.actions.goToPage(3);
    });
    expect(captured.current!.model).toMatchObject({ search: 'privateword', deck: { kind: 'deck', name: 'A deck' }, page: 3 });
    for (const owner of owners.slice(1)) {
      currentOwner = owner;
      await act(async () => { root.render(<Harness />); });
    }
    return { captured, unmount: () => act(async () => { root.unmount(); }) };
  };
  const expectDefaults = (model: NonNullable<ReturnType<typeof useLibraryCatalogQuery>['model']>) => expect(model).toMatchObject({
    search: '', debouncedSearch: '', deck: ALL_PRACTICE_DECK_SCOPE, category: 'All', page: 1, starred: false,
  });

  it('drops the previous owner query when another owner replaces them directly', async () => {
    const { captured, unmount } = await run(['owner-a', 'owner-b']);
    try {
      expectDefaults(captured.current!.model);
      await new Promise(resolve => setTimeout(resolve, 600));
      expect(pushes).toEqual([]);
    } finally { await unmount(); }
  });

  it('drops the previous owner query when the owner signs out and another signs in', async () => {
    const { captured, unmount } = await run(['owner-a', null, 'owner-b']);
    try {
      expectDefaults(captured.current!.model);
    } finally { await unmount(); }
  });

  it('keeps the query typed before the first sign-in settles', async () => {
    const { captured, unmount } = await run([null, 'owner-a']);
    try {
      expect(captured.current!.model).toMatchObject({ search: 'privateword', page: 3 });
    } finally { await unmount(); }
  });
});
