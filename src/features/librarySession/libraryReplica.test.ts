import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DevicePendingOperation } from '../../lib/deviceSync';
import type { CardData } from '../../types/card';
import { scheduleReview } from '../../lib/reviewScheduler';

const mocks = vi.hoisted(() => ({
  acknowledgeDevicePending: vi.fn(),
  applyCardPatchIfCurrent: vi.fn(),
  applyReviewViaCallable: vi.fn(),
  applyReviewWithConflictRecovery: vi.fn(),
  withDevicePendingFlush: vi.fn(async (_userId, _force, operation) => ({ acquired: true, value: await operation({ token: 'test', expiresAt: Infinity, assertOwnership: async () => undefined }) })),
  beginCardMirrorSync: vi.fn(),
  createCardIfAbsent: vi.fn(),
  deleteCardWithTombstone: vi.fn(),
  deleteMirroredCardForGeneration: vi.fn(),
  deleteDeviceCardBackupIfNotNewerThan: vi.fn(),
  deleteMirroredCardIfNotNewerThan: vi.fn(),
  findCardByNormalizedWord: vi.fn(),
  findCardById: vi.fn(),
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
    acknowledgeDevicePending: (operations: unknown[]) => mocks.acknowledgeDevicePending(operations),
    withDevicePendingFlush: mocks.withDevicePendingFlush,
    deleteDeviceCardBackupIfNotNewerThan: mocks.deleteDeviceCardBackupIfNotNewerThan,
    loadDevicePending: mocks.loadDevicePending,
    mergeDeviceCardsStrict: mocks.mergeDeviceCardsStrict,
    queueDeviceDeletes: mocks.queueDeviceDeletes,
    queueDevicePatches: mocks.queueDevicePatches,
    queueDeviceUpserts: mocks.queueDeviceUpserts,
  };
});

