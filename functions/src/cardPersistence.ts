import { createHash } from 'node:crypto';
import type {
  DocumentData,
  DocumentSnapshot,
  Firestore,
  Transaction,
} from 'firebase-admin/firestore';
import {
  canonicalLexemeId,
  InputValidationError,
  parseCardLanguagePair,
  parseCardSourceMetadata,
} from './inputValidation.js';
import { assertOwnerLibraryWriteAllowed } from './legacyLibraryMigrationOwnerScope.js';
import {
  applyLibraryFacetMutationInTransaction,
  libraryFacetRestoreOperationId,
} from './libraryFacetPersistence.js';
import { AiQuotaError, asAiQuotaCount, resolvePlan, type AiOperationRecord } from './aiQuota.js';
import type { PilotConfig } from './pilotConfig.js';
import {
  commitVerifiedGamification,
  prepareVerifiedGamification,
  type VerifiedGamificationOutcome,
} from './verifiedGamification.js';

export const MAX_CARD_ALLOCATION = 5_000;
const MAX_PROTOCOL_COUNTER = Number.MAX_SAFE_INTEGER;
const RESOURCE_USAGE_SCHEMA_VERSION = 1 as const;

export class CardAllocationLimitError extends Error {
  constructor() {
    super('The card allocation limit has been reached.');
    this.name = 'CardAllocationLimitError';
  }
}

export type CardAllocationConflictReason =
  | 'stale-library-epoch'
  | 'future-library-epoch'
  | 'deleted'
  | 'identity-conflict';

export class CardAllocationConflictError extends Error {
  constructor(
    public readonly reason: CardAllocationConflictReason,
    message: string,
  ) {
    super(message);
    this.name = 'CardAllocationConflictError';
  }
}

export type CardRecord = Record<string, unknown>;

export type CardAllocationResult = {
  created: boolean;
  card: DocumentData;
  restored?: true;
};

export type CardAllocationRequest = {
  card: CardRecord;
  libraryEpoch?: number;
  baseRevision?: number;
  opId?: string;
  operationCreatedAt?: string;
  restore?: true;
};

export type CreateCardV2Request = CardAllocationRequest & {
  opId: string;
  timeZone: string;
};

type CardAllocationOptions = {
  maximumCards?: number;
  libraryEpoch?: number;
  baseRevision?: number;
  opId?: string;
  operationCreatedAt?: string;
  restore?: true;
  verifiedCreate?: {
    fingerprint: string;
    receivedAt: Date;
    timeZone: string;
  };
};

type CreateCardV2Options = CardAllocationOptions & {
  opId: string;
  timeZone: string;
  receivedAt?: Date;
};

export type CardAllocationV2Result = CardAllocationResult & {
  gamification: VerifiedGamificationOutcome | null;
};

const CARD_FIELDS = new Set([
  'id', 'origin', 'lexemeId', 'language', 'translationLanguage', 'senseKey', 'word', 'normalizedWord', 'normalizedLemma', 'translation', 'explanation', 'explanationTranslation',
  'phonetic', 'category', 'emoji', 'audioUrl', 'imageUrl', 'imageSearchQuery',
  'createdAt', 'updatedAt', 'lastOpenedAt', 'sortTouchedAt', 'schemaVersion', 'revision', 'libraryEpoch',
  'bookmarked', 'customDeck', 'difficulty', 'nextReviewDate', 'reviews', 'interval',
  'easeFactor', 'correctStreak', 'fsrs', 'reviewHistory', 'partOfSpeech', 'cefrLevel',
  'exampleSentence', 'exampleTranslation', 'collocations', 'synonyms', 'antonyms',
  'register', 'commonMistake', 'mnemonic', 'wordFamily', 'appliedReviewOperationIds', 'masteredAt', 'source',
]);

const CARD_DIFFICULTIES = new Set(['easy', 'good', 'hard', 'unrated']);
const REVIEW_RATINGS = new Set(['again', 'hard', 'good', 'easy']);
const AUDIO_HOSTS = new Set(['api.dictionaryapi.dev', 'ssl.gstatic.com']);
const IMAGE_HOSTS = new Set(['images.pexels.com', 'images.unsplash.com', 'upload.wikimedia.org']);
const REVIEW_OPERATION_ID = /^(?!__proto__$|constructor$|prototype$)[a-zA-Z0-9_-]+(?::(?!__proto__$|constructor$|prototype$)[a-zA-Z0-9_-]+)*$/;

const asRecord = (value: unknown, message: string): CardRecord => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new InputValidationError(message);
  }
  return value as CardRecord;
};

const boundedText = (value: unknown, field: string, maximum: number, fallback = ''): string => {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || value.length > maximum) {
    throw new InputValidationError(`Card field "${field}" is invalid.`);
  }
  return value.trim();
};

const requiredText = (value: unknown, field: string, maximum: number): string => {
  if (value === undefined) throw new InputValidationError(`Card field "${field}" is required.`);
  return boundedText(value, field, maximum);
};

const exceedsCanonicalLimit = (value: string, maximum: number): boolean =>
  value.length > maximum || new TextEncoder().encode(value).byteLength > maximum;

const optionalDate = (value: unknown, field: string): string | undefined => {
  if (value === undefined) return undefined;
  const text = boundedText(value, field, 128);
  if (!text || Number.isNaN(Date.parse(text))) {
    throw new InputValidationError(`Card field "${field}" is invalid.`);
  }
  return new Date(text).toISOString();
};

const trustedUrl = (
  value: unknown,
  field: string,
  hosts: ReadonlySet<string>,
): string | null => {
  if (value === undefined || value === null || value === '') return null;
  const text = boundedText(value, field, 2_048);
  try {
    const url = new URL(text);
    if (url.protocol !== 'https:' || !hosts.has(url.hostname)) throw new Error('untrusted');
    const serialized = url.toString();
    if (exceedsCanonicalLimit(serialized, 2_048)) throw new Error('oversized');
    return serialized;
  } catch {
    throw new InputValidationError(`Card field "${field}" is invalid.`);
  }
};

const boundedStringList = (value: unknown, field: string): string[] => {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 4) {
    throw new InputValidationError(`Card field "${field}" is invalid.`);
  }
  return value.map(item => requiredText(item, field, 100));
};

const boundedReviewOperationIds = (value: unknown): string[] => {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 100) {
    throw new InputValidationError('Card applied review operation IDs are invalid.');
  }
  return value.map(item => {
    if (typeof item !== 'string' || item.length < 1 || item.length > 128 || !REVIEW_OPERATION_ID.test(item)) {
      throw new InputValidationError('Card applied review operation IDs are invalid.');
    }
    return item;
  });
};

const nonNegativeNumber = (value: unknown, field: string, fallback: number): number => {
  if (value === undefined) return fallback;
  if (
    typeof value !== 'number'
    || !Number.isFinite(value)
    || value < 0
    || value > Number.MAX_SAFE_INTEGER
  ) {
    throw new InputValidationError(`Card field "${field}" is invalid.`);
  }
  return value;
};

