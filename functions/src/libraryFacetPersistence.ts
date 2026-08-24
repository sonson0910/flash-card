import { createHash } from 'node:crypto';
import type { Firestore, Transaction } from 'firebase-admin/firestore';
import { InputValidationError } from './inputValidation.js';

export const MAX_LIBRARY_FACET_CATEGORIES = 256;
export const MAX_LIBRARY_FACET_RECEIPTS = 128;
export const MAX_LIBRARY_FACET_COUNTER = Number.MAX_SAFE_INTEGER;
export const MAX_LIBRARY_FACET_OPERATION_ID = 128;

const RESERVED_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const OPERATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9:_-]*$/;
const FACET_FIELDS = ['categories', 'complete', 'version', 'updatedAt'] as const;
export type LibraryFacetOperation = 'delta' | 'clear';

export type LibraryFacetMutationRequest =
  | { op: 'delta'; opId: string; delta: Record<string, number> }
  | { op: 'clear'; opId: string };

export interface LibraryFacets {
  categories: Record<string, number>;
  complete: boolean;
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

const canonicalRequest = (request: LibraryFacetMutationRequest): string => JSON.stringify(
  request.op === 'delta'
    ? { delta: Object.fromEntries(Object.entries(request.delta).sort(([left], [right]) => left.localeCompare(right))), op: request.op }
    : { op: request.op },
);

const requestFingerprint = (request: LibraryFacetMutationRequest): string => createHash('sha256')
  .update(canonicalRequest(request))
  .digest('hex');

export const parseLibraryFacetMutationRequest = (value: unknown): LibraryFacetMutationRequest => {
  const source = asRecord(value, 'Library facet request must be an object.');
  if (source.op === 'delta') {
    exactKeys(source, ['delta', 'op', 'opId'], 'Library facet delta request contains unsupported fields.');
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
    return { op: 'delta', opId: source.opId, delta };
  }
  if (source.op === 'clear') {
    exactKeys(source, ['op', 'opId'], 'Library facet clear request contains unsupported fields.');
    if (!validOperationId(source.opId)) throw new InputValidationError('Library facet operation ID is invalid.');
    return { op: 'clear', opId: source.opId };
  }
  throw new InputValidationError('Library facet operation is invalid.');
};

const facetsReference = (database: Firestore, ownerId: string) =>
  database.collection('users').doc(ownerId).collection('profile').doc('library_facets');

const receiptsReference = (database: Firestore, ownerId: string) =>
  database.collection('users').doc(ownerId).collection('profile').doc('library_facet_receipts');

export async function applyLibraryFacetMutation(
  database: Firestore,
  ownerId: string,
  request: LibraryFacetMutationRequest,
): Promise<LibraryFacets> {
  if (!ownerId || ownerId.includes('/')) throw new InputValidationError('Library facet owner is invalid.');
  const parsedRequest = parseLibraryFacetMutationRequest(request);
  const facetsRef = facetsReference(database, ownerId);
  const receiptsRef = receiptsReference(database, ownerId);
  return database.runTransaction(async (transaction: Transaction) => {
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
    const fingerprint = requestFingerprint(parsedRequest);
    const previous = receipts.receipts.find(receipt => receipt.opId === parsedRequest.opId);
    if (previous) {
      if (previous.fingerprint !== fingerprint) {
        throw new InputValidationError('Library facet operation ID was reused with a different payload.');
      }
      return { categories: { ...current.categories }, complete: current.complete };
    }

    const categories = Object.fromEntries(Object.entries(current.categories));
    let complete = current.complete;
    if (parsedRequest.op === 'clear') {
      for (const category of Object.keys(categories)) delete categories[category];
      complete = true;
    } else {
      for (const [category, delta] of Object.entries(parsedRequest.delta)) {
        const previousValue = categories[category] ?? 0;
        const next = previousValue + delta;
        if (!Number.isSafeInteger(next) || next < 0 || next > MAX_LIBRARY_FACET_COUNTER) {
          throw new InputValidationError('Library facet result counter is outside the safe range.');
        }
        if (next === 0) delete categories[category];
        else categories[category] = next;
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
    return result;
  });
}
