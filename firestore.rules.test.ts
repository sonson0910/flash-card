import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, setDoc, updateDoc } from 'firebase/firestore';
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

  it('allows public reads but keeps shared decks immutable', async () => {
    const owner = testEnvironment.authenticatedContext('owner').firestore();
    const reader = testEnvironment.unauthenticatedContext().firestore();
    const sharedDeck = doc(owner, 'shared_decks/deck-1');

    await assertSucceeds(
      setDoc(sharedDeck, {
        authorUid: 'owner',
        category: 'Basics',
        cards: [validSharedCard()],
        createdAt: new Date(0).toISOString(),
      }),
    );
    await expect(assertSucceeds(getDoc(doc(reader, 'shared_decks/deck-1')))).resolves.toBeDefined();
    await assertFails(updateDoc(sharedDeck, { category: 'Changed' }));
  });

  it('keeps shared decks unlisted even though direct link reads are public', async () => {
    const owner = testEnvironment.authenticatedContext('owner').firestore();
    const reader = testEnvironment.unauthenticatedContext().firestore();

    await assertSucceeds(setDoc(doc(owner, 'shared_decks/deck-1'), {
      authorUid: 'owner',
      category: 'Basics',
      cards: [validSharedCard()],
      createdAt: new Date(0).toISOString(),
    }));
    await assertFails(getDocs(collection(reader, 'shared_decks')));
  });

  it('rejects an arbitrary nested audio tracker anywhere in a shared deck', async () => {
    const owner = testEnvironment.authenticatedContext('owner').firestore();

    await assertFails(setDoc(doc(owner, 'shared_decks/tracking-deck'), {
      authorUid: 'owner',
      category: 'Basics',
      cards: [
        validSharedCard('safe-card'),
        { ...validSharedCard('tracked-card'), audioUrl: 'https://tracker.example/collect.mp3' },
      ],
      createdAt: new Date(0).toISOString(),
    }));
  });

  it('rejects untrusted media at the shared-deck chunk boundary', async () => {
    const owner = testEnvironment.authenticatedContext('owner').firestore();
    const cards = Array.from({ length: 27 }, (_, index) => validSharedCard(`card-${index}`));
    cards[26] = { ...cards[26], imageUrl: 'https://tracker.example/collect.png' };

    await assertFails(setDoc(doc(owner, 'shared_decks/chunk-boundary-deck'), {
      authorUid: 'owner',
      category: 'Basics',
      cards,
      createdAt: new Date(0).toISOString(),
    }));
  });

  it('rejects untrusted media at the final supported shared-deck position', async () => {
    const owner = testEnvironment.authenticatedContext('owner').firestore();
    const cards = Array.from({ length: 100 }, (_, index) => validSharedCard(`card-${index}`));
    cards[99] = { ...cards[99], audioUrl: 'https://tracker.example/collect.mp3' };

    await assertFails(setDoc(doc(owner, 'shared_decks/final-position-deck'), {
      authorUid: 'owner',
      category: 'Basics',
      cards,
      createdAt: new Date(0).toISOString(),
    }));
  });

  it('only lets the author revoke a shared deck', async () => {
    const owner = testEnvironment.authenticatedContext('owner').firestore();
    const intruder = testEnvironment.authenticatedContext('intruder').firestore();
    const sharedDeck = doc(owner, 'shared_decks/deck-1');

    await assertSucceeds(
      setDoc(sharedDeck, {
        authorUid: 'owner',
        category: 'Basics',
        cards: [],
        createdAt: new Date(0).toISOString(),
      }),
    );
    await assertFails(deleteDoc(doc(intruder, 'shared_decks/deck-1')));
    await assertSucceeds(deleteDoc(sharedDeck));
  });
});
