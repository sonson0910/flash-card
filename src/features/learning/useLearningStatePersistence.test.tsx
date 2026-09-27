import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CardData } from '../../types/card';
import type {
  LearningPersistenceOptions,
  LearningPersistenceStats,
} from './learningPersistencePort';
import type { LearningStateMutation } from './learningStateController';
import type { LearningStatePersistencePort } from './useLearningState';
import type { ReviewApplyResult, ReviewCommand } from '../../lib/cardReviewRepository';
import type { CardMutableField } from '../../lib/cardMutationProtocol';
import { scheduleReview } from '../../lib/reviewScheduler';
import { ProtectedFunctionError } from '../../lib/protectedFunctionsCapability';

const mocks = vi.hoisted(() => ({
  applyCardPatchIfCurrent: vi.fn(),
  bulkPatchCards: vi.fn(),
  createCardIfAbsent: vi.fn(),
  deleteAllCards: vi.fn(),
  clearLibraryFacets: vi.fn(),
  deleteCardWithTombstone: vi.fn(),
  getLibraryEpoch: vi.fn(),
  incrementLibraryEpoch: vi.fn(),
  applyReviewViaCallable: vi.fn(),
  applyReviewWithConflictRecovery: vi.fn(),
}));

vi.mock('../../lib/cardRepository', async () => {
  const actual = await vi.importActual<typeof import('../../lib/cardRepository')>('../../lib/cardRepository');
  return {
    ...actual,
    applyCardPatchIfCurrent: mocks.applyCardPatchIfCurrent,
    bulkPatchCards: mocks.bulkPatchCards,
    createCardIfAbsent: mocks.createCardIfAbsent,
    deleteAllCards: mocks.deleteAllCards,
    clearLibraryFacets: mocks.clearLibraryFacets,
    deleteCardWithTombstone: mocks.deleteCardWithTombstone,
    getLibraryEpoch: mocks.getLibraryEpoch,
    incrementLibraryEpoch: mocks.incrementLibraryEpoch,
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
  handleFirestoreError: vi.fn(),
  isFirebaseConfigured: true,
  OperationType: { DELETE: 'delete' },
}));

import { CardMutationPreconditionError } from '../../lib/cardRepository';
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
}: {
  verifiedEpoch?: number | null;
} = {}) {
  const updateCloudStats = vi.fn<(update: (current: LearningPersistenceStats) => LearningPersistenceStats) => void>();
  const updateCategoryFacets = vi.fn(async () => undefined);
  const onReviewOutcome = vi.fn();
  const reportError = vi.fn();
  const acceptVerifiedEpoch = vi.fn();
  const options: LearningPersistenceOptions = {
    ownerId: 'user-a',
    verifiedEpoch,
    knownLibraryTotal: 1,
    validateRestore: () => null,
    findCard: cardId => cardId === card.id ? card : undefined,
    canPublishPatch: () => true,
    acceptVerifiedEpoch,
    updateCloudStats,
    updateCategoryFacets,
    resetCloudState: vi.fn(),
    resetCloudPage: vi.fn(),
    refreshCloud: vi.fn(),
    setCloudUnavailable: vi.fn(),
    setMutationPending: vi.fn(),
    reportError,
    onReviewOutcome,
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
    updateCloudStats,
    updateCategoryFacets,
    onReviewOutcome,
    reportError,
    acceptVerifiedEpoch,
  };
}

