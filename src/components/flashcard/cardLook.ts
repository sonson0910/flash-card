import { useTheme } from '../../features/theme/ThemeProvider';
import type { CardData } from '../../types/card';

/**
 * The three card treatments the canvas defines: Midnight Aurora (classic dark),
 * Ink & Paper (classic light) and Crystal Star (both modes share one layout).
 */
export type CardLook = 'aurora' | 'paper' | 'crystal';

export function useCardLook(): CardLook {
  const { family, mode } = useTheme();
  if (family === 'crystal') return 'crystal';
  return mode === 'light' ? 'paper' : 'aurora';
}

/** Learning stage the card's rim and glow show: an easy card is mastered, any reviewed card is learning. */
export type CardTier = 'new' | 'learning' | 'mastered';

export function cardTierOf(card: Pick<CardData, 'difficulty' | 'nextReviewDate' | 'reviews'>): CardTier {
  if (card.difficulty === 'easy') return 'mastered';
  return card.nextReviewDate || (card.reviews ?? 0) > 0 || (card.difficulty && card.difficulty !== 'unrated') ? 'learning' : 'new';
}
