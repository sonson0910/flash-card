import type { DocumentData, DocumentReference, DocumentSnapshot, Firestore, Transaction } from 'firebase-admin/firestore';
import { describe, expect, it, vi } from 'vitest';
import {
  clearLibraryCardsPageForOwner,
  ClearLibraryEpochError,
  ClearLibraryStoredCardError,
  ClearLibraryStoredProjectionError,
  MAX_CLEAR_LIBRARY_PAGE_CARDS,
  parseClearLibraryPageRequest,
} from '../src/clearLibraryPersistence.js';
import { toClearLibraryHttpsError } from '../src/index.js';

const snapshot = (exists: boolean, data?: DocumentData): DocumentSnapshot => ({ exists, data: () => data } as DocumentSnapshot);

const card = (overrides: DocumentData = {}): DocumentData => ({
  schemaVersion: 2, libraryEpoch: 2, revision: 1, lexemeId: 'lexeme-a', language: 'en', ...overrides,
});

const harness = (entries: Record<string, DocumentSnapshot> = {}) => {
  const values = new Map<string, DocumentSnapshot>([
    ['users/owner/profile/library_state', snapshot(true, { libraryEpoch: 3 })],
    ...Object.entries(entries),
  ]);
  const deletes: string[] = [];
  const transaction = {
    get: vi.fn(async (reference: DocumentReference) => values.get(reference.path) ?? snapshot(false)),
    getAll: vi.fn(async (...references: DocumentReference[]) => references.map(reference => values.get(reference.path) ?? snapshot(false))),
    delete: vi.fn((reference: DocumentReference) => { deletes.push(reference.path); return transaction; }),
  } as unknown as Transaction;
  const nestedCollection = (path: string) => ({ doc: (id: string) => nestedDoc(`${path}/${id}`) });
  const nestedDoc = (path: string) => ({
    path, id: path.slice(path.lastIndexOf('/') + 1), collection: (name: string) => nestedCollection(`${path}/${name}`),
  });
  const database = {
    collection: (name: string) => nestedCollection(name),
    runTransaction: vi.fn(async (update: (value: Transaction) => Promise<unknown>) => update(transaction)),
  } as unknown as Firestore;
  return { database, deletes, transaction };
};

