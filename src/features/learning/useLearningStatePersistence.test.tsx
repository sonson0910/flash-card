import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DevicePendingOperation } from '../../lib/deviceSync';
import type { CardData } from '../../types/card';
import type {
  LearningPersistenceOptions,
  LearningPersistenceStats,
  RestoreDeviceCardResult,
} from './learningPersistencePort';
import type { LearningStateMutation } from './learningStateController';
import type { LearningStatePersistencePort } from './useLearningState';
import type { ReviewApplyResult, ReviewCommand } from '../../lib/cardReviewRepository';
import type { CardMutableField } from '../../lib/cardMutationProtocol';
import { scheduleReview } from '../../lib/reviewScheduler';
import { ProtectedFunctionError } from '../../lib/protectedFunctionsCapability';

const mocks = vi.hoisted(() => ({
  deleteDeviceCardBackupIfNotNewerThan: vi.fn(),
  mergeDeviceCardsStrict: vi.fn(),
  applyCardPatchIfCurrent: vi.fn(),
  deleteAllCards: vi.fn(),
  clearLibraryFacets: vi.fn(),
  deleteCardWithTombstone: vi.fn(),
  findCardById: vi.fn(),
  getLibraryEpoch: vi.fn(),
  incrementLibraryEpoch: vi.fn(),
  clearMirroredCards: vi.fn(),
  deleteMirroredCard: vi.fn(),
  deleteMirroredCardIfNotNewerThan: vi.fn(),
  deleteMirroredCardIfOlderThan: vi.fn(),
  patchMirroredCardBatch: vi.fn(),
  upsertMirroredCardIfNotOlderThan: vi.fn(),
  applyReviewViaCallable: vi.fn(),
  applyReviewWithConflictRecovery: vi.fn(),
  withDevicePendingFlush: vi.fn(async (_userId, _force, operation) => ({ acquired: true, value: await operation({ token: 'test', expiresAt: Infinity, assertOwnership: async () => undefined }) })),
  clearDevicePending: vi.fn(async () => undefined),
  saveDeviceCards: vi.fn(async () => undefined),
  releaseDevicePendingFlush: vi.fn(async () => undefined),
}));

vi.mock('../../lib/deviceSync', async () => {
  const actual = await vi.importActual<typeof import('../../lib/deviceSync')>('../../lib/deviceSync');
  return {
    ...actual,
    deleteDeviceCardBackupIfNotNewerThan: mocks.deleteDeviceCardBackupIfNotNewerThan,
    mergeDeviceCardsStrict: mocks.mergeDeviceCardsStrict,
    withDevicePendingFlush: mocks.withDevicePendingFlush,
    clearDevicePending: mocks.clearDevicePending,
    saveDeviceCards: mocks.saveDeviceCards,
  };
});

vi.mock('../../lib/cardRepository', () => ({
  applyCardPatchIfCurrent: mocks.applyCardPatchIfCurrent,
  clearLibraryFacets: mocks.clearLibraryFacets,
  deriveLibraryFacetOperationId: (operationId: string, suffix: string) => `facet:${operationId}:${suffix}`,
  deleteAllCards: mocks.deleteAllCards,
  deleteCardWithTombstone: mocks.deleteCardWithTombstone,
  findCardById: mocks.findCardById,
  getLibraryEpoch: mocks.getLibraryEpoch,
  incrementLibraryEpoch: mocks.incrementLibraryEpoch,
}));

vi.mock('../../lib/cardMirror', () => ({
  clearMirroredCards: mocks.clearMirroredCards,
  deleteMirroredCard: mocks.deleteMirroredCard,
  deleteMirroredCardIfNotNewerThan: mocks.deleteMirroredCardIfNotNewerThan,
  deleteMirroredCardIfOlderThan: mocks.deleteMirroredCardIfOlderThan,
  patchMirroredCardBatch: mocks.patchMirroredCardBatch,
  upsertMirroredCardIfNotOlderThan: mocks.upsertMirroredCardIfNotOlderThan,
}));

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
  handleFirestoreError: vi.fn(),
  isFirebaseConfigured: true,
  OperationType: { DELETE: 'delete' },
}));

import { useLearningStatePersistence } from './useLearningStatePersistence';

