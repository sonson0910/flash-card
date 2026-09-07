import { describe, expect, it } from 'vitest';
import type { CardData } from '../types/card';
import { hasReviewEvidence } from './cardLearningStatus';

const card = (overrides: Partial<CardData> = {}): CardData => ({
  id: 'card-1',
  word: 'word',
  translation: 'meaning',
  explanation: '',
  phonetic: '',
  emoji: '',
  category: 'General',
  audioUrl: null,
  imageUrl: null,
  difficulty: 'unrated',
  reviews: 0,
  ...overrides,
});

describe('hasReviewEvidence', () => {
  it('recognizes review evidence while leaving untouched cards unlearned', () => {
    expect(hasReviewEvidence(card())).toBe(false);
    expect(hasReviewEvidence(card({ reviews: 1 }))).toBe(true);
    expect(hasReviewEvidence(card({ reviewHistory: [{
      rating: 'good',
      reviewedAt: '2026-01-02T00:00:00.000Z',
      scheduledDays: 1,
      elapsedDays: 0,
    }] }))).toBe(true);
    expect(hasReviewEvidence(card({ fsrs: {
      due: '2026-01-03T00:00:00.000Z',
      stability: 1,
      difficulty: 5,
      elapsedDays: 0,
      scheduledDays: 1,
      learningSteps: 0,
      reps: 1,
      lapses: 0,
      state: 2,
    } }))).toBe(true);
    expect(hasReviewEvidence(card({
      reviews: undefined,
      difficulty: 'good',
      nextReviewDate: '2026-01-03T00:00:00.000Z',
    }))).toBe(true);
  });

  it('does not treat scheduling metadata alone as learning evidence for a fresh card', () => {
    expect(hasReviewEvidence(card({ nextReviewDate: '2026-01-03T00:00:00.000Z' }))).toBe(false);
  });
});
