import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { decideCanary, evaluateStagingSmoke } from '../src/features/releaseReadiness/operationalReadiness';

const command = process.argv[2];
const output = (value: unknown): void => {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
};

if (command === 'smoke') {
  const origin = process.env.STAGING_ORIGIN?.trim() ?? '';
  const expectedRevision = process.env.EXPECTED_REVISION?.trim() ?? '';
  const catalogPath = process.env.CATALOG_MANIFEST_PATH?.trim() || '/catalog/manifest.json';
  if (!origin.startsWith('https://') || !expectedRevision) throw new Error('HTTPS STAGING_ORIGIN and EXPECTED_REVISION are required.');
  if (!catalogPath.startsWith('/') || catalogPath.startsWith('//')) throw new Error('CATALOG_MANIFEST_PATH must be a same-origin absolute path.');
  const catalogUrl = new URL(catalogPath, origin);
  if (catalogUrl.origin !== new URL(origin).origin) throw new Error('Catalog smoke probe must stay on the staging origin.');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const [page, health, catalog] = await Promise.all([
      fetch(origin, { redirect: 'error', signal: controller.signal }),
      fetch(new URL('/health.json', origin), { redirect: 'error', signal: controller.signal }),
      fetch(catalogUrl, { redirect: 'error', signal: controller.signal }),
    ]);
    const metadata = await health.json() as { revision?: string };
    const result = evaluateStagingSmoke({
      origin, expectedRevision, actualRevision: metadata.revision ?? '', healthStatus: health.status,
      headers: Object.fromEntries(page.headers.entries()),
      catalogCacheControl: catalog.headers.get('cache-control') ?? '',
      probes: [{ name: 'catalog', passed: catalog.ok }],
    });
    output(result);
    if (result.status !== 'passed') process.exitCode = 1;
  } finally {
    clearTimeout(timer);
  }
} else if (command === 'canary') {
  const path = process.argv[3];
  if (!path) throw new Error('Provide a bounded canary JSON evidence file.');
  const bytes = readFileSync(resolve(path));
  if (bytes.byteLength > 16_384) throw new Error('Canary evidence exceeds 16 KiB.');
  const result = decideCanary(JSON.parse(bytes.toString('utf8')) as Parameters<typeof decideCanary>[0]);
  output(result);
  if (result.action !== 'promote') process.exitCode = 1;
} else if (command === 'evidence') {
  const report = {
    schemaVersion: 1,
    revision: (process.env.RELEASE_REVISION || process.env.GITHUB_SHA || 'local').trim(),
    generatedAt: new Date().toISOString(),
    localVerification: process.argv.includes('--verified') ? 'passed' : 'unattested',
    externalGates: { stagingSmoke: 'blocked-human-gate', canary: 'blocked-human-gate', production: 'blocked-human-gate' },
  } as const;
  mkdirSync(resolve('artifacts'), { recursive: true });
  writeFileSync(resolve('artifacts/phase6-readiness.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  output(report);
} else {
  throw new Error('Usage: phase6-operator.ts <smoke|canary|evidence> [evidence.json]');
}
