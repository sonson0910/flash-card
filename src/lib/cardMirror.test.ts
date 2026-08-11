import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CardData } from '../types/card';
import { type CardQueryState } from './cardQuery';
import {
  beginCardMirrorSync,
  clearMirroredCards,
  closeCardMirrorForTests,
  deleteMirroredCard,
  deleteMirroredCardIfNotNewerThan,
  deleteMirroredCardIfOlderThan,
  findMirroredCardByWord,
  finishCardMirrorSync,
  getCardMirrorStatus,
  invalidateCardMirrorGeneration,
  isCardMirrorFresh,
  patchMirroredCardBatch,
  queryMirroredCardPage,
  upsertMirroredCardIfNotOlderThan,
  upsertMirroredCardBatch,
} from './cardMirror';

const DATABASE_NAME = 'sonflash-card-mirror';

const transactionDone = (transaction: IDBTransaction) => new Promise<void>((resolve, reject) => {
  transaction.oncomplete = () => resolve();
  transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted.'));
  transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed.'));
});

const deleteMirrorDatabase = () => new Promise<void>((resolve, reject) => {
  const request = indexedDB.deleteDatabase(DATABASE_NAME);
  request.onsuccess = () => resolve();
  request.onerror = () => reject(request.error ?? new Error('Could not delete test mirror.'));
  request.onblocked = () => reject(new Error('Test mirror deletion was blocked.'));
});

const createRawMirror = (
  version: number,
  seed: CardData & { userId: string; generation: string; mirrorKey: string; activityAt?: string },
) => new Promise<void>((resolve, reject) => {
  const request = indexedDB.open(DATABASE_NAME, version);
  request.onupgradeneeded = () => {
    const database = request.result;
    const cards = database.createObjectStore('cards', { keyPath: 'mirrorKey' });
    cards.createIndex('userId', 'userId');
    cards.createIndex('userNormalizedWord', ['userId', 'normalizedWord']);
    cards.createIndex('userCreatedAt', ['userId', 'createdAt', 'id']);
    if (version >= 2) cards.createIndex('userActivityAt', ['userId', 'activityAt', 'id']);
    database.createObjectStore('sync-meta', { keyPath: 'userId' });
  };
  request.onerror = () => reject(request.error ?? new Error('Could not create raw test mirror.'));
  request.onsuccess = async () => {
    const database = request.result;
    try {
      const transaction = database.transaction('cards', 'readwrite');
      transaction.objectStore('cards').put(seed);
      await transactionDone(transaction);
      database.close();
      resolve();
    } catch (error) {
      database.close();
      reject(error);
    }
  };
});

const filters: CardQueryState = {
  category: null,
  customDeck: null,
  difficulty: null,
  partOfSpeech: null,
  bookmarkedOnly: false,
  createdDate: null,
  wordPrefix: '',
};

const card = (index: number): CardData => ({
  id: `card-${index}`,
  word: `word ${index}`,
  normalizedWord: `word ${index}`,
  translation: `nghĩa ${index}`,
  explanation: '',
  phonetic: '',
  emoji: '📚',
  category: index % 2 ? 'Odd' : 'Even',
  audioUrl: null,
  imageUrl: null,
  createdAt: new Date(2026, 0, 1, 0, index).toISOString(),
  bookmarked: false,
  difficulty: 'unrated',
  customDeck: null,
});

