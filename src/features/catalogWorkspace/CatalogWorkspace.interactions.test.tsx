import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { i18n } from '@lingui/core';
import type { HydratedCatalogEntry } from '../catalogCache/catalogCache';
import type { CatalogScreenActions, CatalogScreenModel } from './catalogPresentation';

const hooks = vi.hoisted(() => ({
  cursor: 0,
  states: [] as unknown[],
  refs: [] as Array<{ current: unknown }>,
  cleanups: [] as Array<() => void>,
  runEffects: false,
  rendered: null as { model: CatalogScreenModel; actions: CatalogScreenActions } | null,
}));
const workspaceService = vi.hoisted(() => ({
  readUnit: vi.fn(),
  invalidate: vi.fn(),
  readPage: vi.fn(),
  inspect: vi.fn(),
  summarize: vi.fn(),
  download: vi.fn(),
}));

vi.mock('react', async importOriginal => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useState: <T,>(initial: T | (() => T)) => {
      const index = hooks.cursor++;
      if (!(index in hooks.states)) hooks.states[index] = index === 3
        ? true
        : typeof initial === 'function' ? (initial as () => T)() : initial;
      return [hooks.states[index] as T, (value: T | ((current: T) => T)) => {
        const current = hooks.states[index] as T;
        hooks.states[index] = typeof value === 'function' ? (value as (current: T) => T)(current) : value;
      }] as const;
    },
    useRef: <T,>(initial: T) => {
      const index = hooks.cursor++;
      if (!hooks.refs[index]) hooks.refs[index] = { current: initial };
      return hooks.refs[index] as { current: T };
    },
    useMemo: <T,>(create: () => T) => create(),
    useCallback: <T,>(callback: T) => callback,
    useEffect: (effect: () => void | (() => void)) => {
      if (!hooks.runEffects) return;
      const cleanup = effect();
      if (cleanup) hooks.cleanups.push(cleanup);
    },
    useLayoutEffect: () => undefined,
  };
});

vi.mock('../../i18n/I18nProvider', () => ({ useUiLocale: () => 'en' }));
vi.mock('../settings/dailyPacePreference', () => ({ readDailyPaceForEta: () => null }));
vi.mock('./CatalogScreen', () => ({
  CatalogScreen: (props: { model: CatalogScreenModel; actions: CatalogScreenActions }) => {
    hooks.rendered = props;
    return null;
  },
}));
vi.mock('./catalogWorkspaceService', () => ({
  createCatalogWorkspaceService: () => workspaceService,
}));
vi.mock('./catalogProgressProjectionService', async importOriginal => {
  const actual = await importOriginal<typeof import('./catalogProgressProjectionService')>();
  return {
    ...actual,
    projectCatalogPathUnits: () => [
      { unit: { unitId: 'unit-1', trackId: 'ielts', tier: 'foundation', ordinal: 1, titles: [], total: 1, started: 0, mastered: 0, preview: [] }, introduced: 0, mastered: 0, status: 'active' },
      { unit: { unitId: 'unit-2', trackId: 'ielts', tier: 'foundation', ordinal: 2, titles: [], total: 1, started: 0, mastered: 0, preview: [] }, introduced: 0, mastered: 0, status: 'not-started' },
    ],
  };
});
import CatalogWorkspace from './CatalogWorkspace';

i18n.load('en', {});
i18n.activate('en');

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  return { promise: new Promise<T>(finish => { resolve = finish; }), resolve };
};

const baseProps = {
  ownerId: 'owner-1', targetLanguage: 'en', verifiedLibraryEpoch: 1,
  continueCatalogUnit: vi.fn(),
};

const render = (overrides: Partial<Parameters<typeof CatalogWorkspace>[0]> = {}) => {
  hooks.cursor = 0;
  const tree = CatalogWorkspace({ ...baseProps, ...overrides }) as unknown as { type: (props: { model: CatalogScreenModel; actions: CatalogScreenActions }) => unknown; props: { model: CatalogScreenModel; actions: CatalogScreenActions } };
  tree.type(tree.props);
  if (!hooks.rendered) throw new Error('Catalog workspace was not rendered.');
  return hooks.rendered;
};

