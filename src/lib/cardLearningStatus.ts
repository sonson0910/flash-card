import type { CardData } from '../types/card';

const reviewCount = (card: CardData): number => Math.max(
  Number.isFinite(card.reviews) ? Math.max(0, card.reviews ?? 0) : 0,
  Number.isFinite(card.fsrs?.reps) ? Math.max(0, card.fsrs?.reps ?? 0) : 0,
  card.reviewHistory?.length ?? 0,
);

export const hasReviewEvidence = (card: CardData): boolean => (
  !(card.reviews === 0
    && (card.reviewHistory?.length ?? 0) === 0
    && (card.fsrs?.reps ?? 0) === 0
    && (!card.difficulty || card.difficulty === 'unrated'))
  && (reviewCount(card) > 0
    || card.difficulty === 'easy'
    || card.difficulty === 'good'
    || card.difficulty === 'hard'
    || Boolean(card.nextReviewDate || card.fsrs))
);
