import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { activateCatalogLocale, loadCatalog, setActiveUiLocale } from '../../i18n/loadCatalog';
import type { CardData } from '../../types/card';
import { useLibraryExport } from './useLibraryExport';

vi.mock('@e965/xlsx/dist/xlsx.mini.min', () => {
  const xlsx = {
    utils: { json_to_sheet: () => ({}), book_new: () => ({}), book_append_sheet: () => undefined },
    writeFile: () => undefined,
  };
  return { ...xlsx, default: xlsx };
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
  return container as unknown as Element;
};

function card(id: string): CardData {
  return { id, word: id, translation: id } as CardData;
}

type Options = Parameters<typeof useLibraryExport>[0];

beforeAll(async () => {
  setActiveUiLocale('en');
  await loadCatalog('en', 'library');
  activateCatalogLocale('en');
});

describe('useLibraryExport', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  async function setup() {
    let release!: (cards: readonly CardData[]) => void;
    const loadAllCards = vi.fn(() => new Promise<readonly CardData[]>(resolve => { release = resolve; }));
    const reportError = vi.fn();
    const notify = vi.fn();
    const base: Options = { ownerId: 'owner-a', cards: [card('a')], minimumExpectedCards: 1, loadAllCards, countAllCards: async () => 1, reportError, notify };
    let exportLibrary!: () => Promise<void>;
    function Harness(props: Options) {
      exportLibrary = useLibraryExport(props).exportLibrary;
      return null;
    }
    const root = createRoot(installMinimalReactDom());
    await act(async () => { root.render(<Harness {...base} />); });
    const rerender = (next: Partial<Options>) => act(async () => { root.render(<Harness {...base} {...next} />); });
    const start = () => {
      vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', false);
      return exportLibrary();
    };
    // The all-course count is read first, so the card read starts a moment after the export does.
    const releaseCards = async (cards: readonly CardData[]) => {
      await vi.waitFor(() => expect(loadAllCards).toHaveBeenCalled());
      release(cards);
    };
    return { start, rerender, release: releaseCards, reportError, notify, root };
  }

  it('completes when only the visible cards array is republished during the export', async () => {
    const { start, rerender, release, reportError, notify, root } = await setup();
    const pending = start();
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    await rerender({ cards: [card('a')] });
    await release([card('a'), card('b')]);
    await pending;
    expect(reportError).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith(expect.stringContaining('Exported 2 cards'));
    await act(async () => { root.unmount(); });
  });

  it('still reports a stale export when the signed-in owner changes', async () => {
    const { start, rerender, release, reportError, notify, root } = await setup();
    const pending = start();
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    await rerender({ ownerId: 'owner-b' });
    await release([card('a')]);
    await pending;
    expect(notify).not.toHaveBeenCalled();
    expect(reportError).toHaveBeenCalledTimes(1);
    await act(async () => { root.unmount(); });
  });
});
