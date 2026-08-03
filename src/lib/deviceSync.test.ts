import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CardData } from '../types/card';
import {
  acknowledgeDevicePending,
  acquireDevicePendingFlush,
  clearDevicePending,
  loadBrowserPending,
  loadDevicePending,
  mergePendingOperations,
  queueDeviceDeletes,
  queueDevicePatches,
  queueDeviceUpserts,
  resolveDeviceBackupOwner,
  subscribeToDeviceCards,
} from './deviceSync';

const card = {
  id: 'card-1',
  word: 'stable',
  translation: 'ổn định',
  explanation: '',
  phonetic: '',
  emoji: '🧱',
  category: 'Other',
  audioUrl: null,
  imageUrl: null,
  createdAt: '2026-07-13T00:00:00.000Z',
} satisfies CardData;

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('device pending queue', () => {
  it('merges patches without replacing unrelated fields and never folds them into full-card writes', () => {
    const firstPatch = {
      type: 'patch' as const,
      cardId: card.id,
      fields: { bookmarked: true },
      updatedAt: '2026-07-22T00:01:00.000Z',
      ownerUserId: 'user-merge',
    };
    const secondPatch = {
      type: 'patch' as const,
      cardId: card.id,
      fields: { imageUrl: 'https://images.pexels.com/stable.jpeg' },
      updatedAt: '2026-07-22T00:02:00.000Z',
      ownerUserId: 'user-merge',
    };

    expect(mergePendingOperations([firstPatch, secondPatch])).toEqual([{
      ...secondPatch,
      fields: { bookmarked: true, imageUrl: 'https://images.pexels.com/stable.jpeg' },
    }]);
    const create = {
      type: 'upsert',
      card,
      updatedAt: '2026-07-22T00:00:00.000Z',
      ownerUserId: 'user-merge',
    } as const;
    expect(mergePendingOperations([create, firstPatch])).toEqual([create, firstPatch]);
  });

  it('keeps a delete over later patches and only a newer explicit upsert recreates the card', () => {
    const deleted = {
      type: 'delete' as const,
      cardId: card.id,
      updatedAt: '2026-07-22T00:01:00.000Z',
      ownerUserId: 'user-delete',
    };
    const latePatch = {
      type: 'patch' as const,
      cardId: card.id,
      fields: { bookmarked: true },
      updatedAt: '2026-07-22T00:02:00.000Z',
      ownerUserId: 'user-delete',
    };
    const recreated = {
      type: 'upsert' as const,
      card: { ...card, translation: 'được tạo lại' },
      updatedAt: '2026-07-22T00:03:00.000Z',
      ownerUserId: 'user-delete',
    };

    expect(mergePendingOperations([deleted, latePatch])).toEqual([deleted]);
    expect(mergePendingOperations([deleted, latePatch, recreated])).toEqual([recreated]);
  });

  it('keeps a recreate that follows a delete at the same timestamp', () => {
    const updatedAt = '2026-07-22T00:01:00.000Z';
    const deleted = {
      type: 'delete' as const,
      opId: 'delete-card',
      cardId: card.id,
      updatedAt,
      ownerUserId: 'user-delete-recreate',
    };
    const recreated = {
      type: 'upsert' as const,
      opId: 'recreate-card',
      card: { ...card, translation: 'được tạo lại' },
      updatedAt,
      ownerUserId: 'user-delete-recreate',
    };

    expect(mergePendingOperations([deleted, recreated])).toEqual([recreated]);
  });

  it('does not silently truncate a large pending queue', () => {
    const operations = Array.from({ length: 1_050 }, (_, index) => ({
      type: 'delete' as const,
      cardId: `card-${index}`,
      updatedAt: new Date(2026, 0, 1, 0, 0, index).toISOString(),
      ownerUserId: 'user-large',
    }));

    expect(mergePendingOperations(operations)).toHaveLength(1_050);
  });

  it('does not block card creation when the shared device endpoint hangs', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => undefined)));

    const queued = queueDeviceUpserts([card], 1, 'user-1');
    await vi.advanceTimersByTimeAsync(5_000);

    await expect(queued).resolves.toMatchObject([{ type: 'upsert', card }]);
  });

  it('queues an upsert with one atomic merge request', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const operations = await queueDeviceUpserts([card]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, request] = fetchMock.mock.calls[0];
    expect(JSON.parse(String(request?.body))).toMatchObject({
      cards: [card],
      mode: 'merge',
      pending: [{ type: 'upsert', card }],
    });
    expect(operations).toMatchObject([{ type: 'upsert', card }]);
    expect(operations[0]).toMatchObject({
      operation: 'create',
      baseRevision: 0,
      libraryEpoch: 0,
      fieldMask: [],
    });
    expect(operations[0].opId).toEqual(expect.any(String));
  });

  it('queues a deletion without replacing the shared card snapshot', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const operations = await queueDeviceDeletes(['card-1']);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, request] = fetchMock.mock.calls[0];
    expect(JSON.parse(String(request?.body))).toMatchObject({
      cards: [],
      mode: 'merge',
      pending: [{ type: 'delete', cardId: 'card-1' }],
    });
    expect(operations).toMatchObject([{ type: 'delete', cardId: 'card-1' }]);
    expect(operations[0]).toMatchObject({
      operation: 'delete',
      baseRevision: 0,
      libraryEpoch: 0,
    });
    expect(operations[0].opId).toEqual(expect.any(String));
  });

  it('carries the current epoch and per-card revision when a caller knows them', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 200 })));

    const operations = await queueDeviceDeletes(['card-1'], 'user-delete-v2', {
      libraryEpoch: 7,
      baseRevisions: { 'card-1': 12 },
    });

    expect(operations).toMatchObject([{
      type: 'delete',
      operation: 'delete',
      cardId: 'card-1',
      baseRevision: 12,
      libraryEpoch: 7,
    }]);
  });

  it('queues an existing-card patch while using the full card only for the device mirror', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const updatedCard = { ...card, bookmarked: true };

    const operations = await queueDevicePatches([
      { card: updatedCard, fields: { bookmarked: true } },
    ], 1, 'user-patch');

    expect(operations).toMatchObject([{
      type: 'patch',
      operation: 'patch',
      cardId: card.id,
      fields: { bookmarked: true },
      fieldMask: ['bookmarked'],
      ownerUserId: 'user-patch',
    }]);
    const [, request] = fetchMock.mock.calls[0];
    expect(JSON.parse(String(request?.body))).toMatchObject({
      cards: [updatedCard],
      pending: [{ type: 'patch', cardId: card.id, fields: { bookmarked: true } }],
      mode: 'merge',
    });
  });

  it('acknowledges only the operations that were actually flushed', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const operation = {
      type: 'upsert' as const,
      card,
      updatedAt: '2026-07-13T01:00:00.000Z',
    };

    await acknowledgeDevicePending([operation]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, request] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/device-cards/ack');
    expect(JSON.parse(String(request?.body))).toEqual({ operations: [operation] });
  });

  it('does not acknowledge another card that happens to carry the same operation id', async () => {
    const storage = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 200 })));
    const first = await queueDeviceDeletes(['card-a'], 'user-op-collision');
    const second = await queueDeviceDeletes(['card-b'], 'user-op-collision');
    const duplicateIdSecond = { ...second[0], opId: first[0].opId };
    await clearDevicePending('user-op-collision');
    localStorage.setItem(
      'lingoflash_pending_writes_user-op-collision',
      JSON.stringify([first[0], duplicateIdSecond]),
    );
    await loadDevicePending('user-op-collision');

    await acknowledgeDevicePending([first[0]]);

    await expect(loadDevicePending('user-op-collision')).resolves.toMatchObject([{
      cardId: 'card-b',
      opId: first[0].opId,
    }]);
  });

  it('acquires a shared lease before flushing pending writes', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ granted: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(acquireDevicePendingFlush('user-1')).resolves.toBe(true);

    const [url, request] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/device-cards/flush');
    expect(JSON.parse(String(request?.body))).toEqual({ userId: 'user-1' });
  });

  it('keeps rejected cloud writes in a user-scoped browser queue', async () => {
    const storage = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));

    const operations = await queueDeviceUpserts([card], 1, 'user-1');

    expect(loadBrowserPending('user-1')).toMatchObject([{ type: 'upsert', card }]);
    expect(loadBrowserPending('user-2')).toEqual([]);
    await acknowledgeDevicePending(operations);
    expect(loadBrowserPending('user-1')).toEqual([]);
  });

  it('migrates a legacy localStorage queue into the durable IndexedDB queue', async () => {
    const storage = new Map<string, string>();
    const legacyOperation = {
      type: 'delete' as const,
      cardId: 'legacy-card',
      updatedAt: '2026-07-22T00:00:00.000Z',
    };
    storage.set('lingoflash_pending_writes_user-migration', JSON.stringify([legacyOperation]));
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    });

    await expect(loadDevicePending('user-migration')).resolves.toEqual([{
      ...legacyOperation,
      operation: 'delete',
      baseRevision: 0,
      fieldMask: [],
      libraryEpoch: 0,
      ownerUserId: 'user-migration',
    }]);
    storage.clear();
    await expect(loadDevicePending('user-migration')).resolves.toEqual([{
      ...legacyOperation,
      operation: 'delete',
      baseRevision: 0,
      fieldMask: [],
      libraryEpoch: 0,
      ownerUserId: 'user-migration',
    }]);
  });

  it('repairs malformed legacy patch metadata without allowing unknown fields to reach Firebase', async () => {
    const storage = new Map<string, string>();
    storage.set('lingoflash_pending_writes_user-repair', JSON.stringify([{
      type: 'patch',
      cardId: 'card-1',
      fields: {
        bookmarked: true,
        rogueField: 'must not be written',
      },
      fieldMask: ['bookmarked', 'rogueField'],
      baseRevision: -4,
      libraryEpoch: 'invalid',
    }]));
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 200 })));

    await expect(loadDevicePending('user-repair')).resolves.toMatchObject([{
      type: 'patch',
      cardId: 'card-1',
      fields: {
        bookmarked: true,
        rogueField: 'must not be written',
      },
      fieldMask: ['bookmarked'],
      baseRevision: 0,
      libraryEpoch: 0,
      updatedAt: '1970-01-01T00:00:00.000Z',
      ownerUserId: 'user-repair',
    }]);
  });

  it('clears only the selected user durable queue after a library reset', async () => {
    const storage = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 200 })));
    await queueDeviceUpserts([card], 1, 'user-clear-a');
    await queueDeviceUpserts([{ ...card, id: 'card-b' }], 1, 'user-clear-b');

    await clearDevicePending('user-clear-a');

    await expect(loadDevicePending('user-clear-a')).resolves.toEqual([]);
    await expect(loadDevicePending('user-clear-b')).resolves.toMatchObject([{ card: { id: 'card-b' } }]);
    expect(loadBrowserPending('user-clear-a')).toEqual([]);
  });

  it('loads the durable queue when localStorage access is blocked', async () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('blocked'); },
      removeItem: () => { throw new Error('blocked'); },
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 200 })));
    await queueDeviceUpserts([card], 1, 'user-storage-blocked');

    await expect(loadDevicePending('user-storage-blocked')).resolves.toMatchObject([{
      type: 'upsert',
      card,
      ownerUserId: 'user-storage-blocked',
    }]);
  });

  it('acknowledges an operation without removing a newer edit for the same card', async () => {
    const storage = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 200 })));
    const [older] = await queueDevicePatches([{
      card: { ...card, bookmarked: true },
      fields: { bookmarked: true },
    }], 1, 'user-ack');
    const newer = {
      type: 'patch' as const,
      cardId: card.id,
      fields: { imageUrl: 'https://images.pexels.com/stable.jpeg' },
      updatedAt: new Date(Date.parse(older.updatedAt) + 1_000).toISOString(),
      ownerUserId: 'user-ack',
    };
    storage.set('lingoflash_pending_writes_user-ack', JSON.stringify([older, newer]));
    await loadDevicePending('user-ack');

    await acknowledgeDevicePending([older]);

    await expect(loadDevicePending('user-ack')).resolves.toMatchObject([{
      ...newer,
      fields: { bookmarked: true, imageUrl: 'https://images.pexels.com/stable.jpeg' },
    }]);
  });

  it('acknowledges v2 operations by opId instead of deleting a different operation with the same timestamp', async () => {
    const storage = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 200 })));
    const first = {
      type: 'patch' as const,
      operation: 'patch' as const,
      opId: 'op-first',
      cardId: card.id,
      fields: { bookmarked: true },
      fieldMask: ['bookmarked'] as (keyof CardData)[],
      baseRevision: 1,
      libraryEpoch: 3,
      updatedAt: '2026-07-22T00:00:00.000Z',
      ownerUserId: 'user-op-id',
    };
    const second = {
      ...first,
      opId: 'op-second',
      fields: { imageUrl: 'https://images.pexels.com/stable.jpeg' },
      fieldMask: ['imageUrl'] as (keyof CardData)[],
    };
    storage.set('lingoflash_pending_writes_user-op-id', JSON.stringify([first, second]));
    await loadDevicePending('user-op-id');

    await acknowledgeDevicePending([first]);

    await expect(loadDevicePending('user-op-id')).resolves.toMatchObject([{
      opId: 'op-second',
      fields: {
        bookmarked: true,
        imageUrl: 'https://images.pexels.com/stable.jpeg',
      },
    }]);
  });

  it('records the session owner at the shared-store boundary', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await queueDeviceUpserts([card], 1, 'user-1');

    const [, request] = fetchMock.mock.calls[0];
    expect(JSON.parse(String(request?.body))).toMatchObject({ ownerUserId: 'user-1' });
  });

  it('does not guess ownership for a legacy or mixed pending backup', () => {
    const userOne = { type: 'delete' as const, cardId: 'a', updatedAt: '1', ownerUserId: 'user-1' };
    const userTwo = { type: 'delete' as const, cardId: 'b', updatedAt: '2', ownerUserId: 'user-2' };

    expect(resolveDeviceBackupOwner(undefined, null, [])).toBeUndefined();
    expect(resolveDeviceBackupOwner(undefined, null, [userOne])).toBe('user-1');
    expect(resolveDeviceBackupOwner(undefined, null, [userOne, userTwo])).toBeUndefined();
    expect(resolveDeviceBackupOwner(null, 'user-1', [userOne])).toBeNull();
  });
});

describe('shared device subscription', () => {
  it('notifies another browser when the shared store changes and closes cleanly', () => {
    class FakeEventSource {
      static latest: FakeEventSource | null = null;
      listeners = new Map<string, () => void>();
      closed = false;

      constructor(public url: string) {
        FakeEventSource.latest = this;
      }

      addEventListener(type: string, listener: () => void) {
        this.listeners.set(type, listener);
      }

      close() {
        this.closed = true;
      }

      emit(type: string) {
        this.listeners.get(type)?.();
      }
    }
    vi.stubGlobal('EventSource', FakeEventSource);
    const onChange = vi.fn();

    const unsubscribe = subscribeToDeviceCards(onChange);
    FakeEventSource.latest?.emit('cards-changed');

    expect(FakeEventSource.latest?.url).toBe('/api/device-cards/events');
    expect(onChange).toHaveBeenCalledTimes(1);
    unsubscribe();
    expect(FakeEventSource.latest?.closed).toBe(true);
  });
});
