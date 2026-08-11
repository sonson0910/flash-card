import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CardData } from '../../types/card';

type EffectRecord = {
  cleanup?: () => void;
  dependencies?: readonly unknown[];
};

type PendingEffect = {
  callback: () => void | (() => void);
  dependencies?: readonly unknown[];
  index: number;
};

const hookRuntime = vi.hoisted(() => ({
  effectCursor: 0,
  effects: [] as EffectRecord[],
  pendingEffects: [] as PendingEffect[],
  refCursor: 0,
  refs: [] as Array<{ current: unknown }>,
  stateCursor: 0,
  states: [] as unknown[],
}));

const dependenciesChanged = (
  previous: readonly unknown[] | undefined,
  next: readonly unknown[] | undefined,
) => previous === undefined
  || next === undefined
  || previous.length !== next.length
  || previous.some((value, index) => !Object.is(value, next[index]));

const deferred = <T,>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (cause?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
};

vi.mock('react', () => ({
  useEffect: (callback: () => void | (() => void), dependencies?: readonly unknown[]) => {
    const index = hookRuntime.effectCursor++;
    if (dependenciesChanged(hookRuntime.effects[index]?.dependencies, dependencies)) {
      hookRuntime.pendingEffects.push({ callback, dependencies, index });
    }
  },
  useMemo: <T,>(factory: () => T) => factory(),
  useRef: <T,>(initial: T) => {
    const index = hookRuntime.refCursor++;
    if (!(index in hookRuntime.refs)) hookRuntime.refs[index] = { current: initial };
    return hookRuntime.refs[index] as { current: T };
  },
  useState: <T,>(initial: T | (() => T)) => {
    const index = hookRuntime.stateCursor++;
    if (!(index in hookRuntime.states)) {
      hookRuntime.states[index] = typeof initial === 'function'
        ? (initial as () => T)()
        : initial;
    }
    const setState = (next: T | ((previous: T) => T)) => {
      const previous = hookRuntime.states[index] as T;
      hookRuntime.states[index] = typeof next === 'function'
        ? (next as (value: T) => T)(previous)
        : next;
    };
    return [hookRuntime.states[index] as T, setState] as const;
  },
}));

import {
  useCustomDeckWorkspace,
  type CustomDeckCachePort,
  type CustomDeckWorkspaceOptions,
} from './useCustomDeckWorkspace';

const flushEffects = () => {
  const pending = hookRuntime.pendingEffects.splice(0);
  pending.forEach(({ callback, dependencies, index }) => {
    hookRuntime.effects[index]?.cleanup?.();
    const cleanup = callback();
    hookRuntime.effects[index] = {
      dependencies,
      cleanup: typeof cleanup === 'function' ? cleanup : undefined,
    };
  });
};

const createWorkspaceHarness = (cards: readonly CardData[] = []) => {
  let cachedOwner: string | null = 'owner-a';
  let cachedDecks = ['Owner A private deck'];
  const cacheWrites: Array<{ ownerId: string | null; decks: string[] }> = [];
  const cache: CustomDeckCachePort = {
    read: () => ({ ownerId: cachedOwner, decks: cachedDecks }),
    write: vi.fn((ownerId, decks) => {
      cachedOwner = ownerId;
      cachedDecks = [...decks];
      cacheWrites.push({ ownerId: cachedOwner, decks: [...decks] });
    }),
  };
  const stableOptions = {
    cards,
    activeDeck: 'all',
    knownLibraryTotal: 0,
    mutations: {
      add: vi.fn(async () => undefined),
      clearAssignments: vi.fn(async () => undefined),
      removeProfile: vi.fn(async () => undefined),
    },
    cache,
    ports: {
      assignCard: vi.fn(async () => undefined),
      patchDeviceCards: vi.fn(async () => []),
      acknowledgeDevicePending: vi.fn(async () => undefined),
      publishCards: vi.fn(),
      publishPractice: vi.fn(),
      chooseAllDecks: vi.fn(),
      recoverCloud: vi.fn(),
      reportError: vi.fn(),
      warn: vi.fn(),
    },
  } satisfies Omit<CustomDeckWorkspaceOptions, 'identityReady' | 'owner' | 'remoteDecks'>;

  const render = (
    ownerId: string | null,
    remoteDecks: readonly string[] | null,
    identityReady = true,
  ) => {
    hookRuntime.effectCursor = 0;
    hookRuntime.refCursor = 0;
    hookRuntime.stateCursor = 0;
    return useCustomDeckWorkspace({
      ...stableOptions,
      identityReady,
      owner: { id: ownerId, remoteAvailable: Boolean(ownerId) },
      remoteDecks,
    });
  };

  return { cacheWrites, mutations: stableOptions.mutations, ports: stableOptions.ports, render };
};

