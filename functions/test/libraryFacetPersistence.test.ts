import type { DocumentData, DocumentReference, DocumentSnapshot, Firestore, Transaction } from 'firebase-admin/firestore';
import { describe, expect, it, vi } from 'vitest';
import {
  applyLibraryFacetMutation,
  parseLibraryFacetMutationRequest,
  type LibraryFacetMutationRequest,
} from '../src/libraryFacetPersistence.js';

const snapshot = (exists: boolean, data?: DocumentData): DocumentSnapshot => ({
  exists,
  data: () => data,
} as DocumentSnapshot);

const request = (overrides: Partial<LibraryFacetMutationRequest> = {}): LibraryFacetMutationRequest => ({
  op: 'delta',
  ownerId: 'owner',
  opId: 'facet-op-1',
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

const harness = (facets?: DocumentData, receipts?: DocumentData, fenced = false) => {
  const values = new Map<string, DocumentSnapshot>([
    ['users/owner/profile/library_facets', snapshot(facets !== undefined, facets)],
    ['users/owner/profile/library_facet_receipts', snapshot(receipts !== undefined, receipts)],
    ...(fenced ? [['users/owner/profile/library_migration_fence', snapshot(true, { schemaVersion: 1, active: true })] as const] : []),
  ]);
  const writes: Array<{ path: string; data: DocumentData }> = [];
  const transaction = {
    get: vi.fn(async (reference: DocumentReference) => values.get(reference.path) ?? snapshot(false)),
    set: vi.fn((reference: DocumentReference, data: DocumentData) => {
      writes.push({ path: reference.path, data });
      return transaction;
    }),
  } as unknown as Transaction;
  const database = {
    collection: (name: string) => ({
      doc: (ownerId: string) => ({
        collection: (subcollection: string) => ({
          doc: (id: string) => ({ path: `${name}/${ownerId}/${subcollection}/${id}` }),
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
    expect(parseLibraryFacetMutationRequest(request())).toEqual(request());
    expect(parseLibraryFacetMutationRequest({ op: 'clear', ownerId: 'owner', opId: 'facet-op-1' })).toEqual({
      op: 'clear',
      ownerId: 'owner',
      opId: 'facet-op-1',
    });
    expect(() => parseLibraryFacetMutationRequest({ ...request(), extra: true })).toThrow();
    expect(() => parseLibraryFacetMutationRequest({ ...request(), delta: { IELTS: 0 } })).toThrow();
    expect(() => parseLibraryFacetMutationRequest({ ...request(), delta: {} })).toThrow();
    expect(() => parseLibraryFacetMutationRequest({ ...request(), delta: JSON.parse('{"__proto__":1}') })).toThrow();
    expect(() => parseLibraryFacetMutationRequest({ ...request(), delta: { ['a'.repeat(129)]: 1 } })).toThrow();
  });

  it('applies atomic deltas, removes zero counters, and preserves completeness', async () => {
    const test = harness(validFacets({ categories: { IELTS: 2, TOEFL: 1 }, complete: true }));
    await expect(applyLibraryFacetMutation(test.database, 'owner', request({ delta: { IELTS: -2, TOEFL: -1 } })))
      .resolves.toMatchObject({ categories: {}, complete: true });
    expect(test.writes).toHaveLength(2);
    expect(test.writes[0].path).toBe('users/owner/profile/library_facets');
    expect(test.writes[1].path).toBe('users/owner/profile/library_facet_receipts');
  });

  it('starts from an empty incomplete document and clears it atomically', async () => {
    const test = harness();
    await expect(applyLibraryFacetMutation(test.database, 'owner', { op: 'clear', ownerId: 'owner', opId: 'facet-op-1' }))
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
    await applyLibraryFacetMutation(first.database, 'owner', request({
      delta: Object.fromEntries([[composed, 1], [decomposed, 1]]),
    }));
    const receipt = first.writes[1].data;
    const second = harness(validFacets({ categories: { [composed]: 99, [decomposed]: 4 } }), receipt);
    await expect(applyLibraryFacetMutation(second.database, 'owner', request({
      delta: Object.fromEntries([[decomposed, 1], [composed, 1]]),
    }))).resolves.toEqual({ categories: { [composed]: 99, [decomposed]: 4 }, complete: false });
    expect(second.writes).toEqual([]);
  });

  it('replays an identical receipt and rejects a payload conflict', async () => {
    const first = harness(validFacets());
    await applyLibraryFacetMutation(first.database, 'owner', request());
    const receipt = first.writes[1].data;
    expect(receipt.receipts[0]).toEqual(expect.objectContaining({ opId: 'facet-op-1', fingerprint: expect.any(String) }));
    expect(receipt.receipts[0]).not.toHaveProperty('result');
    const second = harness(validFacets({ categories: { IELTS: 99 } }), receipt);
    await expect(applyLibraryFacetMutation(second.database, 'owner', request())).resolves.toEqual({
      categories: { IELTS: 99 }, complete: false,
    });
    expect(second.writes).toEqual([]);
    await expect(applyLibraryFacetMutation(second.database, 'owner', request({ delta: { IELTS: 2 } }))).rejects.toThrow();
    expect(second.writes).toEqual([]);
  });

  it('keeps the server receipt ledger bounded without copying facet results into receipts', async () => {
    const receipts = Array.from({ length: 128 }, (_, index) => ({
      opId: `old-operation-${index}`,
      fingerprint: 'a'.repeat(64),
    }));
    const test = harness(validFacets(), { version: 1, receipts });
    await applyLibraryFacetMutation(test.database, 'owner', request());
    const persisted = test.writes[1].data;
    expect(persisted.receipts).toHaveLength(128);
    expect(persisted.receipts.at(-1)).toEqual({
      opId: 'facet-op-1', fingerprint: expect.any(String),
    });
    expect(persisted.receipts.at(-1)).not.toHaveProperty('result');
  });
});
