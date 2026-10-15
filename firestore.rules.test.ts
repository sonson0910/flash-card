import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestContext,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { collection, deleteDoc, deleteField, doc, getDoc, getDocs, query, serverTimestamp, setDoc, Timestamp, updateDoc, where, writeBatch, type Firestore } from 'firebase/firestore';
import { readFile } from 'node:fs/promises';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  createCardIdentityReservationId,
  createWordCardId,
  normalizeCardWord,
} from './src/lib/cardIdentity';
import { normalizeCardData } from './src/lib/cardNormalization';
import { createLexemeId } from './src/features/multilingual/lexemeIdentity';
import { createOwnerDeckMutationFirebaseAdapter } from './src/features/librarySession/ownerLibrarySessionFirebaseAdapter';
import { customDeckCoverKey } from './src/features/library/customDecks';

const PROJECT_ID = 'demo-lingoflash';

const legacyCard = (id = 'card-1') => ({
  id,
  word: 'hello',
  translation: 'xin chào',
});

const validCard = (id = 'card-1') => ({
  ...legacyCard(id),
  normalizedWord: 'hello',
  schemaVersion: 2,
  revision: 1,
  libraryEpoch: 0,
});

const reservedCardBatch = (
  database: ReturnType<RulesTestContext['firestore']>,
  userId: string,
  documentId: string,
  card: Record<string, unknown>,
) => {
  const normalizedWord = normalizeCardWord(card.normalizedWord)
    || normalizeCardWord(card.word);
  const cardData = card.normalizedWord === undefined
    ? { ...card, normalizedWord }
    : card;
  const batch = writeBatch(database);
  batch.set(doc(
    database,
    'users',
    userId,
    'card_reservations',
    createCardIdentityReservationId(normalizedWord),
  ), {
    schemaVersion: 1,
    cardId: documentId,
    normalizedWord,
  });
  batch.set(doc(database, 'users', userId, 'cards', documentId), cardData);
  return batch;
};

const writeReservedCard = (
  database: ReturnType<RulesTestContext['firestore']>,
  userId: string,
  documentId: string,
  card: Record<string, unknown>,
): Promise<void> => reservedCardBatch(database, userId, documentId, card).commit();

const seedReservedCard = (
  testEnvironment: RulesTestEnvironment,
  userId: string,
  documentId: string,
  card: Record<string, unknown>,
): Promise<void> => testEnvironment.withSecurityRulesDisabled(async context => {
  await reservedCardBatch(context.firestore(), userId, documentId, card).commit();
});

const seedCurrentCard = (
  testEnvironment: RulesTestEnvironment,
  userId: string,
  documentId: string,
  card: Record<string, unknown>,
): Promise<void> => testEnvironment.withSecurityRulesDisabled(async context => {
  const database = context.firestore();
  await setDoc(doc(database, `users/${userId}/profile/library_state`), {
    schemaVersion: 2,
    libraryEpoch: 0,
  });
  await reservedCardBatch(database, userId, documentId, card).commit();
});

const validSharedCard = (id = 'card-1'): ReturnType<typeof legacyCard> & {
  audioUrl: string | null;
  imageUrl: string | null;
} => ({
  ...legacyCard(id),
  audioUrl: null,
  imageUrl: null,
});

const validLearningStateV3 = (ownerId = 'owner', lexemeId = 'lexeme-1') => ({
  schemaVersion: 3,
  ownerId,
  lexemeId,
  bookmarked: true,
  difficulty: 'good',
  customCollections: ['daily-review'],
  nextReviewDate: '2026-08-04T00:00:00.000Z',
  reviews: 4,
  interval: 3,
  easeFactor: 2.5,
  fsrs: {
    due: '2026-08-04T00:00:00.000Z',
    stability: 2.5,
    difficulty: 4,
    elapsedDays: 2,
    scheduledDays: 3,
    learningSteps: 1,
    reps: 4,
    lapses: 1,
    state: 2,
    lastReview: '2026-08-01T00:00:00.000Z',
  },
  reviewHistory: [{
    rating: 'good',
    reviewedAt: '2026-08-01T00:00:00.000Z',
    scheduledDays: 3,
    elapsedDays: 2,
  }],
  correctStreak: 3,
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
  lastActivityAt: '2026-08-01T00:00:00.000Z',
  mastery: 0.75,
  revision: 4,
  libraryEpoch: 1,
  legacyCardId: 'legacy-card-1',
  legacySchemaVersion: 2,
});

