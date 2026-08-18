import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import runtimeTarget from './runtime-target.json';
import {
  runLegacyLibraryMigration,
  runLegacyLibraryMigrationToCompletion,
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

if (requestedMode !== 'dry-run' && requestedMode !== 'apply' && requestedMode !== 'rollback') {
  throw new Error('MIGRATION_MODE must be dry-run, apply or rollback.');
}
const mode: LegacyLibraryMigrationMode = requestedMode;
if (!projectId || projectId !== PROJECT_ID) {
  throw new Error('FIREBASE_PROJECT_ID does not match the sealed Functions target.');
}
if (!databaseId || databaseId !== runtimeTarget.firestoreDatabaseId) {
  throw new Error('FIRESTORE_DATABASE_ID does not match the sealed Functions target.');
}
if (mode === 'apply' && confirmation !== 'APPLY_QUERY_V2') {
  throw new Error('Apply mode requires the exact MIGRATION_CONFIRMATION value.');
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
    const selectedOwnerIds = selectMigrationOwnerIds(ownerIds, mode, requestedOwnerKey);
    const reports: Array<Record<string, unknown>> = [];

    for (const ownerId of selectedOwnerIds) {
      const ownerKey = createMigrationOwnerKey(ownerId);
      if (mode === 'rollback') {
        await rollbackLegacyLibraryMigration(database, ownerId, 'query-v2');
        reports.push({ ownerKey, mode, rolledBack: true });
        continue;
      }
      const dryRun = await runLegacyLibraryMigration(store, ownerId, {
        jobId: 'query-v2',
        batchSize: 100,
        dryRun: true,
      });
      if (mode === 'dry-run') {
        reports.push({ ownerKey, mode, pending: dryRun.remaining, invalid: dryRun.invalid });
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

    process.stdout.write(`${JSON.stringify({
      mode,
      discoveredOwnerCount: ownerIds.length,
      selectedOwnerCount: selectedOwnerIds.length,
      reports,
    }, null, 2)}\n`);
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