vi.mock('../../lib/cardMirror', async () => {
  const actual = await vi.importActual<typeof import('../../lib/cardMirror')>('../../lib/cardMirror');
  return {
    ...actual,
    beginCardMirrorSync: mocks.beginCardMirrorSync,
    deleteMirroredCardForGeneration: mocks.deleteMirroredCardForGeneration,
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
    deleteCardWithTombstone: mocks.deleteCardWithTombstone,
    applyCardPatchIfCurrent: mocks.applyCardPatchIfCurrent,
    findCardByNormalizedWord: mocks.findCardByNormalizedWord,
    findCardById: mocks.findCardById,
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

const createEvents = () => ({
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
  settleReview: vi.fn(),
  verifyEpoch: vi.fn(() => true),
});

const createReplica = (
  cards: readonly CardData[] = [],
  events = createEvents(),
  isOwnerCurrent = () => true,
  epoch: { userId: string; value: number } | null = { userId: 'owner-a', value: 3 },
  isBrowserOnline = true,
  canPublishMutations = () => true,
  canVerifyEpoch = () => true,
) => createLibraryReplica({
  ownerId: 'owner-a',
  isBrowserOnline: () => isBrowserOnline,
  getEpoch: () => epoch,
  getCards: () => cards,
  isOwnerCurrent,
  canVerifyEpoch,
  canPublishMutations,
  getMirrorTotals: () => ({ cloudTotal: 0, cloudStatsTotal: 0 }),
  onError: vi.fn(),
  onPendingCount: vi.fn(),
  onSyncing: vi.fn(),
  getEvents: () => events,
});

describe('Library Replica contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.acknowledgeDevicePending.mockResolvedValue(undefined);
    mocks.beginCardMirrorSync.mockResolvedValue(7);
    mocks.deleteMirroredCardForGeneration.mockResolvedValue(true);
    mocks.findCardByNormalizedWord.mockResolvedValue(null);
    mocks.findCardById.mockResolvedValue(null);
    mocks.finishCardMirrorSync.mockResolvedValue(true);
    mocks.getCardMirrorStatus.mockResolvedValue(null);
    mocks.getLibraryEpoch.mockResolvedValue(3);
    mocks.loadDevicePending.mockResolvedValue([]);
    mocks.invalidateCardMirrorGeneration.mockResolvedValue(true);
    mocks.mergeDeviceCardsStrict.mockResolvedValue(undefined);
    mocks.streamAllCardsInBatches.mockResolvedValue(0);
    mocks.deleteDeviceCardBackupIfNotNewerThan.mockResolvedValue(true);
    mocks.deleteMirroredCardIfNotNewerThan.mockResolvedValue(true);
    mocks.upsertMirroredCardIfNotOlderThan.mockResolvedValue(true);
  });

  it('reconnects cloud reads when a manual retry has no pending changes', async () => {
    const backoffKey = 'lingoflash_cloud_backoff_until_owner-a';
    const localValues = new Map([[backoffKey, String(Date.now() + 60_000)]]);
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => localValues.get(key) ?? null,
      removeItem: (key: string) => { localValues.delete(key); },
    });
    const events = createEvents();
    const replica = createReplica([], events);

    try {
      await replica.retry();
    } finally {
      vi.unstubAllGlobals();
    }

    expect(localValues.has(backoffKey)).toBe(false);
    expect(events.setCloudAvailable).toHaveBeenLastCalledWith(true);
    expect(events.refreshCloud).toHaveBeenCalledOnce();
  });

  it.each(['create', 'delete', 'review'] as const)(
    'does not flush queued %s mutations after session loss during epoch verification, then resumes after reauth',
    async kind => {
      let resolveEpoch!: (value: number) => void;
      const delayedEpoch = new Promise<number>(resolve => { resolveEpoch = resolve; });
      mocks.getLibraryEpoch.mockReturnValueOnce(delayedEpoch);
      const candidate = card(`lost-session-${kind}`, { revision: 4, libraryEpoch: 3 });
      const updatedAt = '2026-09-25T06:20:00.000Z';
      const reviewedAt = new Date('2026-09-25T06:19:00.000Z');
      const reviewFields = scheduleReview(candidate, 'good', reviewedAt);
      const operation: DevicePendingOperation = kind === 'create'
        ? {
            type: 'upsert', operation: 'create', opId: `create-${kind}`, card: candidate,
            fieldMask: [], baseRevision: 4, libraryEpoch: 3, updatedAt, ownerUserId: 'owner-a',
          }
        : kind === 'delete'
          ? {
              type: 'delete', operation: 'delete', opId: `delete-${kind}`, cardId: candidate.id,
              fieldMask: [], baseRevision: 4, libraryEpoch: 3, updatedAt, ownerUserId: 'owner-a',
            }
          : {
              type: 'patch', operation: 'review', opId: `review-${kind}`, cardId: candidate.id,
              fields: reviewFields, fieldMask: Object.keys(reviewFields) as Array<keyof CardData>,
              baseRevision: 4, libraryEpoch: 3, updatedAt, ownerUserId: 'owner-a',
            };
      let canPublish = true;
      let canVerify = true;
      mocks.loadDevicePending.mockResolvedValue([operation]);
      mocks.findCardByNormalizedWord.mockResolvedValue(null);
      mocks.createCardIfAbsent.mockResolvedValue({ created: true, card: { ...candidate, revision: 5 } });
      mocks.deleteCardWithTombstone.mockResolvedValue({
        deleted: true,
        tombstone: { cardId: candidate.id, opId: `delete-${kind}`, libraryEpoch: 3, revision: 5, deletedAt: updatedAt },
      });
      mocks.applyReviewWithConflictRecovery.mockImplementation(async (command, apply) => apply(command));
      mocks.applyReviewViaCallable.mockResolvedValue({
        applied: true, duplicate: false, card: { ...candidate, ...reviewFields, revision: 5 },
      });
      const replica = createReplica(
        [candidate],
        createEvents(),
        () => true,
        null,
        true,
        () => canPublish,
        () => canVerify,
      );

      const lostSessionFlush = replica.flush({ manualRetry: true, isBrowserOnline: true });
      expect(mocks.getLibraryEpoch).toHaveBeenCalledOnce();
      canPublish = false;
      canVerify = false;
      resolveEpoch(3);
      await lostSessionFlush;

      expect(mocks.createCardIfAbsent).not.toHaveBeenCalled();
      expect(mocks.deleteCardWithTombstone).not.toHaveBeenCalled();
      expect(mocks.applyReviewViaCallable).not.toHaveBeenCalled();
      expect(mocks.acknowledgeDevicePending).not.toHaveBeenCalled();

      await replica.retry();
      expect(mocks.getLibraryEpoch).toHaveBeenCalledOnce();

      canPublish = true;
      canVerify = true;
      await replica.retry();

      if (kind === 'create') expect(mocks.createCardIfAbsent).toHaveBeenCalledOnce();
      if (kind === 'delete') expect(mocks.deleteCardWithTombstone).toHaveBeenCalledOnce();
      if (kind === 'review') expect(mocks.applyReviewViaCallable).toHaveBeenCalledOnce();
      expect(mocks.acknowledgeDevicePending).toHaveBeenCalledWith([operation]);
    },
  );

  it('stages creates with the verified owner epoch in the mirror and pending queue', async () => {
    const candidate = card('create-card');
    mocks.queueDeviceUpserts.mockResolvedValue([]);
    const replica = createReplica();

    await replica.stage({ type: 'create', cards: [candidate], nextTotal: 8 });

    const expected = expect.objectContaining({ id: candidate.id, libraryEpoch: 3 });
    expect(mocks.upsertMirroredCardBatch).toHaveBeenCalledWith('owner-a', [expected]);
    expect(mocks.queueDeviceUpserts).toHaveBeenCalledWith([expected], 8, 'owner-a', false);
  });

  it('restores a full card with its stable operation metadata and captured epoch', async () => {
    const operationCreatedAt = '2026-09-25T06:20:00.000Z';
    const original = card('restore-card', {
      revision: 8,
      libraryEpoch: 1,
      createdAt: '2024-02-03T04:05:06.000Z',
      category: 'IELTS',
      customDeck: 'Deep learning',
      origin: 'ai',
      fsrs: {
        due: '2026-09-26T00:00:00.000Z', stability: 4, difficulty: 5,
        elapsedDays: 2, scheduledDays: 3, learningSteps: 0, reps: 7, lapses: 1, state: 2,
      },
      reviews: 7,
      interval: 3,
      easeFactor: 2.3,
    });
    const restored = { ...original, libraryEpoch: 3, revision: 10 };
    const operation = {
      type: 'upsert' as const, operation: 'create' as const, opId: 'restore-card-op',
      card: { ...original, libraryEpoch: 3 }, baseRevision: 8, libraryEpoch: 3,
      fieldMask: [] as (keyof CardData)[], updatedAt: operationCreatedAt, ownerUserId: 'owner-a',
      restore: true as const,
    };
    mocks.queueDeviceUpserts.mockResolvedValue([operation]);
    mocks.loadDevicePending.mockResolvedValue([operation]);
    mocks.createCardIfAbsent.mockResolvedValue({ created: true, card: restored });
    const replica = createReplica();

    await expect(replica.restoreDeviceCard(original, {
      ownerId: 'owner-a', expectedLibraryEpoch: 3, operationId: 'restore-card-op', operationCreatedAt,
    })).resolves.toEqual({ status: 'restored', card: restored });

    expect(mocks.queueDeviceUpserts).toHaveBeenCalledWith(
      [{ ...original, libraryEpoch: 3 }],
      1,
      'owner-a',
      false,
      {
        operationId: 'restore-card-op', operationCreatedAt, libraryEpoch: 3,
        baseRevisions: { 'restore-card': 8 },
        restore: true,
      },
    );
    expect(mocks.createCardIfAbsent).toHaveBeenCalledWith(expect.anything(), 'owner-a', { ...original, libraryEpoch: 3 }, {
      libraryEpoch: 3, baseRevision: 8, opId: 'restore-card-op', operationCreatedAt, restore: true,
    });
    expect(mocks.queueDeviceUpserts.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.createCardIfAbsent.mock.invocationCallOrder[0],
    );
    expect(mocks.upsertMirroredCardIfNotOlderThan).toHaveBeenCalledWith('owner-a', restored);
  });

  it('replays a committed undo through the pending queue without creating or counting it twice', async () => {
    const operationCreatedAt = '2026-09-25T06:20:00.000Z';
    const original = card('replayed-restore', {
      revision: 8, libraryEpoch: 1, createdAt: '2024-02-03T04:05:06.000Z',
      customDeck: 'Deep learning', origin: 'ai', reviews: 7,
    });
    const operation = {
      type: 'upsert' as const, operation: 'create' as const, opId: 'replayed-restore-op',
      card: { ...original, libraryEpoch: 3 }, baseRevision: 8, libraryEpoch: 3,
      fieldMask: [] as (keyof CardData)[], updatedAt: operationCreatedAt, ownerUserId: 'owner-a',
      restore: true as const,
    };
    const authoritative = { ...original, libraryEpoch: 3, revision: 10 };
    const events = createEvents();
    mocks.queueDeviceUpserts.mockResolvedValue([operation]);
    mocks.loadDevicePending.mockResolvedValue([operation]);
    mocks.createCardIfAbsent
      .mockResolvedValueOnce({ created: true, card: authoritative })
      .mockResolvedValueOnce({ created: false, card: authoritative });
    const replica = createReplica([], events);

    await expect(replica.restoreDeviceCard(original, {
      ownerId: 'owner-a', expectedLibraryEpoch: 3,
      operationId: operation.opId, operationCreatedAt,
    })).resolves.toEqual({ status: 'restored', card: authoritative });
    expect(mocks.acknowledgeDevicePending).not.toHaveBeenCalled();
    expect(events.setCloudTotal).not.toHaveBeenCalled();
    expect(events.settleReview).not.toHaveBeenCalled();

    mocks.findCardByNormalizedWord.mockResolvedValue(authoritative);
    await replica.flush({
      manualRetry: true,
      verifiedEpoch: { userId: 'owner-a', value: 3 },
      isBrowserOnline: true,
    });

    expect(mocks.createCardIfAbsent).toHaveBeenCalledTimes(2);
    expect(mocks.createCardIfAbsent).toHaveBeenLastCalledWith(
      expect.anything(), 'owner-a', { ...original, libraryEpoch: 3 }, {
        libraryEpoch: 3, baseRevision: 8, opId: operation.opId, operationCreatedAt, restore: true,
      },
    );
    expect(mocks.acknowledgeDevicePending).toHaveBeenCalledWith([operation]);
    expect(mocks.mergeDeviceCardsStrict).toHaveBeenLastCalledWith(
      [authoritative], 1, 'owner-a', expect.any(Object),
    );
    expect(events.setCloudTotal).not.toHaveBeenCalled();
    expect(events.settleReview).not.toHaveBeenCalled();
  });

  it('retains restore intent across a lost create response and queued retry', async () => {
    const operationCreatedAt = '2026-09-25T06:20:00.000Z';
    const original = card('lost-restore-response', {
      revision: 8, libraryEpoch: 3, createdAt: '2024-02-03T04:05:06.000Z', category: 'IELTS',
    });
    const candidate = { ...original, libraryEpoch: 3 };
    const operation = {
      type: 'upsert' as const, operation: 'create' as const, opId: 'lost-restore-response-op',
      card: candidate, baseRevision: 8, libraryEpoch: 3,
      fieldMask: [] as (keyof CardData)[], updatedAt: operationCreatedAt, ownerUserId: 'owner-a',
      restore: true as const,
    };
    const authoritative = { ...candidate, revision: 9 };
    mocks.loadDevicePending.mockResolvedValue([operation]);
    mocks.createCardIfAbsent
      .mockRejectedValueOnce(new Error('response lost after server commit'))
      .mockResolvedValueOnce({ created: false, card: authoritative });
    const replica = createReplica();
    const flushOptions = {
      manualRetry: true,
      verifiedEpoch: { userId: 'owner-a', value: 3 },
      isBrowserOnline: true,
    } as const;

    await replica.flush(flushOptions);

    expect(mocks.acknowledgeDevicePending).not.toHaveBeenCalled();
    expect(mocks.createCardIfAbsent).toHaveBeenNthCalledWith(
      1, expect.anything(), 'owner-a', candidate, {
        libraryEpoch: 3, baseRevision: 8, opId: operation.opId, operationCreatedAt, restore: true,
      },
    );

    await replica.flush(flushOptions);

    expect(mocks.createCardIfAbsent).toHaveBeenNthCalledWith(
      2, expect.anything(), 'owner-a', candidate, {
        libraryEpoch: 3, baseRevision: 8, opId: operation.opId, operationCreatedAt, restore: true,
      },
    );
    expect(mocks.acknowledgeDevicePending).toHaveBeenCalledWith([operation]);
  });

  it('keeps offline undo queued at the captured epoch without rebinding it', async () => {
    const operationCreatedAt = '2026-09-25T06:20:00.000Z';
    const original = card('offline-restore', {
      revision: 4, libraryEpoch: 1, createdAt: '2023-01-02T00:00:00.000Z',
      origin: 'manual', customDeck: 'Travel', reviews: 9,
    });
    const operation = {
      type: 'upsert' as const, operation: 'create' as const, opId: 'offline-restore-op',
      card: { ...original, libraryEpoch: 3 }, baseRevision: 4, libraryEpoch: 3,
      fieldMask: [] as (keyof CardData)[], updatedAt: operationCreatedAt, ownerUserId: 'owner-a',
      restore: true as const,
    };
    mocks.queueDeviceUpserts.mockResolvedValue([operation]);
    mocks.loadDevicePending.mockResolvedValue([operation]);
    const replica = createReplica([], createEvents(), () => true, { userId: 'owner-a', value: 3 }, false);

    await expect(replica.restoreDeviceCard(original, {
      ownerId: 'owner-a', expectedLibraryEpoch: 3, operationId: 'offline-restore-op', operationCreatedAt,
    })).resolves.toEqual({ status: 'queued', card: { ...original, libraryEpoch: 3 } });

    expect(mocks.createCardIfAbsent).not.toHaveBeenCalled();
    expect(mocks.queueDeviceUpserts).toHaveBeenCalledWith(
      [{ ...original, libraryEpoch: 3 }], 1, 'owner-a', false,
      { operationId: 'offline-restore-op', operationCreatedAt, libraryEpoch: 3, baseRevisions: { 'offline-restore': 4 }, restore: true },
    );
  });

  it('blocks restore when the captured owner or epoch is no longer current', async () => {
    const candidate = card('stale-restore');
    const options = {
      ownerId: 'owner-a', expectedLibraryEpoch: 3,
      operationId: 'stale-restore-op', operationCreatedAt: '2026-09-25T06:20:00.000Z',
    };
    const changedOwner = createReplica([], createEvents(), () => false);
    const changedEpoch = createReplica([], createEvents(), () => true, { userId: 'owner-a', value: 4 });

    await expect(changedOwner.restoreDeviceCard(candidate, options)).resolves.toEqual({
      status: 'conflict', reason: 'owner-changed',
    });
    await expect(changedEpoch.restoreDeviceCard(candidate, options)).resolves.toEqual({
      status: 'conflict', reason: 'epoch-changed',
    });
    expect(mocks.queueDeviceUpserts).not.toHaveBeenCalled();
    expect(mocks.createCardIfAbsent).not.toHaveBeenCalled();
  });

  it('does not publish an undo superseded by a newer re-delete', async () => {
    const operationCreatedAt = '2026-09-25T06:20:00.000Z';
    const original = card('redeleted-restore', { libraryEpoch: 3, revision: 5 });
    const deletion = {
      type: 'delete' as const, operation: 'delete' as const, opId: 'newer-delete',
      cardId: original.id, baseRevision: 5, libraryEpoch: 3,
      fieldMask: [] as (keyof CardData)[], updatedAt: '2026-09-25T06:20:01.000Z', ownerUserId: 'owner-a',
    };
    mocks.queueDeviceUpserts.mockResolvedValue([]);
    mocks.loadDevicePending.mockResolvedValue([deletion]);
    const replica = createReplica();

    await expect(replica.restoreDeviceCard(original, {
      ownerId: 'owner-a', expectedLibraryEpoch: 3, operationId: 'old-restore-op', operationCreatedAt,
    })).resolves.toEqual({ status: 'conflict', reason: 'deleted-again' });

    expect(mocks.deleteDeviceCardBackupIfNotNewerThan).toHaveBeenCalledWith(
      'owner-a', original.id, { libraryEpoch: 3, revision: 5 },
    );
    expect(mocks.deleteMirroredCardIfNotNewerThan).toHaveBeenCalledWith(
      'owner-a', original.id, { libraryEpoch: 3, revision: 5 },
    );
    expect(mocks.createCardIfAbsent).not.toHaveBeenCalled();
    expect(mocks.upsertMirroredCardIfNotOlderThan).not.toHaveBeenCalled();
  });

  it('returns the authoritative card without replacing it when create detects an existing card', async () => {
    const operationCreatedAt = '2026-09-25T06:20:00.000Z';
    const original = card('existing-restore', { revision: 3, libraryEpoch: 3, origin: 'manual' });
    const authoritative = { ...original, translation: 'authoritative translation', revision: 11 };
    const operation = {
      type: 'upsert' as const, operation: 'create' as const, opId: 'existing-restore-op',
      card: original, baseRevision: 3, libraryEpoch: 3,
      fieldMask: [] as (keyof CardData)[], updatedAt: operationCreatedAt, ownerUserId: 'owner-a',
    };
    mocks.queueDeviceUpserts.mockResolvedValue([operation]);
    mocks.loadDevicePending.mockResolvedValue([operation]);
    mocks.createCardIfAbsent.mockResolvedValue({ created: false, card: authoritative });
    const replica = createReplica();

    await expect(replica.restoreDeviceCard(original, {
      ownerId: 'owner-a', expectedLibraryEpoch: 3, operationId: 'existing-restore-op', operationCreatedAt,
    })).resolves.toEqual({ status: 'existing', card: authoritative });

    expect(mocks.mergeDeviceCardsStrict).toHaveBeenCalledWith([authoritative], 1, 'owner-a');
    expect(mocks.upsertMirroredCardIfNotOlderThan).toHaveBeenCalledWith('owner-a', authoritative);
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

    expect(mocks.mergeDeviceCardsStrict).toHaveBeenCalledWith([authoritative], 1, 'owner-a', expect.any(Object));
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

  it('promotes and acknowledges a queued review exactly once across a restart', async () => {
    const candidate = card('restart-review', { revision: 4, libraryEpoch: 3 });
    const reviewedAt = new Date('2026-08-24T00:00:00.000Z');
    const fields = scheduleReview(candidate, 'good', reviewedAt);
    const operation = {
      type: 'patch' as const, operation: 'review' as const, opId: 'restart-review-operation', cardId: candidate.id,
      fields, fieldMask: Object.keys(fields) as Array<keyof CardData>, baseRevision: 4, libraryEpoch: 3,
      reviewEffect: { xp: 2 as const },
      updatedAt: reviewedAt.toISOString(), ownerUserId: 'owner-a',
    };
    let pending = [operation];
    mocks.loadDevicePending.mockImplementation(async () => pending);
    mocks.acknowledgeDevicePending.mockImplementation(async (operations: DevicePendingOperation[]) => {
      pending = pending.filter(item => !operations.some(operation => operation.opId === item.opId));
    });
    mocks.applyReviewWithConflictRecovery.mockImplementation(async (command, apply) => apply(command));
    mocks.applyReviewViaCallable.mockResolvedValue({ applied: true, duplicate: false, card: { ...candidate, ...fields, revision: 5 } });
    const options = { manualRetry: true, verifiedEpoch: { userId: 'owner-a', value: 3 }, isBrowserOnline: true } as const;
    const events = createEvents();

    await createReplica([candidate], events).flush(options);
    await createReplica([candidate], events).flush(options);

    expect(mocks.applyReviewViaCallable).toHaveBeenCalledOnce();
    expect(mocks.acknowledgeDevicePending).toHaveBeenCalledOnce();
    expect(events.settleReview).toHaveBeenCalledOnce();
    expect(events.settleReview).toHaveBeenCalledWith(operation.opId, { xp: 2 });
  });

  it('leaves a committed review queued after an owner switch until the current owner settles it', async () => {
    const candidate = card('owner-switch-review', { revision: 4, libraryEpoch: 3 });
    const reviewedAt = new Date('2026-08-24T00:00:00.000Z');
    const fields = scheduleReview(candidate, 'good', reviewedAt);
    const operation = {
      type: 'patch' as const, operation: 'review' as const, opId: 'owner-switch-operation', cardId: candidate.id,
      fields, fieldMask: Object.keys(fields) as Array<keyof CardData>, baseRevision: 4, libraryEpoch: 3,
      reviewEffect: { xp: 2 as const }, updatedAt: reviewedAt.toISOString(), ownerUserId: 'owner-a',
    };
    let pending = [operation];
    let ownerCurrent = true;
    let switchOwner = true;
    mocks.loadDevicePending.mockImplementation(async () => pending);
    mocks.acknowledgeDevicePending.mockImplementation(async (operations: DevicePendingOperation[]) => {
      pending = pending.filter(item => !operations.some(candidate => candidate.opId === item.opId));
    });
    mocks.applyReviewWithConflictRecovery.mockImplementation(async (command, apply) => {
      const result = await apply(command);
      if (switchOwner) {
        ownerCurrent = false;
        switchOwner = false;
      }
      return result;
    });
    mocks.applyReviewViaCallable.mockResolvedValue({ applied: true, duplicate: false, card: { ...candidate, ...fields, revision: 5 } });
    const events = createEvents();
    const options = { manualRetry: true, verifiedEpoch: { userId: 'owner-a', value: 3 }, isBrowserOnline: true } as const;

    await createReplica([candidate], events, () => ownerCurrent).flush(options);
    expect(mocks.acknowledgeDevicePending).not.toHaveBeenCalled();
    expect(events.settleReview).not.toHaveBeenCalled();

    ownerCurrent = true;
    await createReplica([candidate], events, () => ownerCurrent).flush(options);
    expect(events.settleReview).toHaveBeenCalledOnce();
    expect(mocks.acknowledgeDevicePending).toHaveBeenCalledOnce();
  });

  it('does not acknowledge a committed review when settlement fails', async () => {
    const candidate = card('settlement-failure', { revision: 4, libraryEpoch: 3 });
    const reviewedAt = new Date('2026-08-24T00:00:00.000Z');
    const fields = scheduleReview(candidate, 'good', reviewedAt);
    const operation = {
      type: 'patch' as const, operation: 'review' as const, opId: 'settlement-failure-operation', cardId: candidate.id,
      fields, fieldMask: Object.keys(fields) as Array<keyof CardData>, baseRevision: 4, libraryEpoch: 3,
      reviewEffect: { xp: 2 as const }, updatedAt: reviewedAt.toISOString(), ownerUserId: 'owner-a',
    };
    mocks.loadDevicePending.mockResolvedValue([operation]);
    mocks.applyReviewWithConflictRecovery.mockImplementation(async (command, apply) => apply(command));
    mocks.applyReviewViaCallable.mockResolvedValue({ applied: true, duplicate: false, card: { ...candidate, ...fields, revision: 5 } });
    const events = createEvents();
    events.settleReview.mockImplementation(() => { throw new Error('XP queue full'); });

    await createReplica([candidate], events).flush({
      manualRetry: true, verifiedEpoch: { userId: 'owner-a', value: 3 }, isBrowserOnline: true,
    });

    expect(events.settleReview).toHaveBeenCalledOnce();
    expect(mocks.acknowledgeDevicePending).not.toHaveBeenCalled();
  });

  it.each(['stale-review', 'future-review-clock-skew', 'receipt-fingerprint-conflict'] as const)(
    'retires a rejected queued review after restart and refreshes the authoritative card: %s',
    async reason => {
      const candidate = card(`retire-${reason}`, { revision: 4, libraryEpoch: 3 });
      const reviewedAt = new Date('2026-08-24T00:00:00.000Z');
      const fields = scheduleReview(candidate, 'good', reviewedAt);
      const operation = {
        type: 'patch' as const, operation: 'review' as const, opId: `retire-${reason}`, cardId: candidate.id,
        fields, fieldMask: Object.keys(fields) as Array<keyof CardData>, baseRevision: 4, libraryEpoch: 3,
        updatedAt: reviewedAt.toISOString(), ownerUserId: 'owner-a',
      };
      mocks.loadDevicePending.mockResolvedValue([operation]);
      mocks.applyReviewWithConflictRecovery.mockResolvedValue({ applied: false, reason });
      mocks.findCardById.mockResolvedValue({ ...candidate, revision: 5, reviews: 1 });
      const events = createEvents();

      await createReplica([candidate], events).flush({
        manualRetry: true, verifiedEpoch: { userId: 'owner-a', value: 3 }, isBrowserOnline: true,
      });

      expect(mocks.acknowledgeDevicePending).toHaveBeenCalledWith([operation]);
      expect(mocks.findCardById).toHaveBeenCalledWith(expect.anything(), 'owner-a', candidate.id);
      expect(events.advanceCard).toHaveBeenCalled();
      expect(events.advancePracticeCard).toHaveBeenCalled();
      const restoreOrder = mocks.mergeDeviceCardsStrict.mock.invocationCallOrder.at(-1);
      const acknowledgeOrder = mocks.acknowledgeDevicePending.mock.invocationCallOrder.at(-1);
      expect(restoreOrder).toBeDefined();
      expect(acknowledgeOrder).toBeDefined();
      expect(restoreOrder!).toBeLessThan(acknowledgeOrder!);
      expect(events.notify).toHaveBeenCalledWith(expect.stringContaining('not applied'));
      expect(events.refreshCloud).toHaveBeenCalledOnce();
    },
  );

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
    let acknowledgementCalls = 0;
    const acknowledgementSizes: number[] = [];
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
      acknowledgementCalls += 1;
      acknowledgementSizes.push(operations.length);
      remaining = remaining.filter(candidate => !operations.some(operation => operation.opId === candidate.opId));
      if (crashOnce && acknowledgementCalls === 100) {
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
    expect(acknowledgementCalls).toBe(101);
    expect(acknowledgementSizes).toEqual(Array.from({ length: 101 }, () => 1));
    expect(remaining).toEqual([]);
  });

  it('joins an in-flight flush for the same owner', async () => {
    let grantLease: (() => void) | undefined;
    mocks.withDevicePendingFlush.mockImplementation(async (_userId, _force, operation) => new Promise(resolve => {
      grantLease = () => resolve({ acquired: true, value: operation({ token: 'test', expiresAt: Infinity, assertOwnership: async () => undefined }) });
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
    expect(mocks.withDevicePendingFlush).toHaveBeenCalledTimes(1);
    grantLease?.();
    await Promise.all([first, second]);
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
