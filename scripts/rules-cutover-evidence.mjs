import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  MAX_ROLLBACK_SNAPSHOT_CIPHERTEXT_BYTES,
  readRollbackSnapshotObjectDescriptor,
  validateRollbackSnapshotObjectDescriptor,
} from './rollback-snapshot-object.mjs';

export { MAX_ROLLBACK_SNAPSHOT_CIPHERTEXT_BYTES };

const SHA256 = /^[a-f0-9]{64}$/;
const REVISION = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i;
const FIREBASE_PROJECT_ID = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;
const FIRESTORE_DATABASE_ID = /^(?:\(default\)|[a-z][a-z0-9-]{2,61}[a-z0-9])$/;
const TOP_LEVEL_FIELDS = Object.freeze([
  'schemaVersion',
  'operation',
  'status',
  'projectId',
  'databaseId',
  'compatibleClientRevision',
  'rulesSha256',
  'rollbackSnapshotCiphertextSha256',
  'rollbackSnapshotEncryption',
  'rollbackSnapshotObject',
  'verifiedAt',
  'writeFreezeConfirmed',
  'finalDeltaVerification',
  'counts',
]);
const COUNT_FIELDS = Object.freeze([
  'cards',
  'canonicalIdentities',
  'reservations',
  'duplicateIdentities',
  'invalidIdentities',
  'missingReservations',
  'mismatchedReservations',
]);
const KMS_KEY_VERSION = /^projects\/[a-z][a-z0-9-]{4,28}[a-z0-9]\/locations\/[a-z0-9-]{1,63}\/keyRings\/[A-Za-z0-9_-]{1,63}\/cryptoKeys\/[A-Za-z0-9_-]{1,63}\/cryptoKeyVersions\/[1-9][0-9]{0,19}$/;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

const sha256File = file => new Promise((resolve, reject) => {
  const hash = createHash('sha256');
  const stream = fs.createReadStream(file);
  stream.on('error', reject);
  stream.on('data', chunk => hash.update(chunk));
  stream.on('end', () => resolve(hash.digest('hex')));
});

export function assertRollbackSnapshotCiphertextFile(file) {
  const stat = fs.lstatSync(file);
  if (stat.isSymbolicLink()) {
    throw new Error('Rules cutover rollback snapshot ciphertext must not be a symbolic link.');
  }
  if (!stat.isFile()) {
    throw new Error('Rules cutover rollback snapshot ciphertext must be a regular file.');
  }
  if (stat.size === 0) {
    throw new Error('Rules cutover rollback snapshot ciphertext must not be empty.');
  }
  if (stat.size > MAX_ROLLBACK_SNAPSHOT_CIPHERTEXT_BYTES) {
    throw new Error('Rules cutover rollback snapshot ciphertext exceeds 10 GiB.');
  }
}

const hasExactFields = (value, fields) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const expected = new Set(fields);
  return Object.keys(value).length === fields.length
    && Object.keys(value).every(field => expected.has(field));
};

