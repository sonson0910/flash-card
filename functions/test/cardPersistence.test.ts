import { readFileSync } from 'node:fs';
import type {
  DocumentData,
  DocumentReference,
  DocumentSnapshot,
  Firestore,
  Transaction,
} from 'firebase-admin/firestore';
import { describe, expect, it, vi } from 'vitest';
import {
  CardAllocationLimitError,
  createCardForOwner,
  parseCreateCardRequest,
} from '../src/cardPersistence.js';

const snapshot = (exists: boolean, data?: DocumentData): DocumentSnapshot => ({
  exists,
  data: () => data,
} as DocumentSnapshot);

const card = {
  id: 'caller-chosen-id',
  word: '  Hello  ',
  normalizedWord: 'hello',
  translation: 'xin chào',
  explanation: 'a greeting',
  explanationTranslation: 'lời chào',
  phonetic: '/həˈləʊ/',
  category: 'Basics',
  emoji: '👋',
  audioUrl: null,
  imageUrl: null,
  imageSearchQuery: 'hello greeting',
  bookmarked: false,
  difficulty: 'unrated',
  customDeck: null,
  reviews: 0,
  interval: 0,
  easeFactor: 2.5,
  correctStreak: 0,
  partOfSpeech: 'interjection',
  cefrLevel: 'A1',
  exampleSentence: 'Hello, how are you?',
  exampleTranslation: 'Xin chào, bạn khỏe không?',
  collocations: [],
  synonyms: [],
  antonyms: [],
  register: '',
  commonMistake: '',
  reviewHistory: [],
};

const transactionHarness = (values: ReadonlyMap<string, DocumentSnapshot>) => {
  const writes: Array<{ method: string; path: string; data?: DocumentData }> = [];
  let writing = false;
  const transaction = {
    get: vi.fn(async (document: DocumentReference) => {
      if (writing) throw new Error('transaction read occurred after a write');
      return values.get(document.path) ?? snapshot(false);
    }),
    create: vi.fn((document: DocumentReference, data: DocumentData) => {
      writing = true;
      writes.push({ method: 'create', path: document.path, data });
      return transaction;
    }),
    set: vi.fn((document: DocumentReference, data: DocumentData) => {
      writing = true;
      writes.push({ method: 'set', path: document.path, data });
      return transaction;
    }),
  } as unknown as Transaction;
  const database = {
    collection: (name: string) => ({
      doc: (ownerId: string) => ({
        path: `${name}/${ownerId}`,
        collection: (subcollection: string) => ({
          doc: (documentId: string) => ({
            path: `${name}/${ownerId}/${subcollection}/${documentId}`,
          }),
        }),
      }),
    }),
    runTransaction: vi.fn(async (update: (value: Transaction) => Promise<unknown>) => update(transaction)),
  } as unknown as Firestore;
  return { database, transaction, writes };
};

describe('card persistence', () => {
  it('creates canonical identity documents and increments the trusted owner counter atomically', async () => {
    const harness = transactionHarness(new Map([
      ['users/owner/profile/library_state', snapshot(true, { libraryEpoch: 2 })],
      ['users/owner/profile/resource_usage', snapshot(true, { cardCount: 4 })],
    ]));

    await expect(createCardForOwner(harness.database, 'owner', card, {
      maximumCards: 5,
      libraryEpoch: 2,
    })).resolves.toMatchObject({
      created: true,
      card: {
        id: 'word-hello',
        normalizedWord: 'hello',
        schemaVersion: 2,
        revision: 1,
        libraryEpoch: 2,
      },
    });

    expect(harness.writes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        method: 'create',
        path: 'users/owner/card_reservations/2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
      }),
      expect.objectContaining({ method: 'create', path: 'users/owner/cards/word-hello' }),
      expect.objectContaining({
        method: 'set',
        path: 'users/owner/profile/resource_usage',
        data: expect.objectContaining({ cardCount: 5 }),
      }),
    ]));
    expect(harness.transaction.get).toHaveBeenCalledTimes(4);
  });

  it('does not double-count an existing normalized identity on retry', async () => {
    const reservation = {
      schemaVersion: 1,
      cardId: 'word-hello',
      normalizedWord: 'hello',
    };
    const existingCard = {
      ...card,
      id: 'word-hello',
      word: 'hello',
      schemaVersion: 2,
      revision: 1,
      libraryEpoch: 2,
    };
    const harness = transactionHarness(new Map([
      ['users/owner/profile/library_state', snapshot(true, { libraryEpoch: 2 })],
      ['users/owner/profile/resource_usage', snapshot(true, { cardCount: 5 })],
      ['users/owner/card_reservations/2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824', snapshot(true, reservation)],
      ['users/owner/cards/word-hello', snapshot(true, existingCard)],
    ]));

    await expect(createCardForOwner(harness.database, 'owner', card, {
      maximumCards: 5,
      libraryEpoch: 2,
    })).resolves.toMatchObject({ created: false, card: { id: 'word-hello' } });
    expect(harness.writes).toEqual([]);
  });

  it('rejects a new identity at the owner cap and never trusts a payload owner', async () => {
    const capped = transactionHarness(new Map([
      ['users/owner/profile/library_state', snapshot(true, { libraryEpoch: 2 })],
      ['users/owner/profile/resource_usage', snapshot(true, { cardCount: 5 })],
    ]));

    await expect(createCardForOwner(capped.database, 'owner', card, {
      maximumCards: 5,
      libraryEpoch: 2,
    })).rejects.toBeInstanceOf(CardAllocationLimitError);
    expect(capped.writes).toEqual([]);

    const crossOwner = transactionHarness(new Map());
    await expect(createCardForOwner(crossOwner.database, 'owner', {
      ...card,
      ownerId: 'attacker',
    }, { maximumCards: 5, libraryEpoch: 0 })).rejects.toThrow(/unsupported field/i);
    expect(crossOwner.database.runTransaction).not.toHaveBeenCalled();
  });

  it('rejects oversized canonical input before opening an Admin transaction', () => {
    expect(() => parseCreateCardRequest({
      card: { ...card, explanation: 'x'.repeat(2_049) },
    })).toThrow(/explanation/i);
  });

  it('keeps direct client allocation denied after callable wiring', () => {
    const rules = readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8');
    expect(rules).toMatch(/match \/users\/\{userId\}\/cards\/\{cardId\}[\s\S]*?allow create: if false;/);
    expect(rules).toMatch(/match \/users\/\{userId\}\/card_reservations\/\{reservationId\}[\s\S]*?allow create: if false;/);

    const callable = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');
    expect(callable).toContain('export const createCard = onCall({');
    expect(callable).toContain('enforceAppCheck');
    expect(callable).toContain('createCardForOwner(database, userId, input.card');

    const repository = readFileSync(new URL('../../src/lib/cardRepository.ts', import.meta.url), 'utf8');
    expect(repository).toContain("httpsCallable<");
    expect(repository).toContain("'createCard'");
  });
});
