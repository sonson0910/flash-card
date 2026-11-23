import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { activateCatalogLocale, loadCatalog, setActiveUiLocale } from '../../i18n/loadCatalog';
import type { CardData } from '../../types/card';
import { useLibraryExport } from './useLibraryExport';

const xlsx = vi.hoisted(() => ({
  utils: { json_to_sheet: vi.fn(() => ({})), book_new: vi.fn(() => ({})), book_append_sheet: vi.fn() },
  writeFile: vi.fn(),
}));
vi.mock('@e965/xlsx/dist/xlsx.mini.min', () => ({ default: xlsx, ...xlsx }));

beforeAll(async () => {
  setActiveUiLocale('en');
  await loadCatalog('en', 'library');
  activateCatalogLocale('en');
});

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
  vi.stubGlobal('self', globalThis);
  vi.stubGlobal('top', globalThis);
  vi.stubGlobal('document', documentLike);
  vi.stubGlobal('HTMLIFrameElement', class HTMLIFrameElement {});
  vi.stubGlobal('HTMLElement', class HTMLElement {});
  vi.stubGlobal('Node', class Node {});
  return container as unknown as Element;
};

const card = (id: string, language: string) => ({ id, word: id, language }) as unknown as CardData;
const activeCourseCards = [card('a1', 'en'), card('a2', 'en')];
const allCourseCards = [...activeCourseCards, card('k1', 'ko'), card('j1', 'ja')];

interface SetupOptions {
  loaded: readonly CardData[] | null;
  countAllCards: (ownerId: string) => Promise<number>;
}

let root: Root;

async function setup({ loaded, countAllCards }: SetupOptions) {
  const reportError = vi.fn();
  const notify = vi.fn();
  const countSpy = vi.fn(countAllCards);
  let exportLibrary!: () => Promise<void>;
  const Probe = () => {
    ({ exportLibrary } = useLibraryExport({
      ownerId: 'owner-1',
      cards: activeCourseCards,
      minimumExpectedCards: activeCourseCards.length,
      loadAllCards: async () => loaded,
      countAllCards: countSpy,
      reportError,
      notify,
    }));
    return null;
  };
  await act(async () => { root.render(<Probe />); });
  const run = async () => { await act(async () => { await exportLibrary(); }); };
  return { run, reportError, notify, countSpy };
}

describe('library export across courses', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    root = createRoot(installMinimalReactDom());
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  });

  it('refuses a file that holds fewer cards than the owner has in all courses', async () => {
    const { run, reportError, notify } = await setup({
      loaded: [...activeCourseCards, card('k1', 'ko')],
      countAllCards: async () => allCourseCards.length,
    });

    await run();

    expect(reportError).toHaveBeenCalledWith(expect.stringContaining('complete library'));
    expect(notify).not.toHaveBeenCalled();
    expect(xlsx.writeFile).not.toHaveBeenCalled();
  });

  it('downloads once every course was read and the notice says all courses are included', async () => {
    const { run, reportError, notify, countSpy } = await setup({
      loaded: allCourseCards,
      countAllCards: async () => allCourseCards.length,
    });

    await run();

    expect(countSpy).toHaveBeenCalledWith('owner-1');
    expect(reportError).not.toHaveBeenCalled();
    expect(xlsx.writeFile).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith('Exported 4 cards from all your courses.');
  });

  it('refuses to download when the all-course count cannot be read', async () => {
    const { run, reportError } = await setup({
      loaded: allCourseCards,
      countAllCards: async () => { throw new Error('offline'); },
    });

    await run();

    expect(reportError).toHaveBeenCalledTimes(1);
    expect(xlsx.writeFile).not.toHaveBeenCalled();
  });
});
