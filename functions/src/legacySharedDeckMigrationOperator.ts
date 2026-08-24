import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import runtimeTarget from './runtime-target.json';
import {
  buildInventoryReport,
  createLegacySharedDeckInventory,
} from './legacySharedDeckMigration.js';

const execFileAsync = promisify(execFile);
const FULL_REVISION = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const OWNER_UID = /^[A-Za-z0-9_-]{1,128}$/;
const PROJECT_ID = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;

export type LegacySharedDeckOperatorEnvironment = {
  readonly projectId: string;
  readonly databaseId: string;
  readonly ownerUid: string;
  readonly revision: string;
  readonly defaultBranch: string;
  readonly scanStartedAt: string;
};

export const validateLegacySharedDeckOperatorEnvironment = (
  environment: NodeJS.ProcessEnv = process.env,
): LegacySharedDeckOperatorEnvironment => {
  const projectId = environment.FIREBASE_PROJECT_ID?.trim() ?? '';
  const databaseId = environment.FIRESTORE_DATABASE_ID?.trim() ?? '';
  const ownerUid = environment.OWNER_UID?.trim() ?? '';
  const revision = (environment.MIGRATION_REVISION ?? environment.GITHUB_SHA ?? '').trim();
  const defaultBranch = (environment.GITHUB_DEFAULT_BRANCH ?? 'main').trim();
  const scanStartedAt = (environment.SCAN_STARTED_AT ?? '').trim();
  if (!PROJECT_ID.test(projectId) || !databaseId || databaseId !== runtimeTarget.firestoreDatabaseId) {
    throw new Error('Protected Firebase target is invalid.');
  }
  if (!OWNER_UID.test(ownerUid)) throw new Error('Protected owner assertion is invalid.');
  if (!FULL_REVISION.test(revision)) throw new Error('Migration revision must be a full immutable SHA.');
  if (!/^[A-Za-z0-9._/-]{1,128}$/.test(defaultBranch)) throw new Error('Default branch is invalid.');
  if (!Number.isFinite(Date.parse(scanStartedAt))) throw new Error('Scan start is invalid.');
  return { projectId, databaseId, ownerUid, revision, defaultBranch, scanStartedAt };
};

export const assertLegacySharedDeckRevisionOnDefaultBranch = async (
  revision: string,
  defaultBranch: string,
  cwd = process.cwd(),
): Promise<void> => {
  if (!FULL_REVISION.test(revision)) throw new Error('Migration revision must be a full immutable SHA.');
  try {
    await execFileAsync('git', ['merge-base', '--is-ancestor', revision, `origin/${defaultBranch}`], { cwd });
  } catch {
    throw new Error('Migration revision is not an ancestor of the protected default branch.');
  }
};

export const runLegacySharedDeckInventoryOperator = async (
  environment: LegacySharedDeckOperatorEnvironment,
): Promise<string> => {
  // Firebase Admin is intentionally loaded only after all protected inputs and ancestry are checked.
  const [{ initializeApp }, { getFirestore }, { createFirestoreLegacySharedDeckInventoryStore }] = await Promise.all([
    import('firebase-admin/app'),
    import('firebase-admin/firestore'),
    import('./legacySharedDeckInventoryFirestore.js'),
  ]);
  const database = getFirestore(initializeApp({ projectId: environment.projectId }), environment.databaseId);
  const inventory = await createLegacySharedDeckInventory({
    store: createFirestoreLegacySharedDeckInventoryStore(database),
    ownerUid: environment.ownerUid,
    runId: environment.revision,
    revision: environment.revision,
    target: `${environment.projectId}/${environment.databaseId}`,
    scanStartedAt: environment.scanStartedAt,
  });
  const report = buildInventoryReport(inventory);
  return report;
};

export const main = async (): Promise<void> => {
  const environment = validateLegacySharedDeckOperatorEnvironment();
  await assertLegacySharedDeckRevisionOnDefaultBranch(environment.revision, environment.defaultBranch);
  process.stdout.write(`${await runLegacySharedDeckInventoryOperator(environment)}\n`);
};

if (process.argv[1]?.endsWith('legacySharedDeckMigrationOperator.js')) {
  void main().catch(() => {
    process.stderr.write('Legacy shared-deck inventory failed.\n');
    process.exitCode = 1;
  });
}
