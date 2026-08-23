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
  CardAllocationConflictError,
  CardAllocationLimitError,
  createCardForOwner,
  parseCreateCardRequest,
} from '../src/cardPersistence.js';
import {
  toCardAllocationHttpsError,
} from '../src/index.js';

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

const transactionHarness = (
  values: ReadonlyMap<string, DocumentSnapshot>,
  existingCardCount = 0,
) => {
  const writes: Array<{ method: string; path: string; data?: DocumentData }> = [];
  const events: string[] = [];
  let writing = false;
  const transaction = {
    get: vi.fn(async (document: DocumentReference) => {
      if (writing) throw new Error('transaction read occurred after a write');
      events.push(`get:${document.path}`);
      return values.get(document.path) ?? snapshot(false);
    }),
    create: vi.fn((document: DocumentReference, data: DocumentData) => {
      writing = true;
      events.push(`create:${document.path}`);
      writes.push({ method: 'create', path: document.path, data });
      return transaction;
    }),
    set: vi.fn((document: DocumentReference, data: DocumentData) => {
      writing = true;
      events.push(`set:${document.path}`);
      writes.push({ method: 'set', path: document.path, data });
      return transaction;
    }),
  } as unknown as Transaction;
  const database = {
    collection: (name: string) => ({
      count: () => ({
        get: vi.fn(async () => ({ data: () => ({ count: existingCardCount }) })),
      }),
      doc: (ownerId: string) => ({
        path: `${name}/${ownerId}`,
        collection: (subcollection: string) => ({
          count: () => ({
            get: vi.fn(async () => ({ data: () => ({ count: existingCardCount }) })),
          }),
          doc: (documentId: string) => ({
            path: `${name}/${ownerId}/${subcollection}/${documentId}`,
          }),
        }),
      }),
    }),
    runTransaction: vi.fn(async (update: (value: Transaction) => Promise<unknown>) => update(transaction)),
  } as unknown as Firestore;
  return { database, transaction, writes, events };
};

const concurrentAllocationHarness = () => {
  const values = new Map<string, DocumentSnapshot>([
    ['users/owner/profile/library_state', snapshot(true, { libraryEpoch: 2 })],
  ]);
  let queue = Promise.resolve();
  const pathFor = (name: string, ownerId: string, subcollection: string, id: string) =>
    `${name}/${ownerId}/${subcollection}/${id}`;
  const database = {
    collection: (name: string) => ({
      doc: (ownerId: string) => ({
        path: `${name}/${ownerId}`,
        collection: (subcollection: string) => ({
          count: () => ({ get: vi.fn(async () => ({ data: () => ({ count: 0 }) })) }),
          doc: (id: string) => ({ path: pathFor(name, ownerId, subcollection, id) }),
        }),
      }),
    }),
    runTransaction: vi.fn((update: (value: Transaction) => Promise<unknown>) => {
      const run = queue.then(async () => {
        const writes: Array<{ method: 'create' | 'set'; path: string; data: DocumentData; merge?: boolean }> = [];
        const transaction = {
          get: vi.fn(async (reference: DocumentReference) => values.get(reference.path) ?? snapshot(false)),
          create: vi.fn((reference: DocumentReference, data: DocumentData) => {
            writes.push({ method: 'create', path: reference.path, data });
            return transaction;
          }),
          set: vi.fn((reference: DocumentReference, data: DocumentData, options?: { merge?: boolean }) => {
            writes.push({ method: 'set', path: reference.path, data, merge: options?.merge });
            return transaction;
          }),
        } as unknown as Transaction;
        const result = await update(transaction);
        writes.forEach(write => {
          const previous = values.get(write.path);
          const previousData = previous?.exists ? previous.data() : undefined;
          values.set(write.path, snapshot(true, write.merge
            ? { ...previousData, ...write.data }
            : write.data));
        });
        return result;
      });
      queue = run.then(() => undefined, () => undefined);
      return run;
    }),
  } as unknown as Firestore;
  return { database, values };
};

