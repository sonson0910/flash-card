import { randomUUID } from 'node:crypto';
import { deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { getFirestore, Timestamp, type Firestore } from 'firebase-admin/firestore';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseCreateSharedDeckRequest } from '../src/inputValidation.js';
import {
  buildSharedDeckDocuments,
  createSharedDeckAtomically,
} from '../src/sharedDeckPersistence.js';

const describeWithEmulator = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;
const DATABASE_ID = 'ai-studio-945b4052-4462-4668-8936-277f09f07a37';

describeWithEmulator('Firestore shared-deck persistence', () => {
  let app: App;
  let database: Firestore;

  beforeAll(() => {
    app = initializeApp({ projectId: 'demo-lingoflash' }, 'shared-deck-persistence-integration');
    database = getFirestore(app, DATABASE_ID);
  });

  afterAll(async () => {
    await database.terminate();
    await deleteApp(app);
  });

  it('serializes two first creates through a missing usage document', async () => {
    const ownerUid = `shared-deck-concurrency-${randomUUID()}`;
    const firstShareId = `first-${randomUUID()}`;
    const secondShareId = `second-${randomUUID()}`;
    const now = Timestamp.now();
    const expiresAt = Timestamp.fromMillis(now.toMillis() + 60_000);
    const input = parseCreateSharedDeckRequest({
      category: 'Concurrency',
      cards: [{ word: 'hello', translation: 'xin chào' }],
    });
    const first = buildSharedDeckDocuments(input, ownerUid, now, expiresAt);
    const second = buildSharedDeckDocuments(input, ownerUid, now, expiresAt);
    const firstSharedDeck = database.collection('shared_decks').doc(firstShareId);
    const secondSharedDeck = database.collection('shared_decks').doc(secondShareId);
    const firstOwnership = database.collection('shared_deck_owners').doc(firstShareId);
    const secondOwnership = database.collection('shared_deck_owners').doc(secondShareId);

    await Promise.all([
      createSharedDeckAtomically(database, firstSharedDeck, firstOwnership, first),
      createSharedDeckAtomically(database, secondSharedDeck, secondOwnership, second),
    ]);

    const usage = await database.collection('users').doc(ownerUid)
      .collection('profile').doc('shared_deck_usage').get();
    expect(usage.data()).toEqual({
      schemaVersion: 1,
      shares: {
        [firstShareId]: { payloadBytes: first.ownership.payloadBytes, expiresAt },
        [secondShareId]: { payloadBytes: second.ownership.payloadBytes, expiresAt },
      },
      activeCount: 2,
      activeBytes: (first.ownership.payloadBytes as number) + (second.ownership.payloadBytes as number),
    });
    await expect(firstSharedDeck.get()).resolves.toMatchObject({ exists: true });
    await expect(secondSharedDeck.get()).resolves.toMatchObject({ exists: true });
    await expect(firstOwnership.get()).resolves.toMatchObject({ exists: true });
    await expect(secondOwnership.get()).resolves.toMatchObject({ exists: true });
  });
});
