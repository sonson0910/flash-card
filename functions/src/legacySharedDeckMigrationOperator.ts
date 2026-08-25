import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import runtimeTarget from './runtime-target.json';
import {
  buildInventoryReport,
  applyLegacySharedDeckMigration,
  createFrozenLegacySharedDeckInventory,
  readSealedLegacySharedDeckInventory,
  supersedeLegacySharedDeckMigration,
  digestCanonicalValue,
  verifyLegacySharedDeckCutover,
  type LegacySharedDeckSupersedeOptions,
  type LegacySharedDeckCutoverVerification,
  type LegacySharedDeckInventory,
} from './legacySharedDeckMigration.js';

export {
  canonicalLegacySharedDeckBackupManifest,
  verifyLegacySharedDeckBackupManifest,
} from './legacySharedDeckMigration.js';

const execFileAsync = promisify(execFile);
const FULL_REVISION = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const OWNER_UID = /^[A-Za-z0-9_-]{1,128}$/;
const PROJECT_ID = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;

export type LegacySharedDeckOperatorMode = 'inventory' | 'apply' | 'supersede' | 'prepare-indexes';

export const buildLegacySharedDeckMigrationOperatorReport = (
  inventory: LegacySharedDeckInventory,
  verification: LegacySharedDeckCutoverVerification,
): string => {
  const migratedCount = inventory.entries.filter(entry => entry.action === 'migrate').length;
  const quarantinedCount = inventory.entries.filter(entry => entry.action === 'quarantine').length;
  return JSON.stringify({
    schemaVersion: 2,
    target: inventory.target,
    revision: inventory.revision,
    ownerKey: inventory.activeOwner.ownerKey,
    inventoryDigest: inventory.inventoryDigest,
    sealedManifestRootDigest: inventory.sealedManifest?.rootDigest ?? null,
    migratedCount,
    quarantinedCount,
    validLegacyPublicCount: verification.validLegacyPublicCount,
    activeLedgerCount: verification.activeLedgerCount,
    verified: verification.verified,
  });
};

/** Keep retry order explicit when verification had an in-flight durable pass. */
export const runLegacySharedDeckApplyAndVerify = async <TApply, TVerify>(
  apply: () => Promise<TApply>,
  verify: () => Promise<TVerify>,
): Promise<TVerify> => {
  await apply();
  return verify();
};

export type LegacySharedDeckSupersedeOperatorInput = Pick<
  LegacySharedDeckOperatorEnvironment,
  'ownerUid' | 'revision'
> & {
  readonly target: string;
  readonly inventoryDigest: string;
  readonly rootDigest: string;
  readonly confirmation: string;
};

export const runLegacySharedDeckSupersedeOperator = async (
  environment: LegacySharedDeckSupersedeOperatorInput,
  invoke: (options: LegacySharedDeckSupersedeOptions) => Promise<{ readonly superseded: true; readonly historyPath: string }>,
): Promise<string> => {
  const result = await invoke({
    ownerUid: environment.ownerUid,
    revision: environment.revision,
    target: environment.target,
    inventoryDigest: environment.inventoryDigest,
    rootDigest: environment.rootDigest,
    confirmation: environment.confirmation,
  });
  return JSON.stringify({
    schemaVersion: 2,
    target: environment.target,
    revision: environment.revision,
    inventoryDigest: environment.inventoryDigest,
    superseded: result.superseded,
  });
};

export const parseLegacySharedDeckOperatorMode = (
  environment: Partial<Pick<NodeJS.ProcessEnv, 'MIGRATION_MODE' | 'APPLY_CONFIRMATION' | 'SUPERSEDE_CONFIRMATION' | 'PREPARE_INDEXES_CONFIRMATION'>> = process.env,
): LegacySharedDeckOperatorMode => {
  const mode = environment.MIGRATION_MODE?.trim() || 'inventory';
  if (mode === 'inventory') return mode;
  if (mode === 'apply' && environment.APPLY_CONFIRMATION === 'APPLY_SHARED_DECK_V2') return mode;
  if (mode === 'supersede' && environment.SUPERSEDE_CONFIRMATION === 'SUPERSEDE_SHARED_DECK_V2') return mode;
  if (mode === 'prepare-indexes' && environment.PREPARE_INDEXES_CONFIRMATION === 'PREPARE_INDEXES_V2') return mode;
  throw new Error('Protected migration confirmation is invalid.');
};

