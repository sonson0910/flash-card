import { createHash, createPublicKey } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const IMMUTABLE_REVISION = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i;
const SHA256 = /^[a-f0-9]{64}$/;
const FIREBASE_PROJECT_ID = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;
const FIRESTORE_DATABASE_ID = /^(?:\(default\)|[a-z][a-z0-9-]{2,61}[a-z0-9])$/;
const KMS_KEY_VERSION = /^projects\/[a-z][a-z0-9-]{4,28}[a-z0-9]\/locations\/[a-z0-9-]{1,63}\/keyRings\/[A-Za-z0-9_-]{1,63}\/cryptoKeys\/[A-Za-z0-9_-]{1,63}\/cryptoKeyVersions\/[1-9][0-9]{0,19}$/;
const TRUST_ROOT_PATH = 'evidence-attestation-trust-root.json';
const RELEASE_ARTIFACT_SCHEMA_VERSION = 2;
const TRUST_ROOT_SCHEMA_VERSION = 1;
const PLACEHOLDER = 'UNCONFIGURED';
const MAX_ATTESTATION_TRUST_ROOT_BYTES = 16_384;
const MAX_KMS_METADATA_BYTES = 16_384;
const MAX_ATTESTATION_PUBLIC_KEY_BYTES = 16_384;
const SUPPORTED_EVIDENCE_ATTESTATION_KMS_ALGORITHMS = new Set([
  'EC_SIGN_P256_SHA256',
  'RSA_SIGN_PKCS1_2048_SHA256',
  'RSA_SIGN_PKCS1_3072_SHA256',
  'RSA_SIGN_PKCS1_4096_SHA256',
]);
const PUBLIC_KEY_PEM = /^-----BEGIN PUBLIC KEY-----\r?\n(?:[A-Za-z0-9+/=]+\r?\n)+-----END PUBLIC KEY-----\r?\n?$/;
const FUNCTIONS_RUNTIME_TARGET_PATH = 'functions/lib/runtime-target.json';
const COMPONENT_PATHS = Object.freeze({
  dist: { path: 'dist', type: 'directory' },
  functionsLib: { path: 'functions/lib', type: 'directory' },
  functionsPackage: { path: 'functions/package.json', type: 'file' },
  functionsLock: { path: 'functions/package-lock.json', type: 'file' },
  firestoreRules: { path: 'firestore.rules', type: 'file' },
  firestoreCompatibilityRules: { path: 'firestore.compatibility.rules', type: 'file' },
  firestoreIndexes: { path: 'firestore.indexes.json', type: 'file' },
  firebaseConfig: { path: 'firebase.json', type: 'file' },
  firebaseAppletConfig: { path: 'firebase-applet-config.json', type: 'file' },
  readiness: { path: 'artifacts/phase6-readiness.json', type: 'file' },
  evidenceAttestationTrustRoot: { path: TRUST_ROOT_PATH, type: 'file' },
});

const sha256 = value => createHash('sha256').update(value).digest('hex');

const requireSafePath = (root, relativePath, label) => {
  const candidateRoot = path.resolve(root);
  const absolutePath = path.resolve(candidateRoot, relativePath);
  const relative = path.relative(candidateRoot, absolutePath);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`${label} escapes the release candidate root.`);
  }
  let current = candidateRoot;
  for (const segment of ['', ...relative.split(path.sep).filter(Boolean)]) {
    if (segment) current = path.join(current, segment);
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) throw new Error(`${label} contains a symbolic link.`);
  }
  return fs.lstatSync(absolutePath);
};

const requireFile = (root, relativePath, label) => {
  const stat = requireSafePath(root, relativePath, label);
  if (!stat.isFile()) throw new Error(`${label} must be a regular file.`);
  return stat;
};

const requireRegularFile = (file, label) => {
  if (typeof file !== 'string' || file.length === 0) {
    throw new Error(`${label} path must be a non-empty string.`);
  }
  const stat = fs.lstatSync(file);
  if (stat.isSymbolicLink()) throw new Error(`${label} must not be a symbolic link.`);
  if (!stat.isFile()) throw new Error(`${label} must be a regular file.`);
  return stat;
};

