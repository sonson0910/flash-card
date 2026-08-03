import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, query, setDoc, Timestamp, updateDoc, where } from 'firebase/firestore';
import { readFile } from 'node:fs/promises';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createWordCardId } from './src/lib/cardIdentity';

const PROJECT_ID = 'demo-lingoflash';

const validCard = (id = 'card-1') => ({
  id,
  word: 'hello',
  translation: 'xin chào',
});

const validSharedCard = (id = 'card-1'): ReturnType<typeof validCard> & {
  audioUrl: string | null;
  imageUrl: string | null;
} => ({
  ...validCard(id),
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
    const ownerCard = doc(owner, 'users/owner/cards/card-1');

    await assertSucceeds(setDoc(ownerCard, validCard()));
    await assertFails(getDoc(doc(intruder, 'users/owner/cards/card-1')));
    await assertFails(getDoc(doc(signedOut, 'users/owner/cards/card-1')));
  });

  it('requires the document id and card id to match', async () => {
    const owner = testEnvironment.authenticatedContext('owner').firestore();

    await assertFails(
      setDoc(doc(owner, 'users/owner/cards/card-1'), validCard('different-id')),
    );
  });

  it('allows stable phrase, apostrophe and Unicode card ids', async () => {
    const owner = testEnvironment.authenticatedContext('owner').firestore();

    for (const word of ['as soon as', "don't", 'café 学习']) {
      const id = createWordCardId(word);
      await assertSucceeds(setDoc(doc(owner, `users/owner/cards/${id}`), {
        ...validCard(id),
        word,
      }));
    }
  });

  it('rejects unsafe external images and oversized custom deck names', async () => {
    const owner = testEnvironment.authenticatedContext('owner').firestore();

    await assertFails(
      setDoc(doc(owner, 'users/owner/cards/unsafe-image'), {
        ...validCard('unsafe-image'),
        imageUrl: 'https://example.com/tracker.png',
      }),
    );
    await assertFails(
      setDoc(doc(owner, 'users/owner/cards/oversized-deck'), {
        ...validCard('oversized-deck'),
        customDeck: 'a'.repeat(129),
      }),
    );
  });

  it('rejects unknown card fields and invalid bounded-string list entries', async () => {
    const owner = testEnvironment.authenticatedContext('owner').firestore();

    await assertFails(setDoc(doc(owner, 'users/owner/cards/unknown-field'), {
      ...validCard('unknown-field'),
      administrator: true,
    }));
    for (const field of ['collocations', 'synonyms', 'antonyms'] as const) {
      await assertFails(setDoc(doc(owner, `users/owner/cards/non-string-${field}`), {
        ...validCard(`non-string-${field}`),
        [field]: ['valid entry', 42],
      }));
      await assertFails(setDoc(doc(owner, `users/owner/cards/oversized-${field}`), {
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

    await assertSucceeds(setDoc(doc(owner, 'users/owner/cards/bounded-lists'), {
      ...validCard('bounded-lists'),
      collocations: boundaryEntries,
      synonyms: boundaryEntries,
      antonyms: boundaryEntries,
    }));

    for (const field of ['collocations', 'synonyms', 'antonyms'] as const) {
      await assertFails(setDoc(doc(owner, `users/owner/cards/five-${field}`), {
        ...validCard(`five-${field}`),
        [field]: [...boundaryEntries, 'fifth'],
      }));
    }
  });

  it('allows legacy cards only before library epoch state exists', async () => {
    const owner = testEnvironment.authenticatedContext('owner').firestore();

    await assertSucceeds(setDoc(
      doc(owner, 'users/owner/cards/legacy-before-epoch'),
      validCard('legacy-before-epoch'),
    ));
    await assertSucceeds(setDoc(doc(owner, 'users/owner/cards/v2-epoch-zero'), {
      ...validCard('v2-epoch-zero'),
      schemaVersion: 2,
      revision: 1,
      libraryEpoch: 0,
      updatedAt: Timestamp.fromMillis(1),
    }));
    await assertFails(setDoc(doc(owner, 'users/owner/cards/future-epoch'), {
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

    await assertFails(setDoc(
      doc(owner, 'users/owner/cards/legacy-after-epoch'),
      validCard('legacy-after-epoch'),
    ));
    await assertFails(setDoc(doc(owner, 'users/owner/cards/stale-epoch'), {
      ...validCard('stale-epoch'),
      schemaVersion: 2,
      revision: 1,
      libraryEpoch: 2,
    }));
    await assertSucceeds(setDoc(doc(owner, 'users/owner/cards/current-epoch'), {
      ...validCard('current-epoch'),
      schemaVersion: 2,
      revision: 1,
      libraryEpoch: 3,
    }));
  });

  it('allows the sync transaction to upgrade a legacy card into the current epoch', async () => {
    const owner = testEnvironment.authenticatedContext('owner').firestore();
    const card = doc(owner, 'users/owner/cards/legacy-upgrade');

    await assertSucceeds(setDoc(card, validCard('legacy-upgrade')));
    await assertSucceeds(setDoc(doc(owner, 'users/owner/profile/library_state'), {
      schemaVersion: 2,
      libraryEpoch: 4,
    }));
    await assertSucceeds(updateDoc(card, {
      id: 'legacy-upgrade',
      schemaVersion: 2,
      revision: 1,
      libraryEpoch: 4,
      updatedAt: Timestamp.fromMillis(2),
      bookmarked: true,
    }));
  });

  it('rejects a stale offline update after the library epoch advances', async () => {
    const owner = testEnvironment.authenticatedContext('owner').firestore();
    const state = doc(owner, 'users/owner/profile/library_state');
    const card = doc(owner, 'users/owner/cards/card-before-clear');
    await assertSucceeds(setDoc(state, { schemaVersion: 2, libraryEpoch: 4 }));
    await assertSucceeds(setDoc(card, {
      ...validCard('card-before-clear'),
      schemaVersion: 2,
      revision: 1,
      libraryEpoch: 4,
    }));

    await assertSucceeds(setDoc(state, { schemaVersion: 2, libraryEpoch: 5 }));
    await assertFails(updateDoc(card, { translation: 'ghi stale' }));
    await assertSucceeds(updateDoc(card, {
      libraryEpoch: 5,
      revision: 2,
      translation: 'ghi hiện hành',
    }));
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

  it('allows public reads of live callable-created shares but keeps them immutable', async () => {
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
    const owner = testEnvironment.authenticatedContext('owner').firestore();
    const reader = testEnvironment.unauthenticatedContext().firestore();
    const sharedDeck = doc(owner, 'shared_decks/deck-1');

    await expect(assertSucceeds(getDoc(doc(reader, 'shared_decks/deck-1')))).resolves.toBeDefined();
    await assertFails(updateDoc(sharedDeck, { category: 'Changed' }));
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
