import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import type { CardData } from '../../types/card';

const mocks = vi.hoisted(() => ({
  acknowledgeDevicePending: vi.fn(),
  acquireDevicePendingFlush: vi.fn(),
  beginCardMirrorSync: vi.fn(),
  createCardIfAbsent: vi.fn(),
  deleteMirroredCard: vi.fn(),
  deleteDeviceCardBackupIfNotNewerThan: vi.fn(),
  deleteMirroredCardIfNotNewerThan: vi.fn(),
  findCardsByNormalizedWords: vi.fn(),
  findMirroredCardByWord: vi.fn(),
  findCardByNormalizedWord: vi.fn(),
  finishCardMirrorSync: vi.fn(),
  getCardMirrorStatus: vi.fn(),
  getLibraryEpoch: vi.fn(),
  loadDeviceCards: vi.fn(),
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
    loadDeviceCards: mocks.loadDeviceCards,
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
    findMirroredCardByWord: mocks.findMirroredCardByWord,
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
    findCardsByNormalizedWords: mocks.findCardsByNormalizedWords,
    findCardByNormalizedWord: mocks.findCardByNormalizedWord,
    getLibraryEpoch: mocks.getLibraryEpoch,
    streamAllCardsInBatches: mocks.streamAllCardsInBatches,
  };
});

vi.mock('../../lib/firebase', () => ({
  db: { kind: 'database' },
  isFirebaseConfigured: true,
}));

import { createAnonymousLibraryReplica, createLibraryReplica } from './libraryReplica';
import { CardMutationPreconditionError } from '../../lib/cardRepository';

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

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(resolvePromise => { resolve = resolvePromise; });
  return { promise, resolve };
};

