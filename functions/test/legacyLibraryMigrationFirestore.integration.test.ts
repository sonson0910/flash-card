import { deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  LegacyLibraryInvalidCardsError,
  runLegacyLibraryDiscovery,
  runLegacyLibraryMigration,
  runLegacyLibraryMigrationToCompletion,
} from '../src/legacyLibraryMigration.js';
import {
  createFirestoreLegacyLibraryMigrationStore,
  createLegacyReservationId,
  LegacyLibraryDiscoveryLeaseError,
  rollbackLegacyLibraryMigration,
} from '../src/legacyLibraryMigrationFirestore.js';

const describeWithEmulator = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;
const DATABASE_ID = 'ai-studio-945b4052-4462-4668-8936-277f09f07a37';
const OWNER_ID = 'migration-integration-owner';

describeWithEmulator('Firestore Admin legacy library migration', () => {
  let app: App;
  let database: Firestore;

  beforeAll(() => {
    app = initializeApp({ projectId: 'demo-lingoflash' }, 'legacy-migration-integration');
    database = getFirestore(app, DATABASE_ID);
  });

  beforeEach(async () => {
    await database.recursiveDelete(database.collection('users').doc(OWNER_ID));
    await database.collection('users').doc(OWNER_ID).collection('profile').doc('library_state').set({
      libraryEpoch: 2,
      schemaVersion: 2,
    });
    const cards = database.collection('users').doc(OWNER_ID).collection('cards');
    await Promise.all([
      cards.doc('legacy-capital').set({ id: 'legacy-capital', word: 'Migrate', translation: 'di chuyển' }),
      cards.doc('duplicate-weak').set({ id: 'duplicate-weak', word: 'Quite', translation: 'khá', reviews: 1 }),
      cards.doc('duplicate-strong').set({
        id: 'duplicate-strong', word: ' quite ', translation: 'hoàn toàn', reviews: 8,
        createdAt: '2025-01-01T00:00:00.000Z',
      }),
    ]);
  });

  afterAll(async () => {
    await database.recursiveDelete(database.collection('users').doc(OWNER_ID));
    await database.terminate();
    await deleteApp(app);
  });

  it('backs up, canonicalizes, reserves and tombstones a real emulator library', async () => {
    const owner = database.collection('users').doc(OWNER_ID);
    const store = createFirestoreLegacyLibraryMigrationStore(database);
    const dryRun = await runLegacyLibraryMigration(store, OWNER_ID, {
      jobId: 'query-v2', batchSize: 100, dryRun: true,
    });
    expect(dryRun).toMatchObject({ complete: false, remaining: 3, invalid: 0 });
    await expect(owner.collection('admin_library_migration_backups').doc('query-v2').get())
      .resolves.toMatchObject({ exists: false });

    const completed = await runLegacyLibraryMigrationToCompletion(store, OWNER_ID, {
      jobId: 'query-v2', batchSize: 100, maximumBatches: 5,
    });
    expect(completed.complete).toBe(true);

    const cards = await owner.collection('cards').orderBy('normalizedWord').get();
    expect(cards.docs.map(document => ({ id: document.id, ...document.data() }))).toEqual([
      expect.objectContaining({
        id: 'word-migrate', word: 'migrate', normalizedWord: 'migrate',
        schemaVersion: 2, libraryEpoch: 2, difficulty: 'unrated', bookmarked: false,
      }),
      expect.objectContaining({
        id: 'word-quite', word: 'quite', normalizedWord: 'quite', translation: 'hoàn toàn',
        reviews: 8, schemaVersion: 2, libraryEpoch: 2,
      }),
    ]);
    const migrateReservation = await owner.collection('card_reservations')
      .doc(createLegacyReservationId('migrate')).get();
    expect(migrateReservation.data()).toEqual({
      schemaVersion: 1,
      cardId: 'word-migrate',
      normalizedWord: 'migrate',
    });
    expect((await owner.collection('card_tombstones').get()).size).toBe(3);
    expect((await owner.collection('admin_library_migration_backups')
      .doc('query-v2').collection('sources').get()).size).toBe(3);
    expect((await owner.collection('profile').doc('query_migration').get()).data())
      .toMatchObject({ migrationVersion: 2, complete: true, scanned: 2 });
    expect((await owner.collection('profile').doc('library_facets').get()).data())
      .toMatchObject({ version: 1, complete: true, categories: { Other: 2 } });

    await expect(runLegacyLibraryMigration(store, OWNER_ID, {
      jobId: 'query-v2', batchSize: 100, dryRun: true,
    })).resolves.toMatchObject({ complete: true, remaining: 0, invalid: 0 });

    await rollbackLegacyLibraryMigration(database, OWNER_ID, 'query-v2');
    const restored = await owner.collection('cards').orderBy('__name__').get();
    expect(restored.docs.map(document => document.id)).toEqual([
      'duplicate-strong',
      'duplicate-weak',
      'legacy-capital',
    ]);
    expect((await owner.collection('card_reservations').get()).size).toBe(0);
    expect((await owner.collection('card_tombstones').get()).size).toBe(0);
    expect((await owner.collection('profile').doc('query_migration').get()).exists).toBe(false);
    expect((await owner.collection('profile').doc('library_facets').get()).exists).toBe(false);
  });

  it('discovers ordered pages into a trusted query-v3 manifest without live writes', async () => {
    const owner = database.collection('users').doc(OWNER_ID);
    const store = createFirestoreLegacyLibraryMigrationStore(database);

    const first = await runLegacyLibraryDiscovery(store, OWNER_ID, {
      jobId: 'query-v3', batchSize: 2,
    });
    const second = await runLegacyLibraryDiscovery(store, OWNER_ID, {
      jobId: 'query-v3', batchSize: 2,
    });

    expect(first).toMatchObject({ migrated: 0, scanned: 2, complete: false, invalid: 0 });
    expect(second).toMatchObject({ migrated: 0, scanned: 1, complete: false, phase: 'discovered', invalid: 0 });
    expect((await owner.collection('admin_library_migration_jobs').doc('query-v3').get()).data())
      .toMatchObject({ schemaVersion: 3, phase: 'discovered', cursor: 'legacy-capital', leaseOwner: null });
    expect((await owner.collection('admin_library_migration_jobs').doc('query-v3').collection('groups').get()).size)
      .toBe(2);
    expect((await owner.collection('card_reservations').get()).empty).toBe(true);
    expect((await owner.collection('card_tombstones').get()).empty).toBe(true);
    expect((await owner.collection('cards').get()).size).toBe(3);
  });

  it('keeps a terminal scan provisional when a source is inserted before its cursor', async () => {
    const owner = database.collection('users').doc(OWNER_ID);
    const store = createFirestoreLegacyLibraryMigrationStore(database);

    await expect(runLegacyLibraryDiscovery(store, OWNER_ID, {
      jobId: 'precursor-v3', batchSize: 2,
    })).resolves.toMatchObject({ phase: 'discover', complete: false, scanned: 2 });
    await owner.collection('cards').doc('aaa-before').set({ word: 'inserted before cursor' });

    const terminal = await runLegacyLibraryDiscovery(store, OWNER_ID, {
      jobId: 'precursor-v3', batchSize: 2,
    });
    expect(terminal).toMatchObject({ phase: 'discovered', complete: false, scanned: 1, sourceCount: 3 });
    expect((await owner.collection('cards').get()).size).toBe(4);
    // Task 7 must fresh-verify the full card range and CAS before promoting/applying.
  });

  it('rejects a concurrent discovery lease before reading a page', async () => {
    const store = createFirestoreLegacyLibraryMigrationStore(database);
    await store.acquireDiscoveryLease(OWNER_ID, {
      jobId: 'lease-test', scanId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', leaseOwner: 'holder-a',
    });
    await expect(store.acquireDiscoveryLease(OWNER_ID, {
      jobId: 'lease-test', scanId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', leaseOwner: 'holder-b',
    })).rejects.toBeInstanceOf(LegacyLibraryDiscoveryLeaseError);
  });

  it('retries the same committed page idempotently without duplicating manifest sources', async () => {
    const store = createFirestoreLegacyLibraryMigrationStore(database);
    const commit = store.commitDiscoveryPage.bind(store);
    let loseResponse = true;
    store.commitDiscoveryPage = async (ownerId, request) => {
      const committed = await commit(ownerId, request);
      if (loseResponse) {
        loseResponse = false;
        throw new Error('simulated network loss after commit');
      }
      return committed;
    };

    await expect(runLegacyLibraryDiscovery(store, OWNER_ID, {
      jobId: 'idempotent-v3', batchSize: 2,
    })).rejects.toThrow('simulated network loss after commit');
    await expect(runLegacyLibraryDiscovery(store, OWNER_ID, {
      jobId: 'idempotent-v3', batchSize: 2,
    })).resolves.toMatchObject({ phase: 'discovered', complete: false, scanned: 1 });

    const owner = database.collection('users').doc(OWNER_ID);
    expect((await owner.collection('admin_library_migration_jobs').doc('idempotent-v3').get()).data())
      .toMatchObject({ phase: 'discovered', scanned: 3, sourceCount: 3 });
    const groups = await owner.collection('admin_library_migration_jobs').doc('idempotent-v3')
      .collection('groups').get();
    const sourceIds = groups.docs.flatMap(document => (
      (document.data().sources as Array<{ id: string }>).map(source => source.id)
    ));
    expect(sourceIds).toHaveLength(3);
    expect(new Set(sourceIds).size).toBe(3);
  });

  it('blocks the trusted job when the library epoch changes between discovery pages', async () => {
    const owner = database.collection('users').doc(OWNER_ID);
    const store = createFirestoreLegacyLibraryMigrationStore(database);
    await expect(runLegacyLibraryDiscovery(store, OWNER_ID, {
      jobId: 'epoch-v3', batchSize: 2,
    })).resolves.toMatchObject({ complete: false, invalid: 0 });
    await owner.collection('profile').doc('library_state').set({ libraryEpoch: 3 }, { merge: true });

    await expect(runLegacyLibraryDiscovery(store, OWNER_ID, {
      jobId: 'epoch-v3', batchSize: 2,
    })).resolves.toMatchObject({ complete: false, phase: 'blocked', invalid: 1, migrated: 0 });
    expect((await owner.collection('admin_library_migration_jobs').doc('epoch-v3').get()).data())
      .toMatchObject({ phase: 'blocked', blockedReason: 'library-epoch-changed' });
    expect((await owner.collection('cards').get()).size).toBe(3);
    expect((await owner.collection('card_reservations').get()).empty).toBe(true);
  });

  it('refuses rollback when a removed source ID is recreated after migration', async () => {
    const owner = database.collection('users').doc(OWNER_ID);
    const store = createFirestoreLegacyLibraryMigrationStore(database);
    let complete = false;
    for (let attempt = 0; attempt < 5 && !complete; attempt += 1) {
      const result = await runLegacyLibraryMigration(store, OWNER_ID, {
        jobId: 'query-v2', batchSize: 100, dryRun: false,
      });
      complete = result.complete;
    }
    expect(complete).toBe(true);

    const recreated = {
      id: 'duplicate-weak',
      word: 'new user card',
      normalizedWord: 'new user card',
      revision: 99,
    };
    await owner.collection('cards').doc('duplicate-weak').set(recreated);
    await owner.collection('admin_library_migration_backups').doc('query-v2').set({
      finalCardCount: 3,
    }, { merge: true });

    await expect(rollbackLegacyLibraryMigration(database, OWNER_ID, 'query-v2'))
      .rejects.toThrow('A removed source ID was recreated after migration; automatic rollback was refused.');
    expect((await owner.collection('cards').doc('duplicate-weak').get()).data()).toEqual(recreated);
  });

  it('persists maximum-safe migrated card and tombstone revisions without overflow', async () => {
    const owner = database.collection('users').doc(OWNER_ID);
    const maxSafe = Number.MAX_SAFE_INTEGER;
    await owner.collection('cards').doc('legacy-capital').set({
      id: 'legacy-capital', word: 'Migrate', translation: 'di chuyển', revision: maxSafe - 1,
    });

    const store = createFirestoreLegacyLibraryMigrationStore(database);
    await runLegacyLibraryMigrationToCompletion(store, OWNER_ID, {
      jobId: 'query-v2', batchSize: 100, maximumBatches: 5,
    });

    const migratedCard = await owner.collection('cards').doc('word-migrate').get();
    expect(migratedCard.exists).toBe(true);
    expect(migratedCard.data()).toMatchObject({ revision: maxSafe });
    const migratedTombstone = await owner.collection('card_tombstones').doc('legacy-capital').get();
    expect(migratedTombstone.exists).toBe(true);
    expect(migratedTombstone.data()).toMatchObject({ revision: maxSafe });
  });

  it('rejects a tombstone ceiling increment without writing migrated card outputs', async () => {
    const owner = database.collection('users').doc(OWNER_ID);
    const maxSafe = Number.MAX_SAFE_INTEGER;
    const source = {
      id: 'legacy-capital', word: 'Migrate', translation: 'di chuyển', revision: maxSafe - 1,
    };
    const tombstone = {
      cardId: 'legacy-capital', opId: 'existing-delete', libraryEpoch: 2,
      revision: maxSafe, deletedAt: null,
    };
    await Promise.all([
      owner.collection('cards').doc('legacy-capital').set(source),
      owner.collection('card_tombstones').doc('legacy-capital').set(tombstone),
    ]);

    const store = createFirestoreLegacyLibraryMigrationStore(database);
    await expect(runLegacyLibraryMigration(store, OWNER_ID, {
      jobId: 'query-v2', batchSize: 100, dryRun: false,
    })).rejects.toBeInstanceOf(LegacyLibraryInvalidCardsError);

    const sourceSnapshot = await owner.collection('cards').doc('legacy-capital').get();
    expect(sourceSnapshot.exists).toBe(true);
    expect(sourceSnapshot.data()).toEqual(source);
    const canonicalSnapshot = await owner.collection('cards').doc('word-migrate').get();
    expect(canonicalSnapshot.exists).toBe(false);
    const tombstoneSnapshot = await owner.collection('card_tombstones').doc('legacy-capital').get();
    expect(tombstoneSnapshot.exists).toBe(true);
    expect(tombstoneSnapshot.data()).toEqual(tombstone);
  });

  it('rejects an unsafe persisted library epoch without writing migration outputs', async () => {
    const owner = database.collection('users').doc(OWNER_ID);
    await owner.collection('profile').doc('library_state').set({
      libraryEpoch: Number.MAX_SAFE_INTEGER + 1,
    }, { merge: true });

    const store = createFirestoreLegacyLibraryMigrationStore(database);
    await expect(runLegacyLibraryMigration(store, OWNER_ID, {
      jobId: 'query-v2', batchSize: 100, dryRun: false,
    })).rejects.toBeInstanceOf(LegacyLibraryInvalidCardsError);

    const sourceSnapshot = await owner.collection('cards').doc('legacy-capital').get();
    expect(sourceSnapshot.exists).toBe(true);
    const canonicalSnapshot = await owner.collection('cards').doc('word-migrate').get();
    expect(canonicalSnapshot.exists).toBe(false);
    expect((await owner.collection('card_tombstones').get()).empty).toBe(true);
    const backupSnapshot = await owner.collection('admin_library_migration_backups').doc('query-v2').get();
    expect(backupSnapshot.exists).toBe(false);
  });

  it('rejects an unsafe persisted tombstone revision without deleting its source', async () => {
    const owner = database.collection('users').doc(OWNER_ID);
    const tombstone = {
      cardId: 'legacy-capital', opId: 'unsafe-delete', libraryEpoch: 2,
      revision: Number.MAX_SAFE_INTEGER + 1, deletedAt: null,
    };
    await owner.collection('card_tombstones').doc('legacy-capital').set(tombstone);

    const store = createFirestoreLegacyLibraryMigrationStore(database);
    await expect(runLegacyLibraryMigration(store, OWNER_ID, {
      jobId: 'query-v2', batchSize: 100, dryRun: false,
    })).rejects.toBeInstanceOf(LegacyLibraryInvalidCardsError);

    const sourceSnapshot = await owner.collection('cards').doc('legacy-capital').get();
    expect(sourceSnapshot.exists).toBe(true);
    const canonicalSnapshot = await owner.collection('cards').doc('word-migrate').get();
    expect(canonicalSnapshot.exists).toBe(false);
    const tombstoneSnapshot = await owner.collection('card_tombstones').doc('legacy-capital').get();
    expect(tombstoneSnapshot.exists).toBe(true);
    expect(tombstoneSnapshot.data()).toEqual(tombstone);
  });
});
