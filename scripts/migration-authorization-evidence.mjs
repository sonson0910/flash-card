import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { pathToFileURL } from 'node:url';
import { assertRollbackSnapshotCiphertextFile } from './rules-cutover-evidence.mjs';
import {
  readRollbackSnapshotObjectDescriptor,
  validateRollbackSnapshotObjectDescriptor,
} from './rollback-snapshot-object.mjs';

const SHA256 = /^[a-f0-9]{64}$/;
const REVISION = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i;
const FIREBASE_PROJECT_ID = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;
const FIRESTORE_DATABASE_ID = /^(?:\(default\)|[a-z][a-z0-9-]{2,61}[a-z0-9])$/;
const KMS_KEY_VERSION = /^projects\/[a-z][a-z0-9-]{4,28}[a-z0-9]\/locations\/[a-z0-9-]{1,63}\/keyRings\/[A-Za-z0-9_-]{1,63}\/cryptoKeys\/[A-Za-z0-9_-]{1,63}\/cryptoKeyVersions\/[1-9][0-9]{0,19}$/;
const GITHUB_RUN_ID = /^[1-9][0-9]{0,19}$/;
const TOP_LEVEL_FIELDS = Object.freeze([
  'schemaVersion',
  'purpose',
  'operation',
  'migrationMode',
  'migrationRunId',
  'migrationRunAttempt',
  'enforcementRunId',
  'enforcementRunAttempt',
  'enforcementEvidenceSha256',
  'projectId',
  'databaseId',
  'compatibleClientRevision',
  'rulesSha256',
  'rollbackSnapshotCiphertextSha256',
  'rollbackSnapshotEncryption',
  'rollbackSnapshotObject',
  'ownerCommitment',
  'authorizedAt',
  'writeFreezeConfirmed',
  'maxAutomaticRollbackSourceCards',
]);

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const sha256File = file => new Promise((resolve, reject) => {
  const hash = createHash('sha256');
  const stream = fs.createReadStream(file);
  stream.on('error', reject);
  stream.on('data', chunk => hash.update(chunk));
  stream.on('end', () => resolve(hash.digest('hex')));
});

const hasExactFields = (value, fields) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const expected = new Set(fields);
  return Object.keys(value).length === fields.length
    && Object.keys(value).every(field => expected.has(field));
};

const expectedMode = operation => operation === 'cutover' ? 'apply' : 'rollback';

