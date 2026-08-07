import { describe, expect, it, vi } from 'vitest';
import type { CardData } from '../../types/card';
import {
  createOwnerLibrarySessionController,
  type OwnerLibraryCache,
  type OwnerLibrarySessionAdapter,
} from './ownerLibrarySessionController';

const card = (id: string): CardData => ({
  id,
  word: id,
  translation: id,
  explanation: '',
  phonetic: '',
  emoji: '📝',
  category: 'Other',
  audioUrl: null,
  imageUrl: null,
});

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

class MemoryCache implements OwnerLibraryCache {
  cardsOwnerId: string | null = null;
  cards: CardData[] = [];
  decksOwnerId: string | null = null;
  decks: string[] = [];
  migrated = new Set<string>();

  readCards = () => ({ ownerId: this.cardsOwnerId, cards: this.cards });
  writeCards = (ownerId: string, cards: CardData[]) => {
    this.cardsOwnerId = ownerId;
    this.cards = cards;
  };
  discardCards = () => { this.cards = []; };
  readDecks = () => ({ ownerId: this.decksOwnerId, decks: this.decks });
  writeDecks = (ownerId: string, decks: string[]) => {
    this.decksOwnerId = ownerId;
    this.decks = decks;
  };
  discardDecks = () => { this.decks = []; };
  hasCompletedLegacyMigration = (ownerId: string) => this.migrated.has(ownerId);
  markLegacyMigrationComplete = (ownerId: string) => { this.migrated.add(ownerId); };
}

const fakeAdapter = (): OwnerLibrarySessionAdapter & {
  emitDecks(ownerId: string, decks: unknown[] | null): void;
  unsubscriptions: string[];
  queuedCards: Array<{ ownerId: string; epoch: number; cards: CardData[] }>;
  seededDecks: Array<{ ownerId: string; decks: string[] }>;
} => {
  const deckListeners = new Map<string, (decks: unknown[] | null) => void>();
  const unsubscriptions: string[] = [];
  const queuedCards: Array<{ ownerId: string; epoch: number; cards: CardData[] }> = [];
  const seededDecks: Array<{ ownerId: string; decks: string[] }> = [];
  return {
    available: true,
    queueCardMigration: async (ownerId, cards, epoch) => { queuedCards.push({ ownerId, cards, epoch }); },
    seedDeckProfile: async (ownerId, decks) => { seededDecks.push({ ownerId, decks }); },
    subscribeDeckProfile: (ownerId, onDecks) => {
      deckListeners.set(ownerId, onDecks);
      return () => { unsubscriptions.push(ownerId); };
    },
    countPageableCards: async () => 0,
    migrateLegacyCards: async () => ({ migrated: 0, complete: true }),
    emitDecks: (ownerId, decks) => deckListeners.get(ownerId)?.(decks),
    unsubscriptions,
    queuedCards,
    seededDecks,
  };
};

describe('owner library session controller', () => {
  it('adopts anonymous cards and decks for the authenticated owner', async () => {
    const cache = new MemoryCache();
    cache.cards = [card('bonjour')];
    cache.decks = [' IELTS ', 'IELTS'];
    const adapter = fakeAdapter();
    adapter.countPageableCards = async () => 3;
    const controller = createOwnerLibrarySessionController({ adapter, cache });

    controller.activate({ ownerId: 'owner-a', libraryEpoch: 7, cloudTotal: 5 });

    await vi.waitFor(() => expect(controller.getSnapshot().status).toBe('ready'));
    expect(controller.getSnapshot()).toMatchObject({
      ownerId: 'owner-a',
      cards: [expect.objectContaining({ id: 'bonjour' })],
      decks: ['IELTS'],
      legacyPending: 2,
    });
    expect(adapter.queuedCards).toEqual([{
      ownerId: 'owner-a', epoch: 7, cards: [expect.objectContaining({ id: 'bonjour' })],
    }]);
    expect(adapter.seededDecks).toEqual([{ ownerId: 'owner-a', decks: ['IELTS'] }]);
    expect(cache.cardsOwnerId).toBe('owner-a');
    expect(cache.decksOwnerId).toBe('owner-a');
  });

  it('isolates owner B from late owner A work and cleans up A subscription', async () => {
    const cache = new MemoryCache();
    cache.cardsOwnerId = 'owner-a';
    cache.cards = [card('a-card')];
    cache.decksOwnerId = 'owner-a';
    cache.decks = ['A deck'];
    const adapter = fakeAdapter();
    const aCount = deferred<number>();
    adapter.countPageableCards = ownerId => ownerId === 'owner-a' ? aCount.promise : Promise.resolve(1);
    const controller = createOwnerLibrarySessionController({ adapter, cache });

    controller.activate({ ownerId: 'owner-a', libraryEpoch: 1, cloudTotal: 4 });
    controller.activate({ ownerId: 'owner-b', libraryEpoch: 2, cloudTotal: 1 });
    adapter.emitDecks('owner-a', ['late A deck']);
    adapter.emitDecks('owner-b', [' B deck ', 'B deck']);
    aCount.resolve(0);

    await vi.waitFor(() => expect(controller.getSnapshot().status).toBe('ready'));
    expect(adapter.unsubscriptions).toContain('owner-a');
    expect(controller.getSnapshot()).toMatchObject({
      ownerId: 'owner-b', cards: [], decks: ['B deck'], legacyPending: 0,
    });
    expect(cache.cards).toEqual([]);
    expect(cache.decks).toEqual(['B deck']);
  });

  it('stops publication after cleanup', async () => {
    const cache = new MemoryCache();
    const adapter = fakeAdapter();
    const count = deferred<number>();
    adapter.countPageableCards = () => count.promise;
    const controller = createOwnerLibrarySessionController({ adapter, cache });

    const stop = controller.activate({ ownerId: 'owner-a', libraryEpoch: 1, cloudTotal: 2 });
    stop();
    adapter.emitDecks('owner-a', ['late']);
    count.resolve(0);
    await Promise.resolve();

    expect(adapter.unsubscriptions).toEqual(['owner-a']);
    expect(controller.getSnapshot().ownerId).toBeNull();
    expect(controller.getSnapshot().decks).toEqual([]);
  });

  it('keeps the active owner isolated and reports adapter failures', async () => {
    const cache = new MemoryCache();
    cache.cardsOwnerId = 'owner-a';
    cache.cards = [card('private-a')];
    const adapter = fakeAdapter();
    adapter.countPageableCards = async () => { throw new Error('offline'); };
    adapter.migrateLegacyCards = async () => { throw new Error('migration failed'); };
    const controller = createOwnerLibrarySessionController({ adapter, cache });

    controller.activate({ ownerId: 'owner-b', libraryEpoch: 2, cloudTotal: 4 });
    await vi.waitFor(() => expect(controller.getSnapshot().status).toBe('error'));

    expect(controller.getSnapshot().cards).toEqual([]);
    expect(controller.getSnapshot().error).toContain('legacy card status');
    await expect(controller.migrateLegacy()).resolves.toMatchObject({ status: 'failed' });
    expect(controller.getSnapshot()).toMatchObject({
      ownerId: 'owner-b', cards: [], isMigratingLegacy: false, legacyPending: 0,
    });
    expect(controller.getSnapshot().error).toContain('legacy card batch');
  });
});
