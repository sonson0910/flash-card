import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createExpectedReleaseLabels, MAX_FUNCTIONS_MANIFEST_BYTES, requireRegularFile,
  validateReleaseManifestInputs, verifyLiteralFunctionsManifest } from './functions-release-manifest.mjs';
const PROJECT_ID = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;

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
  const expected = [
    'candidate-sha256', 'config', 'firebase-tools-version', 'functions',
    'output', 'project-id', 'revision', 'root',
  ];
  if (JSON.stringify(Object.keys(options).sort()) !== JSON.stringify(expected)) {
    throw new Error('Invalid command arguments.');
  }
  return options;
};

const exactObject = (actual, expected) => {
  if (!actual || typeof actual !== 'object' || Array.isArray(actual)) return false;
  return JSON.stringify(Object.keys(actual).sort()) === JSON.stringify(Object.keys(expected).sort())
    && Object.entries(expected).every(([key, value]) => actual[key] === value);
};

const locateFirebaseTools = version => {
  for (const binDirectory of process.env.PATH?.split(path.delimiter) ?? []) {
    if (path.basename(binDirectory) !== '.bin') continue;
    const root = path.resolve(binDirectory, '..', 'firebase-tools');
    const packageFile = path.join(root, 'package.json');
    if (!fs.existsSync(packageFile)) continue;
    const packageJson = JSON.parse(fs.readFileSync(packageFile, 'utf8'));
    if (packageJson.version === version) return root;
  }
  throw new Error(
    `firebase-tools ${version} is unavailable in the npm exec environment.`,
  );
};

const readPromotedFunctionsConfig = (configFile, functionsRoot) => {
  requireRegularFile(configFile, 'Promoted Firebase config');
  const promotedConfig = JSON.parse(fs.readFileSync(configFile, 'utf8'));
  const functionsConfig = Array.isArray(promotedConfig.functions)
    ? promotedConfig.functions[0]
    : promotedConfig.functions;
  if (!functionsConfig
    || path.resolve(path.dirname(configFile), functionsConfig.source) !== functionsRoot
    || !Array.isArray(functionsConfig.ignore)
    || !functionsConfig.ignore.includes('functions.yaml')) {
    throw new Error(
      'Promoted Firebase config does not exclude the temporary Functions manifest.',
    );
  }
  return functionsConfig;
};

const verifyResolvedEndpoints = ({ firebaseToolsRoot, build, functionIds, labels }) => {
  const requireFirebaseTools = createRequire(
    path.join(firebaseToolsRoot, 'package.json'),
  );
  const buildModule = requireFirebaseTools(
    path.join(firebaseToolsRoot, 'lib/deploy/functions/build.js'),
  );
  const backendModule = requireFirebaseTools(
    path.join(firebaseToolsRoot, 'lib/deploy/functions/backend.js'),
  );
  const paramValues = buildModule.envWithTypes(
    build.params,
    { ENFORCE_APP_CHECK: 'true' },
  );
  const resolvedEndpoints = backendModule.allEndpoints(
    buildModule.toBackend(build, paramValues),
  );
  if (resolvedEndpoints.length !== functionIds.length
    || resolvedEndpoints.some(endpoint => !functionIds.includes(endpoint.id)
      || !exactObject(endpoint.labels, labels))) {
    throw new Error('firebase-tools did not preserve literal release provenance labels.');
  }
};

const verifyUploadArchive = async ({
  firebaseToolsRoot, configFile, functionsRoot, functionsConfig,
}) => {
  const requireFirebaseTools = createRequire(
    path.join(firebaseToolsRoot, 'package.json'),
  );
  const uploadModule = requireFirebaseTools(path.join(
    firebaseToolsRoot,
    'lib/deploy/functions/prepareFunctionsUpload.js',
  ));
  let archive;
  try {
    archive = await uploadModule.prepareFunctionsUpload(
      path.dirname(configFile),
      functionsRoot,
      functionsConfig,
      [],
      undefined,
    );
    const entries = execFileSync('unzip', ['-Z1', archive.pathToSource], {
      encoding: 'utf8',
      maxBuffer: 4 * 1024 * 1024,
    }).split(/\r?\n/).filter(Boolean);
    if (entries.includes('functions.yaml') || !entries.includes('lib/index.js')) {
      throw new Error('Firebase Functions source archive contains an invalid file set.');
    }
  } finally {
    if (archive?.pathToSource) fs.rmSync(archive.pathToSource, { force: true });
  }
};

export async function verifyFirebaseToolsReleaseManifest({
  root,
  output = 'functions.yaml',
  config,
  functionIds,
  revision,
  candidateSha256,
  firebaseToolsVersion,
  projectId,
}) {
  validateReleaseManifestInputs({ functionIds, revision, candidateSha256 });
  if (!PROJECT_ID.test(projectId) || output !== 'functions.yaml') {
    throw new Error('Firebase manifest verification inputs are invalid.');
  }
  const functionsRoot = path.resolve(root);
  const manifestFile = path.join(functionsRoot, output);
  const manifestStat = requireRegularFile(manifestFile, 'Functions manifest');
  if (manifestStat.size > MAX_FUNCTIONS_MANIFEST_BYTES) {
    throw new Error('Functions manifest exceeds 1 MiB.');
  }
  const configFile = path.resolve(config);
  const functionsConfig = readPromotedFunctionsConfig(configFile, functionsRoot);
  const firebaseToolsRoot = locateFirebaseTools(firebaseToolsVersion);
  const requireFirebaseTools = createRequire(
    path.join(firebaseToolsRoot, 'package.json'),
  );
  const discovery = requireFirebaseTools(path.join(
    firebaseToolsRoot,
    'lib/deploy/functions/runtimes/discovery/index.js',
  ));
  const build = await discovery.detectFromYaml(functionsRoot, projectId, 'nodejs22');
  const { RELEASE_PROVENANCE_LABEL_KEYS: keys } = await import(
    pathToFileURL(path.join(functionsRoot, 'lib/releaseProvenance.js')).href
  );
  const labels = createExpectedReleaseLabels(keys, revision, candidateSha256);
  verifyLiteralFunctionsManifest({
    manifest: JSON.parse(fs.readFileSync(manifestFile, 'utf8')),
    functionIds,
    labels,
  });
  verifyResolvedEndpoints({ firebaseToolsRoot, build, functionIds, labels });
  await verifyUploadArchive({
    firebaseToolsRoot,
    configFile,
    functionsRoot,
    functionsConfig,
  });
  return {
    status: 'verified',
    mode: 'firebase-tools-literal-manifest',
    firebaseToolsVersion,
    functionCount: functionIds.length,
  };
}

const runCli = async () => {
  const options = parseArguments(process.argv.slice(2));
  const result = await verifyFirebaseToolsReleaseManifest({
    root: options.root,
    output: options.output,
    config: options.config,
    functionIds: options.functions.split(',').filter(Boolean),
    revision: options.revision,
    candidateSha256: options['candidate-sha256'],
    firebaseToolsVersion: options['firebase-tools-version'],
    projectId: options['project-id'],
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli().catch(error => {
    process.stderr.write(
      `${error instanceof Error ? error.message : 'firebase-tools manifest verification failed.'}\n`,
    );
    process.exitCode = 1;
  });
}
