import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { writeFile } from 'node:fs/promises';
import runtimeTarget from './runtime-target.json';
import {
  runLegacyLibraryMigration,
  runLegacyLibraryMigrationToCompletion,
  summarizeLegacyLibrarySnapshot,
} from './legacyLibraryMigration.js';
import {
  createFirestoreLegacyLibraryMigrationStore,
  listLibraryOwnerIds,
  rollbackLegacyLibraryMigration,
} from './legacyLibraryMigrationFirestore.js';
import {
  createMigrationOwnerKey,
  selectMigrationOwnerIds,
  type LegacyLibraryMigrationMode,
} from './legacyLibraryMigrationOwnerScope.js';

const requestedMode = process.env.MIGRATION_MODE?.trim();
const projectId = process.env.FIREBASE_PROJECT_ID?.trim();
const databaseId = process.env.FIRESTORE_DATABASE_ID?.trim();
const confirmation = process.env.MIGRATION_CONFIRMATION?.trim();
const requestedOwnerKey = process.env.MIGRATION_OWNER_KEY?.trim() || undefined;
const PROJECT_ID = 'encoded-hangout-433912-h2';

if (requestedMode !== 'dry-run' && requestedMode !== 'apply' && requestedMode !== 'final-delta' && requestedMode !== 'rollback') {
  throw new Error('MIGRATION_MODE must be dry-run, apply, final-delta or rollback.');
}
const mode = requestedMode as LegacyLibraryMigrationMode | 'final-delta';
if (!projectId || projectId !== PROJECT_ID) {
  throw new Error('FIREBASE_PROJECT_ID does not match the sealed Functions target.');
}
if (!databaseId || databaseId !== runtimeTarget.firestoreDatabaseId) {
  throw new Error('FIRESTORE_DATABASE_ID does not match the sealed Functions target.');
}
if (mode === 'apply' && confirmation !== 'APPLY_QUERY_V2') {
  throw new Error('Apply mode requires the exact MIGRATION_CONFIRMATION value.');
}
if (mode === 'final-delta' && confirmation !== 'FINAL_DELTA_QUERY_V2') {
  throw new Error('Final-delta mode requires the exact MIGRATION_CONFIRMATION value.');
}
if (mode === 'rollback' && confirmation !== 'ROLLBACK_QUERY_V2') {
  throw new Error('Rollback mode requires the exact MIGRATION_CONFIRMATION value.');
}
const targetProjectId = projectId;
const targetDatabaseId = databaseId;

async function main(): Promise<void> {
  const app = getApps()[0] ?? initializeApp({ projectId: targetProjectId });
  const database = getFirestore(app, targetDatabaseId);
  try {
    const store = createFirestoreLegacyLibraryMigrationStore(database);
    const ownerIds = await listLibraryOwnerIds(database);
    const selectedOwnerIds = selectMigrationOwnerIds(
      ownerIds,
      mode === 'dry-run' ? 'dry-run' : mode === 'rollback' ? 'rollback' : 'apply',
      requestedOwnerKey,
    );
    const reports: Array<Record<string, unknown>> = [];
    const aggregate = {
      cards: 0,
      canonicalIdentities: 0,
      reservations: 0,
      duplicateIdentities: 0,
      invalidIdentities: 0,
      missingReservations: 0,
      mismatchedReservations: 0,
    };

    for (const ownerId of selectedOwnerIds) {
      const ownerKey = createMigrationOwnerKey(ownerId);
      if (mode === 'rollback') {
        await rollbackLegacyLibraryMigration(database, ownerId, 'query-v2');
        const restoredSnapshot = await store.read(ownerId);
        const counts = summarizeLegacyLibrarySnapshot(restoredSnapshot);
        for (const key of Object.keys(aggregate) as Array<keyof typeof aggregate>) {
          aggregate[key] += counts[key];
        }
        reports.push({ ownerKey, mode, rolledBack: true, rollbackVerified: true, counts });
        continue;
      }
      if (mode === 'final-delta') {
        const finalSnapshot = await store.read(ownerId);
        const counts = summarizeLegacyLibrarySnapshot(finalSnapshot);
        for (const key of Object.keys(aggregate) as Array<keyof typeof aggregate>) {
          aggregate[key] += counts[key];
        }
        const finalRun = await runLegacyLibraryMigration(store, ownerId, {
          jobId: 'query-v2',
          batchSize: 100,
          dryRun: true,
        });
        if (!finalRun.complete || Object.values(counts).some((value, index) => {
          const key = Object.keys(counts)[index] as keyof typeof counts;
          return ['duplicateIdentities', 'invalidIdentities', 'missingReservations', 'mismatchedReservations']
            .includes(key) && value !== 0;
        })) {
          throw new Error(`Owner ${ownerKey} failed final delta verification.`);
        }
        reports.push({ ownerKey, mode, complete: true, counts });
        continue;
      }
      const dryRun = await runLegacyLibraryMigration(store, ownerId, {
        jobId: 'query-v2',
        batchSize: 100,
        dryRun: true,
      });
      if (mode === 'dry-run') {
        const counts = summarizeLegacyLibrarySnapshot(await store.read(ownerId));
        reports.push({ ownerKey, mode, pending: dryRun.remaining, invalid: dryRun.invalid, counts });
        continue;
      }
      if (dryRun.invalid > 0) {
        throw new Error(`Owner ${ownerKey} has malformed identities; apply was not started.`);
      }

      const result = await runLegacyLibraryMigrationToCompletion(store, ownerId, {
        jobId: 'query-v2',
        batchSize: 100,
        maximumBatches: 100,
      });
      if (!result.complete || result.invalid > 0 || result.remaining > 0) {
        throw new Error(`Owner ${ownerKey} failed final migration verification.`);
      }
      reports.push({
        ownerKey,
        mode,
        migrated: result.migrated,
        merged: result.merged,
        complete: true,
      });
    }
    const output = {
      mode,
      discoveredOwnerCount: ownerIds.length,
      selectedOwnerCount: selectedOwnerIds.length,
      reports,
      counts: aggregate,
      finalDeltaVerified: mode === 'final-delta',
      rollbackVerified: mode === 'rollback',
    };
    const reportFile = process.env.MIGRATION_REPORT_FILE?.trim();
    if (reportFile) await writeFile(reportFile, `${JSON.stringify(output, null, 2)}\n`, { flag: 'wx' });
    const snapshotFile = process.env.MIGRATION_SNAPSHOT_PLAINTEXT_FILE?.trim();
    if (snapshotFile && mode !== 'dry-run') {
      await writeFile(snapshotFile, `${JSON.stringify({
        schemaVersion: 1,
        mode,
        owners: reports.map(report => ({ ownerKey: report.ownerKey, counts: report.counts ?? null })),
      }, null, 2)}\n`, { flag: 'wx' });
    }
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  } finally {
    const terminationDeadline = new Promise<void>(resolve => {
      const timer = setTimeout(resolve, 5_000);
      timer.unref();
    });
    await Promise.race([database.terminate(), terminationDeadline]);
  }
}

void main().then(
  () => process.exit(0),
  error => {
    console.error(error instanceof Error ? error.message : 'Legacy migration operator failed.');
    process.exit(1);
  },
);
