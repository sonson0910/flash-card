import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import type { StoredGamificationSnapshot } from './gamificationStorage';
import { createGamificationStoreController, type GamificationStore } from './gamificationStore';

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
};

describe('gamification store controller', () => {
  it('loads the captured owner and publishes the store snapshot', async () => {
    let ownerId: string | null = 'user-a';
    const publish = vi.fn();
    const store: GamificationStore = {
      load: vi.fn(async () => cloudSnapshot),
      save: vi.fn(async () => undefined),
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

  it('does not publish a late load after the owner changes', async () => {
    let ownerId: string | null = 'user-a';
    let resolveLoad!: (snapshot: StoredGamificationSnapshot) => void;
    const publish = vi.fn();
    const store: GamificationStore = {
      load: () => new Promise(resolve => { resolveLoad = resolve; }),
      save: vi.fn(async () => undefined),
    };
    const controller = createGamificationStoreController({ store, activeOwner: () => ownerId });

    const pending = controller.load('user-a', localSnapshot, publish);
    ownerId = 'user-b';
    resolveLoad(cloudSnapshot);

    await expect(pending).resolves.toEqual({ status: 'stale-owner' });
    expect(publish).not.toHaveBeenCalled();
  });

  it('saves only for the active owner and reports a mid-flight owner change', async () => {
    let ownerId: string | null = 'user-a';
    let resolveSave!: () => void;
    const save = vi.fn(() => new Promise<void>(resolve => { resolveSave = resolve; }));
    const store: GamificationStore = { load: vi.fn(async (_owner, fallback) => fallback), save };
    const controller = createGamificationStoreController({ store, activeOwner: () => ownerId });

    await expect(controller.save('user-b', cloudSnapshot)).resolves.toEqual({ status: 'stale-owner' });
    expect(save).not.toHaveBeenCalled();

    const pending = controller.save('user-a', cloudSnapshot);
    expect(save).toHaveBeenCalledWith('user-a', cloudSnapshot);
    ownerId = 'user-b';
    resolveSave();
    await expect(pending).resolves.toEqual({ status: 'stale-owner' });
  });

  it('reports a completed save while the captured owner remains active', async () => {
    const save = vi.fn(async () => undefined);
    const store: GamificationStore = { load: vi.fn(async (_owner, fallback) => fallback), save };
    const controller = createGamificationStoreController({ store, activeOwner: () => 'user-a' });

    await expect(controller.save('user-a', cloudSnapshot)).resolves.toEqual({ status: 'saved' });
    expect(save).toHaveBeenCalledWith('user-a', cloudSnapshot);
  });

  it('propagates load and save failures so the hook can retain local state and retry', async () => {
    const failure = new Error('store unavailable');
    const store: GamificationStore = {
      load: vi.fn(async () => { throw failure; }),
      save: vi.fn(async () => { throw failure; }),
    };
    const controller = createGamificationStoreController({ store, activeOwner: () => 'user-a' });

    await expect(controller.load('user-a', localSnapshot, vi.fn())).rejects.toThrow('store unavailable');
    await expect(controller.save('user-a', localSnapshot)).rejects.toThrow('store unavailable');
  });

  it('keeps the store port and hook public source free of Firebase User types', () => {
    const portSource = readFileSync(fileURLToPath(new URL('./gamificationStore.ts', import.meta.url)), 'utf8');
    const hookSource = readFileSync(fileURLToPath(new URL('./useGamification.ts', import.meta.url)), 'utf8');

    expect(portSource).not.toMatch(/firebase|firestore/i);
    expect(hookSource).not.toMatch(/firebase\/auth|firebase\/firestore|\bUser\b/);
  });
});
