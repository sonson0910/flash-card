import { randomUUID } from 'node:crypto';
import { deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyBulkCardMutationsForOwner } from '../src/bulkCardMutationPersistence.js';
import {
  createCardForOwner,
  createStarterCardsForOwner,
} from '../src/cardPersistence.js';
import { PILOT_CONFIG_DEFAULTS } from '../src/pilotConfig.js';

const describeWithEmulator = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;
const DATABASE_ID = 'ai-studio-945b4052-4462-4668-8936-277f09f07a37';

const word = (text: string, translation: string) => ({
  word: text, translation, language: 'en', translationLanguage: 'vi', origin: 'manual' as const,
});
const starterBatch = [
  word('hello', 'xin chào'), word('thank you', 'cảm ơn'), word('water', 'nước'),
  word('friend', 'bạn'), word('love', 'yêu'),
];
const now = new Date('2026-09-27T04:00:00.000Z');
const PILOT_PERIOD_KEY = `free-${now.toISOString().slice(0, 7)}`;

describeWithEmulator('card identity persistence in Firestore', () => {
  let app: App;
  let database: Firestore;

  beforeAll(() => {
    app = initializeApp({ projectId: 'demo-lingoflash' }, 'card-persistence-integration');
    database = getFirestore(app, DATABASE_ID);
  });

  afterAll(async () => {
    await database.terminate();
    await deleteApp(app);
  });

  const newOwner = async () => {
    const ownerId = `card-identity-${randomUUID()}`;
    await database.doc(`users/${ownerId}/profile/library_state`).set({ libraryEpoch: 0 });
    return ownerId;
  };
  const cardIdOf = (result: { card: { id?: unknown } }) => String(result.card.id);
  const deleteCard = async (ownerId: string, cardId: string, revision: number) => {
    const result = await applyBulkCardMutationsForOwner(database, ownerId, {
      libraryEpoch: 0, patches: [], deletes: [{ cardId, baseRevision: revision, opId: `delete-${randomUUID()}` }],
    });
    expect(result.results[0]).toMatchObject({ op: 'delete', applied: true });
  };
  const exists = async (ownerId: string, cardId: string) => (await database.doc(`users/${ownerId}/cards/${cardId}`).get()).exists;

  describe('starter cards', () => {
    it('writes the other starter cards when the learner owns one word and deleted another', async () => {
      const ownerId = await newOwner();
      const water = await createCardForOwner(database, ownerId, word('water', 'nước'));
      const hello = await createCardForOwner(database, ownerId, word('hello', 'xin chào'));
      await deleteCard(ownerId, cardIdOf(hello), 1);

      const result = await createStarterCardsForOwner(database, ownerId, 'starter-en-vi', starterBatch, now, PILOT_CONFIG_DEFAULTS);

      expect(result.kind).toBe('created');
      if (result.kind !== 'created') return;
      expect(result.createdCardIds).toHaveLength(3);
      expect(result.cardIds).toHaveLength(4);
      expect(result.cardIds).toContain(cardIdOf(water));
      expect(result.cardIds).not.toContain(cardIdOf(hello));
      expect(await exists(ownerId, cardIdOf(hello))).toBe(false);
      const usage = await database.doc(`users/${ownerId}/ai_usage/${PILOT_PERIOD_KEY}`).get();
      expect(usage.data()?.used).toBe(3);
    });

    it('replays only the starter cards that still exist', async () => {
      const ownerId = await newOwner();
      const first = await createStarterCardsForOwner(database, ownerId, 'starter-en-vi', starterBatch, now, PILOT_CONFIG_DEFAULTS);
      expect(first.kind).toBe('created');
      await deleteCard(ownerId, first.cardIds[0], 1);

      const again = await createStarterCardsForOwner(database, ownerId, 'starter-en-vi', starterBatch, now, PILOT_CONFIG_DEFAULTS);

      expect(again).toEqual({ kind: 'completed', cardIds: first.cardIds.slice(1) });
    });
  });
});