const nonNegativeInteger = (value: unknown, field: string, fallback: number): number => {
  const number = nonNegativeNumber(value, field, fallback);
  if (!Number.isSafeInteger(number)) throw new InputValidationError(`Card field "${field}" is invalid.`);
  return number;
};

const nextProtocolCounter = (value: number, field: string): number => {
  if (!Number.isSafeInteger(value) || value < 0 || value >= MAX_PROTOCOL_COUNTER) {
    throw new CardAllocationConflictError(
      'identity-conflict',
      `The existing card ${field} cannot be advanced.`,
    );
  }
  return value + 1;
};

const parseWordFamily = (value: unknown): CardRecord | undefined => {
  if (value === undefined) return undefined;
  const family = asRecord(value, 'Card wordFamily must be an object.');
  const allowed = new Set(['noun', 'verb', 'adj', 'adv']);
  if (Object.keys(family).some(key => !allowed.has(key))) {
    throw new InputValidationError('Card wordFamily contains an unsupported field.');
  }
  return Object.fromEntries(Object.entries(family).map(([key, item]) => [
    key,
    requiredText(item, `wordFamily.${key}`, 100),
  ]));
};

const parseFsrs = (value: unknown): CardRecord | undefined => {
  if (value === undefined) return undefined;
  const fsrs = asRecord(value, 'Card fsrs must be an object.');
  const allowed = new Set([
    'due', 'stability', 'difficulty', 'elapsedDays', 'scheduledDays', 'learningSteps',
    'reps', 'lapses', 'state', 'lastReview',
  ]);
  if (Object.keys(fsrs).some(key => !allowed.has(key))) {
    throw new InputValidationError('Card fsrs contains an unsupported field.');
  }
  const requiredFsrsFields = [
    'due', 'stability', 'difficulty', 'elapsedDays', 'scheduledDays', 'learningSteps',
    'reps', 'lapses', 'state',
  ];
  if (requiredFsrsFields.some(key => fsrs[key] === undefined)) {
    throw new InputValidationError('Card fsrs is incomplete.');
  }
  const due = optionalDate(fsrs.due, 'fsrs.due');
  if (!due) throw new InputValidationError('Card fsrs.due is required.');
  const result: CardRecord = {
    due,
    stability: nonNegativeNumber(fsrs.stability, 'fsrs.stability', 0),
    difficulty: nonNegativeNumber(fsrs.difficulty, 'fsrs.difficulty', 0),
    elapsedDays: nonNegativeInteger(fsrs.elapsedDays, 'fsrs.elapsedDays', 0),
    scheduledDays: nonNegativeInteger(fsrs.scheduledDays, 'fsrs.scheduledDays', 0),
    learningSteps: nonNegativeInteger(fsrs.learningSteps, 'fsrs.learningSteps', 0),
    reps: nonNegativeInteger(fsrs.reps, 'fsrs.reps', 0),
    lapses: nonNegativeInteger(fsrs.lapses, 'fsrs.lapses', 0),
    state: nonNegativeInteger(fsrs.state, 'fsrs.state', 0),
  };
  if ((result.stability as number) <= 0 || (result.difficulty as number) < 1
    || (result.difficulty as number) > 10 || (result.state as number) > 3) {
    throw new InputValidationError('Card fsrs is invalid.');
  }
  const lastReview = optionalDate(fsrs.lastReview, 'fsrs.lastReview');
  if (lastReview) result.lastReview = lastReview;
  return result;
};

const parseReviewHistory = (value: unknown): Array<Record<string, unknown>> => {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 100) {
    throw new InputValidationError('Card reviewHistory is invalid.');
  }
  return value.map(entry => {
    const review = asRecord(entry, 'Card reviewHistory is invalid.');
    if (Object.keys(review).some(key => !new Set([
      'rating', 'reviewedAt', 'scheduledDays', 'elapsedDays',
    ]).has(key))) {
      throw new InputValidationError('Card reviewHistory contains an unsupported field.');
    }
    if (!REVIEW_RATINGS.has(review.rating as string)) {
      throw new InputValidationError('Card reviewHistory is invalid.');
    }
    const reviewedAt = optionalDate(review.reviewedAt, 'reviewHistory.reviewedAt');
    if (!reviewedAt) throw new InputValidationError('Card reviewHistory is invalid.');
    if (
      review.rating === undefined
      || review.scheduledDays === undefined
      || review.elapsedDays === undefined
    ) throw new InputValidationError('Card reviewHistory is incomplete.');
    return {
      rating: review.rating,
      reviewedAt,
      scheduledDays: nonNegativeNumber(review.scheduledDays, 'reviewHistory.scheduledDays', 0),
      elapsedDays: nonNegativeNumber(review.elapsedDays, 'reviewHistory.elapsedDays', 0),
    };
  });
};

const normalizedWord = (value: string): string => value
  .normalize('NFKC')
  .trim()
  .toLocaleLowerCase('en-US')
  .replace(/\s+/g, ' ');

const stableCardId = (word: string): string => {
  const normalized = normalizedWord(word);
  const legacySafeId = `word-${normalized}`;
  if (/^[a-zA-Z0-9_-]+$/.test(normalized) && legacySafeId.length <= 128) return legacySafeId;
  const slug = normalized
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 90);
  const hash = createHash('sha256').update(normalized).digest('hex').slice(0, 24);
  return `word-${slug ? `${slug}-` : ''}${hash}`;
};

const targetIdentityValue = (word: string, targetLanguage: string): string =>
  `${targetLanguage}\u0000${normalizedWord(word)}`;

const targetAwareCardId = (word: string, targetLanguage: string): string => {
  if (targetLanguage === 'en') return stableCardId(word);
  const normalized = normalizedWord(word);
  const slug = normalized
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  const hash = createHash('sha256').update(targetIdentityValue(normalized, targetLanguage)).digest('hex').slice(0, 24);
  return `word-${targetLanguage}-${slug ? `${slug}-` : ''}${hash}`;
};

const reservationId = (identity: string, targetLanguage?: string): string => createHash('sha256')
  .update(targetLanguage && targetLanguage !== 'en'
    ? `${targetLanguage}\u0000${identity}`
    : identity)
  .digest('hex');

