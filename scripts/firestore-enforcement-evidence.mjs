import { createHash } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const FIELDS = Object.freeze([
  'candidateRunId',
  'candidateSha256',
  'databaseId',
  'enforcementRunAttempt',
  'enforcementRunId',
  'productionDeploymentRunAttempt',
  'productionDeploymentRunId',
  'projectId',
  'recordedAt',
  'revision',
  'schemaVersion',
  'strictRulesSha256',
]);

const REVISION_PATTERN = /^([a-f0-9]{40}|[a-f0-9]{64})$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const RUN_ID_PATTERN = /^[1-9][0-9]{0,19}$/;
const RUN_ATTEMPT_PATTERN = /^[1-9][0-9]{0,9}$/;
const PROJECT_PATTERN = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;
const DATABASE_PATTERN = /^(\(default\)|[a-z][a-z0-9-]{2,61}[a-z0-9])$/;
const UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

const sha256 = value => createHash('sha256').update(value).digest('hex');
const sameKeys = value => JSON.stringify(Object.keys(value).sort()) === JSON.stringify(FIELDS);
const matchesExpected = (actual, expected) => expected === undefined || String(actual) === String(expected);
const isPositiveSafeInteger = value => Number.isSafeInteger(value) && value >= 1;

export function validateFirestoreEnforcementEvidence(evidence, options = {}) {
  const errors = [];
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) {
    return ['Firestore enforcement evidence must be an object.'];
  }
  if (!sameKeys(evidence)) errors.push('Firestore enforcement evidence has unknown or missing fields.');
  if (evidence.schemaVersion !== 1) errors.push('Firestore enforcement evidence schemaVersion must be 1.');
  if (!REVISION_PATTERN.test(evidence.revision)) errors.push('Firestore enforcement revision is invalid.');
  if (!isPositiveSafeInteger(evidence.candidateRunId)
    || !RUN_ID_PATTERN.test(String(evidence.candidateRunId))) errors.push('Candidate run ID is invalid.');
  if (!SHA256_PATTERN.test(evidence.candidateSha256)) errors.push('Candidate SHA-256 is invalid.');
  if (!isPositiveSafeInteger(evidence.productionDeploymentRunId)
    || !RUN_ID_PATTERN.test(String(evidence.productionDeploymentRunId))) errors.push('Production deployment run ID is invalid.');
  if (!isPositiveSafeInteger(evidence.productionDeploymentRunAttempt)
    || !RUN_ATTEMPT_PATTERN.test(String(evidence.productionDeploymentRunAttempt))) errors.push('Production deployment run attempt is invalid.');
  if (!isPositiveSafeInteger(evidence.enforcementRunId)
    || !RUN_ID_PATTERN.test(String(evidence.enforcementRunId))) errors.push('Enforcement run ID is invalid.');
  if (!isPositiveSafeInteger(evidence.enforcementRunAttempt)
    || !RUN_ATTEMPT_PATTERN.test(String(evidence.enforcementRunAttempt))) errors.push('Enforcement run attempt is invalid.');
  if (!SHA256_PATTERN.test(evidence.strictRulesSha256)) errors.push('Strict Rules SHA-256 is invalid.');
  if (!PROJECT_PATTERN.test(evidence.projectId)) errors.push('Firebase project ID is invalid.');
  if (!DATABASE_PATTERN.test(evidence.databaseId)) errors.push('Firestore database ID is invalid.');
  const recordedAt = typeof evidence.recordedAt === 'string'
    ? new Date(evidence.recordedAt)
    : new Date(Number.NaN);
  if (!UTC_PATTERN.test(evidence.recordedAt)
    || !Number.isFinite(recordedAt.getTime())
    || recordedAt.toISOString() !== evidence.recordedAt) {
    errors.push('Enforcement recordedAt timestamp is invalid.');
  }
  const expected = {
    revision: options.revision,
    candidateRunId: options.candidateRunId,
    candidateSha256: options.candidateSha256,
    productionDeploymentRunId: options.productionDeploymentRunId,
    productionDeploymentRunAttempt: options.productionDeploymentRunAttempt,
    enforcementRunId: options.enforcementRunId,
    enforcementRunAttempt: options.enforcementRunAttempt,
    projectId: options.projectId,
    databaseId: options.databaseId,
  };
  Object.entries(expected).forEach(([key, value]) => {
    if (!matchesExpected(evidence[key], value)) errors.push(`Firestore enforcement ${key} does not match.`);
  });
  if (options.rulesFile) {
    const rulesSha256 = sha256(readFileSync(options.rulesFile));
    if (evidence.strictRulesSha256 !== rulesSha256) errors.push('Strict Rules digest does not match.');
  }
  if (options.evidenceSha256 !== undefined
    && (!SHA256_PATTERN.test(options.evidenceSha256)
      || !options.rawEvidence
      || sha256(options.rawEvidence) !== options.evidenceSha256)) {
    errors.push('Firestore enforcement evidence SHA-256 does not match.');
  }
  return errors;
}

function parseArguments(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith('--') || value === undefined || value.startsWith('--')) {
      throw new Error(`Invalid argument: ${key ?? ''}`);
    }
    const name = key.slice(2);
    if (Object.hasOwn(values, name)) throw new Error(`Duplicate argument: ${key}`);
    values[name] = value;
  }
  return values;
}

function main() {
  const [command, ...rest] = process.argv.slice(2);
  if (command !== 'verify') throw new Error('Usage: firestore-enforcement-evidence.mjs verify --file <path> ...');
  const args = parseArguments(rest);
  if (!args.file) throw new Error('Missing required argument: --file');
  const evidenceStats = lstatSync(args.file);
  if (!evidenceStats.isFile() || evidenceStats.isSymbolicLink()) {
    throw new Error('Firestore enforcement evidence must be a regular file.');
  }
  if (evidenceStats.size > 4096) throw new Error('Firestore enforcement evidence exceeds 4 KiB.');
  const rawEvidence = readFileSync(args.file);
  const evidence = JSON.parse(rawEvidence.toString('utf8'));
  const errors = validateFirestoreEnforcementEvidence(evidence, {
    rawEvidence,
    evidenceSha256: args['evidence-sha256'],
    revision: args.revision,
    candidateRunId: args['candidate-run-id'],
    candidateSha256: args['candidate-sha256'],
    productionDeploymentRunId: args['production-deploy-run-id'],
    productionDeploymentRunAttempt: args['production-deploy-run-attempt'],
    enforcementRunId: args['enforcement-run-id'],
    enforcementRunAttempt: args['enforcement-run-attempt'],
    projectId: args['project-id'],
    databaseId: args['database-id'],
    rulesFile: args['rules-file'],
  });
  if (errors.length) throw new Error(errors.join('\n'));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
