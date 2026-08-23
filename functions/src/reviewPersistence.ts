import type { DocumentData, Firestore, Transaction } from 'firebase-admin/firestore';
import { FieldValue } from 'firebase-admin/firestore';
import { InputValidationError } from './inputValidation.js';
import { canonicalCard, serializeCardResponse, type CardRecord } from './cardPersistence.js';

export const MAX_REVIEW_HISTORY = 100;
export const MAX_REVIEW_OPERATION_IDS = 100;
export const MAX_PROTOCOL_COUNTER = Number.MAX_SAFE_INTEGER;

const REVIEW_RATINGS = new Set(['again', 'hard', 'good', 'easy']);
const REVIEW_FIELDS = [
  'difficulty', 'nextReviewDate', 'reviews', 'interval', 'easeFactor',
  'fsrs', 'reviewHistory', 'correctStreak',
] as const;
const REVIEW_FIELD_SET = new Set<string>(REVIEW_FIELDS);
const OPERATION_ID_PATTERN = /^(?!__proto__$|constructor$|prototype$)[a-zA-Z0-9_-]+(?::(?!__proto__$|constructor$|prototype$)[a-zA-Z0-9_-]+)*$/;

type ReviewField = typeof REVIEW_FIELDS[number];

export type ReviewRequest = {
  opId: string;
  cardId: string;
  baseRevision: number;
  libraryEpoch: number;
  rating: 'again' | 'hard' | 'good' | 'easy';
  reviewedAt: string;
  fields: Record<ReviewField, unknown>;
  fieldMask: ReviewField[];
};

export type ReviewPersistenceResult = {
  applied: true;
  duplicate: boolean;
  card: CardRecord;
};

export type ReviewConflictReason =
  | 'stale-library-epoch'
  | 'future-library-epoch'
  | 'revision-conflict'
  | 'missing'
  | 'identity-conflict';

export class ReviewPersistenceConflictError extends Error {
  constructor(
    public readonly reason: ReviewConflictReason,
    public readonly currentRevision?: number,
    public readonly card?: CardRecord,
  ) {
    super(`Review mutation rejected: ${reason}.`);
    this.name = 'ReviewPersistenceConflictError';
  }
}

const asRecord = (value: unknown, message: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new InputValidationError(message);
  return value as Record<string, unknown>;
};

const safeCounter = (value: unknown, _field: string): number => {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new ReviewPersistenceConflictError('identity-conflict');
  }
  return Number(value);
};

const parseOperationId = (value: unknown): string => {
  if (typeof value !== 'string' || value.length < 1 || value.length > 128 || !OPERATION_ID_PATTERN.test(value)) {
    throw new InputValidationError('Review operation ID is invalid.');
  }
  return value;
};

const parseDate = (value: unknown, field: string): string => {
  if (typeof value !== 'string' || value.length < 1 || value.length > 128) {
    throw new InputValidationError(`Review ${field} is invalid.`);
  }
  const time = Date.parse(value);
  if (!Number.isFinite(time)) throw new InputValidationError(`Review ${field} is invalid.`);
  return new Date(time).toISOString();
};

export const parseReviewRequest = (value: unknown): ReviewRequest => {
  const source = asRecord(value, 'Review request must be an object.');
  const allowed = new Set(['opId', 'cardId', 'baseRevision', 'libraryEpoch', 'rating', 'reviewedAt', 'fields', 'fieldMask']);
  if (Object.keys(source).some(key => !allowed.has(key))) throw new InputValidationError('Review request contains an unsupported field.');
  const cardId = source.cardId;
  if (typeof cardId !== 'string' || cardId.length < 1 || cardId.length > 128 || !/^[a-zA-Z0-9_-]+$/.test(cardId)) {
    throw new InputValidationError('Review card ID is invalid.');
  }
  const baseRevision = safeCounter(source.baseRevision, 'baseRevision');
  const libraryEpoch = safeCounter(source.libraryEpoch, 'libraryEpoch');
  const rating = source.rating;
  if (typeof rating !== 'string' || !REVIEW_RATINGS.has(rating)) throw new InputValidationError('Review rating is invalid.');
  const reviewedAt = parseDate(source.reviewedAt, 'reviewedAt');
  const fields = asRecord(source.fields, 'Review fields must be an object.');
  const fieldMask = source.fieldMask;
  if (!Array.isArray(fieldMask) || fieldMask.length !== REVIEW_FIELDS.length) {
    throw new InputValidationError('Review field mask is invalid.');
  }
  const parsedMask = fieldMask.map(field => {
    if (typeof field !== 'string' || !REVIEW_FIELD_SET.has(field)) throw new InputValidationError('Review field mask is invalid.');
    return field as ReviewField;
  });
  if (new Set(parsedMask).size !== REVIEW_FIELDS.length || !REVIEW_FIELDS.every(field => parsedMask.includes(field))) {
    throw new InputValidationError('Review field mask is incomplete.');
  }
  if (Object.keys(fields).length !== REVIEW_FIELDS.length || Object.keys(fields).some(field => !REVIEW_FIELD_SET.has(field))) {
    throw new InputValidationError('Review fields are incomplete.');
  }
  return {
    opId: parseOperationId(source.opId),
    cardId,
    baseRevision,
    libraryEpoch,
    rating: rating as ReviewRequest['rating'],
    reviewedAt,
    fields: fields as ReviewRequest['fields'],
    fieldMask: parsedMask,
  };
};

