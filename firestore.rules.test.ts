import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, setDoc, Timestamp, updateDoc } from 'firebase/firestore';
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
});
