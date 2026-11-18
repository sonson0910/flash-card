import type { JapanesePitchAccent } from '../features/languagePacks/japanesePitch';

export type LegacyDifficulty = 'easy' | 'good' | 'hard' | 'unrated';
export type ReviewRatingValue = 'again' | 'hard' | 'good' | 'easy';

/** BCP 47 language code retained as a string for forward-compatible packs. */
export type CardLanguageCode = string;

/**
 * Language metadata is additive and independent from canonical lexeme
 * identity. Missing fields are interpreted by the read helpers as the legacy
 * English-to-Vietnamese pair without being written back to the card.
 */
export interface CardLanguageFields {
  language?: CardLanguageCode;
  /** Wave-1 meaning languages are English or Vietnamese. */
  translationLanguage?: CardLanguageCode;
}

export interface CardLanguagePair {
  language: CardLanguageCode;
  translationLanguage: CardLanguageCode;
}

export const LEGACY_CARD_LANGUAGE = 'en' as const;
export const LEGACY_CARD_TRANSLATION_LANGUAGE = 'vi' as const;

/**
 * Bounded, server-validated metadata for a card captured from a web page via
 * the browser extension. Every field is optional and independent; a legacy
 * card, or one created any other way, simply omits `source` and never has one
 * guessed or backfilled. See `contract-card-source-metadata.md` in the
 * `claude-design-workflow-recovery` plan for bounds and write ownership.
 */
export interface CardSourceMetadata {
  /** Origin + pathname of the captured page. http/https only; credentials, query, and fragment are stripped before persistence. */
  url?: string;
  /** Page <title> at capture time. */
  title?: string;
  /** Sentence-level context around the captured selection. */
  context?: string;
  /** When the capture happened, as an ISO 8601 timestamp. */
  capturedAt?: string;
}

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
  /** Identifies generated content for learner disclosure; immutable after creation. */
  origin?: 'ai' | 'manual';
  /** Additive V3 identity. Omitted records retain legacy word identity. */
  lexemeId?: string;
  language?: CardLanguageCode;
  /** Language of stored meaning and translated examples; legacy cards use Vietnamese. */
  translationLanguage?: CardLanguageCode;
  senseKey?: string;
  word: string;
  normalizedWord?: string;
  normalizedLemma?: string;
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
  /** Server-managed bounded review idempotency receipt window. */
  appliedReviewOperationIds?: string[];
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
  /** Server-authoritative time when this card most recently crossed the mastery threshold. */
  masteredAt?: string;
  /** Verified UniDic pitch metadata for an exact Japanese word and kana reading. */
  japanesePitchAccent?: JapanesePitchAccent;
  /** Immutable after creation; set only by the browser-extension capture path via `createCard`. */
  source?: CardSourceMetadata;
}
