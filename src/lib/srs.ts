import type { CardData } from '../types/card';

export function isCardDue(card: CardData): boolean {
  if (!card.nextReviewDate) return false;
  const nextReview = new Date(card.nextReviewDate);
  if (Number.isNaN(nextReview.getTime())) return false;
  return nextReview.getTime() <= Date.now();
}

export function isCardReadyForPractice(card: CardData): boolean {
  if (!card.nextReviewDate) return true;
  if (Number.isNaN(new Date(card.nextReviewDate).getTime())) return true;
  return isCardDue(card);
}
