import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import type { StoredGamificationSnapshot } from './gamificationStorage';
import {
  createGamificationStoreController,
  type GamificationStore,
  type GamificationStoreLoadResult,
  type GamificationStoreSaveCommit,
} from './gamificationStore';

const localSnapshot: StoredGamificationSnapshot = {
  streak: 2,
  xp: 120,
  lastActive: 'Mon Aug 03 2026',
  history: { 'Aug 3, 2026': 120 },
};

const cloudSnapshot: StoredGamificationSnapshot = {
  streak: 5,
  xp: 900,
  lastActive: 'Mon Aug 03 2026',
  history: { 'Aug 3, 2026': 900 },
  appliedOperationIds: [],
};

const cloudLoad = (snapshot = cloudSnapshot): GamificationStoreLoadResult => ({
  source: 'cloud',
  snapshot,
});

const saved = (
  snapshot = cloudSnapshot,
  appliedOperationIds: string[] = [],
): GamificationStoreSaveCommit => ({ snapshot, appliedOperationIds });

describe('gamification store controller', () => {
  it('loads the captured owner and publishes the authoritative store snapshot', async () => {
    let ownerId: string | null = 'user-a';
    const publish = vi.fn();
    const store: GamificationStore = {
      load: vi.fn(async () => cloudLoad()),
      save: vi.fn(async () => saved()),
    };
    const controller = createGamificationStoreController({ store, activeOwner: () => ownerId });

    await expect(controller.load('user-a', localSnapshot, publish)).resolves.toEqual({
      status: 'loaded',
      snapshot: cloudSnapshot,
    });
    expect(store.load).toHaveBeenCalledWith('user-a', localSnapshot);
    expect(publish).toHaveBeenCalledWith(cloudSnapshot);
    ownerId = null;
  });

  it('keeps the latest local fallback when cloud has no stats document', async () => {
    let latest = localSnapshot;
    const publish = vi.fn();
    const store: GamificationStore = {
      load: vi.fn(async (_ownerId, fallback): Promise<GamificationStoreLoadResult> => ({
        source: 'local-fallback',
        snapshot: fallback,
      })),
      save: vi.fn(async () => saved()),
    };
    const controller = createGamificationStoreController({ store, activeOwner: () => 'user-a' });
    const pending = controller.load('user-a', localSnapshot, publish, () => latest);
    latest = { ...localSnapshot, xp: 130 };

    await expect(pending).resolves.toEqual({ status: 'loaded', snapshot: latest });
    expect(publish).toHaveBeenCalledWith(latest);
  });

  it('does not publish a late load after owner changes', async () => {
    let ownerId: string | null = 'user-a';
    let resolveLoad!: (result: GamificationStoreLoadResult) => void;
    const publish = vi.fn();
    const store: GamificationStore = {
      load: () => new Promise(resolve => { resolveLoad = resolve; }),
      save: vi.fn(async () => saved()),
    };
    const controller = createGamificationStoreController({ store, activeOwner: () => ownerId });

    const pending = controller.load('user-a', localSnapshot, publish);
    ownerId = 'user-b';
    resolveLoad(cloudLoad());

    await expect(pending).resolves.toEqual({ status: 'stale-owner' });
    expect(publish).not.toHaveBeenCalled();
  });

  it('does not start a remote load for an inactive owner', async () => {
    const load = vi.fn(async () => cloudLoad());
    const publish = vi.fn();
    const controller = createGamificationStoreController({
      store: { load, save: vi.fn(async () => saved()) },
      activeOwner: () => 'user-a',
    });

    await expect(controller.load('user-b', localSnapshot, publish)).resolves.toEqual({
      status: 'stale-owner',
    });
    expect(load).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });

  it('rebases XP earned locally while cloud hydration is in flight', async () => {
    let resolveLoad!: (result: GamificationStoreLoadResult) => void;
    let latest: StoredGamificationSnapshot = {
      ...localSnapshot,
      xp: 100,
      history: { 'Aug 3, 2026': 100 },
    };
    const publish = vi.fn();
    const store: GamificationStore = {
      load: () => new Promise(resolve => { resolveLoad = resolve; }),
      save: vi.fn(async () => saved()),
    };
    const controller = createGamificationStoreController({ store, activeOwner: () => 'user-a' });
    const pending = controller.load('user-a', latest, publish, () => latest);

    latest = {
      ...latest,
      xp: 120,
      history: { 'Aug 3, 2026': 100, 'Aug 4, 2026': 20 },
      pendingOperations: [{ id: 'operation-hydration', delta: 20, day: 'Aug 4, 2026' }],
    };
    resolveLoad(cloudLoad({
      ...localSnapshot,
      xp: 150,
      history: { 'Aug 2, 2026': 50, 'Aug 3, 2026': 100 },
      appliedOperationIds: [],
    }));

    await expect(pending).resolves.toEqual({
      status: 'loaded',
      snapshot: expect.objectContaining({
        xp: 170,
        history: { 'Aug 2, 2026': 50, 'Aug 3, 2026': 100, 'Aug 4, 2026': 20 },
        pendingOperations: [
          { id: 'operation-hydration', delta: 20, day: 'Aug 4, 2026' },
        ],
      }),
    });
  });

  it('does not apply pending history twice when only cloud stats survived', async () => {
    const latest: StoredGamificationSnapshot = {
      streak: 2,
      xp: 120,
      lastActive: 'Tue Aug 04 2026',
      history: { 'Aug 3, 2026': 100, 'Aug 4, 2026': 20 },
      pendingOperations: [{ id: 'operation-partial', delta: 20, day: 'Aug 4, 2026' }],
    };
    const publish = vi.fn();
    const store: GamificationStore = {
      load: vi.fn(async (): Promise<GamificationStoreLoadResult> => ({
        source: 'cloud',
        cloudDocuments: { stats: true, history: false },
        snapshot: {
          streak: 3,
          xp: 150,
          lastActive: 'Tue Aug 04 2026',
          history: latest.history,
          appliedOperationIds: [],
        },
      })),
      save: vi.fn(async () => saved()),
    };
    const controller = createGamificationStoreController({ store, activeOwner: () => 'user-a' });

    await expect(controller.load('user-a', latest, publish, () => latest)).resolves.toEqual({
      status: 'loaded',
      snapshot: expect.objectContaining({
        xp: 170,
        history: latest.history,
      }),
    });
  });

  it('does not apply pending XP twice when only cloud history survived', async () => {
    const latest: StoredGamificationSnapshot = {
      streak: 2,
      xp: 120,
      lastActive: 'Tue Aug 04 2026',
      history: { 'Aug 3, 2026': 100, 'Aug 4, 2026': 20 },
      pendingOperations: [{ id: 'operation-partial', delta: 20, day: 'Aug 4, 2026' }],
    };
    const publish = vi.fn();
    const store: GamificationStore = {
      load: vi.fn(async (): Promise<GamificationStoreLoadResult> => ({
        source: 'cloud',
        cloudDocuments: { stats: false, history: true },
        snapshot: {
          streak: latest.streak,
          xp: latest.xp,
          lastActive: latest.lastActive,
          history: { 'Aug 3, 2026': 100 },
          appliedOperationIds: [],
        },
      })),
      save: vi.fn(async () => saved()),
    };
    const controller = createGamificationStoreController({ store, activeOwner: () => 'user-a' });

    await expect(controller.load('user-a', latest, publish, () => latest)).resolves.toEqual({
      status: 'loaded',
      snapshot: expect.objectContaining({
        xp: 120,
        history: { 'Aug 3, 2026': 100, 'Aug 4, 2026': 20 },
      }),
    });
  });

  it('saves only for active owner and discards a committed result after owner changes', async () => {
    let ownerId: string | null = 'user-a';
    let resolveSave!: (commit: GamificationStoreSaveCommit) => void;
    const save = vi.fn(() => new Promise<GamificationStoreSaveCommit>(resolve => {
      resolveSave = resolve;
    }));
    const store: GamificationStore = {
      load: vi.fn(async () => cloudLoad()),
      save,
    };
    const controller = createGamificationStoreController({ store, activeOwner: () => ownerId });

    await expect(controller.save('user-b', cloudSnapshot)).resolves.toEqual({ status: 'stale-owner' });
    expect(save).not.toHaveBeenCalled();

    const pending = controller.save('user-a', cloudSnapshot);
    expect(save).toHaveBeenCalledWith('user-a', cloudSnapshot);
    ownerId = 'user-b';
    resolveSave(saved());
    await expect(pending).resolves.toEqual({ status: 'stale-owner' });
  });

  it('serializes same-controller saves and returns each authoritative commit', async () => {
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>(resolve => { releaseFirst = resolve; });
    const started: number[] = [];
    const store: GamificationStore = {
      load: vi.fn(async () => cloudLoad()),
      save: vi.fn(async (_ownerId, snapshot) => {
        started.push(snapshot.xp);
        if (snapshot.xp === 120) await firstGate;
        return saved({ ...snapshot, appliedOperationIds: [] });
      }),
    };
    const controller = createGamificationStoreController({ store, activeOwner: () => 'user-a' });

    const first = controller.save('user-a', localSnapshot);
    const second = controller.save('user-a', { ...localSnapshot, xp: 140 });
    await Promise.resolve();
    expect(started).toEqual([120]);

    releaseFirst();
    await expect(Promise.all([first, second])).resolves.toEqual([
      { status: 'saved', ...saved({ ...localSnapshot, appliedOperationIds: [] }) },
      {
        status: 'saved',
        ...saved({ ...localSnapshot, xp: 140, appliedOperationIds: [] }),
      },
    ]);
    expect(started).toEqual([120, 140]);
  });

  it('returns the authoritative snapshot and exactly the applied operation IDs', async () => {
    const commit = saved({ ...cloudSnapshot, xp: 910 }, ['operation-1']);
    const save = vi.fn(async () => commit);
    const store: GamificationStore = { load: vi.fn(async () => cloudLoad()), save };
    const controller = createGamificationStoreController({ store, activeOwner: () => 'user-a' });

    await expect(controller.save('user-a', cloudSnapshot)).resolves.toEqual({
      status: 'saved',
      ...commit,
    });
  });

  it('propagates load and save failures so hook retains local state and retries', async () => {
    const failure = new Error('store unavailable');
    const store: GamificationStore = {
      load: vi.fn(async () => { throw failure; }),
      save: vi.fn(async () => { throw failure; }),
    };
    const controller = createGamificationStoreController({ store, activeOwner: () => 'user-a' });

    await expect(controller.load('user-a', localSnapshot, vi.fn())).rejects.toThrow('store unavailable');
    await expect(controller.save('user-a', localSnapshot)).rejects.toThrow('store unavailable');
  });

  it('keeps store port and hook public source free of Firebase User types', () => {
    const portSource = readFileSync(
      fileURLToPath(new URL('./gamificationStore.ts', import.meta.url)),
      'utf8',
    );
    const hookSource = readFileSync(
      fileURLToPath(new URL('./useGamification.ts', import.meta.url)),
      'utf8',
    );

    expect(portSource).not.toMatch(/firebase|firestore/i);
    expect(hookSource).not.toMatch(/firebase\/auth|firebase\/firestore|\bUser\b/);
  });

  it('routes addXp persistence through denial-safe operation storage', () => {
    const hookSource = readFileSync(
      fileURLToPath(new URL('./useGamification.ts', import.meta.url)),
      'utf8',
    );
    const addXpSource = hookSource.slice(
      hookSource.indexOf('const addXp ='),
      hookSource.indexOf('useEffect(', hookSource.indexOf('const addXp =')),
    );

    expect(addXpSource).toMatch(/addXpToStoredGamification\(/);
    expect(addXpSource).not.toMatch(/storage\.setItem/);
  });
});
