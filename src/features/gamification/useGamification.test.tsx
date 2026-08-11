import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  writeGamificationSnapshot,
  type GamificationStorage,
} from './gamificationStorage';
import { useGamificationState } from './useGamification';
import type { GamificationStore } from './gamificationStore';

class MemoryStorage implements GamificationStorage {
  private values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

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

describe('useGamificationState', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('never renders XP from the previous owner while switching scopes', async () => {
    const storage = new MemoryStorage();
    writeGamificationSnapshot(storage, 'owner-a', {
      streak: 2,
      xp: 111,
      lastActive: 'Sun Aug 09 2026',
      history: { 'Aug 9, 2026': 111 },
    });
    writeGamificationSnapshot(storage, 'owner-b', {
      streak: 4,
      xp: 222,
      lastActive: 'Sun Aug 09 2026',
      history: { 'Aug 9, 2026': 222 },
    });
    const rendered: Array<{ ownerId: string; xp: number }> = [];

    function Harness({ ownerId }: { ownerId: string }) {
      const state = useGamificationState({
        ownerId,
        cloudBackoffActive: false,
        store: null,
        storage,
        now: () => new Date('2026-08-09T08:00:00+07:00'),
      });
      rendered.push({ ownerId, xp: state.xp });
      return null;
    }

    const root = createRoot(installMinimalReactDom());
    try {
      await act(async () => {
        root.render(<Harness ownerId="owner-a" />);
      });
      expect(rendered.at(-1)).toEqual({ ownerId: 'owner-a', xp: 111 });

      rendered.length = 0;
      await act(async () => {
        root.render(<Harness ownerId="owner-b" />);
      });

      expect(rendered.length).toBeGreaterThan(0);
      expect(rendered.every(render => render.ownerId !== 'owner-b' || render.xp === 222)).toBe(true);
    } finally {
      await act(async () => {
        root.unmount();
      });
      vi.unstubAllGlobals();
    }
  });

  it('retries a failed save with the same snapshot after backoff', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const storage = new MemoryStorage();
    const pendingSnapshot = {
      streak: 1,
      xp: 5,
      lastActive: 'Sun Aug 09 2026',
      history: { 'Aug 9, 2026': 5 },
      pendingOperations: [{
        id: 'xp2:retry-client:1',
        clientId: 'retry-client',
        sequence: 1,
        delta: 5,
        day: 'Aug 9, 2026',
      }],
    };
    writeGamificationSnapshot(storage, 'owner-a', pendingSnapshot);
    const save = vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue({
        snapshot: {
          ...pendingSnapshot,
          pendingOperations: undefined,
          appliedOperationIds: ['xp2:retry-client:1'],
          appliedOperationSequenceByClient: { 'retry-client': 1 },
        },
        appliedOperationIds: ['xp2:retry-client:1'],
      });
    const store: GamificationStore = {
      load: vi.fn(async (_ownerId, localFallback) => ({
        source: 'local-fallback' as const,
        snapshot: localFallback,
      })),
      save,
    };

    function Harness() {
      useGamificationState({
        ownerId: 'owner-a',
        cloudBackoffActive: false,
        store,
        storage,
        now: () => new Date('2026-08-09T08:00:00+07:00'),
        saveDelayMs: 10,
      });
      return null;
    }

    const root = createRoot(installMinimalReactDom());
    try {
      await act(async () => {
        root.render(<Harness />);
        await Promise.resolve();
      });
      await act(async () => { await vi.advanceTimersByTimeAsync(10); });
      expect(save).toHaveBeenCalledTimes(1);
      const firstSnapshot = save.mock.calls[0]?.[1];

      await act(async () => { await vi.advanceTimersByTimeAsync(20); });

      expect(save).toHaveBeenCalledTimes(2);
      expect(save.mock.calls[1]?.[1]).toEqual(firstSnapshot);
    } finally {
      await act(async () => { root.unmount(); });
    }
  });

  it('bounds repeated save failures', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const storage = new MemoryStorage();
    writeGamificationSnapshot(storage, 'owner-a', {
      streak: 1,
      xp: 5,
      lastActive: 'Sun Aug 09 2026',
      history: { 'Aug 9, 2026': 5 },
      pendingOperations: [{
        id: 'xp2:bounded-client:1',
        clientId: 'bounded-client',
        sequence: 1,
        delta: 5,
        day: 'Aug 9, 2026',
      }],
    });
    const save = vi.fn().mockRejectedValue(new Error('offline'));
    const store: GamificationStore = {
      load: vi.fn(async (_ownerId, localFallback) => ({
        source: 'local-fallback' as const,
        snapshot: localFallback,
      })),
      save,
    };

    function Harness() {
      useGamificationState({
        ownerId: 'owner-a',
        cloudBackoffActive: false,
        store,
        storage,
        now: () => new Date('2026-08-09T08:00:00+07:00'),
        saveDelayMs: 10,
      });
      return null;
    }

    const root = createRoot(installMinimalReactDom());
    try {
      await act(async () => {
        root.render(<Harness />);
        await Promise.resolve();
      });
      await act(async () => { await vi.advanceTimersByTimeAsync(10); });
      await act(async () => { await vi.advanceTimersByTimeAsync(20); });
      await act(async () => { await vi.advanceTimersByTimeAsync(40); });
      await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });

      expect(save).toHaveBeenCalledTimes(3);
    } finally {
      await act(async () => { root.unmount(); });
    }
  });

  it('cancels a failed owner save retry after the owner changes', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const storage = new MemoryStorage();
    writeGamificationSnapshot(storage, 'owner-a', {
      streak: 1,
      xp: 5,
      lastActive: 'Sun Aug 09 2026',
      history: { 'Aug 9, 2026': 5 },
      pendingOperations: [{
        id: 'xp2:owner-client:1',
        clientId: 'owner-client',
        sequence: 1,
        delta: 5,
        day: 'Aug 9, 2026',
      }],
    });
    const save = vi.fn().mockImplementation(async (ownerId: string, snapshot) => {
      if (ownerId === 'owner-a') throw new Error('offline');
      return { snapshot, appliedOperationIds: [] };
    });
    const store: GamificationStore = {
      load: vi.fn(async (_ownerId, localFallback) => ({
        source: 'local-fallback' as const,
        snapshot: localFallback,
      })),
      save,
    };

    function Harness({ ownerId }: { ownerId: string }) {
      useGamificationState({
        ownerId,
        cloudBackoffActive: false,
        store,
        storage,
        now: () => new Date('2026-08-09T08:00:00+07:00'),
        saveDelayMs: 10,
      });
      return null;
    }

    const root = createRoot(installMinimalReactDom());
    try {
      await act(async () => {
        root.render(<Harness ownerId="owner-a" />);
        await Promise.resolve();
      });
      await act(async () => { await vi.advanceTimersByTimeAsync(10); });
      expect(save.mock.calls.filter(([ownerId]) => ownerId === 'owner-a')).toHaveLength(1);

      await act(async () => {
        root.render(<Harness ownerId="owner-b" />);
        await Promise.resolve();
      });
      await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });

      expect(save.mock.calls.filter(([ownerId]) => ownerId === 'owner-a')).toHaveLength(1);
    } finally {
      await act(async () => { root.unmount(); });
    }
  });
});