const exactKeys = (value, expected) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === [...expected].sort()[index]);
};

const parseBoundedJsonFile = (file, label, maxBytes, expectedKeys) => {
  const stat = requireRegularFile(file, label);
  if (stat.size > maxBytes) throw new Error(`${label} exceeds ${maxBytes / 1024} KiB.`);
  const bytes = fs.readFileSync(file);
  let value;
  try {
    value = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new Error(`${label} is not valid JSON.`);
  }
  if (!exactKeys(value, expectedKeys)) throw new Error(`${label} has an invalid schema.`);
  return value;
};

const requireConfiguredKmsKeyVersion = (value, label) => {
  if (value === PLACEHOLDER) throw new Error(`${label} is UNCONFIGURED.`);
  if (typeof value !== 'string' || !KMS_KEY_VERSION.test(value)) {
    throw new Error(`${label} must be an immutable CryptoKeyVersion resource.`);
  }
  return value;
};

const requireSupportedKmsAlgorithm = (value, label) => {
  if (value === PLACEHOLDER) throw new Error(`${label} is UNCONFIGURED.`);
  if (typeof value !== 'string' || !SUPPORTED_EVIDENCE_ATTESTATION_KMS_ALGORITHMS.has(value)) {
    throw new Error(`${label} is not a supported SHA-256 signing algorithm.`);
  }
  return value;
};

const requireSpkiSha256 = (value, label) => {
  if (value === PLACEHOLDER) throw new Error(`${label} is UNCONFIGURED.`);
  if (typeof value !== 'string' || !SHA256.test(value)) {
    throw new Error(`${label} must be a lowercase DER SPKI SHA-256 fingerprint.`);
  }
  return value;
};

const readEvidenceAttestationTrustRoot = root => {
  const candidateRoot = path.resolve(root);
  const relativePath = TRUST_ROOT_PATH;
  const file = path.resolve(candidateRoot, relativePath);
  let stat;
  try {
    stat = requireFile(candidateRoot, relativePath, 'Evidence attestation trust root');
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') {
      throw new Error('Evidence attestation trust root is missing.');
    }
    throw error;
  }
  if (stat.size > MAX_ATTESTATION_TRUST_ROOT_BYTES) {
    throw new Error('Evidence attestation trust root exceeds 16 KiB.');
  }
  let trustRoot;
  try {
    trustRoot = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    throw new Error('Evidence attestation trust root is not valid JSON.');
  }
  if (!exactKeys(trustRoot, [
    'schemaVersion',
    'evidenceAttestationKmsKeyVersion',
    'evidenceAttestationKmsAlgorithm',
    'evidenceAttestationPublicKeySpkiSha256',
  ])) {
    throw new Error('Evidence attestation trust root has an invalid schema.');
  }
  if (trustRoot.schemaVersion !== TRUST_ROOT_SCHEMA_VERSION) {
    throw new Error('Unsupported evidence attestation trust root schemaVersion.');
  }
  return {
    schemaVersion: trustRoot.schemaVersion,
    evidenceAttestationKmsKeyVersion: requireConfiguredKmsKeyVersion(
      trustRoot.evidenceAttestationKmsKeyVersion,
      'Evidence attestation trust-root KMS key version',
    ),
    evidenceAttestationKmsAlgorithm: requireSupportedKmsAlgorithm(
      trustRoot.evidenceAttestationKmsAlgorithm,
      'Evidence attestation trust-root KMS algorithm',
    ),
    evidenceAttestationPublicKeySpkiSha256: requireSpkiSha256(
      trustRoot.evidenceAttestationPublicKeySpkiSha256,
      'Evidence attestation trust-root public-key fingerprint',
    ),
  };
};

