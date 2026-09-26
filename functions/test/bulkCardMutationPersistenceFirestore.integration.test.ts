import { randomUUID } from 'node:crypto';
import { deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { getFirestore, type DocumentReference, type Firestore } from 'firebase-admin/firestore';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  applyBulkCardMutationsForOwner,
  BulkMutationEpochError,
} from '../src/bulkCardMutationPersistence.js';

const describeWithEmulator = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;
const DATABASE_ID = 'ai-studio-945b4052-4462-4668-8936-277f09f07a37';

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
      { cardId: 'card-c', op: 'delete', applied: true, revision: 2, deletedAt: expect.any(String) },
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
      { cardId: 'card-c', op: 'delete', applied: true, revision: 2, deletedAt: expect.any(String) },
    ]);
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
});
