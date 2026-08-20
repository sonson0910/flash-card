export type LegacyDifficulty = 'easy' | 'good' | 'hard' | 'unrated';
export type ReviewRatingValue = 'again' | 'hard' | 'good' | 'easy';

export interface CardData {
  /**
   * Optional during the v1/v2 compatibility window. New cards are written as
   * schema v2 while legacy documents continue to deserialize safely.
   */
  schemaVersion?: 2;
  /** Monotonic server-side version used as the base for conflict checks. */
  revision?: number;
  /** Library generation that prevents stale offline devices reviving old data. */
  libraryEpoch?: number;
  /** Server-assigned mutation time. `createdAt` remains immutable. */
  updatedAt?: string;
  id: string;
  word: string;
  normalizedWord?: string;
  translation: string;
  /** Renderers and recall prompts rely on these fields always being strings. */
  explanation: string;
  explanationTranslation?: string;
  phonetic: string;
  emoji: string;
  category: string;
  audioUrl: string | null;
  imageUrl: string | null;
  imageSearchQuery?: string;
  createdAt?: string;
  /** Last explicit reveal of an existing card; never substitutes for its creation time. */
  lastOpenedAt?: string;
  /** Client presentation ordering timestamp for recent library activity. */
  sortTouchedAt?: string;
  bookmarked?: boolean;
  difficulty?: LegacyDifficulty;
  customDeck?: string | null;
  nextReviewDate?: string;
  reviews?: number;
  interval?: number;
  easeFactor?: number;
  fsrs?: {
    due: string;
    stability: number;
    difficulty: number;
    elapsedDays: number;
    scheduledDays: number;
    learningSteps: number;
    reps: number;
    lapses: number;
    state: number;
    lastReview?: string;
  };
  reviewHistory?: Array<{
    rating: ReviewRatingValue;
    reviewedAt: string;
    scheduledDays: number;
    elapsedDays: number;
  }>;
  partOfSpeech?: string;
  cefrLevel?: string;
  exampleSentence?: string;
  exampleTranslation?: string;
  collocations?: string[];
  synonyms?: string[];
  antonyms?: string[];
  mnemonic?: string;
  wordFamily?: {
    noun?: string;
    verb?: string;
    adj?: string;
    adv?: string;
  };
  register?: string;
  commonMistake?: string;
  correctStreak?: number;
}
