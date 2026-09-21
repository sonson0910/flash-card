import type { DocumentData, DocumentReference, DocumentSnapshot, Firestore, Transaction } from 'firebase-admin/firestore';
import { describe, expect, it, vi } from 'vitest';
import {
  applyLibraryFacetMutation,
  findLibraryFacetReceipt,
  LIBRARY_FACET_LEGACY_COMPATIBILITY_CUTOFF_MS,
  LIBRARY_FACET_RECEIPT_TTL_MS,
  libraryFacetV2OperationId,
  parseLibraryFacetMutationRequest,
  type LibraryFacetMutationRequest,
} from '../src/libraryFacetPersistence.js';

type LibraryFacetDeltaRequest = Extract<LibraryFacetMutationRequest, { op: 'delta' }>;
const TEST_OPERATION_CREATED_AT = new Date().toISOString();
const TEST_OPERATION_ID = libraryFacetV2OperationId(Date.parse(TEST_OPERATION_CREATED_AT), 'facet-op');

const snapshot = (exists: boolean, data?: DocumentData): DocumentSnapshot => ({
  exists,
  data: () => data,
} as DocumentSnapshot);

const request = (overrides: Partial<LibraryFacetDeltaRequest> = {}): LibraryFacetDeltaRequest => ({
  operationCreatedAt: TEST_OPERATION_CREATED_AT,
  opId: TEST_OPERATION_ID,
  op: 'delta',
  ownerId: 'owner',
  delta: { IELTS: 1 },
  ...overrides,
});

const validFacets = (overrides: Record<string, unknown> = {}) => ({
  categories: { IELTS: 2 },
  complete: false,
  version: 1,
  updatedAt: '2026-08-24T00:00:00.000Z',
  ...overrides,
});

const harness = (facets?: DocumentData, receipts?: DocumentData, fenced = false, receipt?: DocumentData) => {
  const values = new Map<string, DocumentSnapshot>([
    ['users/owner/profile/library_facets', snapshot(facets !== undefined, facets)],
    ['users/owner/profile/library_facet_receipts', snapshot(receipts !== undefined, receipts)],
    [`users/owner/library_facet_receipts/${TEST_OPERATION_ID}`, snapshot(receipt !== undefined, receipt)],
    ...(fenced ? [['users/owner/profile/library_migration_fence', snapshot(true, { schemaVersion: 1, active: true })] as const] : []),
  ]);
  const writes: Array<{ path: string; data: DocumentData }> = [];
  const transaction = {
    get: vi.fn(async (reference: DocumentReference) => values.get(reference.path) ?? snapshot(false)),
    set: vi.fn((reference: DocumentReference, data: DocumentData) => {
      writes.push({ path: reference.path, data });
      return transaction;
    }),
    create: vi.fn((reference: DocumentReference, data: DocumentData) => {
      writes.push({ path: reference.path, data });
      return transaction;
    }),
  } as unknown as Transaction;
  const database = {
    collection: (name: string) => ({
      doc: (ownerId: string) => ({
        collection: (subcollection: string) => ({
          doc: (id: string) => {
            const path = `${name}/${ownerId}/${subcollection}/${id}`;
            return { path, get: async () => values.get(path) ?? snapshot(false) };
          },
        }),
        path: `${name}/${ownerId}`,
      }),
    }),
    runTransaction: vi.fn(async (update: (value: Transaction) => Promise<unknown>) => update(transaction)),
  } as unknown as Firestore;
  return { database, writes };
};

