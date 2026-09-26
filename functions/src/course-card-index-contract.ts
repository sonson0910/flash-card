export const COURSE_QUERY_INDEX_SCHEMA_VERSION = 1 as const;
export const COURSE_QUERY_INDEX_PROJECTION_VERSION = 1 as const;

export const SUPPORTED_TARGET_LANGUAGES = ['en', 'ko', 'ja', 'zh'] as const;
export type SupportedTargetLanguage = typeof SUPPORTED_TARGET_LANGUAGES[number];

export type CourseQueryIndexGenerationStatus = 'building' | 'ready' | 'failed' | 'retired';

export interface CourseQueryIndexPointer {
  schemaVersion: 1;
  projectionVersion: 1;
  libraryEpoch: number;
  activeGenerationId: string | null;
  buildingGenerationId: string | null;
}

export interface CourseQueryIndexGeneration {
  schemaVersion: 1;
  projectionVersion: 1;
  libraryEpoch: number;
  status: CourseQueryIndexGenerationStatus;
  lastCardId: string | null;
  scanned: number;
  leaseToken: string | null;
  leaseExpiresAt: number | null;
  startedAt: string;
  completedAt?: string;
}

export interface CourseQueryContext {
  courseId: string;
  targetLanguage: SupportedTargetLanguage;
  libraryEpoch: number;
  activeGenerationId: string;
}

export type CourseCardIndexDifficulty = 'easy' | 'good' | 'hard' | 'unrated';

export interface CourseCardIndexProjection {
  schemaVersion: 1;
  cardId: string;
  targetLanguage: SupportedTargetLanguage;
  sourceLibraryEpoch: number;
  sourceRevision: number | null;
  normalizedWord: string;
  category: string;
  partOfSpeech: string;
  customDeck: string | null;
  difficulty: CourseCardIndexDifficulty;
  bookmarked: boolean;
  createdAt: string;
  nextReviewDate?: string;
}

export type CourseCardIndexRow = CourseCardIndexProjection;

export type CourseCardIndexInput = Readonly<Record<string, unknown>>;

export class UnsupportedCourseCardLanguageError extends Error {
  readonly cardId: string;
  readonly language: unknown;

  constructor(cardId: string, language: unknown) {
    super(`Card "${cardId}" has an unsupported target language.`);
    this.name = 'UnsupportedCourseCardLanguageError';
    this.cardId = cardId;
    this.language = language;
  }
}

export function isSupportedTargetLanguage(value: unknown): value is SupportedTargetLanguage {
  return typeof value === 'string'
    && SUPPORTED_TARGET_LANGUAGES.some(language => language === value);
}

/** Missing language is the legacy English target; malformed explicit values stay invalid. */
export function effectiveCardTargetLanguage(value: unknown): SupportedTargetLanguage | null {
  if (value === undefined) return 'en';
  return isSupportedTargetLanguage(value) ? value : null;
}

const EPOCH_ISO = new Date(0).toISOString();
const VALID_DIFFICULTIES = new Set<CourseCardIndexDifficulty>(['easy', 'good', 'hard', 'unrated']);

const boundedText = (value: unknown, maximum: number, fallback = '') => (
  (typeof value === 'string' ? value : fallback).trim().slice(0, maximum)
);

const validIsoDate = (value: unknown): string | undefined => {
  if (
    value
    && typeof value === 'object'
    && 'toDate' in value
    && typeof (value as { toDate?: unknown }).toDate === 'function'
  ) {
    try {
      const converted = (value as { toDate: () => unknown }).toDate();
      return converted instanceof Date && !Number.isNaN(converted.getTime())
        ? converted.toISOString()
        : undefined;
    } catch {
      return undefined;
    }
  }
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
};

const validCounter = (value: unknown): number | undefined => (
  Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : undefined
);

const normalizeWord = (value: unknown): string => (
  typeof value === 'string'
    ? value.normalize('NFKC').trim().toLocaleLowerCase('en-US').replace(/\s+/g, ' ')
    : ''
);

const PART_OF_SPEECH_OPTIONS = [
  'noun', 'verb', 'adjective', 'adverb', 'pronoun', 'preposition', 'conjunction',
  'determiner', 'interjection', 'phrasal verb', 'auxiliary verb', 'modal verb',
  'article', 'numeral', 'idiom', 'phrase',
] as const;

const normalizePartOfSpeech = (value: unknown): string => {
  if (typeof value !== 'string') return '';
  const normalized = value.trim().toLocaleLowerCase('en-US')
    .replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').slice(0, 64);
  if (!normalized) return '';
  if (/\bphrasal\s+verb\b/.test(normalized)) return 'phrasal verb';
  if (/\bauxiliary\s+verb\b/.test(normalized)) return 'auxiliary verb';
  if (/\bmodal\s+verb\b/.test(normalized)) return 'modal verb';
  for (const option of PART_OF_SPEECH_OPTIONS) {
    if (new RegExp(`\\b${option.replace(' ', '\\s+')}\\b`).test(normalized)) return option;
  }
  return normalized;
};

export function projectCourseCardIndex(
  rawCard: CourseCardIndexInput,
  cardId: string,
): CourseCardIndexProjection {
  const targetLanguage = effectiveCardTargetLanguage(rawCard.language);
  if (!targetLanguage) throw new UnsupportedCourseCardLanguageError(cardId, rawCard.language);

  const word = boundedText(rawCard.word, 256);
  const nextReviewDate = validIsoDate(rawCard.nextReviewDate);
  const normalizedWord = boundedText(rawCard.normalizedWord, 256) || normalizeWord(word);

  return {
    schemaVersion: COURSE_QUERY_INDEX_SCHEMA_VERSION,
    cardId,
    targetLanguage,
    sourceLibraryEpoch: validCounter(rawCard.libraryEpoch) ?? 0,
    sourceRevision: validCounter(rawCard.revision) ?? null,
    normalizedWord,
    category: boundedText(rawCard.category, 128) || 'Other',
    partOfSpeech: normalizePartOfSpeech(rawCard.partOfSpeech),
    customDeck: typeof rawCard.customDeck === 'string'
      ? boundedText(rawCard.customDeck, 128) || null
      : null,
    difficulty: typeof rawCard.difficulty === 'string' && VALID_DIFFICULTIES.has(rawCard.difficulty as CourseCardIndexDifficulty)
      ? rawCard.difficulty as CourseCardIndexDifficulty
      : 'unrated',
    bookmarked: rawCard.bookmarked === true,
    createdAt: validIsoDate(rawCard.createdAt) ?? EPOCH_ISO,
    ...(nextReviewDate ? { nextReviewDate } : {}),
  };
}

export const buildCourseCardIndexProjection = projectCourseCardIndex;
