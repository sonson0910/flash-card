import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CardData } from '../../types/card';

const mocks = vi.hoisted(() => ({
  acquireDevicePendingFlush: vi.fn(),
  applyCardPatchIfCurrent: vi.fn(),
  beginCardMirrorSync: vi.fn(),
  createCardIfAbsent: vi.fn(),
  deleteCardWithTombstone: vi.fn(),
  deleteMirroredCard: vi.fn(),
  deleteDeviceCardBackupIfNotNewerThan: vi.fn(),
  deleteMirroredCardIfOlderThan: vi.fn(),
  deleteMirroredCardIfNotNewerThan: vi.fn(),
  findCardByNormalizedWord: vi.fn(),
  finishCardMirrorSync: vi.fn(),
  getCardMirrorStatus: vi.fn(),
  getLibraryEpoch: vi.fn(),
  invalidateCardMirrorGeneration: vi.fn(),
  loadDevicePending: vi.fn(),
  claimDevicePendingForFlush: vi.fn(),
  mergeDeviceCardsStrict: vi.fn(),
  patchMirroredCardBatch: vi.fn(),
  queueDeviceDeletes: vi.fn(),
  queueDevicePatches: vi.fn(),
  queueDeviceUpserts: vi.fn(),
  releaseDevicePendingFlush: vi.fn(),
  publishPendingCreateSettlement: vi.fn(),
  settleDevicePending: vi.fn(),
  recordDeviceCardAlias: vi.fn(),
  streamAllCardsInBatches: vi.fn(),
  upsertMirroredCardBatch: vi.fn(),
  upsertMirroredCardIfNotOlderThan: vi.fn(),
}));

vi.mock('../../lib/deviceSync', async () => {
  const actual = await vi.importActual<typeof import('../../lib/deviceSync')>('../../lib/deviceSync');
  return {
    ...actual,
    acquireDevicePendingFlush: mocks.acquireDevicePendingFlush,
    deleteDeviceCardBackupIfNotNewerThan: mocks.deleteDeviceCardBackupIfNotNewerThan,
    loadDevicePending: mocks.loadDevicePending,
    claimDevicePendingForFlush: mocks.claimDevicePendingForFlush,
    mergeDeviceCardsStrict: mocks.mergeDeviceCardsStrict,
    queueDeviceDeletes: mocks.queueDeviceDeletes,
    queueDevicePatches: mocks.queueDevicePatches,
    queueDeviceUpserts: mocks.queueDeviceUpserts,
    releaseDevicePendingFlush: mocks.releaseDevicePendingFlush,
    publishPendingCreateSettlement: mocks.publishPendingCreateSettlement,
    settleDevicePending: mocks.settleDevicePending,
    recordDeviceCardAlias: mocks.recordDeviceCardAlias,
  };
});

vi.mock('../../lib/cardMirror', async () => {
  const actual = await vi.importActual<typeof import('../../lib/cardMirror')>('../../lib/cardMirror');
  return {
    ...actual,
    beginCardMirrorSync: mocks.beginCardMirrorSync,
    deleteMirroredCard: mocks.deleteMirroredCard,
    deleteMirroredCardIfOlderThan: mocks.deleteMirroredCardIfOlderThan,
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
    applyCardPatchIfCurrent: mocks.applyCardPatchIfCurrent,
    createCardIfAbsent: mocks.createCardIfAbsent,
    deleteCardWithTombstone: mocks.deleteCardWithTombstone,
    findCardByNormalizedWord: mocks.findCardByNormalizedWord,
    getLibraryEpoch: mocks.getLibraryEpoch,
    streamAllCardsInBatches: mocks.streamAllCardsInBatches,
  };
});

vi.mock('../../lib/firebase', () => ({
  db: { kind: 'database' },
  isFirebaseConfigured: true,
}));

import { PendingMutationSettlementCapacityError } from '../../lib/deviceSync';
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

const createReplica = (
  cards: readonly CardData[] = [],
  mirrorTotals = { cloudTotal: 0, cloudStatsTotal: 0 },
  onError = vi.fn(),
) => createLibraryReplica({
  ownerId: 'owner-a',
  getEpoch: () => ({ userId: 'owner-a', value: 3 }),
  getCards: () => cards,
  isOwnerCurrent: () => true,
  getMirrorTotals: () => mirrorTotals,
  onError,
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
    settleCreate: vi.fn(),
  }),
});

