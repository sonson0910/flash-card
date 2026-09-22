import type { DocumentData, Firestore, Transaction } from 'firebase-admin/firestore';
import { FieldValue } from 'firebase-admin/firestore';
import { createHash } from 'node:crypto';
import { InputValidationError } from './inputValidation.js';
import { canonicalCard, serializeCardResponse, type CardRecord } from './cardPersistence.js';
import { scheduleReviewTransition } from './reviewScheduler.js';
import { assertOwnerLibraryWriteAllowed } from './legacyLibraryMigrationOwnerScope.js';

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
  expectedOwnerId: string;
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

export type ReviewPersistenceOptions = {
  strict?: boolean;
};

export type ReviewConflictReason =
  | 'stale-library-epoch'
  | 'future-library-epoch'
  | 'revision-conflict'
  | 'missing'
  | 'identity-conflict'
  | 'stale-review'
  | 'future-review-clock-skew'
  | 'receipt-fingerprint-conflict';

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

const parseExpectedOwnerId = (value: unknown): string => {
  if (typeof value !== 'string'
    || value.length < 1
    || value.length > 128) {
    throw new InputValidationError('Review expected owner ID is invalid.');
  }
  return value;
};

export const parseReviewRequest = (value: unknown): ReviewRequest => {
  const source = asRecord(value, 'Review request must be an object.');
  const allowed = new Set(['expectedOwnerId', 'opId', 'cardId', 'baseRevision', 'libraryEpoch', 'rating', 'reviewedAt', 'fields', 'fieldMask']);
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
    expectedOwnerId: parseExpectedOwnerId(source.expectedOwnerId),
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

const cardForValidation = (value: DocumentData, cardId: string, allowLegacyFsrs = false): CardRecord => {
  const source = toIsoValue(value) as CardRecord;
  if (source.id !== cardId || source.schemaVersion !== 2) {
    throw new ReviewPersistenceConflictError('identity-conflict');
  }
  let card: CardRecord;
  try {
    card = canonicalCard(source);
  } catch (error) {
    // Existing malformed FSRS state is read through the scheduler's legacy
    // fallback. New client candidates still take the strict path above.
    if (!allowLegacyFsrs || !(error instanceof InputValidationError) || source.fsrs === undefined) throw error;
    const { fsrs: _legacyFsrs, ...withoutFsrs } = source;
    card = canonicalCard(withoutFsrs);
  }
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

const ownerReceipt = (database: Firestore, ownerId: string, cardId: string, opId: string) =>
  database.collection('users').doc(ownerId).collection('review_receipts').doc(`${cardId}:${opId}`);

const canonicalJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
};

const reviewFingerprint = (request: ReviewRequest): string => createHash('sha256').update(canonicalJson({
  cardId: request.cardId,
  baseRevision: request.baseRevision,
  libraryEpoch: request.libraryEpoch,
  rating: request.rating,
  reviewedAt: request.reviewedAt,
  fields: request.fields,
  fieldMask: request.fieldMask,
})).digest('hex');

const receiptResult = (value: unknown): ReviewPersistenceResult | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const receipt = value as Record<string, unknown>;
  if (receipt.fingerprint === undefined || !receipt.result || typeof receipt.result !== 'object') return null;
  const result = receipt.result as Record<string, unknown>;
  if (result.applied !== true || typeof result.duplicate !== 'boolean' || !result.card || typeof result.card !== 'object') return null;
  return { applied: true, duplicate: true, card: result.card as CardRecord };
};

const receiptExpiresAt = (value: unknown): number => {
  if (value instanceof Date) return value.getTime();
  if (value && typeof value === 'object' && 'toDate' in value && typeof (value as { toDate?: unknown }).toDate === 'function') {
    const date = (value as { toDate: () => unknown }).toDate();
    return date instanceof Date ? date.getTime() : Number.NaN;
  }
  return typeof value === 'string' ? Date.parse(value) : Number.NaN;
};

const reviewTime = (value: unknown): number => {
  if (value instanceof Date) return value.getTime();
  if (value && typeof value === 'object' && 'toDate' in value && typeof (value as { toDate?: unknown }).toDate === 'function') {
    const date = (value as { toDate: () => unknown }).toDate();
    return date instanceof Date ? date.getTime() : Number.NaN;
  }
  return typeof value === 'string' ? Date.parse(value) : Number.NaN;
};