const toIsoValue = (value: unknown): unknown => {
  if (value && typeof value === 'object' && 'toDate' in value && typeof (value as { toDate?: unknown }).toDate === 'function') {
    const date = (value as { toDate: () => unknown }).toDate();
    return date instanceof Date && !Number.isNaN(date.getTime()) ? date.toISOString() : value;
  }
  if (Array.isArray(value)) return value.map(toIsoValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, toIsoValue(item)]));
  }
  return value;
};

const sameValue = (left: unknown, right: unknown): boolean => {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right)
      && left.length === right.length
      && left.every((item, index) => sameValue(item, right[index]));
  }
  if (left && right && typeof left === 'object' && typeof right === 'object') {
    const a = left as Record<string, unknown>;
    const b = right as Record<string, unknown>;
    const keys = Object.keys(a).sort();
    const otherKeys = Object.keys(b).sort();
    return keys.length === otherKeys.length
      && keys.every((key, index) => key === otherKeys[index] && sameValue(a[key], b[key]));
  }
  return false;
};

const withoutUndefined = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(withoutUndefined);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .map(([key, item]) => [key, withoutUndefined(item)]));
  }
  return value;
};

const cardForValidation = (value: DocumentData, cardId: string): CardRecord => {
  const source = toIsoValue(value) as CardRecord;
  if (source.id !== cardId || source.schemaVersion !== 2) {
    throw new ReviewPersistenceConflictError('identity-conflict');
  }
  const card = canonicalCard(source);
  if (card.id !== cardId || card.normalizedWord !== source.normalizedWord) {
    throw new ReviewPersistenceConflictError('identity-conflict');
  }
  safeCounter(source.revision, 'revision');
  safeCounter(source.libraryEpoch, 'libraryEpoch');
  return {
    ...card,
    id: cardId,
    schemaVersion: 2,
    revision: safeCounter(source.revision, 'revision'),
    libraryEpoch: safeCounter(source.libraryEpoch, 'libraryEpoch'),
  };
};

const reviewPatch = (fields: Record<ReviewField, unknown>): Record<string, unknown> =>
  Object.fromEntries(REVIEW_FIELDS.map(field => [field, fields[field]]));

const expectedHistory = (history: unknown[], finalEntry: Record<string, unknown>): Record<string, unknown>[] => [
  ...history,
  finalEntry,
].slice(-MAX_REVIEW_HISTORY) as Record<string, unknown>[];

const ownerCard = (database: Firestore, ownerId: string, cardId: string) =>
  database.collection('users').doc(ownerId).collection('cards').doc(cardId);

const ownerState = (database: Firestore, ownerId: string) =>
  database.collection('users').doc(ownerId).collection('profile').doc('library_state');