const catalogEntry = {
  membership: {
    membershipId: 'membership-1', lexemeId: 'lexeme-1', language: 'en', trackId: 'ielts',
    tier: 'foundation', cefrLevel: 'A1', topic: 'basics', partOfSpeech: 'noun', skills: ['reading'],
    rank: 1, normalizedLemma: 'learn', lemma: 'Learn',
  },
  lexeme: {
    id: 'lexeme-1', lemma: 'Learn', normalizedLemma: 'learn', language: 'en', senseKey: 'learn-1',
    phonetics: [], partOfSpeech: 'noun', definitions: [{ language: 'en', text: 'Gain knowledge.' }],
    examples: [], collocations: [],
    provenance: { source: 'Editorial', license: 'CC BY 4.0', reviewer: 'Reviewer' },
  },
} as unknown as HydratedCatalogEntry;

const seedCatalogPage = () => {
  hooks.states[2] = {
    release: {
      catalogId: 'english-core', releaseId: 'release-1', schemaVersion: 2, contentLanguage: 'en',
      chunkCount: 1, membershipCount: 1, encodedBytes: 1,
    },
    scannedMemberships: 1,
    tracks: [],
  };
  hooks.states[4] = [catalogEntry];
};

const installBrowserGlobals = () => {
  const replaceState = vi.fn();
  const pushState = vi.fn();
  const listeners = new Map<string, () => void>();
  vi.stubGlobal('location', { href: 'https://sonflash.test/?view=catalog', origin: 'https://sonflash.test' });
  vi.stubGlobal('history', { state: null, replaceState, pushState });
  vi.stubGlobal('addEventListener', vi.fn((type: string, listener: () => void) => listeners.set(type, listener)));
  vi.stubGlobal('removeEventListener', vi.fn((type: string) => listeners.delete(type)));
  return { listeners, replaceState, pushState };
};