export const canonicalCard = (value: unknown, { allowMasteredAt = false }: {
  allowMasteredAt?: boolean;
} = {}): CardRecord => {
  const source = asRecord(value, 'Card must be an object.');
  if (Object.keys(source).some(key => !CARD_FIELDS.has(key))) {
    throw new InputValidationError('Card contains an unsupported field.');
  }

  const word = boundedText(source.word, 'word', 256);
  const identity = normalizedWord(word);
  if (!identity) throw new InputValidationError('Card word is required.');
  if (exceedsCanonicalLimit(identity, 256)) {
    throw new InputValidationError('Card normalizedWord is invalid.');
  }
  const suppliedIdentity = source.normalizedWord === undefined
    ? identity
    : boundedText(source.normalizedWord, 'normalizedWord', 256);
  if (normalizedWord(suppliedIdentity) !== identity) {
    throw new InputValidationError('Card identity does not match its word.');
  }

  const suppliedId = source.id === undefined ? undefined : boundedText(source.id, 'id', 128);
  if (suppliedId !== undefined && suppliedId && !/^[a-zA-Z0-9_-]+$/.test(suppliedId)) {
    throw new InputValidationError('Card field "id" is invalid.');
  }
  if (source.schemaVersion !== undefined && source.schemaVersion !== 2) {
    throw new InputValidationError('Card schemaVersion is invalid.');
  }
  if (source.revision !== undefined) nonNegativeInteger(source.revision, 'revision', 0);
  if (source.libraryEpoch !== undefined) nonNegativeInteger(source.libraryEpoch, 'libraryEpoch', 0);
  const lexemeId = source.lexemeId === undefined ? undefined : boundedText(source.lexemeId, 'lexemeId', 128);
  const languageFields = parseCardLanguagePair({
    language: source.language,
    translationLanguage: source.translationLanguage,
  });
  const language = languageFields.language;
  const translationLanguage = languageFields.translationLanguage;
  const senseKey = source.senseKey === undefined ? undefined : boundedText(source.senseKey, 'senseKey', 128);
  const partOfSpeech = source.partOfSpeech === undefined ? undefined : boundedText(source.partOfSpeech, 'partOfSpeech', 64);
  const normalizedLemma = source.normalizedLemma === undefined ? undefined : boundedText(source.normalizedLemma, 'normalizedLemma', 256);
  const hasCanonicalIdentity = lexemeId !== undefined || senseKey !== undefined || normalizedLemma !== undefined;
  if (hasCanonicalIdentity) {
    const lemma = normalizedLemma || suppliedIdentity;
    if (!lexemeId || !language || !senseKey || !partOfSpeech || !lemma || lexemeId !== canonicalLexemeId(language, lemma, partOfSpeech, senseKey)) {
      throw new InputValidationError('Card lexeme identity does not match its tuple.');
    }
  }
  // Card creation always writes an explicit language (defaulting to the
  // legacy English target) so course-scoped queries never depend on a
  // missing field meaning "en". Canonical lexeme identity already requires
  // an explicit language above.
  const effectiveLanguage = hasCanonicalIdentity ? language : (language ?? 'en');

  const difficulty = source.difficulty === undefined ? 'unrated' : source.difficulty;
  if (typeof difficulty !== 'string' || !CARD_DIFFICULTIES.has(difficulty)) {
    throw new InputValidationError('Card difficulty is invalid.');
  }
  const customDeck = source.customDeck === undefined || source.customDeck === null
    ? null
    : boundedText(source.customDeck, 'customDeck', 128);
  if (source.origin !== undefined && source.origin !== 'ai' && source.origin !== 'manual') {
    throw new InputValidationError('Card origin is invalid.');
  }
  const now = new Date().toISOString();
  const createdAt = optionalDate(source.createdAt, 'createdAt') ?? now;
  const masteredAt = allowMasteredAt ? optionalDate(source.masteredAt, 'masteredAt') : undefined;
  const cardSource = parseCardSourceMetadata(source.source);
  const result: CardRecord = {
    id: hasCanonicalIdentity ? lexemeId as string : targetAwareCardId(identity, effectiveLanguage ?? 'en'),
    ...(source.origin === undefined ? {} : { origin: source.origin }),
    word,
    normalizedWord: identity,
    ...(effectiveLanguage === undefined ? {} : { language: effectiveLanguage }),
    ...(translationLanguage === undefined ? {} : { translationLanguage }),
    ...(hasCanonicalIdentity ? { lexemeId, senseKey, normalizedLemma: normalizedLemma || suppliedIdentity } : {}),
    translation: boundedText(source.translation, 'translation', 256),
    explanation: boundedText(source.explanation, 'explanation', 2_048),
    explanationTranslation: boundedText(source.explanationTranslation, 'explanationTranslation', 2_048),
    phonetic: boundedText(source.phonetic, 'phonetic', 256),
    category: boundedText(source.category, 'category', 128) || 'Other',
    emoji: boundedText(source.emoji, 'emoji', 64) || '📝',
    audioUrl: trustedUrl(source.audioUrl, 'audioUrl', AUDIO_HOSTS),
    imageUrl: trustedUrl(source.imageUrl, 'imageUrl', IMAGE_HOSTS),
    imageSearchQuery: boundedText(source.imageSearchQuery, 'imageSearchQuery', 120),
    createdAt,
    ...(masteredAt ? { masteredAt } : {}),
    bookmarked: source.bookmarked === undefined ? false : source.bookmarked,
    customDeck,
    difficulty,
    reviews: nonNegativeInteger(source.reviews, 'reviews', 0),
    interval: nonNegativeNumber(source.interval, 'interval', 0),
    easeFactor: nonNegativeNumber(source.easeFactor, 'easeFactor', 2.5),
    correctStreak: nonNegativeInteger(source.correctStreak, 'correctStreak', 0),
    partOfSpeech: boundedText(source.partOfSpeech, 'partOfSpeech', 64),
    cefrLevel: boundedText(source.cefrLevel, 'cefrLevel', 8),
    exampleSentence: boundedText(source.exampleSentence, 'exampleSentence', 2_048),
    exampleTranslation: boundedText(source.exampleTranslation, 'exampleTranslation', 2_048),
    collocations: boundedStringList(source.collocations, 'collocations'),
    synonyms: boundedStringList(source.synonyms, 'synonyms'),
    antonyms: boundedStringList(source.antonyms, 'antonyms'),
    register: boundedText(source.register, 'register', 64),
    commonMistake: boundedText(source.commonMistake, 'commonMistake', 2_048),
    reviewHistory: parseReviewHistory(source.reviewHistory),
    appliedReviewOperationIds: boundedReviewOperationIds(source.appliedReviewOperationIds),
    ...(cardSource ? { source: cardSource } : {}),
    schemaVersion: 2,
    revision: 1,
  };
  if ((result.easeFactor as number) > 5) {
    throw new InputValidationError('Card field "easeFactor" is invalid.');
  }

  if (typeof result.bookmarked !== 'boolean') {
    throw new InputValidationError('Card bookmarked must be a boolean.');
  }
  const optionalFields = [
    ['imageSearchQuery', result.imageSearchQuery],
    ['updatedAt', optionalDate(source.updatedAt, 'updatedAt')],
    ['lastOpenedAt', optionalDate(source.lastOpenedAt, 'lastOpenedAt')],
    ['sortTouchedAt', optionalDate(source.sortTouchedAt, 'sortTouchedAt')],
    ['nextReviewDate', optionalDate(source.nextReviewDate, 'nextReviewDate')],
    ['mnemonic', boundedText(source.mnemonic, 'mnemonic', 2_048)],
  ] as const;
  optionalFields.forEach(([field, item]) => {
    if (item) result[field] = item;
  });
  const wordFamily = parseWordFamily(source.wordFamily);
  if (wordFamily) result.wordFamily = wordFamily;
  const fsrs = parseFsrs(source.fsrs);
  if (fsrs) result.fsrs = fsrs;
  return result;
};

