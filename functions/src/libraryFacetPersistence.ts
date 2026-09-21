import { createHash } from 'node:crypto';
import { FieldValue, type Firestore, type Transaction } from 'firebase-admin/firestore';
import { InputValidationError } from './inputValidation.js';
import { assertOwnerLibraryWriteAllowed } from './legacyLibraryMigrationOwnerScope.js';

export const MAX_LIBRARY_FACET_CATEGORIES = 256;
export const MAX_LIBRARY_FACET_RECEIPTS = 128;
export const MAX_LIBRARY_FACET_COUNTER = Number.MAX_SAFE_INTEGER;
export const MAX_LIBRARY_FACET_OPERATION_ID = 128;
export const LIBRARY_FACET_RECEIPT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const LIBRARY_FACET_OPERATION_FUTURE_SKEW_MS = 5 * 60 * 1000;
export const LIBRARY_FACET_LEGACY_COMPATIBILITY_CUTOFF_MS = Date.UTC(2026, 11, 31);

const RESERVED_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const OPERATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9:_-]*$/;
const FACET_FIELDS = ['categories', 'complete', 'version', 'updatedAt'] as const;
export type LibraryFacetOperation = 'delta' | 'clear';

export type LibraryFacetMutationRequest =
  | { op: 'delta'; ownerId: string; opId: string; operationCreatedAt?: string; delta: Record<string, number> }
  | { op: 'clear'; ownerId: string; opId: string; operationCreatedAt?: string };

export interface LibraryFacets {
  categories: Record<string, number>;
  complete: boolean;
}

export class LibraryFacetOwnerMismatchError extends Error {
  constructor() {
    super('Library facet request owner does not match the authenticated owner.');
    this.name = 'LibraryFacetOwnerMismatchError';
  }
}

interface LibraryFacetReceipt {
  fingerprint: string;
  opId: string;
}

interface LibraryFacetReceiptDocument {
  version: 1;
  receipts: LibraryFacetReceipt[];
}

const asRecord = (value: unknown, message: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new InputValidationError(message);
  }
  return value as Record<string, unknown>;
};

const exactKeys = (
  value: Record<string, unknown>,
  expected: readonly string[],
  message: string,
): void => {
  const actual = Object.keys(value);
  if (actual.length !== expected.length || actual.some(key => !expected.includes(key))) {
    throw new InputValidationError(message);
  }
};

const validOperationId = (value: unknown): value is string => typeof value === 'string'
  && value.length > 0
  && value.length <= MAX_LIBRARY_FACET_OPERATION_ID
  && OPERATION_ID_PATTERN.test(value)
  && !RESERVED_KEYS.has(value);

const validOwnerId = (value: unknown): value is string => typeof value === 'string'
  && value.length > 0
  && value.length <= 128
  && !value.includes('/');

const validCategory = (value: unknown): value is string => typeof value === 'string'
  && value.length > 0
  && value.length <= 128
  && !RESERVED_KEYS.has(value);

const safeCounter = (value: unknown, message: string): number => {
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > MAX_LIBRARY_FACET_COUNTER) {
    throw new InputValidationError(message);
  }
  return Number(value);
};

const safeDelta = (value: unknown): number => {
  if (!Number.isSafeInteger(value) || Number(value) === 0 || Math.abs(Number(value)) > MAX_LIBRARY_FACET_COUNTER) {
    throw new InputValidationError('Library facet delta values must be nonzero safe integers.');
  }
  return Number(value);
};

const operationCreatedAt = (value: unknown, now: number): string => {
  if (typeof value !== 'string' || value.length < 1 || value.length > 128) {
    throw new InputValidationError('Library facet operation creation time is invalid.');
  }
  const time = Date.parse(value);
  if (!Number.isFinite(time)) throw new InputValidationError('Library facet operation creation time is invalid.');
  if (time > now + LIBRARY_FACET_OPERATION_FUTURE_SKEW_MS) {
    throw new InputValidationError('Library facet operation creation time is too far in the future.');
  }
  if (time < now - LIBRARY_FACET_RECEIPT_TTL_MS) {
    throw new InputValidationError('Library facet operation is too old to retry.');
  }
  return new Date(time).toISOString();
};