export function validateRulesCutoverEvidence(evidence, options) {
  const errors = [];
  if (!hasExactFields(evidence, TOP_LEVEL_FIELDS)) {
    errors.push('Rules cutover evidence contains unknown fields.');
    if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) return errors;
  }
  if (evidence.schemaVersion !== 1) errors.push('Rules cutover evidence schemaVersion must be 1.');
  if (!['cutover', 'rollback'].includes(options.operation) || evidence.operation !== options.operation) {
    errors.push('Rules cutover evidence operation does not match the approved operation.');
  }
  if (evidence.status !== `${options.operation}-ready`) {
    errors.push(`Rules cutover evidence status must be ${options.operation}-ready.`);
  }
  if (!FIREBASE_PROJECT_ID.test(options.projectId)) {
    errors.push('Rules cutover evidence requires a valid protected production project ID.');
  }
  if (evidence.projectId !== options.projectId) {
    errors.push('Rules cutover evidence project does not match the protected production project.');
  }
  if (!FIRESTORE_DATABASE_ID.test(options.databaseId)) {
    errors.push('Rules cutover evidence requires a valid protected production database ID.');
  }
  if (evidence.databaseId !== options.databaseId) {
    errors.push('Rules cutover evidence database does not match the protected production database.');
  }
  if (!REVISION.test(options.clientRevision) || evidence.compatibleClientRevision !== options.clientRevision) {
    errors.push('Rules cutover evidence is not bound to the compatible client revision.');
  }
  if (!SHA256.test(options.rulesSha256) || evidence.rulesSha256 !== options.rulesSha256) {
    errors.push('Rules cutover evidence is not bound to the approved Firestore Rules digest.');
  }
  if (!SHA256.test(options.rollbackSnapshotCiphertextSha256 ?? '')) {
    errors.push('Rules cutover verification requires a retained rollback snapshot ciphertext SHA-256.');
  }
  if (!SHA256.test(evidence.rollbackSnapshotCiphertextSha256 ?? '')) {
    errors.push('Rules cutover evidence requires a rollback snapshot ciphertext SHA-256.');
  } else if (evidence.rollbackSnapshotCiphertextSha256 !== options.rollbackSnapshotCiphertextSha256) {
    errors.push('Rules cutover evidence rollback snapshot ciphertext does not match the retained ciphertext.');
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
    errors.push(...rollbackSnapshotObjectErrors.map(error => `Rules cutover evidence ${error}`));
  } else if (!isDeepStrictEqual(evidence.rollbackSnapshotObject, options.rollbackSnapshotObject)) {
    errors.push('Rules cutover evidence rollback snapshot object does not match the retained immutable object.');
  }
  const evidenceKmsKeyVersionIsValid = (
    !hasExactFields(evidence.rollbackSnapshotEncryption, ['scheme', 'keyVersion'])
      ? false
      : evidence.rollbackSnapshotEncryption.scheme === 'gcp-kms-v1'
        && KMS_KEY_VERSION.test(evidence.rollbackSnapshotEncryption.keyVersion ?? '')
  );
  if (!evidenceKmsKeyVersionIsValid) {
    errors.push('Rules cutover evidence requires a supported external-KMS rollback snapshot encryption key.');
  }
  if (!KMS_KEY_VERSION.test(options.rollbackKmsKeyVersion ?? '')) {
    errors.push('Rules cutover verification requires a valid protected rollback KMS key version.');
  } else if (
    evidenceKmsKeyVersionIsValid
    && evidence.rollbackSnapshotEncryption.keyVersion !== options.rollbackKmsKeyVersion
  ) {
    errors.push('Rules cutover evidence KMS key version does not match the protected rollback key.');
  }
  if (evidence.writeFreezeConfirmed !== true) {
    errors.push('Rules cutover evidence must confirm the write freeze.');
  }
  if (evidence.finalDeltaVerification !== true) {
    errors.push('Rules cutover evidence must confirm final delta verification.');
  }

  const verifiedAt = typeof evidence.verifiedAt === 'string' ? new Date(evidence.verifiedAt) : new Date(Number.NaN);
  const age = options.now.getTime() - verifiedAt.getTime();
  if (
    !Number.isFinite(verifiedAt.getTime())
    || verifiedAt.toISOString() !== evidence.verifiedAt
    || age < -60_000
    || age > (options.maxAgeMs ?? 15 * 60_000)
  ) {
    errors.push('Rules cutover evidence must be fresh and timestamped in UTC.');
  }
  if (options.notBefore && (
    !Number.isFinite(options.notBefore.getTime())
    || verifiedAt.getTime() <= options.notBefore.getTime()
  )) {
    errors.push('Rules cutover evidence predates the completed migration.');
  }

  if (!hasExactFields(evidence.counts, COUNT_FIELDS)) {
    errors.push('Rules cutover evidence counts contain unknown or missing fields.');
  } else {
    for (const field of COUNT_FIELDS) {
      if (!Number.isSafeInteger(evidence.counts[field]) || evidence.counts[field] < 0) {
        errors.push(`Rules cutover evidence count ${field} must be a non-negative safe integer.`);
      }
    }
    if (evidence.counts.cards < evidence.counts.canonicalIdentities) {
      errors.push('Rules cutover evidence cannot contain more canonical identities than cards.');
    }
    if (evidence.counts.reservations !== evidence.counts.canonicalIdentities) {
      errors.push('Rules cutover evidence reservation count must equal canonical identity count.');
    }
    if (evidence.counts.duplicateIdentities !== 0) errors.push('Rules cutover evidence reports duplicate identities.');
    if (evidence.counts.invalidIdentities !== 0) errors.push('Rules cutover evidence reports invalid identities.');
    if (evidence.counts.missingReservations !== 0) errors.push('Rules cutover evidence reports missing reservations.');
    if (evidence.counts.mismatchedReservations !== 0) errors.push('Rules cutover evidence reports mismatched reservations.');
  }
  return [...new Set(errors)];
}