export const parseCreateCardRequest = (value: unknown): CardAllocationRequest => {
  const source = asRecord(value, 'Card allocation request must be an object.');
  if (Object.keys(source).some(key => !new Set([
    'card', 'libraryEpoch', 'baseRevision', 'opId', 'operationCreatedAt', 'restore',
  ]).has(key))) {
    throw new InputValidationError('Card allocation request contains an unsupported field.');
  }
  const libraryEpoch = source.libraryEpoch === undefined
    ? undefined
    : nonNegativeInteger(source.libraryEpoch, 'libraryEpoch', 0);
  const baseRevision = source.baseRevision === undefined
    ? undefined
    : nonNegativeInteger(source.baseRevision, 'baseRevision', 0);
  const opId = source.opId === undefined ? undefined : boundedText(source.opId, 'opId', 128);
  if (source.opId !== undefined && !opId) throw new InputValidationError('Card opId is invalid.');
  const operationCreatedAt = optionalDate(source.operationCreatedAt, 'operationCreatedAt');
  if (source.restore !== undefined && source.restore !== true) {
    throw new InputValidationError('Card restore intent is invalid.');
  }
  if (source.restore === true && (
    !opId
    || !/^[A-Za-z0-9_-]{1,128}$/.test(opId)
    || !operationCreatedAt
  )) throw new InputValidationError('Card restore operation metadata is required.');
  return {
    card: canonicalCard(source.card),
    ...(libraryEpoch === undefined ? {} : { libraryEpoch }),
    ...(baseRevision === undefined ? {} : { baseRevision }),
    ...(opId === undefined ? {} : { opId }),
    ...(operationCreatedAt === undefined ? {} : { operationCreatedAt }),
    ...(source.restore === true ? { restore: true } : {}),
  };
};

export const parseCreateCardV2Request = (value: unknown): CreateCardV2Request => {
  const source = asRecord(value, 'Card allocation request must be an object.');
  if (Object.keys(source).some(key => !new Set([
    'card', 'libraryEpoch', 'baseRevision', 'opId', 'operationCreatedAt', 'timeZone',
  ]).has(key))) {
    throw new InputValidationError('Card allocation request contains an unsupported field.');
  }
  const { timeZone: rawTimeZone, ...legacyRequest } = source;
  const request = parseCreateCardRequest(legacyRequest);
  if (!request.opId || !/^[A-Za-z0-9_-]{1,128}$/.test(request.opId)) {
    throw new InputValidationError('Card create operation metadata is required.');
  }
  const timeZone = boundedText(rawTimeZone, 'timeZone', 128);
  if (!timeZone) throw new InputValidationError('Reward time zone is invalid.');
  return { ...request, opId: request.opId, timeZone };
};

const stableJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
};

const createFingerprint = (value: unknown): string =>
  createHash('sha256').update(stableJson(value)).digest('hex');

export interface StarterCardsBatchRequest {
  operationId: string;
  cards: readonly unknown[];
}

export const parseCreateStarterCardsRequest = (value: unknown): StarterCardsBatchRequest => {
  const source = asRecord(value, 'Starter card request must be an object.');
  if (Object.keys(source).some(key => !new Set(['operationId', 'cards']).has(key))) {
    throw new InputValidationError('Starter card request contains an unsupported field.');
  }
  const operationId = boundedText(source.operationId, 'operationId', 128);
  if (!operationId || !/^[A-Za-z0-9_-]{1,128}$/.test(operationId)) {
    throw new InputValidationError('Starter card operationId is invalid.');
  }
  if (!Array.isArray(source.cards) || source.cards.length === 0) {
    throw new InputValidationError('Starter card batch must be a non-empty array.');
  }
  if (source.cards.length > MAX_STARTER_CARDS_PER_BATCH) {
    throw new InputValidationError('Starter card batch is too large.');
  }
  return { operationId, cards: source.cards };
};

const ownerDocument = (database: Firestore, ownerId: string) =>
  database.collection('users').doc(ownerId);

const safeStoredCounter = (snapshot: DocumentSnapshot, field: string): number => {
  if (!snapshot.exists) return 0;
  const value = snapshot.data()?.[field];
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new CardAllocationConflictError('identity-conflict', `The owner ${field} state is invalid.`);
  }
  return Number(value);
};

const safeStoredCardCount = (snapshot: DocumentSnapshot): number | null => {
  if (!snapshot.exists) return null;
  const data = snapshot.data();
  if (data?.schemaVersion !== RESOURCE_USAGE_SCHEMA_VERSION) {
    throw new CardAllocationConflictError('identity-conflict', 'The owner card usage state is invalid.');
  }
  return safeStoredCounter(snapshot, 'cardCount');
};

const readEpoch = (snapshot: DocumentSnapshot): number => safeStoredCounter(snapshot, 'libraryEpoch');

// A plain (non-lexeme) identity is scoped by its target language so that the
// same spelling in different target languages (e.g. English and Korean)
// never collides on the same reservation, card ID, or matching logic. The
// English/omitted target keeps the legacy word-only shape.
const isTargetScoped = (targetLanguage: string | undefined): targetLanguage is string =>
  Boolean(targetLanguage) && targetLanguage !== 'en';

const isMatchingIdentity = (value: CardRecord, identity: string, targetLanguage?: string): boolean =>
  typeof value.cardId === 'string'
  && value.cardId.length <= 128
  && /^[a-zA-Z0-9_-]+$/.test(value.cardId)
  && (identity.startsWith('lexeme:')
    ? value.lexemeId === identity.slice('lexeme:'.length) && value.schemaVersion === 2
    : value.normalizedWord === identity && value.schemaVersion === 1
      && (isTargetScoped(targetLanguage)
        ? value.targetLanguage === targetLanguage
        : !Object.prototype.hasOwnProperty.call(value, 'targetLanguage')));

const cardMatchesIdentity = (
  value: CardRecord,
  identity: string,
  id: string,
  targetLanguage?: string,
): boolean =>
  (value.id === undefined || value.id === id)
  && (identity.startsWith('lexeme:')
    ? value.lexemeId === identity.slice('lexeme:'.length)
    : normalizedWord(typeof value.word === 'string' ? value.word : '') === identity
      && (
    value.normalizedWord === undefined
    || normalizedWord(typeof value.normalizedWord === 'string' ? value.normalizedWord : '') === identity
      )
      && (isTargetScoped(targetLanguage)
        ? typeof value.language === 'string' && value.language.toLowerCase() === targetLanguage
        : value.language === undefined || value.language === 'en'));

const isStrictCurrentCard = (
  value: CardRecord,
  id: string,
  identity: string,
  libraryEpoch: number,
  targetLanguage?: string,
): boolean => value.id === id
  && cardMatchesIdentity(value, identity, id, targetLanguage)
  && value.schemaVersion === 2
  && Number.isSafeInteger(value.revision)
  && Number(value.revision) >= 1
  && value.libraryEpoch === libraryEpoch;

const createReservation = (identity: string, id: string, targetLanguage?: string): CardRecord => ({
  schemaVersion: identity.startsWith('lexeme:') ? 2 : 1,
  cardId: id,
  ...(identity.startsWith('lexeme:')
    ? { lexemeId: identity.slice('lexeme:'.length) }
    : {
        normalizedWord: identity,
        ...(isTargetScoped(targetLanguage) ? { targetLanguage } : {}),
      }),
});

