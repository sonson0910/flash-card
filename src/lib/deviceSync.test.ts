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
  it('merges patches without replacing unrelated fields and folds them into new-card upserts', () => {
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
    expect(mergePendingOperations([{
      type: 'upsert',
      card,
      updatedAt: '2026-07-22T00:00:00.000Z',
      ownerUserId: 'user-merge',
    }, firstPatch])).toEqual([{
      type: 'upsert',
      card: { ...card, bookmarked: true },
      updatedAt: firstPatch.updatedAt,
      ownerUserId: 'user-merge',
    }]);
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
      cardId: card.id,
      fields: { bookmarked: true },
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
      ownerUserId: 'user-migration',
    }]);
    storage.clear();
    await expect(loadDevicePending('user-migration')).resolves.toEqual([{
      ...legacyOperation,
      ownerUserId: 'user-migration',
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

    await expect(loadDevicePending('user-ack')).resolves.toEqual([{
      ...newer,
      fields: { bookmarked: true, imageUrl: 'https://images.pexels.com/stable.jpeg' },
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
