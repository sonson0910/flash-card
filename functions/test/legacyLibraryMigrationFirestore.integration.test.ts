import { performance } from 'node:perf_hooks';
import { deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createCanonicalCleanupCardId } from '../src/duplicateCleanup.js';
import {
  legacyLibraryMigrationCompletionBatchLimit,
  LegacyLibrarySourceLimitError,
  MAX_AUTOMATIC_ROLLBACK_SOURCE_CARDS,
  runLegacyLibraryMigration,
  runLegacyLibraryMigrationToCompletion,
} from '../src/legacyLibraryMigration.js';
import {
  createFirestoreLegacyLibraryMigrationStore,
  createLegacyReservationId,
  rollbackLegacyLibraryMigration,
} from '../src/legacyLibraryMigrationFirestore.js';

const describeWithEmulator = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;
const migrationBenchmarkIt = (
  process.env.RUN_MIGRATION_BENCHMARK === '1'
  && Boolean(process.env.FIRESTORE_EMULATOR_HOST)
) ? it : it.skip;
const DATABASE_ID = 'ai-studio-945b4052-4462-4668-8936-277f09f07a37';
const OWNER_ID = 'migration-integration-owner';
const MIGRATION_BENCHMARK_CARD_COUNT = 10_000;
const MIGRATION_BENCHMARK_MIGRATABLE_COUNT = 100;
const MIGRATION_BENCHMARK_BATCH_SIZE = 100;
const MIGRATION_BENCHMARK_TIMEOUT_MS = 300_000;

