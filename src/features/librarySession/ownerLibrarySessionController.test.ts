import { describe, expect, it, vi } from 'vitest';
import {
  createOwnerLibrarySessionController,
  getLegacyMigrationIssue,
  type OwnerLibrarySessionAdapter,
} from './ownerLibrarySessionController';

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

const fakeAdapter = (): OwnerLibrarySessionAdapter & {
  emitDecks(ownerId: string, profile: unknown | null): void;
  emitDeckError(ownerId: string, error: unknown): void;
  unsubscriptions: string[];
} => {
  const deckListeners = new Map<string, (profile: unknown | null) => void>();
  const deckErrorListeners = new Map<string, (error: unknown) => void>();
  const unsubscriptions: string[] = [];
  return {
    available: true,
    subscribeDeckProfile: (ownerId, onDecks, onError) => {
      deckListeners.set(ownerId, onDecks);
      deckErrorListeners.set(ownerId, onError);
      return () => { unsubscriptions.push(ownerId); };
    },
    getLegacyMigrationProgress: async () => ({ scanned: 0, complete: true }),
    migrateLegacyCards: async () => ({ migrated: 0, scanned: 0, complete: true }),
    emitDecks: (ownerId, profile) => deckListeners.get(ownerId)?.(profile),
    emitDeckError: (ownerId, error) => deckErrorListeners.get(ownerId)?.(error),
    unsubscriptions,
  };
};