const v2OperationId = (opId: string): { timestamp: number; nonce: string; digest: string } | null => {
  const match = /^v2:([0-9]{1,16}):([A-Za-z0-9_-]{8,32}):([a-f0-9]{64})$/.exec(opId);
  if (!match) return null;
  const [, timestampText, nonce, digest] = match;
  const timestamp = Number(timestampText);
  if (!Number.isSafeInteger(timestamp)) throw new InputValidationError('Library facet V2 operation ID is invalid.');
  const expectedDigest = createHash('sha256').update(`library-facet-v2:${timestamp}:${nonce}`).digest('hex');
  if (digest !== expectedDigest) throw new InputValidationError('Library facet V2 operation ID is invalid.');
  return { timestamp, nonce, digest };
};

export const libraryFacetV2OperationId = (timestamp: number, nonce: string): string => {
  if (!Number.isSafeInteger(timestamp) || !/^[A-Za-z0-9_-]{8,32}$/.test(nonce)) {
    throw new InputValidationError('Library facet V2 operation ID is invalid.');
  }
  const digest = createHash('sha256').update(`library-facet-v2:${timestamp}:${nonce}`).digest('hex');
  return `v2:${timestamp}:${nonce}:${digest}`;
};

const parseCategoryMap = (value: unknown, message: string): Record<string, number> => {
  const source = asRecord(value, message);
  const keys = Object.keys(source);
  if (keys.length > MAX_LIBRARY_FACET_CATEGORIES) {
    throw new InputValidationError('Library facet categories exceed the transaction budget.');
  }
  const categories = Object.create(null) as Record<string, number>;
  for (const key of keys) {
    if (!validCategory(key)) throw new InputValidationError('Library facet category is invalid.');
    categories[key] = safeCounter(source[key], 'Library facet counter is invalid.');
  }
  return categories;
};

const parseResult = (value: unknown): LibraryFacets => {
  const source = asRecord(value, 'Library facet result is invalid.');
  exactKeys(source, ['categories', 'complete'], 'Library facet result contains unsupported fields.');
  if (typeof source.complete !== 'boolean') throw new InputValidationError('Library facet completeness is invalid.');
  return { categories: parseCategoryMap(source.categories, 'Library facet categories are invalid.'), complete: source.complete };
};

const parseReceiptResult = (value: unknown): LibraryFacets => {
  const source = asRecord(value, 'Stored library facet receipt result is invalid.');
  return parseResult(source);
};

const parseStoredFacets = (value: unknown): LibraryFacets => {
  const source = asRecord(value, 'Stored library facets are invalid.');
  exactKeys(source, FACET_FIELDS, 'Stored library facets contain unsupported fields.');
  if (typeof source.complete !== 'boolean' || source.version !== 1
    || typeof source.updatedAt !== 'string'
    || source.updatedAt.length < 1
    || source.updatedAt.length > 128) {
    throw new InputValidationError('Stored library facets are invalid.');
  }
  return {
    categories: parseCategoryMap(source.categories, 'Stored library facets are invalid.'),
    complete: source.complete,
  };
};

const parseReceipt = (value: unknown): LibraryFacetReceipt => {
  const source = asRecord(value, 'Stored library facet receipt is invalid.');
  exactKeys(source, ['fingerprint', 'opId'], 'Stored library facet receipt contains unsupported fields.');
  if (typeof source.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(source.fingerprint)
    || !validOperationId(source.opId)) {
    throw new InputValidationError('Stored library facet receipt is invalid.');
  }
  return { fingerprint: source.fingerprint, opId: source.opId };
};

const parseReceiptDocument = (value: unknown): LibraryFacetReceiptDocument => {
  const source = asRecord(value, 'Stored library facet receipts are invalid.');
  exactKeys(source, ['receipts', 'version'], 'Stored library facet receipts contain unsupported fields.');
  if (source.version !== 1 || !Array.isArray(source.receipts) || source.receipts.length > MAX_LIBRARY_FACET_RECEIPTS) {
    throw new InputValidationError('Stored library facet receipts are invalid.');
  }
  const receipts = source.receipts.map(parseReceipt);
  if (new Set(receipts.map(receipt => receipt.opId)).size !== receipts.length) {
    throw new InputValidationError('Stored library facet receipts contain duplicate operation IDs.');
  }
  return { version: 1, receipts };
};

const sortCodeUnits = <T extends [string, unknown]>(entries: T[]): T[] => entries.sort(([left], [right]) => {
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const difference = left.charCodeAt(index) - right.charCodeAt(index);
    if (difference !== 0) return difference;
  }
  return left.length - right.length;
});

