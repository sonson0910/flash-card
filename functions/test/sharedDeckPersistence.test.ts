import { readFileSync } from 'node:fs';
import { Timestamp } from 'firebase-admin/firestore';
import type { DocumentData, DocumentReference, DocumentSnapshot, Firestore, Transaction } from 'firebase-admin/firestore';
import { describe, expect, it, vi } from 'vitest';
import {
  buildSharedDeckDocuments,
  createSharedDeckAtomically,
  loadPublicSharedDeck,
  revokeSharedDeckAtomically,
  SharedDeckOwnershipError,
  SharedDeckUnavailableError,
} from '../src/sharedDeckPersistence.js';

const reference = (path: string): DocumentReference => ({ path } as DocumentReference);

const snapshot = (
  exists: boolean,
  data?: DocumentData,
): DocumentSnapshot => ({
  exists,
  data: () => data,
} as DocumentSnapshot);

const transactionHarness = (snapshots: ReadonlyMap<string, DocumentSnapshot>) => {
  const creates: Array<{ path: string; data: DocumentData }> = [];
  const deletes: string[] = [];
  const transaction = {
    get: vi.fn(async (document: DocumentReference) => snapshots.get(document.path) ?? snapshot(false)),
    create: vi.fn((document: DocumentReference, data: DocumentData) => {
      creates.push({ path: document.path, data });
      return transaction;
    }),
    delete: vi.fn((document: DocumentReference) => {
      deletes.push(document.path);
      return transaction;
    }),
  } as unknown as Transaction;
  const database = {
    runTransaction: vi.fn(async (update: (value: Transaction) => Promise<unknown>) => update(transaction)),
  } as unknown as Firestore;
  return { creates, database, deletes };
};

const sharedDeck = reference('shared_decks/share-1');
const ownership = reference('shared_deck_owners/share-1');
const readableReference = (exists: boolean, data?: DocumentData): DocumentReference => ({
  path: 'shared_decks/readable',
  get: vi.fn(async () => snapshot(exists, data)),
} as unknown as DocumentReference);
const sharedDeckInput = {
  category: 'Basics',
  cards: [{
    word: 'hello',
    translation: 'xin chào',
    explanation: '',
    explanationTranslation: '',
    phonetic: '',
    category: '',
    partOfSpeech: '',
    cefrLevel: '',
    exampleSentence: '',
    exampleTranslation: '',
    collocations: [],
    synonyms: [],
    antonyms: [],
    register: '',
    commonMistake: '',
    imageSearchQuery: '',
    emoji: '',
    audioUrl: null,
    imageUrl: null,
  }],
};

describe('shared-deck persistence', () => {
  it('keeps owner identity out of the public document', () => {
    const documents = buildSharedDeckDocuments(
      sharedDeckInput,
      'owner-uid',
      'created',
      'expires',
    );

    expect(documents.sharedDeck).toEqual({
      category: 'Basics',
      cards: expect.any(Array),
      createdAt: 'created',
      expiresAt: 'expires',
      schemaVersion: 2,
    });
    expect(documents.sharedDeck).not.toHaveProperty('authorUid');
    expect(documents.sharedDeck).not.toHaveProperty('ownerUid');
    expect(documents.ownership).toEqual({
      ownerUid: 'owner-uid',
      createdAt: 'created',
      expiresAt: 'expires',
      schemaVersion: 1,
    });
  });

  it('creates the public deck and private ownership metadata in one transaction', async () => {
    const harness = transactionHarness(new Map());
    const documents = buildSharedDeckDocuments({ category: 'Basics', cards: [] }, 'owner', 'created', 'expires');

    await createSharedDeckAtomically(harness.database, sharedDeck, ownership, documents);

    expect(harness.database.runTransaction).toHaveBeenCalledTimes(1);
    expect(harness.creates).toEqual([
      { path: sharedDeck.path, data: documents.sharedDeck },
      { path: ownership.path, data: documents.ownership },
    ]);
  });

  it('loads only a live canonical public projection', async () => {
    const now = Timestamp.fromMillis(1_000);
    const reference = readableReference(true, {
      ...buildSharedDeckDocuments(
        sharedDeckInput,
        'owner',
        Timestamp.fromMillis(0),
        Timestamp.fromMillis(2_000),
      ).sharedDeck,
    });

    await expect(loadPublicSharedDeck(reference, now)).resolves.toEqual(sharedDeckInput);
  });

  it('hides missing, expired, or malformed public projections', async () => {
    const now = Timestamp.fromMillis(2_000);
    const current = buildSharedDeckDocuments(
      sharedDeckInput,
      'owner',
      Timestamp.fromMillis(0),
      Timestamp.fromMillis(3_000),
    ).sharedDeck;

    await expect(loadPublicSharedDeck(readableReference(false), now))
      .rejects.toBeInstanceOf(SharedDeckUnavailableError);
    await expect(loadPublicSharedDeck(readableReference(true, {
      ...current,
      expiresAt: Timestamp.fromMillis(2_000),
    }), now)).rejects.toBeInstanceOf(SharedDeckUnavailableError);
    await expect(loadPublicSharedDeck(readableReference(true, {
      ...current,
      cards: [{ ...sharedDeckInput.cards[0], authorUid: 'private-owner' }],
    }), now)).rejects.toBeInstanceOf(SharedDeckUnavailableError);
  });

  it('uses private ownership metadata to revoke a current share atomically', async () => {
    const harness = transactionHarness(new Map([
      [ownership.path, snapshot(true, { ownerUid: 'owner' })],
      [sharedDeck.path, snapshot(true, { schemaVersion: 2 })],
    ]));

    await expect(revokeSharedDeckAtomically(
      harness.database,
      sharedDeck,
      ownership,
      'owner',
    )).resolves.toBe(true);
    expect(harness.deletes).toEqual([sharedDeck.path, ownership.path]);
  });

  it('falls back to authorUid when revoking a legacy public document', async () => {
    const harness = transactionHarness(new Map([
      [sharedDeck.path, snapshot(true, { authorUid: 'legacy-owner', schemaVersion: 1 })],
    ]));

    await expect(revokeSharedDeckAtomically(
      harness.database,
      sharedDeck,
      ownership,
      'legacy-owner',
    )).resolves.toBe(true);
    expect(harness.deletes).toEqual([sharedDeck.path]);
  });

  it('treats private metadata as authoritative and denies another user', async () => {
    const harness = transactionHarness(new Map([
      [ownership.path, snapshot(true, { ownerUid: 'owner' })],
      [sharedDeck.path, snapshot(true, { authorUid: 'attacker' })],
    ]));

    await expect(revokeSharedDeckAtomically(
      harness.database,
      sharedDeck,
      ownership,
      'attacker',
    )).rejects.toBeInstanceOf(SharedDeckOwnershipError);
    expect(harness.deletes).toEqual([]);
  });

  it('keeps revocation idempotent when both documents are absent', async () => {
    const harness = transactionHarness(new Map());

    await expect(revokeSharedDeckAtomically(
      harness.database,
      sharedDeck,
      ownership,
      'owner',
    )).resolves.toBe(false);
    expect(harness.deletes).toEqual([]);
  });

  it('wires shared-deck callables through the strict persistence boundary', () => {
    const source = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');

    expect(source).toContain('createSharedDeckAtomically(database, document, ownership, documents)');
    expect(source).toContain('loadPublicSharedDeck(');
    expect(source).toContain('revokeSharedDeckAtomically(database, document, ownership, userId)');
    expect(source).not.toMatch(/authorUid\s*:\s*userId/);
  });
});