const fingerprintPublicKeyPem = (file, label = 'Attestation public key') => {
  const stat = requireRegularFile(file, label);
  if (stat.size > MAX_ATTESTATION_PUBLIC_KEY_BYTES) {
    throw new Error(`${label} exceeds 16 KiB.`);
  }
  const bytes = fs.readFileSync(file);
  const pem = bytes.toString('utf8');
  if (!Buffer.from(pem, 'utf8').equals(bytes) || !PUBLIC_KEY_PEM.test(pem)) {
    throw new Error(`${label} must be a PEM SubjectPublicKeyInfo public key.`);
  }
  try {
    const der = createPublicKey({ key: pem, format: 'pem', type: 'spki' }).export({
      type: 'spki',
      format: 'der',
    });
    return sha256(der);
  } catch {
    throw new Error(`${label} is malformed.`);
  }
};

export function verifyEvidenceAttestationTrustRoot({
  root = process.cwd(), configuredKmsKeyVersion, metadataPath, publicKeyPath,
}) {
  const trustRoot = readEvidenceAttestationTrustRoot(root);
  const configuredVersion = requireConfiguredKmsKeyVersion(
    configuredKmsKeyVersion,
    'Configured EVIDENCE_ATTESTATION_KMS_KEY_VERSION',
  );
  if (configuredVersion !== trustRoot.evidenceAttestationKmsKeyVersion) {
    throw new Error('Configured EVIDENCE_ATTESTATION_KMS_KEY_VERSION does not match the reviewed trust root.');
  }
  const metadata = parseBoundedJsonFile(
    metadataPath,
    'KMS key-version metadata',
    MAX_KMS_METADATA_BYTES,
    ['name', 'algorithm'],
  );
  if (typeof metadata.name !== 'string' || metadata.name !== trustRoot.evidenceAttestationKmsKeyVersion) {
    throw new Error('KMS metadata name does not match the reviewed trust root.');
  }
  if (typeof metadata.algorithm !== 'string' || metadata.algorithm !== trustRoot.evidenceAttestationKmsAlgorithm) {
    throw new Error('KMS metadata algorithm does not match the reviewed trust root.');
  }
  requireSupportedKmsAlgorithm(metadata.algorithm, 'KMS metadata algorithm');
  const fingerprint = fingerprintPublicKeyPem(publicKeyPath);
  if (fingerprint !== trustRoot.evidenceAttestationPublicKeySpkiSha256) {
    throw new Error('Attestation public-key SPKI fingerprint does not match the reviewed trust root.');
  }
  return trustRoot;
}

const digestFile = (root, relativePath, label) => {
  const absolutePath = path.resolve(root, relativePath);
  const stat = requireFile(root, relativePath, label);
  return {
    path: relativePath,
    bytes: stat.size,
    sha256: sha256(fs.readFileSync(absolutePath)),
  };
};

const listDirectoryFiles = (root, relativeDirectory, label) => {
  const directory = path.resolve(root, relativeDirectory);
  const directoryStat = requireSafePath(root, relativeDirectory, label);
  if (!directoryStat.isDirectory()) throw new Error(`${label} must be a directory.`);
  const files = [];
  const visit = relativePath => {
    const current = path.join(root, relativePath);
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const child = path.join(relativePath, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`${label} contains a symbolic link.`);
      if (entry.isDirectory()) visit(child);
      else if (entry.isFile()) files.push(child.split(path.sep).join('/'));
      else throw new Error(`${label} contains a non-regular filesystem entry.`);
    }
  };
  visit(relativeDirectory);
  files.sort();
  if (files.length === 0) throw new Error(`${label} must not be empty.`);
  return files;
};

const digestDirectory = (root, relativeDirectory, label) => {
  const files = listDirectoryFiles(root, relativeDirectory, label)
    .map(relativePath => digestFile(root, relativePath, label));
  return {
    path: relativeDirectory,
    files,
    treeSha256: sha256(JSON.stringify(files)),
  };
};

const requireSingleDeploymentTarget = (value, label) => {
  const targets = Array.isArray(value) ? value : [value];
  if (
    targets.length !== 1
    || !targets[0]
    || typeof targets[0] !== 'object'
    || Array.isArray(targets[0])
  ) {
    throw new Error(`Firebase deployment config requires exactly one ${label} target.`);
  }
  return targets[0];
};