describe('library facet persistence', () => {
  it('rejects facet writes while the durable migration fence is active', async () => {
    const test = harness(validFacets(), undefined, true);
    await expect(applyLibraryFacetMutation(test.database, 'owner', request()))
      .rejects.toMatchObject({ name: 'LegacyLibraryMigrationFenceError' });
    expect(test.writes).toEqual([]);
  });

  it('accepts only the exact bounded delta and clear request shapes', () => {
    const validRequest = request();
    expect(parseLibraryFacetMutationRequest(validRequest)).toEqual(validRequest);
    expect(parseLibraryFacetMutationRequest({
      op: 'clear', ownerId: 'owner', operationCreatedAt: TEST_OPERATION_CREATED_AT,
      opId: TEST_OPERATION_ID,
    })).toMatchObject({
      op: 'clear',
      ownerId: 'owner',
      opId: TEST_OPERATION_ID,
    });
    expect(() => parseLibraryFacetMutationRequest({ ...request(), extra: true })).toThrow();
    expect(() => parseLibraryFacetMutationRequest({ ...request(), delta: { IELTS: 0 } })).toThrow();
    expect(() => parseLibraryFacetMutationRequest({ ...request(), delta: {} })).toThrow();
    expect(() => parseLibraryFacetMutationRequest({ ...request(), delta: JSON.parse('{"__proto__":1}') })).toThrow();
    expect(() => parseLibraryFacetMutationRequest({ ...request(), delta: { ['a'.repeat(129)]: 1 } })).toThrow();
    const parserNow = Date.parse(TEST_OPERATION_CREATED_AT);
    const future = parserNow + 5 * 60 * 1000 + 1;
    expect(() => parseLibraryFacetMutationRequest({ ...request(), operationCreatedAt: new Date(future).toISOString(), opId: libraryFacetV2OperationId(future, 'facet-op') }, parserNow)).toThrow();
    const old = parserNow - 30 * 24 * 60 * 60 * 1000 - 1;
    expect(() => parseLibraryFacetMutationRequest({ ...request(), operationCreatedAt: new Date(old).toISOString(), opId: libraryFacetV2OperationId(old, 'facet-op') }, parserNow)).toThrow();
    const legacy = { op: 'delta', ownerId: 'owner', opId: 'facet-op-1', delta: { IELTS: 1 } };
    expect(parseLibraryFacetMutationRequest(legacy, Date.UTC(2026, 11, 30))).toEqual(legacy);
    expect(() => parseLibraryFacetMutationRequest(legacy, Date.UTC(2026, 11, 31))).toThrow();
    expect(() => parseLibraryFacetMutationRequest({
      ...validRequest,
      operationCreatedAt: new Date(Date.parse(validRequest.operationCreatedAt!) + 1).toISOString(),
    })).toThrow();
  });

  it('applies atomic deltas, removes zero counters, and preserves completeness', async () => {
    const test = harness(validFacets({ categories: { IELTS: 2, TOEFL: 1 }, complete: true }));
    await expect(applyLibraryFacetMutation(test.database, 'owner', request({ delta: { IELTS: -2, TOEFL: -1 } })))
      .resolves.toMatchObject({ categories: {}, complete: true });
    expect(test.writes).toHaveLength(3);
    expect(test.writes[0].path).toBe('users/owner/profile/library_facets');
    expect(test.writes[1].path).toBe('users/owner/profile/library_facet_receipts');
    expect(test.writes[2]).toMatchObject({
      path: `users/owner/library_facet_receipts/${TEST_OPERATION_ID}`,
      data: expect.objectContaining({
        fingerprint: expect.any(String),
        result: expect.objectContaining({ categories: {}, complete: true }),
        createdAt: expect.anything(),
        expiresAt: expect.any(Date),
      }),
    });
  });

  it('starts from an empty incomplete document and clears it atomically', async () => {
    const test = harness();
    await expect(applyLibraryFacetMutation(test.database, 'owner', {
      op: 'clear', ownerId: 'owner', operationCreatedAt: new Date().toISOString(),
      opId: libraryFacetV2OperationId(Date.now(), 'facet-op'),
    }))
      .resolves.toEqual({ categories: {}, complete: true });
  });

  it('fails closed on malformed stored data before any write', async () => {
    const test = harness(validFacets({ categories: { IELTS: -1 } }));
    await expect(applyLibraryFacetMutation(test.database, 'owner', request())).rejects.toThrow();
    expect(test.writes).toEqual([]);
  });

  it('fails closed on malformed server receipts before any write', async () => {
    const test = harness(validFacets(), {
      version: 1,
      receipts: [{ opId: 'old-operation', fingerprint: 'a'.repeat(64), result: { categories: {}, complete: false } }],
    });
    await expect(applyLibraryFacetMutation(test.database, 'owner', request())).rejects.toThrow();
    expect(test.writes).toEqual([]);
  });

  it('clamps negative underflow while rejecting positive overflow and the 256-category result cap', async () => {
    await expect(applyLibraryFacetMutation(
      harness(validFacets({ categories: { IELTS: 0 } })).database,
      'owner',
      request({ delta: { IELTS: -1 } }),
    )).resolves.toEqual({ categories: {}, complete: false });
    await expect(applyLibraryFacetMutation(
      harness(validFacets({ categories: { IELTS: Number.MAX_SAFE_INTEGER } })).database,
      'owner',
      request({ delta: { IELTS: 1 } }),
    )).rejects.toThrow();
    const categories = Object.fromEntries(Array.from({ length: 256 }, (_, index) => [`c-${index}`, 1]));
    await expect(applyLibraryFacetMutation(
      harness(validFacets({ categories })).database,
      'owner',
      request({ delta: { extra: 1 } }),
    )).rejects.toThrow();
  });

  it('rejects a request owner that differs from the authenticated owner before any write', async () => {
    const test = harness(validFacets());
    await expect(applyLibraryFacetMutation(test.database, 'other-owner', request())).rejects.toThrow();
    expect(test.writes).toEqual([]);
  });

  it('replays collator-equivalent Unicode-key deltas despite reversed insertion order', async () => {
    const composed = '\u00e9';
    const decomposed = 'e\u0301';
    const first = harness(validFacets({ categories: {} }));
    const initialRequest = request({
      delta: Object.fromEntries([[composed, 1], [decomposed, 1]]),
    });
    await applyLibraryFacetMutation(first.database, 'owner', initialRequest);
    const receipt = first.writes[2].data;
    const second = harness(validFacets({ categories: { [composed]: 99, [decomposed]: 4 } }), undefined, false, receipt);
    await expect(applyLibraryFacetMutation(second.database, 'owner', {
      ...initialRequest,
      delta: Object.fromEntries([[decomposed, 1], [composed, 1]]),
    })).resolves.toEqual({ categories: { [composed]: 1, [decomposed]: 1 }, complete: false });
    expect(second.writes).toEqual([]);
  });

  it('replays an identical durable receipt and rejects a payload conflict', async () => {
    const first = harness(validFacets());
    const initialRequest = request();
    await applyLibraryFacetMutation(first.database, 'owner', initialRequest);
    const receipt = first.writes[2].data;
    await expect(applyLibraryFacetMutation(
      harness(validFacets({ categories: { IELTS: 99 } }), undefined, false, receipt).database,
      'owner', initialRequest,
    )).resolves.toEqual({
      categories: { IELTS: 3 }, complete: false,
    });
    const second = harness(validFacets(), undefined, false, receipt);
    await expect(applyLibraryFacetMutation(second.database, 'owner', request({ delta: { IELTS: 2 } }))).rejects.toThrow();
    expect(second.writes).toEqual([]);
  });

  it('preflights a durable replay before rate charging and rejects a changed payload', async () => {
    const first = harness(validFacets());
    const initialRequest = request();
    await applyLibraryFacetMutation(first.database, 'owner', initialRequest);
    const receipt = first.writes[2].data;
    const replay = harness(undefined, undefined, false, receipt);
    await expect(findLibraryFacetReceipt(replay.database, 'owner', initialRequest)).resolves.toEqual({
      categories: { IELTS: 3 }, complete: false,
    });
    await expect(findLibraryFacetReceipt(replay.database, 'owner', request({ delta: { IELTS: 2 } }))).rejects.toThrow();
  });

  it('rejects a V2 operation when its timestamp is refreshed after receipt expiry', async () => {
    const original = request();
    const test = harness();
    await expect(applyLibraryFacetMutation(test.database, 'owner', {
      ...original,
      operationCreatedAt: new Date(Date.parse(original.operationCreatedAt!) + 1).toISOString(),
    })).rejects.toThrow();
    expect(test.writes).toEqual([]);
  });

  it('retains accepted legacy receipts through the cutoff retry window', async () => {
    const legacy = { op: 'delta' as const, ownerId: 'owner', opId: 'facet-op-1', delta: { IELTS: 1 } };
    const test = harness();
    await applyLibraryFacetMutation(test.database, 'owner', legacy);
    expect(test.writes[2].data.expiresAt).toEqual(new Date(
      LIBRARY_FACET_LEGACY_COMPATIBILITY_CUTOFF_MS + LIBRARY_FACET_RECEIPT_TTL_MS,
    ));
    expect(() => parseLibraryFacetMutationRequest(legacy, LIBRARY_FACET_LEGACY_COMPATIBILITY_CUTOFF_MS)).toThrow();
  });

  it('keeps the compatibility ledger bounded while durable receipts retain the result', async () => {
    const receipts = Array.from({ length: 128 }, (_, index) => ({
      opId: `old-operation-${index}`,
      fingerprint: 'a'.repeat(64),
    }));
    const test = harness(validFacets(), { version: 1, receipts });
    await applyLibraryFacetMutation(test.database, 'owner', request());
    const persisted = test.writes[1].data;
    expect(persisted.receipts).toHaveLength(128);
    expect(persisted.receipts.at(-1)).toEqual({
      opId: TEST_OPERATION_ID, fingerprint: expect.any(String),
    });
    expect(persisted.receipts.at(-1)).not.toHaveProperty('result');
    expect(test.writes[2].data.result).toEqual(expect.objectContaining({ categories: { IELTS: 3 }, complete: false }));
  });

  it('uses the durable receipt after the compatibility ledger has evicted the operation', async () => {
    const first = harness(validFacets());
    const initialRequest = request();
    await applyLibraryFacetMutation(first.database, 'owner', initialRequest);
    const receipt = first.writes[2].data;
    const evictedLedger = {
      version: 1,
      receipts: Array.from({ length: 128 }, (_, index) => ({
        opId: `later-${index}`,
        fingerprint: 'a'.repeat(64),
      })),
    };
    const second = harness(validFacets({ categories: { IELTS: 999 } }), evictedLedger, false, receipt);
    await expect(applyLibraryFacetMutation(second.database, 'owner', initialRequest)).resolves.toEqual({
      categories: { IELTS: 3 }, complete: false,
    });
    expect(second.writes).toEqual([]);
  });
});
