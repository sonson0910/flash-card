import { describe, expect, it, vi } from 'vitest';
import { createReviewCardHandler, toReviewHttpsError } from '../src/index.js';
import { ReviewPersistenceConflictError } from '../src/reviewPersistence.js';

const reviewData = (expectedOwnerId: string | undefined) => ({
  expectedOwnerId,
  opId: 'device-a:review-1',
  cardId: 'word-focus',
  baseRevision: 3,
  libraryEpoch: 2,
  rating: 'good',
  reviewedAt: '2026-08-24T00:00:00.000Z',
  fields: {
    difficulty: 'good',
    nextReviewDate: '2026-08-24T00:10:00.000Z',
    reviews: 1,
    interval: 0,
    easeFactor: 2.788189603,
    fsrs: {},
    reviewHistory: [],
    correctStreak: 1,
  },
  fieldMask: [
    'difficulty', 'nextReviewDate', 'reviews', 'interval', 'easeFactor',
    'fsrs', 'reviewHistory', 'correctStreak',
  ],
});

describe('review callable rollout', () => {
  it.each([
    [undefined, 'invalid-argument'],
    ['owner-2', 'permission-denied'],
  ] as const)('denies a request with expected owner %s before persistence', async (expectedOwnerId, code) => {
    const { reviewCard } = await import('../src/index.js');

    await expect(reviewCard.run({
      auth: { uid: 'owner-1' },
      data: reviewData(expectedOwnerId),
    } as never)).rejects.toMatchObject({ code });
  });

  it('authorizes before quota consumption and persistence', async () => {
    const consumeBudget = vi.fn(async () => undefined);
    const applyReviewForOwner = vi.fn(async () => ({ applied: true }));
    const handler = createReviewCardHandler(false, { consumeBudget, applyReviewForOwner });

    await expect(handler({
      auth: { uid: 'owner-1' },
      data: reviewData('owner-2'),
    } as never)).rejects.toMatchObject({ code: 'permission-denied' });
    expect(consumeBudget).not.toHaveBeenCalled();
    expect(applyReviewForOwner).not.toHaveBeenCalled();
  });

  it('keeps strict rejection reasons off the legacy endpoint while V2 receives them', () => {
    const rejection = new ReviewPersistenceConflictError('stale-review');

    const legacy = toReviewHttpsError(rejection, false);
    const v2 = toReviewHttpsError(rejection, true);

    expect(legacy.code).toBe('failed-precondition');
    expect(legacy.details).toBeUndefined();
    expect(v2.details).toEqual({ reason: 'stale-review' });
  });
});
