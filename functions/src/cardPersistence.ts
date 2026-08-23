import { createHash } from 'node:crypto';
import type {
  DocumentData,
  DocumentSnapshot,
  Firestore,
  Transaction,
} from 'firebase-admin/firestore';
import { InputValidationError } from './inputValidation.js';

export const MAX_CARD_ALLOCATION = 5_000;

export class CardAllocationLimitError extends Error {
  constructor() {
    super('The card allocation limit has been reached.');
    this.name = 'CardAllocationLimitError';
  }
}

export class CardAllocationConflictError extends Error {
  constructor(message: string) {
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
    return url.toString();
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
  if (Object.keys(source).some(key => !new Set(['card', 'libraryEpoch']).has(key))) {
    throw new InputValidationError('Card allocation request contains an unsupported field.');
  }
  const libraryEpoch = source.libraryEpoch === undefined
    ? undefined
    : nonNegativeInteger(source.libraryEpoch, 'libraryEpoch', 0);
  return { card: canonicalCard(source.card), ...(libraryEpoch === undefined ? {} : { libraryEpoch }) };
};

const ownerDocument = (database: Firestore, ownerId: string) =>
  database.collection('users').doc(ownerId);

const safeStoredCounter = (snapshot: DocumentSnapshot, field: string): number => {
  if (!snapshot.exists) return 0;
  const value = snapshot.data()?.[field];
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new CardAllocationConflictError(`The owner ${field} state is invalid.`);
  }
  return Number(value);
};

const readEpoch = (snapshot: DocumentSnapshot): number => safeStoredCounter(snapshot, 'libraryEpoch');

const isMatchingIdentity = (value: CardRecord, identity: string, id: string): boolean =>
  value.cardId === id
  && value.normalizedWord === identity
  && value.schemaVersion === 1;

const cardMatchesIdentity = (value: CardRecord, identity: string, id: string): boolean =>
  value.id === id
  && normalizedWord(typeof value.word === 'string' ? value.word : '') === identity
  && (value.normalizedWord === undefined || value.normalizedWord === identity);

const createReservation = (identity: string, id: string): CardRecord => ({
  schemaVersion: 1,
  cardId: id,
  normalizedWord: identity,
});

export async function createCardForOwner(
  database: Firestore,
  ownerId: string,
  card: unknown,
  {
    maximumCards = MAX_CARD_ALLOCATION,
    libraryEpoch,
  }: { maximumCards?: number; libraryEpoch?: number } = {},
): Promise<CardAllocationResult> {
  if (!ownerId || ownerId.includes('/')) throw new InputValidationError('Card owner is invalid.');
  if (!Number.isSafeInteger(maximumCards) || maximumCards <= 0) {
    throw new Error('Card allocation maximum is invalid.');
  }
  const normalizedCard = canonicalCard(card);
  const identity = normalizedCard.normalizedWord as string;
  const id = normalizedCard.id as string;
  const owner = ownerDocument(database, ownerId);
  const libraryState = owner.collection('profile').doc('library_state');
  const resourceUsage = owner.collection('profile').doc('resource_usage');
  const reservation = owner.collection('card_reservations').doc(reservationId(identity));
  const canonical = owner.collection('cards').doc(id);

  return database.runTransaction(async (transaction: Transaction) => {
    const stateSnapshot = await transaction.get(libraryState);
    const cardSnapshot = await transaction.get(canonical);
    const reservationSnapshot = await transaction.get(reservation);
    const usageSnapshot = await transaction.get(resourceUsage);
    const currentEpoch = readEpoch(stateSnapshot);
    const requestedEpoch = libraryEpoch ?? currentEpoch;
    if (!Number.isSafeInteger(requestedEpoch) || requestedEpoch < 0) {
      throw new InputValidationError('Card libraryEpoch is invalid.');
    }
    if (requestedEpoch !== currentEpoch) {
      throw new CardAllocationConflictError('The card library generation is stale.');
    }

    const expectedReservation = createReservation(identity, id);
    const existingReservation = reservationSnapshot.exists
      ? reservationSnapshot.data() as CardRecord
      : null;
    if (existingReservation && !isMatchingIdentity(existingReservation, identity, id)) {
      throw new CardAllocationConflictError('The card identity reservation conflicts with the request.');
    }
    const existingCard = cardSnapshot.exists ? cardSnapshot.data() as CardRecord : null;
    if (existingCard && !cardMatchesIdentity(existingCard, identity, id)) {
      throw new CardAllocationConflictError('The canonical card identity conflicts with the request.');
    }

    const hadIdentity = Boolean(existingReservation || existingCard);
    if (existingCard) {
      if (!existingReservation) transaction.create(reservation, expectedReservation);
      return { created: false, card: { ...existingCard, id, normalizedWord: identity } };
    }

    if (!hadIdentity) {
      const currentCount = safeStoredCounter(usageSnapshot, 'cardCount');
      if (currentCount >= maximumCards) throw new CardAllocationLimitError();
      transaction.create(reservation, expectedReservation);
      transaction.create(canonical, {
        ...normalizedCard,
        schemaVersion: 2,
        revision: 1,
        libraryEpoch: currentEpoch,
      });
      transaction.set(resourceUsage, { cardCount: currentCount + 1 }, { merge: true });
      return {
        created: true,
        card: { ...normalizedCard, libraryEpoch: currentEpoch },
      };
    }

    transaction.create(canonical, {
      ...normalizedCard,
      schemaVersion: 2,
      revision: 1,
      libraryEpoch: currentEpoch,
    });
    return {
      created: true,
      card: { ...normalizedCard, libraryEpoch: currentEpoch },
    };
  });
}
