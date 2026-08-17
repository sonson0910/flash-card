import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const REVISION = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const SHA256 = /^[a-f0-9]{64}$/;
const FUNCTION_ID = /^[A-Za-z][A-Za-z0-9_-]{0,62}$/;
export const MAX_FUNCTIONS_MANIFEST_BYTES = 1_048_576;

const exactObject = (actual, expected) => {
  if (!actual || typeof actual !== 'object' || Array.isArray(actual)) return false;
  return JSON.stringify(Object.keys(actual).sort()) === JSON.stringify(Object.keys(expected).sort())
    && Object.entries(expected).every(([key, value]) => actual[key] === value);
};

const parseArguments = values => {
  const options = {};
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index];
    const value = values[index + 1];
    if (!key?.startsWith('--') || value === undefined || key.slice(2) in options) {
      throw new Error('Invalid command arguments.');
    }
    options[key.slice(2)] = value;
  }
  const expected = ['candidate-sha256', 'functions', 'output', 'revision', 'root'];
  if (JSON.stringify(Object.keys(options).sort()) !== JSON.stringify(expected)) {
    throw new Error('Invalid command arguments.');
  }
  return options;
};

export const requireRegularFile = (file, label) => {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${label} is invalid.`);
  return stat;
};

export const validateReleaseManifestInputs = ({
  functionIds,
  revision,
  candidateSha256,
}) => {
  if (!REVISION.test(revision) || !SHA256.test(candidateSha256)) {
    throw new Error('Release provenance identifiers are invalid.');
  }
  if (!Array.isArray(functionIds) || functionIds.length === 0
    || new Set(functionIds).size !== functionIds.length
    || functionIds.some(id => !FUNCTION_ID.test(id))) {
    throw new Error('Expected Functions list is invalid.');
  }
};

export const createExpectedReleaseLabels = (keys, revision, candidateSha256) => ({
  [keys.schema]: 'v1',
  [keys.revisionFirst]: revision.slice(0, 32),
  [keys.revisionSecond]: revision.slice(32),
  [keys.candidateFirst]: candidateSha256.slice(0, 32),
  [keys.candidateSecond]: candidateSha256.slice(32),
});

export const verifyLiteralFunctionsManifest = ({
  manifest,
  functionIds,
  labels,
}) => {
  const endpointIds = Object.keys(manifest?.endpoints ?? {}).sort();
  if (manifest?.specVersion !== 'v1alpha1'
    || JSON.stringify(endpointIds) !== JSON.stringify([...functionIds].sort())) {
    throw new Error('Compiled Functions manifest endpoint set is invalid.');
  }
  for (const functionId of functionIds) {
    const endpoint = manifest.endpoints[functionId];
    if (endpoint?.entryPoint !== functionId.replace(/-/g, '.')) {
      throw new Error(
        `Compiled Cloud Function ${functionId} has an invalid entry point.`,
      );
    }
    if (!exactObject(endpoint.labels, labels)) {
      throw new Error(
        `Compiled Cloud Function ${functionId} has invalid release provenance labels.`,
      );
    }
  }
};

const loadCompiledManifest = async ({
  root,
  functionIds,
  revision,
  candidateSha256,
}) => {
  const packageFile = path.join(root, 'package.json');
  const indexFile = path.join(root, 'lib', 'index.js');
  const provenanceFile = path.join(root, 'lib', 'releaseProvenance.js');
  requireRegularFile(packageFile, 'Functions package');
  requireRegularFile(indexFile, 'Compiled Functions entrypoint');
  requireRegularFile(provenanceFile, 'Compiled release provenance module');

  const requireFromFunctions = createRequire(packageFile);
  const { declaredParams } = requireFromFunctions('firebase-functions/params');
  const { stackToWire } = requireFromFunctions(path.join(
    root,
    'node_modules/firebase-functions/lib/runtime/manifest.js',
  ));
  const previousRevision = process.env.SONFLASH_RELEASE_REVISION;
  const previousCandidate = process.env.SONFLASH_RELEASE_CANDIDATE_SHA256;
  let functionsModule;
  try {
    process.env.SONFLASH_RELEASE_REVISION = revision;
    process.env.SONFLASH_RELEASE_CANDIDATE_SHA256 = candidateSha256;
    const nonce = `${revision}-${candidateSha256}`;
    functionsModule = await import(`${pathToFileURL(indexFile).href}?release=${nonce}`);
  } finally {
    if (previousRevision === undefined) delete process.env.SONFLASH_RELEASE_REVISION;
    else process.env.SONFLASH_RELEASE_REVISION = previousRevision;
    if (previousCandidate === undefined) delete process.env.SONFLASH_RELEASE_CANDIDATE_SHA256;
    else process.env.SONFLASH_RELEASE_CANDIDATE_SHA256 = previousCandidate;
  }

  const exportedFunctionIds = Object.entries(functionsModule)
    .filter(([, value]) => value?.__endpoint && typeof value.__endpoint === 'object')
    .map(([id]) => id)
    .sort();
  if (JSON.stringify(exportedFunctionIds) !== JSON.stringify([...functionIds].sort())) {
    throw new Error('Compiled Functions export set is invalid.');
  }
  const endpoints = Object.fromEntries(functionIds.map(id => [id, {
    ...functionsModule[id].__endpoint,
    entryPoint: id.replace(/-/g, '.'),
  }]));
  const manifest = stackToWire({
    endpoints,
    specVersion: 'v1alpha1',
    requiredAPIs: [],
    params: declaredParams.map(param => param.toSpec()),
  });
  const { RELEASE_PROVENANCE_LABEL_KEYS: keys } = await import(
    pathToFileURL(provenanceFile).href
  );
  const labels = createExpectedReleaseLabels(keys, revision, candidateSha256);
  verifyLiteralFunctionsManifest({ manifest, functionIds, labels });
  return manifest;
};

export async function createFunctionsReleaseManifest({
  root,
  output = 'functions.yaml',
  functionIds,
  revision,
  candidateSha256,
}) {
  validateReleaseManifestInputs({ functionIds, revision, candidateSha256 });
  if (output !== 'functions.yaml') {
    throw new Error('Functions manifest output must be functions.yaml.');
  }
  const functionsRoot = path.resolve(root);
  const outputFile = path.join(functionsRoot, output);
  if (fs.existsSync(outputFile) || fs.lstatSync(functionsRoot).isSymbolicLink()) {
    throw new Error('Functions manifest output already exists or has an invalid root.');
  }
  const manifest = await loadCompiledManifest({
    root: functionsRoot,
    functionIds,
    revision,
    candidateSha256,
  });
  const serialized = `${JSON.stringify(manifest, null, 2)}\n`;
  if (Buffer.byteLength(serialized) > MAX_FUNCTIONS_MANIFEST_BYTES) {
    throw new Error('Functions manifest exceeds 1 MiB.');
  }
  fs.writeFileSync(outputFile, serialized, {
    encoding: 'utf8',
    flag: 'wx',
    mode: 0o600,
  });
  requireRegularFile(outputFile, 'Functions manifest');
  return {
    status: 'created',
    mode: 'literal-functions-manifest',
    functionCount: functionIds.length,
  };
}

const runCli = async () => {
  if (process.argv[2] !== 'create') throw new Error('Invalid command.');
  const options = parseArguments(process.argv.slice(3));
  const result = await createFunctionsReleaseManifest({
    root: options.root,
    output: options.output,
    functionIds: options.functions.split(',').filter(Boolean),
    revision: options.revision,
    candidateSha256: options['candidate-sha256'],
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli().catch(error => {
    process.stderr.write(
      `${error instanceof Error ? error.message : 'Functions manifest creation failed.'}\n`,
    );
    process.exitCode = 1;
  });
}
