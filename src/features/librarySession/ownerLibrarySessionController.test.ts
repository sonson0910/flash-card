import { describe, expect, it, vi } from 'vitest';
import type { CardData } from '../../types/card';
import {
  createOwnerLibrarySessionController,
  getLegacyMigrationIssue,
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

const fakeAdapter = (): OwnerLibrarySessionAdapter & {
  emitDecks(ownerId: string, decks: unknown[] | null): void;
  emitDeckError(ownerId: string, error: unknown): void;
  unsubscriptions: string[];
  queuedCards: Array<{ ownerId: string; epoch: number; cards: CardData[] }>;
  seededDecks: Array<{ ownerId: string; decks: string[] }>;
} => {
  const deckListeners = new Map<string, (decks: unknown[] | null) => void>();
  const deckErrorListeners = new Map<string, (error: unknown) => void>();
  const unsubscriptions: string[] = [];
  const queuedCards: Array<{ ownerId: string; epoch: number; cards: CardData[] }> = [];
  const seededDecks: Array<{ ownerId: string; decks: string[] }> = [];
  return {
    available: true,
    queueCardMigration: async (ownerId, cards, epoch) => { queuedCards.push({ ownerId, cards, epoch }); },
    seedDeckProfile: async (ownerId, decks) => { seededDecks.push({ ownerId, decks }); },
    subscribeDeckProfile: (ownerId, onDecks, onError) => {
      deckListeners.set(ownerId, onDecks);
      deckErrorListeners.set(ownerId, onError);
      return () => { unsubscriptions.push(ownerId); };
    },
    getLegacyMigrationProgress: async () => ({ scanned: 0, complete: true }),
    migrateLegacyCards: async () => ({ migrated: 0, scanned: 0, complete: true }),
    emitDecks: (ownerId, decks) => deckListeners.get(ownerId)?.(decks),
    emitDeckError: (ownerId, error) => deckErrorListeners.get(ownerId)?.(error),
    unsubscriptions,
    queuedCards,
    seededDecks,
  };
};

describe('owner library session controller', () => {
  it('discards active and pending-adoption cards on explicit clear', async () => {
    const cache = new MemoryCache();
    cache.cards = [card('private-card')];
    const adapter = fakeAdapter();
    const controller = createOwnerLibrarySessionController({ adapter, cache });

    controller.activate({ ownerId: 'owner-a', libraryEpoch: null, cloudTotal: 0 });
    expect(controller.getSnapshot().cards).toHaveLength(1);

    controller.discardCards();

    expect(cache.readCards().cards).toEqual([]);
    expect(controller.getSnapshot().cards).toEqual([]);

    controller.activate({ ownerId: 'owner-a', libraryEpoch: 7, cloudTotal: 0 });
    await vi.waitFor(() => expect(controller.getSnapshot().status).toBe('ready'));
    expect(adapter.queuedCards).toEqual([]);
  });

  it('adopts anonymous cards and decks for the authenticated owner', async () => {
    const cache = new MemoryCache();
    cache.cards = [card('bonjour')];
    cache.decks = [' IELTS ', 'IELTS'];
    const adapter = fakeAdapter();
    adapter.getLegacyMigrationProgress = async () => ({ scanned: 3, complete: false });
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

  it('keeps legacy indexing actionable when createdAt exists but query fields are still missing', async () => {
    const cache = new MemoryCache();
    const adapter = fakeAdapter();
    adapter.getLegacyMigrationProgress = async () => ({ scanned: 0, complete: false });
    const controller = createOwnerLibrarySessionController({ adapter, cache });

    controller.activate({ ownerId: 'owner-a', libraryEpoch: 0, cloudTotal: 1 });

    await vi.waitFor(() => expect(controller.getSnapshot().status).toBe('ready'));
    expect(controller.getSnapshot().legacyPending).toBe(1);
  });

  it('keeps the empty verification scan actionable after an exact-size batch', async () => {
    const cache = new MemoryCache();
    const adapter = fakeAdapter();
    adapter.getLegacyMigrationProgress = async () => ({ scanned: 100, complete: false });
    const controller = createOwnerLibrarySessionController({ adapter, cache });

    controller.activate({ ownerId: 'owner-a', libraryEpoch: 0, cloudTotal: 100 });

    await vi.waitFor(() => expect(controller.getSnapshot().status).toBe('ready'));
    expect(controller.getSnapshot().legacyPending).toBe(1);
  });

  it('advances pending progress by scanned cards rather than changed cards', async () => {
    const cache = new MemoryCache();
    const adapter = fakeAdapter();
    adapter.getLegacyMigrationProgress = async () => ({ scanned: 0, complete: false });
    adapter.migrateLegacyCards = async () => ({ migrated: 0, scanned: 100, complete: false });
    const controller = createOwnerLibrarySessionController({ adapter, cache });

    controller.activate({ ownerId: 'owner-a', libraryEpoch: 0, cloudTotal: 101 });
    await vi.waitFor(() => expect(controller.getSnapshot().legacyPending).toBe(101));

    await expect(controller.migrateLegacy()).resolves.toEqual({
      status: 'completed',
      migrated: 0,
      scanned: 100,
      complete: false,
    });
    expect(controller.getSnapshot().legacyPending).toBe(1);
  });

  it('stops browser retries when legacy maintenance requires an administrator access fix', async () => {
    const cache = new MemoryCache();
    const adapter = fakeAdapter();
    const permissionDenied = Object.assign(
      new Error('Missing or insufficient permissions.'),
      { code: 'permission-denied' },
    );
    adapter.getLegacyMigrationProgress = async () => ({ scanned: 0, complete: false });
    adapter.migrateLegacyCards = async () => { throw permissionDenied; };
    const controller = createOwnerLibrarySessionController({ adapter, cache });

    controller.activate({ ownerId: 'owner-a', libraryEpoch: 0, cloudTotal: 1 });
    await vi.waitFor(() => expect(controller.getSnapshot().legacyPending).toBe(1));

    await expect(controller.migrateLegacy()).resolves.toEqual({
      status: 'failed',
      error: permissionDenied,
    });
    const snapshot = controller.getSnapshot();
    expect.soft(snapshot.status).toBe('ready');
    expect.soft(snapshot.legacyPending).toBe(1);
    expect.soft(snapshot.isMigratingLegacy).toBe(false);
    expect.soft(snapshot.error).toBeNull();
    expect.soft(snapshot.legacyIssue).toEqual({
      kind: 'cloud-access',
      retryable: false,
      message: 'Cloud access for this library upgrade was rejected. Your cards are safe; an administrator must update Firebase access before this upgrade can continue.',
    });
  });

  it('keeps an unauthenticated legacy upgrade retryable after signing in again', () => {
    const issue = getLegacyMigrationIssue(Object.assign(new Error('signed out'), {
      code: 'unauthenticated',
    }));

    expect(issue).toEqual({
      kind: 'cloud-access',
      retryable: true,
      message: 'Sign in again to continue this library upgrade. Your cards remain safe.',
    });
  });

  it('explains that a legacy upgrade is paused by the Firestore daily quota', () => {
    const issue = getLegacyMigrationIssue(Object.assign(new Error('Quota limit exceeded.'), {
      code: 'firestore/resource-exhausted',
    }));

    expect(issue).toEqual({
      kind: 'temporary',
      retryable: true,
      message: "Firebase's daily read limit has been reached. Your cards are safe; this upgrade can resume after the quota resets.",
    });
  });

  it('keeps the owner session usable when only the deck profile listener reaches quota', async () => {
    const cache = new MemoryCache();
    const adapter = fakeAdapter();
    const controller = createOwnerLibrarySessionController({ adapter, cache });

    controller.activate({ ownerId: 'owner-a', libraryEpoch: 0, cloudTotal: 0 });
    await vi.waitFor(() => expect(controller.getSnapshot().status).toBe('ready'));
    adapter.emitDeckError('owner-a', Object.assign(new Error('Quota limit exceeded.'), {
      code: 'firestore/resource-exhausted',
    }));

    expect(controller.getSnapshot()).toMatchObject({
      status: 'ready',
      error: "Firebase's daily read limit has been reached. Decks remain available from this device until the quota resets.",
    });
  });

  it('keeps one migration in flight when the same owner total is refreshed', async () => {
    const cache = new MemoryCache();
    const adapter = fakeAdapter();
    const migration = deferred<{ migrated: number; scanned: number; complete: boolean }>();
    adapter.getLegacyMigrationProgress = async () => ({ scanned: 0, complete: false });
    adapter.migrateLegacyCards = () => migration.promise;
    const controller = createOwnerLibrarySessionController({ adapter, cache });

    controller.activate({ ownerId: 'owner-a', libraryEpoch: 0, cloudTotal: 2 });
    await vi.waitFor(() => expect(controller.getSnapshot().legacyPending).toBe(2));
    const first = controller.migrateLegacy();

    await controller.updateContext({ ownerId: 'owner-a', libraryEpoch: 0, cloudTotal: 5 });

    expect(controller.getSnapshot().isMigratingLegacy).toBe(true);
    await expect(controller.migrateLegacy()).resolves.toEqual({ status: 'busy' });
    migration.resolve({ migrated: 2, scanned: 2, complete: true });
    await expect(first).resolves.toMatchObject({ status: 'completed', complete: true });
  });

  it('stops retrying a legacy batch that requires a trusted migration', async () => {
    const cache = new MemoryCache();
    const adapter = fakeAdapter();
    const identityConflict = Object.assign(
      new Error('Card mutation rejected: identity-conflict.'),
      { reason: 'identity-conflict' },
    );
    adapter.getLegacyMigrationProgress = async () => ({ scanned: 0, complete: false });
    adapter.migrateLegacyCards = async () => { throw identityConflict; };
    const controller = createOwnerLibrarySessionController({ adapter, cache });

    controller.activate({ ownerId: 'owner-a', libraryEpoch: 0, cloudTotal: 1 });
    await vi.waitFor(() => expect(controller.getSnapshot().legacyPending).toBe(1));
    await controller.migrateLegacy();

    expect(controller.getSnapshot()).toMatchObject({
      status: 'ready',
      error: null,
      legacyPending: 1,
      legacyIssue: {
        kind: 'trusted-migration',
        retryable: false,
        message: 'Some older cards need a secure one-time migration. Your cards are safe; this repair must run from the administrator migration tool.',
      },
    });
  });

  it('isolates owner B from late owner A work and cleans up A subscription', async () => {
    const cache = new MemoryCache();
    cache.cardsOwnerId = 'owner-a';
    cache.cards = [card('a-card')];
    cache.decksOwnerId = 'owner-a';
    cache.decks = ['A deck'];
    const adapter = fakeAdapter();
    const aProgress = deferred<{ scanned: number; complete: boolean }>();
    adapter.getLegacyMigrationProgress = ownerId => ownerId === 'owner-a'
      ? aProgress.promise
      : Promise.resolve({ scanned: 1, complete: true as const });
    const controller = createOwnerLibrarySessionController({ adapter, cache });

    controller.activate({ ownerId: 'owner-a', libraryEpoch: 1, cloudTotal: 4 });
    controller.activate({ ownerId: 'owner-b', libraryEpoch: 2, cloudTotal: 1 });
    adapter.emitDecks('owner-a', ['late A deck']);
    adapter.emitDecks('owner-b', [' B deck ', 'B deck']);
    aProgress.resolve({ scanned: 0, complete: false });

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
    const progress = deferred<{ scanned: number; complete: boolean }>();
    adapter.getLegacyMigrationProgress = () => progress.promise;
    const controller = createOwnerLibrarySessionController({ adapter, cache });

    const stop = controller.activate({ ownerId: 'owner-a', libraryEpoch: 1, cloudTotal: 2 });
    stop();
    adapter.emitDecks('owner-a', ['late']);
    progress.resolve({ scanned: 0, complete: false });
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
    adapter.getLegacyMigrationProgress = async () => { throw new Error('offline'); };
    adapter.migrateLegacyCards = async () => { throw new Error('migration failed'); };
    const controller = createOwnerLibrarySessionController({ adapter, cache });

    controller.activate({ ownerId: 'owner-b', libraryEpoch: 2, cloudTotal: 4 });
    await vi.waitFor(() => expect(controller.getSnapshot().status).toBe('ready'));

    expect(controller.getSnapshot().cards).toEqual([]);
    expect(controller.getSnapshot()).toMatchObject({
      error: null,
      legacyIssue: {
        kind: 'temporary',
        retryable: true,
      },
    });
    await expect(controller.migrateLegacy()).resolves.toMatchObject({ status: 'failed' });
    expect(controller.getSnapshot()).toMatchObject({
      ownerId: 'owner-b', cards: [], isMigratingLegacy: false, legacyPending: 0,
    });
    expect(controller.getSnapshot()).toMatchObject({
      error: null,
      legacyIssue: {
        kind: 'temporary',
        retryable: true,
      },
    });
  });
});
