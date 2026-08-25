import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { writeFile } from 'node:fs/promises';
import runtimeTarget from './runtime-target.json';
import {
  applyLegacyLibraryMigration,
  createFirestoreLegacyLibraryDiscoveryStore,
  listLibraryOwnerIds,
  listMigrationManifestOwnerIds,
  rollbackLegacyLibraryMigration,
} from './legacyLibraryMigrationFirestore.js';
import { runLegacyLibraryDiscovery } from './legacyLibraryMigration.js';
import {
  createMigrationOwnerKey,
  selectMigrationOwnerIds,
} from './legacyLibraryMigrationOwnerScope.js';

const requestedMode = process.env.MIGRATION_MODE?.trim();
const projectId = process.env.FIREBASE_PROJECT_ID?.trim();
const databaseId = process.env.FIRESTORE_DATABASE_ID?.trim();
const requestedOwnerKey = process.env.MIGRATION_OWNER_KEY?.trim() || undefined;
const requestedSourceRevision = process.env.MIGRATION_SOURCE_REVISION?.trim() || undefined;
const confirmation = process.env.MIGRATION_CONFIRMATION?.trim();
const PROJECT_ID = 'encoded-hangout-433912-h2';
const DATABASE_ID = runtimeTarget.firestoreDatabaseId;
const JOB_ID = 'query-v3';
const MAX_DISCOVERY_PAGES_PER_OWNER = 1_000;
const DIGEST = /^[a-f0-9]{64}$/;

// Validate every operator-controlled value before creating an Admin SDK client.
if (requestedMode !== 'dry-run' && requestedMode !== 'apply' && requestedMode !== 'rollback') {
  throw new Error('MIGRATION_MODE must be dry-run, apply or rollback.');
}
if (!projectId || projectId !== PROJECT_ID) throw new Error('FIREBASE_PROJECT_ID does not match the sealed Functions target.');
if (!databaseId || databaseId !== DATABASE_ID) throw new Error('FIRESTORE_DATABASE_ID does not match the sealed Functions target.');
if (requestedMode === 'apply' && confirmation !== 'APPLY_QUERY_V3') {
  throw new Error('Apply requires MIGRATION_CONFIRMATION=APPLY_QUERY_V3.');
}
if (requestedMode === 'rollback' && confirmation !== 'ROLLBACK_QUERY_V3') {
  throw new Error('Rollback requires MIGRATION_CONFIRMATION=ROLLBACK_QUERY_V3.');
}
if (requestedMode !== 'dry-run') {
  if (!requestedOwnerKey || !/^[a-f0-9]{12}$/.test(requestedOwnerKey)) {
    throw new Error('Apply and rollback require a 12-character MIGRATION_OWNER_KEY.');
  }
  if (!requestedSourceRevision || !DIGEST.test(requestedSourceRevision)) {
    throw new Error('Apply and rollback require a 64-character MIGRATION_SOURCE_REVISION.');
  }
}

const mode = requestedMode as 'dry-run' | 'apply' | 'rollback';

async function main(): Promise<void> {
  const app = getApps()[0] ?? initializeApp({ projectId: projectId as string });
  const database = getFirestore(app, databaseId as string);
  try {
    const store = createFirestoreLegacyLibraryDiscoveryStore(database);
    const ownerIds = mode === 'dry-run'
      ? await listLibraryOwnerIds(database)
      : await listMigrationManifestOwnerIds(database, JOB_ID);
    const selected = selectMigrationOwnerIds(ownerIds, mode, requestedOwnerKey);
    const reports: Array<Record<string, unknown>> = [];
    if (mode === 'dry-run') {
      for (const ownerId of selected) {
        let discovery = await runLegacyLibraryDiscovery(store, ownerId, {
          jobId: JOB_ID,
          batchSize: 100,
        });
        let pages = 1;
        while (discovery.phase === 'discover' && pages < MAX_DISCOVERY_PAGES_PER_OWNER) {
          if (discovery.scanned === 0) throw new Error('Legacy discovery stalled.');
          discovery = await runLegacyLibraryDiscovery(store, ownerId, { jobId: JOB_ID, batchSize: 100 });
          pages += 1;
        }
        if (discovery.phase !== 'discovered') throw new Error('Legacy discovery did not reach terminal state.');
        const manifest = await database.collection('users').doc(ownerId)
          .collection('admin_library_migration_jobs').doc(JOB_ID).get();
        reports.push({
          ownerKey: createMigrationOwnerKey(ownerId),
          mode,
          phase: discovery.phase,
          scanned: discovery.scanned,
          sourceCount: discovery.sourceCount ?? 0,
          groupCount: discovery.groupCount ?? 0,
          sourceRevision: manifest.data()?.sourceRevision ?? null,
          complete: false,
          invalid: discovery.invalid,
        });
      }
    } else {
      const ownerId = selected[0];
      if (!ownerId) throw new Error('No owner matched the supplied owner key.');
      const manifest = await database.collection('users').doc(ownerId)
        .collection('admin_library_migration_jobs').doc(JOB_ID).get();
      if (!manifest.exists || manifest.data()?.sourceRevision !== requestedSourceRevision) {
        throw new Error('MIGRATION_OWNER_KEY and MIGRATION_SOURCE_REVISION must match exactly one trusted manifest.');
      }
      if (mode === 'apply') {
        const result = await applyLegacyLibraryMigration(database, ownerId, {
          jobId: JOB_ID,
          sourceRevision: requestedSourceRevision as string,
        });
        reports.push({ ...result, ownerKey: createMigrationOwnerKey(ownerId), mode });
      } else {
        const result = await rollbackLegacyLibraryMigration(
          database,
          ownerId,
          JOB_ID,
          requestedSourceRevision,
        );
        reports.push({ ...result, ownerKey: createMigrationOwnerKey(ownerId), mode });
      }
    }
    const output = {
      mode,
      discoveredOwnerCount: ownerIds.length,
      selectedOwnerCount: selected.length,
      reports,
    };
    const reportFile = process.env.MIGRATION_REPORT_FILE?.trim();
    if (reportFile) await writeFile(reportFile, `${JSON.stringify(output, null, 2)}\n`, { flag: 'wx' });
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
