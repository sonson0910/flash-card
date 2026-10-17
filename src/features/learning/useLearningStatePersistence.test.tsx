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
  findCardById: vi.fn(),
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
    mocks.applyReviewViaCallable.mockResolvedValue({ applied: true, duplicate: false, xpAwarded: 2, card: authoritative });
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
    expect(result.xpAwarded).toBe(2);
  });

  it('forwards the pre-review card with the authoritative outcome for a tier transition', async () => {
    const reviewedAt = new Date('2026-08-24T00:00:00.000Z');
    const fields = scheduleReview(card, 'easy', reviewedAt);
    const authoritative = { ...card, ...fields, revision: 4, libraryEpoch: 2 };
    mocks.applyReviewWithConflictRecovery.mockImplementation(async (
      command: ReviewCommand,
      apply: (value: ReviewCommand) => Promise<ReviewApplyResult>,
    ) => apply(command));
    mocks.applyReviewViaCallable.mockResolvedValue({
      applied: true, duplicate: true, xpAwarded: 0, card: authoritative,
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
    }, mutation.operationId, card);
  });

  it('returns the original award when retry finds the same committed review receipt', async () => {
    const reviewedAt = new Date('2026-08-24T00:00:00.000Z');
    const fields = scheduleReview(card, 'good', reviewedAt);
    const authoritative = { ...card, ...fields, revision: 4, libraryEpoch: 2 };
    mocks.applyReviewWithConflictRecovery.mockImplementation(async (
      command: ReviewCommand,
      apply: (value: ReviewCommand) => Promise<ReviewApplyResult>,
    ) => apply(command));
    mocks.applyReviewViaCallable.mockResolvedValue({ applied: true, duplicate: true, xpAwarded: 2, card: authoritative });
    const harness = createHarness();
    const mutation: LearningStateMutation = {
      ...reviewMutation, operation: 'review', fields,
      fieldMask: Object.keys(fields) as CardMutableField[], publication: { kind: 'patch', cardId: card.id, fields },
    };

    const result = await harness.persistence.persist(mutation);
    expect(result).toMatchObject({ reviewFinality: 'committed', xpAwarded: 2 });
  });

  it('reports the pinned command rating when a duplicate receipt returns a later card state', async () => {
    const reviewedAt = new Date('2026-08-24T00:00:00.000Z');
    const fields = scheduleReview(card, 'good', reviewedAt);
    const authoritative = { ...card, ...fields, revision: 4, libraryEpoch: 2 };
    const laterReview = {
      elapsedDays: 1,
      rating: 'again' as const,
      reviewedAt: '2026-08-25T00:00:00.000Z',
      scheduledDays: 0,
    };
    const cardAfterLaterReview = {
      ...authoritative,
      reviewHistory: [...(authoritative.reviewHistory ?? []), laterReview],
    };
    mocks.applyReviewWithConflictRecovery.mockImplementation(async (
      command: ReviewCommand,
      apply: (value: ReviewCommand) => Promise<ReviewApplyResult>,
    ) => apply(command));
    mocks.applyReviewViaCallable.mockResolvedValue({
      applied: true, duplicate: true, xpAwarded: 2, card: cardAfterLaterReview,
    });
    const harness = createHarness();
    const mutation: LearningStateMutation = {
      ...reviewMutation, operation: 'review', fields,
      fieldMask: Object.keys(fields) as CardMutableField[], publication: { kind: 'patch', cardId: card.id, fields },
    };

    await expect(harness.persistence.persist(mutation)).resolves.toMatchObject({
      reviewFinality: 'committed', xpAwarded: 2, reviewRating: 'good',
    });
  });

  it('does not publish an older duplicate card over a newer local review', async () => {
    const reviewedAt = new Date('2026-08-24T00:00:00.000Z');
    const fields = scheduleReview(card, 'good', reviewedAt);
    const authoritative = { ...card, ...fields, revision: 4, libraryEpoch: 2 };
    const newerFields = scheduleReview(authoritative, 'again', new Date('2026-08-25T00:00:00.000Z'));
    const newerLocalCard = { ...authoritative, ...newerFields, revision: 5, libraryEpoch: 2 };
    let firstAttempt = true;
    mocks.applyReviewWithConflictRecovery.mockImplementation(async (
      command: ReviewCommand,
      apply: (value: ReviewCommand) => Promise<ReviewApplyResult>,
    ) => {
      const result = await apply(command);
      if (firstAttempt) {
        firstAttempt = false;
        throw new Error('lost response');
      }
      return result;
    });
    mocks.applyReviewViaCallable.mockResolvedValue({
      applied: true, duplicate: true, xpAwarded: 2, card: authoritative,
    });
    const harness = createHarness();
    const mutation: LearningStateMutation = {
      ...reviewMutation, operation: 'review', fields,
      fieldMask: Object.keys(fields) as CardMutableField[], publication: { kind: 'patch', cardId: card.id, fields },
    };

    await expect(harness.persistence.persist(mutation)).rejects.toThrow('lost response');
    harness.options.findCard = () => newerLocalCard;
    const result = await harness.persistence.persist(mutation);

    expect(result).toMatchObject({ reviewFinality: 'committed', xpAwarded: 2, reviewRating: 'good' });
    expect(result.publication).toMatchObject({
      kind: 'patch',
      cardId: card.id,
      fields: {
        reviews: newerLocalCard.reviews,
        revision: newerLocalCard.revision,
        libraryEpoch: newerLocalCard.libraryEpoch,
        reviewHistory: newerLocalCard.reviewHistory,
      },
    });
    expect(harness.updateCloudStats).not.toHaveBeenCalled();
  });

  it('replays the rebased review payload after its response is lost', async () => {
    const reviewedAt = new Date('2026-08-24T00:00:00.000Z');
    const fields = scheduleReview(card, 'good', reviewedAt);
    const authoritative = { ...card, ...fields, revision: 5, libraryEpoch: 2 };
    const rebased: ReviewCommand = {
      cardId: card.id,
      opId: reviewMutation.operationId,
      baseRevision: 4,
      libraryEpoch: 2,
      rating: 'good',
      reviewedAt: reviewedAt.toISOString(),
      fields,
      fieldMask: Object.keys(fields) as CardMutableField[],
      timeZone: 'Asia/Saigon',
    };
    let invocation = 0;
    mocks.applyReviewWithConflictRecovery.mockImplementation(async (
      command: ReviewCommand,
      apply: (value: ReviewCommand) => Promise<ReviewApplyResult>,
    ) => {
      invocation += 1;
      if (invocation === 1) {
        await apply(rebased);
        throw new Error('lost rebased response');
      }
      return apply(command);
    });
    mocks.applyReviewViaCallable.mockResolvedValue({ applied: true, duplicate: true, xpAwarded: 2, card: authoritative });
    const harness = createHarness();
    const mutation: LearningStateMutation = {
      ...reviewMutation, operation: 'review', fields,
      fieldMask: Object.keys(fields) as CardMutableField[], publication: { kind: 'patch', cardId: card.id, fields },
    };

    await expect(harness.persistence.persist(mutation)).rejects.toThrow('lost rebased response');
    await expect(harness.persistence.persist(mutation)).resolves.toMatchObject({ reviewFinality: 'committed', xpAwarded: 2 });

    expect(mocks.applyReviewWithConflictRecovery.mock.calls[1][0]).toEqual(rebased);
  });

  it('retains an unresolved rebased command while resolved commands are evicted', async () => {
    const reviewedAt = new Date('2026-08-24T00:00:00.000Z');
    const fields = scheduleReview(card, 'good', reviewedAt);
    const rebased: ReviewCommand = {
      cardId: card.id,
      opId: reviewMutation.operationId,
      baseRevision: 4,
      libraryEpoch: 2,
      rating: 'good',
      reviewedAt: reviewedAt.toISOString(),
      fields: scheduleReview({ ...card, revision: 4 }, 'good', reviewedAt),
      fieldMask: Object.keys(fields) as CardMutableField[],
      timeZone: 'Asia/Saigon',
    };
    let firstAttempt = true;
    mocks.applyReviewWithConflictRecovery.mockImplementation(async (
      command: ReviewCommand,
      apply: (value: ReviewCommand) => Promise<ReviewApplyResult>,
    ) => {
      if (command.opId === reviewMutation.operationId && firstAttempt) {
        firstAttempt = false;
        await apply(rebased);
        throw new Error('lost rebased response');
      }
      return apply(command);
    });
    mocks.applyReviewViaCallable.mockResolvedValue({
      applied: true,
      duplicate: true,
      xpAwarded: 2,
      card: { ...card, ...rebased.fields, revision: 5, libraryEpoch: 2 },
    });
    const harness = createHarness();
    const firstMutation: LearningStateMutation = {
      ...reviewMutation,
      operation: 'review',
      fields,
      fieldMask: Object.keys(fields) as CardMutableField[],
      publication: { kind: 'patch', cardId: card.id, fields },
    };

    await expect(harness.persistence.persist(firstMutation)).rejects.toThrow('lost rebased response');
    for (let index = 0; index < 500; index += 1) {
      await harness.persistence.persist({
        ...firstMutation,
        operationId: `filler-${index}`,
      });
    }
    await harness.persistence.persist(firstMutation);

    expect(mocks.applyReviewViaCallable.mock.calls.at(-1)?.[2]).toEqual(rebased);
  });

  it('replays a retained receipt after the card disappears from the local snapshot', async () => {
    const reviewedAt = new Date('2026-08-24T00:00:00.000Z');
    const fields = scheduleReview(card, 'good', reviewedAt);
    const authoritative = { ...card, ...fields, revision: 4, libraryEpoch: 2 };
    let firstAttempt = true;
    mocks.applyReviewWithConflictRecovery.mockImplementation(async (
      command: ReviewCommand,
      apply: (value: ReviewCommand) => Promise<ReviewApplyResult>,
    ) => {
      const result = await apply(command);
      if (firstAttempt) {
        firstAttempt = false;
        throw new Error('lost response after commit');
      }
      return result;
    });
    mocks.applyReviewViaCallable.mockResolvedValue({ applied: true, duplicate: true, xpAwarded: 2, card: authoritative });
    const harness = createHarness();
    const mutation: LearningStateMutation = {
      ...reviewMutation,
      operation: 'review',
      fields,
      fieldMask: Object.keys(fields) as CardMutableField[],
      publication: { kind: 'patch', cardId: card.id, fields },
    };

    await expect(harness.persistence.persist(mutation)).rejects.toThrow('lost response after commit');
    harness.options.findCard = () => undefined;

    await expect(harness.persistence.persist(mutation)).resolves.toMatchObject({
      reviewFinality: 'committed', xpAwarded: 2, reviewRating: 'good',
    });
    expect(mocks.applyReviewViaCallable.mock.calls[1][2]).toEqual(mocks.applyReviewViaCallable.mock.calls[0][2]);
    expect(harness.updateCloudStats).not.toHaveBeenCalled();
  });

  it('evicts a resolved missing-card command instead of counting it as unresolved', async () => {
    const reviewedAt = new Date('2026-08-24T00:00:00.000Z');
    const fields = scheduleReview(card, 'good', reviewedAt);
    const authoritative = { ...card, ...fields, revision: 4, libraryEpoch: 2 };
    let firstAttempt = true;
    mocks.applyReviewWithConflictRecovery.mockImplementation(async (
      command: ReviewCommand,
      apply: (value: ReviewCommand) => Promise<ReviewApplyResult>,
    ) => {
      const result = await apply(command);
      if (firstAttempt) {
        firstAttempt = false;
        throw new Error('lost response after commit');
      }
      return result;
    });
    mocks.applyReviewViaCallable.mockResolvedValue({ applied: true, duplicate: true, xpAwarded: 2, card: authoritative });
    const harness = createHarness();
    const mutation: LearningStateMutation = {
      ...reviewMutation,
      operation: 'review',
      fields,
      fieldMask: Object.keys(fields) as CardMutableField[],
      publication: { kind: 'patch', cardId: card.id, fields },
    };

    await expect(harness.persistence.persist(mutation)).rejects.toThrow('lost response after commit');
    harness.options.findCard = () => undefined;
    await harness.persistence.persist(mutation);

    mocks.applyReviewWithConflictRecovery.mockRejectedValue(new Error('still unresolved'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      for (let index = 0; index < 500; index += 1) {
        await expect(harness.persistence.persist({
          ...mutation,
          operationId: `filler-${index}`,
        })).rejects.toThrow('still unresolved');
      }
    } finally {
      warn.mockRestore();
    }
    expect(mocks.applyReviewWithConflictRecovery).toHaveBeenCalledTimes(502);
  });

  it('fails closed when an immediate review has no valid final history entry', async () => {
    const harness = createHarness();

    const result = await harness.persistence.persist(invalidReviewMutation);

    expect(mocks.applyReviewViaCallable).not.toHaveBeenCalled();
    expect(mocks.applyReviewWithConflictRecovery).not.toHaveBeenCalled();
    expect(mocks.applyCardPatchIfCurrent).not.toHaveBeenCalled();
    expect(result.reviewFinality).toBe('conflict');
    expect(result.reviewConflictTerminal).toBe(true);
    expect(harness.reportError).toHaveBeenCalled();
    expect(harness.updateCloudStats).not.toHaveBeenCalled();
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
    expect(harness.options.refreshCloud).toHaveBeenCalledOnce();
    expect(harness.updateCloudStats).not.toHaveBeenCalled();
    expect(harness.onReviewOutcome).not.toHaveBeenCalled();
  });

  it('releases a permanently rejected command from unresolved retry capacity', async () => {
    const reviewedAt = new Date('2026-08-24T00:00:00.000Z');
    const fields = scheduleReview(card, 'good', reviewedAt);
    const permanent = new ProtectedFunctionError({
      message: 'Review rejected.', kind: 'permission', code: 'permission-denied', retryable: false,
    });
    mocks.applyReviewWithConflictRecovery.mockRejectedValueOnce(permanent);
    const harness = createHarness();
    const mutation: LearningStateMutation = {
      ...reviewMutation, operation: 'review', fields,
      fieldMask: Object.keys(fields) as CardMutableField[], publication: { kind: 'patch', cardId: card.id, fields },
    };

    await expect(harness.persistence.persist(mutation)).rejects.toBe(permanent);
    mocks.applyReviewWithConflictRecovery.mockImplementation(async (
      command: ReviewCommand,
    ) => {
      if (command.opId !== 'after-permanent') throw new Error('still unresolved');
      return { applied: true, duplicate: true, xpAwarded: 2, card: { ...card, ...fields, revision: 4 } };
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      for (let index = 0; index < 499; index += 1) {
        await expect(harness.persistence.persist({
          ...mutation,
          operationId: `unresolved-${index}`,
        })).rejects.toThrow('still unresolved');
      }
    } finally {
      warn.mockRestore();
    }

    await expect(harness.persistence.persist({ ...mutation, operationId: 'after-permanent' }))
      .resolves.toMatchObject({ reviewFinality: 'committed', xpAwarded: 2 });
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
    expect(mocks.deleteAllCards).toHaveBeenCalledWith({ kind: 'database' }, 'user-a', 4);
    expect(mocks.clearLibraryFacets).toHaveBeenCalledWith(
      { kind: 'database' },
      'user-a',
      'clear-operation',
    );
    expect(harness.acceptVerifiedEpoch).toHaveBeenCalledWith('user-a', 4);
    expect(harness.options.resetCloudState).toHaveBeenCalledWith(true);
  });

  it('propagates a partial clear when metadata cleanup fails after cards were deleted', async () => {
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

    await expect(harness.persistence.persist(clearMutation)).rejects.toThrow(
      'Cards were deleted, but library metadata could not be fully reset. Refreshing the cloud view now.',
    );
    expect(harness.options.resetCloudState).toHaveBeenCalledWith(false);
    expect(harness.reportError).not.toHaveBeenCalled();
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