export async function applyReviewForOwner(
  database: Firestore,
  ownerId: string,
  request: ReviewRequest,
): Promise<ReviewPersistenceResult> {
  if (!ownerId || ownerId.includes('/')) throw new InputValidationError('Review owner is invalid.');
  const cardRef = ownerCard(database, ownerId, request.cardId);
  const stateRef = ownerState(database, ownerId);
  return database.runTransaction(async (transaction: Transaction) => {
    const stateSnapshot = await transaction.get(stateRef);
    const serverEpoch = stateSnapshot.exists ? safeCounter(stateSnapshot.data()?.libraryEpoch, 'libraryEpoch') : 0;
    if (request.libraryEpoch < serverEpoch) throw new ReviewPersistenceConflictError('stale-library-epoch');
    if (request.libraryEpoch > serverEpoch) throw new ReviewPersistenceConflictError('future-library-epoch');

    const cardSnapshot = await transaction.get(cardRef);
    if (!cardSnapshot.exists) throw new ReviewPersistenceConflictError('missing');
    const stored = cardForValidation(cardSnapshot.data() ?? {}, request.cardId);
    const revision = safeCounter(stored.revision, 'revision');
    const storedEpoch = safeCounter(stored.libraryEpoch, 'libraryEpoch');
    if (storedEpoch !== serverEpoch) {
      throw new ReviewPersistenceConflictError(
        storedEpoch < serverEpoch ? 'stale-library-epoch' : 'future-library-epoch',
      );
    }
    const operationIds = Array.isArray(stored.appliedReviewOperationIds)
      ? stored.appliedReviewOperationIds as string[]
      : [];
    if (operationIds.includes(request.opId)) {
      return { applied: true, duplicate: true, card: serializeCardResponse(stored) };
    }
    if (request.baseRevision !== revision) {
      throw new ReviewPersistenceConflictError('revision-conflict', revision, serializeCardResponse(stored));
    }
    if (revision >= MAX_PROTOCOL_COUNTER) throw new ReviewPersistenceConflictError('identity-conflict');

    const fields = reviewPatch(request.fields);
    const candidate = cardForValidation({
      ...stored,
      ...fields,
      id: request.cardId,
      schemaVersion: 2,
      revision,
      libraryEpoch: serverEpoch,
    }, request.cardId);
    const previousHistory = Array.isArray(stored.reviewHistory)
      ? stored.reviewHistory as Record<string, unknown>[]
      : [];
    const resultHistory = Array.isArray(candidate.reviewHistory)
      ? candidate.reviewHistory as Record<string, unknown>[]
      : [];
    const finalEntry = resultHistory.at(-1);
    if (!finalEntry
      || finalEntry.rating !== request.rating
      || finalEntry.reviewedAt !== request.reviewedAt
      || !sameValue(resultHistory, expectedHistory(previousHistory, finalEntry))) {
      throw new InputValidationError('Review history must append exactly one bounded entry.');
    }
    for (const field of REVIEW_FIELDS) {
      if (!sameValue(candidate[field], withoutUndefined(toIsoValue(fields[field])))) {
        throw new InputValidationError(`Review field "${field}" is not canonical.`);
      }
    }
    const fsrs = candidate.fsrs as Record<string, unknown> | undefined;
    const finalReview = resultHistory.at(-1);
    const previousCorrectStreak = typeof stored.correctStreak === 'number' ? stored.correctStreak : 0;
    const expectedCorrectStreak = request.rating === 'good' || request.rating === 'easy'
      ? previousCorrectStreak + 1
      : 0;
    if (
      !fsrs
      || candidate.difficulty !== (request.rating === 'again' ? 'hard' : request.rating)
      || candidate.nextReviewDate !== fsrs.due
      || candidate.reviews !== fsrs.reps
      || candidate.interval !== fsrs.scheduledDays
      || finalReview?.scheduledDays !== fsrs.scheduledDays
      || finalReview?.elapsedDays !== fsrs.elapsedDays
      || fsrs.lastReview !== request.reviewedAt
      || candidate.correctStreak !== expectedCorrectStreak
      || candidate.easeFactor !== Math.max(1.3, 3 - (Number(fsrs.difficulty) / 10))
    ) {
      throw new InputValidationError('Review fields do not match the scheduler transition.');
    }
    const canonicalFields = reviewPatch(candidate as unknown as Record<ReviewField, unknown>);
    const nextOperationIds = [...operationIds, request.opId].slice(-MAX_REVIEW_OPERATION_IDS);
    const nextRevision = revision + 1;
    const updatedAt = new Date().toISOString();
    const persisted = {
      ...canonicalFields,
      appliedReviewOperationIds: nextOperationIds,
      revision: nextRevision,
      libraryEpoch: serverEpoch,
      schemaVersion: 2,
      updatedAt: FieldValue.serverTimestamp(),
    };
    transaction.set(cardRef, persisted, { merge: true });
    return {
      applied: true,
      duplicate: false,
      card: serializeCardResponse({
        ...candidate,
        ...canonicalFields,
        appliedReviewOperationIds: nextOperationIds,
        revision: nextRevision,
        libraryEpoch: serverEpoch,
        schemaVersion: 2,
        updatedAt,
      }),
    };
  });
}