const canonicalRequest = (request: LibraryFacetMutationRequest): string => JSON.stringify(
  request.op === 'delta'
    ? {
      delta: Object.fromEntries(sortCodeUnits(Object.entries(request.delta))),
      op: request.op,
      operationCreatedAt: request.operationCreatedAt,
      ownerId: request.ownerId,
    }
    : { op: request.op, operationCreatedAt: request.operationCreatedAt, ownerId: request.ownerId },
);

const requestFingerprint = (request: LibraryFacetMutationRequest): string => createHash('sha256')
  .update(canonicalRequest(request))
  .digest('hex');

export const parseLibraryFacetMutationRequest = (value: unknown, now = Date.now()): LibraryFacetMutationRequest => {
  const source = asRecord(value, 'Library facet request must be an object.');
  const isV2 = typeof source.opId === 'string' && source.opId.startsWith('v2:');
  const expectedBaseKeys = isV2 ? ['op', 'opId', 'operationCreatedAt', 'ownerId'] : ['op', 'opId', 'ownerId'];
  const parsedOperationCreatedAt = (): string | undefined => {
    if (!isV2) {
      if (now >= LIBRARY_FACET_LEGACY_COMPATIBILITY_CUTOFF_MS) {
        throw new InputValidationError('Legacy library facet operations are no longer accepted.');
      }
      return undefined;
    }
    const timestamp = operationCreatedAt(source.operationCreatedAt, now);
    const parsedOperationId = v2OperationId(source.opId as string);
    if (!parsedOperationId || parsedOperationId.timestamp !== Date.parse(timestamp)) {
      throw new InputValidationError('Library facet V2 operation ID does not match operation creation time.');
    }
    return timestamp;
  };
  if (source.op === 'delta') {
    exactKeys(source, [...expectedBaseKeys, 'delta'], 'Library facet delta request contains unsupported fields.');
    if (!validOwnerId(source.ownerId)) throw new InputValidationError('Library facet owner ID is invalid.');
    if (!validOperationId(source.opId)) throw new InputValidationError('Library facet operation ID is invalid.');
    const deltaSource = asRecord(source.delta, 'Library facet delta must be an object.');
    if (Object.keys(deltaSource).length > MAX_LIBRARY_FACET_CATEGORIES) {
      throw new InputValidationError('Library facet delta exceeds the transaction budget.');
    }
    if (Object.keys(deltaSource).length === 0) {
      throw new InputValidationError('Library facet delta must contain at least one category.');
    }
    const delta = Object.create(null) as Record<string, number>;
    for (const [category, amount] of Object.entries(deltaSource)) {
      if (!validCategory(category)) throw new InputValidationError('Library facet category is invalid.');
      delta[category] = safeDelta(amount);
    }
    const createdAt = parsedOperationCreatedAt();
    return { op: 'delta', ownerId: source.ownerId, opId: source.opId, ...(createdAt ? { operationCreatedAt: createdAt } : {}), delta };
  }
  if (source.op === 'clear') {
    exactKeys(source, expectedBaseKeys, 'Library facet clear request contains unsupported fields.');
    if (!validOwnerId(source.ownerId)) throw new InputValidationError('Library facet owner ID is invalid.');
    if (!validOperationId(source.opId)) throw new InputValidationError('Library facet operation ID is invalid.');
    const createdAt = parsedOperationCreatedAt();
    return { op: 'clear', ownerId: source.ownerId, opId: source.opId, ...(createdAt ? { operationCreatedAt: createdAt } : {}) };
  }
  throw new InputValidationError('Library facet operation is invalid.');
};

const facetsReference = (database: Firestore, ownerId: string) =>
  database.collection('users').doc(ownerId).collection('profile').doc('library_facets');

const receiptsReference = (database: Firestore, ownerId: string) =>
  database.collection('users').doc(ownerId).collection('profile').doc('library_facet_receipts');

const receiptReference = (database: Firestore, ownerId: string, opId: string) =>
  database.collection('users').doc(ownerId).collection('library_facet_receipts').doc(opId);

export async function findLibraryFacetReceipt(
  database: Firestore,
  ownerId: string,
  request: LibraryFacetMutationRequest,
): Promise<LibraryFacets | null> {
  if (!ownerId || ownerId.includes('/')) throw new InputValidationError('Library facet owner is invalid.');
  const parsedRequest = parseLibraryFacetMutationRequest(request);
  if (parsedRequest.ownerId !== ownerId) throw new LibraryFacetOwnerMismatchError();
  const receiptSnapshot = await receiptReference(database, ownerId, parsedRequest.opId).get();
  if (!receiptSnapshot.exists) return null;
  const storedReceipt = asRecord(receiptSnapshot.data(), 'Stored library facet receipt is invalid.');
  if (storedReceipt.fingerprint !== requestFingerprint(parsedRequest)) {
    throw new InputValidationError('Library facet operation ID was reused with a different payload.');
  }
  return parseReceiptResult(storedReceipt.result);
}

