import { createHash, randomUUID } from 'node:crypto';
import { deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { getFirestore, type DocumentReference, type Firestore } from 'firebase-admin/firestore';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  applyBulkCardMutationsForOwner,
  BulkMutationEpochError,
} from '../src/bulkCardMutationPersistence.js';
import { clearLibraryCardsPageForOwner } from '../src/clearLibraryPersistence.js';
import { createCardForOwner } from '../src/cardPersistence.js';
import { applyReviewForOwner, type ReviewRequest } from '../src/reviewPersistence.js';
import { scheduleReviewTransition } from '../src/reviewScheduler.js';

const describeWithEmulator = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;
const DATABASE_ID = 'ai-studio-945b4052-4462-4668-8936-277f09f07a37';

const canonicalLexemeId = () => {
  const tuple = JSON.stringify(['en', 'lead', 'noun', 'metal']);
  const bytes = Buffer.from(tuple).toString('hex');
  return `lexeme-${bytes.slice(0, 90)}-${createHash('sha256').update(`\u0000${bytes}`).digest('hex').slice(0, 24)}`;
};

const canonicalCard = (lexemeId: string) => ({
  id: lexemeId,
  word: 'lead',
  normalizedWord: 'lead',
  normalizedLemma: 'lead',
  lexemeId,
  language: 'en',
  senseKey: 'metal',
  translation: 'chì',
  explanation: 'a metal',
  explanationTranslation: 'một kim loại',
  phonetic: '/liːd/',
  category: 'Basics',
  emoji: '📝',
  audioUrl: null,
  imageUrl: null,
  imageSearchQuery: 'lead metal',
  bookmarked: false,
  difficulty: 'unrated',
  customDeck: null,
  reviews: 0,
  interval: 0,
  easeFactor: 2.5,
  correctStreak: 0,
  partOfSpeech: 'noun',
  cefrLevel: 'B1',
  exampleSentence: 'Lead is a metal.',
  exampleTranslation: 'Chì là một kim loại.',
  collocations: [],
  synonyms: [],
  antonyms: [],
  register: '',
  commonMistake: '',
  reviewHistory: [],
  createdAt: '2026-08-01T00:00:00.000Z',
});

