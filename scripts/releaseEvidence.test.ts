import { describe, expect, it } from 'vitest';
import {
  buildCanaryRolloutEvidence,
  buildReleaseReadinessEvidence,
  buildStagingRolloutEvidence,
} from './releaseEvidence';

describe('revision-bound release readiness evidence', () => {
  it.each(['', 'local', 'abc1234', 'a'.repeat(39), 'a'.repeat(41)])(
    'rejects a non-immutable revision %s',
    (revision) => {
      expect(() => buildReleaseReadinessEvidence({
        revision,
        generatedAt: '2026-08-10T00:00:00.000Z',
        verified: true,
      })).toThrow(/40- or 64-character/);
    },
  );

  it('rejects verified evidence without a source snapshot', () => {
    expect(() => buildReleaseReadinessEvidence({
      revision: 'a'.repeat(40),
      generatedAt: '2026-08-10T00:00:00.000Z',
      verified: true,
    })).toThrow(/source snapshot/i);
  });

  it('rejects verified evidence when the source HEAD does not exactly match the revision', () => {
    const input = {
      revision: 'a'.repeat(40),
      generatedAt: '2026-08-10T00:00:00.000Z',
      verified: true,
      sourceSnapshot: {
        headRevision: 'b'.repeat(40),
        porcelainStatus: '',
      },
    };

    expect(() => buildReleaseReadinessEvidence(input)).toThrow(/source HEAD.*revision/i);
  });

  it('rejects verified evidence from a dirty source worktree', () => {
    const input = {
      revision: 'a'.repeat(40),
      generatedAt: '2026-08-10T00:00:00.000Z',
      verified: true,
      sourceSnapshot: {
        headRevision: 'a'.repeat(40),
        porcelainStatus: ' M scripts/releaseEvidence.ts\n?? artifacts/local-report.json',
      },
    };

    expect(() => buildReleaseReadinessEvidence(input)).toThrow(/clean source worktree/i);
  });

  it('binds verified evidence to a full immutable revision from a clean source snapshot', () => {
    const input = {
      revision: 'a'.repeat(40),
      generatedAt: '2026-08-10T00:00:00.000Z',
      verified: true,
      sourceSnapshot: {
        headRevision: 'a'.repeat(40),
        porcelainStatus: '',
      },
    };

    expect(buildReleaseReadinessEvidence(input)).toEqual({
      schemaVersion: 2,
      revision: 'a'.repeat(40),
      generatedAt: '2026-08-10T00:00:00.000Z',
      localVerification: 'passed',
      releaseEligible: true,
      externalGates: {
        stagingSmoke: 'blocked-human-gate',
        canary: 'blocked-human-gate',
        production: 'blocked-human-gate',
      },
    });
  });

  it('keeps unverified evidence unattested without requiring source state', () => {
    expect(buildReleaseReadinessEvidence({
      revision: 'a'.repeat(40),
      generatedAt: '2026-08-10T00:00:00.000Z',
      verified: false,
    })).toMatchObject({
      localVerification: 'unattested',
      releaseEligible: false,
    });
  });
});

describe('bounded rollout evidence envelopes', () => {
  const binding = {
    revision: 'a'.repeat(40),
    candidateSha256: 'b'.repeat(64),
    generatedAt: '2026-08-10T00:10:00.000Z',
    sourceRef: 'staging-run:12345',
  } as const;
  const smoke = {
    origin: 'https://staging.example.test',
    appStatus: 200,
    expectedRevision: 'a'.repeat(40),
    actualRevision: 'a'.repeat(40),
    healthStatus: 200,
    headers: {
      'content-security-policy': "default-src 'self'",
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'strict-origin-when-cross-origin',
    },
    releaseManifestCacheControl: 'no-cache, no-store, must-revalidate',
    probes: [{ name: 'catalog-manifest', passed: true }],
  } as const;

  it('binds a staging result without retaining origins, headers, or content', () => {
    const envelope = buildStagingRolloutEvidence({
      ...binding,
      environment: 'staging',
      smoke,
    });

    expect(envelope).toEqual({
      schemaVersion: 1,
      evidenceType: 'staging-smoke',
      ...binding,
      environment: 'staging',
      metrics: {
        appStatus: 200,
        healthStatus: 200,
        probeCount: 1,
        failedProbeCount: 0,
      },
      result: { status: 'passed', reasons: [] },
    });
    expect(JSON.stringify(envelope)).not.toContain('staging.example.test');
    expect(JSON.stringify(envelope)).not.toContain('content-security-policy');
  });

  it('rejects evidence bound to a revision other than the smoke-tested revision', () => {
    expect(() => buildStagingRolloutEvidence({
      ...binding,
      revision: 'c'.repeat(40),
      environment: 'staging',
      smoke,
    })).toThrow(/revision must match the smoke-tested revision/i);
  });

  it.each([
    { ...binding, sourceRef: 'https://dashboard.example.test/run/1', environment: 'staging', smoke },
    { ...binding, candidateSha256: 'short', environment: 'staging', smoke },
    { ...binding, environment: 'staging', smoke, userId: 'private' },
  ])('rejects malformed, URL-bearing, or unknown staging bindings', input => {
    expect(() => buildStagingRolloutEvidence(input as never)).toThrow();
  });

  it('binds aggregate canary metrics and the deterministic action', () => {
    const envelope = buildCanaryRolloutEvidence({
      ...binding,
      sourceRef: 'canary-window:42',
      environment: 'production-canary',
      windowStartedAt: '2026-08-10T00:00:00.000Z',
      windowEndedAt: '2026-08-10T00:05:00.000Z',
      sample: {
        sampleSize: 100,
        errorRate: 0.005,
        p95Ms: 900,
        ageMs: 1_000,
        syncLossRate: 0,
        quotaUsageRate: 0.2,
        costRate: 0.2,
      },
    });

    expect(envelope).toMatchObject({
      schemaVersion: 1,
      evidenceType: 'canary-decision',
      environment: 'production-canary',
      observationWindow: {
        startedAt: '2026-08-10T00:00:00.000Z',
        endedAt: '2026-08-10T00:05:00.000Z',
      },
      result: { action: 'promote', reasons: [] },
      metrics: { sampleSize: 100, syncLossRate: 0 },
    });
  });

  it('rejects unknown canary fields, oversized metrics, and reversed windows', () => {
    const base = {
      ...binding,
      environment: 'production-canary' as const,
      windowStartedAt: '2026-08-10T00:00:00.000Z',
      windowEndedAt: '2026-08-10T00:05:00.000Z',
      sample: {
        sampleSize: 100,
        errorRate: 0,
        p95Ms: 900,
        ageMs: 1_000,
        syncLossRate: 0,
        quotaUsageRate: 0.2,
        costRate: 0.2,
      },
    };
    expect(() => buildCanaryRolloutEvidence({
      ...base,
      sample: { ...base.sample, email: 'private@example.test' },
    } as never)).toThrow(/schema/);
    expect(() => buildCanaryRolloutEvidence({
      ...base,
      sample: { ...base.sample, sampleSize: 10_000_001 },
    })).toThrow(/bounds/);
    expect(() => buildCanaryRolloutEvidence({
      ...base,
      windowStartedAt: '2026-08-10T00:06:00.000Z',
    })).toThrow(/chronological/);
  });
});