describe('useLearningStatePersistence patch reconciliation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getLibraryEpoch.mockResolvedValue(3);
  });

  it('publishes a delete and refreshes the epoch when the library was reset', async () => {
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
    expect(harness.acceptVerifiedEpoch).toHaveBeenCalledWith('user-a', 3);
    expect(harness.reportError).toHaveBeenCalled();
    expect(harness.updateCloudStats).not.toHaveBeenCalled();
    expect(harness.onReviewOutcome).not.toHaveBeenCalled();
  });

  it('publishes a delete when the cloud card is missing, without refreshing the epoch', async () => {
    mocks.applyCardPatchIfCurrent.mockResolvedValue({ applied: false, reason: 'missing' });
    const harness = createHarness();

    await expect(harness.persistence.persist(reviewMutation)).resolves.toEqual({
      ownerKey: 'user-a',
      operationId: 'review-1',
      publication: { kind: 'delete', cardId: card.id },
    });
    expect(mocks.getLibraryEpoch).not.toHaveBeenCalled();
    expect(harness.updateCloudStats).not.toHaveBeenCalled();
  });

  it('reports an error and throws on a future-library-epoch or repeated revision conflict', async () => {
    mocks.applyCardPatchIfCurrent.mockResolvedValue({ applied: false, reason: 'future-library-epoch' });
    const harness = createHarness();

    await expect(harness.persistence.persist(reviewMutation)).rejects.toThrow();
    expect(harness.reportError).toHaveBeenCalled();
  });

  it('routes an immediate review through the protected callable without local XP', async () => {
    const reviewedAt = new Date('2026-08-24T00:00:00.000Z');
    const fields = scheduleReview(card, 'good', reviewedAt);
    const authoritative = { ...card, ...fields, revision: 4, libraryEpoch: 2 };
    mocks.applyReviewWithConflictRecovery.mockImplementation(async (
      command: ReviewCommand,
      apply: (value: ReviewCommand) => Promise<ReviewApplyResult>,
    ) => apply(command));
    mocks.applyReviewViaCallable.mockResolvedValue({ applied: true, duplicate: false, card: authoritative });
    const harness = createHarness();
    const mutation: LearningStateMutation = {
      ...reviewMutation,
      operation: 'review',
      fields,
      fieldMask: Object.keys(fields) as CardMutableField[],
      publication: { kind: 'patch', cardId: card.id, fields },
    };

    const result = await harness.persistence.persist(mutation);

    expect(mocks.applyReviewViaCallable).toHaveBeenCalledWith(
      expect.anything(),
      'user-a',
      expect.objectContaining({ opId: mutation.operationId, rating: 'good', reviewedAt: reviewedAt.toISOString() }),
    );
    expect(harness.onReviewOutcome).not.toHaveBeenCalled();
    expect(result.reviewFinality).toBe('committed');
  });

  it('forwards the authoritative review outcome with its operation ID, including a replay', async () => {
    const reviewedAt = new Date('2026-08-24T00:00:00.000Z');
    const fields = scheduleReview(card, 'easy', reviewedAt);
    const authoritative = { ...card, ...fields, revision: 4, libraryEpoch: 2 };
    mocks.applyReviewWithConflictRecovery.mockImplementation(async (
      command: ReviewCommand,
      apply: (value: ReviewCommand) => Promise<ReviewApplyResult>,
    ) => apply(command));
    mocks.applyReviewViaCallable.mockResolvedValue({
      applied: true, duplicate: true, card: authoritative,
      gamification: { xp: 2, level: 1, streak: 1, studyDay: '2026-08-24', events: [] },
      ceremonyEvents: ['tierup'],
    });
    const harness = createHarness();
    const mutation: LearningStateMutation = {
      ...reviewMutation, operation: 'review', fields,
      fieldMask: Object.keys(fields) as CardMutableField[], publication: { kind: 'patch', cardId: card.id, fields },
    };

    await harness.persistence.persist(mutation);

    expect(harness.onReviewOutcome).toHaveBeenCalledWith({
      gamification: { xp: 2, level: 1, streak: 1, studyDay: '2026-08-24', events: [] },
      ceremonyEvents: ['tierup'],
    }, mutation.operationId, authoritative);
  });

  it('fails closed when an immediate review has no valid final history entry', async () => {
    const harness = createHarness();

    const result = await harness.persistence.persist(invalidReviewMutation);

    expect(mocks.applyReviewViaCallable).not.toHaveBeenCalled();
    expect(mocks.applyReviewWithConflictRecovery).not.toHaveBeenCalled();
    expect(mocks.applyCardPatchIfCurrent).not.toHaveBeenCalled();
    expect(result.reviewFinality).toBe('conflict');
    expect(harness.reportError).toHaveBeenCalled();
  });

  it('refreshes from the cloud and rethrows on a permanently rejected review', async () => {
    const reviewedAt = new Date('2026-08-24T00:00:00.000Z');
    const fields = scheduleReview(card, 'good', reviewedAt);
    const permanent = new ProtectedFunctionError({
      message: 'Review rejected.', kind: 'permission', code: 'permission-denied', retryable: false,
    });
    mocks.applyReviewWithConflictRecovery.mockRejectedValue(permanent);
    const harness = createHarness();
    const mutation: LearningStateMutation = {
      ...reviewMutation, operation: 'review', fields,
      fieldMask: Object.keys(fields) as CardMutableField[], publication: { kind: 'patch', cardId: card.id, fields },
    };

    await expect(harness.persistence.persist(mutation)).rejects.toBe(permanent);
    expect(harness.updateCloudStats).not.toHaveBeenCalled();
    expect(harness.onReviewOutcome).not.toHaveBeenCalled();
  });

  it('marks the cloud unavailable and rethrows on a retryable network failure', async () => {
    const networkError = Object.assign(new Error('offline'), { code: 'unavailable' });
    mocks.applyCardPatchIfCurrent.mockRejectedValue(networkError);
    const harness = createHarness();

    await expect(harness.persistence.persist(reviewMutation)).rejects.toBe(networkError);
    expect(harness.options.setCloudUnavailable).toHaveBeenCalledWith(true);
    expect(harness.reportError).toHaveBeenCalled();
  });

  it('rejects a patch or review when the cloud epoch is unverified', async () => {
    const harness = createHarness({ verifiedEpoch: null });

    await expect(harness.persistence.persist(reviewMutation)).rejects.toThrow();
    expect(mocks.applyCardPatchIfCurrent).not.toHaveBeenCalled();
  });

  it('commits a delete, updates stats, and derives the facet mutation ID from the operation', async () => {
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

    await expect(harness.persistence.persist(deleteMutation)).resolves.toMatchObject({
      publication: { kind: 'delete', cardId: card.id },
      deleteReceipt: {
        finality: 'committed',
        ownerId: 'user-a',
        operationId: 'cleanup-1',
        libraryEpoch: 2,
        deletedAt: '2026-08-09T00:00:05.000Z',
      },
    });
    expect(harness.updateCategoryFacets).toHaveBeenCalledWith(
      { Study: -1 },
      expect.stringContaining('delete'),
    );
  });

  it('refreshes the epoch without a receipt when a delete is stale', async () => {
    mocks.deleteCardWithTombstone.mockResolvedValue({ deleted: false, reason: 'stale-library-epoch' });
    const harness = createHarness();

    await expect(harness.persistence.persist(deleteMutation)).resolves.toEqual({
      ownerKey: 'user-a',
      operationId: 'cleanup-1',
      publication: { kind: 'delete', cardId: card.id },
    });
    expect(harness.acceptVerifiedEpoch).toHaveBeenCalledWith('user-a', 3);
    expect(harness.updateCloudStats).not.toHaveBeenCalled();
  });

  it('reports an error and throws when a delete conflicts on a future epoch', async () => {
    mocks.deleteCardWithTombstone.mockResolvedValue({ deleted: false, reason: 'future-library-epoch' });
    const harness = createHarness();

    await expect(harness.persistence.persist(deleteMutation)).rejects.toThrow();
    expect(harness.reportError).toHaveBeenCalled();
  });

  it('classifies a Firestore write failure and rethrows on delete', async () => {
    const permissionError = Object.assign(new Error('denied'), { code: 'permission-denied' });
    mocks.deleteCardWithTombstone.mockRejectedValue(permissionError);
    const harness = createHarness();

    await expect(harness.persistence.persist(deleteMutation)).rejects.toBe(permissionError);
    expect(harness.options.setCloudUnavailable).toHaveBeenCalledWith(true);
  });

  it('restores a card through createCardIfAbsent and counts stats once per operation', async () => {
    mocks.createCardIfAbsent.mockResolvedValue({ card, created: true });
    const harness = createHarness();
    const undoToken = {
      ownerKey: 'user-a', ownerId: 'user-a', card,
      expectedLibraryEpoch: 2, deleteOperationId: 'cleanup-1',
      deletedAt: '2026-08-09T00:00:01.000Z', lifecycleId: 'delete-life-stats', clearGeneration: 0,
    };
    const mutation: LearningStateMutation = {
      ownerKey: 'user-a', operationId: 'restore-counts', operation: 'restore', intent: 'restore',
      undoToken, card, expectedLibraryEpoch: 2, operationCreatedAt: '2026-08-09T00:00:02.000Z',
      publication: { kind: 'restore', card },
    };

    await harness.persistence.persist(mutation);
    await harness.persistence.persist(mutation);

    expect(mocks.createCardIfAbsent).toHaveBeenCalledWith(
      { kind: 'database' }, 'user-a', card,
      expect.objectContaining({ restore: true, opId: 'restore-counts' }),
    );
    expect(harness.updateCloudStats).toHaveBeenCalledOnce();
  });

  it('maps a deleted precondition to a deleted-again conflict', async () => {
    mocks.createCardIfAbsent.mockRejectedValue(new CardMutationPreconditionError('deleted'));
    const harness = createHarness();
    const undoToken = {
      ownerKey: 'user-a', ownerId: 'user-a', card,
      expectedLibraryEpoch: 2, deleteOperationId: 'cleanup-1',
      deletedAt: '2026-08-09T00:00:01.000Z', lifecycleId: 'delete-life-1', clearGeneration: 0,
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
  });

  it('rejects a restore that resolves to a different existing card identity', async () => {
    mocks.createCardIfAbsent.mockResolvedValue({ card: { ...card, id: 'other-id' }, created: true });
    const harness = createHarness();
    const undoToken = {
      ownerKey: 'user-a', ownerId: 'user-a', card,
      expectedLibraryEpoch: 2, deleteOperationId: 'cleanup-1',
      deletedAt: '2026-08-09T00:00:01.000Z', lifecycleId: 'delete-life-existing', clearGeneration: 0,
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
  });

  it('rejects a restore when the owner changes mid-flight', async () => {
    const harness = createHarness();
    let completeCreate!: (value: { card: CardData; created: boolean }) => void;
    mocks.createCardIfAbsent.mockImplementation(() => new Promise(resolve => { completeCreate = resolve; }));
    const undoToken = {
      ownerKey: 'user-a', ownerId: 'user-a', card,
      expectedLibraryEpoch: 2, deleteOperationId: 'cleanup-1',
      deletedAt: '2026-08-09T00:00:01.000Z', lifecycleId: 'delete-life-async', clearGeneration: 0,
    };
    const mutation: LearningStateMutation = {
      ownerKey: 'user-a', operationId: 'restore-owner-switch', operation: 'restore', intent: 'restore',
      undoToken, card, expectedLibraryEpoch: 2, operationCreatedAt: '2026-08-09T00:00:02.000Z',
      publication: { kind: 'restore', card },
    };
    const pending = harness.persistence.persist(mutation);
    harness.options.ownerId = 'user-b';
    completeCreate({ card, created: true });

    await expect(pending).resolves.toMatchObject({
      restoreFinality: 'conflict', restoreConflictReason: 'owner-changed',
    });
    expect(harness.updateCloudStats).not.toHaveBeenCalled();
  });

  it('clears the library through the protected epoch reset and facet callable', async () => {
    const clearMutation: LearningStateMutation = {
      ownerKey: 'user-a',
      operationId: 'clear-operation',
      operation: 'clear',
      intent: 'clear',
      publication: { kind: 'clear' },
    };
    mocks.incrementLibraryEpoch.mockResolvedValue(4);
    mocks.deleteAllCards.mockResolvedValue(undefined);
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
    expect(harness.acceptVerifiedEpoch).toHaveBeenCalledWith('user-a', 4);
    expect(harness.options.resetCloudState).toHaveBeenCalledWith(true);
  });

  it('softly recovers a clear when metadata cleanup fails after cards were deleted', async () => {
    const clearMutation: LearningStateMutation = {
      ownerKey: 'user-a',
      operationId: 'clear-operation',
      operation: 'clear',
      intent: 'clear',
      publication: { kind: 'clear' },
    };
    mocks.incrementLibraryEpoch.mockResolvedValue(4);
    mocks.deleteAllCards.mockResolvedValue(undefined);
    mocks.clearLibraryFacets.mockRejectedValue(new Error('facet reset unavailable'));
    const harness = createHarness();

    await expect(harness.persistence.persist(clearMutation)).resolves.toMatchObject({
      ownerKey: 'user-a', operationId: 'clear-operation',
    });
    expect(harness.options.resetCloudState).toHaveBeenCalledWith(false);
    expect(harness.reportError).toHaveBeenCalled();
  });

  it('throws when a clear fails before any card is deleted', async () => {
    mocks.incrementLibraryEpoch.mockRejectedValue(new Error('epoch bump unavailable'));
    const clearMutation: LearningStateMutation = {
      ownerKey: 'user-a',
      operationId: 'clear-operation',
      operation: 'clear',
      intent: 'clear',
      publication: { kind: 'clear' },
    };
    const harness = createHarness();

    await expect(harness.persistence.persist(clearMutation)).rejects.toThrow();
    expect(mocks.deleteAllCards).not.toHaveBeenCalled();
  });
});

