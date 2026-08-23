import { createHash } from 'node:crypto';
import type {
  DocumentData,
  DocumentSnapshot,
  Firestore,
  Transaction,
} from 'firebase-admin/firestore';
import { InputValidationError } from './inputValidation.js';

export const MAX_CARD_ALLOCATION = 5_000;
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

type CardRecord = Record<string, unknown>;

export type CardAllocationResult = {
  created: boolean;
  card: DocumentData;
};

export type CardAllocationRequest = {
  card: CardRecord;
  libraryEpoch?: number;
  baseRevision?: number;
  opId?: string;
  operationCreatedAt?: string;
};

type CardAllocationOptions = {
  maximumCards?: number;
  libraryEpoch?: number;
  baseRevision?: number;
  opId?: string;
  operationCreatedAt?: string;
};

const CARD_FIELDS = new Set([
  'id', 'word', 'normalizedWord', 'translation', 'explanation', 'explanationTranslation',
  'phonetic', 'category', 'emoji', 'audioUrl', 'imageUrl', 'imageSearchQuery',
  'createdAt', 'updatedAt', 'lastOpenedAt', 'sortTouchedAt', 'schemaVersion', 'revision', 'libraryEpoch',
  'bookmarked', 'customDeck', 'difficulty', 'nextReviewDate', 'reviews', 'interval',
  'easeFactor', 'correctStreak', 'fsrs', 'reviewHistory', 'partOfSpeech', 'cefrLevel',
  'exampleSentence', 'exampleTranslation', 'collocations', 'synonyms', 'antonyms',
  'register', 'commonMistake', 'mnemonic', 'wordFamily',
]);

const CARD_DIFFICULTIES = new Set(['easy', 'good', 'hard', 'unrated']);
const REVIEW_RATINGS = new Set(['again', 'hard', 'good', 'easy']);
const AUDIO_HOSTS = new Set(['api.dictionaryapi.dev', 'ssl.gstatic.com']);
const IMAGE_HOSTS = new Set(['images.pexels.com', 'images.unsplash.com', 'upload.wikimedia.org']);

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

const nonNegativeNumber = (value: unknown, field: string, fallback: number): number => {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new InputValidationError(`Card field "${field}" is invalid.`);
  }
  return value;
};