async function seedMigrationBenchmarkLibrary(
  database: Firestore,
  ownerId: string,
): Promise<void> {
  const owner = database.collection('users').doc(ownerId);
  const cards = owner.collection('cards');
  const reservations = owner.collection('card_reservations');
  await database.recursiveDelete(owner);
  await owner.collection('profile').doc('library_state').set({
    libraryEpoch: 2,
    mutationGeneration: 0,
    schemaVersion: 2,
  });

  const writer = database.bulkWriter();
  const currentCardCount = (
    MIGRATION_BENCHMARK_CARD_COUNT
    - MIGRATION_BENCHMARK_MIGRATABLE_COUNT
  );
  for (let index = 0; index < currentCardCount; index += 1) {
    const word = `benchmark-current-${String(index).padStart(4, '0')}`;
    const cardId = createCanonicalCleanupCardId(word);
    writer.set(cards.doc(cardId), {
      id: cardId,
      word,
      normalizedWord: word,
      translation: 'benchmark',
      schemaVersion: 2,
      revision: 1,
      libraryEpoch: 2,
      createdAt: '2026-01-01T00:00:00.000Z',
      bookmarked: false,
      customDeck: null,
      difficulty: 'unrated',
    });
    writer.set(reservations.doc(createLegacyReservationId(word)), {
      schemaVersion: 1,
      cardId,
      normalizedWord: word,
    });
  }
  for (let index = 0; index < MIGRATION_BENCHMARK_MIGRATABLE_COUNT; index += 1) {
    const suffix = String(index).padStart(3, '0');
    const cardId = `zlegacy-benchmark-${suffix}`;
    writer.set(cards.doc(cardId), {
      id: cardId,
      word: `benchmark-legacy-${suffix}`,
      translation: 'benchmark',
    });
  }
  await writer.close();
}

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
      mutationGeneration: 0,
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
  }, 120_000);

  it('backs up, canonicalizes, reserves and tombstones a real emulator library', async () => {
    const owner = database.collection('users').doc(OWNER_ID);
    const store = createFirestoreLegacyLibraryMigrationStore(database);
    const dryRun = await runLegacyLibraryMigration(store, OWNER_ID, {
      jobId: 'query-v2', batchSize: 100, dryRun: true,
    });
    expect(dryRun).toMatchObject({ complete: false, scanned: 3, remaining: 0, invalid: 0 });
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
      .toMatchObject({
        migrationVersion: 3,
        jobId: 'query-v2',
        phase: 'complete',
        complete: true,
        completedMutationGeneration: 0,
      });
    expect((await owner.collection('profile').doc('library_facets').get()).data())
      .toMatchObject({ version: 1, complete: false, categories: {} });

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

  it('restores every duplicate source and tombstone when one identity spans pages', async () => {
    const owner = database.collection('users').doc(OWNER_ID);
    const cards = owner.collection('cards');
    await database.recursiveDelete(owner);
    await owner.collection('profile').doc('library_state').set({ libraryEpoch: 2, schemaVersion: 2 });
    await Promise.all([
      cards.doc('a-first').set({ id: 'a-first', word: 'same', translation: 'một' }),
      cards.doc('z-second').set({ id: 'z-second', word: ' SAME ', translation: 'hai', reviews: 2 }),
    ]);
    const store = createFirestoreLegacyLibraryMigrationStore(database);

    await expect(runLegacyLibraryMigrationToCompletion(store, OWNER_ID, {
      jobId: 'query-v2', batchSize: 1, maximumBatches: 10,
    })).resolves.toMatchObject({ complete: true });
    await expect(rollbackLegacyLibraryMigration(database, OWNER_ID, 'query-v2')).resolves.toBeUndefined();

    expect((await cards.orderBy('__name__').get()).docs.map(document => document.id))
      .toEqual(['a-first', 'z-second']);
    expect((await owner.collection('card_tombstones').get()).size).toBe(0);
    expect((await owner.collection('card_reservations').get()).size).toBe(0);
  });

  it('reapplies a partial plan after the owner epoch advances', async () => {
    const owner = database.collection('users').doc(OWNER_ID);
    await database.recursiveDelete(owner);
    await owner.collection('profile').doc('library_state').set({
      libraryEpoch: 2,
      mutationGeneration: 0,
      schemaVersion: 2,
    });
    await owner.collection('cards').doc('legacy-card').set({
      id: 'legacy-card', word: 'restart', translation: 'restart',
    });
    const store = createFirestoreLegacyLibraryMigrationStore(database);

    await runLegacyLibraryMigration(store, OWNER_ID, {
      jobId: 'query-v2', batchSize: 1, dryRun: false,
    });
    await owner.collection('profile').doc('library_state').set({
      libraryEpoch: 3,
      mutationGeneration: 1,
      schemaVersion: 2,
    });

    await expect(runLegacyLibraryMigrationToCompletion(store, OWNER_ID, {
      jobId: 'query-v2', batchSize: 1, maximumBatches: 5,
    })).resolves.toMatchObject({ complete: true });
    await expect(owner.collection('cards').doc('word-restart').get())
      .resolves.toMatchObject({ exists: true });
    expect((await owner.collection('cards').doc('word-restart').get()).data())
      .toMatchObject({ libraryEpoch: 3 });
  });

  it('discards a stale apply cursor after an earlier card arrives in a new generation', async () => {
    const owner = database.collection('users').doc(OWNER_ID);
    await database.recursiveDelete(owner);
    await owner.collection('profile').doc('library_state').set({
      libraryEpoch: 2,
      mutationGeneration: 0,
      schemaVersion: 2,
    });
    await owner.collection('cards').doc('z-legacy').set({
      id: 'z-legacy', word: 'zulu', translation: 'zulu',
    });
    const store = createFirestoreLegacyLibraryMigrationStore(database);

    await expect(runLegacyLibraryMigration(store, OWNER_ID, {
      jobId: 'query-v2', batchSize: 1, dryRun: false,
    })).resolves.toMatchObject({ migrated: 1, complete: false });

    await Promise.all([
      owner.collection('cards').doc('a-earlier').set({
        id: 'a-earlier', word: 'alpha', translation: 'alpha',
      }),
      owner.collection('profile').doc('library_state').set({
        libraryEpoch: 2,
        mutationGeneration: 1,
        schemaVersion: 2,
      }),
    ]);

    await expect(runLegacyLibraryMigrationToCompletion(store, OWNER_ID, {
      jobId: 'query-v2', batchSize: 1, maximumBatches: 10,
    })).resolves.toMatchObject({ complete: true });
    expect((await owner.collection('cards').doc('word-alpha').get()).exists).toBe(true);
    expect((await owner.collection('cards').doc('a-earlier').get()).exists).toBe(false);
    await expect(owner.collection('profile').doc('query_migration').get()).resolves.toMatchObject({
      exists: true,
      data: expect.any(Function),
    });
    expect((await owner.collection('profile').doc('query_migration').get()).data())
      .toMatchObject({ phase: 'complete', completedMutationGeneration: 1 });
  });

  it('refuses rollback when an applied tombstone changes without a generation advance', async () => {
    const owner = database.collection('users').doc(OWNER_ID);
    const store = createFirestoreLegacyLibraryMigrationStore(database);
    await expect(runLegacyLibraryMigrationToCompletion(store, OWNER_ID, {
      jobId: 'query-v2', batchSize: 100, maximumBatches: 5,
    })).resolves.toMatchObject({ complete: true });

    const tombstone = owner.collection('card_tombstones').doc('duplicate-weak');
    const appliedTombstone = (await tombstone.get()).data();
    expect(appliedTombstone).toBeDefined();
    const changedTombstone = { ...appliedTombstone, opId: 'admin-changed-tombstone' };
    await tombstone.set(changedTombstone);

    await expect(rollbackLegacyLibraryMigration(database, OWNER_ID, 'query-v2'))
      .rejects.toThrow('A migration tombstone changed after apply; automatic rollback was refused.');
    expect((await tombstone.get()).data()).toEqual(changedTombstone);
    expect((await owner.collection('profile').doc('library_state').get()).data())
      .toMatchObject({ mutationGeneration: 0 });
    expect((await owner.collection('cards').doc('word-migrate').get()).exists).toBe(true);
    expect((await owner.collection('cards').doc('word-quite').get()).exists).toBe(true);
  });

  it('rejects an oversized rollback backup before restoration', async () => {
    const owner = database.collection('users').doc(OWNER_ID);
    const store = createFirestoreLegacyLibraryMigrationStore(database);
    await expect(runLegacyLibraryMigrationToCompletion(store, OWNER_ID, {
      jobId: 'query-v2', batchSize: 100, maximumBatches: 5,
    })).resolves.toMatchObject({ complete: true });

    await owner.collection('admin_library_migration_backups').doc('query-v2').set({
      sourceCount: 10_001,
    }, { merge: true });

    await expect(rollbackLegacyLibraryMigration(database, OWNER_ID, 'query-v2'))
      .rejects.toBeInstanceOf(LegacyLibrarySourceLimitError);
    expect((await owner.collection('cards').doc('word-migrate').get()).exists).toBe(true);
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
    await Promise.all([
      owner.collection('cards').doc('duplicate-weak').set(recreated),
      owner.collection('profile').doc('library_state').set({
        libraryEpoch: 2,
        mutationGeneration: 1,
        schemaVersion: 2,
      }),
    ]);

    await expect(rollbackLegacyLibraryMigration(database, OWNER_ID, 'query-v2'))
      .rejects.toThrow('Library epoch or mutation generation changed while the Admin migration was running.');
    expect((await owner.collection('cards').doc('duplicate-weak').get()).data()).toEqual(recreated);
  });

  migrationBenchmarkIt(
    'migrates 100 legacy cards in an accepted 10,000-card emulator library',
    async () => {
      const owner = database.collection('users').doc(OWNER_ID);
      const cards = owner.collection('cards');
      await seedMigrationBenchmarkLibrary(database, OWNER_ID);

      const accepted = (await cards.get()).size;
      expect(accepted).toBe(MIGRATION_BENCHMARK_CARD_COUNT);

      const executionIdentity = {
        migrationRunId: 'benchmark-run',
        migrationRunAttempt: 1,
      };
      const store = createFirestoreLegacyLibraryMigrationStore(
        database,
        executionIdentity,
      );
      const maximumBatches = legacyLibraryMigrationCompletionBatchLimit(
        MIGRATION_BENCHMARK_BATCH_SIZE,
      );
      expect(maximumBatches).toBe(200);

      const startedAt = performance.now();
      const completed = await runLegacyLibraryMigrationToCompletion(
        store,
        OWNER_ID,
        {
          jobId: 'query-v2',
          batchSize: MIGRATION_BENCHMARK_BATCH_SIZE,
          maximumBatches,
        },
      );
      const durationMs = Math.round(performance.now() - startedAt);

      expect(completed).toEqual({
        migrated: MIGRATION_BENCHMARK_MIGRATABLE_COUNT,
        merged: 0,
        scanned: MIGRATION_BENCHMARK_CARD_COUNT * 2,
        complete: true,
        remaining: 0,
        invalid: 0,
      });
      expect((await cards.get()).size).toBe(MIGRATION_BENCHMARK_CARD_COUNT);

      const backup = owner
        .collection('admin_library_migration_backups')
        .doc('query-v2');
      const backupRoot = await backup.get();
      const backupSources = await backup.collection('sources').get();
      expect(backupRoot.data()?.sourceCount)
        .toBe(MAX_AUTOMATIC_ROLLBACK_SOURCE_CARDS);
      expect(backupSources.size)
        .toBe(MAX_AUTOMATIC_ROLLBACK_SOURCE_CARDS);

      await expect(runLegacyLibraryMigrationToCompletion(
        store,
        OWNER_ID,
        {
          jobId: 'query-v2',
          batchSize: MIGRATION_BENCHMARK_BATCH_SIZE,
          maximumBatches,
        },
      )).resolves.toEqual({
        migrated: 0,
        merged: 0,
        scanned: 0,
        complete: true,
        remaining: 0,
        invalid: 0,
      });
      expect((await cards.get()).size).toBe(MIGRATION_BENCHMARK_CARD_COUNT);
      expect((await backup.collection('sources').get()).size)
        .toBe(MAX_AUTOMATIC_ROLLBACK_SOURCE_CARDS);

      process.stdout.write(`${JSON.stringify({
        accepted,
        migrated: completed.migrated,
        rollbackSources: backupSources.size,
        durationMs,
      })}\n`);
    },
    MIGRATION_BENCHMARK_TIMEOUT_MS,
  );
});
