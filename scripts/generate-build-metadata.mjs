import fs from 'node:fs';
import path from 'node:path';
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
const metadata = buildReleaseMetadata({
  version: String(packageJson.version),
  revision,
  builtAt,
});
const distDirectory = path.resolve('dist');
const output = path.join(distDirectory, 'health.json');
fs.mkdirSync(distDirectory, { recursive: true });
fs.writeFileSync(output, `${JSON.stringify(metadata)}\n`, 'utf8');
console.log(`Wrote immutable build metadata to ${path.relative(process.cwd(), output)}.`);

const workerTemplate = fs.readFileSync(
  new URL('../src/features/offlineApp/service-worker.js', import.meta.url),
  'utf8',
);
const descriptor = createOfflineShellDescriptor({ distDirectory, revision });
const workerPath = path.join(distDirectory, 'sw.js');
fs.writeFileSync(workerPath, renderOfflineServiceWorker(workerTemplate, descriptor), 'utf8');
console.log(`Wrote offline service worker to ${path.relative(process.cwd(), workerPath)}.`);
