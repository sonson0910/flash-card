import { deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  runLegacyLibraryMigration,
  runLegacyLibraryMigrationToCompletion,
} from '../src/legacyLibraryMigration.js';
import {
  createFirestoreLegacyLibraryMigrationStore,
  createLegacyReservationId,
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

    await expect(owner.collection('cards').doc('word-migrate').get())
      .resolves.toMatchObject({ exists: true, data: expect.objectContaining({ revision: maxSafe }) });
    await expect(owner.collection('card_tombstones').doc('legacy-capital').get())
      .resolves.toMatchObject({ exists: true, data: expect.objectContaining({ revision: maxSafe }) });
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
    })).rejects.toThrow(/tombstone revision.*maximum safe integer/i);

    await expect(owner.collection('cards').doc('legacy-capital').get())
      .resolves.toMatchObject({ exists: true, data: source });
    await expect(owner.collection('cards').doc('word-migrate').get())
      .resolves.toMatchObject({ exists: false });
    await expect(owner.collection('card_tombstones').doc('legacy-capital').get())
      .resolves.toMatchObject({ exists: true, data: tombstone });
  });
});
