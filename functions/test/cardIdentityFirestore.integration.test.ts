import { randomUUID } from 'node:crypto';
import { deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyBulkCardMutationsForOwner } from '../src/bulkCardMutationPersistence.js';
import {
  createCardForOwner,
  createCardV2ForOwner,
  createStarterCardsForOwner,
  renameCardHeadwordForOwner,
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
// A deleted word comes back only with an explicit creation time after its deletion.
const afterDeletion = () => new Date(Date.now() + 60_000).toISOString();

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

  describe('headword correction', () => {
    it('lets the old word be added again after a rename', async () => {
      const ownerId = await newOwner();
      const color = await createCardForOwner(database, ownerId, word('color', 'màu'));
      await renameCardHeadwordForOwner(database, ownerId, {
        cardId: cardIdOf(color), word: 'colour', baseRevision: Number(color.card.revision), libraryEpoch: 0,
      });

      const again = await createCardForOwner(database, ownerId, word('color', 'màu'));

      expect(again.created).toBe(true);
      expect(again.card).toMatchObject({ normalizedWord: 'color' });
      expect(cardIdOf(again)).not.toBe(cardIdOf(color));
      const renamed = await database.doc(`users/${ownerId}/cards/${cardIdOf(color)}`).get();
      expect(renamed.data()).toMatchObject({ normalizedWord: 'colour' });
      // The identity now resolves to the new card on the next create.
      const retry = await createCardForOwner(database, ownerId, word('color', 'màu'));
      expect(retry).toMatchObject({ created: false, card: { id: cardIdOf(again) } });
    });

    it('keeps both words creatable after the renamed card was deleted and the old word re-added', async () => {
      const ownerId = await newOwner();
      const color = await createCardForOwner(database, ownerId, word('color', 'màu'));
      const renamed = await renameCardHeadwordForOwner(database, ownerId, {
        cardId: cardIdOf(color), word: 'colour', baseRevision: Number(color.card.revision), libraryEpoch: 0,
      });
      await deleteCard(ownerId, cardIdOf(color), Number(renamed.card.revision));
      const color2 = await createCardForOwner(database, ownerId, { ...word('color', 'màu'), createdAt: afterDeletion() });
      expect(color2.created).toBe(true);

      const colour = await createCardForOwner(database, ownerId, word('colour', 'màu'));

      expect(colour.created).toBe(true);
      expect(colour.card).toMatchObject({ normalizedWord: 'colour' });
      expect(cardIdOf(colour)).not.toBe(cardIdOf(color2));
    });

    it('renames a typo to a word whose card was deleted earlier', async () => {
      const ownerId = await newOwner();
      const hello = await createCardForOwner(database, ownerId, word('hello', 'xin chào'));
      await deleteCard(ownerId, cardIdOf(hello), 1);
      const typo = await createCardForOwner(database, ownerId, word('helo', 'xin chào'));

      const renamed = await renameCardHeadwordForOwner(database, ownerId, {
        cardId: cardIdOf(typo), word: 'hello', baseRevision: Number(typo.card.revision), libraryEpoch: 0,
      });

      expect(renamed.card).toMatchObject({ id: cardIdOf(typo), normalizedWord: 'hello' });
      const retry = await createCardForOwner(database, ownerId, word('hello', 'xin chào'));
      expect(retry).toMatchObject({ created: false, card: { id: cardIdOf(typo) } });
    });

    it('still refuses a rename onto a word a live card holds', async () => {
      const ownerId = await newOwner();
      await createCardForOwner(database, ownerId, word('hello', 'xin chào'));
      const typo = await createCardForOwner(database, ownerId, word('helo', 'xin chào'));

      await expect(renameCardHeadwordForOwner(database, ownerId, {
        cardId: cardIdOf(typo), word: 'hello', baseRevision: Number(typo.card.revision), libraryEpoch: 0,
      })).rejects.toMatchObject({ reason: 'duplicate-word' });
    });
  });

  describe('capture XP', () => {
    const createV2 = (ownerId: string, text: string, opId: string, createdAt: string) => createCardV2ForOwner(
      database, ownerId, { ...word(text, 'nghĩa'), createdAt },
      { libraryEpoch: 0, opId, timeZone: 'UTC', operationCreatedAt: createdAt, receivedAt: new Date(createdAt) },
    );
    const verifiedXp = async (ownerId: string) => (await database.doc(`users/${ownerId}/profile/stats`).get()).data()?.verifiedXp;

    it('pays the first card of a word once, not again after it is deleted and created anew', async () => {
      const ownerId = await newOwner();
      const first = await createV2(ownerId, 'water', 'create-1', '2026-09-27T01:00:00.000Z');
      expect(first.gamification?.xp).toBe(10);
      expect(await verifiedXp(ownerId)).toBe(10);
      await deleteCard(ownerId, cardIdOf(first), Number(first.card.revision));

      const again = await createV2(ownerId, 'water', 'create-2', afterDeletion());

      expect(again.created).toBe(true);
      expect(again.gamification).toBeNull();
      expect(await verifiedXp(ownerId)).toBe(10);
      const usage = await database.doc(`users/${ownerId}/profile/resource_usage`).get();
      expect(usage.data()?.cardCount).toBe(1);
    });

    it('does not pay again for a word created anew after the library was cleared', async () => {
      const ownerId = await newOwner();
      await createV2(ownerId, 'water', 'create-1', '2026-09-27T01:00:00.000Z');
      await database.doc(`users/${ownerId}/profile/library_state`).set({ libraryEpoch: 1 });

      const again = await createCardV2ForOwner(
        database, ownerId, { ...word('water', 'nghĩa'), createdAt: '2026-09-27T02:00:00.000Z' },
        {
          libraryEpoch: 1, opId: 'create-2', timeZone: 'UTC',
          operationCreatedAt: '2026-09-27T02:00:00.000Z', receivedAt: new Date('2026-09-27T02:00:00.000Z'),
        },
      );

      expect(again.created).toBe(true);
      expect(again.gamification).toBeNull();
      expect(await verifiedXp(ownerId)).toBe(10);
    });
  });
});