const asIsoDate = (value: unknown): unknown => {
  if (!value || typeof value !== 'object' || !('toDate' in value)) return value;
  const toDate = (value as { toDate?: unknown }).toDate;
  if (typeof toDate !== 'function') return value;
  try {
    const converted = toDate.call(value);
    return converted instanceof Date && !Number.isNaN(converted.getTime())
      ? converted.toISOString()
      : value;
  } catch {
    return value;
  }
};

const serializeCardResponseValue = (value: unknown): unknown => {
  const converted = asIsoDate(value);
  if (converted !== value) return converted;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? value : value.toISOString();
  }
  if (Array.isArray(value)) return value.map(serializeCardResponseValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, serializeCardResponseValue(item)]),
    );
  }
  return value;
};

// Callable responses use the client CardData wire contract. Keep this
// serialization separate from mutation normalization so stored card data is
// never changed just to make the response transport-safe.
export const serializeCardResponse = (value: CardRecord): CardRecord =>
  serializeCardResponseValue(value) as CardRecord;

const canonicalExistingCard = (
  value: CardRecord,
  id: string,
  identity: string,
  libraryEpoch: number,
): CardRecord => {
  const source = Object.fromEntries(Object.entries(value).map(([key, item]) => [key, asIsoDate(item)]));
  const canonicalNormalizedWord = identity.startsWith('lexeme:')
    ? normalizedWord(typeof source.word === 'string' ? source.word : '')
    : identity;
  if (
    source.schemaVersion !== undefined
    && source.schemaVersion !== 1
    && source.schemaVersion !== 2
  ) throw new CardAllocationConflictError('identity-conflict', 'The existing card requires migration.');
  if (
    source.revision !== undefined
    && (!Number.isSafeInteger(source.revision) || Number(source.revision) < 0)
  ) throw new CardAllocationConflictError('identity-conflict', 'The existing card requires migration.');
  if (
    source.libraryEpoch !== undefined
    && (!Number.isSafeInteger(source.libraryEpoch) || Number(source.libraryEpoch) < 0)
  ) throw new CardAllocationConflictError('identity-conflict', 'The existing card requires migration.');
  try {
    // Validate the stored shape and trust its existing metadata. The upgrade
    // only adds protocol identity fields; it must not invent card content.
    canonicalCard({ ...source, id, normalizedWord: canonicalNormalizedWord }, { allowMasteredAt: true });
    const revision = Number.isSafeInteger(source.revision) && Number(source.revision) > 0
      ? nextProtocolCounter(Number(source.revision), 'revision')
      : 1;
    return { ...source, id, normalizedWord: canonicalNormalizedWord, schemaVersion: 2, revision, libraryEpoch };
  } catch {
    throw new CardAllocationConflictError('identity-conflict', 'The existing card requires migration.');
  }
};

const currentTombstoneRevision = (
  snapshot: DocumentSnapshot,
  libraryEpoch: number,
): number => {
  if (!snapshot.exists) return 0;
  const value = snapshot.data() as CardRecord;
  if (
    value.libraryEpoch !== undefined
    && (!Number.isSafeInteger(value.libraryEpoch) || Number(value.libraryEpoch) < 0)
  ) throw new CardAllocationConflictError('identity-conflict', 'The existing card tombstone requires migration.');
  const tombstoneEpoch = value.libraryEpoch === undefined ? 0 : value.libraryEpoch;
  if (tombstoneEpoch !== libraryEpoch) return 0;
  if (!Number.isSafeInteger(value.revision) || Number(value.revision) < 1) {
    throw new CardAllocationConflictError('identity-conflict', 'The existing card tombstone requires migration.');
  }
  return Number(value.revision);
};

