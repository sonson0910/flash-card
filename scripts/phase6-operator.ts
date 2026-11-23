import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  parseCatalogReleaseManifestV1,
  parseCatalogReleaseManifestV2,
} from '../src/features/catalogPipeline/catalogValidation';
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
  const releaseManifestPath = process.env.CATALOG_MANIFEST_PATH?.trim() ?? '';
  if (!origin.startsWith('https://') || !expectedRevision) throw new Error('HTTPS STAGING_ORIGIN and EXPECTED_REVISION are required.');
  const manifestTarget = /^\/catalog\/([^/]+)\/([^/]+)\/release-manifest\.json$/.exec(releaseManifestPath);
  if (!manifestTarget) throw new Error('CATALOG_MANIFEST_PATH must be /catalog/<catalogId>/<releaseId>/release-manifest.json.');
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
    // Hosting answers a missing manifest with the SPA document, status 200 and the manifest's headers,
    // so only a parsed manifest for the named catalog and release proves the manifest is served.
    const releaseManifestServed = async (): Promise<boolean> => {
      if (!releaseManifest.ok || !/^application\/json\b/i.test(releaseManifest.headers.get('content-type') ?? '')) return false;
      try {
        const value = JSON.parse(await releaseManifest.text()) as { manifestVersion?: unknown } | null;
        const manifest = value?.manifestVersion === 2
          ? parseCatalogReleaseManifestV2(value)
          : parseCatalogReleaseManifestV1(value);
        return manifest.catalogId === decodeURIComponent(manifestTarget[1])
          && manifest.releaseId === decodeURIComponent(manifestTarget[2]);
      } catch {
        return false;
      }
    };
    const result = evaluateStagingSmoke({
      origin, expectedRevision, actualRevision: metadata.revision ?? '', appStatus: page.status,
      healthStatus: health.status,
      headers: Object.fromEntries(page.headers.entries()),
      releaseManifestCacheControl: releaseManifest.headers.get('cache-control') ?? '',
      probes: [{ name: 'catalog-manifest', passed: await releaseManifestServed() }],
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
