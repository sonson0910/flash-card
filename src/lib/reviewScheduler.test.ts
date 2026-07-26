import { describe, expect, it } from 'vitest';
import { State } from 'ts-fsrs';
import type { CardData } from '../types/card';
import { scheduleReview } from './reviewScheduler';

const legacyCard: CardData = {
  id: 'card-1',
  word: 'hesitate',
  translation: 'do dự',
  explanation: 'To pause before acting.',
  phonetic: '/ˈhez.ɪ.teɪt/',
  emoji: '🤨',
  category: 'Action',
  audioUrl: null,
  imageUrl: null,
};

describe('scheduleReview', () => {
  it('schedules all four ratings and appends an immutable review record', () => {
    const now = new Date('2026-07-12T09:00:00.000Z');

    const again = scheduleReview(legacyCard, 'again', now);
    const hard = scheduleReview(legacyCard, 'hard', now);
    const good = scheduleReview(legacyCard, 'good', now);
    const easy = scheduleReview(legacyCard, 'easy', now);

    expect(new Date(again.nextReviewDate).getTime()).toBeGreaterThan(now.getTime());
    expect(new Date(hard.nextReviewDate).getTime()).toBeGreaterThan(now.getTime());
    expect(new Date(good.nextReviewDate).getTime()).toBeGreaterThan(now.getTime());
    expect(new Date(easy.nextReviewDate).getTime()).toBeGreaterThan(new Date(good.nextReviewDate).getTime());
    expect(easy.reviewHistory?.at(-1)).toMatchObject({ rating: 'easy', reviewedAt: now.toISOString() });
    expect(legacyCard.reviewHistory).toBeUndefined();
  });

  it('keeps only the newest 100 review records', () => {
    const reviewHistory = Array.from({ length: 100 }, (_, index) => ({
      rating: 'good' as const,
      reviewedAt: new Date(2026, 0, index + 1).toISOString(),
      scheduledDays: 1,
      elapsedDays: 1,
    }));

    const result = scheduleReview({ ...legacyCard, reviewHistory }, 'hard', new Date('2026-07-12T09:00:00.000Z'));

    expect(result.reviewHistory).toHaveLength(100);
    expect(result.reviewHistory?.[0]).toEqual(reviewHistory[1]);
    expect(result.reviewHistory?.at(-1)?.rating).toBe('hard');
  });

  it('falls back safely when synced FSRS state is invalid', () => {
    const corruptCard = {
      ...legacyCard,
      fsrs: {
        due: 'not-a-date',
        stability: Number.NaN,
        difficulty: -10,
        elapsedDays: 0,
        scheduledDays: 0,
        learningSteps: 0,
        reps: 0,
        lapses: 0,
        state: 99,
      },
    };

    expect(() => scheduleReview(corruptCard, 'good', new Date('2026-07-12T09:00:00.000Z'))).not.toThrow();
  });

  it('preserves legacy review progress when creating the first FSRS state', () => {
    const now = new Date('2026-07-12T09:00:00.000Z');
    const progressedLegacyCard: CardData = {
      ...legacyCard,
      reviews: 12,
      interval: 14,
      easeFactor: 2.3,
      nextReviewDate: '2026-07-11T09:00:00.000Z',
      reviewHistory: [{
        rating: 'good',
        reviewedAt: '2026-06-27T09:00:00.000Z',
        scheduledDays: 14,
        elapsedDays: 14,
      }],
    };

    const result = scheduleReview(progressedLegacyCard, 'good', now);

    expect(result.reviews).toBe(13);
    expect(result.fsrs?.reps).toBe(13);
    expect(result.fsrs?.state).not.toBe(State.New);
    expect(result.interval).toBeGreaterThan(0);
  });
});