describe('owner library session controller', () => {
  it('subscribes to the deck profile and normalizes incoming deck names', async () => {
    const adapter = fakeAdapter();
    const controller = createOwnerLibrarySessionController({ adapter });

    controller.activate({ ownerId: 'owner-a', libraryEpoch: 7, cloudTotal: 0 });
    await vi.waitFor(() => expect(controller.getSnapshot().status).toBe('ready'));
    adapter.emitDecks('owner-a', { decks: [' IELTS ', 'IELTS'] });

    expect(controller.getSnapshot()).toMatchObject({ ownerId: 'owner-a', decks: ['IELTS'] });
  });

  it('keeps only valid presets for active deck names', async () => {
    const adapter = fakeAdapter();
    const controller = createOwnerLibrarySessionController({ adapter });

    controller.activate({ ownerId: 'owner-a', libraryEpoch: 7, cloudTotal: 0 });
    await vi.waitFor(() => expect(controller.getSnapshot().status).toBe('ready'));
    adapter.emitDecks('owner-a', {
      decks: ['IELTS'],
      coverPresets: { d_SUVMVFM: 'violet', orphan: 'moss' },
    });

    expect(controller.getSnapshot().coverPresets).toEqual({ d_SUVMVFM: 'violet' });
  });

  it('keeps legacy indexing actionable when createdAt exists but query fields are still missing', async () => {
    const adapter = fakeAdapter();
    adapter.getLegacyMigrationProgress = async () => ({ scanned: 0, complete: false });
    const controller = createOwnerLibrarySessionController({ adapter });

    controller.activate({ ownerId: 'owner-a', libraryEpoch: 0, cloudTotal: 1 });

    await vi.waitFor(() => expect(controller.getSnapshot().status).toBe('ready'));
    expect(controller.getSnapshot().legacyPending).toBe(1);
  });

  it('keeps the empty verification scan actionable after an exact-size batch', async () => {
    const adapter = fakeAdapter();
    adapter.getLegacyMigrationProgress = async () => ({ scanned: 100, complete: false });
    const controller = createOwnerLibrarySessionController({ adapter });

    controller.activate({ ownerId: 'owner-a', libraryEpoch: 0, cloudTotal: 100 });

    await vi.waitFor(() => expect(controller.getSnapshot().status).toBe('ready'));
    expect(controller.getSnapshot().legacyPending).toBe(1);
  });

  it('advances pending progress by scanned cards rather than changed cards', async () => {
    const adapter = fakeAdapter();
    adapter.getLegacyMigrationProgress = async () => ({ scanned: 0, complete: false });
    adapter.migrateLegacyCards = async () => ({ migrated: 0, scanned: 100, complete: false });
    const controller = createOwnerLibrarySessionController({ adapter });

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
    const adapter = fakeAdapter();
    const permissionDenied = Object.assign(
      new Error('Missing or insufficient permissions.'),
      { code: 'permission-denied' },
    );
    adapter.getLegacyMigrationProgress = async () => ({ scanned: 0, complete: false });
    adapter.migrateLegacyCards = async () => { throw permissionDenied; };
    const controller = createOwnerLibrarySessionController({ adapter });

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
    const adapter = fakeAdapter();
    const controller = createOwnerLibrarySessionController({ adapter });

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
    const adapter = fakeAdapter();
    const migration = deferred<{ migrated: number; scanned: number; complete: boolean }>();
    adapter.getLegacyMigrationProgress = async () => ({ scanned: 0, complete: false });
    adapter.migrateLegacyCards = () => migration.promise;
    const controller = createOwnerLibrarySessionController({ adapter });

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
    const adapter = fakeAdapter();
    const identityConflict = Object.assign(
      new Error('Card mutation rejected: identity-conflict.'),
      { reason: 'identity-conflict' },
    );
    adapter.getLegacyMigrationProgress = async () => ({ scanned: 0, complete: false });
    adapter.migrateLegacyCards = async () => { throw identityConflict; };
    const controller = createOwnerLibrarySessionController({ adapter });

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
    const adapter = fakeAdapter();
    const aProgress = deferred<{ scanned: number; complete: boolean }>();
    adapter.getLegacyMigrationProgress = ownerId => ownerId === 'owner-a'
      ? aProgress.promise
      : Promise.resolve({ scanned: 1, complete: true as const });
    const controller = createOwnerLibrarySessionController({ adapter });

    controller.activate({ ownerId: 'owner-a', libraryEpoch: 1, cloudTotal: 4 });
    controller.activate({ ownerId: 'owner-b', libraryEpoch: 2, cloudTotal: 1 });
    adapter.emitDecks('owner-a', { decks: ['late A deck'] });
    adapter.emitDecks('owner-b', { decks: [' B deck ', 'B deck'] });
    aProgress.resolve({ scanned: 0, complete: false });

    await vi.waitFor(() => expect(controller.getSnapshot().status).toBe('ready'));
    expect(adapter.unsubscriptions).toContain('owner-a');
    expect(controller.getSnapshot()).toMatchObject({
      ownerId: 'owner-b', decks: ['B deck'], legacyPending: 0,
    });
  });

  it('stops publication after cleanup', async () => {
    const adapter = fakeAdapter();
    const progress = deferred<{ scanned: number; complete: boolean }>();
    adapter.getLegacyMigrationProgress = () => progress.promise;
    const controller = createOwnerLibrarySessionController({ adapter });

    const stop = controller.activate({ ownerId: 'owner-a', libraryEpoch: 1, cloudTotal: 2 });
    stop();
    adapter.emitDecks('owner-a', { decks: ['late'] });
    progress.resolve({ scanned: 0, complete: false });
    await Promise.resolve();

    expect(adapter.unsubscriptions).toEqual(['owner-a']);
    expect(controller.getSnapshot().ownerId).toBeNull();
    expect(controller.getSnapshot().decks).toEqual([]);
  });

  it('keeps the active owner isolated and reports adapter failures', async () => {
    const adapter = fakeAdapter();
    adapter.getLegacyMigrationProgress = async () => { throw new Error('offline'); };
    adapter.migrateLegacyCards = async () => { throw new Error('migration failed'); };
    const controller = createOwnerLibrarySessionController({ adapter });

    controller.activate({ ownerId: 'owner-b', libraryEpoch: 2, cloudTotal: 4 });
    await vi.waitFor(() => expect(controller.getSnapshot().status).toBe('ready'));

    expect(controller.getSnapshot()).toMatchObject({
      error: null,
      legacyIssue: {
        kind: 'temporary',
        retryable: true,
      },
    });
    await expect(controller.migrateLegacy()).resolves.toMatchObject({ status: 'failed' });
    expect(controller.getSnapshot()).toMatchObject({
      ownerId: 'owner-b', isMigratingLegacy: false, legacyPending: 0,
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