describe('useCustomDeckWorkspace owner isolation', () => {
  beforeEach(() => {
    hookRuntime.effectCursor = 0;
    hookRuntime.effects = [];
    hookRuntime.pendingEffects = [];
    hookRuntime.refCursor = 0;
    hookRuntime.refs = [];
    hookRuntime.stateCursor = 0;
    hookRuntime.states = [];
    vi.clearAllMocks();
  });

  it('renders owner-b remote decks immediately without caching owner-a decks under owner-b', () => {
    const { cacheWrites, render } = createWorkspaceHarness();
    render('owner-a', ['Owner A private deck']);
    flushEffects();
    render('owner-a', ['Owner A private deck']);
    cacheWrites.length = 0;

    const firstOwnerBRender = render('owner-b', ['Owner B private deck']);
    flushEffects();

    expect(firstOwnerBRender.model.decks).toEqual(['Owner B private deck']);
    expect(cacheWrites).not.toContainEqual({
      ownerId: 'owner-b',
      decks: ['Owner A private deck'],
    });
  });

  it('renders no owner-a decks on the first signed-out render', () => {
    const { render } = createWorkspaceHarness();
    render('owner-a', ['Owner A private deck']);
    flushEffects();
    render('owner-a', ['Owner A private deck']);

    const firstSignedOutRender = render(null, null);

    expect(firstSignedOutRender.model.decks).toEqual([]);
  });

  it('does not publish an owner-a deletion after the workspace switches to owner-b', async () => {
    const ownerACard: CardData = {
      id: 'owner-a-card',
      word: 'private',
      translation: 'riêng tư',
      explanation: '',
      phonetic: '',
      emoji: '🔒',
      category: 'Other',
      audioUrl: null,
      imageUrl: null,
      customDeck: 'Owner A private deck',
    };
    const clearAssignments = deferred<undefined>();
    const { cacheWrites, mutations, ports, render } = createWorkspaceHarness([ownerACard]);
    mutations.clearAssignments.mockImplementation(() => clearAssignments.promise);
    const ownerBDecks = ['Owner B private deck'];

    const ownerAWorkspace = render('owner-a', ['Owner A private deck']);
    flushEffects();
    const deletePromise = ownerAWorkspace.actions.deleteDeck('Owner A private deck');
    await vi.waitFor(() => expect(mutations.clearAssignments).toHaveBeenCalledOnce());

    render('owner-b', ownerBDecks);
    flushEffects();
    const ownerBWorkspace = render('owner-b', ownerBDecks);
    flushEffects();
    expect(ownerBWorkspace.model.decks).toEqual(ownerBDecks);
    cacheWrites.length = 0;

    clearAssignments.resolve(undefined);
    await deletePromise;

    expect(mutations.removeProfile).toHaveBeenCalledWith('owner-a', 'Owner A private deck');
    expect(ports.patchDeviceCards).toHaveBeenCalledOnce();
    expect(ports.acknowledgeDevicePending).toHaveBeenCalledOnce();
    const ownerBAfterLateDelete = render('owner-b', null);
    expect(ownerBAfterLateDelete.model.decks).toEqual(ownerBDecks);
    expect(cacheWrites).not.toContainEqual({ ownerId: 'owner-b', decks: [] });
    expect(ports.publishCards).not.toHaveBeenCalled();
    expect(ports.publishPractice).not.toHaveBeenCalled();
  });

  it('does not surface an in-flight owner-a deletion failure to owner-b', async () => {
    const clearAssignments = deferred<undefined>();
    const { mutations, ports, render } = createWorkspaceHarness();
    mutations.clearAssignments.mockImplementation(() => clearAssignments.promise);

    const ownerAWorkspace = render('owner-a', ['Owner A private deck']);
    flushEffects();
    const deletePromise = ownerAWorkspace.actions.deleteDeck('Owner A private deck');

    render('owner-b', ['Owner B private deck']);
    flushEffects();
    render('owner-b', ['Owner B private deck']);
    flushEffects();

    clearAssignments.reject(new Error('offline'));
    await expect(deletePromise).resolves.toBeUndefined();

    expect(ports.reportError).not.toHaveBeenCalled();
    expect(ports.recoverCloud).not.toHaveBeenCalled();
    expect(ports.warn).not.toHaveBeenCalled();
    expect(render('owner-b', null).model.decks).toEqual(['Owner B private deck']);
  });

  it('ignores a stale owner-a create action after the workspace switches to owner-b', async () => {
    const { cacheWrites, mutations, render } = createWorkspaceHarness();
    const ownerAWorkspace = render('owner-a', ['Owner A private deck']);
    flushEffects();

    render('owner-b', ['Owner B private deck']);
    flushEffects();
    render('owner-b', ['Owner B private deck']);
    flushEffects();
    cacheWrites.length = 0;

    await ownerAWorkspace.actions.createDeck('Late owner A deck');

    expect(cacheWrites).toEqual([]);
    expect(mutations.add).not.toHaveBeenCalled();
    expect(render('owner-b', null).model.decks).toEqual(['Owner B private deck']);
  });

  it('does not publish an in-flight owner-a creation after switching to owner-b', async () => {
    const remoteCreate = deferred<undefined>();
    const { cacheWrites, mutations, render } = createWorkspaceHarness();
    mutations.add.mockImplementation(() => remoteCreate.promise);

    const ownerAWorkspace = render('owner-a', ['Owner A private deck']);
    flushEffects();
    render('owner-a', ['Owner A private deck']);
    flushEffects();
    cacheWrites.length = 0;

    const createPromise = ownerAWorkspace.actions.createDeck('Late owner A deck');
    expect(cacheWrites).toEqual([]);

    render('owner-b', ['Owner B private deck']);
    flushEffects();
    render('owner-b', ['Owner B private deck']);
    flushEffects();
    cacheWrites.length = 0;

    remoteCreate.resolve(undefined);
    await createPromise;

    expect(cacheWrites).toEqual([]);
    expect(render('owner-b', null).model.decks).toEqual(['Owner B private deck']);
  });

  it('does not surface an in-flight owner-a creation failure to owner-b', async () => {
    const remoteCreate = deferred<undefined>();
    const { mutations, ports, render } = createWorkspaceHarness();
    mutations.add.mockImplementation(() => remoteCreate.promise);

    const ownerAWorkspace = render('owner-a', ['Owner A private deck']);
    flushEffects();
    const createPromise = ownerAWorkspace.actions.createDeck('Late owner A deck');

    render('owner-b', ['Owner B private deck']);
    flushEffects();
    render('owner-b', ['Owner B private deck']);
    flushEffects();

    remoteCreate.reject(new Error('offline'));
    await expect(createPromise).resolves.toBeUndefined();

    expect(ports.reportError).not.toHaveBeenCalled();
    expect(ports.warn).not.toHaveBeenCalled();
    expect(render('owner-b', null).model.decks).toEqual(['Owner B private deck']);
  });

  it('ignores stale owner-a assign and delete actions after the workspace switches to owner-b', async () => {
    const { mutations, ports, render } = createWorkspaceHarness();
    const ownerAWorkspace = render('owner-a', ['Owner A private deck']);
    flushEffects();
    render('owner-b', ['Owner B private deck']);
    flushEffects();

    await ownerAWorkspace.actions.assignDeck('owner-a-card', 'Owner A private deck');
    await ownerAWorkspace.actions.deleteDeck('Owner A private deck');

    expect(ports.assignCard).not.toHaveBeenCalled();
    expect(mutations.clearAssignments).not.toHaveBeenCalled();
    expect(mutations.removeProfile).not.toHaveBeenCalled();
  });
});
