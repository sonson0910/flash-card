import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CardData } from '../../types/card';
import {
  createOwnerLibrarySessionController,
  type OwnerLibraryCache,
  type OwnerLibrarySessionAdapter,
} from '../librarySession/ownerLibrarySessionController';
import {
  createIdentitySessionController,
  type IdentityOwner,
  type IdentitySessionAdapter,
} from './identitySessionController';
import {
  closePendingOperationStoreForTests,
  loadStoredPendingOperations,
  updateStoredPendingOperations,
} from '../../lib/pendingOperationStore';

const owner = (id: string): IdentityOwner => ({
  id,
  displayName: id,
  email: `${id}@example.test`,
  photoUrl: null,
});

const card: CardData = {
  id: 'owner-a-card',
  word: 'private',
  translation: 'riêng tư',
  explanation: '',
  phonetic: '',
  emoji: '🔒',
  category: 'Other',
  audioUrl: null,
  imageUrl: null,
};

class MemoryLibraryCache implements OwnerLibraryCache {
  cardsOwnerId: string | null = 'owner-a';
  cards: CardData[] = [card];
  decksOwnerId: string | null = 'owner-a';
  decks: string[] = [];

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
}

const createIdentityAdapter = () => {
  let ownerChanged: ((nextOwner: IdentityOwner | null) => void | Promise<void>) | null = null;
  const adapter: IdentitySessionAdapter = {
    available: true,
    observeOwner: vi.fn(onOwner => {
      ownerChanged = onOwner;
      return () => undefined;
    }),
    signInWithPopup: vi.fn(async () => undefined),
    signInWithRedirect: vi.fn(async () => undefined),
    signOut: vi.fn(async () => undefined),
    readCachedOwnerEpoch: vi.fn(() => null),
    cacheOwnerEpoch: vi.fn(),
    loadOwnerEpoch: vi.fn(async () => 1),
  };
  return {
    adapter,
    emitOwner: (nextOwner: IdentityOwner | null) => ownerChanged?.(nextOwner),
  };
};

const libraryAdapter: OwnerLibrarySessionAdapter = {
  available: false,
  queueCardMigration: vi.fn(async () => undefined),
  seedDeckProfile: vi.fn(async () => undefined),
  subscribeDeckProfile: vi.fn(() => () => undefined),
  getLegacyMigrationProgress: vi.fn(async () => ({ scanned: 0, complete: true })),
  migrateLegacyCards: vi.fn(async () => ({ migrated: 0, scanned: 0, complete: true })),
};

describe('identity, owner library, and pending-operation ownership', () => {
  afterEach(async () => {
    await updateStoredPendingOperations('owner-a', () => []);
    await updateStoredPendingOperations('owner-b', () => []);
    closePendingOperationStoreForTests();
  });

  it('keeps owner A pending review data after sign-out and prevents owner B from seeing or processing it', async () => {
    const pendingReview = {
      opId: 'pending-review-owner-a',
      cardId: card.id,
      operation: 'review',
    };
    await updateStoredPendingOperations('owner-a', () => [pendingReview]);

    const identityAdapter = createIdentityAdapter();
    const identity = createIdentitySessionController({ adapter: identityAdapter.adapter });
    const library = createOwnerLibrarySessionController({
      adapter: libraryAdapter,
      cache: new MemoryLibraryCache(),
    });
    identity.start();

    await identityAdapter.emitOwner(owner('owner-a'));
    const ownerA = identity.getSnapshot().owner;
    expect(ownerA?.id).toBe('owner-a');
    library.activate({ ownerId: ownerA!.id, libraryEpoch: 1, cloudTotal: 0 });
    expect(library.getSnapshot().cards).toEqual([card]);
    await expect(loadStoredPendingOperations(ownerA!.id)).resolves.toEqual([pendingReview]);

    await expect(identity.signOut()).resolves.toMatchObject({ status: 'completed' });
    await identityAdapter.emitOwner(owner('owner-b'));
    const ownerB = identity.getSnapshot().owner;
    expect(ownerB?.id).toBe('owner-b');
    library.activate({ ownerId: ownerB!.id, libraryEpoch: 2, cloudTotal: 0 });

    expect(library.getSnapshot().cards).toEqual([]);
    await expect(loadStoredPendingOperations(ownerB!.id)).resolves.toEqual([]);
    await expect(loadStoredPendingOperations(ownerA!.id)).resolves.toEqual([pendingReview]);
    expect(libraryAdapter.queueCardMigration).not.toHaveBeenCalled();
  });
});
