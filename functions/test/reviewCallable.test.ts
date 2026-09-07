import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

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

  it('authorizes before quota consumption and persistence', () => {
    const source = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');
    const start = source.indexOf('export const reviewCard =');
    const end = source.indexOf('const createSharedDeckOptions =');
    const handler = source.slice(start, end);

    expect(start).toBeGreaterThan(-1);
    expect(handler.indexOf('input.expectedOwnerId')).toBeGreaterThan(-1);
    expect(handler.indexOf('input.expectedOwnerId')).toBeLessThan(handler.indexOf('await consumeBudget'));
    expect(handler.indexOf('input.expectedOwnerId')).toBeLessThan(handler.indexOf('applyReviewForOwner'));
  });
});
