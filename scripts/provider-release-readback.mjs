import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { verifyRuntimeDeployment } from './provider-runtime-readback.mjs';
import { verifyFirestoreRulesDeployment } from './provider-rules-readback.mjs';

export { verifyRuntimeDeployment, verifyFirestoreRulesDeployment };

const parseArguments = values => {
  const [mode, ...rest] = values;
  const options = {};
  for (let index = 0; index < rest.length; index += 2) {
    const key = rest[index];
    const value = rest[index + 1];
    if (!key?.startsWith('--') || value === undefined || key.slice(2) in options) {
      throw new Error('Invalid command arguments.');
    }
    options[key.slice(2)] = value;
  }
  return { mode, options };
};

const requireOptionKeys = (options, expected) => {
  const actual = Object.keys(options).sort();
  const keys = [...expected].sort();
  if (actual.length !== keys.length || actual.some((key, index) => key !== keys[index])) {
    throw new Error('Invalid command arguments.');
  }
};

const runCli = async () => {
  const { mode, options } = parseArguments(process.argv.slice(2));
  if (mode === 'runtime') {
    requireOptionKeys(options, [
      'project-id', 'hosting-site-id', 'region', 'functions', 'revision', 'candidate-sha256',
    ]);
  } else if (mode === 'rules') {
    requireOptionKeys(options, ['project-id', 'database-id', 'rules-file']);
  }

  const common = {
    accessToken: process.env.GOOGLE_OAUTH_ACCESS_TOKEN,
    projectId: options['project-id'],
  };
  const result = mode === 'runtime'
    ? await verifyRuntimeDeployment({
      ...common,
      hostingSiteId: options['hosting-site-id'],
      region: options.region,
      functionIds: options.functions?.split(',').filter(Boolean),
      revision: options.revision,
      candidateSha256: options['candidate-sha256'],
    })
    : mode === 'rules'
      ? await verifyFirestoreRulesDeployment({
        ...common,
        databaseId: options['database-id'],
        rulesFile: path.resolve(options['rules-file'] ?? ''),
      })
      : (() => { throw new Error('Expected runtime or rules mode.'); })();
  process.stdout.write(`${JSON.stringify(result)}\n`);
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli().catch(error => {
    process.stderr.write(`${error instanceof Error ? error.message : 'Provider read-back failed.'}\n`);
    process.exitCode = 1;
  });
}