const storedReviewTime = (value: DocumentData): number => {
  const fsrs = value.fsrs && typeof value.fsrs === 'object' && !Array.isArray(value.fsrs)
    ? value.fsrs as Record<string, unknown>
    : undefined;
  const history = Array.isArray(value.reviewHistory) ? value.reviewHistory : [];
  return [
    reviewTime(fsrs?.lastReview),
    ...history.map(entry => entry && typeof entry === 'object' && !Array.isArray(entry)
      ? reviewTime((entry as Record<string, unknown>).reviewedAt)
      : Number.NaN),
  ].reduce((latest, time) => Number.isFinite(time) ? Math.max(latest, time) : latest, Number.NEGATIVE_INFINITY);
};

export async function applyReviewForOwner(
  database: Firestore,
  ownerId: string,
  request: ReviewRequest,
  options: ReviewPersistenceOptions = {},
): Promise<ReviewPersistenceResult> {
  if (!ownerId || ownerId.includes('/')) throw new InputValidationError('Review owner is invalid.');
  const cardRef = ownerCard(database, ownerId, request.cardId);
  const stateRef = ownerState(database, ownerId);
  const receiptRef = ownerReceipt(database, ownerId, request.cardId, request.opId);
  const fingerprint = reviewFingerprint(request);
  const strict = options.strict !== false;
  return database.runTransaction(async (transaction: Transaction) => {
    if (strict) {
      // Receipt lookup precedes every mutable-state check so an uncertain retry
      // always returns its original authoritative result.
      const receiptSnapshot = await transaction.get(receiptRef);
      if (receiptSnapshot.exists) {
        const receipt = receiptSnapshot.data() as Record<string, unknown> | undefined;
        // Firestore TTL deletion is asynchronous, so an expired receipt must not
        // bypass the timestamp guard while its document still exists.
        if (receipt && receiptExpiresAt(receipt.expiresAt) > Date.now()) {
          if (receipt.fingerprint !== fingerprint) throw new ReviewPersistenceConflictError('receipt-fingerprint-conflict');
          const previous = receiptResult(receipt);
          if (!previous) throw new ReviewPersistenceConflictError('identity-conflict');
          return previous;
        }
      }
    }
    await assertOwnerLibraryWriteAllowed(transaction, database, ownerId);
    const stateSnapshot = await transaction.get(stateRef);
    const serverEpoch = stateSnapshot.exists ? safeCounter(stateSnapshot.data()?.libraryEpoch, 'libraryEpoch') : 0;
    if (request.libraryEpoch < serverEpoch) throw new ReviewPersistenceConflictError('stale-library-epoch');
    if (request.libraryEpoch > serverEpoch) throw new ReviewPersistenceConflictError('future-library-epoch');

    const cardSnapshot = await transaction.get(cardRef);
    if (!cardSnapshot.exists) throw new ReviewPersistenceConflictError('missing');
    const rawStored = cardSnapshot.data() ?? {};
    const authoritativeLastReview = storedReviewTime(rawStored);
    const stored = cardForValidation(rawStored, request.cardId, true);
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
    if (!strict && operationIds.includes(request.opId)) {
      return { applied: true, duplicate: true, card: serializeCardResponse(stored) };
    }
    if (request.baseRevision !== revision) {
      throw new ReviewPersistenceConflictError('revision-conflict', revision, serializeCardResponse(stored));
    }
    if (revision >= MAX_PROTOCOL_COUNTER) throw new ReviewPersistenceConflictError('identity-conflict');

    if (strict) {
      const reviewedAt = new Date(request.reviewedAt);
      if (reviewedAt.getTime() > Date.now() + 5 * 60 * 1000) {
        throw new ReviewPersistenceConflictError('future-review-clock-skew');
      }
      if (Number.isFinite(authoritativeLastReview) && reviewedAt.getTime() <= authoritativeLastReview) {
        throw new ReviewPersistenceConflictError('stale-review');
      }
    }

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
    const expected = scheduleReviewTransition(stored, request.rating, new Date(request.reviewedAt));
    if (!REVIEW_FIELDS.every(field => sameValue(candidate[field], expected[field]))) {
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
    const responseCard = serializeCardResponse({
      ...candidate,
      ...canonicalFields,
      appliedReviewOperationIds: nextOperationIds,
      revision: nextRevision,
      libraryEpoch: serverEpoch,
      schemaVersion: 2,
      updatedAt,
    });
    if (strict) {
      transaction.create(receiptRef, {
        ownerId,
        cardId: request.cardId,
        opId: request.opId,
        fingerprint,
        result: { applied: true, duplicate: false, card: responseCard },
        createdAt: FieldValue.serverTimestamp(),
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      });
    }
    return {
      applied: true,
      duplicate: false,
      card: responseCard,
    };
  });
}
