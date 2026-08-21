import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CardData } from '../../types/card';

const mocks = vi.hoisted(() => ({
  acknowledgeDevicePending: vi.fn(),
  acquireDevicePendingFlush: vi.fn(),
  beginCardMirrorSync: vi.fn(),
  createCardIfAbsent: vi.fn(),
  deleteMirroredCard: vi.fn(),
  deleteDeviceCardBackupIfNotNewerThan: vi.fn(),
  deleteMirroredCardIfNotNewerThan: vi.fn(),
  findCardByNormalizedWord: vi.fn(),
  finishCardMirrorSync: vi.fn(),
  getCardMirrorStatus: vi.fn(),
  getLibraryEpoch: vi.fn(),
  invalidateCardMirrorGeneration: vi.fn(),
  loadDevicePending: vi.fn(),
  mergeDeviceCardsStrict: vi.fn(),
  patchMirroredCardBatch: vi.fn(),
  queueDeviceDeletes: vi.fn(),
  queueDevicePatches: vi.fn(),
  queueDeviceUpserts: vi.fn(),
  releaseDevicePendingFlush: vi.fn(),
  streamAllCardsInBatches: vi.fn(),
  upsertMirroredCardBatch: vi.fn(),
  upsertMirroredCardIfNotOlderThan: vi.fn(),
}));

vi.mock('../../lib/deviceSync', async () => {
  const actual = await vi.importActual<typeof import('../../lib/deviceSync')>('../../lib/deviceSync');
  return {
    ...actual,
    acknowledgeDevicePending: mocks.acknowledgeDevicePending,
    acquireDevicePendingFlush: mocks.acquireDevicePendingFlush,
    deleteDeviceCardBackupIfNotNewerThan: mocks.deleteDeviceCardBackupIfNotNewerThan,
    loadDevicePending: mocks.loadDevicePending,
    mergeDeviceCardsStrict: mocks.mergeDeviceCardsStrict,
    queueDeviceDeletes: mocks.queueDeviceDeletes,
    queueDevicePatches: mocks.queueDevicePatches,
    queueDeviceUpserts: mocks.queueDeviceUpserts,
    releaseDevicePendingFlush: mocks.releaseDevicePendingFlush,
  };
});

vi.mock('../../lib/cardMirror', async () => {
  const actual = await vi.importActual<typeof import('../../lib/cardMirror')>('../../lib/cardMirror');
  return {
    ...actual,
    beginCardMirrorSync: mocks.beginCardMirrorSync,
    deleteMirroredCard: mocks.deleteMirroredCard,
    deleteMirroredCardIfNotNewerThan: mocks.deleteMirroredCardIfNotNewerThan,
    finishCardMirrorSync: mocks.finishCardMirrorSync,
    getCardMirrorStatus: mocks.getCardMirrorStatus,
    invalidateCardMirrorGeneration: mocks.invalidateCardMirrorGeneration,
    patchMirroredCardBatch: mocks.patchMirroredCardBatch,
    upsertMirroredCardBatch: mocks.upsertMirroredCardBatch,
    upsertMirroredCardIfNotOlderThan: mocks.upsertMirroredCardIfNotOlderThan,
  };
});

vi.mock('../../lib/cardRepository', async () => {
  const actual = await vi.importActual<typeof import('../../lib/cardRepository')>('../../lib/cardRepository');
  return {
    ...actual,
    createCardIfAbsent: mocks.createCardIfAbsent,
    findCardByNormalizedWord: mocks.findCardByNormalizedWord,
    getLibraryEpoch: mocks.getLibraryEpoch,
    streamAllCardsInBatches: mocks.streamAllCardsInBatches,
  };
});

vi.mock('../../lib/firebase', () => ({
  db: { kind: 'database' },
  isFirebaseConfigured: true,
}));

import { createLibraryReplica } from './libraryReplica';

const card = (id: string, overrides: Partial<CardData> = {}): CardData => ({
  id,
  word: id,
  normalizedWord: id,
  translation: `translation ${id}`,
  explanation: '',
  phonetic: '',
  emoji: '📝',
  category: 'Test',
  audioUrl: null,
  imageUrl: null,
  revision: 4,
  libraryEpoch: 1,
  ...overrides,
});