const parseOptions = args => {
  const options = new Map();
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (!name?.startsWith('--') || value === undefined || value.startsWith('--')) {
      throw new Error('Rules cutover options must be --name value pairs.');
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
    throw new Error('Usage: rules-cutover-evidence.mjs verify [--name value]');
  }
  const options = parseOptions(process.argv.slice(3));
  const evidencePath = path.resolve(required(options, '--file'));
  const bytes = fs.readFileSync(evidencePath);
  if (bytes.byteLength > 65_536) throw new Error('Rules cutover evidence exceeds 64 KiB.');
  const expectedEvidenceSha256 = required(options, '--evidence-sha256').toLowerCase();
  if (!SHA256.test(expectedEvidenceSha256) || sha256(bytes) !== expectedEvidenceSha256) {
    throw new Error('Rules cutover evidence file does not match the approved SHA-256.');
  }
  const rulesBytes = fs.readFileSync(path.resolve(required(options, '--rules-file')));
  const rollbackSnapshotCiphertextPath = path.resolve(required(options, '--rollback-snapshot-ciphertext-file'));
  assertRollbackSnapshotCiphertextFile(rollbackSnapshotCiphertextPath);
  const rollbackSnapshotObjectPrefix = required(options, '--rollback-snapshot-object-prefix');
  const rollbackSnapshotCiphertextSha256 = await sha256File(rollbackSnapshotCiphertextPath);
  const rollbackSnapshotObject = readRollbackSnapshotObjectDescriptor(
    path.resolve(required(options, '--rollback-snapshot-object-file')),
    {
      expectedBucket: required(options, '--rollback-snapshot-object-bucket'),
      expectedPrefix: rollbackSnapshotObjectPrefix,
      expectedSha256: rollbackSnapshotCiphertextSha256,
    },
  );
  if (rollbackSnapshotObject.sizeBytes !== fs.lstatSync(rollbackSnapshotCiphertextPath).size) {
    throw new Error('Rules cutover rollback snapshot object size does not match the retained ciphertext.');
  }
  const evidence = JSON.parse(bytes.toString('utf8'));
  const notBeforeValue = options.get('--not-before');
  const notBefore = notBeforeValue ? new Date(notBeforeValue) : undefined;
  if (notBefore && (!Number.isFinite(notBefore.getTime()) || notBefore.toISOString() !== notBeforeValue)) {
    throw new Error('Rules cutover --not-before must be an exact UTC ISO timestamp.');
  }
  const errors = validateRulesCutoverEvidence(evidence, {
    operation: required(options, '--operation'),
    projectId: required(options, '--project-id'),
    databaseId: required(options, '--database-id'),
    clientRevision: required(options, '--client-revision').toLowerCase(),
    rulesSha256: sha256(rulesBytes),
    rollbackSnapshotCiphertextSha256,
    rollbackSnapshotObject,
    rollbackSnapshotObjectPrefix,
    rollbackKmsKeyVersion: required(options, '--kms-key-version'),
    now: new Date(),
    notBefore,
  });
  if (errors.length > 0) throw new Error(`Rules cutover evidence is invalid:\n- ${errors.join('\n- ')}`);
  console.log(`Verified ${evidence.operation} evidence for ${evidence.projectId}/${evidence.databaseId}.`);
}