export async function applyLibraryFacetMutation(
  database: Firestore,
  ownerId: string,
  request: LibraryFacetMutationRequest,
): Promise<LibraryFacets> {
  if (!ownerId || ownerId.includes('/')) throw new InputValidationError('Library facet owner is invalid.');
  const parsedRequest = parseLibraryFacetMutationRequest(request);
  if (parsedRequest.ownerId !== ownerId) throw new LibraryFacetOwnerMismatchError();
  const facetsRef = facetsReference(database, ownerId);
  const receiptsRef = receiptsReference(database, ownerId);
  const receiptRef = receiptReference(database, ownerId, parsedRequest.opId);
  const fingerprint = requestFingerprint(parsedRequest);
  return database.runTransaction(async (transaction: Transaction) => {
    const receiptSnapshot = await transaction.get(receiptRef);
    if (receiptSnapshot.exists) {
      const storedReceipt = asRecord(receiptSnapshot.data(), 'Stored library facet receipt is invalid.');
      if (storedReceipt.fingerprint !== fingerprint) {
        throw new InputValidationError('Library facet operation ID was reused with a different payload.');
      }
      return parseReceiptResult(storedReceipt.result);
    }
    await assertOwnerLibraryWriteAllowed(transaction, database, ownerId);
    const [facetsSnapshot, receiptsSnapshot] = await Promise.all([
      transaction.get(facetsRef),
      transaction.get(receiptsRef),
    ]);
    const current = facetsSnapshot.exists
      ? parseStoredFacets(facetsSnapshot.data())
      : { categories: Object.create(null) as Record<string, number>, complete: false };
    const receipts = receiptsSnapshot.exists
      ? parseReceiptDocument(receiptsSnapshot.data())
      : { version: 1 as const, receipts: [] };
    const categories = Object.fromEntries(Object.entries(current.categories));
    let complete = current.complete;
    if (parsedRequest.op === 'clear') {
      for (const category of Object.keys(categories)) delete categories[category];
      complete = true;
    } else {
      for (const [category, delta] of Object.entries(parsedRequest.delta)) {
        const previousValue = categories[category] ?? 0;
        const next = previousValue + delta;
        if (delta > 0 && (!Number.isSafeInteger(next) || next > MAX_LIBRARY_FACET_COUNTER)) {
          throw new InputValidationError('Library facet result counter is outside the safe range.');
        }
        const boundedNext = next < 0 ? 0 : next;
        if (!Number.isSafeInteger(boundedNext) || boundedNext > MAX_LIBRARY_FACET_COUNTER) {
          throw new InputValidationError('Library facet result counter is outside the safe range.');
        }
        if (boundedNext === 0) delete categories[category];
        else categories[category] = boundedNext;
      }
      if (Object.keys(categories).length > MAX_LIBRARY_FACET_CATEGORIES) {
        throw new InputValidationError('Library facet result exceeds the transaction budget.');
      }
    }
    const result = parseResult({ categories, complete });
    const receipt: LibraryFacetReceipt = { fingerprint, opId: parsedRequest.opId };
    transaction.set(facetsRef, {
      categories: result.categories,
      complete: result.complete,
      version: 1,
      updatedAt: new Date().toISOString(),
    });
    transaction.set(receiptsRef, {
      version: 1,
      receipts: [...receipts.receipts, receipt].slice(-MAX_LIBRARY_FACET_RECEIPTS),
    });
    transaction.create(receiptRef, {
      ownerId,
      opId: parsedRequest.opId,
      fingerprint,
      result,
      createdAt: FieldValue.serverTimestamp(),
      // Cached legacy clients have no timestamp-bound replay window. Keep a
      // receipt through the compatibility cutoff plus the normal retry period.
      expiresAt: new Date(parsedRequest.operationCreatedAt
        ? Date.now() + LIBRARY_FACET_RECEIPT_TTL_MS
        : Math.max(Date.now() + LIBRARY_FACET_RECEIPT_TTL_MS, LIBRARY_FACET_LEGACY_COMPATIBILITY_CUTOFF_MS + LIBRARY_FACET_RECEIPT_TTL_MS)),
    });
    return result;
  });
}