export function validateFirebaseDeploymentConfig(config, {
  expectedFirestoreDatabaseId,
} = {}) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error('Firebase deployment config must be an object.');
  }
  const functionsTarget = requireSingleDeploymentTarget(config.functions, 'Functions');
  const firestoreTarget = requireSingleDeploymentTarget(config.firestore, 'Firestore');
  const hostingTarget = requireSingleDeploymentTarget(config.hosting, 'Hosting');
  if (functionsTarget.source !== COMPONENT_PATHS.functionsPackage.path.split('/')[0]) {
    throw new Error('Firebase deployment config Functions source must be the sealed functions directory.');
  }
  if (hostingTarget.public !== COMPONENT_PATHS.dist.path) {
    throw new Error('Firebase deployment config Hosting public directory must be the sealed dist directory.');
  }
  if (firestoreTarget.rules !== COMPONENT_PATHS.firestoreRules.path) {
    throw new Error('Firebase deployment config Firestore Rules path must be the sealed rules file.');
  }
  if (firestoreTarget.indexes !== COMPONENT_PATHS.firestoreIndexes.path) {
    throw new Error('Firebase deployment config Firestore indexes path must be the sealed indexes file.');
  }
  if (!FIRESTORE_DATABASE_ID.test(firestoreTarget.database)) {
    throw new Error('Firebase deployment config requires one valid explicit Firestore database ID.');
  }
  if (expectedFirestoreDatabaseId !== undefined) {
    if (!FIRESTORE_DATABASE_ID.test(expectedFirestoreDatabaseId)) {
      throw new Error('Firebase deployment config received an invalid protected Firestore database ID.');
    }
    if (firestoreTarget.database !== expectedFirestoreDatabaseId) {
      throw new Error('Firebase deployment config database does not match the protected evidence database.');
    }
  }
  return config;
}

const readFirebaseDeploymentConfig = root => {
  const relativePath = COMPONENT_PATHS.firebaseConfig.path;
  const file = path.resolve(root, relativePath);
  requireFile(root, relativePath, 'firebaseConfig');
  const bytes = fs.readFileSync(file);
  if (bytes.byteLength > 262_144) throw new Error('Firebase deployment config exceeds 256 KiB.');
  let config;
  try {
    config = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new Error('Firebase deployment config is not valid JSON.');
  }
  return validateFirebaseDeploymentConfig(config);
};

const readFirebaseAppletConfig = root => {
  const relativePath = COMPONENT_PATHS.firebaseAppletConfig.path;
  const file = path.resolve(root, relativePath);
  requireFile(root, relativePath, 'firebaseAppletConfig');
  const bytes = fs.readFileSync(file);
  if (bytes.byteLength > 65_536) throw new Error('Firebase applet config exceeds 64 KiB.');
  let config;
  try {
    config = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new Error('Firebase applet config is not valid JSON.');
  }
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error('Firebase applet config must be an object.');
  }
  if (!FIREBASE_PROJECT_ID.test(config.projectId)) {
    throw new Error('Firebase applet config requires a valid project ID.');
  }
  if (!FIRESTORE_DATABASE_ID.test(config.firestoreDatabaseId)) {
    throw new Error('Firebase applet config requires a valid Firestore database ID.');
  }
  return config;
};

const readFunctionsRuntimeTarget = root => {
  const file = path.resolve(root, FUNCTIONS_RUNTIME_TARGET_PATH);
  requireFile(root, FUNCTIONS_RUNTIME_TARGET_PATH, 'functionsRuntimeTarget');
  const bytes = fs.readFileSync(file);
  if (bytes.byteLength > 65_536) throw new Error('Functions runtime target exceeds 64 KiB.');
  let config;
  try {
    config = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new Error('Functions runtime target is not valid JSON.');
  }
  if (
    !config
    || typeof config !== 'object'
    || Array.isArray(config)
    || Object.keys(config).length !== 1
    || !FIRESTORE_DATABASE_ID.test(config.firestoreDatabaseId)
  ) {
    throw new Error('Functions runtime target requires exactly one valid Firestore database ID.');
  }
  return config;
};