const nonNegativeInteger = (value: unknown, field: string, fallback: number): number => {
  const number = nonNegativeNumber(value, field, fallback);
  if (!Number.isSafeInteger(number)) throw new InputValidationError(`Card field "${field}" is invalid.`);
  return number;
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
    elapsedDays: nonNegativeNumber(fsrs.elapsedDays, 'fsrs.elapsedDays', 0),
    scheduledDays: nonNegativeNumber(fsrs.scheduledDays, 'fsrs.scheduledDays', 0),
    learningSteps: nonNegativeNumber(fsrs.learningSteps, 'fsrs.learningSteps', 0),
    reps: nonNegativeInteger(fsrs.reps, 'fsrs.reps', 0),
    lapses: nonNegativeInteger(fsrs.lapses, 'fsrs.lapses', 0),
    state: nonNegativeInteger(fsrs.state, 'fsrs.state', 0),
  };
  if ((result.difficulty as number) > 10 || (result.state as number) > 3) {
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

const reservationId = (word: string): string => createHash('sha256')
  .update(normalizedWord(word))
  .digest('hex');

const canonicalCard = (value: unknown): CardRecord => {
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

  const difficulty = source.difficulty === undefined ? 'unrated' : source.difficulty;
  if (typeof difficulty !== 'string' || !CARD_DIFFICULTIES.has(difficulty)) {
    throw new InputValidationError('Card difficulty is invalid.');
  }
  const customDeck = source.customDeck === undefined || source.customDeck === null
    ? null
    : boundedText(source.customDeck, 'customDeck', 128);
  const now = new Date().toISOString();
  const createdAt = optionalDate(source.createdAt, 'createdAt') ?? now;
  const result: CardRecord = {
    id: stableCardId(identity),
    word,
    normalizedWord: identity,
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
    'card', 'libraryEpoch', 'baseRevision', 'opId', 'operationCreatedAt',
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
  return {
    card: canonicalCard(source.card),
    ...(libraryEpoch === undefined ? {} : { libraryEpoch }),
    ...(baseRevision === undefined ? {} : { baseRevision }),
    ...(opId === undefined ? {} : { opId }),
    ...(operationCreatedAt === undefined ? {} : { operationCreatedAt }),
  };
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

const isMatchingIdentity = (value: CardRecord, identity: string): boolean =>
  typeof value.cardId === 'string'
  && value.cardId.length <= 128
  && /^[a-zA-Z0-9_-]+$/.test(value.cardId)
  && value.normalizedWord === identity
  && value.schemaVersion === 1;

const cardMatchesIdentity = (value: CardRecord, identity: string, id: string): boolean =>
  (value.id === undefined || value.id === id)
  && normalizedWord(typeof value.word === 'string' ? value.word : '') === identity
  && (
    value.normalizedWord === undefined
    || normalizedWord(typeof value.normalizedWord === 'string' ? value.normalizedWord : '') === identity
  );

const isStrictCurrentCard = (
  value: CardRecord,
  id: string,
  identity: string,
  libraryEpoch: number,
): boolean => value.id === id
  && value.normalizedWord === identity
  && value.schemaVersion === 2
  && Number.isSafeInteger(value.revision)
  && Number(value.revision) >= 1
  && value.libraryEpoch === libraryEpoch;

const createReservation = (identity: string, id: string): CardRecord => ({
  schemaVersion: 1,
  cardId: id,
  normalizedWord: identity,
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

const canonicalExistingCard = (
  value: CardRecord,
  id: string,
  identity: string,
  libraryEpoch: number,
): CardRecord => {
  const source = Object.fromEntries(Object.entries(value).map(([key, item]) => [key, asIsoDate(item)]));
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
    canonicalCard({ ...source, id, normalizedWord: identity });
    const revision = Number.isSafeInteger(source.revision) && Number(source.revision) > 0
      ? Number(source.revision) + 1
      : 1;
    if (!Number.isSafeInteger(revision)) throw new Error('The existing card revision cannot be advanced.');
    return { ...source, id, normalizedWord: identity, schemaVersion: 2, revision, libraryEpoch };
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
  }: CardAllocationOptions = {},
): Promise<CardAllocationResult> {
  if (!ownerId || ownerId.includes('/')) throw new InputValidationError('Card owner is invalid.');
  if (!Number.isSafeInteger(maximumCards) || maximumCards <= 0) {
    throw new Error('Card allocation maximum is invalid.');
  }
  const cardSource = asRecord(card, 'Card must be an object.');
  const normalizedCard = canonicalCard(cardSource);
  const identity = normalizedCard.normalizedWord as string;
  const proposedId = normalizedCard.id as string;
  const owner = ownerDocument(database, ownerId);
  const libraryState = owner.collection('profile').doc('library_state');
  const resourceUsage = owner.collection('profile').doc('resource_usage');
  const reservation = owner.collection('card_reservations').doc(reservationId(identity));
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
    const stateSnapshot = await transaction.get(libraryState);
    const reservationSnapshot = await transaction.get(reservation);
    const existingReservation = reservationSnapshot.exists
      ? reservationSnapshot.data() as CardRecord
      : null;
    if (existingReservation && !isMatchingIdentity(existingReservation, identity)) {
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

    const expectedReservation = createReservation(identity, id);
    const existingCard = cardSnapshot.exists ? cardSnapshot.data() as CardRecord : null;
    if (existingCard && !cardMatchesIdentity(existingCard, identity, id)) {
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
    if (existingCard && !isOldGeneration) {
      const isStrictCurrent = isStrictCurrentCard(existingCard, id, identity, currentEpoch);
      const normalizedExisting = isStrictCurrent
        ? existingCard
        : canonicalExistingCard(existingCard, id, identity, currentEpoch);
      if (!isStrictCurrent) {
        transaction.set(canonical, normalizedExisting, { merge: false });
      }
      if (!existingReservation) transaction.create(reservation, expectedReservation);
      return { created: false, card: normalizedExisting };
    }

    const tombstoneRevision = currentTombstoneRevision(tombstoneSnapshot, currentEpoch);
    const requestedBaseRevision = Number.isSafeInteger(baseRevision) && Number(baseRevision) >= 0
      ? Number(baseRevision)
      : 0;
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
    if (tombstoneRevision > requestedBaseRevision && !explicitlyRecreatesAfterDeletion) {
      throw new CardAllocationConflictError('deleted', 'The card was deleted by a newer operation.');
    }

    const createdCard = {
      ...normalizedCard,
      id,
      schemaVersion: 2,
      revision: tombstoneRevision > 0 ? tombstoneRevision + 1 : 1,
      libraryEpoch: currentEpoch,
    };
    if (!hadIdentity) {
      const currentCount = safeStoredCardCount(usageSnapshot) ?? existingCardCount;
      if (currentCount >= maximumCards) throw new CardAllocationLimitError();
      transaction.create(reservation, expectedReservation);
      if (cardSnapshot.exists || existingReservation) transaction.set(canonical, createdCard, { merge: false });
      else transaction.create(canonical, createdCard);
      transaction.set(resourceUsage, {
        schemaVersion: RESOURCE_USAGE_SCHEMA_VERSION,
        cardCount: currentCount + 1,
      }, { merge: true });
      return {
        created: true,
        card: createdCard,
      };
    }

    if (existingCard && !existingReservation) transaction.create(reservation, expectedReservation);
    if (cardSnapshot.exists || existingReservation) transaction.set(canonical, createdCard, { merge: false });
    else transaction.create(canonical, createdCard);
    return {
      created: true,
      card: createdCard,
    };
  });
}
