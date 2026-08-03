import fs from 'node:fs';
import path from 'node:path';
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
const output = path.resolve('dist/health.json');
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify(metadata)}\n`, 'utf8');
console.log(`Wrote immutable build metadata to ${path.relative(process.cwd(), output)}.`);
