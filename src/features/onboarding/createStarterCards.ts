import type { Firestore } from 'firebase/firestore';
import { createStarterCardBatch } from '../../lib/cardRepository';
import { createTargetAwareCardId } from '../../lib/cardIdentity';
import type { CardData } from '../../types/card';
import type { CourseNativeLanguage, CourseTargetLanguage } from '../courses/courseModel';
import { starterCardsFor, type StarterCard } from './starterCardCatalog';

export interface StarterCardOutcome {
  readonly created: readonly CardData[];
  readonly skippedForQuota: number;
}

const toCardData = (
  starter: StarterCard,
  targetLanguage: CourseTargetLanguage,
  nativeLanguage: CourseNativeLanguage,
): CardData => ({
  id: createTargetAwareCardId(starter.word, targetLanguage),
  word: starter.word,
  translation: starter.translation,
  explanation: '',
  phonetic: starter.phonetic,
  emoji: '📝',
  category: starter.category,
  audioUrl: null,
  imageUrl: null,
  language: targetLanguage,
  translationLanguage: nativeLanguage,
  origin: 'manual',
  bookmarked: false,
  difficulty: 'unrated',
});

/**
 * Creates real starter cards through the server-authoritative
 * `createStarterCards` callable (`createStarterCardBatch`), which reserves
 * the whole batch against the owner's monthly AI-card quota and writes
 * every card atomically in one transaction — the same quota any other
 * AI-generated card spends (owner decision). The batch is all-or-nothing:
 * a caller too close to their monthly limit gets `skippedForQuota` equal to
 * the full catalog rather than a partial pack, and the operationId is
 * stable per target/native pair so retrying the same onboarding attempt
 * never charges quota twice. Never reports more successes than cards that
 * were actually written; when the batch is refused for quota it creates
 * nothing and says so, rather than pretending the "aha" moment happened.
 */
export async function createStarterCards(
  db: Firestore,
  ownerId: string,
  targetLanguage: CourseTargetLanguage,
  nativeLanguage: CourseNativeLanguage,
): Promise<StarterCardOutcome> {
  const catalog = starterCardsFor(targetLanguage, nativeLanguage);
  if (catalog.length === 0) return { created: [], skippedForQuota: 0 };
  const cards = catalog.map(starter => toCardData(starter, targetLanguage, nativeLanguage));
  const operationId = `starter-${targetLanguage}-${nativeLanguage}`;
  const result = await createStarterCardBatch(db, ownerId, operationId, cards);
  return {
    created: result.created,
    skippedForQuota: result.quotaExceeded ? catalog.length : 0,
  };
}
