import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CardData } from '../types/card';
import {
  acknowledgeDevicePending,
  withDevicePendingFlush,
  clearDevicePending,
  deleteDeviceCardBackupIfNotNewerThan,
  DeviceBackupOwnerConflictError,
  loadBrowserPending,
  loadDevicePending,
  mergeDeviceCardsStrict,
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

  it('keeps reviews and adjacent normal patches as ordered, non-coalesced commands', () => {
    const normalPatch = {
      type: 'patch' as const,
      operation: 'patch' as const,
      cardId: card.id,
      fields: { bookmarked: true },
      updatedAt: '2026-07-22T00:01:00.000Z',
      ownerUserId: 'user-review-queue',
    };
    const firstReview = {
      type: 'patch' as const,
      operation: 'review' as const,
      cardId: card.id,
      fields: {
        reviews: 1,
        reviewHistory: [{
          rating: 'good' as const,
          reviewedAt: '2026-07-22T00:02:00.000Z',
          scheduledDays: 1,
          elapsedDays: 0,
        }],
      },
      updatedAt: '2026-07-22T00:02:00.000Z',
      ownerUserId: 'user-review-queue',
    };
    const secondReview = {
      ...firstReview,
      fields: {
        reviews: 2,
        reviewHistory: [{
          rating: 'easy' as const,
          reviewedAt: '2026-07-22T00:03:00.000Z',
          scheduledDays: 2,
          elapsedDays: 1,
        }],
      },
      updatedAt: '2026-07-22T00:03:00.000Z',
    };

    expect(mergePendingOperations([normalPatch, firstReview, secondReview])).toEqual([
      normalPatch,
      firstReview,
      secondReview,
    ]);
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

  it('persists restore upsert identity, timestamp, captured epoch and revision unchanged', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    const storage = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => { storage.set(key, value); },
      removeItem: (key: string) => { storage.delete(key); },
    });
    vi.stubGlobal('fetch', fetchMock);
    const restored = { ...card, libraryEpoch: 7, revision: 12, createdAt: '2024-01-01T00:00:00.000Z' };
    const operationCreatedAt = '2026-09-25T06:15:00.000Z';

    const operations = await queueDeviceUpserts([restored], 5, 'user-restore', false, {
      operationId: 'restore-card-12',
      operationCreatedAt,
      libraryEpoch: 7,
      baseRevisions: { [restored.id]: 12 },
      restore: true,
    });

    expect(operations).toEqual([expect.objectContaining({
      type: 'upsert',
      operation: 'create',
      opId: 'restore-card-12',
      card: restored,
      baseRevision: 12,
      libraryEpoch: 7,
      updatedAt: operationCreatedAt,
      ownerUserId: 'user-restore',
      restore: true,
    })]);
    const [, request] = fetchMock.mock.calls[1];
    expect(JSON.parse(String(request?.body))).toMatchObject({
      cards: [restored],
      pending: [expect.objectContaining({
        opId: 'restore-card-12',
        updatedAt: operationCreatedAt,
        baseRevision: 12,
        libraryEpoch: 7,
        ownerUserId: 'user-restore',
        restore: true,
      })],
    });
    expect(loadBrowserPending('user-restore')).toMatchObject([expect.objectContaining({
      opId: 'restore-card-12',
      restore: true,
    })]);
  });

  it('uses the ownerless pending queue to let Undo supersede the original delete', async () => {
    const restored = { ...card, libraryEpoch: 0, createdAt: '2024-01-01T00:00:00.000Z' };
    const operationCreatedAt = '2026-09-25T06:20:00.000Z';
    const originalDelete = {
      type: 'delete' as const, operation: 'delete' as const, opId: 'guest-delete',
      cardId: restored.id, baseRevision: 12, libraryEpoch: 0,
      fieldMask: [] as Array<keyof CardData>, updatedAt: '2026-09-25T06:19:59.000Z',
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({
        cards: [], total: 0, pending: [originalDelete], ownerUserId: null,
      }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const operations = await queueDeviceUpserts([restored], 1, undefined, false, {
      operationId: 'guest-restore', operationCreatedAt, libraryEpoch: 0, restore: true,
      baseRevisions: { [restored.id]: 12 },
    });

    expect(operations).toEqual([expect.objectContaining({
      type: 'upsert', opId: 'guest-restore', card: restored,
      updatedAt: operationCreatedAt, libraryEpoch: 0, baseRevision: 12,
      restore: true,
    })]);
    const [, request] = fetchMock.mock.calls[1];
    expect(JSON.parse(String(request?.body))).toMatchObject({
      cards: [restored], mode: 'merge', ownerUserId: null,
      pending: [expect.objectContaining({ type: 'upsert', opId: 'guest-restore', updatedAt: operationCreatedAt, restore: true })],
    });
  });

  it('keeps a newer ownerless delete and does not copy an older Undo card into backup', async () => {
    const restored = { ...card, libraryEpoch: 0 };
    const laterDelete = {
      type: 'delete' as const, operation: 'delete' as const, opId: 'guest-redelete',
      cardId: restored.id, baseRevision: 12, libraryEpoch: 0,
      fieldMask: [] as Array<keyof CardData>, updatedAt: '2026-09-25T06:20:01.000Z',
    };
    const fetchMock = vi.fn().mockResolvedValueOnce(Response.json({
      cards: [], total: 0, pending: [laterDelete], ownerUserId: null,
    }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(queueDeviceUpserts([restored], 1, undefined, false, {
      operationId: 'guest-old-undo', operationCreatedAt: '2026-09-25T06:20:00.000Z',
      libraryEpoch: 0, baseRevisions: { [restored.id]: 12 },
    })).resolves.toEqual([]);

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][0]).toBe('/api/device-cards');
    expect(fetchMock.mock.calls[0][1]?.method).toBeUndefined();
  });

  it('does not let an older undo upsert replace a newer re-delete', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 200 })));
    await queueDeviceDeletes([card.id], 'user-restore-delete', {
      libraryEpoch: 7,
      baseRevisions: { [card.id]: 12 },
    });
    const [laterDelete] = await loadDevicePending('user-restore-delete');
    const operationCreatedAt = new Date(Date.parse(laterDelete.updatedAt) - 1_000).toISOString();

    const operations = await queueDeviceUpserts([{ ...card, libraryEpoch: 7, revision: 12 }], 1, 'user-restore-delete', false, {
      operationId: 'restore-card-12',
      operationCreatedAt,
      libraryEpoch: 7,
      baseRevisions: { [card.id]: 12 },
    });

    expect(operations).toEqual([]);
    await expect(loadDevicePending('user-restore-delete')).resolves.toEqual([laterDelete]);
  });

  it('marks an offline upsert for epoch binding without losing it from durable queue', async () => {
    const [operation] = await queueDeviceUpserts([card], 1, 'user-offline', true);

    expect(operation).toMatchObject({
      type: 'upsert',
      ownerUserId: 'user-offline',
      libraryEpoch: -1,
    });
    await expect(loadDevicePending('user-offline')).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'upsert',
          libraryEpoch: -1,
        }),
      ]),
    );
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
    ], 1, 'user-patch', 'daily-review-stable');

    expect(operations).toMatchObject([{
      type: 'patch',
      operation: 'patch',
      cardId: card.id,
      fields: { bookmarked: true },
      fieldMask: ['bookmarked'],
      ownerUserId: 'user-patch',
      opId: 'daily-review-stable',
    }]);
    const [, request] = fetchMock.mock.calls[0];
    expect(JSON.parse(String(request?.body))).toMatchObject({
      cards: [updatedCard],
      pending: [{ type: 'patch', cardId: card.id, fields: { bookmarked: true } }],
      mode: 'merge',
    });
  });

  it('preserves the review operation discriminator when staging a queued review', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const operations = await queueDevicePatches([
      { card: { ...card, reviews: 1 }, fields: { reviews: 1 }, operation: 'review' },
    ], 1, 'user-review', 'review-operation', false, 'review');

    expect(operations).toMatchObject([{
      type: 'patch',
      operation: 'review',
      opId: 'review-operation',
      fields: { reviews: 1 },
    }]);
  });

  it('acknowledges only the operations that were actually flushed', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const operation = {
      type: 'upsert' as const,
      card,
      updatedAt: '2026-07-13T01:00:00.000Z',
      ownerUserId: 'user-ack',
    };

    await acknowledgeDevicePending([operation]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, request] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/device-cards/ack');
    expect(JSON.parse(String(request?.body))).toEqual({
      userId: 'user-ack',
      operations: [operation],
    });
  });

  it('partitions device acknowledgements by owner', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const first = {
      type: 'upsert' as const,
      card,
      opId: 'owner-a-operation',
      updatedAt: '2026-07-13T01:00:00.000Z',
      ownerUserId: 'user-a',
    };
    const second = {
      ...first,
      opId: 'owner-b-operation',
      ownerUserId: 'user-b',
    };

    await acknowledgeDevicePending([first, second]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.map(([, request]) => (
      JSON.parse(String(request?.body)).userId
    )).sort()).toEqual(['user-a', 'user-b']);
  });

  it('requests guarded device-backup cleanup with the exact epoch and revision boundary', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ deleted: false }),
      { status: 200 },
    ));
    vi.stubGlobal('fetch', fetchMock);

    await expect(deleteDeviceCardBackupIfNotNewerThan('user-a', card.id, {
      libraryEpoch: 3,
      revision: 7,
    })).resolves.toBe(false);

    const [url, request] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/device-cards/cleanup');
    expect(JSON.parse(String(request?.body))).toEqual({
      userId: 'user-a',
      cardId: card.id,
      maximum: { libraryEpoch: 3, revision: 7 },
    });
  });

  it('rejects a strict authoritative-card merge when the device backup does not persist it', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 503 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(mergeDeviceCardsStrict([card], 4, 'user-a')).rejects.toThrow(
      'Device card merge failed (503).',
    );

    const [url, request] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/device-cards');
    expect(JSON.parse(String(request?.body))).toEqual({
      cards: [card],
      total: 4,
      mode: 'reconcile',
      ownerUserId: 'user-a',
    });
  });

  it('classifies an account-owner conflict from a stale strict merge', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ error: 'Device backup belongs to another account' }),
      { status: 409 },
    )));

    await expect(mergeDeviceCardsStrict([card], 1, 'user-a'))
      .rejects.toBeInstanceOf(DeviceBackupOwnerConflictError);
  });

  it('treats owner-conflict cleanup as an untouched backup', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ error: 'Device backup belongs to another account' }),
      { status: 409 },
    )));

    await expect(deleteDeviceCardBackupIfNotNewerThan('user-b', card.id, {
      libraryEpoch: 3,
      revision: 7,
    })).resolves.toBe(false);
  });

  it('clears the owner-scoped queue after cloud success when the shared backup belongs to another account', async () => {
    const storage = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ error: 'Device backup belongs to another account' }),
      { status: 409 },
    )));
    await clearDevicePending('user-owner-conflict');
    const [operation] = await queueDeviceUpserts(
      [{ ...card, id: 'owner-conflict-card' }],
      1,
      'user-owner-conflict',
    );

    await expect(loadDevicePending('user-owner-conflict')).resolves.toHaveLength(1);
    await expect(acknowledgeDevicePending([operation])).resolves.toBeUndefined();
    await expect(loadDevicePending('user-owner-conflict')).resolves.toEqual([]);
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
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ granted: true, token: 'lease', expiresAt: Date.now() + 60_000 }), { status: 200 }))
      .mockResolvedValue(new Response(JSON.stringify({ granted: true, expiresAt: Date.now() + 60_000 }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(withDevicePendingFlush('user-1', false, async () => undefined)).resolves.toMatchObject({ acquired: true });

    const [url, request] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/device-cards/flush');
    expect(JSON.parse(String(request?.body))).toMatchObject({ userId: 'user-1', token: expect.any(String) });
  });

  it('marks an explicit retry as a forced lease attempt', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ granted: true, token: 'lease', expiresAt: Date.now() + 60_000 }), { status: 200 }))
      .mockResolvedValue(new Response(JSON.stringify({ granted: true, expiresAt: Date.now() + 60_000 }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(withDevicePendingFlush('user-1', true, async () => undefined)).resolves.toMatchObject({ acquired: true });

    const [, request] = fetchMock.mock.calls[0];
    expect(JSON.parse(String(request?.body))).toMatchObject({ userId: 'user-1', force: true, token: expect.any(String) });
  });

  it('renews a held lease past its original expiry and releases exactly once after a callback failure', async () => {
    vi.useFakeTimers();
    let finish!: () => void;
    const held = new Promise<void>(resolve => { finish = resolve; });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ granted: true, token: 'lease', expiresAt: Date.now() + 30_000 }), { status: 200 }))
      .mockResolvedValue(new Response(JSON.stringify({ granted: true, expiresAt: Date.now() + 30_000 }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const flushing = withDevicePendingFlush('user-heartbeat', false, async () => {
      await held;
      throw new Error('callback failed');
    });
    await vi.advanceTimersByTimeAsync(31_000);
    expect(fetchMock.mock.calls.some(([url, request]) => url === '/api/device-cards/flush'
      && (request as RequestInit).method === 'PUT')).toBe(true);
    finish();
    await expect(flushing).rejects.toThrow('callback failed');
    expect(fetchMock.mock.calls.filter(([url, request]) => url === '/api/device-cards/flush'
      && (request as RequestInit).method === 'DELETE')).toHaveLength(1);
  });

  it('surfaces a failed shared lease request instead of treating it as a busy lease', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 403 })));

    await expect(withDevicePendingFlush('user-1', false, async () => undefined)).rejects.toThrow(
      'Device sync coordinator rejected the lease request (403).',
    );
  });

  it('surfaces an unreachable shared lease coordinator', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network unavailable')));

    await expect(withDevicePendingFlush('user-1', false, async () => undefined)).rejects.toThrow('network unavailable');
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
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 200 })));
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

  it('restores an owner-matched pending queue from the shared dev backup', async () => {
    const sharedOperation = {
      type: 'delete' as const,
      operation: 'delete' as const,
      opId: 'shared-recovery-operation',
      cardId: 'shared-recovery-card',
      baseRevision: 2,
      fieldMask: [] as (keyof CardData)[],
      libraryEpoch: 0,
      updatedAt: '2026-08-11T00:00:00.000Z',
      ownerUserId: 'user-shared-recovery',
    };
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: vi.fn(),
      removeItem: vi.fn(),
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      cards: [],
      total: 1,
      ownerUserId: 'user-shared-recovery',
      pending: [sharedOperation],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })));

    await expect(loadDevicePending('user-shared-recovery')).resolves.toEqual([
      sharedOperation,
    ]);
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

  it('keeps the durable browser operation when shared-device acknowledgement fails', async () => {
    const storage = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 200 })));
    const [operation] = await queueDevicePatches([{
      card: { ...card, bookmarked: true },
      fields: { bookmarked: true },
    }], 1, 'user-ack-failure');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('device store unavailable')));

    await expect(acknowledgeDevicePending([operation])).rejects.toThrow('device store unavailable');
    await expect(loadDevicePending('user-ack-failure')).resolves.toMatchObject([{
      opId: operation.opId,
      ownerUserId: 'user-ack-failure',
    }]);
  });

  it('keeps the local queue when the coordinator rejects an acknowledgement for a lost lease', async () => {
    const storage = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 200 })));
    const [operation] = await queueDevicePatches([{ card: { ...card, bookmarked: true }, fields: { bookmarked: true } }], 1, 'user-lease-lost');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'Pending flush lease lost' }), { status: 409 })));

    await expect(acknowledgeDevicePending([operation], { token: 'stale', expiresAt: 0, assertOwnership: async () => undefined })).rejects.toThrow('pending flush lease was lost');
    await expect(loadDevicePending('user-lease-lost')).resolves.toMatchObject([{ opId: operation.opId }]);
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
    expect(resolveDeviceBackupOwner(null, 'user-1', [userOne])).toBeUndefined();
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