export async function createCardForOwner(
  database: Firestore,
  ownerId: string,
  card: unknown,
  {
    maximumCards = MAX_CARD_ALLOCATION,
    libraryEpoch,
    baseRevision,
    operationCreatedAt,
    opId,
    restore,
    verifiedCreate,
  }: CardAllocationOptions = {},
): Promise<CardAllocationResult> {
  if (!ownerId || ownerId.includes('/')) throw new InputValidationError('Card owner is invalid.');
  if (!Number.isSafeInteger(maximumCards) || maximumCards <= 0) {
    throw new Error('Card allocation maximum is invalid.');
  }
  const cardSource = asRecord(card, 'Card must be an object.');
  const normalizedCard = canonicalCard(cardSource);
  const restoreCreatedAt = restore && operationCreatedAt
    ? optionalDate(operationCreatedAt, 'operationCreatedAt')
    : undefined;
  if (restore && (
    !opId
    || !/^[A-Za-z0-9_-]{1,128}$/.test(opId)
    || !restoreCreatedAt
  )) throw new InputValidationError('Card restore operation metadata is required.');
  const restoreOperation = restore && opId && restoreCreatedAt
    ? { opId, operationCreatedAt: restoreCreatedAt }
    : null;
  // Review receipts are server-owned. A forged create payload may carry the
  // field for shape compatibility, but it must never seed a duplicate receipt.
  delete normalizedCard.appliedReviewOperationIds;
  const identity = typeof normalizedCard.lexemeId === 'string'
    ? `lexeme:${normalizedCard.lexemeId}`
    : normalizedCard.normalizedWord as string;
  // Only a plain (non-lexeme) identity is target-scoped; canonical lexeme
  // identity already encodes its language inside the lexeme tuple.
  const plainTargetLanguage = identity.startsWith('lexeme:')
    ? undefined
    : (typeof normalizedCard.language === 'string' ? normalizedCard.language : undefined);
  const proposedId = normalizedCard.id as string;
  const owner = ownerDocument(database, ownerId);
  const libraryState = owner.collection('profile').doc('library_state');
  const resourceUsage = owner.collection('profile').doc('resource_usage');
  const verifiedReceipt = verifiedCreate && opId
    ? owner.collection('card_create_receipts').doc(opId)
    : undefined;
  const reservation = owner.collection('card_reservations')
    .doc(reservationId(identity, plainTargetLanguage));
  let existingCardCount: number;
  try {
    const countSnapshot = await owner.collection('cards').count().get();
    const count = countSnapshot.data().count;
    if (!Number.isSafeInteger(count) || Number(count) < 0) throw new Error('invalid count');
    existingCardCount = Number(count);
  } catch {
    throw new CardAllocationConflictError(
      'identity-conflict',
      'The owner card usage baseline is unavailable.',
    );
  }

  return database.runTransaction(async (transaction: Transaction) => {
    if (verifiedCreate && !verifiedReceipt) throw new InputValidationError('Card create operation metadata is required.');
    const receiptSnapshot = verifiedReceipt ? await transaction.get(verifiedReceipt) : undefined;
    if (receiptSnapshot?.exists) {
      const receipt = receiptSnapshot.data();
      if (!receipt || receipt.fingerprint !== verifiedCreate?.fingerprint) {
        throw new InputValidationError('Card create operation conflicts with its original request.');
      }
      const result = receipt.result;
      if (!result || typeof result !== 'object' || Array.isArray(result)
        || typeof result.created !== 'boolean' || !result.card || typeof result.card !== 'object') {
        throw new CardAllocationConflictError('identity-conflict', 'The card create receipt is invalid.');
      }
      return result as CardAllocationResult;
    }
    await assertOwnerLibraryWriteAllowed(transaction, database, ownerId);
    const stateSnapshot = await transaction.get(libraryState);
    const reservationSnapshot = await transaction.get(reservation);
    const existingReservation = reservationSnapshot.exists
      ? reservationSnapshot.data() as CardRecord
      : null;
    if (existingReservation && !isMatchingIdentity(existingReservation, identity, plainTargetLanguage)) {
      throw new CardAllocationConflictError('identity-conflict', 'The card identity reservation conflicts with the request.');
    }
    const id = existingReservation?.cardId as string | undefined ?? proposedId;
    const canonical = owner.collection('cards').doc(id);
    const tombstone = owner.collection('card_tombstones').doc(id);
    const cardSnapshot = await transaction.get(canonical);
    const tombstoneSnapshot = await transaction.get(tombstone);
    const usageSnapshot = await transaction.get(resourceUsage);
    const currentEpoch = readEpoch(stateSnapshot);
    const requestedEpoch = libraryEpoch ?? currentEpoch;
    if (!Number.isSafeInteger(requestedEpoch) || requestedEpoch < 0) {
      throw new InputValidationError('Card libraryEpoch is invalid.');
    }
    if (requestedEpoch !== currentEpoch) {
      throw new CardAllocationConflictError(
        requestedEpoch < currentEpoch ? 'stale-library-epoch' : 'future-library-epoch',
        requestedEpoch < currentEpoch
          ? 'The card library generation is stale.'
          : 'The card library generation is from the future.',
      );
    }

    const expectedReservation = createReservation(identity, id, plainTargetLanguage);
    const existingCard = cardSnapshot.exists ? cardSnapshot.data() as CardRecord : null;
    if (existingCard && !cardMatchesIdentity(existingCard, identity, id, plainTargetLanguage)) {
      throw new CardAllocationConflictError('identity-conflict', 'The canonical card identity conflicts with the request.');
    }

    const existingEpoch = existingCard?.libraryEpoch;
    if (
      existingCard
      && existingEpoch !== undefined
      && (!Number.isSafeInteger(existingEpoch) || Number(existingEpoch) < 0)
    ) throw new CardAllocationConflictError('identity-conflict', 'The existing card requires migration.');
    const isOldGeneration = Boolean(
      existingCard
      && ((existingEpoch === undefined && currentEpoch > 0)
        || (existingEpoch !== undefined && Number(existingEpoch) < currentEpoch)),
    );
    const hadIdentity = Boolean(existingReservation || existingCard);
    const complete = async (result: CardAllocationResult): Promise<CardAllocationResult> => {
      const gamification = verifiedCreate && result.created && !result.restored
        ? await prepareVerifiedGamification(database, transaction, ownerId, {
          kind: 'create', receivedAt: verifiedCreate.receivedAt, timeZone: verifiedCreate.timeZone,
        })
        : undefined;
      const completed = verifiedCreate ? { ...result, gamification: gamification?.outcome ?? null } : result;
      if (verifiedReceipt && verifiedCreate) {
        transaction.create(verifiedReceipt, { fingerprint: verifiedCreate.fingerprint, result: completed });
      }
      if (gamification) commitVerifiedGamification(transaction, gamification);
      return completed;
    };
    if (existingCard && !isOldGeneration) {
      const isStrictCurrent = isStrictCurrentCard(existingCard, id, identity, currentEpoch, plainTargetLanguage);
      const normalizedExisting = isStrictCurrent
        ? existingCard
        : canonicalExistingCard(existingCard, id, identity, currentEpoch);
      const result = await complete({ created: false, card: serializeCardResponse(normalizedExisting) });
      if (!isStrictCurrent) {
        transaction.set(canonical, normalizedExisting, { merge: false });
      }
      if (!existingReservation) transaction.create(reservation, expectedReservation);
      return result;
    }

    const tombstoneRevision = currentTombstoneRevision(tombstoneSnapshot, currentEpoch);
    const requestedBaseRevision = baseRevision === undefined
      ? 0
      : nonNegativeInteger(baseRevision, 'baseRevision', 0);
    // A generated canonical timestamp is not proof of a deliberate replay. Only
    // an explicit protocol timestamp or caller-supplied creation time may pass
    // the deletion barrier, matching the prior offline mutation semantics.
    const operationTime = Date.parse(operationCreatedAt ?? String(cardSource.createdAt ?? ''));
    const deletionTime = tombstoneSnapshot.exists
      ? Date.parse(String((tombstoneSnapshot.data() as CardRecord).deletedAt ?? ''))
      : Number.NaN;
    const explicitlyRecreatesAfterDeletion = tombstoneRevision > 0
      && Number.isFinite(operationTime)
      && Number.isFinite(deletionTime)
      && operationTime > deletionTime;
    // Restoring retains the original creation time; a fresh capture starts a
    // new card lifetime even when its word has a prior deletion tombstone.
    const originalCreationTime = Date.parse(String(cardSource.createdAt ?? ''));
    const restoresPriorCard = explicitlyRecreatesAfterDeletion
      && Number.isFinite(originalCreationTime)
      && originalCreationTime <= deletionTime;
    if (tombstoneRevision > requestedBaseRevision && !explicitlyRecreatesAfterDeletion) {
      throw new CardAllocationConflictError('deleted', 'The card was deleted by a newer operation.');
    }

    const createdCard = {
      ...normalizedCard,
      id,
      schemaVersion: 2,
      revision: tombstoneRevision > 0 ? nextProtocolCounter(tombstoneRevision, 'revision') : 1,
      libraryEpoch: currentEpoch,
    };
    const applyRestoreFacetDelta = async () => {
      if (!restoreOperation) return;
      await applyLibraryFacetMutationInTransaction(database, transaction, ownerId, {
        op: 'delta',
        ownerId,
        opId: libraryFacetRestoreOperationId(restoreOperation.opId, restoreOperation.operationCreatedAt),
        operationCreatedAt: restoreOperation.operationCreatedAt,
        delta: { [String(normalizedCard.category || 'Other')]: 1 },
      });
    };
    if (!hadIdentity) {
      const currentCount = safeStoredCardCount(usageSnapshot) ?? existingCardCount;
      if (currentCount >= maximumCards) throw new CardAllocationLimitError();
      const result = await complete({
        created: true,
        card: serializeCardResponse(createdCard),
        ...(restore || restoresPriorCard ? { restored: true as const } : {}),
      });
      await applyRestoreFacetDelta();
      transaction.create(reservation, expectedReservation);
      if (cardSnapshot.exists || existingReservation) transaction.set(canonical, createdCard, { merge: false });
      else transaction.create(canonical, createdCard);
      transaction.set(resourceUsage, {
        schemaVersion: RESOURCE_USAGE_SCHEMA_VERSION,
        cardCount: currentCount + 1,
      }, { merge: true });
      return result;
    }

    const result = await complete({
      created: true,
      card: serializeCardResponse(createdCard),
      ...(restore || restoresPriorCard ? { restored: true as const } : {}),
    });
    await applyRestoreFacetDelta();
    if (existingCard && !existingReservation) transaction.create(reservation, expectedReservation);
    if (cardSnapshot.exists || existingReservation) transaction.set(canonical, createdCard, { merge: false });
    else transaction.create(canonical, createdCard);
    return result;
  });
}

