import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { writeFile } from 'node:fs/promises';
import runtimeTarget from './runtime-target.json';
import {
  runLegacyLibraryDiscovery,
} from './legacyLibraryMigration.js';
import {
  createFirestoreLegacyLibraryMigrationStore,
  forEachLibraryOwnerId,
} from './legacyLibraryMigrationFirestore.js';
import {
  createMigrationOwnerKey,
} from './legacyLibraryMigrationOwnerScope.js';

const requestedMode = process.env.MIGRATION_MODE?.trim();
const projectId = process.env.FIREBASE_PROJECT_ID?.trim();
const databaseId = process.env.FIRESTORE_DATABASE_ID?.trim();
const requestedOwnerKey = process.env.MIGRATION_OWNER_KEY?.trim() || undefined;
const PROJECT_ID = 'encoded-hangout-433912-h2';
const MAX_DISCOVERY_PAGES_PER_OWNER = 1_000;

if (requestedMode !== 'dry-run' && requestedMode !== 'apply' && requestedMode !== 'final-delta' && requestedMode !== 'rollback') {
  throw new Error('MIGRATION_MODE must be dry-run, apply, final-delta or rollback.');
}
if (!projectId || projectId !== PROJECT_ID) {
  throw new Error('FIREBASE_PROJECT_ID does not match the sealed Functions target.');
}
if (!databaseId || databaseId !== runtimeTarget.firestoreDatabaseId) {
  throw new Error('FIRESTORE_DATABASE_ID does not match the sealed Functions target.');
}
if (requestedMode !== 'dry-run') {
  throw new Error('Live legacy library apply, final-delta and rollback remain disabled until Task 7 CAS is installed.');
}
const mode = 'dry-run' as const;
const targetProjectId = projectId;
const targetDatabaseId = databaseId;

async function main(): Promise<void> {
  const app = getApps()[0] ?? initializeApp({ projectId: targetProjectId });
  const database = getFirestore(app, targetDatabaseId);
  try {
    const store = createFirestoreLegacyLibraryMigrationStore(database);
    if (requestedOwnerKey && !/^[a-f0-9]{12}$/.test(requestedOwnerKey)) {
      throw new Error('MIGRATION_OWNER_KEY must be the 12-character redacted owner key.');
    }
    const reports: Array<Record<string, unknown>> = [];

    let discoveredOwnerCount = 0;
    let selectedOwnerCount = 0;
    await forEachLibraryOwnerId(database, async ownerId => {
      discoveredOwnerCount += 1;
      if (requestedOwnerKey && createMigrationOwnerKey(ownerId) !== requestedOwnerKey) return;
      selectedOwnerCount += 1;
      const ownerKey = createMigrationOwnerKey(ownerId);
      let discovery = await runLegacyLibraryDiscovery(store, ownerId, {
        jobId: 'query-v3',
        batchSize: 100,
      });
      let ownerScanned = discovery.scanned;
      for (let page = 1; page < MAX_DISCOVERY_PAGES_PER_OWNER && discovery.phase === 'discover'; page += 1) {
        if (discovery.scanned === 0) {
          throw new Error(`Legacy discovery stalled for owner ${ownerKey}.`);
        }
        discovery = await runLegacyLibraryDiscovery(store, ownerId, {
          jobId: 'query-v3',
          batchSize: 100,
        });
        ownerScanned += discovery.scanned;
      }
      if (discovery.phase !== 'discovered') {
        throw new Error(`Legacy discovery did not reach provisional terminal state for owner ${ownerKey}.`);
      }
      reports.push({
        ownerKey,
        mode,
        phase: discovery.phase,
        scanned: ownerScanned,
        sourceCount: discovery.sourceCount ?? 0,
        groupCount: discovery.groupCount ?? 0,
        complete: false,
        invalid: discovery.invalid,
      });
    });
    const output = {
      mode,
      discoveredOwnerCount,
      selectedOwnerCount,
      reports,
      finalDeltaVerified: false,
      rollbackVerified: false,
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