describe('IndexedDB card mirror', () => {
  beforeEach(async () => {
    closeCardMirrorForTests();
    await deleteMirrorDatabase();
  });

  it('backfills v1 cards so the activity index includes them after upgrade', async () => {
    const legacy = {
      ...card(1),
      userId: 'user-a',
      generation: 'legacy',
      mirrorKey: JSON.stringify(['user-a', 'card-1']),
      createdAt: '2026-01-01T00:00:00.000Z',
      lastOpenedAt: '2026-07-30T00:00:00.000Z',
    };
    await createRawMirror(1, legacy);

    await expect(queryMirroredCardPage('user-a', filters, 1, 9)).resolves.toMatchObject({
      items: [expect.objectContaining({ id: 'card-1' })],
      total: 1,
    });
  });

  it('opens a compatible newer mirror without deleting or downgrading it after app rollback', async () => {
    const futureCard = {
      ...card(2),
      userId: 'user-a',
      generation: 'future',
      mirrorKey: JSON.stringify(['user-a', 'card-2']),
      activityAt: '2026-08-01T00:00:00.000Z',
    };
    await createRawMirror(3, futureCard);

    await expect(queryMirroredCardPage('user-a', filters, 1, 9)).resolves.toMatchObject({
      items: [expect.objectContaining({ id: 'card-2' })],
      total: 1,
    });
    closeCardMirrorForTests();
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DATABASE_NAME);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    expect(database.version).toBe(3);
    database.close();
  });

  it('stores a complete library in bounded batches and queries one page', async () => {
    const generation = await beginCardMirrorSync('user-a', 125);
    await upsertMirroredCardBatch('user-a', Array.from({ length: 100 }, (_, index) => card(index)), generation);
    await upsertMirroredCardBatch('user-a', Array.from({ length: 25 }, (_, index) => card(index + 100)), generation);
    await finishCardMirrorSync('user-a', generation, 125);

    await expect(getCardMirrorStatus('user-a')).resolves.toMatchObject({
      complete: true,
      loaded: 125,
      expectedTotal: 125,
    });
    const page = await queryMirroredCardPage('user-a', filters, 2, 9);
    expect(page?.items).toHaveLength(9);
    expect(page?.total).toBe(125);
    expect(page?.hasNext).toBe(true);
  });

  it('does not scan the full mirror for an unfiltered page', async () => {
    const generation = await beginCardMirrorSync('user-a', 125);
    await upsertMirroredCardBatch('user-a', Array.from({ length: 100 }, (_, index) => card(index)), generation);
    await upsertMirroredCardBatch('user-a', Array.from({ length: 25 }, (_, index) => card(index + 100)), generation);
    await finishCardMirrorSync('user-a', generation, 125);
    const continueSpy = vi.spyOn(IDBCursor.prototype, 'continue');

    const page = await queryMirroredCardPage('user-a', filters, 2, 9);

    expect(page?.items).toHaveLength(9);
    expect(continueSpy).toHaveBeenCalledTimes(8);
    continueSpy.mockRestore();
  });

  it('finds an exact normalized word without exposing another user', async () => {
    const generationA = await beginCardMirrorSync('user-a', 1);
    const generationB = await beginCardMirrorSync('user-b', 1);
    await upsertMirroredCardBatch('user-a', [card(7)], generationA);
    await upsertMirroredCardBatch('user-b', [{ ...card(7), id: 'private-b', translation: 'private' }], generationB);
    await finishCardMirrorSync('user-a', generationA, 1);
    await finishCardMirrorSync('user-b', generationB, 1);

    await expect(findMirroredCardByWord('user-a', '  WORD   7 ')).resolves.toMatchObject({
      id: 'card-7',
      translation: 'nghĩa 7',
    });
  });

  it('keeps the last mirror usable until an interrupted generation completes', async () => {
    const firstGeneration = await beginCardMirrorSync('user-a', 2);
    await upsertMirroredCardBatch('user-a', [card(1), card(2)], firstGeneration);
    await finishCardMirrorSync('user-a', firstGeneration, 2);

    const nextGeneration = await beginCardMirrorSync('user-a', 1);
    await upsertMirroredCardBatch('user-a', [card(1)], nextGeneration);
    expect((await queryMirroredCardPage('user-a', filters, 1, 9))?.total).toBe(2);

    await finishCardMirrorSync('user-a', nextGeneration, 1);
    expect((await queryMirroredCardPage('user-a', filters, 1, 9))?.total).toBe(1);
  });

  it('stays fresh when duplicate cloud documents collapse into one local word', async () => {
    const generation = await beginCardMirrorSync('user-a', 2);
    await upsertMirroredCardBatch('user-a', [
      card(8),
      { ...card(8), id: 'duplicate-8', difficulty: 'good' },
    ], generation);
    await finishCardMirrorSync('user-a', generation, 2);

    const status = await getCardMirrorStatus('user-a');
    expect(status).toMatchObject({ complete: true, loaded: 1, expectedTotal: 2 });
    expect(isCardMirrorFresh(status, 2)).toBe(true);
  });

  it('binds freshness to the synced library epoch and invalidates only the active generation', async () => {
    const generation = await beginCardMirrorSync('user-a', 1, 2);
    await upsertMirroredCardBatch('user-a', [{
      ...card(12),
      libraryEpoch: 2,
      revision: 1,
    }], generation);
    await finishCardMirrorSync('user-a', generation, 1);

    const status = await getCardMirrorStatus('user-a');
    expect(status).toMatchObject({ complete: true, syncing: false, libraryEpoch: 2 });
    expect(isCardMirrorFresh(status, 1, Date.now(), 15 * 60 * 1000, 2)).toBe(true);
    expect(isCardMirrorFresh(status, 1, Date.now(), 15 * 60 * 1000, 3)).toBe(false);

    const nextGeneration = await beginCardMirrorSync('user-a', 1, 3);
    await expect(getCardMirrorStatus('user-a')).resolves.toMatchObject({
      complete: false,
      syncing: true,
      generation: nextGeneration,
      libraryEpoch: 3,
    });
    await expect(invalidateCardMirrorGeneration('user-a', generation)).resolves.toBe(false);
    await expect(invalidateCardMirrorGeneration('user-a', nextGeneration)).resolves.toBe(true);
    await expect(getCardMirrorStatus('user-a')).resolves.toMatchObject({
      complete: false,
      syncing: false,
      generation: nextGeneration,
      libraryEpoch: 3,
    });
  });

  it('updates and deletes individual mirrored cards', async () => {
    const generation = await beginCardMirrorSync('user-a', 1);
    await upsertMirroredCardBatch('user-a', [card(4)], generation);
    await finishCardMirrorSync('user-a', generation, 1);
    await upsertMirroredCardBatch('user-a', [{ ...card(4), bookmarked: true }]);
    await expect(findMirroredCardByWord('user-a', 'word 4')).resolves.toMatchObject({ bookmarked: true });
    await upsertMirroredCardBatch('user-a', [card(5)]);
    await expect(getCardMirrorStatus('user-a')).resolves.toMatchObject({ loaded: 2, expectedTotal: 2 });

    await deleteMirroredCard('user-a', 'card-4');
    await expect(findMirroredCardByWord('user-a', 'word 4')).resolves.toBeNull();
    await expect(getCardMirrorStatus('user-a')).resolves.toMatchObject({ loaded: 1, expectedTotal: 1 });
  });

  it('deletes only an older-generation mirror and preserves a recreated same-id card', async () => {
    const older = { ...card(6), libraryEpoch: 1 };
    await upsertMirroredCardBatch('user-a', [older]);

    await expect(deleteMirroredCardIfOlderThan('user-a', older.id, 2)).resolves.toBe(true);
    await expect(findMirroredCardByWord('user-a', older.word)).resolves.toBeNull();

    const recreated = { ...older, libraryEpoch: 2, translation: 'current generation' };
    await upsertMirroredCardBatch('user-a', [recreated]);

    await expect(deleteMirroredCardIfOlderThan('user-a', recreated.id, 2)).resolves.toBe(false);
    await expect(findMirroredCardByWord('user-a', recreated.word)).resolves.toMatchObject({
      id: recreated.id,
      libraryEpoch: 2,
      translation: 'current generation',
    });
  });

  it('preserves a same-epoch mirror whose revision is newer than a missing patch', async () => {
    const recreated = { ...card(7), libraryEpoch: 2, revision: 5 };
    await upsertMirroredCardBatch('user-a', [recreated]);

    await expect(deleteMirroredCardIfNotNewerThan('user-a', recreated.id, {
      libraryEpoch: 2,
      revision: 4,
    })).resolves.toBe(false);
    await expect(findMirroredCardByWord('user-a', recreated.word)).resolves.toMatchObject({
      id: recreated.id,
      libraryEpoch: 2,
      revision: 5,
    });

    await expect(deleteMirroredCardIfNotNewerThan('user-a', recreated.id, {
      libraryEpoch: 2,
      revision: 5,
    })).resolves.toBe(true);
    await expect(findMirroredCardByWord('user-a', recreated.word)).resolves.toBeNull();
  });

  it('guarded upsert preserves a newer same-id mirror generation and revision', async () => {
    const current = {
      ...card(11),
      word: 'current mirror',
      normalizedWord: 'current mirror',
      libraryEpoch: 3,
      revision: 7,
    };
    await upsertMirroredCardBatch('user-a', [current]);

    await expect(upsertMirroredCardIfNotOlderThan('user-a', {
      ...current,
      translation: 'stale generation',
      libraryEpoch: 2,
      revision: 99,
    })).resolves.toBe(false);
    await expect(upsertMirroredCardIfNotOlderThan('user-a', {
      ...current,
      translation: 'stale revision',
      revision: 6,
    })).resolves.toBe(false);

    await expect(findMirroredCardByWord('user-a', current.word)).resolves.toMatchObject({
      translation: current.translation,
      libraryEpoch: 3,
      revision: 7,
    });
  });

  it('reconciles same-word ids without comparing revisions and preserves a newer epoch', async () => {
    const candidate = {
      ...card(14),
      id: 'optimistic-id',
      word: 'shared identity',
      normalizedWord: 'shared identity',
      translation: 'optimistic',
      libraryEpoch: 2,
      revision: 99,
    };
    const authoritative = {
      ...candidate,
      id: 'authoritative-id',
      translation: 'cloud',
      revision: 1,
    };
    await upsertMirroredCardBatch('user-a', [candidate]);

    await expect(
      upsertMirroredCardIfNotOlderThan('user-a', authoritative),
    ).resolves.toBe(true);
    await expect(queryMirroredCardPage('user-a', filters, 1, 9)).resolves.toMatchObject({
      items: [expect.objectContaining({
        id: authoritative.id,
        translation: authoritative.translation,
      })],
      total: 1,
    });

    const future = {
      ...candidate,
      id: 'future-id',
      translation: 'future local generation',
      libraryEpoch: 3,
      revision: 1,
    };
    await upsertMirroredCardBatch('user-a', [future]);

    await expect(
      upsertMirroredCardIfNotOlderThan('user-a', authoritative),
    ).resolves.toBe(false);
    await expect(queryMirroredCardPage('user-a', filters, 1, 9)).resolves.toMatchObject({
      items: [expect.objectContaining({
        id: future.id,
        libraryEpoch: 3,
        translation: future.translation,
      })],
      total: 1,
    });
  });

  it('invalidates an active older-epoch sync instead of retagging a newer card as fresh', async () => {
    const newer = {
      ...card(13),
      word: 'newer local generation',
      normalizedWord: 'newer local generation',
      libraryEpoch: 3,
      revision: 1,
    };
    await upsertMirroredCardBatch('user-a', [newer]);
    const generation = await beginCardMirrorSync('user-a', 1, 2);

    await expect(upsertMirroredCardIfNotOlderThan('user-a', {
      ...newer,
      translation: 'older cloud generation',
      libraryEpoch: 2,
      revision: 99,
    })).resolves.toBe(false);

    await expect(getCardMirrorStatus('user-a')).resolves.toMatchObject({
      complete: false,
      syncing: false,
      generation,
      libraryEpoch: 2,
    });
    await expect(finishCardMirrorSync('user-a', generation, 1)).resolves.toBe(false);
    await expect(findMirroredCardByWord('user-a', newer.word)).resolves.toMatchObject({
      libraryEpoch: 3,
      revision: 1,
      translation: newer.translation,
    });
  });

  it('orders unfiltered pages by recent library activity instead of immutable creation time', async () => {
    const oldReopened = {
      ...card(1),
      id: 'old-reopened',
      word: 'consider',
      normalizedWord: 'consider',
      createdAt: '2026-01-01T00:00:00.000Z',
      sortTouchedAt: '2026-07-28T10:00:00.000Z',
    };
    const newCreated = {
      ...card(2),
      id: 'new-created',
      word: 'fresh',
      normalizedWord: 'fresh',
      createdAt: '2026-07-28T09:00:00.000Z',
    };

    await upsertMirroredCardBatch('user-a', [newCreated, oldReopened]);

    await expect(queryMirroredCardPage('user-a', filters, 1, 9)).resolves.toMatchObject({
      items: [
        expect.objectContaining({ id: 'old-reopened', createdAt: '2026-01-01T00:00:00.000Z' }),
        expect.objectContaining({ id: 'new-created' }),
      ],
    });
  });

  it('reapplies a pending field patch after a stale cloud sync batch', async () => {
    const generation = await beginCardMirrorSync('user-a', 1);
    await upsertMirroredCardBatch('user-a', [card(4)], generation);

    await patchMirroredCardBatch('user-a', [{ cardId: 'card-4', fields: { bookmarked: true } }], generation);
    await finishCardMirrorSync('user-a', generation, 1);

    await expect(findMirroredCardByWord('user-a', 'word 4')).resolves.toMatchObject({ bookmarked: true });
  });

  it('preserves unrelated learning fields and never recreates a deleted mirror card from a patch', async () => {
    const reviewed = { ...card(4), bookmarked: true, reviews: 7, correctStreak: 3 };
    await upsertMirroredCardBatch('user-a', [reviewed]);

    await patchMirroredCardBatch('user-a', [{
      cardId: reviewed.id,
      fields: { imageUrl: 'https://images.pexels.com/word.jpeg' },
    }]);
    await expect(findMirroredCardByWord('user-a', reviewed.word)).resolves.toMatchObject({
      reviews: 7,
      correctStreak: 3,
      bookmarked: true,
      imageUrl: 'https://images.pexels.com/word.jpeg',
    });

    await deleteMirroredCard('user-a', reviewed.id);
    await patchMirroredCardBatch('user-a', [{ cardId: reviewed.id, fields: { bookmarked: false } }]);
    await expect(findMirroredCardByWord('user-a', reviewed.word)).resolves.toBeNull();
  });

  it('rejects oversized batches so sync cannot accidentally retain the full library', async () => {
    const generation = await beginCardMirrorSync('user-a', 101);
    await expect(upsertMirroredCardBatch(
      'user-a',
      Array.from({ length: 101 }, (_, index) => card(index)),
      generation,
    )).rejects.toThrow('at most 100');
  });

  it('rejects stale sync batches after the mirror is cleared', async () => {
    const staleGeneration = await beginCardMirrorSync('user-a', 1);
    await clearMirroredCards('user-a');

    await upsertMirroredCardBatch('user-a', [card(9)], staleGeneration);
    await finishCardMirrorSync('user-a', staleGeneration, 1);

    await expect(findMirroredCardByWord('user-a', 'word 9')).resolves.toBeNull();
    await expect(getCardMirrorStatus('user-a')).resolves.toBeNull();
  });

  it('does not let a stale finish recreate mirror metadata after clear', async () => {
    const staleGeneration = await beginCardMirrorSync('user-a', 1);
    await upsertMirroredCardBatch('user-a', [card(10)], staleGeneration);
    await clearMirroredCards('user-a');

    await finishCardMirrorSync('user-a', staleGeneration, 1);

    await expect(queryMirroredCardPage('user-a', filters, 1, 9)).resolves.toBeNull();
    await expect(getCardMirrorStatus('user-a')).resolves.toBeNull();
  });
});
