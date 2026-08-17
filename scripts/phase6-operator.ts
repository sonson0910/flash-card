import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { decideCanary, evaluateStagingSmoke } from '../src/features/releaseReadiness/operationalReadiness';
import {
  buildCanaryRolloutEvidence,
  buildReleaseReadinessEvidence,
  buildStagingRolloutEvidence,
  isImmutableReleaseRevision,
} from './releaseEvidence';
import { probeStagingSmoke } from './staging-smoke-probe';

const command = process.argv[2];
const output = (value: unknown): void => {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
};

const optionValue = (name: string): string | null => {
  const index = process.argv.indexOf(name);
  if (index < 0) return null;
  const value = process.argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a file path.`);
  return value;
};

const writeRolloutEvidence = (path: string | null, report: unknown): void => {
  if (!path) return;
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  if (Buffer.byteLength(serialized) > 16_384) throw new Error('Rollout evidence exceeds 16 KiB.');
  const target = resolve(path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, serialized, 'utf8');
};

const rolloutBinding = (generatedAt: string) => ({
  revision: (process.env.RELEASE_REVISION || process.env.GITHUB_SHA || '').trim(),
  candidateSha256: process.env.CANDIDATE_SHA256?.trim() ?? '',
  generatedAt,
  sourceRef: process.env.EVIDENCE_SOURCE_REF?.trim() ?? '',
});

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
  const evidencePath = optionValue('--evidence-output');
  if (evidencePath) {
    const evidenceRevision = (process.env.RELEASE_REVISION || process.env.GITHUB_SHA || '')
      .trim()
      .toLowerCase();
    if (
      !isImmutableReleaseRevision(evidenceRevision)
      || evidenceRevision !== expectedRevision.toLowerCase()
    ) throw new Error('Release evidence revision must match the smoke-tested revision.');
  }
  const smoke = await probeStagingSmoke({ origin, expectedRevision, releaseManifestPath });
  const result = evaluateStagingSmoke(smoke);
  output(result);
  if (evidencePath) {
    const generatedAt = new Date().toISOString();
    writeRolloutEvidence(evidencePath, buildStagingRolloutEvidence({
      ...rolloutBinding(generatedAt),
      environment: 'staging',
      smoke,
    }));
  }
  if (result.status !== 'passed') process.exitCode = 1;
} else if (command === 'canary') {
  const path = process.argv[3];
  if (!path) throw new Error('Provide a bounded canary JSON evidence file.');
  const bytes = readFileSync(resolve(path));
  if (bytes.byteLength > 16_384) throw new Error('Canary evidence exceeds 16 KiB.');
  const sample = JSON.parse(bytes.toString('utf8')) as Parameters<typeof decideCanary>[0];
  const result = decideCanary(sample);
  output(result);
  const evidencePath = optionValue('--evidence-output');
  if (evidencePath) {
    const generatedAt = new Date().toISOString();
    writeRolloutEvidence(evidencePath, buildCanaryRolloutEvidence({
      ...rolloutBinding(generatedAt),
      environment: 'production-canary',
      windowStartedAt: process.env.CANARY_WINDOW_STARTED_AT?.trim() ?? '',
      windowEndedAt: process.env.CANARY_WINDOW_ENDED_AT?.trim() ?? '',
      sample,
    }));
  }
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
  throw new Error('Usage: phase6-operator.ts <smoke|canary|evidence> [evidence.json] [--evidence-output path]');
}