const validateReleaseTargets = (root, { expectedProjectId, expectedDatabaseId } = {}) => {
  const firebaseConfig = readFirebaseDeploymentConfig(root);
  const appletConfig = readFirebaseAppletConfig(root);
  const functionsRuntimeTarget = readFunctionsRuntimeTarget(root);
  const firestoreTarget = requireSingleDeploymentTarget(firebaseConfig.firestore, 'Firestore');
  if (firestoreTarget.database !== appletConfig.firestoreDatabaseId) {
    throw new Error('Firebase deployment config database does not match the sealed client database.');
  }
  if (functionsRuntimeTarget.firestoreDatabaseId !== appletConfig.firestoreDatabaseId) {
    throw new Error('Functions runtime database does not match the sealed client database.');
  }
  if (expectedProjectId !== undefined) {
    if (!FIREBASE_PROJECT_ID.test(expectedProjectId) || appletConfig.projectId !== expectedProjectId) {
      throw new Error('Sealed Firebase client project does not match the protected deployment project.');
    }
  }
  if (expectedDatabaseId !== undefined) {
    if (!FIRESTORE_DATABASE_ID.test(expectedDatabaseId) || appletConfig.firestoreDatabaseId !== expectedDatabaseId) {
      throw new Error('Sealed Firebase client database does not match the protected deployment database.');
    }
  }
  if ((expectedProjectId === undefined) !== (expectedDatabaseId === undefined)) {
    throw new Error('Protected Firebase project and database targets must be verified together.');
  }
  return { projectId: appletConfig.projectId, databaseId: appletConfig.firestoreDatabaseId };
};

const readReadinessEvidence = root => {
  const relativePath = COMPONENT_PATHS.readiness.path;
  const file = path.resolve(root, relativePath);
  requireFile(root, relativePath, 'readiness');
  const bytes = fs.readFileSync(file);
  if (bytes.byteLength > 65_536) throw new Error('Readiness evidence exceeds 64 KiB.');
  let evidence;
  try {
    evidence = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new Error('Readiness evidence is not valid JSON.');
  }
  return evidence;
};

const digestComponents = root => Object.fromEntries(
  Object.entries(COMPONENT_PATHS).map(([name, component]) => [
    name,
    component.type === 'directory'
      ? digestDirectory(root, component.path, name)
      : digestFile(root, component.path, name),
  ]),
);

const validateSealInputs = ({ revision, workflowRunId, workflowRunAttempt, generatedAt }) => {
  if (!IMMUTABLE_REVISION.test(revision)) {
    throw new Error('Release artifact revision must be a full 40- or 64-character commit revision.');
  }
  if (!/^[1-9][0-9]{0,19}$/.test(workflowRunId)) {
    throw new Error('Release artifact workflowRunId must be a positive integer.');
  }
  if (!/^[1-9][0-9]{0,9}$/.test(workflowRunAttempt)) {
    throw new Error('Release artifact workflowRunAttempt must be a positive integer.');
  }
  const timestamp = new Date(generatedAt);
  if (!Number.isFinite(timestamp.getTime()) || timestamp.toISOString() !== generatedAt) {
    throw new Error('Release artifact generatedAt must be an ISO-8601 UTC timestamp.');
  }
};

const manifestPayload = manifest => ({
  schemaVersion: manifest.schemaVersion,
  revision: manifest.revision,
  workflowRunId: manifest.workflowRunId,
  workflowRunAttempt: manifest.workflowRunAttempt,
  generatedAt: manifest.generatedAt,
  components: manifest.components,
});

const candidateDigest = manifest => sha256(JSON.stringify(manifestPayload(manifest)));

const assertReadinessBound = (evidence, revision) => {
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) {
    throw new Error('Readiness evidence must be an object.');
  }
  if (evidence.revision !== revision || evidence.releaseEligible !== true) {
    throw new Error('Readiness evidence is not release-eligible for the candidate revision.');
  }
};