describe('clear library page persistence', () => {
  it('bounds and validates the client page', () => {
    expect(parseClearLibraryPageRequest({ expectedOwnerId: 'owner', libraryEpoch: 3, cardIds: ['card-a'] }))
      .toEqual({ expectedOwnerId: 'owner', libraryEpoch: 3, cardIds: ['card-a'] });
    expect(() => parseClearLibraryPageRequest({ expectedOwnerId: 'owner', libraryEpoch: 3, cardIds: Array.from({ length: MAX_CLEAR_LIBRARY_PAGE_CARDS + 1 }, (_, index) => `card-${index}`) })).toThrow();
    expect(() => parseClearLibraryPageRequest({ expectedOwnerId: 'owner', libraryEpoch: 3, cardIds: ['card-a', 'card-a'] })).toThrow();
  });

  it('deletes an old card and only its old projection in one transaction', async () => {
    const test = harness({
      'users/owner/cards/card-a': snapshot(true, card()),
      'users/owner/catalog_progress/lexeme-a': snapshot(true, { libraryEpoch: 2 }),
    });
    await expect(clearLibraryCardsPageForOwner(test.database, 'owner', { expectedOwnerId: 'owner', libraryEpoch: 3, cardIds: ['card-a'] }))
      .resolves.toEqual({ deletedCardIds: ['card-a'], deletedProjectionLexemeIds: ['lexeme-a'] });
    expect(test.deletes).toEqual(expect.arrayContaining([
      'users/owner/cards/card-a', 'users/owner/catalog_progress/lexeme-a',
    ]));
  });

  it('keeps a current card and a projection recreated at the current epoch', async () => {
    const test = harness({
      'users/owner/cards/card-a': snapshot(true, card({ libraryEpoch: 3 })),
      'users/owner/catalog_progress/lexeme-a': snapshot(true, { libraryEpoch: 3 }),
    });
    await expect(clearLibraryCardsPageForOwner(test.database, 'owner', { expectedOwnerId: 'owner', libraryEpoch: 3, cardIds: ['card-a'] }))
      .resolves.toEqual({ deletedCardIds: [], deletedProjectionLexemeIds: [] });
    expect(test.deletes).toEqual([]);
  });

  it('deletes an old card without deleting a concurrently recreated projection', async () => {
    const test = harness({
      'users/owner/cards/card-a': snapshot(true, card()),
      'users/owner/catalog_progress/lexeme-a': snapshot(true, { libraryEpoch: 3 }),
    });
    await clearLibraryCardsPageForOwner(test.database, 'owner', { expectedOwnerId: 'owner', libraryEpoch: 3, cardIds: ['card-a'] });
    expect(test.deletes).toEqual(['users/owner/cards/card-a']);
  });

  it('rejects a stale clear epoch before any card write', async () => {
    const test = harness({ 'users/owner/cards/card-a': snapshot(true, card()) });
    await expect(clearLibraryCardsPageForOwner(test.database, 'owner', { expectedOwnerId: 'owner', libraryEpoch: 2, cardIds: ['card-a'] }))
      .rejects.toBeInstanceOf(ClearLibraryEpochError);
    expect(test.deletes).toEqual([]);
  });

  it('fails closed for a malformed stored epoch before deleting any card', async () => {
    const test = harness({ 'users/owner/cards/card-a': snapshot(true, card({ libraryEpoch: 'old' })) });
    await expect(clearLibraryCardsPageForOwner(test.database, 'owner', { expectedOwnerId: 'owner', libraryEpoch: 3, cardIds: ['card-a'] }))
      .rejects.toMatchObject({ name: ClearLibraryStoredCardError.name, reason: 'invalid-stored-library-epoch' });
    expect(test.deletes).toEqual([]);
  });

  it('fails closed for a future card epoch before deleting any card', async () => {
    const test = harness({ 'users/owner/cards/card-a': snapshot(true, card({ libraryEpoch: 4 })) });
    await expect(clearLibraryCardsPageForOwner(test.database, 'owner', { expectedOwnerId: 'owner', libraryEpoch: 3, cardIds: ['card-a'] }))
      .rejects.toMatchObject({ name: ClearLibraryStoredCardError.name, reason: 'future-stored-library-epoch' });
    expect(test.deletes).toEqual([]);
  });

  it.each([
    ['missing', {}, 'invalid-stored-projection-epoch'],
    ['future', { libraryEpoch: 4 }, 'future-stored-projection-epoch'],
  ])('fails closed for a %s projection epoch', async (_label, projection, reason) => {
    const test = harness({
      'users/owner/cards/card-a': snapshot(true, card()),
      'users/owner/catalog_progress/lexeme-a': snapshot(true, projection),
    });
    await expect(clearLibraryCardsPageForOwner(test.database, 'owner', { expectedOwnerId: 'owner', libraryEpoch: 3, cardIds: ['card-a'] }))
      .rejects.toMatchObject({ name: ClearLibraryStoredProjectionError.name, reason });
    expect(test.deletes).toEqual([]);
  });

  it('exposes only a Firestore transaction-size failure as a split-safe reason', () => {
    expect(toClearLibraryHttpsError({ code: 8, message: 'Transaction too large' }))
      .toMatchObject({ code: 'resource-exhausted', details: { reason: 'transaction-too-large' } });
    expect(toClearLibraryHttpsError({ code: 3, message: 'INVALID_ARGUMENT: Transaction too big. Decrease transaction size.' }))
      .toMatchObject({ code: 'resource-exhausted', details: { reason: 'transaction-too-large' } });
    expect(toClearLibraryHttpsError({ code: 8, message: 'quota exceeded' })).toBeNull();
  });
});