export function validateMigrationAuthorizationEvidence(evidence, options) {
  const errors = [];
  if (!hasExactFields(evidence, TOP_LEVEL_FIELDS)) {
    errors.push('Migration authorization evidence contains unknown fields.');
    if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) return errors;
  }
  if (evidence.schemaVersion !== 2) errors.push('Migration authorization evidence schemaVersion must be 2.');
  if (evidence.purpose !== 'reservation-migration-authorization') {
    errors.push('Migration authorization evidence purpose is invalid.');
  }
  if (!['cutover', 'rollback'].includes(options.operation) || evidence.operation !== options.operation) {
    errors.push('Migration authorization evidence operation does not match the approved operation.');
  }
  if (!['apply', 'rollback'].includes(options.migrationMode) || evidence.migrationMode !== options.migrationMode) {
    errors.push('Migration authorization evidence migration mode does not match the requested mode.');
  }
  if (expectedMode(options.operation) !== options.migrationMode
    || expectedMode(evidence.operation) !== evidence.migrationMode) {
    errors.push('Migration authorization evidence migration mode does not match the Rules operation.');
  }
  if (!GITHUB_RUN_ID.test(options.migrationRunId)
    || evidence.migrationRunId !== options.migrationRunId) {
    errors.push('Migration authorization evidence workflow run ID does not match.');
  }
  if (!Number.isSafeInteger(options.migrationRunAttempt)
    || options.migrationRunAttempt < 1
    || evidence.migrationRunAttempt !== options.migrationRunAttempt) {
    errors.push('Migration authorization evidence workflow run attempt does not match.');
  }
  if (!GITHUB_RUN_ID.test(options.enforcementRunId)
    || evidence.enforcementRunId !== options.enforcementRunId) {
    errors.push('Migration authorization evidence enforcement run ID does not match.');
  }
  if (!Number.isSafeInteger(options.enforcementRunAttempt)
    || options.enforcementRunAttempt < 1
    || evidence.enforcementRunAttempt !== options.enforcementRunAttempt) {
    errors.push('Migration authorization evidence enforcement run attempt does not match.');
  }
  if (!SHA256.test(options.enforcementEvidenceSha256)
    || evidence.enforcementEvidenceSha256 !== options.enforcementEvidenceSha256) {
    errors.push('Migration authorization evidence enforcement digest does not match.');
  }
  if (!FIREBASE_PROJECT_ID.test(options.projectId) || evidence.projectId !== options.projectId) {
    errors.push('Migration authorization evidence project does not match protected production.');
  }
  if (!FIRESTORE_DATABASE_ID.test(options.databaseId) || evidence.databaseId !== options.databaseId) {
    errors.push('Migration authorization evidence database does not match protected production.');
  }
  if (!REVISION.test(options.clientRevision) || evidence.compatibleClientRevision !== options.clientRevision) {
    errors.push('Migration authorization evidence is not bound to the compatible client revision.');
  }
  if (!SHA256.test(options.rulesSha256) || evidence.rulesSha256 !== options.rulesSha256) {
    errors.push('Migration authorization evidence is not bound to the approved Firestore Rules digest.');
  }
  if (!SHA256.test(options.rollbackSnapshotCiphertextSha256)
    || evidence.rollbackSnapshotCiphertextSha256 !== options.rollbackSnapshotCiphertextSha256) {
    errors.push('Migration authorization evidence rollback snapshot ciphertext does not match.');
  }
  const rollbackSnapshotObjectErrors = validateRollbackSnapshotObjectDescriptor(
    evidence.rollbackSnapshotObject,
    {
      expectedBucket: options.rollbackSnapshotObject?.bucket,
      expectedPrefix: options.rollbackSnapshotObjectPrefix,
      expectedSha256: options.rollbackSnapshotCiphertextSha256,
    },
  );
  if (rollbackSnapshotObjectErrors.length > 0) {
    errors.push(...rollbackSnapshotObjectErrors.map(error => `Migration authorization evidence ${error}`));
  } else if (!isDeepStrictEqual(evidence.rollbackSnapshotObject, options.rollbackSnapshotObject)) {
    errors.push('Migration authorization evidence rollback snapshot object does not match the immutable archive object.');
  }
  const encryptionIsValid = hasExactFields(evidence.rollbackSnapshotEncryption, ['scheme', 'keyVersion'])
    && evidence.rollbackSnapshotEncryption.scheme === 'gcp-kms-v1'
    && KMS_KEY_VERSION.test(evidence.rollbackSnapshotEncryption.keyVersion ?? '');
  if (!encryptionIsValid) {
    errors.push('Migration authorization evidence requires external-KMS rollback encryption.');
  } else if (!KMS_KEY_VERSION.test(options.rollbackKmsKeyVersion)
    || evidence.rollbackSnapshotEncryption.keyVersion !== options.rollbackKmsKeyVersion) {
    errors.push('Migration authorization evidence rollback KMS key version does not match.');
  }
  if (!SHA256.test(options.ownerCommitment) || evidence.ownerCommitment !== options.ownerCommitment) {
    errors.push('Migration authorization evidence owner commitment does not match.');
  }
  if (evidence.writeFreezeConfirmed !== true) {
    errors.push('Migration authorization evidence must confirm the write freeze.');
  }
  if (evidence.maxAutomaticRollbackSourceCards !== 100) {
    errors.push('Migration authorization evidence rollback source cap must be 100.');
  }
  const authorizedAt = typeof evidence.authorizedAt === 'string'
    ? new Date(evidence.authorizedAt)
    : new Date(Number.NaN);
  const age = options.now.getTime() - authorizedAt.getTime();
  if (!Number.isFinite(authorizedAt.getTime())
    || authorizedAt.toISOString() !== evidence.authorizedAt
    || age < -60_000
    || age > (options.maxAgeMs ?? 15 * 60_000)) {
    errors.push('Migration authorization evidence must be fresh and timestamped in UTC.');
  }
  return [...new Set(errors)];
}