export function sealReleaseArtifact({
  root = process.cwd(), revision, workflowRunId, workflowRunAttempt, generatedAt,
}) {
  const normalizedRevision = revision.trim().toLowerCase();
  validateSealInputs({
    revision: normalizedRevision, workflowRunId, workflowRunAttempt, generatedAt,
  });
  const candidateRoot = path.resolve(root);
  assertReadinessBound(readReadinessEvidence(candidateRoot), normalizedRevision);
  validateReleaseTargets(candidateRoot);
  readEvidenceAttestationTrustRoot(candidateRoot);
  const manifest = {
    schemaVersion: RELEASE_ARTIFACT_SCHEMA_VERSION,
    revision: normalizedRevision,
    workflowRunId,
    workflowRunAttempt,
    generatedAt,
    components: digestComponents(candidateRoot),
  };
  return { ...manifest, candidateSha256: candidateDigest(manifest) };
}

export function verifyReleaseArtifact({
  root = process.cwd(), manifest, expectedRevision, expectedWorkflowRunId,
  expectedWorkflowRunAttempt, expectedCandidateSha256, expectedProjectId, expectedDatabaseId,
}) {
  if (!exactKeys(manifest, [
    'schemaVersion', 'revision', 'workflowRunId', 'workflowRunAttempt',
    'generatedAt', 'components', 'candidateSha256',
  ])) {
    throw new Error('Release artifact manifest schema is invalid.');
  }
  if (manifest.schemaVersion !== RELEASE_ARTIFACT_SCHEMA_VERSION) {
    throw new Error('Unsupported release artifact schemaVersion.');
  }
  validateSealInputs(manifest);
  const revision = expectedRevision.trim().toLowerCase();
  if (manifest.revision !== revision) throw new Error('Release artifact revision does not match the approved revision.');
  if (
    !/^[1-9][0-9]{0,19}$/.test(expectedWorkflowRunId ?? '')
    || manifest.workflowRunId !== expectedWorkflowRunId
  ) {
    throw new Error('Release artifact workflow run does not match the approved source run.');
  }
  if (
    !/^[1-9][0-9]{0,9}$/.test(expectedWorkflowRunAttempt ?? '')
    || manifest.workflowRunAttempt !== expectedWorkflowRunAttempt
  ) {
    throw new Error('Release artifact workflow run attempt does not match the approved source attempt.');
  }
  if (!SHA256.test(expectedCandidateSha256) || manifest.candidateSha256 !== expectedCandidateSha256) {
    throw new Error('Release artifact candidate SHA-256 does not match the approved digest.');
  }
  if (candidateDigest(manifest) !== manifest.candidateSha256) {
    throw new Error('Release artifact manifest digest is invalid.');
  }
  if (!exactKeys(manifest.components, Object.keys(COMPONENT_PATHS))) {
    throw new Error('Release artifact manifest component inventory is invalid.');
  }
  const candidateRoot = path.resolve(root);
  assertReadinessBound(readReadinessEvidence(candidateRoot), revision);
  readEvidenceAttestationTrustRoot(candidateRoot);
  validateReleaseTargets(candidateRoot, { expectedProjectId, expectedDatabaseId });
  const currentComponents = digestComponents(candidateRoot);
  for (const name of Object.keys(COMPONENT_PATHS)) {
    if (JSON.stringify(currentComponents[name]) !== JSON.stringify(manifest.components?.[name])) {
      throw new Error(`Release artifact component ${name} does not match its sealed digest.`);
    }
  }
  return manifest;
}

const stripHooks = value => {
  const copy = structuredClone(value);
  const targets = [copy.functions, copy.firestore, copy.hosting].flat().filter(Boolean);
  for (const target of targets) {
    if (target && typeof target === 'object' && !Array.isArray(target)) {
      delete target.predeploy;
      delete target.postdeploy;
    }
  }
  return copy;
};

