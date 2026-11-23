import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artifactDirectory = path.resolve(projectRoot, 'artifacts/ui-fixtures/shell-share-workflow');
const fixtureEntry = path.resolve(projectRoot, 'e2e/fixtures/shell-share-workflow.html');

await build({
  configFile: path.resolve(projectRoot, 'vite.config.ts'),
  mode: 'production',
  root: projectRoot,
  build: {
    outDir: artifactDirectory,
    emptyOutDir: true,
    rollupOptions: { input: { 'e2e/fixtures/shell-share-workflow': fixtureEntry } },
  },
});

console.log(`Built shell/share test fixture: ${path.relative(projectRoot, artifactDirectory)}`);
