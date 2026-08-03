import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const vitestEntry = path.join(projectRoot, 'node_modules', 'vitest', 'vitest.mjs');

const gates = {
  validate: {
    message: 'Validating the draft catalog and exact pilot counts; no artifact will be published.',
    targets: [
      'src/features/catalogPipeline/catalogValidation.test.ts',
      'src/features/catalogPipeline/pilotCatalog.test.ts',
    ],
  },
  build: {
    message: 'Checking the deterministic builder and proving the draft pilot is rejected; no artifact will be written.',
    targets: [
      'src/features/catalogPipeline/catalogBuilder.test.ts',
      'src/features/catalogPipeline/catalogOperator.test.ts',
    ],
  },
  verify: {
    message: 'Verifying the catalog pipeline, cache, delivery boundary, and lazy production composition.',
    // fake-indexeddb maintains eight indexes while installing the 10,000-entry
    // structural benchmark; slower CI machines need room beyond Vitest's 5 s default.
    vitestArgs: ['--testTimeout=30000', '--maxWorkers=1'],
    targets: [
      'src/features/catalogPipeline',
      'src/features/catalogCache',
      'src/app/catalogRuntime.test.ts',
      'src/app/appDependencies.test.ts',
      'scripts/catalog-operator.test.ts',
    ],
  },
};

const mode = process.argv[2];
const gate = gates[mode];
if (!gate) {
  console.error(`Unknown catalog gate "${mode ?? ''}". Expected: ${Object.keys(gates).join(', ')}.`);
  process.exit(2);
}

const operatorArgs = process.argv.slice(3);
if (operatorArgs.length > 0) {
  const viteNodeEntry = path.join(projectRoot, 'node_modules', 'vite-node', 'vite-node.mjs');
  const result = spawnSync(process.execPath, [
    viteNodeEntry,
    'scripts/catalog-cli.ts',
    mode,
    ...operatorArgs,
  ], {
    cwd: projectRoot,
    stdio: 'inherit',
  });
  if (result.error) console.error(result.error.message);
  process.exit(result.error ? 1 : (result.status ?? 1));
}

console.log(gate.message);
const result = spawnSync(process.execPath, [
  vitestEntry,
  'run',
  ...(gate.vitestArgs ?? []),
  ...gate.targets,
], {
  cwd: projectRoot,
  stdio: 'inherit',
});
if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);