export async function createCardV2ForOwner(
  database: Firestore,
  ownerId: string,
  card: unknown,
  options: CreateCardV2Options,
): Promise<CardAllocationV2Result> {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(options.opId) || options.restore) {
    throw new InputValidationError('Card create operation metadata is required.');
  }
  const source = asRecord(card, 'Card must be an object.');
  const normalized = canonicalCard(source);
  if (source.createdAt === undefined) delete normalized.createdAt;
  const fingerprint = createFingerprint({
    card: normalized,
    libraryEpoch: options.libraryEpoch,
    baseRevision: options.baseRevision,
    operationCreatedAt: options.operationCreatedAt,
    timeZone: options.timeZone,
  });
  return createCardForOwner(database, ownerId, card, {
    ...options,
    verifiedCreate: {
      fingerprint,
      receivedAt: options.receivedAt ?? new Date(),
      timeZone: options.timeZone,
    },
  }) as Promise<CardAllocationV2Result>;
}

export const MAX_STARTER_CARDS_PER_BATCH = 20;

export type StarterCardBatchResult =
  | { kind: 'completed'; cardIds: readonly string[] }
  | { kind: 'created'; cardIds: readonly string[] };

/**
 * Reserves N units of the same monthly AI-card quota `reserveWordOperation`
 * spends and creates every starter card in one Firestore transaction —
 * unlike a real AI generation, a starter card's content is fully known
 * upfront from the static catalog, so there is no external call to bridge
 * between reserving and writing, and the two collapse into a single atomic
 * step. Either the whole batch (quota debit + every card) commits, or none
 * of it does: a client retry with the same `operationId` after a timeout or
 * crash either replays the already-completed result or safely redoes the
 * whole batch, and never spends quota twice for it. Pro users resolve
 * through the same `resolvePlan` pro-period logic as any other AI spend.
 */
export async function createStarterCardsForOwner(
  database: Firestore,
  ownerId: string,
  operationId: string,
  cards: readonly unknown[],
  now: Date,
  config: PilotConfig,
): Promise<StarterCardBatchResult> {
  if (!ownerId || ownerId.includes('/')) throw new InputValidationError('Card owner is invalid.');
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(operationId)) {
    throw new InputValidationError('Starter card operationId is invalid.');
  }
  if (cards.length === 0) throw new InputValidationError('Starter card batch must not be empty.');
  if (cards.length > MAX_STARTER_CARDS_PER_BATCH) {
    throw new InputValidationError('Starter card batch is too large.');
  }

  const normalizedCards = cards.map(card => canonicalCard(card));
  for (const card of normalizedCards) {
    // The catalog only ever produces plain word identity; a lexeme-identified
    // card would mean this path is being reused for something it was not
    // built for, so it is rejected rather than silently accepted.
    if (card.lexemeId !== undefined) {
      throw new InputValidationError('Starter cards must use plain word identity, not a lexeme.');
    }
  }

  const owner = ownerDocument(database, ownerId);
  const operationRef = owner.collection('ai_operations').doc(operationId);
  const planRef = owner.collection('profile').doc('plan');
  const libraryState = owner.collection('profile').doc('library_state');
  const resourceUsage = owner.collection('profile').doc('resource_usage');
  const requestHash = createHash('sha256')
    .update(JSON.stringify(normalizedCards.map(card => card.id)))
    .digest('hex');

  // Mirrors createCardForOwner's own baseline read: only used as a fallback
  // when resource_usage has never been initialized for this owner yet.
  let existingCardCount: number;
  try {
    const countSnapshot = await owner.collection('cards').count().get();
    const value = countSnapshot.data().count;
    if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error('invalid count');
    existingCardCount = Number(value);
  } catch {
    throw new CardAllocationConflictError('identity-conflict', 'The owner card usage baseline is unavailable.');
  }

  return database.runTransaction(async (transaction: Transaction) => {
    await assertOwnerLibraryWriteAllowed(transaction, database, ownerId);
    const [operationSnapshot, planSnapshot, stateSnapshot, usageSnapshot] = await Promise.all([
      transaction.get(operationRef),
      transaction.get(planRef),
      transaction.get(libraryState),
      transaction.get(resourceUsage),
    ]);
    const operation = operationSnapshot.data() as AiOperationRecord | undefined;
    // Only a live (completed) operation owns its request shape; this path
    // never leaves an operation in a 'reserved' state (see class comment),
    // so any existing doc for this id is necessarily already completed.
    if (operation?.requestHash && operation.requestHash !== requestHash && operation.status === 'completed') {
      throw new AiQuotaError('operation-request-mismatch', { reason: 'operation-request-mismatch' });
    }
    if (operation?.status === 'completed') {
      const cardIds = Array.isArray(operation.result)
        ? operation.result.filter((id): id is string => typeof id === 'string')
        : [];
      return { kind: 'completed' as const, cardIds };
    }

    const plan = resolvePlan(planSnapshot.data(), now, config);
    const periodKey = plan.periodKey;
    const usageRef = owner.collection('ai_usage').doc(periodKey);
    const quotaUsageSnapshot = await transaction.get(usageRef);
    const used = asAiQuotaCount(quotaUsageSnapshot.data()?.used);
    const requestedUnits = normalizedCards.length;
    if (config.quotaEnforced && used + requestedUnits > plan.limit) {
      throw new AiQuotaError('ai-card-quota', {
        reason: 'ai-card-quota', used, limit: plan.limit, requested: requestedUnits,
        periodEndsAt: plan.endsAt.toISOString(), tier: plan.tier,
      });
    }

    const currentEpoch = readEpoch(stateSnapshot);
    const currentCount = safeStoredCardCount(usageSnapshot) ?? existingCardCount;
    if (currentCount + requestedUnits > MAX_CARD_ALLOCATION) {
      throw new CardAllocationLimitError();
    }

    const cardIds: string[] = [];
    for (const card of normalizedCards) {
      const identity = card.normalizedWord as string;
      const plainTargetLanguage = typeof card.language === 'string' ? card.language : undefined;
      const id = card.id as string;
      const reservationRef = owner.collection('card_reservations').doc(reservationId(identity, plainTargetLanguage));
      const canonicalRef = owner.collection('cards').doc(id);
      // .create() (not .set()) so a genuine identity collision — e.g. this
      // exact batch already exists under a different operationId — aborts
      // the whole transaction instead of silently overwriting a card.
      transaction.create(reservationRef, createReservation(identity, id, plainTargetLanguage));
      transaction.create(canonicalRef, { ...card, id, schemaVersion: 2, revision: 1, libraryEpoch: currentEpoch });
      cardIds.push(id);
    }
    transaction.set(usageRef, {
      periodKey, tier: plan.tier, used: used + requestedUnits, limit: plan.limit,
      periodStartsAt: plan.startsAt, periodEndsAt: plan.endsAt, updatedAt: now,
    }, { merge: true });
    transaction.set(resourceUsage, {
      schemaVersion: RESOURCE_USAGE_SCHEMA_VERSION,
      cardCount: currentCount + requestedUnits,
    }, { merge: true });
    transaction.set(operationRef, {
      status: 'completed', requestHash, periodKey, reservedAt: now, completedAt: now, result: cardIds,
    }, { merge: true });
    return { kind: 'created' as const, cardIds };
  });
}

