import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestContext,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, query, setDoc, Timestamp, updateDoc, where, writeBatch } from 'firebase/firestore';
import { readFile } from 'node:fs/promises';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  createCardIdentityReservationId,
  createWordCardId,
  normalizeCardWord,
} from './src/lib/cardIdentity';
import { normalizeCardData } from './src/lib/cardNormalization';

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

const writeReservedCard = (
  database: ReturnType<RulesTestContext['firestore']>,
  userId: string,
  documentId: string,
  card: Record<string, unknown>,
): Promise<void> => {
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
  return batch.commit();
};

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
    const owner = testEnvironment.authenticatedContext('owner').firestore();
    const intruder = testEnvironment.authenticatedContext('intruder').firestore();
    const signedOut = testEnvironment.unauthenticatedContext().firestore();
    await assertSucceeds(writeReservedCard(owner, 'owner', 'card-1', validCard()));
    await assertFails(getDoc(doc(intruder, 'users/owner/cards/card-1')));
    await assertFails(getDoc(doc(signedOut, 'users/owner/cards/card-1')));
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
    await assertSucceeds(batch.commit());
  });

  it('accepts the full normalized card payload emitted by the application', async () => {
    const owner = testEnvironment.authenticatedContext('owner').firestore();
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

    await assertSucceeds(writeReservedCard(owner, 'owner', id, {
      ...card,
      updatedAt: Timestamp.fromDate(new Date('2026-08-11T00:01:00.000Z')),
    }));
  });

  it('retains media and list boundaries for full normalized card payloads', async () => {
    const owner = testEnvironment.authenticatedContext('owner').firestore();
    const id = createWordCardId('canonical-boundaries');
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

    await assertFails(writeReservedCard(owner, 'owner', id, {
      ...card,
      imageUrl: 'https://attacker.example/image.jpg',
    }));
    await assertFails(writeReservedCard(owner, 'owner', id, {
      ...card,
      collocations: ['safe phrase', { unsafe: true }],
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

    await assertSucceeds(writeReservedCard(owner, 'owner', firstId, {
      ...validCard(firstId),
      word: 'Chance',
      normalizedWord: 'chance',
    }));
    await assertFails(writeReservedCard(owner, 'owner', secondId, {
      ...validCard(secondId),
      word: ' chance ',
      normalizedWord: 'chance',
    }));
  });

  it('scopes the same normalized identity independently to each owner', async () => {
    const firstOwner = testEnvironment.authenticatedContext('owner-a').firestore();
    const secondOwner = testEnvironment.authenticatedContext('owner-b').firestore();
    const id = createWordCardId('chance');
    const card = {
      ...validCard(id),
      word: 'chance',
      normalizedWord: 'chance',
    };

    await assertSucceeds(writeReservedCard(firstOwner, 'owner-a', id, card));
    await assertSucceeds(writeReservedCard(secondOwner, 'owner-b', id, card));
  });

  it('prevents a card update from changing its reserved normalized identity', async () => {
    const owner = testEnvironment.authenticatedContext('owner').firestore();
    const id = createWordCardId('chance');
    const cardRef = doc(owner, `users/owner/cards/${id}`);

    await assertSucceeds(writeReservedCard(owner, 'owner', id, {
      ...validCard(id),
      word: 'chance',
      normalizedWord: 'chance',
    }));
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

    await assertSucceeds(writeReservedCard(owner, 'owner', id, {
      ...validCard(id),
      word: 'chance',
      normalizedWord: 'chance',
    }));
    await assertFails(updateDoc(cardRef, {
      word: 'opportunity',
      revision: 2,
    }));
  });

  it('prevents changing only the word casing and whitespace when the normalized identity remains valid', async () => {
    const owner = testEnvironment.authenticatedContext('owner').firestore();
    const id = createWordCardId('quite');
    const cardRef = doc(owner, `users/owner/cards/${id}`);

    await assertSucceeds(writeReservedCard(owner, 'owner', id, {
      ...validCard(id),
      word: 'Quite',
      normalizedWord: 'quite',
    }));
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
        normalizedWord: 'chance',
      });
    });

    const protocolUpgrade = {
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

  it('keeps reservations immutable and reuses one after a card is cleared', async () => {
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

    await assertSucceeds(setDoc(cardRef, card));
    await testEnvironment.withSecurityRulesDisabled(async context => {
      await deleteDoc(doc(context.firestore(), `users/owner/cards/${id}`));
    });
    await assertSucceeds(setDoc(cardRef, card));
    await assertFails(updateDoc(reservationRef, { normalizedWord: 'other' }));
    await assertFails(deleteDoc(reservationRef));
  });

  it('allows stable phrase, apostrophe, Unicode and multi-block card identities', async () => {
    const owner = testEnvironment.authenticatedContext('owner').firestore();

    for (const word of ['as soon as', "don't", 'café 学习', 'a'.repeat(256)]) {
      const id = createWordCardId(word);
      await assertSucceeds(writeReservedCard(owner, 'owner', id, {
        ...validCard(id),
        word,
        normalizedWord: normalizeCardWord(word),
      }));
    }
  });

  it('rejects unsafe external images and oversized custom deck names', async () => {
    const owner = testEnvironment.authenticatedContext('owner').firestore();

    await assertFails(
      writeReservedCard(owner, 'owner', 'unsafe-image', {
        ...validCard('unsafe-image'),
        imageUrl: 'https://example.com/tracker.png',
      }),
    );
    await assertFails(
      writeReservedCard(owner, 'owner', 'oversized-deck', {
        ...validCard('oversized-deck'),
        customDeck: 'a'.repeat(129),
      }),
    );
  });

  it('rejects unknown card fields and invalid bounded-string list entries', async () => {
    const owner = testEnvironment.authenticatedContext('owner').firestore();

    await assertFails(writeReservedCard(owner, 'owner', 'unknown-field', {
      ...validCard('unknown-field'),
      administrator: true,
    }));
    for (const field of ['collocations', 'synonyms', 'antonyms'] as const) {
      await assertFails(writeReservedCard(owner, 'owner', `non-string-${field}`, {
        ...validCard(`non-string-${field}`),
        [field]: ['valid entry', 42],
      }));
      await assertFails(writeReservedCard(owner, 'owner', `oversized-${field}`, {
        ...validCard(`oversized-${field}`),
        [field]: ['a'.repeat(101)],
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

    await assertSucceeds(writeReservedCard(owner, 'owner', 'bounded-lists', {
      ...card,
    }));

    for (const field of ['collocations', 'synonyms', 'antonyms'] as const) {
      await assertFails(writeReservedCard(owner, 'owner', `five-${field}`, {
        ...card,
        id: `five-${field}`,
        word: `five-${field}`,
        normalizedWord: `five-${field}`,
        [field]: [...boundaryEntries, 'fifth'],
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
    await assertSucceeds(writeReservedCard(owner, 'owner', 'v2-epoch-zero', {
      ...validCard('v2-epoch-zero'),
      updatedAt: Timestamp.fromMillis(1),
    }));
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
    await assertSucceeds(writeReservedCard(owner, 'owner', 'current-epoch', {
      ...validCard('current-epoch'),
      schemaVersion: 2,
      revision: 1,
      libraryEpoch: 3,
    }));
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
    await assertSucceeds(writeReservedCard(owner, 'owner', 'card-before-clear', {
      ...validCard('card-before-clear'),
      schemaVersion: 2,
      revision: 1,
      libraryEpoch: 4,
    }));

    await assertSucceeds(setDoc(state, { schemaVersion: 2, libraryEpoch: 5 }));
    await assertFails(updateDoc(card, { translation: 'ghi stale' }));
    await assertFails(updateDoc(card, {
      libraryEpoch: 5,
      revision: 2,
      translation: 'ghi hiện hành',
    }));
    await assertSucceeds(deleteDoc(card));
  });

  it('requires current-epoch updates to advance the revision exactly once', async () => {
    const owner = testEnvironment.authenticatedContext('owner').firestore();
    const card = doc(owner, 'users/owner/cards/revisioned-card');
    await assertSucceeds(writeReservedCard(
      owner,
      'owner',
      'revisioned-card',
      validCard('revisioned-card'),
    ));

    await assertFails(updateDoc(card, { translation: 'không tăng revision' }));
    await assertFails(updateDoc(card, { translation: 'hạ revision', revision: 0 }));
    await assertFails(updateDoc(card, { translation: 'nhảy revision', revision: 3 }));
    await assertSucceeds(updateDoc(card, { translation: 'hợp lệ', revision: 2 }));
  });

  it('requires an atomic newer tombstone before deleting a current card', async () => {
    const owner = testEnvironment.authenticatedContext('owner').firestore();
    const card = doc(owner, 'users/owner/cards/card-with-barrier');
    const tombstone = doc(owner, 'users/owner/card_tombstones/card-with-barrier');
    await assertSucceeds(writeReservedCard(
      owner,
      'owner',
      'card-with-barrier',
      validCard('card-with-barrier'),
    ));
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
    await assertSucceeds(setDoc(card, {
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

  it('allows only owner writes that match the bounded gamification stats schema', async () => {
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

    await assertSucceeds(setDoc(stats, validStats));
    const stream = doc(owner, 'users/owner/xp_streams/device_a');
    await assertSucceeds(setDoc(stream, {
      schemaVersion: 2,
      clientId: 'device_a',
      sequence: 14,
      retiredAt: null,
    }));
    await assertSucceeds(getDoc(stats));
    await assertSucceeds(getDoc(stream));
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
    await assertSucceeds(setDoc(stream, {
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
    await assertSucceeds(setDoc(stream, {
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

  it('bounds gamification history even though the generic profile match overlaps it', async () => {
    const owner = testEnvironment.authenticatedContext('owner').firestore();
    const intruder = testEnvironment.authenticatedContext('intruder').firestore();
    const history = doc(owner, 'users/owner/profile/xp_history');
    const boundedHistory = Object.fromEntries(
      Array.from({ length: 730 }, (_, index) => [`day-${index}`, index]),
    );

    await assertSucceeds(setDoc(history, boundedHistory));
    await assertSucceeds(getDoc(history));
    await assertFails(getDoc(doc(intruder, 'users/owner/profile/xp_history')));
    await assertFails(setDoc(doc(intruder, 'users/owner/profile/xp_history'), boundedHistory));
    await assertFails(setDoc(history, { ...boundedHistory, 'day-730': 730 }));
    await assertFails(deleteDoc(history));
  });

  it('allows only strict current-epoch point tombstones for the owner', async () => {
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
      revision: 3,
      deletedAt: '2026-07-26T00:00:00.000Z',
    };

    await assertSucceeds(setDoc(tombstone, validTombstone));
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

  it('allows a newer tombstone libraryEpoch to reset revision to one', async () => {
    const owner = testEnvironment.authenticatedContext('owner').firestore();
    const state = doc(owner, 'users/owner/profile/library_state');
    const tombstone = doc(owner, 'users/owner/card_tombstones/epoch-reset-card');

    await assertSucceeds(setDoc(state, { schemaVersion: 2, libraryEpoch: 4 }));
    await assertSucceeds(setDoc(tombstone, {
      cardId: 'epoch-reset-card',
      opId: 'delete-at-epoch-4',
      libraryEpoch: 4,
      revision: 9,
      deletedAt: '2026-08-09T00:00:00.000Z',
    }));
    await assertSucceeds(setDoc(state, { schemaVersion: 2, libraryEpoch: 5 }));

    await assertSucceeds(setDoc(tombstone, {
      cardId: 'epoch-reset-card',
      opId: 'delete-at-epoch-5',
      libraryEpoch: 5,
      revision: 1,
      deletedAt: '2026-08-10T00:00:00.000Z',
    }));
  });

  it('requires tombstone revision to increase within the same libraryEpoch', async () => {
    const owner = testEnvironment.authenticatedContext('owner').firestore();
    const tombstone = doc(owner, 'users/owner/card_tombstones/same-epoch-card');

    await assertSucceeds(setDoc(
      doc(owner, 'users/owner/profile/library_state'),
      { schemaVersion: 2, libraryEpoch: 7 },
    ));
    await assertSucceeds(setDoc(tombstone, {
      cardId: 'same-epoch-card',
      opId: 'delete-revision-4',
      libraryEpoch: 7,
      revision: 4,
      deletedAt: '2026-08-09T00:00:00.000Z',
    }));
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

  it('keeps exact unexpired schema-1 callable shares readable during the TTL transition', async () => {
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
    await assertSucceeds(getDoc(doc(reader, 'shared_decks/schema-one-live')));
    await assertFails(getDoc(doc(reader, 'shared_decks/schema-one-extra-field')));
    await assertFails(getDoc(doc(reader, 'shared_decks/schema-one-wrong-created-at')));
  });

  it('only exposes legacy shared decks after owner metadata is removed and the schema is exact', async () => {
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
    await assertSucceeds(getDoc(doc(reader, 'shared_decks/legacy-sanitized')));
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
});