describe('Firestore security rules', () => {
  let testEnvironment: RulesTestEnvironment;

  beforeAll(async () => {
    const rules = await readFile(new URL('./firestore.rules', import.meta.url), 'utf8');
    testEnvironment = await initializeTestEnvironment({
      projectId: PROJECT_ID,
      firestore: { rules },
    });
  });

  afterEach(async () => {
    await testEnvironment.clearFirestore();
  });

  afterAll(async () => {
    await testEnvironment?.cleanup();
  });

  it('keeps private cards inaccessible to signed-out users and other accounts', async () => {
    const intruder = testEnvironment.authenticatedContext('intruder').firestore();
    const signedOut = testEnvironment.unauthenticatedContext().firestore();
    await seedReservedCard(testEnvironment, 'owner', 'card-1', validCard());
    await assertFails(getDoc(doc(intruder, 'users/owner/cards/card-1')));
    await assertFails(getDoc(doc(signedOut, 'users/owner/cards/card-1')));
  });

  it('allows only the owner to read catalog progress and denies every client mutation', async () => {
    await testEnvironment.withSecurityRulesDisabled(async context => {
      await setDoc(doc(context.firestore(), 'users/owner/catalog_progress/lexeme-lead'), {
        schemaVersion: 1,
        ownerId: 'owner',
        lexemeId: 'lexeme-lead',
        targetLanguage: 'en',
        status: 'active',
        cardRevision: 1,
        libraryEpoch: 0,
        updatedAt: '2026-09-28T00:00:00.000Z',
      });
    });
    const owner = testEnvironment.authenticatedContext('owner').firestore();
    const intruder = testEnvironment.authenticatedContext('intruder').firestore();
    const ownerRef = doc(owner, 'users/owner/catalog_progress/lexeme-lead');

    await assertSucceeds(getDoc(ownerRef));
    await assertFails(getDoc(doc(intruder, 'users/owner/catalog_progress/lexeme-lead')));
    await assertFails(updateDoc(ownerRef, { status: 'mastered' }));
    await assertFails(deleteDoc(ownerRef));
    await assertFails(setDoc(doc(owner, 'users/owner/catalog_progress/lexeme-new'), {
      schemaVersion: 1, ownerId: 'owner', lexemeId: 'lexeme-new', targetLanguage: 'en',
      status: 'active', cardRevision: 1, libraryEpoch: 0,
    }));
  });

  it('keeps reminder delivery state private and server-owned', async () => {
    await testEnvironment.withSecurityRulesDisabled(async context => {
      const database = context.firestore();
      await setDoc(doc(database, 'users/owner/reminderState/current'), { channels: { push: true } });
      await setDoc(doc(database, 'users/owner/pushTokens/device'), { token: 'private-token' });
      await setDoc(doc(database, 'users/owner/pushTokenSessionCutoffs/device'), { authTimeSeconds: 123 });
      await setDoc(doc(database, 'pushTokenOwners/device'), { ownerId: 'owner' });
      await setDoc(doc(database, 'users/owner/reminderReceipts/2026-10-04_push'), { channel: 'push' });
      await setDoc(doc(database, 'mail/owner_2026-10-04_emailDigest'), { ownerId: 'owner', to: ['private@example.test'] });
    });
    const owner = testEnvironment.authenticatedContext('owner').firestore();
    const intruder = testEnvironment.authenticatedContext('intruder').firestore();
    const state = doc(owner, 'users/owner/reminderState/current');
    await assertSucceeds(getDoc(state));
    await assertFails(getDoc(doc(intruder, state.path)));
    await assertFails(getDocs(collection(owner, 'users/owner/reminderState')));
    await assertFails(updateDoc(state, { timezone: 'UTC' }));
    await assertFails(getDoc(doc(owner, 'users/owner/pushTokens/device')));
    await assertFails(getDoc(doc(owner, 'users/owner/pushTokenSessionCutoffs/device')));
    await assertFails(getDoc(doc(owner, 'users/owner/reminderReceipts/2026-10-04_push')));
    await assertFails(setDoc(doc(owner, 'users/owner/pushTokens/other'), { token: 'unsafe' }));
    await assertFails(getDoc(doc(owner, 'pushTokenOwners/device')));
    await assertFails(setDoc(doc(owner, 'pushTokenOwners/other'), { ownerId: 'owner' }));
    await assertFails(getDoc(doc(owner, 'mail/owner_2026-10-04_emailDigest')));
    await assertFails(setDoc(doc(owner, 'mail/unsafe'), { to: ['other@example.test'] }));
  });

  it('blocks direct owner mutations while the merged migration fence field is active', async () => {
    await seedCurrentCard(testEnvironment, 'owner', 'card-1', validCard());
    await testEnvironment.withSecurityRulesDisabled(async context => {
      // The fence now lives on profile/library_state itself (folded in
      // alongside libraryEpoch) rather than on a standalone
      // profile/library_migration_fence document, so a card update rule
      // evaluation only pays for one dependent-document read instead of two.
      await setDoc(doc(context.firestore(), 'users/owner/profile/library_state'), {
        schemaVersion: 2,
        libraryEpoch: 0,
        libraryMigrationFenceActive: true,
      }, { merge: true });
    });
    const owner = testEnvironment.authenticatedContext('owner').firestore();
    await assertFails(updateDoc(doc(owner, 'users/owner/cards/card-1'), { word: 'blocked' }));
    await assertFails(setDoc(doc(owner, 'users/owner/profile/library_state'), {
      schemaVersion: 2,
      libraryEpoch: 1,
    }));
    await assertFails(setDoc(doc(owner, 'users/owner/profile/custom_decks'), { decks: ['blocked'] }));
    await assertFails(setDoc(doc(owner, 'users/owner/profile/query_migration'), {
      migrationVersion: 2,
      lastDocumentId: null,
      complete: false,
      scanned: 0,
      updatedAt: '2026-08-24T00:00:00.000Z',
    }));
  });

  it('no longer honors the legacy standalone fence document from Rules', async () => {
    // The migration engine (functions/src/legacyLibraryMigrationFirestore.ts)
    // still writes this document for its own lease/resume bookkeeping, but
    // Rules now only read the merged field on profile/library_state. Seeding
    // only the legacy document must not block a direct owner write, or the
    // update/delete hot paths would silently regress back to two dependent
    // reads because of an OR against this second document path.
    await seedCurrentCard(testEnvironment, 'owner', 'card-1', validCard());
    await testEnvironment.withSecurityRulesDisabled(async context => {
      await setDoc(doc(context.firestore(), 'users/owner/profile/library_migration_fence'), {
        schemaVersion: 1,
        active: true,
      });
    });
    const owner = testEnvironment.authenticatedContext('owner').firestore();
    await assertSucceeds(updateDoc(doc(owner, 'users/owner/cards/card-1'), {
      translation: 'not blocked',
      revision: 2,
    }));
  });

  it('keeps the mastery timestamp owned by the review callable', async () => {
    const owner = testEnvironment.authenticatedContext('owner').firestore();
    const cardRef = doc(owner, 'users/owner/cards/card-1');
    await seedCurrentCard(testEnvironment, 'owner', 'card-1', {
      ...validCard(),
      masteredAt: '2026-09-27T12:00:00.000Z',
    });

    await assertFails(updateDoc(cardRef, { masteredAt: '2026-09-28T12:00:00.000Z', revision: 2 }));
    await assertFails(updateDoc(cardRef, { masteredAt: deleteField(), revision: 2 }));
    await assertSucceeds(updateDoc(cardRef, { translation: 'đã học', revision: 2 }));

    await seedCurrentCard(testEnvironment, 'owner', 'card-2', validCard('card-2'));
    await assertFails(updateDoc(doc(owner, 'users/owner/cards/card-2'), {
      masteredAt: '2026-09-28T12:00:00.000Z',
      revision: 2,
    }));
  });

  it('keeps Japanese pitch provenance owned by trusted card writes', async () => {
    const owner = testEnvironment.authenticatedContext('owner').firestore();
    const cardRef = doc(owner, 'users/owner/cards/card-1');
    const pitch = {
      readingKana: 'にっぽん', moraCount: 4, downstep: 3,
      source: {
        dataset: 'unidic-kana-accent', version: '2.1.2',
        archiveSha256: '70793cacda81b403eda71736cc180f3144303623755a612b13e1dffeb6554591',
        row: '503828|日本|ニッポン|3|*|*',
      },
    };
    await seedCurrentCard(testEnvironment, 'owner', 'card-1', { ...validCard(), japanesePitchAccent: pitch });

    await assertFails(updateDoc(cardRef, { japanesePitchAccent: { ...pitch, downstep: 0 }, revision: 2 }));
    await assertFails(updateDoc(cardRef, { japanesePitchAccent: deleteField(), revision: 2 }));
    await assertSucceeds(updateDoc(cardRef, { translation: 'Nhật Bản', revision: 2 }));
    await assertSucceeds(updateDoc(cardRef, { phonetic: 'にほん', revision: 3 }));
  });

  it('keeps epoch conflict enforcement working once the merged fence field clears', async () => {
    await seedCurrentCard(testEnvironment, 'owner', 'epoch-after-fence', validCard('epoch-after-fence'));
    await testEnvironment.withSecurityRulesDisabled(async context => {
      await setDoc(doc(context.firestore(), 'users/owner/profile/library_state'), {
        schemaVersion: 2,
        libraryEpoch: 0,
        libraryMigrationFenceActive: true,
      }, { merge: true });
    });
    const owner = testEnvironment.authenticatedContext('owner').firestore();
    await assertFails(updateDoc(doc(owner, 'users/owner/cards/epoch-after-fence'), {
      revision: 2,
      translation: 'blocked while fenced',
    }));
    // Clearing the field the way the migration engine does (a field-level
    // merge, never a whole-document replace) must restore normal epoch
    // enforcement without disturbing libraryEpoch.
    await testEnvironment.withSecurityRulesDisabled(async context => {
      await setDoc(doc(context.firestore(), 'users/owner/profile/library_state'), {
        libraryMigrationFenceActive: deleteField(),
      }, { merge: true });
    });
    await assertSucceeds(updateDoc(doc(owner, 'users/owner/cards/epoch-after-fence'), {
      revision: 2,
      translation: 'allowed after fence clears',
    }));
    await assertFails(writeReservedCard(owner, 'owner', 'future-epoch-after-fence', {
      ...validCard('future-epoch-after-fence'),
      schemaVersion: 2,
      revision: 1,
      libraryEpoch: 1,
    }));
  });

  it('never lets a client introduce or change the merged fence field itself', async () => {
    const owner = testEnvironment.authenticatedContext('owner').firestore();
    await assertFails(setDoc(doc(owner, 'users/owner/profile/library_state'), {
      schemaVersion: 2,
      libraryEpoch: 0,
      libraryMigrationFenceActive: true,
    }));
    await assertSucceeds(setDoc(doc(owner, 'users/owner/profile/library_state'), {
      schemaVersion: 2,
      libraryEpoch: 0,
    }));
    await assertFails(updateDoc(doc(owner, 'users/owner/profile/library_state'), {
      libraryEpoch: 1,
      libraryMigrationFenceActive: true,
    }));
    await assertSucceeds(updateDoc(doc(owner, 'users/owner/profile/library_state'), {
      libraryEpoch: 1,
    }));
  });

  it('requires the document id and card id to match', async () => {
    const owner = testEnvironment.authenticatedContext('owner').firestore();

    await assertFails(
      writeReservedCard(owner, 'owner', 'card-1', validCard('different-id')),
    );
  });

  it('requires a matching reservation in the same atomic card create', async () => {
    const owner = testEnvironment.authenticatedContext('owner').firestore();
    const id = createWordCardId('chance');
    const card = {
      ...validCard(id),
      word: 'chance',
      normalizedWord: 'chance',
    };

    await assertFails(setDoc(doc(owner, `users/owner/cards/${id}`), card));
    await assertFails(setDoc(doc(
      owner,
      `users/owner/card_reservations/${createCardIdentityReservationId('chance')}`,
    ), {
      schemaVersion: 1,
      cardId: id,
      normalizedWord: 'chance',
    }));

    const batch = writeBatch(owner);
    batch.set(doc(
      owner,
      `users/owner/card_reservations/${createCardIdentityReservationId('chance')}`,
    ), {
      schemaVersion: 1,
      cardId: id,
      normalizedWord: 'chance',
    });
    batch.set(doc(owner, `users/owner/cards/${id}`), card);
    await assertFails(batch.commit());
  });

  it('accepts the full normalized card payload emitted by the application', async () => {
    const id = createWordCardId('magnitude');
    const normalized = normalizeCardData({
      id,
      word: 'Magnitude',
      normalizedWord: 'magnitude',
      translation: 'độ lớn',
      explanation: 'The great size, extent, or importance of something.',
      explanationTranslation: 'Kích thước, phạm vi hoặc tầm quan trọng lớn của một điều gì đó.',
      phonetic: '/ˈmæɡ.nɪ.tʃuːd/',
      emoji: '📏',
      category: 'Science',
      audioUrl: null,
      imageUrl: 'https://images.pexels.com/photos/2150/sky-space-dark-galaxy.jpg',
      imageSearchQuery: 'astronomical magnitude scale',
      createdAt: '2026-08-11T00:00:00.000Z',
      bookmarked: true,
      difficulty: 'good',
      reviews: 3,
      interval: 4,
      easeFactor: 2.4,
      correctStreak: 2,
      partOfSpeech: 'noun',
      cefrLevel: 'C1',
      exampleSentence: 'The magnitude of the discovery surprised the researchers.',
      exampleTranslation: 'Tầm vóc của khám phá khiến các nhà nghiên cứu ngạc nhiên.',
      collocations: ['great magnitude', 'order of magnitude', 'absolute magnitude', 'apparent magnitude'],
      synonyms: ['size', 'extent', 'importance', 'scale'],
      antonyms: ['smallness', 'insignificance', 'triviality'],
      register: 'formal',
      commonMistake: 'Do not confuse magnitude with magnification.',
      schemaVersion: 2,
      revision: 1,
      libraryEpoch: 0,
    }, id);
    const card = Object.fromEntries(
      Object.entries(normalized).filter(([, value]) => value !== undefined),
    );

    await seedReservedCard(testEnvironment, 'owner', id, {
      ...card,
      updatedAt: Timestamp.fromDate(new Date('2026-08-11T00:01:00.000Z')),
    });
  });

  it('retains media and list boundaries for full normalized card payloads', async () => {
    const owner = testEnvironment.authenticatedContext('owner').firestore();
    const id = createWordCardId('canonical-boundaries');
    const cardRef = doc(owner, `users/owner/cards/${id}`);
    const normalized = normalizeCardData({
      id,
      word: 'canonical-boundaries',
      normalizedWord: 'canonical-boundaries',
      translation: 'boundaries',
      createdAt: '2026-08-11T00:00:00.000Z',
      schemaVersion: 2,
      revision: 1,
      libraryEpoch: 0,
    }, id);
    const card = Object.fromEntries(
      Object.entries(normalized).filter(([, value]) => value !== undefined),
    );

    await seedCurrentCard(testEnvironment, 'owner', id, card);
    await assertFails(updateDoc(cardRef, {
      imageUrl: 'https://attacker.example/image.jpg',
      revision: 2,
    }));
    await assertFails(updateDoc(cardRef, {
      collocations: ['safe phrase', { unsafe: true }],
      revision: 2,
    }));
  });

  it('updates trusted canonical cards without requiring a duplicate public lexeme', async () => {
    const owner = testEnvironment.authenticatedContext('canonical-owner').firestore();
    const identity = {
      language: 'en',
      normalizedLemma: 'break the news',
      partOfSpeech: 'phrase',
      senseKey: 'share-bad-news',
    };
    const id = createLexemeId(identity);
    const cardRef = doc(owner, `users/canonical-owner/cards/${id}`);

    await seedReservedCard(testEnvironment, 'canonical-owner', id, {
      ...validCard(id),
      id,
      word: identity.normalizedLemma,
      normalizedWord: identity.normalizedLemma,
      ...identity,
      lexemeId: id,
      imageUrl: null,
      imageSearchQuery: '',
    });

    await assertSucceeds(updateDoc(cardRef, {
      imageUrl: 'https://images.pexels.com/photos/123/example.jpeg',
      imageSearchQuery: 'breaking news',
      revision: 2,
      updatedAt: Timestamp.fromMillis(2),
    }));
    await assertFails(updateDoc(cardRef, {
      normalizedLemma: 'changed identity',
      revision: 3,
    }));
  });

  it('keeps canonical identity assignment server-only even for a published lexeme', async () => {
    const identity = {
      language: 'en',
      normalizedLemma: 'break the news',
      partOfSpeech: 'phrase',
      senseKey: 'share-bad-news',
    };
    const id = createLexemeId(identity);
    const owner = testEnvironment.authenticatedContext('canonical-adoption-owner').firestore();
    await seedReservedCard(testEnvironment, 'canonical-adoption-owner', id, {
      ...validCard(id),
      id,
      word: identity.normalizedLemma,
      normalizedWord: identity.normalizedLemma,
    });
    await testEnvironment.withSecurityRulesDisabled(async context => {
      const database = context.firestore();
      await setDoc(doc(database, `lexemes/${id}`), {
        schemaVersion: 3,
        id,
        ...identity,
        provenance: { editorialStatus: 'published' },
      });
    });

    const canonicalPatch = { ...identity, lexemeId: id, revision: 2 };
    await assertFails(updateDoc(
      doc(owner, `users/canonical-adoption-owner/cards/${id}`),
      canonicalPatch,
    ));
  });

  it('keeps review history and server review receipts callable-only', async () => {
    const owner = testEnvironment.authenticatedContext('review-owner').firestore();
    const cardId = 'review-owned-card';
    const cardRef = doc(owner, `users/review-owner/cards/${cardId}`);
    await seedCurrentCard(testEnvironment, 'review-owner', cardId, {
      ...validCard(cardId),
      revision: 3,
      libraryEpoch: 0,
      reviewHistory: [],
      appliedReviewOperationIds: [],
    });
    await assertFails(updateDoc(cardRef, {
      reviewHistory: [{
        rating: 'good',
        reviewedAt: '2026-08-24T00:00:00.000Z',
        scheduledDays: 1,
        elapsedDays: 0,
      }],
      revision: 4,
    }));
    await assertFails(updateDoc(cardRef, {
      appliedReviewOperationIds: ['review-1'],
      revision: 4,
    }));
    const serverOwnedReviewFields = {
      difficulty: 'good',
      nextReviewDate: '2026-08-25T00:00:00.000Z',
      reviews: 1,
      interval: 1,
      easeFactor: 2.5,
      correctStreak: 1,
      fsrs: {
        due: '2026-08-25T00:00:00.000Z',
        stability: 1,
        difficulty: 5,
        elapsedDays: 0,
        scheduledDays: 1,
        learningSteps: 0,
        reps: 1,
        lapses: 0,
        state: 2,
        lastReview: '2026-08-24T00:00:00.000Z',
      },
      reviewHistory: [{
        rating: 'good',
        reviewedAt: '2026-08-24T00:00:00.000Z',
        scheduledDays: 1,
        elapsedDays: 0,
      }],
      appliedReviewOperationIds: ['review-2'],
    } as const;
    for (const [field, value] of Object.entries(serverOwnedReviewFields)) {
      await assertFails(updateDoc(cardRef, { [field]: value, revision: 4 }));
    }
    await assertSucceeds(updateDoc(cardRef, { bookmarked: true, revision: 4 }));
  });

  it('bounds canonical descriptive strings and review-history entry shapes', async () => {
    const owner = testEnvironment.authenticatedContext('owner').firestore();
    const id = 'canonical-text-boundaries';
    const cardRef = doc(owner, `users/owner/cards/${id}`);
    const boundaryCard = Object.fromEntries(Object.entries({
      ...normalizeCardData({
        ...validCard(id),
        schemaVersion: 2 as const,
        explanation: 'e'.repeat(2_048),
        explanationTranslation: 't'.repeat(2_048),
        phonetic: 'p'.repeat(256),
        category: 'c'.repeat(128),
        emoji: 'e'.repeat(64),
        imageSearchQuery: 'i'.repeat(256),
        partOfSpeech: 's'.repeat(64),
        cefrLevel: 'C'.repeat(8),
        exampleSentence: 's'.repeat(2_048),
        exampleTranslation: 'v'.repeat(2_048),
        register: 'r'.repeat(64),
        commonMistake: 'm'.repeat(2_048),
      }, id),
      explanation: 'e'.repeat(2_048),
      explanationTranslation: 't'.repeat(2_048),
      phonetic: 'p'.repeat(256),
      category: 'c'.repeat(128),
      emoji: 'e'.repeat(64),
      imageSearchQuery: 'i'.repeat(256),
      partOfSpeech: 's'.repeat(64),
      cefrLevel: 'C'.repeat(8),
      exampleSentence: 's'.repeat(2_048),
      exampleTranslation: 'v'.repeat(2_048),
      register: 'r'.repeat(64),
      commonMistake: 'm'.repeat(2_048),
      reviewHistory: [{
        rating: 'good',
        reviewedAt: 'r'.repeat(128),
        scheduledDays: 9,
        elapsedDays: 8,
      }],
    }).filter(([, value]) => value !== undefined));

    await seedCurrentCard(testEnvironment, 'owner', id, boundaryCard);
    await assertSucceeds(updateDoc(cardRef, {
      explanation: 'e'.repeat(2_048),
      revision: 2,
    }));
    await assertFails(updateDoc(cardRef, {
      explanation: 'e'.repeat(2_049),
      revision: 3,
    }));
    await assertFails(updateDoc(cardRef, {
      reviewHistory: [{
        rating: 'good',
        reviewedAt: 'r'.repeat(129),
        scheduledDays: 9,
        elapsedDays: 8,
      }],
      revision: 3,
    }));
    await assertFails(updateDoc(cardRef, {
      reviewHistory: [{
        rating: 'good',
        reviewedAt: '2026-08-09T00:00:00.000Z',
        scheduledDays: 9,
        elapsedDays: 8,
        arbitrary: true,
      }],
      revision: 3,
    }));
  });

  it('rejects an attacker-controlled reservation path even when its payload matches the card', async () => {
    const owner = testEnvironment.authenticatedContext('owner').firestore();
    const attackerChosenId = 'attacker-chosen-card';
    const batch = writeBatch(owner);
    batch.set(doc(owner, `users/owner/card_reservations/${attackerChosenId}`), {
      schemaVersion: 1,
      cardId: attackerChosenId,
      normalizedWord: 'chance',
    });
    batch.set(doc(owner, `users/owner/cards/${attackerChosenId}`), {
      ...validCard(attackerChosenId),
      word: 'chance',
      normalizedWord: 'chance',
    });

    await assertFails(batch.commit());
  });

  it('blocks an arbitrary legacy id even when the canonical reservation exists', async () => {
    const owner = testEnvironment.authenticatedContext('owner').firestore();
    const canonicalId = createWordCardId('chance');
    await testEnvironment.withSecurityRulesDisabled(async context => {
      await setDoc(doc(
        context.firestore(),
        `users/owner/card_reservations/${createCardIdentityReservationId('chance')}`,
      ), {
        schemaVersion: 1,
        cardId: canonicalId,
        normalizedWord: 'chance',
      });
    });

    await assertFails(setDoc(doc(owner, 'users/owner/cards/legacy-random-id'), {
      ...validCard('legacy-random-id'),
      word: 'chance',
      normalizedWord: 'chance',
    }));
  });

  it('prevents two different card ids from claiming the same normalized word', async () => {
    const owner = testEnvironment.authenticatedContext('owner').firestore();
    const firstId = 'duplicate-chance-a';
    const secondId = 'duplicate-chance-b';

    await seedReservedCard(testEnvironment, 'owner', firstId, {
      ...validCard(firstId),
      word: 'Chance',
      normalizedWord: 'chance',
    });
    await assertFails(writeReservedCard(owner, 'owner', secondId, {
      ...validCard(secondId),
      word: ' chance ',
      normalizedWord: 'chance',
    }));
  });

  it('scopes the same normalized identity independently to each owner', async () => {
    const id = createWordCardId('chance');
    const card = {
      ...validCard(id),
      word: 'chance',
      normalizedWord: 'chance',
    };

    await seedReservedCard(testEnvironment, 'owner-a', id, card);
    await seedReservedCard(testEnvironment, 'owner-b', id, card);
  });

  it('keeps card reports inaccessible to direct client reads and writes', async () => {
    const owner = testEnvironment.authenticatedContext('report-owner').firestore();
    const report = doc(owner, 'card_reports/report-1');
    await assertFails(setDoc(report, {
      uid: 'report-owner',
      cardId: 'word-focus',
      reason: 'other',
      status: 'open',
    }));
    await assertFails(getDoc(report));
  });

  it('prevents a card update from changing its reserved normalized identity', async () => {
    const owner = testEnvironment.authenticatedContext('owner').firestore();
    const id = createWordCardId('chance');
    const cardRef = doc(owner, `users/owner/cards/${id}`);

    await seedReservedCard(testEnvironment, 'owner', id, {
      ...validCard(id),
      word: 'chance',
      normalizedWord: 'chance',
    });
    await assertFails(updateDoc(cardRef, {
      word: 'opportunity',
      normalizedWord: 'opportunity',
      revision: 2,
    }));
  });

  it('prevents an identified card update from changing its word while retaining the reservation identity', async () => {
    const owner = testEnvironment.authenticatedContext('owner').firestore();
    const id = createWordCardId('chance');
    const cardRef = doc(owner, `users/owner/cards/${id}`);

    await seedReservedCard(testEnvironment, 'owner', id, {
      ...validCard(id),
      word: 'chance',
      normalizedWord: 'chance',
    });
    await assertFails(updateDoc(cardRef, {
      word: 'opportunity',
      revision: 2,
    }));
  });

  it('prevents changing only the word casing and whitespace when the normalized identity remains valid', async () => {
    const owner = testEnvironment.authenticatedContext('owner').firestore();
    const id = createWordCardId('quite');
    const cardRef = doc(owner, `users/owner/cards/${id}`);

    await seedReservedCard(testEnvironment, 'owner', id, {
      ...validCard(id),
      word: 'Quite',
      normalizedWord: 'quite',
    });
    await assertFails(updateDoc(cardRef, {
      word: '  QUITE  ',
      normalizedWord: 'quite',
      revision: 2,
    }));
  });

  it('requires a same-transaction reservation when a legacy identity enters v2', async () => {
    const owner = testEnvironment.authenticatedContext('owner').firestore();
    const cardId = 'legacy-chance';
    const cardRef = doc(owner, `users/owner/cards/${cardId}`);
    await testEnvironment.withSecurityRulesDisabled(async context => {
      await setDoc(doc(context.firestore(), `users/owner/cards/${cardId}`), {
        ...legacyCard(cardId),
        word: 'chance',
      });
    });

    const protocolUpgrade = {
      normalizedWord: 'chance',
      schemaVersion: 2,
      revision: 1,
      libraryEpoch: 0,
    };
    await assertFails(updateDoc(cardRef, protocolUpgrade));

    const batch = writeBatch(owner);
    batch.set(doc(
      owner,
      `users/owner/card_reservations/${createCardIdentityReservationId('chance')}`,
    ), {
      schemaVersion: 1,
      cardId,
      normalizedWord: 'chance',
    });
    batch.update(cardRef, protocolUpgrade);
    await assertSucceeds(batch.commit());
  });

  it('allows only an existing-card identity repair to create its reservation', async () => {
    const owner = testEnvironment.authenticatedContext('repair-owner').firestore();
    const cardId = 'legacy-repair-card';
    const cardRef = doc(owner, `users/repair-owner/cards/${cardId}`);
    const reservationRef = doc(
      owner,
      `users/repair-owner/card_reservations/${createCardIdentityReservationId('quite')}`,
    );

    await testEnvironment.withSecurityRulesDisabled(async context => {
      await setDoc(doc(context.firestore(), `users/repair-owner/cards/${cardId}`), {
        ...legacyCard(cardId),
        word: 'Quite',
      });
    });

    const repair = writeBatch(owner);
    repair.set(reservationRef, {
      schemaVersion: 1,
      cardId,
      normalizedWord: 'quite',
    });
    repair.update(cardRef, {
      normalizedWord: 'quite',
      schemaVersion: 2,
      revision: 1,
      libraryEpoch: 0,
    });
    await assertSucceeds(repair.commit());

    const newAllocation = writeBatch(owner);
    newAllocation.set(doc(
      owner,
      `users/repair-owner/card_reservations/${createCardIdentityReservationId('other')}`,
    ), {
      schemaVersion: 1,
      cardId: 'new-card',
      normalizedWord: 'other',
    });
    newAllocation.set(doc(owner, 'users/repair-owner/cards/new-card'), {
      ...legacyCard('new-card'),
      word: 'other',
      normalizedWord: 'other',
      schemaVersion: 2,
      revision: 1,
      libraryEpoch: 0,
    });
    await assertFails(newAllocation.commit());
  });

  it('allows editing a legacy AI card while repairing its missing reservation', async () => {
    const owner = testEnvironment.authenticatedContext('legacy-ai-owner').firestore();
    const cardId = 'legacy-ai-card';
    const cardRef = doc(owner, `users/legacy-ai-owner/cards/${cardId}`);
    await testEnvironment.withSecurityRulesDisabled(async context => {
      await setDoc(doc(context.firestore(), `users/legacy-ai-owner/cards/${cardId}`), {
        id: cardId, word: 'lead', normalizedWord: 'lead', translation: 'chì',
        explanation: 'A metal.', explanationTranslation: 'Một kim loại.', phonetic: '/liːd/',
        emoji: '📚', category: 'Reading', audioUrl: null, imageUrl: null,
        origin: 'ai', createdAt: '2026-09-24T00:00:00.000Z', bookmarked: false,
        difficulty: 'unrated', customDeck: null, reviews: 0,
      });
    });

    const edit = writeBatch(owner);
    edit.set(doc(
      owner,
      `users/legacy-ai-owner/card_reservations/${createCardIdentityReservationId('lead')}`,
    ), {
      schemaVersion: 1,
      cardId,
      normalizedWord: 'lead',
    });
    edit.set(cardRef, {
      translation: 'dẫn đầu',
      schemaVersion: 2,
      revision: 1,
      libraryEpoch: 0,
      updatedAt: serverTimestamp(),
    }, { merge: true });
    await assertSucceeds(edit.commit());

    const mismatchedId = 'legacy-ai-mismatch';
    await testEnvironment.withSecurityRulesDisabled(async context => {
      await setDoc(doc(context.firestore(), `users/legacy-ai-owner/cards/${mismatchedId}`), {
        id: mismatchedId, word: 'mead', normalizedWord: 'meat', translation: 'rượu mật ong',
      });
    });
    const mismatchedClaim = writeBatch(owner);
    mismatchedClaim.set(doc(
      owner,
      `users/legacy-ai-owner/card_reservations/${createCardIdentityReservationId('mead')}`,
    ), {
      schemaVersion: 1,
      cardId: mismatchedId,
      normalizedWord: 'mead',
    });
    mismatchedClaim.set(doc(owner, `users/legacy-ai-owner/cards/${mismatchedId}`), {
      translation: 'đồ uống',
      schemaVersion: 2,
      revision: 1,
      libraryEpoch: 0,
    }, { merge: true });
    await assertFails(mismatchedClaim.commit());
  });

  it('allows the sparse migration v2 merge to initialize legacy difficulty', async () => {
    const owner = testEnvironment.authenticatedContext('sparse-owner').firestore();
    const cardId = 'legacy-sparse-patch';
    const normalizedWord = 'hello';
    const cardRef = doc(owner, `users/sparse-owner/cards/${cardId}`);
    const reservationRef = doc(
      owner,
      `users/sparse-owner/card_reservations/${createCardIdentityReservationId(normalizedWord)}`,
    );

    await testEnvironment.withSecurityRulesDisabled(async context => {
      await setDoc(doc(context.firestore(), `users/sparse-owner/cards/${cardId}`), {
        ...legacyCard(cardId),
        word: normalizedWord,
      });
    });

    const sparseUpgrade = writeBatch(owner);
    sparseUpgrade.set(reservationRef, {
      schemaVersion: 1,
      cardId,
      normalizedWord,
    });
    sparseUpgrade.update(cardRef, {
      normalizedWord,
      customDeck: null,
      difficulty: 'unrated',
      bookmarked: false,
      schemaVersion: 2,
      revision: 1,
      libraryEpoch: 0,
    });
    await assertSucceeds(sparseUpgrade.commit());
  });

  it('denies legacy difficulty initialization to hard or good', async () => {
    for (const [userId, difficulty] of [['sparse-hard', 'hard'], ['sparse-good', 'good']] as const) {
      const owner = testEnvironment.authenticatedContext(userId).firestore();
      const cardId = `legacy-${difficulty}`;
      const cardRef = doc(owner, `users/${userId}/cards/${cardId}`);
      const reservationRef = doc(
        owner,
        `users/${userId}/card_reservations/${createCardIdentityReservationId('hello')}`,
      );
      await testEnvironment.withSecurityRulesDisabled(async context => {
        await setDoc(doc(context.firestore(), `users/${userId}/cards/${cardId}`), {
          ...legacyCard(cardId),
          word: 'hello',
        });
      });
      const invalidUpgrade = writeBatch(owner);
      invalidUpgrade.set(reservationRef, {
        schemaVersion: 1,
        cardId,
        normalizedWord: 'hello',
      });
      invalidUpgrade.update(cardRef, {
        normalizedWord: 'hello',
        difficulty,
        schemaVersion: 2,
        revision: 1,
        libraryEpoch: 0,
      });
      await assertFails(invalidUpgrade.commit());
    }
  });

  it('denies changing an existing unrated difficulty to good', async () => {
    const owner = testEnvironment.authenticatedContext('existing-unrated').firestore();
    const cardId = 'existing-unrated-card';
    const cardRef = doc(owner, `users/existing-unrated/cards/${cardId}`);
    await seedReservedCard(testEnvironment, 'existing-unrated', cardId, {
      ...validCard(cardId),
      difficulty: 'unrated',
    });
    await assertFails(updateDoc(cardRef, {
      difficulty: 'good',
      revision: 2,
    }));
  });

  it('denies a current card from claiming a missing reservation', async () => {
    const owner = testEnvironment.authenticatedContext('current-card-owner').firestore();
    const cardId = createWordCardId('quite');
    const cardRef = doc(owner, `users/current-card-owner/cards/${cardId}`);
    const reservationRef = doc(
      owner,
      `users/current-card-owner/card_reservations/${createCardIdentityReservationId('quite')}`,
    );

    await testEnvironment.withSecurityRulesDisabled(async context => {
      await setDoc(doc(context.firestore(), `users/current-card-owner/cards/${cardId}`), {
        ...validCard(cardId),
        word: 'Quite',
        normalizedWord: 'quite',
      });
    });

    const claim = writeBatch(owner);
    claim.set(reservationRef, {
      schemaVersion: 1,
      cardId,
      normalizedWord: 'quite',
    });
    claim.update(cardRef, { revision: 2 });
    await assertFails(claim.commit());
  });

  it('rejects a legacy identity entry when normalizedWord does not match the stored word', async () => {
    const owner = testEnvironment.authenticatedContext('owner').firestore();
    const cardId = 'legacy-other';
    const cardRef = doc(owner, `users/owner/cards/${cardId}`);

    await testEnvironment.withSecurityRulesDisabled(async context => {
      await setDoc(doc(context.firestore(), `users/owner/cards/${cardId}`), {
        ...legacyCard(cardId),
        word: 'Other',
      });
    });

    const batch = writeBatch(owner);
    batch.set(doc(
      owner,
      `users/owner/card_reservations/${createCardIdentityReservationId('quite')}`,
    ), {
      schemaVersion: 1,
      cardId,
      normalizedWord: 'quite',
    });
    batch.update(cardRef, {
      normalizedWord: 'quite',
      schemaVersion: 2,
      revision: 1,
      libraryEpoch: 0,
    });

    await assertFails(batch.commit());
  });

  it('prevents changing a legacy word before a later identity claim', async () => {
    const owner = testEnvironment.authenticatedContext('owner').firestore();
    const cardId = 'legacy-staged-identity';
    const cardRef = doc(owner, `users/owner/cards/${cardId}`);

    await testEnvironment.withSecurityRulesDisabled(async context => {
      await setDoc(doc(context.firestore(), `users/owner/cards/${cardId}`), {
        ...legacyCard(cardId),
        word: 'Other',
      });
    });

    await assertFails(updateDoc(cardRef, {
      word: 'quite',
      schemaVersion: 2,
      revision: 1,
      libraryEpoch: 0,
    }));
  });

  it('keeps reservations immutable after a card is cleared', async () => {
    const owner = testEnvironment.authenticatedContext('owner').firestore();
    const id = createWordCardId('chance');
    const reservationId = createCardIdentityReservationId('chance');
    const reservationRef = doc(owner, `users/owner/card_reservations/${reservationId}`);
    const cardRef = doc(owner, `users/owner/cards/${id}`);
    const reservation = {
      schemaVersion: 1,
      cardId: id,
      normalizedWord: 'chance',
    };
    const card = {
      ...validCard(id),
      word: 'chance',
      normalizedWord: 'chance',
    };
    await testEnvironment.withSecurityRulesDisabled(async context => {
      await setDoc(
        doc(context.firestore(), `users/owner/card_reservations/${reservationId}`),
        reservation,
      );
    });

    await seedReservedCard(testEnvironment, 'owner', id, card);
    await testEnvironment.withSecurityRulesDisabled(async context => {
      await deleteDoc(doc(context.firestore(), `users/owner/cards/${id}`));
    });
    await assertFails(setDoc(cardRef, card));
    await assertFails(updateDoc(reservationRef, { normalizedWord: 'other' }));
    await assertFails(deleteDoc(reservationRef));
  });

  it('allows stable phrase, apostrophe, Unicode and multi-block card identities', async () => {
    for (const word of ['as soon as', "don't", 'café 学习', 'a'.repeat(256)]) {
      const id = createWordCardId(word);
      await seedReservedCard(testEnvironment, 'owner', id, {
        ...validCard(id),
        word,
        normalizedWord: normalizeCardWord(word),
      });
    }
  });

  it('rejects unsafe external images and oversized custom deck names', async () => {
    const owner = testEnvironment.authenticatedContext('owner').firestore();
    const imageId = 'unsafe-image';
    const imageRef = doc(owner, `users/owner/cards/${imageId}`);
    const deckId = 'oversized-deck';
    const deckRef = doc(owner, `users/owner/cards/${deckId}`);

    await seedCurrentCard(testEnvironment, 'owner', imageId, validCard(imageId));
    await seedCurrentCard(testEnvironment, 'owner', deckId, validCard(deckId));
    await assertFails(updateDoc(imageRef, {
      imageUrl: 'https://example.com/tracker.png',
      revision: 2,
    }));
    await assertFails(updateDoc(deckRef, {
      customDeck: 'a'.repeat(129),
      revision: 2,
    }));
  });

  it('rejects unknown card fields and invalid bounded-string list entries', async () => {
    const owner = testEnvironment.authenticatedContext('owner').firestore();
    const id = 'validation-boundaries';
    const cardRef = doc(owner, `users/owner/cards/${id}`);

    await seedCurrentCard(testEnvironment, 'owner', id, validCard(id));
    await assertFails(updateDoc(cardRef, {
      administrator: true,
      revision: 2,
    }));
    await assertFails(updateDoc(cardRef, {
      explanation: 'a'.repeat(2_049),
      revision: 2,
    }));
    for (const field of ['collocations', 'synonyms', 'antonyms'] as const) {
      await assertFails(updateDoc(cardRef, {
        [field]: ['valid entry', 42],
        revision: 2,
      }));
      await assertFails(updateDoc(cardRef, {
        [field]: ['a'.repeat(101)],
        revision: 2,
      }));
    }
  });

  it('accepts four 100-character vocabulary-list entries and rejects a fifth', async () => {
    const owner = testEnvironment.authenticatedContext('owner').firestore();
    const boundaryEntries = Array.from({ length: 4 }, (_, index) => (
      `${index}`.padEnd(100, 'a')
    ));
    const normalized = normalizeCardData({
      ...validCard('bounded-lists'),
      schemaVersion: 2,
      explanationTranslation: 'Canonical translated explanation.',
      imageSearchQuery: 'canonical vocabulary image',
      collocations: boundaryEntries,
      synonyms: boundaryEntries,
      antonyms: boundaryEntries,
    }, 'bounded-lists');
    const card = Object.fromEntries(
      Object.entries(normalized).filter(([, value]) => value !== undefined),
    );

    await seedCurrentCard(testEnvironment, 'owner', 'bounded-lists', {
      ...card,
    });
    const cardRef = doc(owner, 'users/owner/cards/bounded-lists');

    for (const field of ['collocations', 'synonyms', 'antonyms'] as const) {
      await assertFails(updateDoc(cardRef, {
        [field]: [...boundaryEntries, 'fifth'],
        revision: 2,
      }));
    }
  });

  it('requires every new card to use the current revision protocol', async () => {
    const owner = testEnvironment.authenticatedContext('owner').firestore();

    await assertFails(writeReservedCard(
      owner,
      'owner',
      'legacy-before-epoch',
      legacyCard('legacy-before-epoch'),
    ));
    await seedReservedCard(testEnvironment, 'owner', 'v2-epoch-zero', {
      ...validCard('v2-epoch-zero'),
      updatedAt: Timestamp.fromMillis(1),
    });
    await assertFails(writeReservedCard(owner, 'owner', 'future-epoch', {
      ...validCard('future-epoch'),
      schemaVersion: 2,
      revision: 1,
      libraryEpoch: 1,
    }));
  });

  it('requires v2 cards to match the current library epoch once state exists', async () => {
    const owner = testEnvironment.authenticatedContext('owner').firestore();
    await assertSucceeds(setDoc(doc(owner, 'users/owner/profile/library_state'), {
      schemaVersion: 2,
      libraryEpoch: 3,
    }));

    await assertFails(writeReservedCard(
      owner,
      'owner',
      'legacy-after-epoch',
      legacyCard('legacy-after-epoch'),
    ));
    await assertFails(writeReservedCard(owner, 'owner', 'stale-epoch', {
      ...validCard('stale-epoch'),
      schemaVersion: 2,
      revision: 1,
      libraryEpoch: 2,
    }));
    await seedReservedCard(testEnvironment, 'owner', 'current-epoch', {
      ...validCard('current-epoch'),
      schemaVersion: 2,
      revision: 1,
      libraryEpoch: 3,
    });
  });

  it('upgrades epoch-zero legacy cards without reviving them after an epoch advance', async () => {
    const epochZero = testEnvironment.authenticatedContext('epoch-zero').firestore();
    const epochAdvanced = testEnvironment.authenticatedContext('epoch-advanced').firestore();
    const epochZeroCard = doc(epochZero, 'users/epoch-zero/cards/legacy-upgrade');
    const epochAdvancedCard = doc(epochAdvanced, 'users/epoch-advanced/cards/legacy-upgrade');

    await testEnvironment.withSecurityRulesDisabled(async context => {
      await setDoc(
        doc(context.firestore(), 'users/epoch-zero/cards/legacy-upgrade'),
        { ...legacyCard('legacy-upgrade'), schemaVersion: 1 },
      );
    });
    await testEnvironment.withSecurityRulesDisabled(async context => {
      await setDoc(doc(context.firestore(), 'users/epoch-advanced/profile/library_state'), {
        schemaVersion: 2,
        libraryEpoch: 4,
      });
      await setDoc(
        doc(context.firestore(), 'users/epoch-advanced/cards/legacy-upgrade'),
        { ...legacyCard('legacy-upgrade'), schemaVersion: 1 },
      );
    });
    await assertSucceeds(updateDoc(epochZeroCard, {
      schemaVersion: 2,
      revision: 1,
      libraryEpoch: 0,
      updatedAt: Timestamp.fromMillis(2),
      bookmarked: true,
    }));
    await assertFails(updateDoc(epochAdvancedCard, {
      schemaVersion: 2,
      revision: 1,
      libraryEpoch: 4,
      updatedAt: Timestamp.fromMillis(2),
      bookmarked: true,
    }));
  });

  it('upgrades incomplete current-generation cards that retain an explicit libraryEpoch', async () => {
    const owner = testEnvironment.authenticatedContext('owner').firestore();
    const missingRevision = doc(owner, 'users/owner/cards/missing-revision');

    await testEnvironment.withSecurityRulesDisabled(async context => {
      const database = context.firestore();
      await setDoc(doc(database, 'users/owner/profile/library_state'), {
        schemaVersion: 2,
        libraryEpoch: 4,
      });
      await setDoc(doc(database, 'users/owner/cards/missing-revision'), {
        ...legacyCard('missing-revision'),
        schemaVersion: 2,
        libraryEpoch: 4,
      });
    });

    await assertSucceeds(updateDoc(missingRevision, {
      schemaVersion: 2,
      revision: 1,
      libraryEpoch: 4,
      translation: 'đã nâng cấp',
    }));
  });

  it('deletes incomplete protocol cards without missing-field rule errors', async () => {
    const owner = testEnvironment.authenticatedContext('owner').firestore();
    const missingRevision = doc(owner, 'users/owner/cards/delete-missing-revision');
    const missingEpoch = doc(owner, 'users/owner/cards/delete-missing-epoch');
    const tombstone = doc(owner, 'users/owner/card_tombstones/delete-missing-revision');

    await testEnvironment.withSecurityRulesDisabled(async context => {
      const database = context.firestore();
      await setDoc(doc(database, 'users/owner/profile/library_state'), {
        schemaVersion: 2,
        libraryEpoch: 4,
      });
      await setDoc(doc(database, 'users/owner/cards/delete-missing-revision'), {
        ...legacyCard('delete-missing-revision'),
        schemaVersion: 2,
        libraryEpoch: 4,
      });
      await setDoc(doc(database, 'users/owner/cards/delete-missing-epoch'), {
        ...legacyCard('delete-missing-epoch'),
        revision: 7,
      });
    });

    const currentGenerationDelete = writeBatch(owner);
    currentGenerationDelete.set(tombstone, {
      cardId: 'delete-missing-revision',
      opId: 'delete-incomplete-revision',
      libraryEpoch: 4,
      revision: 1,
      deletedAt: '2026-08-09T00:00:00.000Z',
    });
    currentGenerationDelete.delete(missingRevision);
    await assertSucceeds(currentGenerationDelete.commit());

    await assertSucceeds(deleteDoc(missingEpoch));
  });

  it('rejects a stale offline update after the library epoch advances', async () => {
    const owner = testEnvironment.authenticatedContext('owner').firestore();
    const state = doc(owner, 'users/owner/profile/library_state');
    const card = doc(owner, 'users/owner/cards/card-before-clear');
    await assertSucceeds(setDoc(state, { schemaVersion: 2, libraryEpoch: 4 }));
    await seedReservedCard(testEnvironment, 'owner', 'card-before-clear', {
      ...validCard('card-before-clear'),
      schemaVersion: 2,
      revision: 1,
      libraryEpoch: 4,
    });

    await assertSucceeds(setDoc(state, { schemaVersion: 2, libraryEpoch: 5 }));
    await assertFails(updateDoc(card, { translation: 'ghi stale' }));
    await assertFails(updateDoc(card, {
      libraryEpoch: 5,
      revision: 2,
      translation: 'ghi hiện hành',
    }));
    await assertSucceeds(deleteDoc(card));
  });

  it('allows editing AI cards but prevents changing or removing their origin', async () => {
    const owner = testEnvironment.authenticatedContext('ai-card-owner').firestore();
    const card = doc(owner, 'users/ai-card-owner/cards/ai-card');
    await seedReservedCard(testEnvironment, 'ai-card-owner', 'ai-card', {
      ...validCard('ai-card'),
      origin: 'ai',
    });

    await assertSucceeds(updateDoc(card, { bookmarked: true, revision: 2 }));
    await assertSucceeds(updateDoc(card, { translation: 'nghĩa đã sửa', revision: 3 }));
    await assertFails(updateDoc(card, { origin: 'manual', revision: 4 }));
    await assertFails(updateDoc(card, { origin: deleteField(), revision: 4 }));
  });

  it('denies a client from forging, editing, or removing captured-source metadata', async () => {
    const owner = testEnvironment.authenticatedContext('source-card-owner').firestore();
    const withoutSource = doc(owner, 'users/source-card-owner/cards/card-without-source');
    await seedReservedCard(testEnvironment, 'source-card-owner', 'card-without-source', validCard('card-without-source'));
    await assertFails(updateDoc(withoutSource, {
      source: { url: 'https://example.com/', title: 'Forged', context: 'forged', capturedAt: '2026-09-27T00:00:00.000Z' },
      revision: 2,
    }));
    await assertSucceeds(updateDoc(withoutSource, { bookmarked: true, revision: 2 }));

    const withSource = doc(owner, 'users/source-card-owner/cards/card-with-source');
    await seedReservedCard(testEnvironment, 'source-card-owner', 'card-with-source', {
      ...validCard('card-with-source'),
      source: { url: 'https://example.com/article', title: 'Example article', capturedAt: '2026-09-27T00:00:00.000Z' },
    });
    // An unrelated patch must still succeed even though the existing `source`
    // field stays present in the merged document (the field-guard allowlist
    // must include it, or every update to a sourced card would fail).
    await assertSucceeds(updateDoc(withSource, { bookmarked: true, revision: 2 }));
    await assertFails(updateDoc(withSource, {
      source: { url: 'https://example.com/different', title: 'Changed', capturedAt: '2026-09-27T00:00:00.000Z' },
      revision: 2,
    }));
    await assertFails(updateDoc(withSource, { source: deleteField(), revision: 2 }));
  });

  it('requires current-epoch updates to advance the revision exactly once', async () => {
    const owner = testEnvironment.authenticatedContext('owner').firestore();
    const card = doc(owner, 'users/owner/cards/revisioned-card');
    await seedReservedCard(
      testEnvironment,
      'owner',
      'revisioned-card',
      validCard('revisioned-card'),
    );

    await assertFails(updateDoc(card, { translation: 'không tăng revision' }));
    await assertFails(updateDoc(card, { translation: 'hạ revision', revision: 0 }));
    await assertFails(updateDoc(card, { translation: 'nhảy revision', revision: 3 }));
    await assertSucceeds(updateDoc(card, { translation: 'hợp lệ', revision: 2 }));
  });

  it('requires an atomic newer tombstone before deleting a current card', async () => {
    const owner = testEnvironment.authenticatedContext('owner').firestore();
    const card = doc(owner, 'users/owner/cards/card-with-barrier');
    const tombstone = doc(owner, 'users/owner/card_tombstones/card-with-barrier');
    await seedReservedCard(
      testEnvironment,
      'owner',
      'card-with-barrier',
      validCard('card-with-barrier'),
    );
    await assertFails(deleteDoc(card));

    const deletion = writeBatch(owner);
    deletion.set(tombstone, {
      cardId: 'card-with-barrier',
      opId: 'delete-card-with-barrier',
      libraryEpoch: 0,
      revision: 2,
      deletedAt: '2026-08-09T00:00:00.000Z',
    });
    deletion.delete(card);
    await assertSucceeds(deletion.commit());

    await assertFails(setDoc(card, validCard('card-with-barrier')));
    await assertFails(setDoc(card, {
      ...validCard('card-with-barrier'),
      revision: 3,
    }));
    await assertFails(deleteDoc(card));
  });

  it('keeps library epoch state monotonic and schema-locked', async () => {
    const owner = testEnvironment.authenticatedContext('owner').firestore();
    const state = doc(owner, 'users/owner/profile/library_state');

    await assertSucceeds(setDoc(state, { schemaVersion: 2, libraryEpoch: 7 }));
    await assertFails(setDoc(state, { schemaVersion: 2, libraryEpoch: 6 }));
    await assertFails(setDoc(state, {
      schemaVersion: 2,
      libraryEpoch: 8,
      arbitrary: true,
    }));
    await assertFails(deleteDoc(state));
  });

  it('denies unsupported profile document names even for the owner', async () => {
    const owner = testEnvironment.authenticatedContext('owner').firestore();
    const arbitrary = doc(owner, 'users/owner/profile/arbitrary');

    await assertFails(setDoc(arbitrary, { enabled: true }));
  });

  it('keeps supported profile documents on exact owner-scoped schemas', async () => {
    const owner = testEnvironment.authenticatedContext('owner').firestore();

    const decks = doc(owner, 'users/owner/profile/custom_decks');
    await assertSucceeds(setDoc(decks, { decks: ['IELTS'] }));
    await assertFails(setDoc(decks, { decks: ['IELTS'], administrator: true }));

    const facets = doc(owner, 'users/owner/profile/library_facets');
    await assertSucceeds(getDoc(facets));
    await assertFails(setDoc(facets, {
      categories: { IELTS: 2 },
      complete: true,
      version: 1,
      updatedAt: '2026-08-09T00:00:00.000Z',
    }));
    await assertFails(setDoc(facets, {
      categories: { IELTS: 2 },
      complete: true,
      version: 1,
      updatedAt: '2026-08-09T00:00:00.000Z',
      arbitrary: true,
    }));

    const facetReceipt = doc(owner, 'users/owner/library_facet_receipts/facet-op-1');
    await assertFails(getDoc(facetReceipt));
    await assertFails(setDoc(facetReceipt, {
      fingerprint: 'a'.repeat(64),
      result: { categories: {}, complete: true },
    }));

    const migration = doc(owner, 'users/owner/profile/query_migration');
    await assertSucceeds(setDoc(migration, {
      migrationVersion: 2,
      lastDocumentId: null,
      complete: false,
      scanned: 0,
      updatedAt: '2026-08-09T00:00:00.000Z',
    }));
    await assertFails(setDoc(migration, {
      migrationVersion: 2,
      lastDocumentId: null,
      complete: false,
      scanned: 0,
      updatedAt: '2026-08-09T00:00:00.000Z',
      arbitrary: true,
    }));

    const adminJob = doc(owner, 'users/owner/admin_library_migration_jobs/query-v3');
    await assertFails(getDoc(adminJob));
    await assertFails(setDoc(adminJob, { schemaVersion: 3, phase: 'discover' }));
    const group = doc(owner, 'users/owner/admin_library_migration_jobs/query-v3/groups/group');
    await assertFails(getDoc(group));
    await assertFails(setDoc(group, { schemaVersion: 3, sources: [] }));
  });

  it('validates every custom deck entry through the maximum profile size', async () => {
    const owner = testEnvironment.authenticatedContext('owner').firestore();
    const decks = doc(owner, 'users/owner/profile/custom_decks');
    const validDecks = Array.from({ length: 100 }, (_, index) => `Deck ${index}`.padEnd(128, 'x'));

    await assertSucceeds(setDoc(decks, { decks: validDecks }));
    await assertFails(setDoc(decks, { decks: validDecks.slice(0, 5).concat(42 as never) }));
    await assertFails(setDoc(decks, { decks: validDecks.concat('index-100') }));
    await assertFails(setDoc(decks, { decks: validDecks.slice(0, 5).concat('') }));
    await assertFails(setDoc(decks, { decks: ['valid', `embedded\u001fdelimiter`] }));
  });

  it('keeps old deck-only clients compatible while validating cover preset maps', async () => {
    const owner = testEnvironment.authenticatedContext('owner').firestore();
    const decks = doc(owner, 'users/owner/profile/custom_decks');
    await assertSucceeds(setDoc(decks, {
      decks: ['IELTS'],
      coverPresets: { d_SUVMVFM: 'violet' },
    }));
    await assertSucceeds(setDoc(decks, { decks: ['IELTS', 'Travel'] }, { merge: true }));
    await assertFails(setDoc(decks, {
      decks: ['IELTS'],
      coverPresets: { malformed: 'violet' },
    }));
    await assertFails(setDoc(decks, {
      decks: ['IELTS'],
      coverPresets: { d_SUVMVFM: 'unknown' },
    }));
  });

  it('allows a valid 1,000-entry legacy preset map and its pruned replacement', async () => {
    const owner = testEnvironment.authenticatedContext('owner').firestore();
    const decks = doc(owner, 'users/owner/profile/custom_decks');
    const stalePresets = Object.fromEntries(Array.from({ length: 1_000 }, (_, index) => [
      `d_${index.toString(36).padStart(2, 'a')}`,
      'aurora',
    ]));

    await assertSucceeds(setDoc(decks, { decks: ['IELTS'], coverPresets: stalePresets }));
    await assertSucceeds(setDoc(decks, {
      decks: ['IELTS', 'Travel'],
      coverPresets: { d_SUVMVFM: 'aurora', d_VHJhdmVs: 'moss' },
    }));
  });

  it('keeps concurrent deck creates and their covers through the profile transaction', async () => {
    const owner = testEnvironment.authenticatedContext('owner').firestore();
    const mutations = createOwnerDeckMutationFirebaseAdapter(owner as unknown as Firestore);
    const profile = doc(owner, 'users/owner/profile/custom_decks');

    await Promise.all([
      mutations.add('owner', 'Travel', 'violet'),
      mutations.add('owner', 'Work', 'moss'),
    ]);

    expect((await getDoc(profile)).data()).toEqual({
      decks: expect.arrayContaining(['Travel', 'Work']),
      coverPresets: expect.objectContaining({
        [customDeckCoverKey('Travel')]: 'violet',
        [customDeckCoverKey('Work')]: 'moss',
      }),
    });
  });

  it('prunes old-client orphan presets on recreate and deletes only the requested cover', async () => {
    const owner = testEnvironment.authenticatedContext('owner').firestore();
    const mutations = createOwnerDeckMutationFirebaseAdapter(owner as unknown as Firestore);
    const profile = doc(owner, 'users/owner/profile/custom_decks');
    const stalePresets = Object.fromEntries(Array.from({ length: 998 }, (_, index) => [
      `d_${index.toString(36).padStart(2, 'a')}`,
      'aurora',
    ]));
    await assertSucceeds(setDoc(profile, { decks: ['Travel', 'Work'], coverPresets: {
      ...stalePresets,
      [customDeckCoverKey('Travel')]: 'violet',
      [customDeckCoverKey('Work')]: 'moss',
    } }));
    await assertSucceeds(setDoc(profile, { decks: ['Work'] }, { merge: true }));

    await mutations.add('owner', 'Travel', 'amber');
    expect((await getDoc(profile)).data()).toEqual({
      decks: expect.arrayContaining(['Travel', 'Work']),
      coverPresets: {
        [customDeckCoverKey('Travel')]: 'amber',
        [customDeckCoverKey('Work')]: 'moss',
      },
    });

    await mutations.removeProfile('owner', 'Travel');
    expect((await getDoc(profile)).data()).toEqual({
      decks: ['Work'],
      coverPresets: { [customDeckCoverKey('Work')]: 'moss' },
    });
  });

  it('preserves a recreated cover when a concurrent create prunes its orphan', async () => {
    const owner = testEnvironment.authenticatedContext('owner').firestore();
    const mutations = createOwnerDeckMutationFirebaseAdapter(owner as unknown as Firestore);
    const profile = doc(owner, 'users/owner/profile/custom_decks');
    await assertSucceeds(setDoc(profile, {
      decks: ['Work'],
      coverPresets: {
        [customDeckCoverKey('Travel')]: 'violet',
        [customDeckCoverKey('Work')]: 'slate',
      },
    }));

    await Promise.all([
      mutations.add('owner', 'Travel', 'amber'),
      mutations.add('owner', 'Food', 'moss'),
    ]);

    expect((await getDoc(profile)).data()).toEqual({
      decks: expect.arrayContaining(['Work', 'Travel', 'Food']),
      coverPresets: {
        [customDeckCoverKey('Work')]: 'slate',
        [customDeckCoverKey('Travel')]: 'amber',
        [customDeckCoverKey('Food')]: 'moss',
      },
    });
  });

  it('accepts the maximum safe library counters but rejects overflow values', async () => {
    const owner = testEnvironment.authenticatedContext('owner').firestore();
    const state = doc(owner, 'users/owner/profile/library_state');
    const maxSafe = Number.MAX_SAFE_INTEGER;

    await assertSucceeds(setDoc(state, { schemaVersion: 2, libraryEpoch: maxSafe }));
    await assertFails(setDoc(state, { schemaVersion: 2, libraryEpoch: maxSafe + 1 }));

    await seedReservedCard(testEnvironment, 'owner', 'max-safe-card', {
      ...validCard('max-safe-card'),
      revision: maxSafe,
      libraryEpoch: maxSafe,
    });
    await assertFails(updateDoc(doc(owner, 'users/owner/cards/max-safe-card'), {
      translation: 'overflow',
      revision: maxSafe + 1,
    }));
  });

  it('keeps gamification documents owner-readable but server-write-only', async () => {
    const owner = testEnvironment.authenticatedContext('owner').firestore();
    const intruder = testEnvironment.authenticatedContext('intruder').firestore();
    const stats = doc(owner, 'users/owner/profile/stats');
    const validStats = {
      streak: 4,
      xp: 1250,
      lastActive: 'Sun Aug 09 2026',
      appliedXpOperationIds: ['device-a:operation-1'],
      xpStreamSchemaVersion: 2,
    };

    await assertFails(setDoc(stats, validStats));
    const stream = doc(owner, 'users/owner/xp_streams/device_a');
    await assertFails(setDoc(stream, {
      schemaVersion: 2,
      clientId: 'device_a',
      sequence: 14,
      retiredAt: null,
    }));
    await assertSucceeds(getDoc(stats));
    await assertSucceeds(getDoc(stream));
    await assertFails(setDoc(stats, {
      ...validStats,
      appliedXpOperationIds: Array.from({ length: 2_048 }, (_, index) => `operation-${index}`),
    }));
    await assertFails(setDoc(stats, {
      ...validStats,
      appliedXpOperationIds: ['o'.repeat(129)],
    }));
    await assertFails(getDoc(doc(intruder, 'users/owner/profile/stats')));
    await assertFails(setDoc(doc(intruder, 'users/owner/profile/stats'), validStats));
    await assertFails(setDoc(stats, { ...validStats, administrator: true }));
    await assertFails(setDoc(stats, { ...validStats, xp: 1.5 }));
    await assertFails(setDoc(stats, { ...validStats, streak: -1 }));
    await assertFails(setDoc(stats, {
      ...validStats,
      xpStreamSchemaVersion: 1,
    }));
    await assertFails(setDoc(stats, {
      ...validStats,
      appliedXpSequenceByClient: { device_a: 14 },
    }));
    await assertFails(setDoc(stats, {
      ...validStats,
      xpStreamSchemaVersion: 2.5,
    }));
    await assertFails(setDoc(stream, {
      schemaVersion: 2,
      clientId: 'device_a',
      sequence: 0,
      retiredAt: null,
    }));
    await assertFails(setDoc(stream, {
      schemaVersion: 2,
      clientId: 'bad client',
      sequence: 14,
      retiredAt: null,
    }));
    await assertFails(setDoc(doc(owner, 'users/owner/xp_streams/constructor'), {
      schemaVersion: 2,
      clientId: 'constructor',
      sequence: 1,
      retiredAt: null,
    }));
    await assertFails(setDoc(stream, {
      schemaVersion: 2,
      clientId: 'device_a',
      sequence: 14,
      retiredAt: 'not-a-date',
    }));
    await assertFails(setDoc(stream, {
      schemaVersion: 2,
      clientId: 'device_a',
      sequence: 13,
      retiredAt: null,
    }));
    await assertFails(setDoc(stream, {
      schemaVersion: 2,
      clientId: 'device_a',
      sequence: 14,
      retiredAt: '2026-08-10T00:00:00.000Z',
    }));
    await assertFails(setDoc(stream, {
      schemaVersion: 2,
      clientId: 'device_a',
      sequence: 15,
      retiredAt: null,
    }));
    await assertFails(setDoc(stream, {
      schemaVersion: 2,
      clientId: 'device_a',
      sequence: 15,
      retiredAt: '2026-08-11T00:00:00.000Z',
    }));
    await assertFails(setDoc(stream, {
      schemaVersion: 2,
      clientId: 'device_a',
      sequence: 15,
      retiredAt: '2026-08-10T00:00:00.000Z',
    }));
    await assertFails(setDoc(stats, {
      ...validStats,
      appliedXpOperationIds: Array.from({ length: 2049 }, (_, index) => `operation-${index}`),
    }));
    await assertFails(deleteDoc(stats));
    await assertFails(deleteDoc(stream));
  });

  it('keeps reward inventory owner-readable but server-write-only', async () => {
    await testEnvironment.withSecurityRulesDisabled(async context => {
      await setDoc(doc(context.firestore(), 'users/owner/profile/rewards'), {
        schemaVersion: 1,
        unlockedBadgeIds: ['web-wanderer'],
        ownedFrameIds: ['crimson-wing'],
        ownedTitleIds: ['word-collector'],
        equippedFrameId: 'crimson-wing',
        hintTokens: 1,
        streakFreezes: 1,
        receipts: { 'streak-30-v1': true, 'level-13-v1': true },
      });
    });
    const owner = testEnvironment.authenticatedContext('owner').firestore();
    const intruder = testEnvironment.authenticatedContext('intruder').firestore();
    const rewards = doc(owner, 'users/owner/profile/rewards');

    await assertSucceeds(getDoc(rewards));
    await assertFails(getDoc(doc(intruder, 'users/owner/profile/rewards')));
    await assertFails(setDoc(rewards, { schemaVersion: 1 }));
    await assertFails(updateDoc(rewards, { hintTokens: 2 }));
    await assertFails(deleteDoc(rewards));
  });

  it('keeps verified reward receipts and practice sessions callable-only', async () => {
    const owner = testEnvironment.authenticatedContext('owner').firestore();
    for (const path of [
      'users/owner/card_create_receipts/create-op-1',
      'users/owner/practice_sessions/session-1',
    ]) {
      const serverOnly = doc(owner, path);
      await assertFails(getDoc(serverOnly));
      await assertFails(setDoc(serverOnly, { forged: true }));
    }
  });

  it('lets only the owner get plan and usage while keeping AI counters server-only', async () => {
    await testEnvironment.withSecurityRulesDisabled(async context => {
      const admin = context.firestore();
      await setDoc(doc(admin, 'users/owner/profile/plan'), { tier: 'pro', entitlementId: 'test' });
      await setDoc(doc(admin, 'users/owner/ai_usage/free-2026-09'), { used: 1, limit: 30 });
    });
    const owner = testEnvironment.authenticatedContext('owner').firestore();
    const other = testEnvironment.authenticatedContext('other').firestore();
    for (const path of ['users/owner/profile/plan', 'users/owner/ai_usage/free-2026-09']) {
      await assertSucceeds(getDoc(doc(owner, path)));
      await assertFails(getDoc(doc(other, path)));
      await assertFails(setDoc(doc(owner, path), { used: 999 }));
    }
    await assertFails(getDoc(doc(owner, 'users/owner/ai_operations/operation')));
    await assertFails(setDoc(doc(owner, 'users/owner/ai_daily/2026-09-24'), { nonCardActions: 0 }));
    for (const path of [
      'users/owner/entitlements/grant', 'operator_audit/audit', 'analytics_events/intent',
    ]) {
      await assertFails(getDoc(doc(owner, path)));
      await assertFails(setDoc(doc(owner, path), { tier: 'pro', pid: 'forged' }));
    }
  });

  it('keeps gamification history owner-readable but server-write-only', async () => {
    const owner = testEnvironment.authenticatedContext('owner').firestore();
    const intruder = testEnvironment.authenticatedContext('intruder').firestore();
    const history = doc(owner, 'users/owner/profile/xp_history');
    const boundedHistory = Object.fromEntries(
      Array.from({ length: 730 }, (_, index) => [`day-${index}`, index]),
    );

    await assertFails(setDoc(history, boundedHistory));
    await assertSucceeds(getDoc(history));
    await assertFails(setDoc(history, {
      ['d'.repeat(64)]: Number.MAX_SAFE_INTEGER,
    }));
    await assertFails(setDoc(history, {
      ['d'.repeat(65)]: 1,
    }));
    await assertFails(setDoc(history, {
      malformed: 'not-a-counter',
    }));
    await assertFails(getDoc(doc(intruder, 'users/owner/profile/xp_history')));
    await assertFails(setDoc(doc(intruder, 'users/owner/profile/xp_history'), boundedHistory));
    await assertFails(setDoc(history, { ...boundedHistory, 'day-730': 730 }));
    await assertFails(deleteDoc(history));
  });

  it('allows only atomic current-epoch tombstones for a real owner card', async () => {
    const owner = testEnvironment.authenticatedContext('owner').firestore();
    const intruder = testEnvironment.authenticatedContext('intruder').firestore();
    await assertSucceeds(setDoc(
      doc(owner, 'users/owner/profile/library_state'),
      { schemaVersion: 2, libraryEpoch: 9 },
    ));
    const tombstone = doc(owner, 'users/owner/card_tombstones/card-1');
    const validTombstone = {
      cardId: 'card-1',
      opId: 'delete-op-1',
      libraryEpoch: 9,
      revision: 2,
      deletedAt: '2026-07-26T00:00:00.000Z',
    };

    await assertFails(setDoc(tombstone, validTombstone));
    await seedReservedCard(testEnvironment, 'owner', 'card-1', {
      ...validCard('card-1'),
      libraryEpoch: 9,
    });
    const deletion = writeBatch(owner);
    deletion.set(tombstone, validTombstone);
    deletion.delete(doc(owner, 'users/owner/cards/card-1'));
    await assertSucceeds(deletion.commit());
    await assertSucceeds(getDoc(tombstone));
    await assertFails(getDoc(doc(intruder, 'users/owner/card_tombstones/card-1')));
    await assertFails(getDocs(collection(owner, 'users/owner/card_tombstones')));
    await assertFails(setDoc(doc(owner, 'users/owner/card_tombstones/stale'), {
      ...validTombstone,
      cardId: 'stale',
      libraryEpoch: 8,
    }));
    await assertFails(updateDoc(tombstone, { revision: 2, opId: 'older-op' }));
    await assertSucceeds(setDoc(tombstone, validTombstone));
    await assertFails(deleteDoc(tombstone));
  });

  it('denies client deletion of a catalog card so its progress projection cannot be orphaned', async () => {
    const owner = testEnvironment.authenticatedContext('owner').firestore();
    await assertSucceeds(setDoc(
      doc(owner, 'users/owner/profile/library_state'),
      { schemaVersion: 2, libraryEpoch: 9 },
    ));
    await seedReservedCard(testEnvironment, 'owner', 'catalog-card', {
      ...validCard('catalog-card'),
      libraryEpoch: 9,
      lexemeId: 'lexeme-catalog-card',
      language: 'en',
      normalizedLemma: 'catalog',
      senseKey: 'default',
      partOfSpeech: 'noun',
    });
    const deletion = writeBatch(owner);
    deletion.set(doc(owner, 'users/owner/card_tombstones/catalog-card'), {
      cardId: 'catalog-card',
      opId: 'delete-catalog-card',
      libraryEpoch: 9,
      revision: 2,
      deletedAt: '2026-09-28T00:00:00.000Z',
    });
    deletion.delete(doc(owner, 'users/owner/cards/catalog-card'));

    await assertFails(deletion.commit());
  });

  it('allows a newer tombstone libraryEpoch to reset revision to one', async () => {
    const owner = testEnvironment.authenticatedContext('owner').firestore();
    const state = doc(owner, 'users/owner/profile/library_state');
    const tombstone = doc(owner, 'users/owner/card_tombstones/epoch-reset-card');

    await assertSucceeds(setDoc(state, { schemaVersion: 2, libraryEpoch: 4 }));
    await seedReservedCard(testEnvironment, 'owner', 'epoch-reset-card', {
      ...validCard('epoch-reset-card'),
      libraryEpoch: 4,
    });
    const deletion = writeBatch(owner);
    deletion.set(tombstone, {
      cardId: 'epoch-reset-card',
      opId: 'delete-at-epoch-4',
      libraryEpoch: 4,
      revision: 2,
      deletedAt: '2026-08-09T00:00:00.000Z',
    });
    deletion.delete(doc(owner, 'users/owner/cards/epoch-reset-card'));
    await assertSucceeds(deletion.commit());
    await assertSucceeds(setDoc(state, { schemaVersion: 2, libraryEpoch: 5 }));

    const nextEpochTombstone = {
      cardId: 'epoch-reset-card',
      opId: 'delete-at-epoch-5',
      libraryEpoch: 5,
      revision: 1,
      deletedAt: '2026-08-10T00:00:00.000Z',
    };
    const invalidMissingDelete = writeBatch(owner);
    invalidMissingDelete.set(tombstone, nextEpochTombstone);
    invalidMissingDelete.delete(doc(owner, 'users/owner/cards/epoch-reset-card'));
    await assertFails(invalidMissingDelete.commit());
    await assertSucceeds(setDoc(tombstone, nextEpochTombstone));
  });

  it('requires tombstone revision to increase within the same libraryEpoch', async () => {
    const owner = testEnvironment.authenticatedContext('owner').firestore();
    const tombstone = doc(owner, 'users/owner/card_tombstones/same-epoch-card');

    await assertSucceeds(setDoc(
      doc(owner, 'users/owner/profile/library_state'),
      { schemaVersion: 2, libraryEpoch: 7 },
    ));
    await seedReservedCard(testEnvironment, 'owner', 'same-epoch-card', {
      ...validCard('same-epoch-card'),
      revision: 3,
      libraryEpoch: 7,
    });
    const deletion = writeBatch(owner);
    deletion.set(tombstone, {
      cardId: 'same-epoch-card',
      opId: 'delete-revision-4',
      libraryEpoch: 7,
      revision: 4,
      deletedAt: '2026-08-09T00:00:00.000Z',
    });
    deletion.delete(doc(owner, 'users/owner/cards/same-epoch-card'));
    await assertSucceeds(deletion.commit());
    await assertFails(updateDoc(tombstone, {
      opId: 'replace-revision-4',
      revision: 4,
      deletedAt: '2026-08-10T00:00:00.000Z',
    }));
    await assertFails(updateDoc(tombstone, {
      opId: 'lower-to-revision-3',
      revision: 3,
      deletedAt: '2026-08-10T00:00:00.000Z',
    }));
    await assertSucceeds(updateDoc(tombstone, {
      opId: 'advance-to-revision-5',
      revision: 5,
      deletedAt: '2026-08-10T00:00:00.000Z',
    }));
  });

  it('allows public reads of live callable-created shares but keeps them immutable', async () => {
    await testEnvironment.withSecurityRulesDisabled(async context => {
      await setDoc(doc(context.firestore(), 'shared_decks/deck-1'), {
        category: 'Basics',
        cards: [validSharedCard()],
        createdAt: Timestamp.fromMillis(0),
        expiresAt: Timestamp.fromDate(new Date('2099-01-01T00:00:00.000Z')),
        schemaVersion: 2,
      });
    });
    const owner = testEnvironment.authenticatedContext('owner').firestore();
    const reader = testEnvironment.unauthenticatedContext().firestore();
    const sharedDeck = doc(owner, 'shared_decks/deck-1');

    await expect(assertSucceeds(getDoc(doc(reader, 'shared_decks/deck-1')))).resolves.toBeDefined();
    await assertFails(updateDoc(sharedDeck, { category: 'Changed' }));
  });

  it('allows a paired language schema-2 share and rejects unknown public fields', async () => {
    await testEnvironment.withSecurityRulesDisabled(async context => {
      const database = context.firestore();
      const share = {
        category: 'Basics', cards: [validSharedCard()], createdAt: Timestamp.fromMillis(0),
        expiresAt: Timestamp.fromDate(new Date('2099-01-01T00:00:00.000Z')), schemaVersion: 2,
        targetLanguage: 'en', nativeLanguage: 'vi',
      };
      await setDoc(doc(database, 'shared_decks/paired-language'), share);
      await setDoc(doc(database, 'shared_decks/paired-language-extra'), { ...share, privateNote: 'no' });
    });
    const reader = testEnvironment.unauthenticatedContext().firestore();
    await expect(assertSucceeds(getDoc(doc(reader, 'shared_decks/paired-language')))).resolves.toBeDefined();
    await assertFails(getDoc(doc(reader, 'shared_decks/paired-language-extra')));
  });

  it('denies a schema-2 share while its server quarantine copy exists', async () => {
    await testEnvironment.withSecurityRulesDisabled(async context => {
      await setDoc(doc(context.firestore(), 'shared_decks/quarantined-schema-two'), {
        category: 'Basics',
        cards: [validSharedCard()],
        createdAt: Timestamp.fromMillis(0),
        expiresAt: Timestamp.fromDate(new Date('2099-01-01T00:00:00.000Z')),
        schemaVersion: 2,
      });
      await setDoc(doc(context.firestore(), 'admin_shared_deck_migration_quarantine/quarantined-schema-two'), {
        schemaVersion: 2,
        shareId: 'quarantined-schema-two',
      });
    });
    const reader = testEnvironment.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(reader, 'shared_decks/quarantined-schema-two')));
  });

  it('denies schema-1 callable shares after private-owner cutover', async () => {
    await testEnvironment.withSecurityRulesDisabled(async context => {
      const database = context.firestore();
      const schemaOneShare = {
        authorUid: 'legacy-owner',
        category: 'Legacy callable share',
        cards: [validSharedCard('legacy-callable-card')],
        createdAt: Timestamp.fromMillis(0),
        expiresAt: Timestamp.fromDate(new Date('2099-01-01T00:00:00.000Z')),
        schemaVersion: 1,
      };
      await setDoc(doc(database, 'shared_decks/schema-one-live'), schemaOneShare);
      await setDoc(doc(database, 'shared_decks/schema-one-extra-field'), {
        ...schemaOneShare,
        internalNote: 'must remain private',
      });
      await setDoc(doc(database, 'shared_decks/schema-one-wrong-created-at'), {
        ...schemaOneShare,
        createdAt: new Date(0).toISOString(),
      });
    });

    const reader = testEnvironment.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(reader, 'shared_decks/schema-one-live')));
    await assertFails(getDoc(doc(reader, 'shared_decks/schema-one-extra-field')));
    await assertFails(getDoc(doc(reader, 'shared_decks/schema-one-wrong-created-at')));
  });

  it('denies all legacy owner-free shared decks after schema-2 cutover', async () => {
    await testEnvironment.withSecurityRulesDisabled(async context => {
      const database = context.firestore();
      const sanitizedLegacy = {
        category: 'Legacy basics',
        cards: [validSharedCard('legacy-card')],
        createdAt: new Date(0).toISOString(),
      };
      await setDoc(doc(database, 'shared_decks/legacy-sanitized'), sanitizedLegacy);
      await setDoc(doc(database, 'shared_decks/legacy-with-author'), {
        ...sanitizedLegacy,
        authorUid: 'owner',
      });
      await setDoc(doc(database, 'shared_decks/legacy-with-extra-field'), {
        ...sanitizedLegacy,
        internalNote: 'must remain private',
      });
    });

    const reader = testEnvironment.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(reader, 'shared_decks/legacy-sanitized')));
    await assertFails(getDoc(doc(reader, 'shared_decks/legacy-with-author')));
    await assertFails(getDoc(doc(reader, 'shared_decks/legacy-with-extra-field')));
  });

  it('keeps shared-deck ownership metadata server-only', async () => {
    await testEnvironment.withSecurityRulesDisabled(async context => {
      await setDoc(doc(context.firestore(), 'shared_deck_owners/deck-1'), {
        ownerUid: 'owner',
        createdAt: Timestamp.fromMillis(0),
        expiresAt: Timestamp.fromDate(new Date('2099-01-01T00:00:00.000Z')),
        schemaVersion: 1,
      });
    });

    const owner = testEnvironment.authenticatedContext('owner').firestore();
    const reader = testEnvironment.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(owner, 'shared_deck_owners/deck-1')));
    await assertFails(getDoc(doc(reader, 'shared_deck_owners/deck-1')));
    await assertFails(setDoc(doc(owner, 'shared_deck_owners/deck-2'), { ownerUid: 'owner' }));
  });

  it('rejects all direct shared-deck creation and revocation', async () => {
    const owner = testEnvironment.authenticatedContext('owner').firestore();

    await assertFails(setDoc(doc(owner, 'shared_decks/empty-deck'), {
      authorUid: 'owner',
      category: 'Basics',
      cards: [validSharedCard()],
      createdAt: new Date(0).toISOString(),
    }));
    await testEnvironment.withSecurityRulesDisabled(async context => {
      await setDoc(doc(context.firestore(), 'shared_decks/owned-deck'), {
        authorUid: 'owner',
        category: 'Basics',
        cards: [validSharedCard()],
        createdAt: Timestamp.fromMillis(0),
        expiresAt: Timestamp.fromDate(new Date('2099-01-01T00:00:00.000Z')),
        schemaVersion: 1,
      });
    });
    await assertFails(deleteDoc(doc(owner, 'shared_decks/owned-deck')));
  });

  it('keeps shared decks unlisted even though direct link reads are public', async () => {
    await testEnvironment.withSecurityRulesDisabled(async context => {
      await setDoc(doc(context.firestore(), 'shared_decks/deck-1'), {
        authorUid: 'owner',
        category: 'Basics',
        cards: [validSharedCard()],
        createdAt: Timestamp.fromMillis(0),
        expiresAt: Timestamp.fromDate(new Date('2099-01-01T00:00:00.000Z')),
        schemaVersion: 1,
      });
    });
    const reader = testEnvironment.unauthenticatedContext().firestore();
    await assertFails(getDocs(collection(reader, 'shared_decks')));
  });

  it('denies direct reads after the callable share TTL expires', async () => {
    await testEnvironment.withSecurityRulesDisabled(async context => {
      await setDoc(doc(context.firestore(), 'shared_decks/expired-deck'), {
        authorUid: 'owner',
        category: 'Basics',
        cards: [validSharedCard()],
        createdAt: Timestamp.fromMillis(0),
        expiresAt: Timestamp.fromMillis(1),
        schemaVersion: 1,
      });
    });
    const reader = testEnvironment.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(reader, 'shared_decks/expired-deck')));
  });

  it('allows public reads only for published lexemes and track memberships', async () => {
    await testEnvironment.withSecurityRulesDisabled(async context => {
      const firestore = context.firestore();
      await setDoc(doc(firestore, 'lexemes/published-lexeme'), {
        schemaVersion: 3,
        provenance: { editorialStatus: 'published' },
      });
      await setDoc(doc(firestore, 'lexemes/draft-lexeme'), {
        schemaVersion: 3,
        provenance: { editorialStatus: 'draft' },
      });
      await setDoc(doc(firestore, 'track_memberships/published-membership'), {
        schemaVersion: 3,
        editorialStatus: 'published',
      });
      await setDoc(doc(firestore, 'track_memberships/draft-membership'), {
        schemaVersion: 3,
        editorialStatus: 'draft',
      });
      await setDoc(doc(firestore, 'lexemes/wrong-schema-lexeme'), {
        schemaVersion: 2,
        provenance: { editorialStatus: 'published' },
      });
      await setDoc(doc(firestore, 'track_memberships/wrong-schema-membership'), {
        schemaVersion: 2,
        editorialStatus: 'published',
      });
    });
    const reader = testEnvironment.unauthenticatedContext().firestore();

    await assertSucceeds(getDoc(doc(reader, 'lexemes/published-lexeme')));
    await assertFails(getDoc(doc(reader, 'lexemes/draft-lexeme')));
    await assertSucceeds(getDoc(doc(reader, 'track_memberships/published-membership')));
    await assertFails(getDoc(doc(reader, 'track_memberships/draft-membership')));
    await assertFails(getDoc(doc(reader, 'lexemes/wrong-schema-lexeme')));
    await assertFails(getDoc(doc(reader, 'track_memberships/wrong-schema-membership')));

    await assertSucceeds(getDocs(query(
      collection(reader, 'track_memberships'),
      where('lexemeId', 'in', ['lexeme-1']),
      where('editorialStatus', '==', 'published'),
      where('schemaVersion', '==', 3),
    )));
  });

  it('denies every direct catalog mutation even when the document is published', async () => {
    await testEnvironment.withSecurityRulesDisabled(async context => {
      await setDoc(doc(context.firestore(), 'lexemes/existing-lexeme'), {
        schemaVersion: 3,
        provenance: { editorialStatus: 'published' },
      });
      await setDoc(doc(context.firestore(), 'track_memberships/existing-membership'), {
        schemaVersion: 3,
        editorialStatus: 'published',
      });
    });
    const owner = testEnvironment.authenticatedContext('owner').firestore();

    await assertFails(setDoc(doc(owner, 'lexemes/new-lexeme'), {
      schemaVersion: 3,
      provenance: { editorialStatus: 'published' },
    }));
    await assertFails(updateDoc(
      doc(owner, 'lexemes/existing-lexeme'),
      { provenance: { editorialStatus: 'draft' } },
    ));
    await assertFails(deleteDoc(doc(owner, 'lexemes/existing-lexeme')));
    await assertFails(setDoc(doc(owner, 'track_memberships/new-membership'), {
      schemaVersion: 3,
      editorialStatus: 'published',
    }));
    await assertFails(updateDoc(
      doc(owner, 'track_memberships/existing-membership'),
      { editorialStatus: 'draft' },
    ));
    await assertFails(deleteDoc(doc(owner, 'track_memberships/existing-membership')));
  });

  it('allows only the owner to read v3 learning state and denies every client mutation', async () => {
    const owner = testEnvironment.authenticatedContext('owner').firestore();
    const intruder = testEnvironment.authenticatedContext('intruder').firestore();
    const signedOut = testEnvironment.unauthenticatedContext().firestore();
    const ownerState = doc(owner, 'users/owner/learning_states/lexeme-1');

    await testEnvironment.withSecurityRulesDisabled(async context => {
      await setDoc(
        doc(context.firestore(), 'users/owner/learning_states/lexeme-1'),
        validLearningStateV3(),
      );
    });
    await assertSucceeds(getDoc(ownerState));
    await assertFails(setDoc(
      doc(owner, 'users/owner/learning_states/new-lexeme'),
      validLearningStateV3('owner', 'new-lexeme'),
    ));
    await assertFails(updateDoc(ownerState, {
      revision: 5,
      updatedAt: '2026-08-02T00:00:00.000Z',
    }));
    await assertFails(getDoc(doc(intruder, 'users/owner/learning_states/lexeme-1')));
    await assertFails(setDoc(
      doc(intruder, 'users/owner/learning_states/lexeme-1'),
      validLearningStateV3(),
    ));
    await assertFails(getDoc(doc(signedOut, 'users/owner/learning_states/lexeme-1')));
    await assertFails(deleteDoc(ownerState));
  });

  it('denies even a minimal valid learning state from an owner client', async () => {
    const owner = testEnvironment.authenticatedContext('owner').firestore();
    const fullState = validLearningStateV3('owner', 'minimal-state');
    const {
      fsrs: _fsrs,
      mastery: _mastery,
      lastActivityAt: _lastActivityAt,
      nextReviewDate: _nextReviewDate,
      reviews: _reviews,
      interval: _interval,
      easeFactor: _easeFactor,
      revision: _revision,
      libraryEpoch: _libraryEpoch,
      updatedAt: _updatedAt,
      ...minimalState
    } = fullState;

    await assertFails(setDoc(
      doc(owner, 'users/owner/learning_states/minimal-state'),
      minimalState,
    ));
  });

  it('rejects v3 learning states with forged identities, unknown schemas or fields', async () => {
    const owner = testEnvironment.authenticatedContext('owner').firestore();
    const state = doc(owner, 'users/owner/learning_states/lexeme-1');

    await assertFails(setDoc(state, validLearningStateV3('intruder')));
    await assertFails(setDoc(state, validLearningStateV3('owner', 'other-lexeme')));
    await assertFails(setDoc(state, {
      ...validLearningStateV3(),
      schemaVersion: 4,
    }));
    await assertFails(setDoc(state, {
      ...validLearningStateV3(),
      legacySchemaVersion: 1,
    }));
    await assertFails(setDoc(state, {
      ...validLearningStateV3(),
      administrator: true,
    }));
  });

  it('rejects unbounded or malformed v3 learning progress structures', async () => {
    const owner = testEnvironment.authenticatedContext('owner').firestore();

    await assertFails(setDoc(doc(owner, 'users/owner/learning_states/too-many-reviews'), {
      ...validLearningStateV3('owner', 'too-many-reviews'),
      reviewHistory: Array.from({ length: 101 }, () => ({
        rating: 'good',
        reviewedAt: '2026-08-01T00:00:00.000Z',
      })),
    }));
    await assertFails(setDoc(doc(owner, 'users/owner/learning_states/invalid-fsrs'), {
      ...validLearningStateV3('owner', 'invalid-fsrs'),
      fsrs: {
        ...validLearningStateV3().fsrs,
        administrator: true,
      },
    }));
    await assertFails(setDoc(doc(owner, 'users/owner/learning_states/negative-progress'), {
      ...validLearningStateV3('owner', 'negative-progress'),
      reviews: -1,
    }));
    await assertFails(setDoc(doc(owner, 'users/owner/learning_states/too-many-collections'), {
      ...validLearningStateV3('owner', 'too-many-collections'),
      customCollections: ['deck-1', 'deck-2'],
    }));
  });

  it('keeps course profiles owner-readable and server-owned', async () => {
    const owner = testEnvironment.authenticatedContext('owner').firestore();
    const intruder = testEnvironment.authenticatedContext('intruder').firestore();
    const card = validCard('course-control-card');
    await seedCurrentCard(testEnvironment, 'owner', 'course-control-card', card);

    await assertSucceeds(getDoc(doc(owner, 'users/owner/profile/courses')));
    await assertFails(getDoc(doc(intruder, 'users/owner/profile/courses')));
    await assertFails(setDoc(doc(owner, 'users/owner/profile/courses'), { courses: [], activeCourseId: null }));
  });

  it('keeps language metadata independent from plain identity while preserving immutability', async () => {
    const owner = testEnvironment.authenticatedContext('owner').firestore();
    const cardId = 'course-ko-plain-card';
    const card = {
      ...validCard(cardId),
      language: 'ko',
      translationLanguage: 'vi',
    };
    await seedCurrentCard(testEnvironment, 'owner', cardId, card);
    await assertSucceeds(updateDoc(doc(owner, `users/owner/cards/${cardId}`), {
      bookmarked: true,
      revision: 2,
    }));
    await assertFails(updateDoc(doc(owner, `users/owner/cards/${cardId}`), {
      language: 'ja',
      revision: 3,
    }));
    await assertFails(updateDoc(doc(owner, `users/owner/cards/${cardId}`), {
      translationLanguage: 'en',
      revision: 3,
    }));
  });

  it('rejects an explicit malformed source language instead of mapping it to English', async () => {
    const owner = testEnvironment.authenticatedContext('owner').firestore();
    const cardId = 'course-invalid-language-card';
    const card = { ...validCard(cardId), language: 42 };
    await seedCurrentCard(testEnvironment, 'owner', cardId, card);
    await assertFails(updateDoc(doc(owner, `users/owner/cards/${cardId}`), {
      bookmarked: true,
      revision: 2,
    }));
  });

  it('rejects partial canonical identity but preserves a complete published tuple', async () => {
    const owner = testEnvironment.authenticatedContext('owner').firestore();
    const partialId = 'course-partial-lexeme-card';
    const partial = validCard(partialId);
    await seedCurrentCard(testEnvironment, 'owner', partialId, partial);
    await assertFails(updateDoc(doc(owner, `users/owner/cards/${partialId}`), {
      lexemeId: 'lexeme-partial',
      revision: 2,
    }));

    const canonicalId = 'course-complete-lexeme-card';
    const canonical = {
      ...validCard(canonicalId),
      lexemeId: 'lexeme-complete',
      language: 'en',
      senseKey: 'default',
      normalizedLemma: 'hello',
      translation: 'xin chào',
      explanation: '',
      explanationTranslation: '',
      phonetic: '',
      category: 'Other',
      emoji: '📝',
      audioUrl: null,
      imageUrl: null,
      imageSearchQuery: '',
      createdAt: '1970-01-01T00:00:00.000Z',
      bookmarked: false,
      customDeck: null,
      difficulty: 'unrated',
      reviews: 0,
      interval: 0,
      easeFactor: 2.5,
      correctStreak: 0,
      partOfSpeech: 'noun',
      cefrLevel: '',
      exampleSentence: '',
      exampleTranslation: '',
      collocations: [],
      synonyms: [],
      antonyms: [],
      register: '',
      commonMistake: '',
      reviewHistory: [],
    };
    await seedCurrentCard(testEnvironment, 'owner', canonicalId, canonical);
    await testEnvironment.withSecurityRulesDisabled(async context => {
      await setDoc(doc(context.firestore(), 'lexemes/lexeme-complete'), {
        schemaVersion: 3,
        id: 'lexeme-complete',
        language: 'en',
        normalizedLemma: 'hello',
        partOfSpeech: 'noun',
        senseKey: 'default',
        provenance: { editorialStatus: 'published' },
      });
    });
    await assertSucceeds(updateDoc(doc(owner, `users/owner/cards/${canonicalId}`), {
      bookmarked: true,
      revision: 2,
    }));
  });

  it('updates trusted canonical cards without requiring a duplicate public lexeme', async () => {
    const owner = testEnvironment.authenticatedContext('canonical-owner').firestore();
    const identity = {
      language: 'en',
      normalizedLemma: 'break the news',
      partOfSpeech: 'phrase',
      senseKey: 'share-bad-news',
    };
    const id = createLexemeId(identity);
    const cardRef = doc(owner, `users/canonical-owner/cards/${id}`);

    await seedCurrentCard(testEnvironment, 'canonical-owner', id, {
      ...validCard(id),
      id,
      word: identity.normalizedLemma,
      normalizedWord: identity.normalizedLemma,
      ...identity,
      lexemeId: id,
      imageUrl: null,
      imageSearchQuery: '',
    });

    await assertSucceeds(updateDoc(cardRef, {
      imageUrl: 'https://images.pexels.com/photos/123/example.jpeg',
      imageSearchQuery: 'breaking news',
      revision: 2,
      updatedAt: Timestamp.fromMillis(2),
    }));
    await assertFails(updateDoc(cardRef, {
      normalizedLemma: 'changed identity',
      revision: 3,
    }));
  });

  it('keeps canonical identity assignment server-only even for a published lexeme', async () => {
    const identity = {
      language: 'en',
      normalizedLemma: 'break the news',
      partOfSpeech: 'phrase',
      senseKey: 'share-bad-news',
    };
    const id = createLexemeId(identity);
    const owner = testEnvironment.authenticatedContext('canonical-adoption-owner').firestore();
    await seedCurrentCard(testEnvironment, 'canonical-adoption-owner', id, {
      ...validCard(id),
      id,
      word: identity.normalizedLemma,
      normalizedWord: identity.normalizedLemma,
    });
    await testEnvironment.withSecurityRulesDisabled(async context => {
      const database = context.firestore();
      await setDoc(doc(database, `lexemes/${id}`), {
        schemaVersion: 3,
        id,
        ...identity,
        provenance: { editorialStatus: 'published' },
      });
    });

    const canonicalPatch = { ...identity, lexemeId: id, revision: 2 };
    await assertFails(updateDoc(
      doc(owner, `users/canonical-adoption-owner/cards/${id}`),
      canonicalPatch,
    ));
  });

  describe('card edit-sheet mutation allowlist', () => {
    it('allows a legacy card (no lexemeId) to change part of speech in one write', async () => {
      const owner = testEnvironment.authenticatedContext('owner').firestore();
      const cardId = 'edit-sheet-legacy-pos';
      await seedCurrentCard(testEnvironment, 'owner', cardId, { ...validCard(cardId), partOfSpeech: 'noun' });
      await assertSucceeds(updateDoc(doc(owner, `users/owner/cards/${cardId}`), {
        partOfSpeech: 'verb',
        revision: 2,
      }));
    });

    it('rejects a canonical (lexemeId) card changing part of speech, since it names a published sense', async () => {
      const owner = testEnvironment.authenticatedContext('owner').firestore();
      const canonicalId = 'edit-sheet-canonical-pos';
      const canonical = {
        ...validCard(canonicalId),
        lexemeId: 'lexeme-edit-sheet',
        language: 'en',
        senseKey: 'default',
        normalizedLemma: 'hello',
        translation: 'xin chào',
        explanation: '', explanationTranslation: '', phonetic: '', category: 'Other',
        emoji: '📝', audioUrl: null, imageUrl: null, imageSearchQuery: '',
        createdAt: '1970-01-01T00:00:00.000Z', bookmarked: false, customDeck: null,
        difficulty: 'unrated', reviews: 0, interval: 0, easeFactor: 2.5, correctStreak: 0,
        partOfSpeech: 'noun', cefrLevel: '', exampleSentence: '', exampleTranslation: '',
        collocations: [], synonyms: [], antonyms: [], register: '', commonMistake: '', reviewHistory: [],
      };
      await seedCurrentCard(testEnvironment, 'owner', canonicalId, canonical);
      await testEnvironment.withSecurityRulesDisabled(async context => {
        await setDoc(doc(context.firestore(), 'lexemes/lexeme-edit-sheet'), {
          schemaVersion: 3, id: 'lexeme-edit-sheet', language: 'en', normalizedLemma: 'hello',
          partOfSpeech: 'noun', senseKey: 'default', provenance: { editorialStatus: 'published' },
        });
      });
      await assertFails(updateDoc(doc(owner, `users/owner/cards/${canonicalId}`), {
        partOfSpeech: 'verb',
        revision: 2,
      }));
    });

    it('allows changing category in one write', async () => {
      const owner = testEnvironment.authenticatedContext('owner').firestore();
      const cardId = 'edit-sheet-category';
      await seedCurrentCard(testEnvironment, 'owner', cardId, { ...validCard(cardId), category: 'Nature' });
      await assertSucceeds(updateDoc(doc(owner, `users/owner/cards/${cardId}`), {
        category: 'Business',
        revision: 2,
      }));
    });

    it('allows changing customDeck in one write', async () => {
      const owner = testEnvironment.authenticatedContext('owner').firestore();
      const cardId = 'edit-sheet-custom-deck';
      await seedCurrentCard(testEnvironment, 'owner', cardId, { ...validCard(cardId), customDeck: null });
      await assertSucceeds(updateDoc(doc(owner, `users/owner/cards/${cardId}`), {
        customDeck: 'Travel words',
        revision: 2,
      }));
    });

    it('allows removing the image by setting imageUrl to null', async () => {
      const owner = testEnvironment.authenticatedContext('owner').firestore();
      const cardId = 'edit-sheet-image-remove';
      await seedCurrentCard(testEnvironment, 'owner', cardId, {
        ...validCard(cardId),
        imageUrl: 'https://images.pexels.com/photos/1/old.jpg',
        imageSearchQuery: 'old query',
      });
      await assertSucceeds(updateDoc(doc(owner, `users/owner/cards/${cardId}`), {
        imageUrl: null,
        imageSearchQuery: '',
        revision: 2,
      }));
    });

    it('allows replacing the image with a trusted-domain url', async () => {
      const owner = testEnvironment.authenticatedContext('owner').firestore();
      const cardId = 'edit-sheet-image-replace-trusted';
      await seedCurrentCard(testEnvironment, 'owner', cardId, { ...validCard(cardId), imageUrl: null });
      await assertSucceeds(updateDoc(doc(owner, `users/owner/cards/${cardId}`), {
        imageUrl: 'https://images.unsplash.com/photo-1',
        imageSearchQuery: 'new query',
        revision: 2,
      }));
    });

    it('rejects replacing the image with an untrusted-domain url', async () => {
      const owner = testEnvironment.authenticatedContext('owner').firestore();
      const cardId = 'edit-sheet-image-replace-untrusted';
      await seedCurrentCard(testEnvironment, 'owner', cardId, { ...validCard(cardId), imageUrl: null });
      await assertFails(updateDoc(doc(owner, `users/owner/cards/${cardId}`), {
        imageUrl: 'https://attacker.example/photo.jpg',
        imageSearchQuery: 'new query',
        revision: 2,
      }));
    });

    it('rejects a direct client update to word/normalizedWord, confirming the headword rename callable is required', async () => {
      const owner = testEnvironment.authenticatedContext('owner').firestore();
      const cardId = 'edit-sheet-word-lock';
      await seedCurrentCard(testEnvironment, 'owner', cardId, validCard(cardId));
      await assertFails(updateDoc(doc(owner, `users/owner/cards/${cardId}`), {
        word: 'goodbye',
        normalizedWord: 'goodbye',
        revision: 2,
      }));
    });
  });
});