beforeEach(() => {
  hooks.states = [];
  hooks.refs = [];
  hooks.cleanups = [];
  hooks.runEffects = false;
  hooks.rendered = null;
  workspaceService.readUnit.mockReset();
  workspaceService.invalidate.mockReset();
  workspaceService.readPage.mockReset().mockResolvedValue({
    status: 'current', value: { items: [], nextCursor: null, hasMore: false },
  });
  workspaceService.inspect.mockReset().mockResolvedValue({ status: 'current', value: null });
  workspaceService.summarize.mockReset();
  workspaceService.download.mockReset();
  baseProps.continueCatalogUnit.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('CatalogWorkspace Continue', () => {
  it('keeps a replacement Continue locked after a stale unit request settles', async () => {
    const oldRead = deferred<{ status: 'current'; value: null }>();
    const replacementRead = deferred<{ status: 'current'; value: null }>();
    workspaceService.readUnit.mockReturnValueOnce(oldRead.promise).mockReturnValueOnce(replacementRead.promise);

    let workspace = render();
    workspace.actions.prepareSelectedUnit();
    workspace = render();
    workspace.actions.confirmSelectedUnit();
    expect(workspaceService.readUnit).toHaveBeenCalledTimes(1);

    workspace.actions.selectPathUnit('ielts', 'unit-2');
    workspace = render();
    workspace.actions.prepareSelectedUnit();
    workspace = render();
    workspace.actions.confirmSelectedUnit();
    expect(workspaceService.readUnit).toHaveBeenCalledTimes(2);
    workspace = render();
    expect(workspace.model.pathUnitContinue?.busy).toBe(true);

    oldRead.resolve({ status: 'current', value: null });
    await Promise.resolve();
    await Promise.resolve();
    workspace = render();

    expect(baseProps.continueCatalogUnit).not.toHaveBeenCalled();
    expect(workspace.model.pathUnitContinue?.busy).toBe(true);
    workspace.actions.confirmSelectedUnit();
    expect(workspaceService.readUnit).toHaveBeenCalledTimes(2);
  });
});

describe('CatalogWorkspace inlined interactions', () => {
  it('commits only the latest search term after the debounce delay', () => {
    vi.useFakeTimers();
    const browser = installBrowserGlobals();
    const workspace = render();

    workspace.actions.changeTerm('air');
    workspace.actions.changeTerm('airport');
    vi.advanceTimersByTime(250);

    expect(browser.replaceState).toHaveBeenCalledOnce();
    expect(browser.replaceState.mock.calls[0]?.[2]).toContain('term=airport');
    expect(browser.replaceState.mock.calls[0]?.[2]).not.toContain('term=air&');
  });

  it.each(['history', 'unmount'] as const)('cancels a pending search on %s', reason => {
    vi.useFakeTimers();
    const browser = installBrowserGlobals();
    hooks.runEffects = true;
    const workspace = render();
    workspace.actions.changeTerm('stale');

    if (reason === 'history') browser.listeners.get('popstate')?.();
    else hooks.cleanups.forEach(cleanup => cleanup());
    vi.advanceTimersByTime(250);

    expect(browser.replaceState).not.toHaveBeenCalled();
  });

  it('ignores a page that settles after the catalog query changes', async () => {
    const latePage = deferred<{
      status: 'current';
      value: { items: HydratedCatalogEntry[]; nextCursor: null; hasMore: false };
    }>();
    workspaceService.readPage.mockReturnValueOnce(latePage.promise);
    seedCatalogPage();
    hooks.states[5] = 'cursor-1';

    let workspace = render();
    workspace.actions.loadMore();
    workspace.actions.selectLanguage('ja');
    latePage.resolve({
      status: 'current', value: { items: [catalogEntry], nextCursor: null, hasMore: false },
    });
    await Promise.resolve();
    await Promise.resolve();
    workspace = render();

    expect(workspaceService.readPage).toHaveBeenCalledOnce();
    expect(workspace.model.cards).toHaveLength(1);
  });

  it('settles a successful optimistic library addition as added', async () => {
    const adoption = deferred<{
      status: 'completed'; candidateCount: number; createdCount: number; reusedCount: number; cards: [];
    }>();
    const adoptCards = vi.fn(() => adoption.promise);
    seedCatalogPage();

    let workspace = render({ adoptCards });
    workspace.actions.addToLibrary('lexeme-1');
    workspace = render({ adoptCards });
    expect(workspace.model.cards[0]?.libraryState).toBe('adding');

    adoption.resolve({ status: 'completed', candidateCount: 1, createdCount: 1, reusedCount: 0, cards: [] });
    await vi.waitFor(() => {
      workspace = render({ adoptCards });
      expect(workspace.model.cards[0]?.libraryState).toBe('added');
    });
  });

  it('does not settle an optimistic addition into a replacement owner scope', async () => {
    const adoption = deferred<{
      status: 'completed'; candidateCount: number; createdCount: number; reusedCount: number; cards: [];
    }>();
    const adoptCards = vi.fn(() => adoption.promise);
    const notify = vi.fn();
    seedCatalogPage();

    let workspace = render({ adoptCards, notify });
    workspace.actions.addToLibrary('lexeme-1');
    workspace = render({ ownerId: 'owner-2', adoptCards, notify });
    expect(workspace.model.cards[0]?.libraryState).toBe('available');

    adoption.resolve({ status: 'completed', candidateCount: 1, createdCount: 1, reusedCount: 0, cards: [] });
    await vi.waitFor(() => expect(notify).toHaveBeenCalledOnce());
    await Promise.resolve();
    workspace = render({ ownerId: 'owner-2', adoptCards, notify });

    expect(workspace.model.cards[0]?.libraryState).toBe('available');
  });
});