describe('useLearningStatePersistence bulk patching', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sends one bulk request built from each card\'s own known revision', async () => {
    mocks.bulkPatchCards.mockResolvedValue({
      libraryEpoch: 2,
      outcomes: [{ cardId: card.id, applied: true, revision: 4 }],
    });
    const harness = createHarness();

    const outcomes = await harness.persistence.persistBulkPatch!([
      { cardId: card.id, fields: { bookmarked: true } },
    ]);

    expect(mocks.bulkPatchCards).toHaveBeenCalledTimes(1);
    expect(mocks.bulkPatchCards).toHaveBeenCalledWith(
      { kind: 'database' },
      'user-a',
      [{ cardId: card.id, baseRevision: 3, fields: { bookmarked: true }, fieldMask: ['bookmarked'] }],
    );
    expect(outcomes).toEqual([{
      cardId: card.id,
      applied: true,
      publication: {
        kind: 'patch',
        cardId: card.id,
        fields: {
          bookmarked: true,
          schemaVersion: 2,
          revision: 4,
          libraryEpoch: 2,
          updatedAt: expect.any(String),
        },
      },
    }]);
    expect(harness.updateCloudStats).toHaveBeenCalledTimes(1);
    expect(harness.acceptVerifiedEpoch).not.toHaveBeenCalled();
  });

  it('skips a card that is not locally known instead of including it in the callable request', async () => {
    mocks.bulkPatchCards.mockResolvedValue({
      libraryEpoch: 2,
      outcomes: [{ cardId: card.id, applied: true, revision: 4 }],
    });
    const harness = createHarness();

    const outcomes = await harness.persistence.persistBulkPatch!([
      { cardId: card.id, fields: { customDeck: 'Deck A' } },
      { cardId: 'word-unknown', fields: { customDeck: 'Deck A' } },
    ]);

    expect(mocks.bulkPatchCards).toHaveBeenCalledWith(
      { kind: 'database' },
      'user-a',
      [{ cardId: card.id, baseRevision: 3, fields: { customDeck: 'Deck A' }, fieldMask: ['customDeck'] }],
    );
    expect(outcomes).toEqual([
      { cardId: card.id, applied: true, publication: expect.objectContaining({ kind: 'patch', cardId: card.id }) },
      { cardId: 'word-unknown', applied: false },
    ]);
  });

  it('reports an error and returns a failed outcome for a card the batch could not apply', async () => {
    mocks.bulkPatchCards.mockResolvedValue({
      libraryEpoch: 2,
      outcomes: [{ cardId: card.id, applied: false, reason: 'revision-conflict', currentRevision: 9 }],
    });
    const harness = createHarness();

    const outcomes = await harness.persistence.persistBulkPatch!([
      { cardId: card.id, fields: { bookmarked: true } },
    ]);

    expect(outcomes).toEqual([{ cardId: card.id, applied: false }]);
    expect(harness.reportError).toHaveBeenCalled();
    expect(harness.updateCloudStats).not.toHaveBeenCalled();
  });

  it('accepts the settled epoch when the bulk batch resolved it against a drifted generation', async () => {
    mocks.bulkPatchCards.mockResolvedValue({
      libraryEpoch: 3,
      outcomes: [{ cardId: card.id, applied: true, revision: 5 }],
    });
    const harness = createHarness();

    await harness.persistence.persistBulkPatch!([{ cardId: card.id, fields: { bookmarked: true } }]);

    expect(harness.acceptVerifiedEpoch).toHaveBeenCalledWith('user-a', 3);
  });

  it('rejects immediately when the cloud library is not ready', async () => {
    const harness = createHarness({ verifiedEpoch: null });

    await expect(harness.persistence.persistBulkPatch!([{ cardId: card.id, fields: { bookmarked: true } }]))
      .rejects.toThrow('Cloud library storage is not ready yet. Try again in a moment.');
    expect(mocks.bulkPatchCards).not.toHaveBeenCalled();
  });
});
