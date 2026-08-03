import type { CardData } from '../../types/card';
import type { LexemeAggregateV3, TrackMembershipV3 } from './schemaV3';

export interface CompatibilityProjectionOptions {
  readonly trackId?: string;
  readonly requireLearningState?: boolean;
}

const compareMembershipIds = (left: TrackMembershipV3, right: TrackMembershipV3): number => (
  left.id < right.id ? -1 : left.id > right.id ? 1 : 0
);

const selectMembership = (
  aggregate: LexemeAggregateV3,
  trackId: string | undefined,
): TrackMembershipV3 => {
  if (trackId !== undefined) {
    const selected = aggregate.memberships.find(membership => membership.trackId === trackId);
    if (!selected) throw new RangeError(`No membership exists for track "${trackId}".`);
    return selected;
  }
  const selected = [...aggregate.memberships].sort(compareMembershipIds)[0];
  if (!selected) throw new RangeError('At least one track membership is required for projection.');
  return selected;
};

export function projectLexemeAggregateV3ToCardData(
  aggregate: LexemeAggregateV3,
  options: CompatibilityProjectionOptions = {},
): CardData {
  const { lexeme, learningState } = aggregate;
  const membership = selectMembership(aggregate, options.trackId);
  if (options.requireLearningState && !learningState) {
    throw new RangeError('A learning state is required for this compatibility projection.');
  }
  const content: CardData = {
    ...(learningState?.legacySchemaVersion === 2 ? { schemaVersion: 2 as const } : {}),
    id: learningState?.legacyCardId ?? lexeme.id,
    word: lexeme.lemma,
    normalizedWord: lexeme.normalizedLemma,
    translation: lexeme.compatibility.translation,
    explanation: lexeme.compatibility.explanation,
    explanationTranslation: lexeme.compatibility.explanationTranslation,
    phonetic: lexeme.phonetics[0] ?? '',
    emoji: lexeme.compatibility.emoji,
    category: membership.legacyCategory,
    audioUrl: lexeme.media.audioUrl,
    imageUrl: lexeme.media.imageUrl,
    imageSearchQuery: lexeme.media.imageSearchQuery ?? '',
    createdAt: learningState?.createdAt ?? lexeme.createdAt,
    partOfSpeech: lexeme.compatibility.legacyPartOfSpeech,
    ...(membership.cefrLevel !== null ? { cefrLevel: membership.cefrLevel } : {}),
    exampleSentence: lexeme.compatibility.exampleSentence,
    exampleTranslation: lexeme.compatibility.exampleTranslation,
    collocations: [...lexeme.collocations],
    synonyms: [...lexeme.compatibility.synonyms],
    antonyms: [...lexeme.compatibility.antonyms],
    register: lexeme.compatibility.register,
    commonMistake: lexeme.compatibility.commonMistake,
  };
  if (!learningState) return content;
  return {
    ...content,
    ...(learningState.revision !== undefined ? { revision: learningState.revision } : {}),
    ...(learningState.libraryEpoch !== undefined ? { libraryEpoch: learningState.libraryEpoch } : {}),
    ...(learningState.updatedAt !== undefined ? { updatedAt: learningState.updatedAt } : {}),
    ...(learningState.lastOpenedAt !== undefined ? { lastOpenedAt: learningState.lastOpenedAt } : {}),
    ...(learningState.sortTouchedAt !== undefined ? { sortTouchedAt: learningState.sortTouchedAt } : {}),
    bookmarked: learningState.bookmarked,
    difficulty: learningState.difficulty,
    customDeck: learningState.customCollections[0] ?? null,
    ...(learningState.nextReviewDate !== undefined ? { nextReviewDate: learningState.nextReviewDate } : {}),
    ...(learningState.reviews !== undefined ? { reviews: learningState.reviews } : {}),
    ...(learningState.interval !== undefined ? { interval: learningState.interval } : {}),
    ...(learningState.easeFactor !== undefined ? { easeFactor: learningState.easeFactor } : {}),
    ...(learningState.fsrs !== undefined ? { fsrs: { ...learningState.fsrs } } : {}),
    reviewHistory: learningState.reviewHistory.map(entry => ({ ...entry })),
    correctStreak: learningState.correctStreak,
  };
}
