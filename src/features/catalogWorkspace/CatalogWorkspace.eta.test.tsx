import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { i18n } from '@lingui/core';
import type { CatalogScreenActions, CatalogScreenModel } from './catalogPresentation';

const hooks = vi.hoisted(() => ({
  cursor: 0,
  states: [] as unknown[],
  refs: [] as Array<{ current: unknown }>,
  cleanups: [] as Array<() => void>,
  runEffects: false,
  rendered: null as { model: CatalogScreenModel; actions: CatalogScreenActions } | null,
}));
const projection = vi.hoisted(() => ({ introducedByUnit: [20] as number[] }));
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
vi.mock('../settings/dailyPacePreference', () => ({ readDailyPaceForEta: () => 5 }));
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
    projectCatalogPathUnits: () => projection.introducedByUnit.map((introduced, index) => ({
      unit: { unitId: `unit-${index + 1}`, trackId: 'ielts', tier: 'foundation', ordinal: index + 1, titles: [], total: 20, started: introduced, mastered: 12, preview: [] },
      introduced,
      mastered: 12,
      status: 'active' as const,
    })),
  };
});
import CatalogWorkspace from './CatalogWorkspace';

i18n.load('en', {});
i18n.activate('en');

beforeEach(() => { projection.introducedByUnit = [20]; hooks.states = []; hooks.refs = []; hooks.cleanups = []; hooks.runEffects = false; hooks.rendered = null; });
afterEach(() => { vi.unstubAllGlobals(); });

describe('Paths ETA for a unit whose words are all introduced but not all mastered', () => {
  const renderModel = () => {
    vi.stubGlobal('location', { href: 'https://sonflash.test/?view=catalog', origin: 'https://sonflash.test' });
    vi.stubGlobal('history', { state: null, replaceState: vi.fn(), pushState: vi.fn() });
    hooks.cursor = 0;
    const tree = CatalogWorkspace({ ownerId: 'owner-1', targetLanguage: 'en', verifiedLibraryEpoch: 1, continueCatalogUnit: vi.fn() }) as unknown as { type: (props: unknown) => unknown; props: unknown };
    tree.type(tree.props);
    return hooks.rendered!.model;
  };

  it('estimates the track from the words still to introduce across every unit', () => {
    projection.introducedByUnit = [20, 10];
    const model = renderModel();
    expect(model.pathUnitContinue?.etaDays).toBeNull();
    expect(model.pathUnitContinue?.trackEtaDays).toBe(2);
  });

  it('shows no days-left estimate for the unit or the track while only mastery remains', () => {
    vi.stubGlobal('location', { href: 'https://sonflash.test/?view=catalog', origin: 'https://sonflash.test' });
    vi.stubGlobal('history', { state: null, replaceState: vi.fn(), pushState: vi.fn() });
    hooks.cursor = 0;
    const tree = CatalogWorkspace({ ownerId: 'owner-1', targetLanguage: 'en', verifiedLibraryEpoch: 1, continueCatalogUnit: vi.fn() }) as unknown as { type: (props: unknown) => unknown; props: unknown };
    tree.type(tree.props);
    const model = hooks.rendered!.model;
    expect(model.pathUnits?.[0]?.status).toBe('active');
    expect(model.pathUnitContinue?.etaDays).toBeNull();
    expect(model.pathUnitContinue?.trackEtaDays).toBeNull();
  });
});