export type LegacySharedDeckOperatorEnvironment = {
  readonly projectId: string;
  readonly databaseId: string;
  readonly ownerUid: string;
  readonly revision: string;
  readonly defaultBranch: string;
  readonly scanStartedAt: string;
  readonly mode: LegacySharedDeckOperatorMode;
  readonly applyConfirmation: string;
  readonly backupManifest: string;
  readonly backupPublicKey: string;
  readonly supersedeConfirmation: string;
  readonly supersedeSourceRevision: string;
  readonly supersedeInventoryDigest: string;
  readonly supersedeRootDigest: string;
  readonly indexPreparationRunId: string;
  readonly indexPreparationReportSha256: string;
  readonly indexPreparationReport: string;
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
  const mode = parseLegacySharedDeckOperatorMode(environment);
  const applyConfirmation = (environment.APPLY_CONFIRMATION ?? '').trim();
  const backupManifest = (environment.BACKUP_MANIFEST_JSON ?? '').trim();
  const backupPublicKey = (environment.BACKUP_PUBLIC_KEY ?? '').trim();
  const supersedeConfirmation = (environment.SUPERSEDE_CONFIRMATION ?? '').trim();
  const supersedeSourceRevision = (environment.SUPERSEDE_SOURCE_REVISION ?? '').trim();
  const supersedeInventoryDigest = (environment.SUPERSEDE_INVENTORY_DIGEST ?? '').trim();
  const supersedeRootDigest = (environment.SUPERSEDE_ROOT_DIGEST ?? '').trim();
  const indexPreparationRunId = (environment.INDEX_PREPARATION_RUN_ID ?? '').trim();
  const indexPreparationReportSha256 = (environment.INDEX_PREPARATION_REPORT_SHA256 ?? '').trim();
  const indexPreparationReport = (environment.INDEX_PREPARATION_REPORT_JSON ?? '').trim();
  if (!PROJECT_ID.test(projectId) || !databaseId || databaseId !== runtimeTarget.firestoreDatabaseId) {
    throw new Error('Protected Firebase target is invalid.');
  }
  if (!OWNER_UID.test(ownerUid)) throw new Error('Protected owner assertion is invalid.');
  if (!FULL_REVISION.test(revision)) throw new Error('Migration revision must be a full immutable SHA.');
  if (!/^[A-Za-z0-9._/-]{1,128}$/.test(defaultBranch)) throw new Error('Default branch is invalid.');
  if (!Number.isFinite(Date.parse(scanStartedAt))) throw new Error('Scan start is invalid.');
  if (mode === 'apply' && (!backupManifest || backupManifest.length > 16_384 || !backupPublicKey)) {
    throw new Error('A bounded backup manifest is required for apply.');
  }
  if (mode === 'apply' && (!/^[1-9][0-9]{0,19}$/.test(indexPreparationRunId)
    || !/^[a-f0-9]{64}$/.test(indexPreparationReportSha256)
    || indexPreparationReport.length === 0 || indexPreparationReport.length > 16_384)) {
    throw new Error('A successful immutable index-preparation report is required for apply.');
  }
  if (mode === 'supersede' && (!FULL_REVISION.test(supersedeSourceRevision)
    || supersedeSourceRevision === revision
    || !/^[a-f0-9]{64}$/.test(supersedeInventoryDigest)
    || !/^[a-f0-9]{64}$/.test(supersedeRootDigest))) {
    throw new Error('Supersede requires an immutable source revision and exact sealed inventory and root digests.');
  }
  return {
    projectId,
    databaseId,
    ownerUid,
    revision,
    defaultBranch,
    scanStartedAt,
    mode,
    applyConfirmation,
    backupManifest,
    backupPublicKey,
    supersedeConfirmation,
    supersedeSourceRevision,
    supersedeInventoryDigest,
    supersedeRootDigest,
    indexPreparationRunId,
    indexPreparationReportSha256,
    indexPreparationReport,
  };
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
  if (environment.mode === 'prepare-indexes') {
    throw new Error('Index preparation is a protected workflow step, not an Admin migration operation.');
  }
  // Firebase Admin is intentionally loaded only after all protected inputs and ancestry are checked.
  const [{ initializeApp }, { getFirestore }, { createFirestoreLegacySharedDeckInventoryStore }] = await Promise.all([
    import('firebase-admin/app'),
    import('firebase-admin/firestore'),
    import('./legacySharedDeckInventoryFirestore.js'),
  ]);
  const database = getFirestore(initializeApp({ projectId: environment.projectId }), environment.databaseId);
  const target = `${environment.projectId}/${environment.databaseId}`;
  // A supersede retry must branch before sealed inventory rehydration: the
  // normal sealed reader rejects the already-terminal superseded phase.
  if (environment.mode === 'supersede') {
    return runLegacySharedDeckSupersedeOperator({
      ownerUid: environment.ownerUid,
      revision: environment.supersedeSourceRevision,
      target,
      inventoryDigest: environment.supersedeInventoryDigest,
      rootDigest: environment.supersedeRootDigest,
      confirmation: environment.supersedeConfirmation,
    }, options => supersedeLegacySharedDeckMigration(database, options));
  }
  const inventory = environment.mode === 'inventory'
    ? await createFrozenLegacySharedDeckInventory({
      store: createFirestoreLegacySharedDeckInventoryStore(database),
      ownerUid: environment.ownerUid,
      runId: environment.revision,
      revision: environment.revision,
      target,
      scanStartedAt: environment.scanStartedAt,
    })
    : await readSealedLegacySharedDeckInventory(database, {
      ownerUid: environment.ownerUid,
      revision: environment.revision,
      target,
    });
  if (environment.mode === 'inventory') return buildInventoryReport(inventory);
  const backupManifest = JSON.parse(environment.backupManifest) as unknown;
  const indexPreparationReport = JSON.parse(environment.indexPreparationReport) as unknown;
  if (digestCanonicalValue(indexPreparationReport) !== environment.indexPreparationReportSha256) {
    throw new Error('Index-preparation report digest is invalid.');
  }
  const verification = await runLegacySharedDeckApplyAndVerify(
    () => applyLegacySharedDeckMigration(database, inventory, {
      ownerUid: environment.ownerUid,
      revision: environment.revision,
      target,
      confirmation: environment.applyConfirmation,
      backupManifest,
      backupPublicKey: environment.backupPublicKey,
      indexPreparation: {
        workflowRunId: environment.indexPreparationRunId,
        reportSha256: environment.indexPreparationReportSha256,
        report: indexPreparationReport as never,
      },
    }),
    () => verifyLegacySharedDeckCutover(database, inventory),
  );
  return buildLegacySharedDeckMigrationOperatorReport(inventory, verification);
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