export type RenameCardHeadwordRequest = {
  cardId: string;
  word: string;
  baseRevision: number;
  libraryEpoch: number;
};

export const parseRenameCardHeadwordRequest = (value: unknown): RenameCardHeadwordRequest => {
  const source = asRecord(value, 'Card headword rename request must be an object.');
  if (Object.keys(source).some(key => !new Set(['cardId', 'word', 'baseRevision', 'libraryEpoch']).has(key))) {
    throw new InputValidationError('Card headword rename request contains an unsupported field.');
  }
  const cardId = requiredText(source.cardId, 'cardId', 128);
  if (!/^[a-zA-Z0-9_-]+$/.test(cardId)) {
    throw new InputValidationError('Card headword rename cardId is invalid.');
  }
  return {
    cardId,
    word: requiredText(source.word, 'word', 256),
    baseRevision: nonNegativeInteger(source.baseRevision, 'baseRevision', 0),
    libraryEpoch: nonNegativeInteger(source.libraryEpoch, 'libraryEpoch', 0),
  };
};

export type CardHeadwordRenameConflictReason =
  | 'missing'
  | 'stale-library-epoch'
  | 'future-library-epoch'
  | 'revision-conflict'
  | 'requires-migration'
  | 'duplicate-word';

export class CardHeadwordRenameConflictError extends Error {
  constructor(
    public readonly reason: CardHeadwordRenameConflictReason,
    message: string,
  ) {
    super(message);
    this.name = 'CardHeadwordRenameConflictError';
  }
}

export type RenameCardHeadwordResult = {
  card: DocumentData;
};

/**
 * Corrects a card's headword while keeping lexeme identity. The Rules
 * client-update path locks `word`/`normalizedWord` on every card that already
 * has an identity (`hasValidCardIdentityUpdate`), so a plain client `update`
 * can never reach this field — only this trusted callable, via the Admin SDK,
 * can change it.
 *
 * A legacy (non-lexeme) card's identity reservation is keyed on its
 * normalizedWord, so renaming it swaps that reservation inside the same
 * transaction as the card write (release the old one, claim the new one,
 * reject if the new word is already claimed by a different card). A
 * canonical (lexemeId) card's reservation is keyed on its lexemeId, which
 * this callable never touches — its `word`/`normalizedWord` are display-only
 * relative to its lexeme tuple (`normalizedLemma`, `partOfSpeech`,
 * `senseKey`, `language`), so no reservation change is needed and the tuple
 * that names its lexeme stays byte-identical, which is what "keep lexeme
 * identity" means operationally.
 */
export async function renameCardHeadwordForOwner(
  database: Firestore,
  ownerId: string,
  request: RenameCardHeadwordRequest,
): Promise<RenameCardHeadwordResult> {
  if (!ownerId || ownerId.includes('/')) throw new InputValidationError('Card owner is invalid.');
  const newWord = boundedText(request.word, 'word', 256);
  const newIdentity = normalizedWord(newWord);
  if (!newIdentity) throw new InputValidationError('Card word is required.');
  if (exceedsCanonicalLimit(newIdentity, 256)) {
    throw new InputValidationError('Card normalizedWord is invalid.');
  }

  const owner = ownerDocument(database, ownerId);
  const libraryState = owner.collection('profile').doc('library_state');
  const canonical = owner.collection('cards').doc(request.cardId);

  return database.runTransaction(async (transaction: Transaction) => {
    await assertOwnerLibraryWriteAllowed(transaction, database, ownerId);
    const [stateSnapshot, cardSnapshot] = await Promise.all([
      transaction.get(libraryState),
      transaction.get(canonical),
    ]);
    const currentEpoch = readEpoch(stateSnapshot);
    if (request.libraryEpoch !== currentEpoch) {
      throw new CardHeadwordRenameConflictError(
        request.libraryEpoch < currentEpoch ? 'stale-library-epoch' : 'future-library-epoch',
        request.libraryEpoch < currentEpoch
          ? 'The card library generation is stale.'
          : 'The card library generation is from the future.',
      );
    }
    if (!cardSnapshot.exists) {
      throw new CardHeadwordRenameConflictError('missing', 'The card could not be found.');
    }
    const card = cardSnapshot.data() as CardRecord;
    if (
      card.schemaVersion !== 2
      || !Number.isSafeInteger(card.revision)
      || Number(card.revision) < 1
      || card.id !== request.cardId
    ) {
      throw new CardHeadwordRenameConflictError(
        'requires-migration',
        'The card requires migration before its headword can be corrected.',
      );
    }
    if (Number(card.revision) !== request.baseRevision) {
      throw new CardHeadwordRenameConflictError(
        'revision-conflict',
        'The card changed elsewhere. Reload and try again.',
      );
    }

    const oldWord = typeof card.word === 'string' ? card.word : '';
    const oldIdentity = typeof card.normalizedWord === 'string' && card.normalizedWord
      ? card.normalizedWord
      : normalizedWord(oldWord);
    const isCanonical = typeof card.lexemeId === 'string' && card.lexemeId.length > 0;

    if (!isCanonical && oldIdentity !== newIdentity) {
      const language = typeof card.language === 'string' ? card.language : undefined;
      const plainTargetLanguage = isTargetScoped(language) ? language : undefined;
      const oldReservation = owner.collection('card_reservations')
        .doc(reservationId(oldIdentity, plainTargetLanguage));
      const newReservation = owner.collection('card_reservations')
        .doc(reservationId(newIdentity, plainTargetLanguage));
      const [oldReservationSnapshot, newReservationSnapshot] = await Promise.all([
        transaction.get(oldReservation),
        transaction.get(newReservation),
      ]);
      if (newReservationSnapshot.exists) {
        const existing = newReservationSnapshot.data() as CardRecord;
        if (existing.cardId !== request.cardId) {
          throw new CardHeadwordRenameConflictError('duplicate-word', 'Another card already uses this word.');
        }
      } else {
        transaction.create(newReservation, createReservation(newIdentity, request.cardId, plainTargetLanguage));
      }
      if (oldReservationSnapshot.exists && (oldReservationSnapshot.data() as CardRecord).cardId === request.cardId) {
        transaction.delete(oldReservation);
      }
    }

    const updated = {
      ...card,
      word: newWord,
      normalizedWord: newIdentity,
      revision: nextProtocolCounter(Number(card.revision), 'revision'),
    };
    transaction.set(canonical, updated, { merge: false });
    return { card: serializeCardResponse(updated) };
  });
}