describeWithEmulator('Firestore bulk card mutation persistence', () => {
  let app: App;
  let database: Firestore;

  beforeAll(() => {
    app = initializeApp({ projectId: 'demo-lingoflash' }, 'bulk-card-mutation-integration');
    database = getFirestore(app, DATABASE_ID);
  });

  afterAll(async () => {
    await database.terminate();
    await deleteApp(app);
  });

  const seedCard = async (owner: DocumentReference, id: string, overrides: Record<string, unknown> = {}) => {
    await owner.collection('cards').doc(id).set({
      id,
      word: id,
      normalizedWord: id,
      translation: 'dịch',
      explanation: 'explanation',
      phonetic: '/x/',
      category: 'Basics',
      emoji: '📝',
      audioUrl: null,
      imageUrl: null,
      schemaVersion: 2,
      revision: 1,
      libraryEpoch: 0,
      ...overrides,
    });
  };

  it('applies one Admin SDK transaction across a mixed patch batch and reports a per-card conflict without blocking the others', async () => {
    const ownerId = `bulk-mutate-${randomUUID()}`;
    const owner = database.collection('users').doc(ownerId);
    await owner.collection('profile').doc('library_state').set({ libraryEpoch: 0 });
    await seedCard(owner, 'card-a', { customDeck: 'Old deck' });
    await seedCard(owner, 'card-b', { customDeck: 'Old deck', revision: 5 });

    const result = await applyBulkCardMutationsForOwner(database, ownerId, {
      libraryEpoch: 0,
      patches: [
        { cardId: 'card-a', baseRevision: 1, fields: { customDeck: null }, fieldMask: ['customDeck'] },
        // Stale baseRevision: the stored card is actually at revision 5.
        { cardId: 'card-b', baseRevision: 1, fields: { customDeck: null }, fieldMask: ['customDeck'] },
      ],
      deletes: [],
    });

    expect(result.results).toEqual(expect.arrayContaining([
      { cardId: 'card-a', op: 'patch', applied: true, revision: 2 },
      { cardId: 'card-b', op: 'patch', applied: false, reason: 'revision-conflict', currentRevision: 5 },
    ]));

    const [committedA, committedB] = await Promise.all([
      owner.collection('cards').doc('card-a').get(),
      owner.collection('cards').doc('card-b').get(),
    ]);
    expect(committedA.data()).toMatchObject({ customDeck: null, revision: 2 });
    // The conflicting card must be left completely untouched.
    expect(committedB.data()).toMatchObject({ customDeck: 'Old deck', revision: 5 });
  });

  it('deletes a card and writes its tombstone in the same transaction, then replays the same opId idempotently', async () => {
    const ownerId = `bulk-delete-${randomUUID()}`;
    const owner = database.collection('users').doc(ownerId);
    await owner.collection('profile').doc('library_state').set({ libraryEpoch: 0 });
    await seedCard(owner, 'card-c');
    const opId = `device-a:delete-${randomUUID()}`;

    const first = await applyBulkCardMutationsForOwner(database, ownerId, {
      libraryEpoch: 0,
      patches: [],
      deletes: [{ cardId: 'card-c', baseRevision: 1, opId }],
    });
    expect(first.results).toEqual([
      {
        cardId: 'card-c', op: 'delete', applied: true, revision: 2, deletedAt: expect.any(String),
        opId, libraryEpoch: 0,
      },
    ]);

    const [cardAfterDelete, tombstone] = await Promise.all([
      owner.collection('cards').doc('card-c').get(),
      owner.collection('card_tombstones').doc('card-c').get(),
    ]);
    expect(cardAfterDelete.exists).toBe(false);
    expect(tombstone.data()).toMatchObject({ cardId: 'card-c', opId, libraryEpoch: 0, revision: 2 });

    // A retried delete with the same opId (e.g. a client retry after a
    // dropped response) must replay the original result, not fail or
    // advance the tombstone revision again.
    const replay = await applyBulkCardMutationsForOwner(database, ownerId, {
      libraryEpoch: 0,
      patches: [],
      deletes: [{ cardId: 'card-c', baseRevision: 1, opId }],
    });
    expect(replay.results).toEqual([
      {
        cardId: 'card-c', op: 'delete', applied: true, revision: 2, deletedAt: expect.any(String),
        opId, libraryEpoch: 0,
      },
    ]);
  });

  it('keeps canonical projection create, review replay, and delete atomic', async () => {
    const ownerId = `catalog-progress-${randomUUID()}`;
    const owner = database.collection('users').doc(ownerId);
    const lexemeId = canonicalLexemeId();
    await owner.collection('profile').doc('library_state').set({ libraryEpoch: 0 });

    const created = await createCardForOwner(database, ownerId, canonicalCard(lexemeId), {
      maximumCards: 5_000,
      libraryEpoch: 0,
    });
    expect(created).toMatchObject({ created: true, card: { id: lexemeId, revision: 1 } });
    const progressRef = owner.collection('catalog_progress').doc(lexemeId);
    expect((await progressRef.get()).data()).toMatchObject({
      schemaVersion: 1, ownerId, lexemeId, targetLanguage: 'en',
      status: 'active', cardRevision: 1, libraryEpoch: 0,
    });

    const cardRef = owner.collection('cards').doc(lexemeId);
    const stored = (await cardRef.get()).data();
    if (!stored) throw new Error('Canonical card was not persisted.');
    const reviewedAt = '2026-09-28T00:00:00.000Z';
    const reviewRequest: ReviewRequest = {
      opId: `device-a:review-${randomUUID()}`,
      cardId: lexemeId,
      baseRevision: 1,
      libraryEpoch: 0,
      rating: 'easy' as const,
      reviewedAt,
      fields: scheduleReviewTransition(stored, 'easy', new Date(reviewedAt)),
      fieldMask: [
        'difficulty', 'nextReviewDate', 'reviews', 'interval', 'easeFactor',
        'fsrs', 'reviewHistory', 'correctStreak',
      ],
    };
    const reviewed = await applyReviewForOwner(database, ownerId, reviewRequest);
    expect(reviewed).toMatchObject({ applied: true, duplicate: false, card: { revision: 2 } });
    expect((await progressRef.get()).data()).toMatchObject({
      status: 'mastered', cardRevision: 2, libraryEpoch: 0,
    });

    const replay = await applyReviewForOwner(database, ownerId, reviewRequest);
    expect(replay).toMatchObject({ applied: true, duplicate: true, card: { revision: 2 } });
    expect((await progressRef.get()).data()).toMatchObject({ status: 'mastered', cardRevision: 2 });

    const deleteRequest = {
      libraryEpoch: 0,
      patches: [],
      deletes: [{ cardId: lexemeId, baseRevision: 2, opId: `device-a:delete-${randomUUID()}` }],
    };
    await applyBulkCardMutationsForOwner(database, ownerId, deleteRequest);
    const [deletedCard, tombstone, deletedProgress] = await Promise.all([
      cardRef.get(), owner.collection('card_tombstones').doc(lexemeId).get(), progressRef.get(),
    ]);
    expect(deletedCard.exists).toBe(false);
    expect(tombstone.data()).toMatchObject({ cardId: lexemeId, libraryEpoch: 0, revision: 3 });
    expect(deletedProgress.exists).toBe(false);

    const deleteReplay = await applyBulkCardMutationsForOwner(database, ownerId, deleteRequest);
    expect(deleteReplay.results).toEqual([
      expect.objectContaining({
        cardId: lexemeId, op: 'delete', applied: true, revision: 3, deletedAt: expect.any(String),
        opId: deleteRequest.deletes[0].opId, libraryEpoch: 0,
      }),
    ]);
    expect((await owner.collection('card_tombstones').doc(lexemeId).get()).data()).toMatchObject({ revision: 3 });
    expect((await progressRef.get()).exists).toBe(false);
  });

  it('rejects the entire request without writing anything when the caller library epoch is stale', async () => {
    const ownerId = `bulk-stale-epoch-${randomUUID()}`;
    const owner = database.collection('users').doc(ownerId);
    await owner.collection('profile').doc('library_state').set({ libraryEpoch: 2 });
    await seedCard(owner, 'card-d', { libraryEpoch: 2 });

    await expect(applyBulkCardMutationsForOwner(database, ownerId, {
      libraryEpoch: 1,
      patches: [{ cardId: 'card-d', baseRevision: 1, fields: { customDeck: null }, fieldMask: ['customDeck'] }],
      deletes: [],
    })).rejects.toThrow(BulkMutationEpochError);

    const untouched = await owner.collection('cards').doc('card-d').get();
    expect(untouched.data()).toMatchObject({ revision: 1, libraryEpoch: 2 });
    expect(untouched.data()).not.toHaveProperty('customDeck');
  });

  it('clears old cards and projections while preserving a recreated projection', async () => {
    const ownerId = `clear-projection-${randomUUID()}`;
    const owner = database.collection('users').doc(ownerId);
    await owner.collection('profile').doc('library_state').set({ libraryEpoch: 3 });
    await seedCard(owner, 'old-a', { libraryEpoch: 2, language: 'en', lexemeId: 'lexeme-a' });
    await seedCard(owner, 'old-b', { libraryEpoch: 2, language: 'en', lexemeId: 'lexeme-b' });
    await owner.collection('catalog_progress').doc('lexeme-a').set({ libraryEpoch: 2 });
    await owner.collection('catalog_progress').doc('lexeme-b').set({ libraryEpoch: 3 });

    const result = await clearLibraryCardsPageForOwner(database, ownerId, {
      expectedOwnerId: ownerId, libraryEpoch: 3, cardIds: ['old-a', 'old-b'],
    });
    expect(result).toEqual({ deletedCardIds: ['old-a', 'old-b'], deletedProjectionLexemeIds: ['lexeme-a'] });
    const [oldA, oldB, removedProjection, recreatedProjection] = await Promise.all([
      owner.collection('cards').doc('old-a').get(),
      owner.collection('cards').doc('old-b').get(),
      owner.collection('catalog_progress').doc('lexeme-a').get(),
      owner.collection('catalog_progress').doc('lexeme-b').get(),
    ]);
    expect(oldA.exists).toBe(false);
    expect(oldB.exists).toBe(false);
    expect(removedProjection.exists).toBe(false);
    expect(recreatedProjection.data()).toMatchObject({ libraryEpoch: 3 });
  });
});
