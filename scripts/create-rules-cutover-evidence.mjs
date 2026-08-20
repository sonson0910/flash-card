import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const REVISION = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i;
const PROJECT = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;
const DATABASE = /^(?:\(default\)|[a-z][a-z0-9-]{2,61}[a-z0-9])$/;
const KMS = /^projects\/[a-z][a-z0-9-]{4,28}[a-z0-9]\/locations\/[a-z0-9-]{1,63}\/keyRings\/[A-Za-z0-9_-]{1,63}\/cryptoKeys\/[A-Za-z0-9_-]{1,63}\/cryptoKeyVersions\/[1-9][0-9]{0,19}$/;

const parseArgs = args => {
  const values = new Map();
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (!key?.startsWith('--') || value === undefined || value.startsWith('--') || values.has(key)) {
      throw new Error('Evidence options must be unique --name value pairs.');
    }
    values.set(key, value);
  }
  return values;
};

const required = (values, name) => {
  const value = values.get(name);
  if (!value) throw new Error(`Missing required evidence option ${name}.`);
  return value;
};

const readReportCounts = report => {
  const counts = report?.counts;
  const fields = [
    'cards', 'canonicalIdentities', 'reservations', 'duplicateIdentities',
    'invalidIdentities', 'missingReservations', 'mismatchedReservations',
  ];
  if (!counts || typeof counts !== 'object' || fields.some(field => (
    !Number.isSafeInteger(counts[field]) || counts[field] < 0
  ))) throw new Error('Migration report counts are incomplete or unsafe.');
  return Object.fromEntries(fields.map(field => [field, counts[field]]));
};

export function createRulesCutoverEvidence(options) {
  const report = JSON.parse(fs.readFileSync(path.resolve(options.report), 'utf8'));
  const rulesBytes = fs.readFileSync(path.resolve(options.rules));
  const snapshotBytes = fs.readFileSync(path.resolve(options.snapshot));
  if (!REVISION.test(options.revision)) throw new Error('Evidence revision is invalid.');
  if (!PROJECT.test(options.projectId)) throw new Error('Evidence project is invalid.');
  if (!DATABASE.test(options.databaseId)) throw new Error('Evidence database is invalid.');
  if (!KMS.test(options.kmsKeyVersion)) throw new Error('Evidence KMS key version is invalid.');
  if (!['cutover', 'rollback'].includes(options.operation)) throw new Error('Evidence operation is invalid.');
  if ((options.operation === 'cutover' && report.mode !== 'final-delta')
    || (options.operation === 'rollback' && report.mode !== 'rollback')) {
    throw new Error('Evidence operation does not match the migration report mode.');
  }
  if (options.operation === 'cutover' && report.finalDeltaVerified !== true) {
    throw new Error('Evidence requires a verified final-delta migration report.');
  }
  if (options.operation === 'rollback' && report.rollbackVerified !== true) {
    throw new Error('Evidence requires a verified rollback migration report.');
  }
  const counts = readReportCounts(report);
  if (options.operation === 'cutover' && (
    counts.duplicateIdentities
    || counts.invalidIdentities
    || counts.missingReservations
    || counts.mismatchedReservations
  )) {
    throw new Error('Evidence cannot attest unresolved migration integrity findings.');
  }
  return {
    schemaVersion: 1,
    operation: options.operation,
    status: `${options.operation}-ready`,
    projectId: options.projectId,
    databaseId: options.databaseId,
    compatibleClientRevision: options.revision.toLowerCase(),
    rulesSha256: sha256(rulesBytes),
    rollbackSnapshotCiphertextSha256: sha256(snapshotBytes),
    rollbackSnapshotEncryption: { scheme: 'gcp-kms-v1', keyVersion: options.kmsKeyVersion },
    verifiedAt: new Date().toISOString(),
    writeFreezeConfirmed: options.writeFreezeConfirmed === 'true',
    finalDeltaVerification: options.finalDeltaVerification === 'true',
    rollbackVerification: options.rollbackVerification === 'true',
    counts,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const values = parseArgs(process.argv.slice(2));
  const evidence = createRulesCutoverEvidence({
    report: required(values, '--report'),
    rules: required(values, '--rules'),
    snapshot: required(values, '--snapshot'),
    revision: required(values, '--revision'),
    projectId: required(values, '--project-id'),
    databaseId: required(values, '--database-id'),
    kmsKeyVersion: required(values, '--kms-key-version'),
    operation: required(values, '--operation'),
    writeFreezeConfirmed: required(values, '--write-freeze-confirmed'),
    finalDeltaVerification: required(values, '--final-delta-verification'),
    rollbackVerification: required(values, '--rollback-verification'),
  });
  const output = path.resolve(required(values, '--output'));
  fs.writeFileSync(output, `${JSON.stringify(evidence, null, 2)}\n`, { flag: 'wx' });
  process.stdout.write(`${JSON.stringify(evidence)}\n`);
}
