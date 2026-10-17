import { randomUUID } from 'node:crypto';
import { deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { canonicalCard, createCardForOwner } from '../src/cardPersistence.js';
import {
  applyLibraryFacetMutation,
  libraryFacetRestoreOperationId,
  libraryFacetV2OperationId,
} from '../src/libraryFacetPersistence.js';

const describeWithEmulator = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;
const DATABASE_ID = 'ai-studio-945b4052-4462-4668-8936-277f09f07a37';

describeWithEmulator('Firestore library facet receipts', () => {
  let app: App;
  let database: Firestore;

  beforeAll(() => {
    app = initializeApp({ projectId: 'demo-lingoflash' }, 'library-facet-receipts-integration');
    database = getFirestore(app, DATABASE_ID);
  });

  afterAll(async () => {
    await database.terminate();
    await deleteApp(app);
  });

  it('commits a concurrent operation once and replays its original result', async () => {
    const ownerId = `facet-receipt-${randomUUID()}`;
    const operationCreatedAt = new Date().toISOString();
    const request = {
      op: 'delta' as const,
      ownerId,
      opId: libraryFacetV2OperationId(Date.parse(operationCreatedAt), randomUUID().replaceAll('-', '')),
      operationCreatedAt,
      delta: { IELTS: 1 },
    };
    const results = await Promise.all([
      applyLibraryFacetMutation(database, ownerId, request),
      applyLibraryFacetMutation(database, ownerId, request),
    ]);

    expect(results).toEqual([{ categories: { IELTS: 1 }, complete: false }, { categories: { IELTS: 1 }, complete: false }]);
    const owner = database.collection('users').doc(ownerId);
    expect((await owner.collection('profile').doc('library_facets').get()).data()).toMatchObject({
      categories: { IELTS: 1 }, complete: false,
    });
    expect((await owner.collection('library_facet_receipts').doc(request.opId).get()).data()).toMatchObject({
      fingerprint: expect.any(String), result: { categories: { IELTS: 1 }, complete: false },
    });
  });

  it('creates a restored card and increments its canonical category facet exactly once', async () => {
    const ownerId = `facet-restore-${randomUUID()}`;
    const owner = database.collection('users').doc(ownerId);
    const operationCreatedAt = new Date().toISOString();
    const opId = `restore-${randomUUID()}`;
    const deletedAt = new Date(Date.parse(operationCreatedAt) - 60_000).toISOString();
    const originalCreatedAt = new Date(Date.parse(deletedAt) - 60_000).toISOString();
    await owner.collection('profile').doc('library_state').set({ libraryEpoch: 0 });
    await owner.collection('profile').doc('resource_usage').set({ schemaVersion: 1, cardCount: 0 });
    await owner.collection('profile').doc('library_facets').set({
      categories: { Basics: 2 }, complete: true, version: 1, updatedAt: operationCreatedAt,
    });

    const card = {
      id: 'untrusted-id',
      word: 'Restore sample',
      normalizedWord: 'restore sample',
      translation: 'mẫu khôi phục',
      explanation: 'A test restore.',
      explanationTranslation: 'Bản khôi phục thử nghiệm.',
      phonetic: '/test/',
      category: 'Basics',
      emoji: '📝',
      audioUrl: null,
      imageUrl: null,
      imageSearchQuery: '',
      bookmarked: false,
      difficulty: 'unrated',
      customDeck: null,
      reviews: 0,
      interval: 0,
      easeFactor: 2.5,
      correctStreak: 0,
      partOfSpeech: 'noun',
      cefrLevel: 'A1',
      exampleSentence: 'A restore sample.',
      exampleTranslation: 'Một mẫu khôi phục.',
      collocations: [],
      synonyms: [],
      antonyms: [],
      register: '',
      commonMistake: '',
      reviewHistory: [],
      createdAt: originalCreatedAt,
    };
    const canonical = canonicalCard(card);
    await owner.collection('card_tombstones').doc(String(canonical.id)).set({
      cardId: canonical.id,
      opId: `delete-${randomUUID()}`,
      libraryEpoch: 0,
      revision: 1,
      deletedAt,
    });
    const options = {
      maximumCards: 5,
      libraryEpoch: 0,
      baseRevision: 0,
      opId,
      operationCreatedAt,
      restore: true as const,
    };

    await expect(createCardForOwner(database, ownerId, card, options))
      .resolves.toMatchObject({ created: true, restored: true });
    await expect(createCardForOwner(database, ownerId, card, options))
      .resolves.toMatchObject({ created: false });

    expect((await owner.collection('profile').doc('library_facets').get()).data()).toMatchObject({
      categories: { Basics: 3 }, complete: true, version: 1,
    });
    const facetOperationId = libraryFacetRestoreOperationId(opId, operationCreatedAt);
    expect((await owner.collection('library_facet_receipts').doc(facetOperationId).get()).data()).toMatchObject({
      opId: facetOperationId,
      result: { categories: { Basics: 3 }, complete: true },
    });
  });
});