describe('card persistence', () => {
  it('creates canonical identity documents and increments the trusted owner counter atomically', async () => {
    const harness = transactionHarness(new Map([
      ['users/owner/profile/library_state', snapshot(true, { libraryEpoch: 2 })],
      ['users/owner/profile/resource_usage', snapshot(true, { schemaVersion: 1, cardCount: 4 })],
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
    expect(harness.transaction.get).toHaveBeenCalledTimes(5);
  });

  it('initializes a missing usage document from existing cards before allocating', async () => {
    const harness = transactionHarness(new Map([
      ['users/owner/profile/library_state', snapshot(true, { libraryEpoch: 2 })],
      ['users/owner/cards/word-one', snapshot(true, { id: 'word-one', normalizedWord: 'one', word: 'one' })],
      ['users/owner/cards/word-two', snapshot(true, { id: 'word-two', normalizedWord: 'two', word: 'two' })],
    ]), 2);

    await expect(createCardForOwner(harness.database, 'owner', card, {
      maximumCards: 3,
      libraryEpoch: 2,
    })).resolves.toMatchObject({ created: true });
    expect(harness.writes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        method: 'set',
        path: 'users/owner/profile/resource_usage',
        data: { schemaVersion: 1, cardCount: 3 },
      }),
    ]));
  });

  it('includes pre-existing cards in the allocation cap when usage is missing', async () => {
    const harness = transactionHarness(new Map([
      ['users/owner/profile/library_state', snapshot(true, { libraryEpoch: 2 })],
      ['users/owner/cards/word-one', snapshot(true, { id: 'word-one', normalizedWord: 'one', word: 'one' })],
      ['users/owner/cards/word-two', snapshot(true, { id: 'word-two', normalizedWord: 'two', word: 'two' })],
    ]), 2);

    await expect(createCardForOwner(harness.database, 'owner', card, {
      maximumCards: 2,
      libraryEpoch: 2,
    })).rejects.toBeInstanceOf(CardAllocationLimitError);
    expect(harness.writes).toEqual([]);
  });

  it('fails closed when the existing usage document is unversioned', async () => {
    const harness = transactionHarness(new Map([
      ['users/owner/profile/library_state', snapshot(true, { libraryEpoch: 2 })],
      ['users/owner/profile/resource_usage', snapshot(true, { cardCount: 0 })],
    ]));

    await expect(createCardForOwner(harness.database, 'owner', card, {
      maximumCards: 5,
      libraryEpoch: 2,
    })).rejects.toMatchObject({ reason: 'identity-conflict' });
    expect(harness.writes).toEqual([]);
  });

  it('does not reset usage when two initializers allocate concurrently', async () => {
    const harness = concurrentAllocationHarness();
    const secondCard = { ...card, id: 'second', word: 'World', normalizedWord: 'world' };

    const results = await Promise.all([
      createCardForOwner(harness.database, 'owner', card, { maximumCards: 5, libraryEpoch: 2 }),
      createCardForOwner(harness.database, 'owner', secondCard, { maximumCards: 5, libraryEpoch: 2 }),
    ]);

    expect(results.every(result => result.created)).toBe(true);
    expect(harness.values.get('users/owner/profile/resource_usage')?.data()).toEqual({
      schemaVersion: 1,
      cardCount: 2,
    });
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
      ['users/owner/profile/resource_usage', snapshot(true, { schemaVersion: 1, cardCount: 5 })],
      ['users/owner/card_reservations/2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824', snapshot(true, reservation)],
      ['users/owner/cards/word-hello', snapshot(true, existingCard)],
    ]));

    await expect(createCardForOwner(harness.database, 'owner', card, {
      maximumCards: 5,
      libraryEpoch: 2,
    })).resolves.toMatchObject({ created: false, card: { id: 'word-hello' } });
    expect(harness.writes).toEqual([]);
  });

  it('normalizes sparse legacy cards before returning an existing identity', async () => {
    const harness = transactionHarness(new Map([
      ['users/owner/profile/library_state', snapshot(true, { libraryEpoch: 2 })],
      ['users/owner/profile/resource_usage', snapshot(true, { schemaVersion: 1, cardCount: 5 })],
      ['users/owner/cards/word-hello', snapshot(true, {
        word: 'hello',
        translation: 'xin chào',
        libraryEpoch: 2,
        revision: 2,
        updatedAt: { toDate: () => new Date('2026-08-23T00:00:00.000Z') },
      })],
    ]));

    const result = await createCardForOwner(harness.database, 'owner', card, {
      maximumCards: 5,
      libraryEpoch: 2,
    });
    expect(result).toEqual({
      created: false,
      card: {
        id: 'word-hello',
        word: 'hello',
        translation: 'xin chào',
        normalizedWord: 'hello',
        schemaVersion: 2,
        revision: 3,
        libraryEpoch: 2,
        updatedAt: '2026-08-23T00:00:00.000Z',
      },
    });
    expect(harness.writes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        method: 'create',
        path: 'users/owner/card_reservations/2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
      }),
      expect.objectContaining({
        method: 'set',
        path: 'users/owner/cards/word-hello',
        data: expect.objectContaining({
          id: 'word-hello',
          normalizedWord: 'hello',
          schemaVersion: 2,
          revision: 3,
          libraryEpoch: 2,
        }),
      }),
    ]));
    expect(harness.writes.find(write => write.path === 'users/owner/cards/word-hello')?.data)
      .toEqual(result.card);
  });

  it('repairs an old-generation card with its missing reservation without counting it again', async () => {
    const harness = transactionHarness(new Map([
      ['users/owner/profile/library_state', snapshot(true, { libraryEpoch: 2 })],
      ['users/owner/profile/resource_usage', snapshot(true, { schemaVersion: 1, cardCount: 5 })],
      ['users/owner/cards/word-hello', snapshot(true, {
        id: 'word-hello',
        word: 'hello',
        translation: 'xin chào',
        libraryEpoch: 1,
      })],
    ]));

    await expect(createCardForOwner(harness.database, 'owner', card, {
      maximumCards: 5,
      libraryEpoch: 2,
    })).resolves.toMatchObject({ created: true, card: { libraryEpoch: 2 } });
    expect(harness.writes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        method: 'create',
        path: 'users/owner/card_reservations/2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
      }),
      expect.objectContaining({
        method: 'set',
        path: 'users/owner/cards/word-hello',
      }),
    ]));
    expect(harness.writes.some(write => write.path === 'users/owner/profile/resource_usage')).toBe(false);
    const firstWrite = harness.events.findIndex(event => event.startsWith('create:') || event.startsWith('set:'));
    expect(firstWrite).toBeGreaterThanOrEqual(0);
    expect(harness.events.slice(0, firstWrite).every(event => event.startsWith('get:'))).toBe(true);
  });

  it('rejects a new identity at the owner cap and never trusts a payload owner', async () => {
    const capped = transactionHarness(new Map([
      ['users/owner/profile/library_state', snapshot(true, { libraryEpoch: 2 })],
      ['users/owner/profile/resource_usage', snapshot(true, { schemaVersion: 1, cardCount: 5 })],
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

  it('labels stale and future library generations with the stable mutation reasons', async () => {
    const stale = transactionHarness(new Map([
      ['users/owner/profile/library_state', snapshot(true, { libraryEpoch: 2 })],
      ['users/owner/profile/resource_usage', snapshot(true, { schemaVersion: 1, cardCount: 0 })],
    ]));
    await expect(createCardForOwner(stale.database, 'owner', card, {
      libraryEpoch: 1,
    })).rejects.toMatchObject({
      reason: 'stale-library-epoch',
    });

    const future = transactionHarness(new Map([
      ['users/owner/profile/library_state', snapshot(true, { libraryEpoch: 2 })],
      ['users/owner/profile/resource_usage', snapshot(true, { schemaVersion: 1, cardCount: 0 })],
    ]));
    await expect(createCardForOwner(future.database, 'owner', card, {
      libraryEpoch: 3,
    })).rejects.toMatchObject({
      reason: 'future-library-epoch',
    });
  });

  it.each(['deleted', 'stale-library-epoch'] as const)('maps %s allocation conflicts to bounded callable details', reason => {
    const error = toCardAllocationHttpsError(new CardAllocationConflictError(reason, 'private detail'));
    expect(error).toMatchObject({
      code: 'failed-precondition',
      details: { reason },
    });
    expect(error?.message).not.toContain('private detail');
    expect(error?.details).not.toHaveProperty('ownerId');
  });

  it('blocks a replayed create behind a current tombstone until an explicit newer operation', async () => {
    const tombstone = {
      cardId: 'word-hello',
      opId: 'delete-hello',
      libraryEpoch: 2,
      revision: 3,
      deletedAt: '2026-08-11T10:00:00.000Z',
    };
    const stale = transactionHarness(new Map([
      ['users/owner/profile/library_state', snapshot(true, { libraryEpoch: 2 })],
      ['users/owner/profile/resource_usage', snapshot(true, { schemaVersion: 1, cardCount: 5 })],
      ['users/owner/card_reservations/2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824', snapshot(true, {
        schemaVersion: 1, cardId: 'word-hello', normalizedWord: 'hello',
      })],
      ['users/owner/card_tombstones/word-hello', snapshot(true, tombstone)],
    ]));
    await expect(createCardForOwner(stale.database, 'owner', card, {
      maximumCards: 5,
      libraryEpoch: 2,
      baseRevision: 0,
    })).rejects.toMatchObject({
      reason: 'deleted',
      message: expect.stringMatching(/deleted/i),
    });
    expect(stale.writes).toEqual([]);

    const explicit = transactionHarness(new Map([
      ['users/owner/profile/library_state', snapshot(true, { libraryEpoch: 2 })],
      ['users/owner/profile/resource_usage', snapshot(true, { schemaVersion: 1, cardCount: 5 })],
      ['users/owner/card_reservations/2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824', snapshot(true, {
        schemaVersion: 1, cardId: 'word-hello', normalizedWord: 'hello',
      })],
      ['users/owner/card_tombstones/word-hello', snapshot(true, tombstone)],
    ]));
    await expect(createCardForOwner(explicit.database, 'owner', card, {
      maximumCards: 5,
      libraryEpoch: 2,
      baseRevision: 0,
      opId: 'recreate-hello',
      operationCreatedAt: '2026-08-11T11:00:00.000Z',
    })).resolves.toMatchObject({ created: true, card: { revision: 4 } });
    expect(explicit.writes).toEqual(expect.arrayContaining([
      expect.objectContaining({ method: 'set', path: 'users/owner/cards/word-hello' }),
    ]));
  });

  it('locks resource_usage from direct client profile writes', () => {
    const rules = readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8');
    expect(rules).toMatch(/match \/users\/\{userId\}\/profile\/resource_usage\s*\{[\s\S]*?allow read, write: if false;/);
    expect(rules).toMatch(/profileDocId != 'resource_usage'/);
  });

  it('rejects oversized canonical input before opening an Admin transaction', () => {
    expect(() => parseCreateCardRequest({
      card: { ...card, explanation: 'x'.repeat(2_049) },
    })).toThrow(/explanation/i);
  });

  it('rejects canonical output that expands beyond the existing identity and URL limits', () => {
    expect(() => parseCreateCardRequest({
      card: {
        ...card,
        word: 'ﬃ'.repeat(100),
        normalizedWord: undefined,
      },
    })).toThrow(/identity|normalizedWord/i);
    expect(() => parseCreateCardRequest({
      card: {
        ...card,
        imageUrl: `https://images.pexels.com/${'é'.repeat(1_000)}`,
      },
    })).toThrow(/imageUrl/i);
  });

  it('keeps direct client allocation denied after callable wiring', () => {
    const rules = readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8');
    expect(rules).toMatch(/match \/users\/\{userId\}\/cards\/\{cardId\}[\s\S]*?allow create: if false;/);
    expect(rules).toMatch(/match \/users\/\{userId\}\/card_reservations\/\{reservationId\}[\s\S]*?allow create: if isOwner\(userId\)/);

    const callable = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');
    expect(callable).toContain('export const createCard = onCall({');
    expect(callable).toContain('enforceAppCheck');
    expect(callable).toContain('createCardForOwner(database, userId, input.card');

    const repository = readFileSync(new URL('../../src/lib/cardRepository.ts', import.meta.url), 'utf8');
    expect(repository).toContain("httpsCallable<");
    expect(repository).toContain("'createCard'");
  });
});
