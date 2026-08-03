import type { LegacyDifficulty, ReviewRatingValue } from '../../types/card';

export const SCHEMA_V3_LIMITS = Object.freeze({
  id: 128,
  languageCode: 35,
  displayName: 80,
  speechLocale: 35,
  normalizationVersion: 32,
  lemma: 256,
  partOfSpeech: 64,
  senseKey: 128,
  shortText: 256,
  longText: 2_048,
  definitions: 16,
  phonetics: 8,
  examples: 16,
  translationsPerExample: 8,
  collocations: 32,
  wordFamily: 32,
  skills: 8,
  memberships: 32,
  customCollections: 1,
  reviewHistory: 100,
} as const);

export type SchemaVersionV3 = 3;
export type TextDirectionV3 = 'ltr' | 'rtl';
export type EditorialStatusV3 = 'draft' | 'reviewed' | 'published' | 'archived';
export type LearningTrackIdV3 = 'ielts' | 'toeic' | 'general' | (string & {});
export type LearningSkillV3 = 'reading' | 'writing' | 'listening' | 'speaking' | (string & {});

export interface LanguageDescriptorV3 {
  readonly code: string;
  readonly displayName: string;
}

export interface LanguageProfileV3 {
  readonly schemaVersion: SchemaVersionV3;
  readonly id: string;
  readonly contentLanguage: LanguageDescriptorV3;
  readonly supportLanguages: readonly LanguageDescriptorV3[];
  readonly speechLocale: string;
  readonly direction: TextDirectionV3;
  readonly normalizationVersion: string;
}

export interface LocalizedTextV3 {
  readonly language: string;
  readonly text: string;
}

export interface LexemeExampleV3 {
  readonly text: string;
  readonly translations: readonly LocalizedTextV3[];
}

export interface LexemeMediaV3 {
  readonly audioUrl: string | null;
  readonly imageUrl: string | null;
  readonly imageSearchQuery?: string;
}

export interface LexemeProvenanceV3 {
  readonly source: string;
  readonly license: string;
  readonly reviewer: string;
  readonly editorialStatus: EditorialStatusV3;
}

/** Lossless fields needed by the v2 compatibility view during migration. */
export interface LexemeCompatibilityV2 {
  readonly translation: string;
  readonly explanation: string;
  readonly explanationTranslation: string;
  readonly emoji: string;
  readonly exampleSentence: string;
  readonly exampleTranslation: string;
  readonly synonyms: readonly string[];
  readonly antonyms: readonly string[];
  readonly register: string;
  readonly commonMistake: string;
}

export interface LexemeV3 {
  readonly schemaVersion: SchemaVersionV3;
  readonly id: string;
  readonly language: string;
  readonly lemma: string;
  readonly normalizedLemma: string;
  readonly partOfSpeech: string;
  readonly senseKey: string;
  readonly definitions: readonly LocalizedTextV3[];
  readonly phonetics: readonly string[];
  readonly examples: readonly LexemeExampleV3[];
  readonly collocations: readonly string[];
  readonly wordFamily: readonly string[];
  readonly media: LexemeMediaV3;
  readonly compatibility: LexemeCompatibilityV2;
  readonly provenance: LexemeProvenanceV3;
  readonly contentVersion: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface TrackMembershipV3 {
  readonly schemaVersion: SchemaVersionV3;
  readonly id: string;
  readonly lexemeId: string;
  readonly trackId: LearningTrackIdV3;
  readonly tier: string;
  readonly cefrLevel: string | null;
  readonly topic: string;
  readonly legacyCategory: string;
  readonly skills: readonly LearningSkillV3[];
  readonly rank: number;
  readonly lessonGroup: string;
  readonly contentVersion: number;
}

export interface FsrsStateV3 {
  readonly due: string;
  readonly stability: number;
  readonly difficulty: number;
  readonly elapsedDays: number;
  readonly scheduledDays: number;
  readonly learningSteps: number;
  readonly reps: number;
  readonly lapses: number;
  readonly state: number;
  readonly lastReview?: string;
}

export interface ReviewHistoryEntryV3 {
  readonly rating: ReviewRatingValue;
  readonly reviewedAt: string;
  readonly scheduledDays: number;
  readonly elapsedDays: number;
}

export interface LearningStateV3 {
  readonly schemaVersion: SchemaVersionV3;
  readonly ownerId: string;
  readonly lexemeId: string;
  readonly legacyCardId: string;
  readonly fsrs?: FsrsStateV3;
  readonly reviewHistory: readonly ReviewHistoryEntryV3[];
  readonly bookmarked: boolean;
  readonly difficulty: LegacyDifficulty;
  readonly mastery?: number;
  readonly correctStreak: number;
  readonly lastActivityAt?: string;
  readonly customCollections: readonly string[];
  readonly nextReviewDate?: string;
  readonly reviews?: number;
  readonly interval?: number;
  readonly easeFactor?: number;
  readonly revision?: number;
  readonly libraryEpoch?: number;
  readonly createdAt: string;
  readonly lastOpenedAt?: string;
  readonly sortTouchedAt?: string;
  readonly updatedAt?: string;
}

export interface LexemeAggregateV3 {
  readonly schemaVersion: SchemaVersionV3;
  readonly lexeme: LexemeV3;
  readonly memberships: readonly TrackMembershipV3[];
  readonly learningState: LearningStateV3 | null;
}
