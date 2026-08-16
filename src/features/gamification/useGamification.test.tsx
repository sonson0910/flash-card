import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  GAMIFICATION_PENDING_CAPACITY_RELEASED_EVENT,
  readGamificationSnapshot,
  writeGamificationSnapshot,
  type GamificationStorage,
} from './gamificationStorage';
import { useGamificationState, type GamificationState } from './useGamification';
import type { GamificationStore } from './gamificationStore';

class MemoryStorage implements GamificationStorage {
  private values = new Map<string, string>();
  private writesDenied = false;

  get length() {
    return this.values.size;
  }

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  key(index: number) {
    return Array.from(this.values.keys())[index] ?? null;
  }

  setItem(key: string, value: string) {
    if (this.writesDenied) {
      throw new DOMException('Quota exceeded', 'QuotaExceededError');
    }
    this.values.set(key, value);
  }

  removeItem(key: string) {
    this.values.delete(key);
  }

  denyWrites() {
    this.writesDenied = true;
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
  vi.stubGlobal('dispatchEvent', vi.fn());
  vi.stubGlobal('CustomEvent', class TestCustomEvent {
    readonly type: string;
    readonly detail: unknown;

    constructor(type: string, init?: { detail?: unknown }) {
      this.type = type;
      this.detail = init?.detail;
    }
  });
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

  it('uses the supplied settlement timestamp for XP history', async () => {
    const storage = new MemoryStorage();
    let latest!: GamificationState;

    function Harness() {
      latest = useGamificationState({
        ownerId: 'owner-a',
        cloudBackoffActive: false,
        store: null,
        storage,
        now: () => new Date('2026-08-10T08:00:00Z'),
      });
      return null;
    }

    const root = createRoot(installMinimalReactDom());
    try {
      await act(async () => { root.render(<Harness />); });
      let durablyWritten = false;
      await act(async () => {
        durablyWritten = latest.addXp(5, {
          operationId: 'review-logical-operation',
          settledAt: '2026-08-08T08:00:00Z',
        });
      });

      expect(durablyWritten).toBe(true);
      expect(latest.xp).toBe(5);
      expect(latest.xpHistory).toEqual({ 'Aug 8, 2026': 5 });
    } finally {
      await act(async () => { root.unmount(); });
    }
  });

  it('reports false when an XP snapshot cannot be durably written', async () => {
    const storage = new MemoryStorage();
    let latest!: GamificationState;

    function Harness() {
      latest = useGamificationState({
        ownerId: 'owner-a',
        cloudBackoffActive: false,
        store: null,
        storage,
        now: () => new Date('2026-08-10T08:00:00Z'),
      });
      return null;
    }

    const root = createRoot(installMinimalReactDom());
    try {
      await act(async () => { root.render(<Harness />); });
      storage.denyWrites();
      let durablyWritten = true;
      await act(async () => {
        durablyWritten = latest.addXp(5, { operationId: 'storage-failure-operation' });
      });

      expect(durablyWritten).toBe(false);
      expect(latest.xp).toBe(5);
      expect(readGamificationSnapshot(storage, 'owner-a').xp).toBe(0);
    } finally {
      await act(async () => { root.unmount(); });
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

  it('signals settlement recovery when a cloud save releases pending XP capacity', async () => {
    vi.useFakeTimers();
    const storage = new MemoryStorage();
    const pendingOperation = {
      id: 'xp2:capacity-client:1',
      clientId: 'capacity-client',
      sequence: 1,
      delta: 5,
      day: 'Aug 9, 2026',
    };
    const pendingSnapshot = {
      streak: 1,
      xp: 5,
      lastActive: 'Sun Aug 09 2026',
      history: { 'Aug 9, 2026': 5 },
      pendingOperations: [pendingOperation],
    };
    writeGamificationSnapshot(storage, 'owner-a', pendingSnapshot);
    const store: GamificationStore = {
      load: vi.fn(async (_ownerId, localFallback) => ({
        source: 'local-fallback' as const,
        snapshot: localFallback,
      })),
      save: vi.fn(async () => ({
        snapshot: {
          ...pendingSnapshot,
          pendingOperations: undefined,
          appliedOperationIds: [pendingOperation.id],
          appliedOperationSequenceByClient: { 'capacity-client': 1 },
        },
        appliedOperationIds: [pendingOperation.id],
      })),
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

      expect(globalThis.dispatchEvent).toHaveBeenCalledWith(expect.objectContaining({
        type: GAMIFICATION_PENDING_CAPACITY_RELEASED_EVENT,
        detail: { ownerId: 'owner-a' },
      }));
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

  it('keeps a capped background retry alive after the initial save attempts fail', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const storage = new MemoryStorage();
    const pendingOperation = {
      id: 'xp2:recovery-client:1',
      clientId: 'recovery-client',
      sequence: 1,
      delta: 5,
      day: 'Aug 9, 2026',
    };
    const pendingSnapshot = {
      streak: 1,
      xp: 5,
      lastActive: 'Sun Aug 09 2026',
      history: { 'Aug 9, 2026': 5 },
      pendingOperations: [pendingOperation],
    };
    writeGamificationSnapshot(storage, 'owner-a', pendingSnapshot);
    const save = vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockRejectedValueOnce(new Error('offline'))
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue({
        snapshot: {
          ...pendingSnapshot,
          pendingOperations: undefined,
          appliedOperationIds: [pendingOperation.id],
          appliedOperationSequenceByClient: { 'recovery-client': 1 },
        },
        appliedOperationIds: [pendingOperation.id],
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
      await act(async () => { await vi.advanceTimersByTimeAsync(20); });
      await act(async () => { await vi.advanceTimersByTimeAsync(40); });
      expect(save).toHaveBeenCalledTimes(3);

      await act(async () => { await vi.advanceTimersByTimeAsync(59_999); });
      expect(save).toHaveBeenCalledTimes(3);
      await act(async () => { await vi.advanceTimersByTimeAsync(1); });

      expect(save).toHaveBeenCalledTimes(4);
      expect(globalThis.dispatchEvent).toHaveBeenCalledWith(expect.objectContaining({
        type: GAMIFICATION_PENDING_CAPACITY_RELEASED_EVENT,
        detail: { ownerId: 'owner-a' },
      }));
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