const createReplica = (
  cards: readonly CardData[] = [],
  options: {
    getEpoch?: () => { userId: string; value: number } | null;
    isOwnerCurrent?: () => boolean;
  } = {},
) => createLibraryReplica({
  ownerId: 'owner-a',
  getEpoch: options.getEpoch ?? (() => ({ userId: 'owner-a', value: 3 })),
  getCards: () => cards,
  isOwnerCurrent: options.isOwnerCurrent ?? (() => true),
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
    mocks.findCardsByNormalizedWords.mockResolvedValue(new Map());
    mocks.findMirroredCardByWord.mockResolvedValue(null);
    mocks.finishCardMirrorSync.mockResolvedValue(true);
    mocks.getCardMirrorStatus.mockResolvedValue(null);
    mocks.getLibraryEpoch.mockResolvedValue(3);
    mocks.loadDevicePending.mockResolvedValue([]);
    mocks.loadDeviceCards.mockResolvedValue(null);
    mocks.invalidateCardMirrorGeneration.mockResolvedValue(true);
    mocks.mergeDeviceCardsStrict.mockResolvedValue(undefined);
    mocks.releaseDevicePendingFlush.mockResolvedValue(undefined);
    mocks.streamAllCardsInBatches.mockResolvedValue(0);
    mocks.deleteDeviceCardBackupIfNotNewerThan.mockResolvedValue(true);
    mocks.deleteMirroredCardIfNotNewerThan.mockResolvedValue(true);
    mocks.upsertMirroredCardIfNotOlderThan.mockResolvedValue(true);
  });

  it('keeps the intake contract at domain level without storage adapter names', () => {
    const source = readFileSync(new URL('./libraryReplicaIntakeContract.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/firebase|indexeddb|device(store|sync)/i);
    expect(source).toContain('LibraryReplicaIntakePort');
  });

  it('creates a queued receipt without exposing a pending-operation type', async () => {
    const replica = createReplica();
    const candidate = card('queued-intake', { libraryEpoch: 3 });
    const operation = {
      type: 'upsert' as const,
      operation: 'create' as const,
      opId: 'op-queued-intake',
      card: candidate,
      baseRevision: 4,
      fieldMask: [],
      libraryEpoch: 3,
      updatedAt: '2026-08-21T00:00:00.000Z',
      ownerUserId: 'owner-a',
    };
    mocks.queueDeviceUpserts.mockResolvedValue([operation]);

    await expect(replica.createIntake({
      card: candidate,
      libraryEpoch: 3,
      knownLibraryTotal: 8,
    })).resolves.toEqual({
      status: 'queued',
      card: expect.objectContaining({ id: 'queued-intake', libraryEpoch: 3 }),
      libraryEpoch: 3,
      operationId: 'op-queued-intake',
    });
  });

  it('routes anonymous intake staging through the replica factory', async () => {
    const candidate = card('anonymous-intake', { libraryEpoch: 0 });
    const operation = {
      type: 'upsert' as const,
      operation: 'create' as const,
      opId: 'op-anonymous-intake',
      card: candidate,
      baseRevision: 4,
      fieldMask: [],
      libraryEpoch: 0,
      updatedAt: '2026-08-21T00:00:00.000Z',
    };
    mocks.queueDeviceUpserts.mockResolvedValue([operation]);
    const replica = createAnonymousLibraryReplica({ getCards: () => [] });

    await expect(replica.createIntake({
      card: candidate,
      libraryEpoch: 0,
      knownLibraryTotal: 2,
    })).resolves.toMatchObject({
      status: 'queued',
      operationId: operation.opId,
      libraryEpoch: 0,
    });
    expect(mocks.queueDeviceUpserts).toHaveBeenCalledWith(
      [expect.objectContaining({ id: candidate.id, libraryEpoch: 0 })],
      2,
      undefined,
      false,
    );
    await expect(replica.resolveIntake({
      status: 'stale',
      card: candidate,
      libraryEpoch: 0,
      operationId: null,
    })).resolves.toMatchObject({
      status: 'stale',
      created: false,
      queued: false,
      acknowledged: false,
    });
  });

  it('returns stale without queueing when the intake epoch is no longer current', async () => {
    const replica = createReplica();
    const candidate = card('stale-intake', { libraryEpoch: 2 });

    await expect(replica.createIntake({ card: candidate, libraryEpoch: 2 })).resolves.toEqual({
      status: 'stale',
      card: candidate,
      libraryEpoch: 2,
      operationId: null,
    });
    expect(mocks.queueDeviceUpserts).not.toHaveBeenCalled();
  });

  it.each([
    { created: true, status: 'created' as const },
    { created: false, status: 'existing' as const },
  ])('resolves a staged intake through create-if-absent as $status', async ({ created, status }) => {
    const candidate = card(`resolve-${status}`, { libraryEpoch: 3 });
    const operation = {
      type: 'upsert' as const,
      operation: 'create' as const,
      opId: `op-resolve-${status}`,
      card: candidate,
      baseRevision: 4,
      fieldMask: [],
      libraryEpoch: 3,
      updatedAt: '2026-08-21T00:00:00.000Z',
      ownerUserId: 'owner-a',
    };
    const authoritative = { ...candidate, revision: created ? 5 : 9 };
    mocks.queueDeviceUpserts.mockResolvedValue([operation]);
    mocks.createCardIfAbsent.mockResolvedValue({ created, card: authoritative });
    const replica = createReplica();

    const receipt = await replica.createIntake({ card: candidate, libraryEpoch: 3 });
    await expect(replica.resolveIntake(receipt)).resolves.toMatchObject({
      status,
      card: authoritative,
      created,
      queued: false,
      acknowledged: true,
    });

    expect(mocks.createCardIfAbsent).toHaveBeenCalledWith(
      { kind: 'database' },
      'owner-a',
      expect.objectContaining({ id: candidate.id, libraryEpoch: 3 }),
      expect.objectContaining({
        libraryEpoch: 3,
        baseRevision: 4,
        opId: operation.opId,
        operationCreatedAt: operation.updatedAt,
      }),
    );
    expect(mocks.acknowledgeDevicePending).toHaveBeenCalledWith([operation]);
  });

  it('recovers a queued receipt from durable pending operations after the replica is recreated', async () => {
    const candidate = card('reloaded-intake', { libraryEpoch: 3 });
    const operation = {
      type: 'upsert' as const,
      operation: 'create' as const,
      opId: 'op-reloaded-intake',
      card: candidate,
      baseRevision: 4,
      fieldMask: [],
      libraryEpoch: 3,
      updatedAt: '2026-08-21T00:00:00.000Z',
      ownerUserId: 'owner-a',
    };
    mocks.queueDeviceUpserts.mockResolvedValue([operation]);
    mocks.createCardIfAbsent.mockResolvedValue({ created: true, card: { ...candidate, revision: 5 } });
    const originalReplica = createReplica();
    const receipt = await originalReplica.createIntake({ card: candidate, libraryEpoch: 3 });

    mocks.loadDevicePending.mockResolvedValue([operation]);
    const recreatedReplica = createReplica();
    await expect(recreatedReplica.resolveIntake(receipt)).resolves.toMatchObject({
      status: 'created',
      queued: false,
      acknowledged: true,
    });
    expect(mocks.loadDevicePending).toHaveBeenCalledWith('owner-a');
    expect(mocks.acknowledgeDevicePending).toHaveBeenCalledWith([operation]);
  });

  it('recovers and acknowledges a queued receipt when public settlement resumes after recreation', async () => {
    const candidate = card('reloaded-settlement', { libraryEpoch: 3 });
    const operation = {
      type: 'upsert' as const,
      operation: 'create' as const,
      opId: 'op-reloaded-settlement',
      card: candidate,
      baseRevision: 4,
      fieldMask: [],
      libraryEpoch: 3,
      updatedAt: '2026-08-21T00:00:00.000Z',
      ownerUserId: 'owner-a',
    };
    mocks.queueDeviceUpserts.mockResolvedValue([operation]);
    const receipt = await createReplica().createIntake({ card: candidate, libraryEpoch: 3 });

    mocks.loadDevicePending.mockResolvedValue([operation]);
    const settled = await createReplica().settleIntake({
      receipt,
      outcome: {
        status: 'created',
        card: { ...candidate, revision: 5 },
        libraryEpoch: 3,
        revision: 5,
      },
    });

    expect(settled).toMatchObject({ status: 'created', acknowledged: true });
    expect(mocks.loadDevicePending).toHaveBeenCalledWith('owner-a');
    expect(mocks.acknowledgeDevicePending).toHaveBeenCalledWith([operation]);
  });

  it('does not claim acknowledgement when a receipt operation cannot be recovered', async () => {
    const candidate = card('missing-intake-operation', { libraryEpoch: 3 });
    const receipt = {
      status: 'queued' as const,
      card: candidate,
      libraryEpoch: 3,
      operationId: 'op-missing-intake-operation',
    };
    mocks.loadDevicePending.mockResolvedValue([]);
    mocks.createCardIfAbsent.mockResolvedValue({ created: true, card: candidate });
    const replica = createReplica();

    await expect(replica.resolveIntake(receipt)).resolves.toMatchObject({
      status: 'queued',
      queued: true,
      acknowledged: false,
    });
    expect(mocks.createCardIfAbsent).not.toHaveBeenCalled();
    expect(mocks.acknowledgeDevicePending).not.toHaveBeenCalled();
  });

  it('drops a stale lookup result when the owner epoch changes during mirror lookup', async () => {
    const lookup = deferred<CardData | null>();
    let epoch = 3;
    mocks.findMirroredCardByWord.mockReturnValue(lookup.promise);
    const replica = createReplica([], {
      getEpoch: () => ({ userId: 'owner-a', value: epoch }),
    });

    const resultPromise = replica.findExisting(['racy-word']);
    await vi.waitFor(() => expect(mocks.findMirroredCardByWord).toHaveBeenCalledOnce());
    epoch = 4;
    lookup.resolve(card('racy-word', { libraryEpoch: 3 }));

    await expect(resultPromise).resolves.toEqual(new Map());
  });

  it('does not queue a create after the owner epoch changes during mirror staging', async () => {
    const mirrorWrite = deferred<void>();
    let epoch = 3;
    mocks.upsertMirroredCardBatch.mockReturnValue(mirrorWrite.promise);
    mocks.queueDeviceUpserts.mockResolvedValue([]);
    const replica = createReplica([], {
      getEpoch: () => ({ userId: 'owner-a', value: epoch }),
    });

    const receiptPromise = replica.createIntakeBatch([{
      card: card('racy-create', { libraryEpoch: 3 }),
      libraryEpoch: 3,
    }]);
    await vi.waitFor(() => expect(mocks.upsertMirroredCardBatch).toHaveBeenCalledOnce());
    epoch = 4;
    mirrorWrite.resolve();

    await expect(receiptPromise).resolves.toEqual([expect.objectContaining({
      status: 'stale',
      operationId: null,
    })]);
    expect(mocks.queueDeviceUpserts).not.toHaveBeenCalled();
  });

  it('does not acknowledge a cloud create that resolves after the owner epoch changes', async () => {
    const cloudCreate = deferred<{ created: boolean; card: CardData }>();
    let epoch = 3;
    const candidate = card('racy-cloud-create', { libraryEpoch: 3 });
    const operation = {
      type: 'upsert' as const,
      operation: 'create' as const,
      opId: 'op-racy-cloud-create',
      card: candidate,
      baseRevision: 4,
      fieldMask: [],
      libraryEpoch: 3,
      updatedAt: '2026-08-21T00:00:00.000Z',
      ownerUserId: 'owner-a',
    };
    mocks.queueDeviceUpserts.mockResolvedValue([operation]);
    mocks.createCardIfAbsent.mockReturnValue(cloudCreate.promise);
    const replica = createReplica([], {
      getEpoch: () => ({ userId: 'owner-a', value: epoch }),
    });
    const receipt = await replica.createIntake({ card: candidate, libraryEpoch: 3 });
    const resultPromise = replica.resolveIntake(receipt);
    await vi.waitFor(() => expect(mocks.createCardIfAbsent).toHaveBeenCalledOnce());
    epoch = 4;
    cloudCreate.resolve({ created: true, card: { ...candidate, revision: 5 } });

    await expect(resultPromise).resolves.toMatchObject({
      status: 'stale',
      queued: false,
      acknowledged: false,
    });
    expect(mocks.acknowledgeDevicePending).not.toHaveBeenCalled();
  });

  it('leaves a staged intake queued when the authoritative create cannot complete', async () => {
    const candidate = card('resolve-queued', { libraryEpoch: 3 });
    const operation = {
      type: 'upsert' as const,
      operation: 'create' as const,
      opId: 'op-resolve-queued',
      card: candidate,
      baseRevision: 4,
      fieldMask: [],
      libraryEpoch: 3,
      updatedAt: '2026-08-21T00:00:00.000Z',
      ownerUserId: 'owner-a',
    };
    mocks.queueDeviceUpserts.mockResolvedValue([operation]);
    mocks.createCardIfAbsent.mockRejectedValue(new Error('offline'));
    const replica = createReplica();
    const receipt = await replica.createIntake({ card: candidate, libraryEpoch: 3 });

    await expect(replica.resolveIntake(receipt)).resolves.toMatchObject({
      status: 'queued',
      card: candidate,
      created: true,
      queued: true,
      acknowledged: false,
    });
    expect(mocks.acknowledgeDevicePending).not.toHaveBeenCalled();
  });

  it('leaves a staged intake queued when the repository rejects a stale epoch', async () => {
    const candidate = card('resolve-stale-repository', { libraryEpoch: 3 });
    const operation = {
      type: 'upsert' as const,
      operation: 'create' as const,
      opId: 'op-resolve-stale-repository',
      card: candidate,
      baseRevision: 4,
      fieldMask: [],
      libraryEpoch: 3,
      updatedAt: '2026-08-21T00:00:00.000Z',
      ownerUserId: 'owner-a',
    };
    mocks.queueDeviceUpserts.mockResolvedValue([operation]);
    mocks.createCardIfAbsent.mockRejectedValue(new CardMutationPreconditionError('stale-library-epoch'));
    const replica = createReplica();
    const receipt = await replica.createIntake({ card: candidate, libraryEpoch: 3 });

    await expect(replica.resolveIntake(receipt)).resolves.toMatchObject({
      status: 'queued',
      queued: true,
      acknowledged: false,
    });
    expect(mocks.acknowledgeDevicePending).not.toHaveBeenCalled();
  });

  it('matches batched receipts by normalized word when local staging deduplicates inputs', async () => {
    const first = card('apple', { libraryEpoch: 3, normalizedWord: 'apple' });
    const duplicate = card('apple-second-id', { libraryEpoch: 3, normalizedWord: 'apple' });
    const second = card('banana', { libraryEpoch: 3, normalizedWord: 'banana' });
    const firstOperation = {
      type: 'upsert' as const,
      operation: 'create' as const,
      opId: 'op-apple',
      card: first,
      baseRevision: 4,
      fieldMask: [],
      libraryEpoch: 3,
      updatedAt: '2026-08-21T00:00:00.000Z',
      ownerUserId: 'owner-a',
    };
    const secondOperation = {
      ...firstOperation,
      opId: 'op-banana',
      card: second,
    };
    mocks.queueDeviceUpserts.mockResolvedValue([firstOperation, secondOperation]);
    const replica = createReplica();

    const receipts = await replica.createIntakeBatch([
      { card: first, libraryEpoch: 3 },
      { card: duplicate, libraryEpoch: 3 },
      { card: second, libraryEpoch: 3 },
    ]);

    expect(receipts.map(receipt => receipt.operationId)).toEqual([
      'op-apple',
      'op-apple',
      'op-banana',
    ]);
    expect(receipts[2]?.card.id).toBe('banana');
  });

  it.each([
    'created',
    'existing',
    'deleted',
    'stale',
  ] as const)('settles a %s outcome only after local convergence work', async (status) => {
    const replica = createReplica();
    const candidate = card(`settle-${status}`, { libraryEpoch: 3 });
    const operation = {
      type: 'upsert' as const,
      operation: 'create' as const,
      opId: `op-${status}`,
      card: candidate,
      baseRevision: 4,
      fieldMask: [],
      libraryEpoch: 3,
      updatedAt: '2026-08-21T00:00:00.000Z',
      ownerUserId: 'owner-a',
    };
    mocks.queueDeviceUpserts.mockResolvedValue([operation]);
    mocks.mergeDeviceCardsStrict.mockResolvedValue(undefined);
    mocks.upsertMirroredCardIfNotOlderThan.mockResolvedValue(true);

    const receipt = await replica.createIntake({ card: candidate, libraryEpoch: 3 });
    const settled = await replica.settleIntake({
      receipt,
      outcome: {
        status,
        card: candidate,
        libraryEpoch: 3,
        revision: status === 'created' ? 5 : 4,
      },
    });

    expect(settled).toMatchObject({ status, libraryEpoch: 3, acknowledged: true });
    expect(mocks.acknowledgeDevicePending).toHaveBeenCalledWith([operation]);
    const mirrorOrder = status === 'deleted' || status === 'stale'
      ? mocks.deleteMirroredCardIfNotNewerThan.mock.invocationCallOrder[0]
      : mocks.upsertMirroredCardIfNotOlderThan.mock.invocationCallOrder[0];
    expect(mocks.acknowledgeDevicePending.mock.invocationCallOrder[0])
      .toBeGreaterThan(mirrorOrder);
  });

  it('converges an existing duplicate and cleans the optimistic identity before acknowledging', async () => {
    const replica = createReplica();
    const candidate = card('optimistic-id', { libraryEpoch: 3, revision: 4 });
    const authoritative = card('canonical-id', { libraryEpoch: 3, revision: 9 });
    const operation = {
      type: 'upsert' as const,
      operation: 'create' as const,
      opId: 'op-existing-duplicate',
      card: candidate,
      baseRevision: 4,
      fieldMask: [],
      libraryEpoch: 3,
      updatedAt: '2026-08-21T00:00:00.000Z',
      ownerUserId: 'owner-a',
    };
    mocks.queueDeviceUpserts.mockResolvedValue([operation]);

    const receipt = await replica.createIntake({ card: candidate, libraryEpoch: 3 });
    await replica.settleIntake({
      receipt,
      outcome: {
        status: 'existing',
        card: authoritative,
        libraryEpoch: 3,
        revision: 9,
      },
    });

    expect(mocks.upsertMirroredCardIfNotOlderThan).toHaveBeenCalledWith('owner-a', authoritative);
    expect(mocks.deleteDeviceCardBackupIfNotNewerThan).toHaveBeenCalledWith(
      'owner-a',
      candidate.id,
      { libraryEpoch: 3, revision: 4 },
    );
    expect(mocks.deleteMirroredCardIfNotNewerThan).toHaveBeenCalledWith(
      'owner-a',
      candidate.id,
      { libraryEpoch: 3, revision: 4 },
    );
    expect(mocks.acknowledgeDevicePending.mock.invocationCallOrder[0]).toBeGreaterThan(
      mocks.deleteMirroredCardIfNotNewerThan.mock.invocationCallOrder[0],
    );
  });

  it('keeps the operation pending when mirror convergence fails', async () => {
    const replica = createReplica();
    const candidate = card('mirror-failure', { libraryEpoch: 3 });
    const operation = {
      type: 'upsert' as const,
      operation: 'create' as const,
      opId: 'op-mirror-failure',
      card: candidate,
      baseRevision: 4,
      fieldMask: [],
      libraryEpoch: 3,
      updatedAt: '2026-08-21T00:00:00.000Z',
      ownerUserId: 'owner-a',
    };
    mocks.queueDeviceUpserts.mockResolvedValue([operation]);
    mocks.upsertMirroredCardIfNotOlderThan.mockRejectedValue(new Error('mirror unavailable'));

    const receipt = await replica.createIntake({ card: candidate, libraryEpoch: 3 });
    await expect(replica.settleIntake({
      receipt,
      outcome: {
        status: 'created',
        card: candidate,
        libraryEpoch: 3,
        revision: 5,
      },
    })).rejects.toThrow('mirror unavailable');
    expect(mocks.acknowledgeDevicePending).not.toHaveBeenCalled();
  });

  it('does not acknowledge after the owner epoch changes during settlement convergence', async () => {
    const mirrorWrite = deferred<boolean>();
    let epoch = 3;
    const candidate = card('racy-settlement', { libraryEpoch: 3 });
    const operation = {
      type: 'upsert' as const,
      operation: 'create' as const,
      opId: 'op-racy-settlement',
      card: candidate,
      baseRevision: 4,
      fieldMask: [],
      libraryEpoch: 3,
      updatedAt: '2026-08-21T00:00:00.000Z',
      ownerUserId: 'owner-a',
    };
    mocks.queueDeviceUpserts.mockResolvedValue([operation]);
    mocks.upsertMirroredCardIfNotOlderThan.mockReturnValue(mirrorWrite.promise);
    const replica = createReplica([], {
      getEpoch: () => ({ userId: 'owner-a', value: epoch }),
    });
    const receipt = await replica.createIntake({ card: candidate, libraryEpoch: 3 });

    const settlementPromise = replica.settleIntake({
      receipt,
      outcome: {
        status: 'created',
        card: candidate,
        libraryEpoch: 3,
        revision: 5,
      },
    });
    await vi.waitFor(() => expect(mocks.upsertMirroredCardIfNotOlderThan).toHaveBeenCalledOnce());
    epoch = 4;
    mirrorWrite.resolve(true);

    await expect(settlementPromise).resolves.toMatchObject({
      status: 'stale',
      acknowledged: false,
    });
    expect(mocks.acknowledgeDevicePending).not.toHaveBeenCalled();
  });

  it('returns a stale resolution when settlement loses the owner epoch', async () => {
    const mirrorWrite = deferred<boolean>();
    let epoch = 3;
    const candidate = card('racy-resolve-settlement', { libraryEpoch: 3 });
    const operation = {
      type: 'upsert' as const,
      operation: 'create' as const,
      opId: 'op-racy-resolve-settlement',
      card: candidate,
      baseRevision: 4,
      fieldMask: [],
      libraryEpoch: 3,
      updatedAt: '2026-08-21T00:00:00.000Z',
      ownerUserId: 'owner-a',
    };
    mocks.queueDeviceUpserts.mockResolvedValue([operation]);
    mocks.createCardIfAbsent.mockResolvedValue({ created: true, card: { ...candidate, revision: 5 } });
    mocks.upsertMirroredCardIfNotOlderThan.mockReturnValue(mirrorWrite.promise);
    const replica = createReplica([], {
      getEpoch: () => ({ userId: 'owner-a', value: epoch }),
    });
    const receipt = await replica.createIntake({ card: candidate, libraryEpoch: 3 });
    const resolutionPromise = replica.resolveIntake(receipt);

    await vi.waitFor(() => expect(mocks.upsertMirroredCardIfNotOlderThan).toHaveBeenCalledOnce());
    epoch = 4;
    mirrorWrite.resolve(true);

    await expect(resolutionPromise).resolves.toMatchObject({
      status: 'stale',
      created: false,
      queued: false,
      acknowledged: false,
    });
    expect(mocks.acknowledgeDevicePending).not.toHaveBeenCalled();
  });

  it('cleans the queued identity at its revision boundary for a deleted outcome', async () => {
    const replica = createReplica();
    const candidate = card('deleted-queued-id', { libraryEpoch: 3, revision: 4 });
    const outcomeCard = card('deleted-authoritative-id', { libraryEpoch: 3, revision: 12 });
    const operation = {
      type: 'upsert' as const,
      operation: 'create' as const,
      opId: 'op-deleted-queued',
      card: candidate,
      baseRevision: 4,
      fieldMask: [],
      libraryEpoch: 3,
      updatedAt: '2026-08-21T00:00:00.000Z',
      ownerUserId: 'owner-a',
    };
    mocks.queueDeviceUpserts.mockResolvedValue([operation]);

    const receipt = await replica.createIntake({ card: candidate, libraryEpoch: 3 });
    await replica.settleIntake({
      receipt,
      outcome: {
        status: 'deleted',
        card: outcomeCard,
        libraryEpoch: 3,
        revision: 12,
      },
    });

    expect(mocks.deleteMirroredCardIfNotNewerThan).toHaveBeenCalledWith(
      'owner-a',
      candidate.id,
      { libraryEpoch: 3, revision: 4 },
    );
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
