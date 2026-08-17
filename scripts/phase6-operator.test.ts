import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const source = fs.readFileSync(new URL('./phase6-operator.ts', import.meta.url), 'utf8');
const projectRoot = fileURLToPath(new URL('..', import.meta.url));

describe('Phase 6 operator evidence output', () => {
  it('keeps rollout evidence optional and validates its binding before probing', () => {
    expect(source).toContain("optionValue('--evidence-output')");
    expect(source).toContain('buildStagingRolloutEvidence({');
    expect(source).toContain('buildCanaryRolloutEvidence({');
    expect(source.indexOf("const evidencePath = optionValue('--evidence-output')"))
      .toBeLessThan(source.indexOf('probeStagingSmoke({'));
    expect(source.indexOf('output(result);'))
      .toBeLessThan(source.indexOf('writeRolloutEvidence(evidencePath'));
  });

  it('binds rollout evidence only to allowlisted environments and aggregate inputs', () => {
    expect(source).toContain("environment: 'staging'");
    expect(source).toContain("environment: 'production-canary'");
    expect(source).toContain('CANARY_WINDOW_STARTED_AT');
    expect(source).toContain('CANARY_WINDOW_ENDED_AT');
    expect(source).toContain('CANDIDATE_SHA256');
    expect(source).toContain('EVIDENCE_SOURCE_REF');
    expect(source).not.toMatch(/firebase-tools\s+deploy|gh\s+workflow\s+run/);
  });

  it('delegates runtime smoke behavior to the behavior-tested probe module', () => {
    expect(source).toContain("import { probeStagingSmoke } from './staging-smoke-probe'");
    expect(source).toContain('probeStagingSmoke({ origin, expectedRevision, releaseManifestPath })');
    expect(source).not.toContain('health.json()');
    expect(source).not.toContain('fetch(origin');
  });

  it('rejects a mismatched retained revision before any staging request or evidence write', () => {
    const directory = fs.mkdtempSync(join(tmpdir(), 'phase6-smoke-'));
    const evidencePath = join(directory, 'staging-evidence.json');
    try {
      const result = spawnSync('npm', [
        'exec', 'vite-node', '--', 'scripts/phase6-operator.ts', 'smoke',
        '--evidence-output', evidencePath,
      ], {
        cwd: projectRoot,
        encoding: 'utf8',
        timeout: 10_000,
        env: {
          ...process.env,
          STAGING_ORIGIN: 'https://staging.example.test',
          EXPECTED_REVISION: 'a'.repeat(40),
          RELEASE_REVISION: 'b'.repeat(40),
          CANDIDATE_SHA256: 'c'.repeat(64),
          EVIDENCE_SOURCE_REF: 'staging-run:1',
        },
      });
      expect(result.status).not.toBe(0);
      expect(`${result.stdout}${result.stderr}`).toMatch(/revision must match the smoke-tested revision/i);
      expect(fs.existsSync(evidencePath)).toBe(false);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});
