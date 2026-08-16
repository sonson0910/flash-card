import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import runtimeTarget from './runtime-target.json';
import {
  legacyLibraryMigrationCompletionBatchLimit,
  runLegacyLibraryMigrationPreflight,
  runLegacyLibraryMigrationToCompletion,
} from './legacyLibraryMigration.js';
import {
  createFirestoreLegacyLibraryMigrationStore,
  rollbackLegacyLibraryMigration,
} from './legacyLibraryMigrationFirestore.js';
import {
  createMigrationOwnerKey,
  selectExplicitMigrationOwner,
  type LegacyLibraryMigrationMode,
} from './legacyLibraryMigrationOwnerScope.js';
import { classifyFunctionError, logFunctionEvent } from './structuredLogger.js';

const requestedMode = process.env.MIGRATION_MODE?.trim();
const projectId = process.env.FIREBASE_PROJECT_ID?.trim();
const databaseId = process.env.FIRESTORE_DATABASE_ID?.trim();
const confirmation = process.env.MIGRATION_CONFIRMATION?.trim();
const requestedOwnerId = process.env.MIGRATION_OWNER_ID?.trim() || undefined;
const requestedOwnerKey = process.env.MIGRATION_OWNER_KEY?.trim() || undefined;
const migrationRunId = process.env.MIGRATION_RUN_ID?.trim();
const migrationRunAttemptValue = process.env.MIGRATION_RUN_ATTEMPT?.trim();
const PROJECT_ID = 'encoded-hangout-433912-h2';
const MIGRATION_BATCH_SIZE = 100;

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
const migrationRunAttempt = Number(migrationRunAttemptValue);
if (mode !== 'dry-run' && (
  !migrationRunId
  || !/^[1-9][0-9]{0,19}$/.test(migrationRunId)
  || !migrationRunAttemptValue
  || !/^[1-9][0-9]{0,9}$/.test(migrationRunAttemptValue)
  || !Number.isSafeInteger(migrationRunAttempt)
)) throw new Error('Apply and rollback require an exact GitHub workflow run ID and attempt.');
const targetProjectId = projectId;
const targetDatabaseId = databaseId;
const executionIdentity = mode === 'dry-run' ? undefined : {
  migrationRunId: migrationRunId as string,
  migrationRunAttempt,
};

async function main(): Promise<void> {
  const app = getApps()[0] ?? initializeApp({ projectId: targetProjectId });
  const database = getFirestore(app, targetDatabaseId);
  try {
    const ownerId = selectExplicitMigrationOwner(requestedOwnerId, mode, requestedOwnerKey);
    const ownerKey = createMigrationOwnerKey(ownerId);
    const store = createFirestoreLegacyLibraryMigrationStore(database, executionIdentity);

    if (mode === 'rollback') {
      await rollbackLegacyLibraryMigration(database, ownerId, 'query-v2', executionIdentity);
      process.stdout.write(`${JSON.stringify({ ownerKey, mode, rolledBack: true }, null, 2)}\n`);
      return;
    }

    if (mode === 'dry-run') {
      const result = await runLegacyLibraryMigrationPreflight(store, ownerId, {
        jobId: 'query-v2',
        batchSize: MIGRATION_BATCH_SIZE,
        maximumBatches: 100,
      });
      process.stdout.write(`${JSON.stringify({
        ownerKey,
        mode,
        scanned: result.scanned,
        pending: result.pending,
        duplicateGroups: result.merged,
        invalid: result.invalid,
        preflightComplete: result.preflightComplete,
        complete: result.migrationComplete,
      }, null, 2)}\n`);
      return;
    }

    const result = await runLegacyLibraryMigrationToCompletion(store, ownerId, {
      jobId: 'query-v2',
      batchSize: MIGRATION_BATCH_SIZE,
      maximumBatches: legacyLibraryMigrationCompletionBatchLimit(MIGRATION_BATCH_SIZE),
    });
    if (!result.complete || result.invalid > 0 || result.remaining > 0) {
      throw new Error(`Owner ${ownerKey} failed final migration verification.`);
    }
    process.stdout.write(`${JSON.stringify({
      ownerKey,
      mode,
      migrated: result.migrated,
      merged: result.merged,
      complete: true,
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
    logFunctionEvent({
      event: 'legacy-library-operator',
      outcome: 'failed',
      reason: 'unexpected-error',
      errorClass: classifyFunctionError(error),
    });
    process.exit(1);
  },
);
