import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CardData } from '../types/card';
import {
  acknowledgeDevicePending,
  acknowledgePendingMutationSettlement,
  acknowledgePendingMutationSettlements,
  acquireDevicePendingFlush,
  clearDevicePending,
  claimDevicePendingForFlush,
  deleteDeviceCardBackupIfNotNewerThan,
  DeviceBackupOwnerConflictError,
  loadBrowserPending,
  loadDeviceCards,
  loadDevicePending,
  loadPendingMutationSettlements,
  MAX_PENDING_MUTATION_SETTLEMENTS,
  mergeDeviceCardsStrict,
  mergePendingOperations,
  PendingMutationSettlementCapacityError,
  queueDeviceDeletes,
  queueDevicePatches,
  queueDeviceUpserts,
  resolveDeviceBackupOwner,
  recordDeviceCardAlias,
  retargetPendingCardPatches,
  settleDevicePending,
  subscribeToDeviceCards,
  subscribeToPendingMutationSettlements,
  type DevicePendingOperation,
  type PendingMutationSettlement,
} from './deviceSync';
import {
  loadStoredPendingState,
  updateStoredPendingState,
} from './pendingOperationStore';

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

const seedPendingMutationSettlements = async (
  userId: string,
  settlements: readonly PendingMutationSettlement[],
): Promise<void> => {
  await updateStoredPendingState<DevicePendingOperation, PendingMutationSettlement>(
    userId,
    current => ({
      ...current,
      settlements: settlements.map(settlement => ({
        logicalOperationId: settlement.logicalOperationId,
        settledAt: settlement.settledAt,
        settlement,
      })),
    }),
  );
};

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
      logicalOperations: [{ id: 'bookmark-1', kind: 'patch' as const }],
      updatedAt: '2026-07-22T00:01:00.000Z',
      ownerUserId: 'user-merge',
    };
    const secondPatch = {
      type: 'patch' as const,
      cardId: card.id,
      fields: { imageUrl: 'https://images.pexels.com/stable.jpeg' },
      logicalOperations: [{ id: 'media-1', kind: 'patch' as const }],
      updatedAt: '2026-07-22T00:02:00.000Z',
      ownerUserId: 'user-merge',
    };

    expect(mergePendingOperations([firstPatch, secondPatch])).toEqual([{
      ...secondPatch,
      fields: { bookmarked: true, imageUrl: 'https://images.pexels.com/stable.jpeg' },
      logicalOperations: [
        { id: 'bookmark-1', kind: 'patch' },
        { id: 'media-1', kind: 'patch' },
      ],
    }]);
    const create = {
      type: 'upsert',
      card,
      updatedAt: '2026-07-22T00:00:00.000Z',
      ownerUserId: 'user-merge',
    } as const;
    expect(mergePendingOperations([create, firstPatch])).toEqual([create, firstPatch]);
  });

  it('never coalesces patches or deletes from different library generations', () => {
    const stalePatch = {
      type: 'patch' as const,
      opId: 'stale-patch',
      cardId: card.id,
      fields: { bookmarked: true },
      logicalOperations: [{ id: 'stale-review', kind: 'patch' as const }],
      libraryEpoch: 3,
      updatedAt: '2026-07-22T00:01:00.000Z',
      ownerUserId: 'user-epoch-merge',
    };
    const currentPatch = {
      ...stalePatch,
      opId: 'current-patch',
      fields: { bookmarked: false },
      logicalOperations: [{ id: 'current-review', kind: 'patch' as const }],
      libraryEpoch: 4,
      updatedAt: '2026-07-22T00:02:00.000Z',
    };
    const staleDelete = {
      type: 'delete' as const,
      opId: 'stale-delete',
      cardId: card.id,
      libraryEpoch: 3,
      updatedAt: '2026-07-22T00:03:00.000Z',
      ownerUserId: 'user-epoch-delete',
    };
    const currentDelete = {
      ...staleDelete,
      opId: 'current-delete',
      libraryEpoch: 4,
      updatedAt: '2026-07-22T00:04:00.000Z',
    };

    expect(mergePendingOperations([stalePatch, currentPatch])).toEqual([
      stalePatch,
      currentPatch,
    ]);
    expect(mergePendingOperations([staleDelete, currentDelete])).toEqual([
      staleDelete,
      currentDelete,
    ]);
  });

  it('uses a claimed physical command as a merge barrier for later same-card patches', async () => {
    const userId = 'user-in-flight-barrier';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 200 })));
    await clearDevicePending(userId);
    const [first] = await queueDevicePatches([{
      card: { ...card, bookmarked: true, revision: 1, libraryEpoch: 2 },
      fields: { bookmarked: true },
      baseFields: { bookmarked: false },
    }], 1, userId, 'first-review');

    await expect(claimDevicePendingForFlush(userId)).resolves.toMatchObject([{
      opId: first.opId,
      inFlight: true,
    }]);
    const [second] = await queueDevicePatches([{
      card: { ...card, bookmarked: false, revision: 1, libraryEpoch: 2 },
      fields: { bookmarked: false },
      baseFields: { bookmarked: true },
    }], 1, userId, 'second-review');

    await expect(loadDevicePending(userId)).resolves.toMatchObject([
      {
        opId: first.opId,
        fields: { bookmarked: true },
        logicalOperations: [{ id: 'first-review', kind: 'patch' }],
        inFlight: true,
      },
      {
        opId: second.opId,
        fields: { bookmarked: false },
        baseFields: { bookmarked: true },
        logicalOperations: [{ id: 'second-review', kind: 'patch' }],
      },
    ]);
  });

  it('retargets only dependent patches while preserving operation identity and fields', () => {
    const dependent = {
      type: 'patch' as const,
      operation: 'patch' as const,
      opId: 'media-patch',
      cardId: 'temporary-card',
      fields: { imageUrl: 'https://images.pexels.com/stable.jpeg' },
      fieldMask: ['imageUrl'] as (keyof CardData)[],
      baseRevision: 0,
      libraryEpoch: 3,
      updatedAt: '2026-07-22T00:02:00.000Z',
      ownerUserId: 'user-retarget',
    };
    const independent = {
      ...dependent,
      opId: 'later-patch',
      baseRevision: 5,
      fields: { bookmarked: true },
      fieldMask: ['bookmarked'] as (keyof CardData)[],
    };
    const authoritative = {
      ...card,
      id: 'canonical-card',
      revision: 5,
      libraryEpoch: 4,
    };

    expect(retargetPendingCardPatches(
      [dependent, independent],
      'temporary-card',
      authoritative,
      0,
    )).toEqual([{
      ...dependent,
      cardId: authoritative.id,
      baseRevision: 5,
      libraryEpoch: 4,
    }, independent]);
  });

  it('keeps a delete over prior creates or later patches until an explicit recreate', () => {
    const created = {
      type: 'upsert' as const,
      card,
      updatedAt: '2026-07-22T00:00:00.000Z',
      ownerUserId: 'user-delete',
    };
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

    expect(mergePendingOperations([created, deleted])).toEqual([deleted]);
    expect(mergePendingOperations([deleted, latePatch])).toEqual([deleted]);
    expect(mergePendingOperations([deleted, latePatch, recreated])).toEqual([recreated]);
  });

  it('retains logical membership when a later command supersedes a pending mutation', () => {
    const patch = {
      type: 'patch' as const,
      cardId: card.id,
      fields: { bookmarked: true },
      logicalOperations: [{ id: 'bookmark-before-delete', kind: 'patch' as const }],
      updatedAt: '2026-07-22T00:01:00.000Z',
      ownerUserId: 'user-logical-delete',
    };
    const deletion = {
      type: 'delete' as const,
      cardId: card.id,
      logicalOperations: [{ id: 'delete-card', kind: 'delete' as const }],
      updatedAt: '2026-07-22T00:02:00.000Z',
      ownerUserId: 'user-logical-delete',
    };
    const recreate = {
      type: 'upsert' as const,
      card,
      updatedAt: '2026-07-22T00:03:00.000Z',
      ownerUserId: 'user-logical-delete',
    };

    expect(mergePendingOperations([patch, deletion])).toEqual([{
      ...deletion,
      logicalOperations: [
        { id: 'bookmark-before-delete', kind: 'patch' },
        { id: 'delete-card', kind: 'delete' },
      ],
    }]);
    expect(mergePendingOperations([patch, deletion, recreate])).toEqual([{
      ...recreate,
      logicalOperations: [
        { id: 'bookmark-before-delete', kind: 'patch' },
        { id: 'delete-card', kind: 'delete' },
      ],
    }]);
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

  it('preserves more than 64 logical operations after durable normalization', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 200 })));
    const userId = 'user-many-logical-operations';
    for (let index = 0; index < 70; index += 1) {
      await queueDevicePatches([{
        card: { ...card, bookmarked: index % 2 === 0 },
        fields: { bookmarked: index % 2 === 0 },
      }], 1, userId, `bookmark-${index}`);
    }

    const [pending] = await loadDevicePending(userId);

    expect(pending).toMatchObject({ type: 'patch', cardId: card.id });
    expect(pending.logicalOperations).toHaveLength(70);
    expect(pending.logicalOperations?.map(operation => operation.id)).toEqual(
      Array.from({ length: 70 }, (_, index) => `bookmark-${index}`),
    );
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
      logicalOperationId: 'delete-card-1',
    });

    expect(operations).toMatchObject([{
      type: 'delete',
      operation: 'delete',
      cardId: 'card-1',
      baseRevision: 12,
      libraryEpoch: 7,
      logicalOperations: [{ id: 'delete-card-1', kind: 'delete' }],
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
      logicalOperations: [{ id: 'daily-review-stable', kind: 'patch' }],
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
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ granted: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(acquireDevicePendingFlush('user-1')).resolves.toBe(true);

    const [url, request] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/device-cards/flush');
    expect(JSON.parse(String(request?.body))).toEqual({ userId: 'user-1' });
  });

  it('marks an explicit retry as a forced lease attempt', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ granted: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(acquireDevicePendingFlush('user-1', true)).resolves.toBe(true);

    const [, request] = fetchMock.mock.calls[0];
    expect(JSON.parse(String(request?.body))).toEqual({ userId: 'user-1', force: true });
  });

  it('surfaces a failed shared lease request instead of treating it as a busy lease', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 403 })));

    await expect(acquireDevicePendingFlush('user-1')).rejects.toThrow(
      'Device sync coordinator rejected the lease request (403).',
    );
  });

  it('surfaces an unreachable shared lease coordinator', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network unavailable')));

    await expect(acquireDevicePendingFlush('user-1')).rejects.toThrow('network unavailable');
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
      inFlight: true,
    }]);
    storage.clear();
    await expect(loadDevicePending('user-migration')).resolves.toEqual([{
      ...legacyOperation,
      operation: 'delete',
      baseRevision: 0,
      fieldMask: [],
      libraryEpoch: 0,
      ownerUserId: 'user-migration',
      inFlight: true,
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

    await expect(loadDevicePending('user-shared-recovery')).resolves.toEqual([{
      ...sharedOperation,
      inFlight: true,
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

  it('keeps a retargeted durable patch ahead of a stale shared-device copy', async () => {
    const userId = 'user-retarget-durable';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 200 })));
    const [operation] = await queueDevicePatches([{
      card: { ...card, id: 'temporary-card', revision: 0, libraryEpoch: 3 },
      fields: { imageUrl: 'https://images.pexels.com/stable.jpeg' },
    }], 1, userId, 'media-patch');
    const authoritative = {
      ...card,
      id: 'canonical-card',
      revision: 5,
      libraryEpoch: 3,
    };

    await recordDeviceCardAlias(userId, 'temporary-card', authoritative, 0, 3);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      cards: [],
      pending: [operation],
      ownerUserId: userId,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })));

    await expect(loadDevicePending(userId)).resolves.toMatchObject([{
      opId: operation.opId,
      cardId: authoritative.id,
      baseRevision: 5,
      libraryEpoch: 3,
      fields: operation.type === 'patch' ? operation.fields : {},
    }]);
  });

  it('publishes the canonical alias and authoritative card to the shared backup', async () => {
    const userId = 'user-shared-alias';
    const authoritative = {
      ...card,
      id: 'canonical-shared',
      revision: 6,
      libraryEpoch: 4,
    };
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await recordDeviceCardAlias(userId, 'temporary-shared', authoritative, 0, 4);

    const [, request] = fetchMock.mock.calls.at(-1) ?? [];
    expect(JSON.parse(String(request?.body))).toMatchObject({
      cards: [authoritative],
      aliases: [{
        fromCardId: 'temporary-shared',
        toCardId: authoritative.id,
        sourceBaseRevision: 0,
        sourceLibraryEpoch: 4,
        targetRevision: 6,
        targetLibraryEpoch: 4,
      }],
      mode: 'reconcile',
      ownerUserId: userId,
    });
  });

  it('rejects an explicit shared-backup alias failure without losing local recovery state', async () => {
    const userId = 'user-failed-shared-alias';
    const authoritative = {
      ...card,
      id: 'canonical-after-failure',
      revision: 6,
      libraryEpoch: 4,
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 503 })));

    await expect(recordDeviceCardAlias(
      userId,
      'temporary-after-failure',
      authoritative,
      0,
      4,
    )).rejects.toThrow('Device card alias reconciliation failed (503).');

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      cards: [],
      pending: [],
      ownerUserId: userId,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })));
    const [queued] = await queueDevicePatches([{
      card: { ...card, id: 'temporary-after-failure', revision: 0, libraryEpoch: 4 },
      fields: { imageUrl: 'https://images.pexels.com/recovered.jpeg' },
    }], 1, userId, 'recovered-media-patch');

    expect(queued).toMatchObject({
      type: 'patch',
      cardId: authoritative.id,
      baseRevision: 6,
      libraryEpoch: 4,
    });
  });

  it('propagates a shared-backup alias transport failure without losing local recovery state', async () => {
    const userId = 'user-rejected-shared-alias';
    const authoritative = {
      ...card,
      id: 'canonical-after-rejection',
      revision: 7,
      libraryEpoch: 4,
    };
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('device store unavailable')));

    await expect(recordDeviceCardAlias(
      userId,
      'temporary-after-rejection',
      authoritative,
      0,
      4,
    )).rejects.toThrow('device store unavailable');

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      cards: [],
      pending: [],
      ownerUserId: userId,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })));
    const [queued] = await queueDevicePatches([{
      card: { ...card, id: 'temporary-after-rejection', revision: 0, libraryEpoch: 4 },
      fields: { imageUrl: 'https://images.pexels.com/recovered-rejection.jpeg' },
    }], 1, userId, 'recovered-rejected-media-patch');

    expect(queued).toMatchObject({
      type: 'patch',
      cardId: authoritative.id,
      baseRevision: 7,
      libraryEpoch: 4,
    });
  });

  it('retargets a patch queued after the canonical alias was recorded', async () => {
    const userId = 'user-late-patch-alias';
    const authoritative = {
      ...card,
      id: 'canonical-late-patch',
      revision: 6,
      libraryEpoch: 4,
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 200 })));
    await recordDeviceCardAlias(userId, 'temporary-late-patch', authoritative, 0, 4);

    const accounting = { version: 1, xp: { delta: 2 } } as const;
    const [queued] = await queueDevicePatches([{
      card: { ...card, id: 'temporary-late-patch', revision: 0, libraryEpoch: 4 },
      fields: { imageUrl: 'https://images.pexels.com/late-patch.jpeg' },
    }], 1, userId, 'late-media-patch', false, accounting);

    expect(queued).toMatchObject({
      type: 'patch',
      cardId: authoritative.id,
      baseRevision: 6,
      libraryEpoch: 4,
      logicalOperations: [{ id: 'late-media-patch', kind: 'patch', accounting }],
    });
    await expect(loadDevicePending(userId)).resolves.toMatchObject([{
      cardId: authoritative.id,
      baseRevision: 6,
      libraryEpoch: 4,
    }]);
  });

  it('retargets a delete queued against a temporary card id', async () => {
    const userId = 'user-delete-alias';
    const authoritative = {
      ...card,
      id: 'canonical-delete',
      revision: 8,
      libraryEpoch: 5,
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 200 })));
    await recordDeviceCardAlias(userId, 'temporary-delete', authoritative, 0, 5);

    const [queued] = await queueDeviceDeletes(['temporary-delete'], userId, {
      libraryEpoch: 5,
      baseRevisions: { 'temporary-delete': 0 },
      logicalOperationId: 'delete-temporary-card',
    });

    expect(queued).toMatchObject({
      type: 'delete',
      cardId: authoritative.id,
      baseRevision: 8,
      libraryEpoch: 5,
      logicalOperations: [{ id: 'delete-temporary-card', kind: 'delete' }],
    });
  });

  it('converges an alias write racing with a late temporary-id patch', async () => {
    const userId = 'user-alias-race';
    const authoritative = {
      ...card,
      id: 'canonical-race',
      revision: 9,
      libraryEpoch: 6,
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 200 })));

    await Promise.all([
      recordDeviceCardAlias(userId, 'temporary-race', authoritative, 0, 6),
      queueDevicePatches([{
        card: { ...card, id: 'temporary-race', revision: 0, libraryEpoch: 6 },
        fields: { audioUrl: 'https://audio.example/race.mp3' },
      }], 1, userId, 'audio-race'),
    ]);

    await expect(loadDevicePending(userId)).resolves.toMatchObject([{
      type: 'patch',
      cardId: authoritative.id,
      baseRevision: 9,
      libraryEpoch: 6,
      logicalOperations: [{ id: 'audio-race', kind: 'patch' }],
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
        imageUrl: 'https://images.pexels.com/stable.jpeg',
      },
      inFlight: true,
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

  it('atomically removes a flushed command and stores its logical settlement', async () => {
    const userId = 'user-durable-settlement';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 200 })));
    await clearDevicePending(userId);
    const accounting = { version: 1, xp: { delta: 2 } } as const;
    const [operation] = await queueDevicePatches([{
      card: { ...card, bookmarked: true, revision: 3, libraryEpoch: 2 },
      fields: { bookmarked: true },
    }], 1, userId, 'review-durable', false, accounting);
    expect(operation.logicalOperations).toEqual([{
      id: 'review-durable',
      kind: 'patch',
      accounting,
    }]);
    const settlement: PendingMutationSettlement = {
      ownerUserId: userId,
      logicalOperationId: 'review-durable',
      kind: 'patch',
      cardId: card.id,
      outcome: 'applied',
      settledAt: '2026-08-16T00:00:02.000Z',
      accounting,
    };

    await expect(settleDevicePending(userId, [operation], [settlement]))
      .resolves.toEqual([settlement]);

    await expect(loadDevicePending(userId)).resolves.toEqual([]);
    await expect(loadPendingMutationSettlements(userId)).resolves.toEqual([settlement]);
  });

  it('keeps cloud mutations queued when settlement capacity is full and recovers after acknowledgement', async () => {
    const userId = 'user-settlement-capacity';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 200 })));
    const settlements = Array.from(
      { length: MAX_PENDING_MUTATION_SETTLEMENTS },
      (_, index): PendingMutationSettlement => ({
        ownerUserId: userId,
        logicalOperationId: `capacity-${index}`,
        kind: 'patch',
        cardId: card.id,
        outcome: 'applied',
        settledAt: new Date(index + 1).toISOString(),
        accounting: { version: 1, xp: { delta: 2 } },
      }),
    );
    await seedPendingMutationSettlements(userId, settlements);
    const [operation] = await queueDevicePatches([{
      card: { ...card, bookmarked: true, revision: 3, libraryEpoch: 2 },
      fields: { bookmarked: true },
    }], 1, userId, 'review-after-capacity', false, {
      version: 1,
      xp: { delta: 2 },
    });

    await expect(claimDevicePendingForFlush(userId))
      .rejects.toBeInstanceOf(PendingMutationSettlementCapacityError);
    await expect(loadDevicePending(userId)).resolves.toMatchObject([{
      opId: operation.opId,
      logicalOperations: [{ id: 'review-after-capacity' }],
    }]);
    await expect(loadPendingMutationSettlements(userId)).resolves.toHaveLength(128);

    await acknowledgePendingMutationSettlement(userId, settlements[0].logicalOperationId);
    await expect(claimDevicePendingForFlush(userId)).resolves.toMatchObject([{
      opId: operation.opId,
      inFlight: true,
    }]);
  });

  it('does not recreate a drained settlement when a stale claimant resumes after capacity refills', async () => {
    const userId = 'user-stale-settlement-claimant';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 200 })));
    await clearDevicePending(userId);
    const accounting = { version: 1, xp: { delta: 2 } } as const;
    await queueDevicePatches([{
      card: { ...card, bookmarked: true, revision: 3, libraryEpoch: 2 },
      fields: { bookmarked: true },
    }], 1, userId, 'review-stale-claimant', false, accounting);
    const [claimed] = await claimDevicePendingForFlush(userId);
    const applied: PendingMutationSettlement = {
      ownerUserId: userId,
      logicalOperationId: 'review-stale-claimant',
      kind: 'patch',
      cardId: card.id,
      outcome: 'applied',
      settledAt: '2026-08-16T00:00:02.000Z',
      accounting,
    };

    await expect(settleDevicePending(userId, [claimed], [applied]))
      .resolves.toEqual([applied]);
    await acknowledgePendingMutationSettlement(userId, applied.logicalOperationId);
    await expect(loadPendingMutationSettlements(userId)).resolves.toEqual([]);

    const capacitySettlements = Array.from(
      { length: MAX_PENDING_MUTATION_SETTLEMENTS },
      (_, index): PendingMutationSettlement => ({
        ownerUserId: userId,
        logicalOperationId: `replacement-${index}`,
        kind: 'patch',
        cardId: card.id,
        outcome: 'applied',
        settledAt: new Date(index + 1).toISOString(),
        accounting,
      }),
    );
    await seedPendingMutationSettlements(userId, capacitySettlements);
    const staleOutcome: PendingMutationSettlement = {
      ...applied,
      outcome: 'discarded-superseded',
      settledAt: '2026-08-16T00:00:03.000Z',
    };

    await expect(settleDevicePending(userId, [claimed], [staleOutcome]))
      .resolves.toEqual([]);

    const state = await loadStoredPendingState<
      DevicePendingOperation,
      PendingMutationSettlement
    >(userId);
    expect(state.operations).toEqual([]);
    expect(state.settlements).toHaveLength(MAX_PENDING_MUTATION_SETTLEMENTS);
    expect(state.settlements.some(
      settlement => settlement.logicalOperationId === applied.logicalOperationId,
    )).toBe(false);
  });

  it('keeps a terminal settlement immutable and removes its logical id from a successor command', async () => {
    const userId = 'user-immutable-settlement';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 200 })));
    await clearDevicePending(userId);
    const accounting = { version: 1, xp: { delta: 2 } } as const;
    const [patch] = await queueDevicePatches([{
      card: { ...card, bookmarked: true, revision: 3, libraryEpoch: 2 },
      fields: { bookmarked: true },
    }], 1, userId, 'review-before-delete', false, accounting);
    await queueDeviceDeletes([card.id], userId, {
      libraryEpoch: 2,
      baseRevisions: { [card.id]: 3 },
      logicalOperationId: 'delete-after-review',
    });
    const applied: PendingMutationSettlement = {
      ownerUserId: userId,
      logicalOperationId: 'review-before-delete',
      kind: 'patch',
      cardId: card.id,
      outcome: 'applied',
      settledAt: '2026-08-16T00:00:03.000Z',
      accounting,
    };

    await settleDevicePending(userId, [patch], [applied]);

    const [successor] = await loadDevicePending(userId);
    expect(successor).toMatchObject({
      type: 'delete',
      logicalOperations: [{ id: 'delete-after-review', kind: 'delete' }],
    });
    const conflicting: PendingMutationSettlement = {
      ...applied,
      outcome: 'discarded-superseded',
      settledAt: '2026-08-16T00:00:04.000Z',
    };
    await expect(settleDevicePending(userId, [successor], [conflicting]))
      .resolves.toEqual([applied]);
    await expect(loadPendingMutationSettlements(userId)).resolves.toEqual([applied]);
  });

  it('preserves a concurrently queued command while settling an older command', async () => {
    const userId = 'user-concurrent-settlement';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 200 })));
    await clearDevicePending(userId);
    const [older] = await queueDevicePatches([{
      card: { ...card, bookmarked: true },
      fields: { bookmarked: true },
    }], 1, userId, 'older-command');
    const settlement: PendingMutationSettlement = {
      ownerUserId: userId,
      logicalOperationId: 'older-command',
      kind: 'patch',
      cardId: card.id,
      outcome: 'applied',
      settledAt: '2026-08-16T00:00:03.000Z',
    };

    await Promise.all([
      settleDevicePending(userId, [older], [settlement]),
      queueDeviceDeletes(['card-after-settlement'], userId, {
        libraryEpoch: 2,
        baseRevisions: { 'card-after-settlement': 1 },
        logicalOperationId: 'newer-command',
      }),
    ]);

    await expect(loadDevicePending(userId)).resolves.toMatchObject([{
      type: 'delete',
      cardId: 'card-after-settlement',
      logicalOperations: [{ id: 'newer-command', kind: 'delete' }],
    }]);
    await expect(loadPendingMutationSettlements(userId)).resolves.toEqual([settlement]);
  });

  it('keeps settlements owner-scoped and acknowledges only the selected record', async () => {
    const userId = 'user-scoped-settlements';
    const otherUserId = 'user-other-settlements';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 200 })));
    await Promise.all([clearDevicePending(userId), clearDevicePending(otherUserId)]);
    const first: PendingMutationSettlement = {
      ownerUserId: userId,
      logicalOperationId: 'first-settlement',
      kind: 'patch',
      cardId: card.id,
      outcome: 'applied',
      settledAt: '2026-08-16T00:00:04.000Z',
    };
    const second: PendingMutationSettlement = {
      ...first,
      logicalOperationId: 'second-settlement',
      settledAt: '2026-08-16T00:00:05.000Z',
    };

    await seedPendingMutationSettlements(userId, [first, second]);
    await expect(settleDevicePending(otherUserId, [], [first])).rejects.toThrow();
    await expect(loadPendingMutationSettlements(otherUserId)).resolves.toEqual([]);

    await acknowledgePendingMutationSettlement(userId, first.logicalOperationId);

    await expect(loadPendingMutationSettlements(userId)).resolves.toEqual([second]);
  });

  it('acknowledges multiple selected settlements atomically', async () => {
    const userId = 'user-batch-settlements';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 200 })));
    await clearDevicePending(userId);
    const settlements: PendingMutationSettlement[] = [
      {
        ownerUserId: userId, logicalOperationId: 'batch-first', kind: 'patch',
        cardId: card.id, outcome: 'applied', settledAt: '2026-08-16T00:00:04.000Z',
      },
      {
        ownerUserId: userId, logicalOperationId: 'batch-second', kind: 'delete',
        cardId: card.id, outcome: 'discarded-missing', settledAt: '2026-08-16T00:00:05.000Z',
      },
      {
        ownerUserId: userId, logicalOperationId: 'batch-third', kind: 'patch',
        cardId: card.id, outcome: 'discarded-superseded', settledAt: '2026-08-16T00:00:06.000Z',
      },
    ];
    await seedPendingMutationSettlements(userId, settlements);

    await acknowledgePendingMutationSettlements(userId, ['batch-first', 'batch-third']);

    await expect(loadPendingMutationSettlements(userId)).resolves.toEqual([settlements[1]]);
  });

  it('publishes a settlement wake-up only after durable state is readable', async () => {
    const userId = 'user-settlement-publication-order';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 200 })));
    await clearDevicePending(userId);
    const [operation] = await queueDeviceDeletes([card.id], userId, {
      libraryEpoch: 2,
      baseRevisions: { [card.id]: 1 },
      logicalOperationId: 'published-settlement',
    });
    const settlement: PendingMutationSettlement = {
      ownerUserId: userId,
      logicalOperationId: 'published-settlement',
      kind: 'delete',
      cardId: card.id,
      outcome: 'applied',
      settledAt: '2026-08-16T00:00:06.000Z',
    };
    let durableRead: Promise<PendingMutationSettlement[]> | undefined;
    const unsubscribe = subscribeToPendingMutationSettlements(published => {
      if (published.logicalOperationId === settlement.logicalOperationId) {
        durableRead = loadPendingMutationSettlements(userId);
      }
    });

    try {
      await settleDevicePending(userId, [operation], [settlement]);
      await expect(durableRead).resolves.toEqual([settlement]);
    } finally {
      unsubscribe();
    }
  });

  it('records the session owner at the shared-store boundary', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await queueDeviceUpserts([card], 1, 'user-1');

    const [, request] = fetchMock.mock.calls[0];
    expect(JSON.parse(String(request?.body))).toMatchObject({ ownerUserId: 'user-1' });
  });

  it('keeps raw ownership conflicts unresolved before normalizing malformed sync metadata', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      cards: [card],
      total: 1,
      ownerUserId: 'user-a',
      cloudSync: {
        userId: 'user-b',
        status: 'invalid',
      },
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })));

    const backup = await loadDeviceCards();

    expect(backup?.cloudSync).toBeNull();
    expect(backup).toHaveProperty('ownerUserId', undefined);
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
