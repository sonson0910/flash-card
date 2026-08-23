import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DevicePendingOperation } from '../../lib/deviceSync';
import type { CardData } from '../../types/card';
import { scheduleReview } from '../../lib/reviewScheduler';

const mocks = vi.hoisted(() => ({
  acknowledgeDevicePending: vi.fn(),
  applyCardPatchIfCurrent: vi.fn(),
  applyReviewViaCallable: vi.fn(),
  applyReviewWithConflictRecovery: vi.fn(),
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
    applyCardPatchIfCurrent: mocks.applyCardPatchIfCurrent,
    findCardByNormalizedWord: mocks.findCardByNormalizedWord,
    getLibraryEpoch: mocks.getLibraryEpoch,
    streamAllCardsInBatches: mocks.streamAllCardsInBatches,
  };
});

vi.mock('../../lib/cardReviewRepository', async () => {
  const actual = await vi.importActual<typeof import('../../lib/cardReviewRepository')>('../../lib/cardReviewRepository');
  return {
    ...actual,
    applyReviewViaCallable: mocks.applyReviewViaCallable,
    applyReviewWithConflictRecovery: mocks.applyReviewWithConflictRecovery,
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

  it('stages review patches with the protected-operation discriminator', async () => {
    const candidate = card('review-card', { revision: 4, libraryEpoch: 3 });
    const reviewedAt = new Date('2026-08-24T00:00:00.000Z');
    const fields = scheduleReview(candidate, 'good', reviewedAt);
    mocks.queueDevicePatches.mockResolvedValue([]);
    const replica = createReplica([candidate]);

    await replica.stage({
      type: 'patch',
      changes: [{ card: candidate, fields }],
      nextTotal: 8,
      operationId: 'review-operation',
      operation: 'review',
    });

    expect(mocks.queueDevicePatches).toHaveBeenCalledWith(
      [expect.objectContaining({
        card: expect.objectContaining({ id: candidate.id, libraryEpoch: 3 }),
        fields,
        operation: 'review',
      })],
      8,
      'owner-a',
      'review-operation',
      false,
      'review',
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

  it('flushes queued reviews through the protected callable and publishes authoritative fields', async () => {
    const candidate = card('queued-review', { revision: 4, libraryEpoch: 3 });
    const reviewedAt = new Date('2026-08-24T00:00:00.000Z');
    const fields = scheduleReview(candidate, 'good', reviewedAt);
    const operation = {
      type: 'patch' as const,
      operation: 'review' as const,
      opId: 'queued-review-operation',
      cardId: candidate.id,
      fields,
      fieldMask: Object.keys(fields) as Array<keyof CardData>,
      baseRevision: 4,
      libraryEpoch: 3,
      updatedAt: reviewedAt.toISOString(),
      ownerUserId: 'owner-a',
    };
    const authoritative = { ...candidate, ...fields, revision: 5, libraryEpoch: 3 };
    mocks.loadDevicePending.mockResolvedValue([operation]);
    mocks.applyReviewWithConflictRecovery.mockImplementation(async (
      command: Parameters<typeof mocks.applyReviewWithConflictRecovery>[0],
      apply: (value: Parameters<typeof mocks.applyReviewWithConflictRecovery>[0]) => Promise<unknown>,
    ) => apply(command));
    mocks.applyReviewViaCallable.mockResolvedValue({ applied: true, duplicate: false, card: authoritative });
    const replica = createReplica([candidate]);

    await replica.flush({
      manualRetry: true,
      verifiedEpoch: { userId: 'owner-a', value: 3 },
      isBrowserOnline: true,
    });

    expect(mocks.applyReviewViaCallable).toHaveBeenCalledWith(
      expect.anything(),
      'owner-a',
      expect.objectContaining({ opId: operation.opId, rating: 'good', reviewedAt: reviewedAt.toISOString() }),
    );
    expect(mocks.patchMirroredCardBatch).toHaveBeenCalledWith('owner-a', [expect.objectContaining({
      cardId: candidate.id,
      fields: expect.objectContaining({ revision: 5, reviews: authoritative.reviews }),
    })]);
    expect(mocks.acknowledgeDevicePending).toHaveBeenCalledWith([operation]);
  });

  it('leaves an invalid queued review pending without using the generic patch path', async () => {
    const operation = {
      type: 'patch' as const,
      operation: 'review' as const,
      opId: 'invalid-review-operation',
      cardId: 'invalid-review',
      fields: { bookmarked: true },
      fieldMask: ['bookmarked'] as Array<keyof CardData>,
      baseRevision: 4,
      libraryEpoch: 3,
      updatedAt: '2026-08-24T00:00:00.000Z',
      ownerUserId: 'owner-a',
    };
    mocks.loadDevicePending.mockResolvedValue([operation]);
    const replica = createReplica();

    await replica.flush({
      manualRetry: true,
      verifiedEpoch: { userId: 'owner-a', value: 3 },
      isBrowserOnline: true,
    });

    expect(mocks.applyReviewViaCallable).not.toHaveBeenCalled();
    expect(mocks.applyReviewWithConflictRecovery).not.toHaveBeenCalled();
    expect(mocks.applyCardPatchIfCurrent).not.toHaveBeenCalled();
    expect(mocks.acknowledgeDevicePending).not.toHaveBeenCalled();
  });

  it('checkpoints each review before the receipt window can evict an acknowledged operation', async () => {
    let source = card('checkpoint-review', { revision: 4, libraryEpoch: 3 });
    const pending = Array.from({ length: 101 }, (_, index) => {
      const reviewedAt = new Date(Date.UTC(2026, 7, 24, 0, index)).toISOString();
      const fields = scheduleReview(source, 'good', new Date(reviewedAt));
      const operation = {
        type: 'patch' as const,
        operation: 'review' as const,
        opId: `checkpoint-review-${index}`,
        cardId: source.id,
        fields,
        fieldMask: Object.keys(fields) as Array<keyof CardData>,
        baseRevision: source.revision ?? 0,
        libraryEpoch: 3,
        updatedAt: reviewedAt,
        ownerUserId: 'owner-a',
      };
      source = { ...source, ...fields, revision: (source.revision ?? 0) + 1 };
      return operation;
    });
    let remaining = [...pending];
    let acknowledgements = 0;
    let crashOnce = true;
    mocks.loadDevicePending.mockImplementation(async () => remaining);
    mocks.applyReviewWithConflictRecovery.mockImplementation(async (
      command: Parameters<typeof mocks.applyReviewWithConflictRecovery>[0],
      apply: (value: Parameters<typeof mocks.applyReviewWithConflictRecovery>[0]) => Promise<unknown>,
    ) => apply(command));
    mocks.applyReviewViaCallable.mockImplementation(async (_database, _ownerId, command) => ({
      applied: true,
      duplicate: false,
      card: { ...source, ...command.fields, revision: command.baseRevision + 1, libraryEpoch: 3 },
    }));
    mocks.acknowledgeDevicePending.mockImplementation(async (operations: DevicePendingOperation[]) => {
      acknowledgements += operations.length;
      remaining = remaining.filter(candidate => !operations.some(operation => operation.opId === candidate.opId));
      if (crashOnce && acknowledgements === 100) {
        crashOnce = false;
        throw new Error('simulated crash after durable checkpoint');
      }
    });
    const replica = createReplica([source]);
    const options = {
      manualRetry: true,
      verifiedEpoch: { userId: 'owner-a', value: 3 },
      isBrowserOnline: true,
    } as const;

    await replica.flush(options);
    await replica.flush(options);

    expect(mocks.applyReviewViaCallable).toHaveBeenCalledTimes(101);
    expect(acknowledgements).toBe(101);
    expect(remaining).toEqual([]);
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