export function createPromotedFirebaseConfig(config, {
  promotedFirestoreRulesPath,
  ...validationOptions
} = {}) {
  validateFirebaseDeploymentConfig(config, validationOptions);
  const promotedConfig = stripHooks(config);
  const promotedFunctions = requireSingleDeploymentTarget(
    promotedConfig.functions,
    'Functions',
  );
  promotedFunctions.ignore = [...new Set([
    ...(promotedFunctions.ignore ?? ['node_modules', '.git']),
    'functions.yaml',
  ])];
  if (promotedFirestoreRulesPath !== undefined) {
    if (promotedFirestoreRulesPath !== COMPONENT_PATHS.firestoreCompatibilityRules.path) {
      throw new Error('Promoted Firestore Rules path is not a sealed compatibility artifact.');
    }
    requireSingleDeploymentTarget(
      promotedConfig.firestore,
      'Firestore',
    ).rules = promotedFirestoreRulesPath;
  }
  return promotedConfig;
}

const parseOptions = args => {
  const options = new Map();
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (!name?.startsWith('--') || value === undefined || value.startsWith('--')) {
      throw new Error('Release artifact options must be --name value pairs.');
    }
    if (options.has(name)) throw new Error(`Duplicate option ${name}.`);
    options.set(name, value);
  }
  return options;
};

const requiredOption = (options, name) => {
  const value = options.get(name);
  if (!value) throw new Error(`Missing required option ${name}.`);
  return value;
};

const writeJson = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const command = process.argv[2];
  const options = parseOptions(process.argv.slice(3));
  if (command === 'seal') {
    const root = path.resolve(options.get('--root') || '.');
    const output = path.resolve(root, options.get('--output') || 'artifacts/release-candidate-manifest.json');
    const manifest = sealReleaseArtifact({
      root,
      revision: requiredOption(options, '--revision'),
      workflowRunId: requiredOption(options, '--workflow-run-id'),
      workflowRunAttempt: requiredOption(options, '--workflow-run-attempt'),
      generatedAt: options.get('--generated-at') || new Date().toISOString(),
    });
    writeJson(output, manifest);
    console.log(`Sealed release candidate ${manifest.revision} as ${manifest.candidateSha256}.`);
  } else if (command === 'verify') {
    const root = path.resolve(options.get('--root') || '.');
    const manifestPath = path.resolve(root, requiredOption(options, '--manifest'));
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    verifyReleaseArtifact({
      root,
      manifest,
      expectedRevision: requiredOption(options, '--revision'),
      expectedWorkflowRunId: requiredOption(options, '--workflow-run-id'),
      expectedWorkflowRunAttempt: requiredOption(options, '--workflow-run-attempt'),
      expectedCandidateSha256: requiredOption(options, '--candidate-sha256'),
      expectedProjectId: options.get('--project-id'),
      expectedDatabaseId: options.get('--database-id'),
    });
    console.log(`Verified sealed release candidate ${manifest.revision}.`);
  } else if (command === 'verify-attestation-trust-root') {
    const root = path.resolve(options.get('--root') || '.');
    verifyEvidenceAttestationTrustRoot({
      root,
      configuredKmsKeyVersion: requiredOption(options, '--configured-kms-key-version'),
      metadataPath: requiredOption(options, '--metadata'),
      publicKeyPath: requiredOption(options, '--public-key'),
    });
    console.log('Verified evidence attestation trust root.');
  } else if (command === 'promote-config') {
    const root = path.resolve(options.get('--root') || '.');
    const source = path.resolve(root, options.get('--source') || 'firebase.json');
    const output = path.resolve(root, options.get('--output') || 'firebase.promoted.json');
    writeJson(output, createPromotedFirebaseConfig(JSON.parse(fs.readFileSync(source, 'utf8')), {
      expectedFirestoreDatabaseId: options.get('--database-id'),
      promotedFirestoreRulesPath: options.get('--firestore-rules'),
    }));
    console.log(`Wrote hook-free promoted Firebase config to ${path.relative(root, output)}.`);
  } else {
    throw new Error('Usage: release-artifact.mjs <seal|verify|verify-attestation-trust-root|promote-config> [--name value]');
  }
}