const createReplica = (cards: readonly CardData[] = []) => createLibraryReplica({
  ownerId: 'owner-a',
  getEpoch: () => ({ userId: 'owner-a', value: 3 }),
  getCards: () => cards,
  isOwnerCurrent: () => true,
  getMirrorTotals: () => ({ cloudTotal: 0, cloudStatsTotal: 0 }),
  onError: vi.fn(),
  onPendingCount: vi.fn(),
  onSyncing: vi.fn(),
  getEvents: () => ({
    advanceCard: vi.fn(),
    removeCard: vi.fn(),
    findPracticeCard: vi.fn(),
    advancePracticeCard: vi.fn(),
    removePracticeCard: vi.fn(),
    resetPage: vi.fn(),
    refreshCloud: vi.fn(),
    setCloudAvailable: vi.fn(),
    setCloudTotal: vi.fn(),
    reportError: vi.fn(),
    notify: vi.fn(),
    verifyEpoch: vi.fn(),
  }),
});

describe('Library Replica contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.acknowledgeDevicePending.mockResolvedValue(undefined);
    mocks.acquireDevicePendingFlush.mockResolvedValue(true);
    mocks.beginCardMirrorSync.mockResolvedValue(7);
    mocks.deleteMirroredCard.mockResolvedValue(undefined);
    mocks.findCardByNormalizedWord.mockResolvedValue(null);
    mocks.finishCardMirrorSync.mockResolvedValue(true);
    mocks.getCardMirrorStatus.mockResolvedValue(null);
    mocks.getLibraryEpoch.mockResolvedValue(3);
    mocks.loadDevicePending.mockResolvedValue([]);
    mocks.invalidateCardMirrorGeneration.mockResolvedValue(true);
    mocks.mergeDeviceCardsStrict.mockResolvedValue(undefined);
    mocks.releaseDevicePendingFlush.mockResolvedValue(undefined);
    mocks.streamAllCardsInBatches.mockResolvedValue(0);
    mocks.deleteDeviceCardBackupIfNotNewerThan.mockResolvedValue(true);
    mocks.deleteMirroredCardIfNotNewerThan.mockResolvedValue(true);
    mocks.upsertMirroredCardIfNotOlderThan.mockResolvedValue(true);
  });

  it('stages creates with the verified owner epoch in the mirror and pending queue', async () => {
    const candidate = card('create-card');
    mocks.queueDeviceUpserts.mockResolvedValue([]);
    const replica = createReplica();

    await replica.stage({ type: 'create', cards: [candidate], nextTotal: 8 });

    const expected = expect.objectContaining({ id: candidate.id, libraryEpoch: 3 });
    expect(mocks.upsertMirroredCardBatch).toHaveBeenCalledWith('owner-a', [expected]);
    expect(mocks.queueDeviceUpserts).toHaveBeenCalledWith([expected], 8, 'owner-a', false);
  });

  it('stages patches through the same owner-scoped interface', async () => {
    const candidate = card('patch-card', { bookmarked: true });
    mocks.queueDevicePatches.mockResolvedValue([]);
    const replica = createReplica([candidate]);

    await replica.stage({
      type: 'patch',
      changes: [{ card: candidate, fields: { bookmarked: true } }],
      nextTotal: 8,
      operationId: 'bookmark-operation',
    });

    expect(mocks.patchMirroredCardBatch).toHaveBeenCalledWith('owner-a', [{
      cardId: candidate.id,
      fields: { bookmarked: true },
    }]);
    expect(mocks.queueDevicePatches).toHaveBeenCalledWith(
      [expect.objectContaining({
        card: expect.objectContaining({ id: candidate.id, libraryEpoch: 3 }),
        fields: { bookmarked: true },
      })],
      8,
      'owner-a',
      'bookmark-operation',
      false,
    );
  });

  it('queues deletes before cleaning stores at the known revision boundary', async () => {
    const candidate = card('delete-card', { revision: 7, libraryEpoch: 3 });
    mocks.queueDeviceDeletes.mockResolvedValue([]);
    const replica = createReplica([candidate]);

    await replica.stage({ type: 'delete', cardId: candidate.id });

    expect(mocks.queueDeviceDeletes).toHaveBeenCalledWith(
      [candidate.id],
      'owner-a',
      { libraryEpoch: 3, baseRevisions: { [candidate.id]: 7 } },
    );
    expect(mocks.deleteDeviceCardBackupIfNotNewerThan).toHaveBeenCalledWith(
      'owner-a',
      candidate.id,
      { libraryEpoch: 3, revision: 7 },
    );
    expect(mocks.deleteMirroredCardIfNotNewerThan).toHaveBeenCalledWith(
      'owner-a',
      candidate.id,
      { libraryEpoch: 3, revision: 7 },
    );
    expect(mocks.queueDeviceDeletes.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.deleteDeviceCardBackupIfNotNewerThan.mock.invocationCallOrder[0],
    );
  });

  it('reconciles a created card through both local adapters before acknowledging it', async () => {
    const candidate = card('pending-create', { libraryEpoch: 3 });
    const operation = {
      type: 'upsert' as const,
      operation: 'create' as const,
      opId: 'create-pending-create',
      card: candidate,
      fieldMask: [] as (keyof CardData)[],
      baseRevision: 4,
      libraryEpoch: 3,
      updatedAt: '2026-08-12T00:00:00.000Z',
      ownerUserId: 'owner-a',
    };
    const authoritative = { ...candidate, revision: 5 };
    mocks.loadDevicePending.mockResolvedValue([operation]);
    mocks.createCardIfAbsent.mockResolvedValue({ created: true, card: authoritative });
    const replica = createReplica();

    await replica.flush({
      manualRetry: true,
      verifiedEpoch: { userId: 'owner-a', value: 3 },
      isBrowserOnline: true,
    });

    expect(mocks.mergeDeviceCardsStrict).toHaveBeenCalledWith([authoritative], 1, 'owner-a');
    expect(mocks.upsertMirroredCardIfNotOlderThan).toHaveBeenCalledWith('owner-a', authoritative);
    expect(mocks.acknowledgeDevicePending).toHaveBeenCalledWith([operation]);
    expect(mocks.upsertMirroredCardIfNotOlderThan.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.acknowledgeDevicePending.mock.invocationCallOrder[0],
    );
  });

  it('joins an in-flight flush for the same owner', async () => {
    let grantLease: ((granted: boolean) => void) | undefined;
    mocks.acquireDevicePendingFlush.mockImplementation(() => new Promise<boolean>(resolve => {
      grantLease = resolve;
    }));
    const replica = createReplica();
    const options = {
      manualRetry: true,
      verifiedEpoch: { userId: 'owner-a', value: 3 },
      isBrowserOnline: true,
    } as const;

    const first = replica.flush(options);
    await Promise.resolve();
    const second = replica.flush(options);

    expect(second).toBe(first);
    expect(mocks.acquireDevicePendingFlush).toHaveBeenCalledTimes(1);
    grantLease?.(true);
    await Promise.all([first, second]);
    expect(mocks.releaseDevicePendingFlush).toHaveBeenCalledTimes(1);
  });

  it('publishes an epoch-stable complete mirror after overlaying current pending operations', async () => {
    const legacy = card('legacy-card');
    delete legacy.libraryEpoch;
    const stale = card('stale-card', { libraryEpoch: 2 });
    const current = card('current-card', { libraryEpoch: 3 });
    const future = card('future-card', { libraryEpoch: 4 });
    const pendingCard = card('pending-card', { libraryEpoch: 3 });
    const pending = {
      type: 'upsert' as const,
      operation: 'create' as const,
      opId: 'create-pending-card',
      card: pendingCard,
      fieldMask: [] as (keyof CardData)[],
      baseRevision: 4,
      libraryEpoch: 3,
      updatedAt: '2026-08-12T00:00:00.000Z',
      ownerUserId: 'owner-a',
    };
    mocks.loadDevicePending.mockResolvedValue([pending]);
    mocks.streamAllCardsInBatches.mockImplementation(async (_db, _ownerId, onBatch) => {
      await onBatch([legacy, stale, current, future], 4);
      return 4;
    });
    const replica = createReplica();

    await expect(replica.refreshMirror(true)).resolves.toBe(2);

    expect(mocks.beginCardMirrorSync).toHaveBeenCalledWith('owner-a', 0, 3);
    expect(mocks.upsertMirroredCardBatch).toHaveBeenCalledWith(
      'owner-a',
      [legacy, current],
      7,
    );
    expect(mocks.upsertMirroredCardBatch).toHaveBeenCalledWith('owner-a', [pendingCard], 7);
    expect(mocks.finishCardMirrorSync).toHaveBeenCalledWith('owner-a', 7, 2);
  });

  it('joins an in-flight complete mirror refresh for the same owner', async () => {
    let finishStreaming: (() => void) | undefined;
    mocks.streamAllCardsInBatches.mockImplementation(() => new Promise<number>(resolve => {
      finishStreaming = () => resolve(0);
    }));
    const replica = createReplica();

    const first = replica.refreshMirror(true);
    const second = replica.refreshMirror(true);

    expect(second).toBe(first);
    await vi.waitFor(() => expect(finishStreaming).toBeTypeOf('function'));
    finishStreaming?.();
    await Promise.all([first, second]);
    expect(mocks.streamAllCardsInBatches).toHaveBeenCalledTimes(1);
  });
});