const parseOptions = args => {
  const options = new Map();
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (!name?.startsWith('--') || value === undefined || value.startsWith('--')) {
      throw new Error('Migration authorization options must be --name value pairs.');
    }
    if (options.has(name)) throw new Error(`Duplicate option ${name}.`);
    options.set(name, value);
  }
  return options;
};

const required = (options, name) => {
  const value = options.get(name);
  if (!value) throw new Error(`Missing required option ${name}.`);
  return value;
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv[2] !== 'verify') {
    throw new Error('Usage: migration-authorization-evidence.mjs verify [--name value]');
  }
  const options = parseOptions(process.argv.slice(3));
  const evidencePath = path.resolve(required(options, '--file'));
  const bytes = fs.readFileSync(evidencePath);
  if (bytes.byteLength > 65_536) throw new Error('Migration authorization evidence exceeds 64 KiB.');
  const expectedEvidenceSha256 = required(options, '--evidence-sha256').toLowerCase();
  if (!SHA256.test(expectedEvidenceSha256) || sha256(bytes) !== expectedEvidenceSha256) {
    throw new Error('Migration authorization evidence file does not match the approved SHA-256.');
  }
  const rollbackPath = path.resolve(required(options, '--rollback-snapshot-ciphertext-file'));
  assertRollbackSnapshotCiphertextFile(rollbackPath);
  const rollbackSnapshotObjectPrefix = required(options, '--rollback-snapshot-object-prefix');
  const rollbackSnapshotCiphertextSha256 = await sha256File(rollbackPath);
  const rollbackSnapshotObject = readRollbackSnapshotObjectDescriptor(
    path.resolve(required(options, '--rollback-snapshot-object-file')),
    {
      expectedBucket: required(options, '--rollback-snapshot-object-bucket'),
      expectedPrefix: rollbackSnapshotObjectPrefix,
      expectedSha256: rollbackSnapshotCiphertextSha256,
    },
  );
  if (rollbackSnapshotObject.sizeBytes !== fs.lstatSync(rollbackPath).size) {
    throw new Error('Migration authorization rollback snapshot object size does not match the retained ciphertext.');
  }
  const evidence = JSON.parse(bytes.toString('utf8'));
  const migrationRunAttemptValue = required(options, '--migration-run-attempt');
  const migrationRunAttempt = Number(migrationRunAttemptValue);
  if (!/^[1-9][0-9]{0,9}$/.test(migrationRunAttemptValue)
    || !Number.isSafeInteger(migrationRunAttempt)) {
    throw new Error('Migration authorization --migration-run-attempt must be a positive integer.');
  }
  const enforcementRunAttemptValue = required(options, '--enforcement-run-attempt');
  const enforcementRunAttempt = Number(enforcementRunAttemptValue);
  if (!/^[1-9][0-9]{0,9}$/.test(enforcementRunAttemptValue)
    || !Number.isSafeInteger(enforcementRunAttempt)) {
    throw new Error('Migration authorization --enforcement-run-attempt must be a positive integer.');
  }
  const errors = validateMigrationAuthorizationEvidence(evidence, {
    operation: required(options, '--operation'),
    migrationMode: required(options, '--migration-mode'),
    migrationRunId: required(options, '--migration-run-id'),
    migrationRunAttempt,
    enforcementRunId: required(options, '--enforcement-run-id'),
    enforcementRunAttempt,
    enforcementEvidenceSha256: required(options, '--enforcement-evidence-sha256').toLowerCase(),
    projectId: required(options, '--project-id'),
    databaseId: required(options, '--database-id'),
    clientRevision: required(options, '--client-revision').toLowerCase(),
    rulesSha256: sha256(fs.readFileSync(path.resolve(required(options, '--rules-file')))),
    rollbackSnapshotCiphertextSha256,
    rollbackSnapshotObject,
    rollbackSnapshotObjectPrefix,
    rollbackKmsKeyVersion: required(options, '--kms-key-version'),
    ownerCommitment: required(options, '--owner-commitment'),
    now: new Date(),
  });
  if (errors.length > 0) throw new Error(`Migration authorization evidence is invalid:\n- ${errors.join('\n- ')}`);
  console.log(`Verified ${evidence.migrationMode} authorization for ${evidence.projectId}/${evidence.databaseId}.`);
}
