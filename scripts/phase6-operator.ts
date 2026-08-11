import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { decideCanary, evaluateStagingSmoke } from '../src/features/releaseReadiness/operationalReadiness';
import { buildReleaseReadinessEvidence } from './releaseEvidence';

const command = process.argv[2];
const output = (value: unknown): void => {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
};

const readGitOutput = (args: readonly string[], description: string): string => {
  const result = spawnSync('git', args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    maxBuffer: 1_048_576,
    timeout: 10_000,
  });
  if (result.error || result.status !== 0) {
    throw new Error(`Verified release evidence could not read the ${description}.`);
  }
  return result.stdout;
};

const readVerifiedSourceSnapshot = () => ({
  headRevision: readGitOutput(['rev-parse', '--verify', 'HEAD'], 'source HEAD').trim(),
  porcelainStatus: readGitOutput([
    '--no-optional-locks',
    'status',
    '--porcelain=v1',
    '--untracked-files=all',
  ], 'source worktree status'),
});

if (command === 'smoke') {
  const origin = process.env.STAGING_ORIGIN?.trim() ?? '';
  const expectedRevision = process.env.EXPECTED_REVISION?.trim() ?? '';
  const releaseManifestPath = process.env.CATALOG_MANIFEST_PATH?.trim() || '/catalog/manifest.json';
  if (!origin.startsWith('https://') || !expectedRevision) throw new Error('HTTPS STAGING_ORIGIN and EXPECTED_REVISION are required.');
  if (!releaseManifestPath.startsWith('/') || releaseManifestPath.startsWith('//')) throw new Error('CATALOG_MANIFEST_PATH must be a same-origin absolute path.');
  const releaseManifestUrl = new URL(releaseManifestPath, origin);
  if (releaseManifestUrl.origin !== new URL(origin).origin) throw new Error('Release manifest smoke probe must stay on the staging origin.');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const [page, health, releaseManifest] = await Promise.all([
      fetch(origin, { redirect: 'error', signal: controller.signal }),
      fetch(new URL('/health.json', origin), { redirect: 'error', signal: controller.signal }),
      fetch(releaseManifestUrl, { redirect: 'error', signal: controller.signal }),
    ]);
    const metadata = await health.json() as { revision?: string };
    const result = evaluateStagingSmoke({
      origin, expectedRevision, actualRevision: metadata.revision ?? '', appStatus: page.status,
      healthStatus: health.status,
      headers: Object.fromEntries(page.headers.entries()),
      releaseManifestCacheControl: releaseManifest.headers.get('cache-control') ?? '',
      probes: [{ name: 'catalog-manifest', passed: releaseManifest.ok }],
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
  const verified = process.argv.includes('--verified');
  const report = buildReleaseReadinessEvidence({
    revision: (process.env.RELEASE_REVISION || process.env.GITHUB_SHA || '').trim(),
    generatedAt: new Date().toISOString(),
    verified,
    ...(verified ? { sourceSnapshot: readVerifiedSourceSnapshot() } : {}),
  });
  mkdirSync(resolve('artifacts'), { recursive: true });
  writeFileSync(resolve('artifacts/phase6-readiness.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  output(report);
} else {
  throw new Error('Usage: phase6-operator.ts <smoke|canary|evidence> [evidence.json]');
}
