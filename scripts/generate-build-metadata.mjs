import fs from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { transformWithEsbuild } from 'vite';
import {
  createOfflineShellDescriptor,
  renderOfflineServiceWorker,
} from './offline-shell.mjs';
import { buildReleaseMetadata } from './release-config.mjs';

const packageJson = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const revision = (
  process.env.RELEASE_REVISION
  || process.env.GITHUB_SHA
  || process.env.SOURCE_VERSION
  || 'local'
).trim();
const builtAt = process.env.BUILD_TIMESTAMP?.trim() || new Date().toISOString();
const output = path.resolve('dist/health.json');

const artifactId = (() => {
  const dist = path.dirname(output);
  const files = [];
  const visit = directory => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (file === output) continue;
      if (entry.isDirectory()) visit(file);
      else if (entry.isFile()) files.push(file);
    }
  };
  visit(dist);
  const hash = createHash('sha256');
  for (const file of files.sort()) {
    const bytes = fs.readFileSync(file);
    hash.update(path.relative(dist, file));
    hash.update('\0');
    hash.update(String(bytes.length));
    hash.update('\0');
    hash.update(bytes);
  }
  return hash.digest('hex');
})();
const metadata = {
  ...buildReleaseMetadata({
    version: String(packageJson.version),
    revision,
    builtAt,
  }),
  artifactId,
};
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify(metadata)}\n`, 'utf8');
console.log(`Wrote immutable build metadata to ${path.relative(process.cwd(), output)}.`);

const workerTemplate = fs.readFileSync(
  new URL('../src/features/offlineApp/service-worker.js', import.meta.url),
  'utf8',
);
const distDirectory = path.dirname(output);
const descriptor = createOfflineShellDescriptor({ distDirectory, revision });
const workerPath = path.join(distDirectory, 'sw.js');
const renderedWorker = renderOfflineServiceWorker(workerTemplate, descriptor);
const { code: minifiedWorker } = await transformWithEsbuild(renderedWorker, workerPath, {
  legalComments: 'eof',
  minify: true,
  target: 'es2022',
});
fs.writeFileSync(workerPath, minifiedWorker, 'utf8');
console.log(`Wrote offline service worker to ${path.relative(process.cwd(), workerPath)}.`);
