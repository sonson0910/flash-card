import type { CardData } from '../types/card';

export function isCardDue(card: CardData): boolean {
  if (!card.nextReviewDate) return true; // Never reviewed
  const nextReview = new Date(card.nextReviewDate);
  if (Number.isNaN(nextReview.getTime())) return true;
  return nextReview.getTime() <= Date.now();
}