describe('Library Replica contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.acquireDevicePendingFlush.mockResolvedValue(true);
    mocks.applyCardPatchIfCurrent.mockResolvedValue({ applied: true, revision: 2 });
    mocks.deleteCardWithTombstone.mockResolvedValue({
      deleted: true,
      tombstone: { libraryEpoch: 3, revision: 5 },
    });
    mocks.beginCardMirrorSync.mockResolvedValue(7);
    mocks.deleteMirroredCard.mockResolvedValue(undefined);
    mocks.deleteMirroredCardIfOlderThan.mockResolvedValue(true);
    mocks.findCardByNormalizedWord.mockResolvedValue(null);
    mocks.finishCardMirrorSync.mockResolvedValue(true);
    mocks.getCardMirrorStatus.mockResolvedValue(null);
    mocks.getLibraryEpoch.mockResolvedValue(3);
    mocks.loadDevicePending.mockResolvedValue([]);
    mocks.claimDevicePendingForFlush.mockImplementation((userId: string) => {
      const loadPending = mocks.loadDevicePending.getMockImplementation();
      return loadPending ? loadPending(userId) : Promise.resolve([]);
    });
    mocks.invalidateCardMirrorGeneration.mockResolvedValue(true);
    mocks.mergeDeviceCardsStrict.mockResolvedValue(undefined);
    mocks.releaseDevicePendingFlush.mockResolvedValue(undefined);
    mocks.settleDevicePending.mockImplementation(async (
      _ownerId: string,
      _operations: readonly unknown[],
      settlements: readonly unknown[],
    ) => settlements);
    mocks.recordDeviceCardAlias.mockResolvedValue([]);
    mocks.streamAllCardsInBatches.mockResolvedValue(0);
    mocks.upsertMirroredCardBatch.mockResolvedValue(undefined);
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
    expect(mocks.queueDeviceUpserts.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.upsertMirroredCardBatch.mock.invocationCallOrder[0],
    );
  });

  it('retains a queued create when its later mirror write is interrupted', async () => {
    const candidate = card('interrupted-create');
    mocks.queueDeviceUpserts.mockResolvedValue([]);
    mocks.upsertMirroredCardBatch.mockRejectedValue(new Error('IndexedDB interrupted'));
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const replica = createReplica();

    try {
      await expect(replica.stage({ type: 'create', cards: [candidate], nextTotal: 8 }))
        .resolves.toEqual([]);
      expect(mocks.queueDeviceUpserts).toHaveBeenCalledWith(
        [expect.objectContaining({ id: candidate.id, libraryEpoch: 3 })],
        8,
        'owner-a',
        false,
      );
      expect(mocks.queueDeviceUpserts.mock.invocationCallOrder[0]).toBeLessThan(
        mocks.upsertMirroredCardBatch.mock.invocationCallOrder[0],
      );
    } finally {
      warning.mockRestore();
    }
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
      undefined,
    );
    expect(mocks.queueDevicePatches.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.patchMirroredCardBatch.mock.invocationCallOrder[0],
    );
  });

  it('queues deletes before cleaning stores at the known revision boundary', async () => {
    const candidate = card('delete-card', { revision: 7, libraryEpoch: 3 });
    mocks.queueDeviceDeletes.mockResolvedValue([]);
    const replica = createReplica([candidate]);

    await replica.stage({
      type: 'delete',
      cardId: candidate.id,
      context: { logicalOperationId: 'delete-logical-id' },
    });

    expect(mocks.queueDeviceDeletes).toHaveBeenCalledWith(
      [candidate.id],
      'owner-a',
      {
        libraryEpoch: 3,
        baseRevisions: { [candidate.id]: 7 },
        logicalOperationId: 'delete-logical-id',
      },
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
    expect(mocks.settleDevicePending).toHaveBeenCalledWith('owner-a', [operation], []);
    expect(mocks.publishPendingCreateSettlement).toHaveBeenCalledWith({
      operation,
      authoritativeCard: authoritative,
      outcome: 'created',
    });
    expect(mocks.upsertMirroredCardIfNotOlderThan.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.settleDevicePending.mock.invocationCallOrder[0],
    );
    expect(mocks.settleDevicePending.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.publishPendingCreateSettlement.mock.invocationCallOrder[0],
    );
  });

  it('durably settles logical mutations carried by a terminal recreate before publishing create completion', async () => {
    const candidate = card('recreated-card', { libraryEpoch: 3 });
    const operation = {
      type: 'upsert' as const,
      operation: 'create' as const,
      opId: 'create-recreated-card',
      card: candidate,
      fieldMask: [] as (keyof CardData)[],
      baseRevision: 4,
      libraryEpoch: 3,
      updatedAt: '2026-08-12T00:00:00.000Z',
      ownerUserId: 'owner-a',
      logicalOperations: [
        {
          id: 'review-before-recreate',
          kind: 'patch' as const,
          accounting: { version: 1 as const, xp: { delta: 2 } },
        },
        { id: 'delete-before-recreate', kind: 'delete' as const },
      ],
    };
    const authoritative = { ...candidate, revision: 5 };
    mocks.loadDevicePending.mockResolvedValue([operation]);
    mocks.createCardIfAbsent.mockResolvedValue({ created: true, card: authoritative });
    const replica = createReplica();

    const report = await replica.flush({
      manualRetry: true,
      verifiedEpoch: { userId: 'owner-a', value: 3 },
      isBrowserOnline: true,
    });

    expect(report.settlements).toMatchObject([
      {
        ownerUserId: 'owner-a',
        logicalOperationId: 'review-before-recreate',
        kind: 'patch',
        cardId: candidate.id,
        outcome: 'discarded-superseded',
        accounting: { version: 1, xp: { delta: 2 } },
        settledAt: expect.any(String),
      },
      {
        ownerUserId: 'owner-a',
        logicalOperationId: 'delete-before-recreate',
        kind: 'delete',
        cardId: candidate.id,
        outcome: 'discarded-superseded',
        settledAt: expect.any(String),
      },
    ]);
    expect(mocks.settleDevicePending).toHaveBeenCalledWith(
      'owner-a',
      [operation],
      report.settlements,
    );
    expect(mocks.settleDevicePending.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.publishPendingCreateSettlement.mock.invocationCallOrder[0],
    );
  });

  it('discards a revision-zero patch when its create resolves as a duplicate', async () => {
    const candidate = card('duplicate-card', {
      createdAt: '2026-08-12T00:00:00.000Z',
      libraryEpoch: 3,
      revision: 0,
    });
    const creation = {
      type: 'upsert' as const,
      operation: 'create' as const,
      opId: 'create-duplicate-card',
      card: candidate,
      fieldMask: [] as (keyof CardData)[],
      baseRevision: 0,
      libraryEpoch: 3,
      updatedAt: '2026-08-12T00:00:00.000Z',
      ownerUserId: 'owner-a',
    };
    const patch = {
      type: 'patch' as const,
      operation: 'patch' as const,
      opId: 'patch-duplicate-card',
      cardId: candidate.id,
      fields: { imageUrl: 'https://images.pexels.com/duplicate-card.jpeg' },
      fieldMask: ['imageUrl'] as (keyof CardData)[],
      baseRevision: 0,
      libraryEpoch: 3,
      updatedAt: '2026-08-12T00:00:01.000Z',
      ownerUserId: 'owner-a',
      logicalOperations: [{ id: 'media-duplicate', kind: 'patch' as const }],
    };
    const authoritative = card(candidate.id, {
      createdAt: '2026-08-11T00:00:00.000Z',
      libraryEpoch: 3,
      revision: 5,
    });
    mocks.loadDevicePending.mockResolvedValue([creation, patch]);
    mocks.createCardIfAbsent.mockResolvedValue({ created: false, card: authoritative });
    const replica = createReplica();

    const report = await replica.flush({
      manualRetry: true,
      verifiedEpoch: { userId: 'owner-a', value: 3 },
      isBrowserOnline: true,
    });

    expect(mocks.applyCardPatchIfCurrent).not.toHaveBeenCalled();
    expect(report.settlements).toMatchObject([{
      ownerUserId: 'owner-a',
      logicalOperationId: 'media-duplicate',
      kind: 'patch',
      cardId: candidate.id,
      outcome: 'discarded-superseded',
      settledAt: expect.any(String),
    }]);
    expect(mocks.settleDevicePending.mock.calls).toEqual([
      ['owner-a', [creation], []],
      ['owner-a', [patch], report.settlements],
    ]);
  });

  it('retargets a dependent patch when a create receives a different canonical id', async () => {
    const candidate = card('temporary-card', {
      createdAt: '2026-08-12T00:00:00.000Z',
      libraryEpoch: 3,
      revision: 0,
    });
    const creation = {
      type: 'upsert' as const,
      operation: 'create' as const,
      opId: 'create-temporary-card',
      card: candidate,
      fieldMask: [] as (keyof CardData)[],
      baseRevision: 0,
      libraryEpoch: 3,
      updatedAt: '2026-08-12T00:00:00.000Z',
      ownerUserId: 'owner-a',
    };
    const patch = {
      type: 'patch' as const,
      operation: 'patch' as const,
      opId: 'patch-temporary-card',
      cardId: candidate.id,
      fields: { imageUrl: 'https://images.pexels.com/canonical-card.jpeg' },
      fieldMask: ['imageUrl'] as (keyof CardData)[],
      baseRevision: 0,
      libraryEpoch: 3,
      updatedAt: '2026-08-12T00:00:01.000Z',
      ownerUserId: 'owner-a',
      logicalOperations: [{ id: 'media-canonical', kind: 'patch' as const }],
    };
    const authoritative = card('canonical-card', {
      ...candidate,
      id: 'canonical-card',
      revision: 5,
    });
    const retargetedPatch = {
      ...patch,
      cardId: authoritative.id,
      baseRevision: 5,
    };
    mocks.loadDevicePending.mockResolvedValue([creation, patch]);
    mocks.createCardIfAbsent.mockResolvedValue({ created: true, card: authoritative });
    mocks.applyCardPatchIfCurrent.mockResolvedValue({ applied: true, revision: 6 });
    const replica = createReplica();

    const report = await replica.flush({
      manualRetry: true,
      verifiedEpoch: { userId: 'owner-a', value: 3 },
      isBrowserOnline: true,
    });

    expect(mocks.recordDeviceCardAlias).toHaveBeenCalledWith(
      'owner-a',
      candidate.id,
      authoritative,
      0,
      3,
    );
    expect(mocks.applyCardPatchIfCurrent).toHaveBeenCalledWith(
      expect.anything(),
      'owner-a',
      expect.objectContaining({ cardId: authoritative.id, baseRevision: 5 }),
    );
    expect(report.settlements).toMatchObject([{
      ownerUserId: 'owner-a',
      logicalOperationId: 'media-canonical',
      kind: 'patch',
      cardId: authoritative.id,
      outcome: 'applied',
      settledAt: expect.any(String),
    }]);
    expect(mocks.settleDevicePending.mock.calls).toEqual([
      ['owner-a', [creation], []],
      ['owner-a', [retargetedPatch], report.settlements],
    ]);
  });

  it('settles a receipted replay without overlaying its stale fields locally', async () => {
    const authoritative = card('replayed-patch-card', {
      translation: 'newer cloud edit',
      libraryEpoch: 3,
      revision: 10,
    });
    const patch = {
      type: 'patch' as const,
      operation: 'patch' as const,
      opId: 'patch-replayed-patch-card',
      receiptProtocol: 1 as const,
      cardId: authoritative.id,
      fields: { translation: 'stale local edit' },
      baseFields: { translation: 'original value' },
      fieldMask: ['translation'] as (keyof CardData)[],
      baseRevision: 8,
      libraryEpoch: 3,
      updatedAt: '2026-08-12T00:00:01.000Z',
      ownerUserId: 'owner-a',
      logicalOperations: [{ id: 'logical-replayed-patch', kind: 'patch' as const }],
    };
    mocks.loadDevicePending.mockResolvedValue([patch]);
    mocks.applyCardPatchIfCurrent.mockResolvedValue({
      applied: true,
      revision: 10,
      replayed: true,
    });
    const replica = createReplica([authoritative]);

    const report = await replica.flush({
      manualRetry: true,
      verifiedEpoch: { userId: 'owner-a', value: 3 },
      isBrowserOnline: true,
    });

    expect(mocks.applyCardPatchIfCurrent).toHaveBeenCalledWith(
      expect.anything(),
      'owner-a',
      expect.objectContaining({
        cardId: authoritative.id,
        fields: { translation: 'stale local edit' },
        baseFields: { translation: 'original value' },
        opId: patch.opId,
        baseRevision: 8,
      }),
    );
    expect(mocks.patchMirroredCardBatch).not.toHaveBeenCalled();
    expect(report.settlements).toMatchObject([{
      ownerUserId: 'owner-a',
      logicalOperationId: 'logical-replayed-patch',
      kind: 'patch',
      cardId: authoritative.id,
      outcome: 'applied',
      settledAt: expect.any(String),
    }]);
    expect(mocks.settleDevicePending).toHaveBeenCalledWith(
      'owner-a',
      [patch],
      report.settlements,
    );
  });

  it('keeps a canonicalized create and dependent patch queued when shared alias reconciliation fails', async () => {
    const candidate = card('temporary-alias-failure', {
      createdAt: '2026-08-12T00:00:00.000Z',
      libraryEpoch: 3,
      revision: 0,
    });
    const creation = {
      type: 'upsert' as const,
      operation: 'create' as const,
      opId: 'create-alias-failure',
      card: candidate,
      fieldMask: [] as (keyof CardData)[],
      baseRevision: 0,
      libraryEpoch: 3,
      updatedAt: '2026-08-12T00:00:00.000Z',
      ownerUserId: 'owner-a',
    };
    const patch = {
      type: 'patch' as const,
      operation: 'patch' as const,
      opId: 'patch-alias-failure',
      cardId: candidate.id,
      fields: { imageUrl: 'https://images.pexels.com/alias-failure.jpeg' },
      fieldMask: ['imageUrl'] as (keyof CardData)[],
      baseRevision: 0,
      libraryEpoch: 3,
      updatedAt: '2026-08-12T00:00:01.000Z',
      ownerUserId: 'owner-a',
      logicalOperations: [{ id: 'media-alias-failure', kind: 'patch' as const }],
    };
    const authoritative = card('canonical-alias-failure', {
      ...candidate,
      id: 'canonical-alias-failure',
      revision: 5,
    });
    mocks.loadDevicePending.mockResolvedValue([creation, patch]);
    mocks.createCardIfAbsent.mockResolvedValue({ created: true, card: authoritative });
    mocks.recordDeviceCardAlias.mockRejectedValue(
      new Error('Device card alias reconciliation failed (503).'),
    );
    const replica = createReplica();

    const report = await replica.flush({
      manualRetry: true,
      verifiedEpoch: { userId: 'owner-a', value: 3 },
      isBrowserOnline: true,
    });

    expect(mocks.settleDevicePending).not.toHaveBeenCalled();
    expect(mocks.applyCardPatchIfCurrent).not.toHaveBeenCalled();
    expect(mocks.publishPendingCreateSettlement).not.toHaveBeenCalled();
    expect(report.settlements).toEqual([]);
  });

  it.each([
    ['stale-library-epoch', 'discarded-stale-library-epoch'],
    ['missing', 'discarded-missing'],
  ] as const)(
    'reports a terminal %s patch only after removing it from the durable queue',
    async (reason, expectedOutcome) => {
      const operation = {
        type: 'patch' as const,
        operation: 'patch' as const,
        opId: `patch-${reason}`,
        cardId: 'terminal-patch',
        fields: { bookmarked: true },
        fieldMask: ['bookmarked'] as (keyof CardData)[],
        baseRevision: 4,
        libraryEpoch: 3,
        updatedAt: '2026-08-12T00:00:01.000Z',
        ownerUserId: 'owner-a',
        logicalOperations: [{ id: `logical-${reason}`, kind: 'patch' as const }],
      };
      mocks.loadDevicePending.mockResolvedValue([operation]);
      mocks.applyCardPatchIfCurrent.mockResolvedValue({ applied: false, reason });
      const replica = createReplica();

      const report = await replica.flush({
        manualRetry: true,
        verifiedEpoch: { userId: 'owner-a', value: 3 },
        isBrowserOnline: true,
      });

      expect(report.settlements).toMatchObject([{
        ownerUserId: 'owner-a',
        logicalOperationId: `logical-${reason}`,
        kind: 'patch',
        cardId: operation.cardId,
        outcome: expectedOutcome,
        settledAt: expect.any(String),
      }]);
      expect(mocks.settleDevicePending).toHaveBeenCalledWith(
        'owner-a',
        [operation],
        report.settlements,
      );
    },
  );

  it('reports a stale delete without treating it as an applied deletion', async () => {
    const operation = {
      type: 'delete' as const,
      operation: 'delete' as const,
      opId: 'delete-stale',
      cardId: 'stale-delete',
      fieldMask: [] as (keyof CardData)[],
      baseRevision: 4,
      libraryEpoch: 3,
      updatedAt: '2026-08-12T00:00:01.000Z',
      ownerUserId: 'owner-a',
      logicalOperations: [{ id: 'logical-stale-delete', kind: 'delete' as const }],
    };
    mocks.loadDevicePending.mockResolvedValue([operation]);
    mocks.deleteCardWithTombstone.mockResolvedValue({
      deleted: false,
      reason: 'stale-library-epoch',
    });
    const replica = createReplica();

    const report = await replica.flush({
      manualRetry: true,
      verifiedEpoch: { userId: 'owner-a', value: 3 },
      isBrowserOnline: true,
    });

    expect(report.settlements).toMatchObject([{
      ownerUserId: 'owner-a',
      logicalOperationId: 'logical-stale-delete',
      kind: 'delete',
      cardId: operation.cardId,
      outcome: 'discarded-stale-library-epoch',
      settledAt: expect.any(String),
    }]);
    expect(mocks.settleDevicePending).toHaveBeenCalledWith(
      'owner-a',
      [operation],
      report.settlements,
    );
  });

  it('does not execute cloud mutations when local settlement capacity is full', async () => {
    const onError = vi.fn();
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    mocks.loadDevicePending.mockResolvedValue([{
      type: 'patch', operation: 'review', opId: 'capacity-review', cardId: 'capacity-card',
      fields: { reviews: 2 }, fieldMask: ['reviews'], baseRevision: 4, libraryEpoch: 3,
      updatedAt: '2026-08-12T00:00:01.000Z', ownerUserId: 'owner-a',
      logicalOperations: [{
        id: 'capacity-review', kind: 'patch', accounting: { version: 1, xp: { delta: 2 } },
      }],
    }]);
    mocks.claimDevicePendingForFlush.mockRejectedValueOnce(
      new PendingMutationSettlementCapacityError(),
    );
    const replica = createReplica([], undefined, onError);

    try {
      await expect(replica.flush({
        manualRetry: true,
        verifiedEpoch: { userId: 'owner-a', value: 3 },
        isBrowserOnline: true,
      })).resolves.toEqual({ settlements: [] });

      expect(mocks.createCardIfAbsent).not.toHaveBeenCalled();
      expect(mocks.applyCardPatchIfCurrent).not.toHaveBeenCalled();
      expect(mocks.deleteCardWithTombstone).not.toHaveBeenCalled();
      expect(mocks.settleDevicePending).not.toHaveBeenCalled();
      expect(onError).toHaveBeenCalledWith(
        'Local learning settlement capacity is full. Cloud changes remain queued safely and will retry after queued XP is stored.',
      );
      expect(mocks.releaseDevicePendingFlush).toHaveBeenCalledWith('owner-a');
    } finally {
      warning.mockRestore();
    }
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

  it('validates the raw cloud stream while publishing only active-epoch records', async () => {
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
    const replica = createReplica([], { cloudTotal: 4, cloudStatsTotal: 4 });

    await expect(replica.refreshMirror(true)).resolves.toBe(2);

    expect(mocks.beginCardMirrorSync).toHaveBeenCalledWith('owner-a', 4, 3);
    expect(mocks.upsertMirroredCardBatch).toHaveBeenCalledWith(
      'owner-a',
      [legacy, current],
      7,
    );
    expect(mocks.upsertMirroredCardBatch).toHaveBeenCalledWith('owner-a', [pendingCard], 7);
    expect(mocks.finishCardMirrorSync).toHaveBeenCalledWith('owner-a', 7, 4, 4);
  });

  it('preserves the authoritative expected total when the cloud stream ends early', async () => {
    const streamed = card('streamed-card', { libraryEpoch: 3 });
    mocks.streamAllCardsInBatches.mockImplementation(async (_db, _ownerId, onBatch) => {
      await onBatch([streamed], 1);
      return 1;
    });
    mocks.finishCardMirrorSync.mockResolvedValue(false);
    const replica = createReplica([], { cloudTotal: 2, cloudStatsTotal: 2 });

    await expect(replica.refreshMirror(true)).rejects.toThrow('interrupted');

    expect(mocks.beginCardMirrorSync).toHaveBeenCalledWith('owner-a', 2, 3);
    expect(mocks.finishCardMirrorSync).toHaveBeenCalledWith('owner-a', 7, 2, 1);
    expect(mocks.invalidateCardMirrorGeneration).toHaveBeenCalledWith('owner-a', 7);
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