const card: CardData = {
  id: 'word-focus',
  word: 'focus',
  normalizedWord: 'focus',
  translation: 'tập trung',
  explanation: '',
  phonetic: '',
  emoji: '🎯',
  category: 'Study',
  audioUrl: null,
  imageUrl: null,
  bookmarked: false,
  difficulty: 'unrated',
  reviews: 0,
  revision: 3,
  libraryEpoch: 2,
};

const pendingPatch: DevicePendingOperation = {
  type: 'patch',
  operation: 'patch',
  opId: 'review-1',
  cardId: card.id,
  fields: { difficulty: 'hard', reviews: 1 },
  fieldMask: ['difficulty', 'reviews'],
  baseRevision: 3,
  libraryEpoch: 2,
  updatedAt: '2026-08-09T00:00:00.000Z',
  ownerUserId: 'user-a',
};

const pendingDelete: DevicePendingOperation = {
  type: 'delete',
  operation: 'delete',
  opId: 'cleanup-1',
  cardId: card.id,
  fieldMask: [],
  baseRevision: 3,
  libraryEpoch: 2,
  updatedAt: '2026-08-09T00:00:01.000Z',
  ownerUserId: 'user-a',
};

const reviewMutation: LearningStateMutation = {
  ownerKey: 'user-a',
  operationId: 'review-1',
  operation: 'patch',
  intent: 'review',
  cardId: card.id,
  fields: { difficulty: 'hard', reviews: 1 },
  fieldMask: ['difficulty', 'reviews'],
  baseRevision: 3,
  libraryEpoch: 2,
  publication: {
    kind: 'patch',
    cardId: card.id,
    fields: { difficulty: 'hard', reviews: 1 },
  },
};

const invalidReviewMutation: LearningStateMutation = {
  ...reviewMutation,
  operation: 'review',
};

const deleteMutation: LearningStateMutation = {
  ownerKey: 'user-a',
  operationId: 'cleanup-1',
  operation: 'delete',
  intent: 'delete',
  cardId: card.id,
  card,
  baseRevision: 3,
  libraryEpoch: 2,
  publication: { kind: 'delete', cardId: card.id },
};

function createHarness({
  verifiedEpoch = 2,
  patchResult = pendingPatch,
}: {
  verifiedEpoch?: number | null;
  patchResult?: DevicePendingOperation;
} = {}) {
  const acknowledgeDevicePending = vi.fn(async () => undefined);
  const removeDeviceCard = vi.fn(async () => [pendingDelete]);
  const restoreDeviceCard = vi.fn(async (restoreCard: CardData): ReturnType<LearningPersistenceOptions['restoreDeviceCard']> => ({
    status: 'queued', card: restoreCard,
  }));
  const updateCloudStats = vi.fn<(update: (current: LearningPersistenceStats) => LearningPersistenceStats) => void>();
  const updateCategoryFacets = vi.fn(async () => undefined);
  const addXp = vi.fn();
  const options: LearningPersistenceOptions = {
    ownerId: 'user-a',
    verifiedEpoch,
    knownLibraryTotal: 1,
    validateRestore: () => null,
    restoreDeviceCard,
    findCard: cardId => cardId === card.id ? card : undefined,
    canPublishPatch: () => true,
    patchDeviceCards: vi.fn(async () => [patchResult]),
    removeDeviceCard,
    acknowledgeDevicePending,
    acceptVerifiedEpoch: vi.fn(),
    updateCloudStats,
    updateCategoryFacets,
    resetCloudState: vi.fn(),
    resetCloudPage: vi.fn(),
    refreshCloud: vi.fn(),
    setCloudUnavailable: vi.fn(),
    setMutationPending: vi.fn(),
    reportError: vi.fn(),
    addXp,
  };
  const captured: { persistence?: LearningStatePersistencePort } = {};

  function Harness() {
    captured.persistence = useLearningStatePersistence(options);
    return null;
  }

  renderToStaticMarkup(<Harness />);
  if (!captured.persistence) throw new Error('Persistence hook did not initialize.');

  return {
    persistence: captured.persistence,
    options,
    acknowledgeDevicePending,
    removeDeviceCard,
    restoreDeviceCard,
    updateCloudStats,
    updateCategoryFacets,
    addXp,
    patchDeviceCards: options.patchDeviceCards,
  };
}

