import type { CardData } from '../types/card';
import { withTimeout } from './async';
import {
  cardWordKey,
  normalizeCardWord,
  preferCardWithLearningProgress,
} from './cardIdentity';

export class CardUniquenessCheckError extends Error {
  constructor(cause?: unknown) {
    super('The complete library could not be checked for an existing card.');
    this.name = 'CardUniquenessCheckError';
    this.cause = cause;
  }
}

export function findExistingCard(cards: readonly CardData[], word: string): CardData | null {
  const normalizedWord = normalizeCardWord(word);
  if (!normalizedWord) return null;
  return cards
    .filter(card => cardWordKey(card) === normalizedWord)
    .reduce<CardData | null>(
      (selected, card) => selected ? preferCardWithLearningProgress(selected, card) : card,
      null,
    );
}

interface ResolveExistingCardOptions {
  word: string;
  visibleCards: readonly CardData[];
  cachedCards?: readonly CardData[];
  requireRemoteVerification: boolean;
  verifyRemote?: () => Promise<CardData | null>;
  remoteTimeoutMs?: number;
}

export async function resolveExistingCard({
  word,
  visibleCards,
  cachedCards = [],
  requireRemoteVerification,
  verifyRemote,
  remoteTimeoutMs = 5_000,
}: ResolveExistingCardOptions): Promise<CardData | null> {
  const localMatch = findExistingCard([...visibleCards, ...cachedCards], word);
  if (localMatch) return localMatch;
  if (!requireRemoteVerification) return null;
  if (!verifyRemote) throw new CardUniquenessCheckError();
  try {
    return await withTimeout(
      verifyRemote(),
      remoteTimeoutMs,
      'Checking the complete library took too long.',
    );
  } catch (error) {
    throw new CardUniquenessCheckError(error);
  }
}