describe('useLearningStatePersistence patch reconciliation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.deleteDeviceCardBackupIfNotNewerThan.mockResolvedValue(true);
    mocks.clearMirroredCards.mockResolvedValue(undefined);
    mocks.deleteMirroredCard.mockResolvedValue(undefined);
    mocks.deleteMirroredCardIfNotNewerThan.mockResolvedValue(true);
    mocks.deleteMirroredCardIfOlderThan.mockResolvedValue(true);
    mocks.getLibraryEpoch.mockResolvedValue(3);
  });

  it('removes an optimistic device patch from a stale library epoch without stats or XP', async () => {
    mocks.applyCardPatchIfCurrent.mockResolvedValue({
      applied: false,
      reason: 'stale-library-epoch',
    });
    const harness = createHarness();

    await expect(harness.persistence.persist(reviewMutation)).resolves.toEqual({
      ownerKey: 'user-a',
      operationId: 'review-1',
      publication: { kind: 'delete', cardId: card.id },
    });
    expect(harness.removeDeviceCard).not.toHaveBeenCalled();
    expect(mocks.deleteDeviceCardBackupIfNotNewerThan).toHaveBeenCalledWith('user-a', card.id, {
      libraryEpoch: 2,
      revision: Number.MAX_SAFE_INTEGER,
    }, expect.objectContaining({ token: 'test' }));
    expect(mocks.deleteMirroredCardIfOlderThan).toHaveBeenCalledWith('user-a', card.id, 3);
    expect(harness.acknowledgeDevicePending).toHaveBeenCalledWith([pendingPatch], expect.objectContaining({ token: 'test' }));
    expect(harness.updateCloudStats).not.toHaveBeenCalled();
    expect(harness.addXp).not.toHaveBeenCalled();
  });

  it('routes an immediate review through the protected callable and preserves its queue kind', async () => {
    const reviewedAt = new Date('2026-08-24T00:00:00.000Z');
    const fields = scheduleReview(card, 'good', reviewedAt);
    const reviewPendingPatch: DevicePendingOperation = {
      ...pendingPatch,
      operation: 'review',
      fields,
      fieldMask: Object.keys(fields) as CardMutableField[],
    };
    const authoritative = { ...card, ...fields, revision: 4, libraryEpoch: 2 };
    mocks.applyReviewWithConflictRecovery.mockImplementation(async (
      command: ReviewCommand,
      apply: (value: ReviewCommand) => Promise<ReviewApplyResult>,
    ) => apply(command));
    mocks.applyReviewViaCallable.mockResolvedValue({ applied: true, duplicate: false, card: authoritative });
    const harness = createHarness({ patchResult: reviewPendingPatch });
    const mutation: LearningStateMutation = {
      ...reviewMutation,
      operation: 'review',
      fields,
      fieldMask: Object.keys(fields) as CardMutableField[],
      publication: { kind: 'patch', cardId: card.id, fields },
    };

    await harness.persistence.persist(mutation);

    expect(harness.patchDeviceCards).toHaveBeenCalledWith(
      [{ card: { ...card, ...fields }, fields }],
      1,
      mutation.operationId,
      'review',
    );
    expect(mocks.applyReviewViaCallable).toHaveBeenCalledWith(
      expect.anything(),
      'user-a',
      expect.objectContaining({ opId: mutation.operationId, rating: 'good', reviewedAt: reviewedAt.toISOString() }),
    );
    expect(harness.acknowledgeDevicePending).toHaveBeenCalledWith([reviewPendingPatch], expect.objectContaining({ token: 'test' }));
  });

  it('fails closed when an immediate review has no valid final history entry', async () => {
    const harness = createHarness();

    await harness.persistence.persist(invalidReviewMutation);

    expect(mocks.applyReviewViaCallable).not.toHaveBeenCalled();
    expect(mocks.applyReviewWithConflictRecovery).not.toHaveBeenCalled();
    expect(mocks.applyCardPatchIfCurrent).not.toHaveBeenCalled();
    expect(harness.acknowledgeDevicePending).not.toHaveBeenCalled();
  });

  it('keeps a committed review queued when XP settlement fails before acknowledgement', async () => {
    const reviewedAt = new Date('2026-08-24T00:00:00.000Z');
    const fields = scheduleReview(card, 'good', reviewedAt);
    const reviewPendingPatch: DevicePendingOperation = {
      ...pendingPatch, operation: 'review', fields, fieldMask: Object.keys(fields) as CardMutableField[],
    };
    const harness = createHarness({ patchResult: reviewPendingPatch });
    harness.addXp.mockImplementation(() => { throw new Error('settlement unavailable'); });

    await harness.persistence.persist({
      ...reviewMutation, operation: 'review', fields,
      fieldMask: Object.keys(fields) as CardMutableField[], publication: { kind: 'patch', cardId: card.id, fields },
    });

    expect(harness.addXp).toHaveBeenCalledOnce();
    expect(harness.acknowledgeDevicePending).not.toHaveBeenCalled();
  });

  it('retires a permanently rejected callable review without publishing or queuing it', async () => {
    const reviewedAt = new Date('2026-08-24T00:00:00.000Z');
    const fields = scheduleReview(card, 'good', reviewedAt);
    const reviewPendingPatch: DevicePendingOperation = {
      ...pendingPatch, operation: 'review', fields, fieldMask: Object.keys(fields) as CardMutableField[],
    };
    const permanent = new ProtectedFunctionError({
      message: 'Review rejected.', kind: 'permission', code: 'permission-denied', retryable: false,
    });
    mocks.applyReviewWithConflictRecovery.mockRejectedValue(permanent);
    mocks.findCardById.mockResolvedValue({ ...card, revision: 4 });
    const harness = createHarness({ patchResult: reviewPendingPatch });
    const mutation: LearningStateMutation = {
      ...reviewMutation, operation: 'review', fields,
      fieldMask: Object.keys(fields) as CardMutableField[], publication: { kind: 'patch', cardId: card.id, fields },
    };

    await expect(harness.persistence.persist(mutation)).rejects.toBe(permanent);

    expect(harness.acknowledgeDevicePending).toHaveBeenCalledWith([reviewPendingPatch], expect.objectContaining({ token: 'test' }));
    expect(harness.updateCloudStats).not.toHaveBeenCalled();
    expect(harness.addXp).not.toHaveBeenCalled();
  });

  it('publishes a delete and removes the local copy when the cloud card is missing', async () => {
    mocks.applyCardPatchIfCurrent.mockResolvedValue({
      applied: false,
      reason: 'missing',
    });
    const harness = createHarness();

    await expect(harness.persistence.persist(reviewMutation)).resolves.toEqual({
      ownerKey: 'user-a',
      operationId: 'review-1',
      publication: { kind: 'delete', cardId: card.id },
    });
    expect(harness.removeDeviceCard).not.toHaveBeenCalled();
    expect(mocks.deleteDeviceCardBackupIfNotNewerThan).toHaveBeenCalledWith('user-a', card.id, {
      libraryEpoch: 2,
      revision: 3,
    }, expect.any(Object));
    expect(mocks.deleteMirroredCardIfNotNewerThan).toHaveBeenCalledWith('user-a', card.id, {
      libraryEpoch: 2,
      revision: 3,
    });
    expect(harness.acknowledgeDevicePending).toHaveBeenCalledWith([pendingPatch], expect.objectContaining({ token: 'test' }));
    expect(harness.updateCloudStats).not.toHaveBeenCalled();
    expect(harness.addXp).not.toHaveBeenCalled();
  });

  it('keeps a stale patch queued when conditional mirror cleanup fails', async () => {
    mocks.applyCardPatchIfCurrent.mockResolvedValue({
      applied: false,
      reason: 'stale-library-epoch',
    });
    mocks.deleteMirroredCardIfOlderThan.mockRejectedValue(new Error('IndexedDB delete failed'));
    const harness = createHarness();

    await expect(harness.persistence.persist(reviewMutation)).resolves.toMatchObject({
      publication: { kind: 'delete', cardId: card.id },
    });
    expect(harness.removeDeviceCard).not.toHaveBeenCalled();
    expect(mocks.deleteMirroredCardIfOlderThan).toHaveBeenCalledWith('user-a', card.id, 3);
    expect(harness.acknowledgeDevicePending).not.toHaveBeenCalled();
    expect(harness.updateCloudStats).not.toHaveBeenCalled();
    expect(harness.addXp).not.toHaveBeenCalled();
  });

  it('keeps a missing-card cleanup queued when mirror deletion fails', async () => {
    mocks.applyCardPatchIfCurrent.mockResolvedValue({ applied: false, reason: 'missing' });
    mocks.deleteMirroredCardIfNotNewerThan.mockRejectedValue(new Error('IndexedDB delete failed'));
    const harness = createHarness();

    await expect(harness.persistence.persist(reviewMutation)).resolves.toMatchObject({
      publication: { kind: 'delete', cardId: card.id },
    });
    expect(harness.removeDeviceCard).not.toHaveBeenCalled();
    expect(mocks.deleteMirroredCardIfNotNewerThan).toHaveBeenCalledWith('user-a', card.id, {
      libraryEpoch: 2,
      revision: 3,
    });
    expect(harness.acknowledgeDevicePending).not.toHaveBeenCalled();
    expect(harness.updateCloudStats).not.toHaveBeenCalled();
    expect(harness.addXp).not.toHaveBeenCalled();
  });

  it('keeps a cloud-confirmed delete queued when mirror deletion fails', async () => {
    mocks.deleteCardWithTombstone.mockResolvedValue({
      deleted: true,
      tombstone: {
        cardId: card.id,
        opId: 'cleanup-1',
        libraryEpoch: 2,
        revision: 4,
        deletedAt: '2026-08-09T00:00:05.000Z',
      },
    });
    mocks.deleteMirroredCardIfNotNewerThan.mockRejectedValue(new Error('IndexedDB delete failed'));
    const harness = createHarness();

    await expect(harness.persistence.persist(deleteMutation)).resolves.toMatchObject({
      publication: { kind: 'delete', cardId: card.id },
      deleteReceipt: {
        finality: 'durably-queued',
        ownerId: 'user-a',
        operationId: 'cleanup-1',
        libraryEpoch: 2,
        deletedAt: '2026-08-09T00:00:05.000Z',
      },
    });
    expect(mocks.deleteDeviceCardBackupIfNotNewerThan).toHaveBeenCalledWith('user-a', card.id, {
      libraryEpoch: 2,
      revision: 3,
    }, expect.any(Object));
    expect(mocks.deleteMirroredCardIfNotNewerThan).toHaveBeenCalledWith('user-a', card.id, {
      libraryEpoch: 2,
      revision: 3,
    });
    expect(harness.acknowledgeDevicePending).not.toHaveBeenCalled();
  });

  it('preserves a current-generation same-id mirror after a stale delete', async () => {
    mocks.deleteCardWithTombstone.mockResolvedValue({
      deleted: false,
      reason: 'stale-library-epoch',
    });
    mocks.deleteMirroredCardIfOlderThan.mockResolvedValue(false);
    const harness = createHarness();

    await expect(harness.persistence.persist(deleteMutation)).resolves.toMatchObject({
      publication: { kind: 'delete', cardId: card.id },
    });
    expect(mocks.deleteMirroredCardIfOlderThan).toHaveBeenCalledWith('user-a', card.id, 3);
    expect(mocks.deleteMirroredCard).not.toHaveBeenCalled();
    expect(harness.acknowledgeDevicePending).toHaveBeenCalledWith([pendingDelete], expect.objectContaining({ token: 'test' }));
    expect(harness.updateCloudStats).not.toHaveBeenCalled();
  });

  it('derives the facet mutation ID from the persisted device delete operation', async () => {
    mocks.deleteCardWithTombstone.mockResolvedValue({
      deleted: true,
      tombstone: {
        cardId: card.id,
        opId: 'cleanup-1',
        libraryEpoch: 2,
        revision: 4,
        deletedAt: '2026-08-09T00:00:05.000Z',
      },
    });
    const harness = createHarness();

    await harness.persistence.persist({ ...deleteMutation, operationId: 'logical-delete' });

    expect(harness.updateCategoryFacets).toHaveBeenCalledWith(
      { Study: -1 },
      'facet:cleanup-1:delete',
    );
  });

  it('queues and publishes a local delete while the signed-in cloud epoch is unavailable', async () => {
    const harness = createHarness({ verifiedEpoch: null });

    await expect(harness.persistence.persist(deleteMutation)).resolves.toEqual({
      ownerKey: 'user-a',
      operationId: 'cleanup-1',
      publication: { kind: 'delete', cardId: card.id },
      deleteReceipt: {
        finality: 'durably-queued',
        ownerId: 'user-a',
        operationId: 'cleanup-1',
        libraryEpoch: 2,
        deletedAt: pendingDelete.updatedAt,
      },
    });

    expect(harness.removeDeviceCard).toHaveBeenCalledWith(card.id, {
      libraryEpoch: 2,
      baseRevisions: { [card.id]: 3 },
    });
    expect(mocks.deleteCardWithTombstone).not.toHaveBeenCalled();
    expect(harness.acknowledgeDevicePending).not.toHaveBeenCalled();
  });

  it('restores a full offline card with an explicit owner epoch and does not award XP', async () => {
    const harness = createHarness({ verifiedEpoch: null });
    const undoToken = {
      ownerKey: 'user-a', ownerId: 'user-a', card,
      expectedLibraryEpoch: 2, deleteOperationId: 'cleanup-1',
      deletedAt: pendingDelete.updatedAt, lifecycleId: 'delete-life-1', clearGeneration: 0,
    };
    const mutation: LearningStateMutation = {
      ownerKey: 'user-a', operationId: 'restore-1', operation: 'restore', intent: 'restore',
      undoToken, card, expectedLibraryEpoch: 2, operationCreatedAt: '2026-08-09T00:00:02.000Z',
      publication: { kind: 'restore', card },
    };

    await expect(harness.persistence.persist(mutation)).resolves.toEqual({
      ownerKey: 'user-a', operationId: 'restore-1',
      publication: { kind: 'restore', card }, restoreFinality: 'durably-queued',
    });
    expect(harness.restoreDeviceCard).toHaveBeenCalledWith(card, {
      ownerId: 'user-a', expectedLibraryEpoch: 2,
      operationId: 'restore-1', operationCreatedAt: mutation.operationCreatedAt,
    });
    expect(harness.updateCloudStats).not.toHaveBeenCalled();
    expect(harness.updateCategoryFacets).not.toHaveBeenCalled();
    expect(harness.addXp).not.toHaveBeenCalled();
  });

  it('updates cloud stats once and leaves restore facet settlement to the atomic card write', async () => {
    const harness = createHarness();
    harness.restoreDeviceCard.mockResolvedValue({ status: 'restored', card });
    const undoToken = {
      ownerKey: 'user-a', ownerId: 'user-a', card,
      expectedLibraryEpoch: 2, deleteOperationId: 'cleanup-1',
      deletedAt: pendingDelete.updatedAt, lifecycleId: 'delete-life-stats', clearGeneration: 0,
    };
    const mutation: LearningStateMutation = {
      ownerKey: 'user-a', operationId: 'restore-counts', operation: 'restore', intent: 'restore',
      undoToken, card, expectedLibraryEpoch: 2, operationCreatedAt: '2026-08-09T00:00:02.000Z',
      publication: { kind: 'restore', card },
    };

    await harness.persistence.persist(mutation);
    await harness.persistence.persist(mutation);

    expect(harness.updateCloudStats).toHaveBeenCalledOnce();
    const updateStats = harness.updateCloudStats.mock.calls[0][0];
    expect(updateStats({
      total: 1, reviewed: 0, easy: 0, good: 0, hard: 0, unrated: 1,
      bookmarked: 0, due: 0, legacyUnindexed: 0,
    })).toMatchObject({ total: 2, unrated: 2 });
    expect(harness.updateCategoryFacets).not.toHaveBeenCalled();
    expect(harness.addXp).not.toHaveBeenCalled();
  });

  it('does not overwrite a concurrently recreated authoritative card', async () => {
    const harness = createHarness();
    harness.restoreDeviceCard.mockResolvedValue({ status: 'existing', card: { ...card, translation: 'concurrent' } });
    const undoToken = {
      ownerKey: 'user-a', ownerId: 'user-a', card,
      expectedLibraryEpoch: 2, deleteOperationId: 'cleanup-1',
      deletedAt: pendingDelete.updatedAt, lifecycleId: 'delete-life-existing', clearGeneration: 0,
    };
    const mutation: LearningStateMutation = {
      ownerKey: 'user-a', operationId: 'restore-existing', operation: 'restore', intent: 'restore',
      undoToken, card, expectedLibraryEpoch: 2, operationCreatedAt: '2026-08-09T00:00:02.000Z',
      publication: { kind: 'restore', card },
    };

    await expect(harness.persistence.persist(mutation)).resolves.toMatchObject({
      restoreFinality: 'conflict', restoreConflictReason: 'unsafe-existing',
    });
    expect(harness.updateCloudStats).not.toHaveBeenCalled();
    expect(harness.updateCategoryFacets).not.toHaveBeenCalled();
    expect(harness.addXp).not.toHaveBeenCalled();
  });

  it('does not produce a delete receipt when the durable delete queue fails', async () => {
    const harness = createHarness();
    harness.removeDeviceCard.mockRejectedValue(new Error('device queue unavailable'));

    await expect(harness.persistence.persist(deleteMutation)).rejects.toThrow('left unchanged');
    expect(mocks.deleteCardWithTombstone).not.toHaveBeenCalled();
    expect(harness.updateCloudStats).not.toHaveBeenCalled();
  });

  it('returns a tombstone or recreation conflict without changing stats or awarding XP', async () => {
    const harness = createHarness();
    harness.restoreDeviceCard.mockResolvedValue({ status: 'conflict', reason: 'deleted-again' });
    const undoToken = {
      ownerKey: 'user-a', ownerId: 'user-a', card,
      expectedLibraryEpoch: 2, deleteOperationId: 'cleanup-1',
      deletedAt: pendingDelete.updatedAt, lifecycleId: 'delete-life-1', clearGeneration: 0,
    };
    const mutation: LearningStateMutation = {
      ownerKey: 'user-a', operationId: 'restore-conflict', operation: 'restore', intent: 'restore',
      undoToken, card, expectedLibraryEpoch: 2, operationCreatedAt: '2026-08-09T00:00:02.000Z',
      publication: { kind: 'restore', card },
    };

    await expect(harness.persistence.persist(mutation)).resolves.toMatchObject({
      restoreFinality: 'conflict', restoreConflictReason: 'deleted-again',
    });
    expect(harness.updateCloudStats).not.toHaveBeenCalled();
    expect(harness.updateCategoryFacets).not.toHaveBeenCalled();
    expect(harness.addXp).not.toHaveBeenCalled();
  });

  it('does not publish or update the new account after an in-flight restore changes owner', async () => {
    const harness = createHarness();
    let completeRestore!: (result: RestoreDeviceCardResult) => void;
    harness.restoreDeviceCard.mockImplementation(() => new Promise(resolve => { completeRestore = resolve; }));
    const undoToken = {
      ownerKey: 'user-a', ownerId: 'user-a', card,
      expectedLibraryEpoch: 2, deleteOperationId: 'cleanup-1',
      deletedAt: pendingDelete.updatedAt, lifecycleId: 'delete-life-async', clearGeneration: 0,
    };
    const mutation: LearningStateMutation = {
      ownerKey: 'user-a', operationId: 'restore-owner-switch', operation: 'restore', intent: 'restore',
      undoToken, card, expectedLibraryEpoch: 2, operationCreatedAt: '2026-08-09T00:00:02.000Z',
      publication: { kind: 'restore', card },
    };
    const pending = harness.persistence.persist(mutation);
    harness.options.ownerId = 'user-b';
    completeRestore({ status: 'restored', card });

    await expect(pending).resolves.toMatchObject({
      restoreFinality: 'conflict', restoreConflictReason: 'owner-changed',
    });
    expect(harness.updateCloudStats).not.toHaveBeenCalled();
    expect(harness.updateCategoryFacets).not.toHaveBeenCalled();
    expect(harness.addXp).not.toHaveBeenCalled();
  });

  it('clears library facets through the protected callable after card deletion', async () => {
    const clearMutation: LearningStateMutation = {
      ownerKey: 'user-a',
      operationId: 'clear-operation',
      operation: 'clear',
      intent: 'clear',
      publication: { kind: 'clear' },
    };
    mocks.clearLibraryFacets.mockResolvedValue({ categories: {}, complete: true });
    const harness = createHarness();

    await expect(harness.persistence.persist(clearMutation)).resolves.toMatchObject({
      ownerKey: 'user-a', operationId: 'clear-operation',
    });
    expect(mocks.deleteAllCards).toHaveBeenCalledWith({ kind: 'database' }, 'user-a');
    expect(mocks.clearLibraryFacets).toHaveBeenCalledWith(
      { kind: 'database' },
      'user-a',
      'clear-operation',
    );
  });
});
