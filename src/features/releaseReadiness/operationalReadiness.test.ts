import { describe, expect, it } from 'vitest';
import { decideCanary, evaluateStagingSmoke } from './operationalReadiness';

describe('Phase 6 operational readiness', () => {

  it.each([
    [{ sampleSize: 40, errorRate: 0, p95Ms: 100, ageMs: 1_000, syncLossRate: 0, quotaUsageRate: .2, costRate: .2 }, 'hold'],
    [{ sampleSize: 100, errorRate: 0.005, p95Ms: 900, ageMs: 1_000, syncLossRate: 0, quotaUsageRate: .2, costRate: .2 }, 'promote'],
    [{ sampleSize: 100, errorRate: 0.02, p95Ms: 900, ageMs: 1_000, syncLossRate: 0, quotaUsageRate: .2, costRate: .2 }, 'rollback'],
    [{ sampleSize: 100, errorRate: 0, p95Ms: 2_100, ageMs: 1_000, syncLossRate: 0, quotaUsageRate: .2, costRate: .2 }, 'rollback'],
    [{ sampleSize: 100, errorRate: 0, p95Ms: 900, ageMs: 600_000, syncLossRate: 0, quotaUsageRate: .2, costRate: .2 }, 'hold'],
    [{ sampleSize: 100, errorRate: 0, p95Ms: 900, ageMs: 1_000 }, 'hold'],
    [{ sampleSize: 100, errorRate: 0, p95Ms: 900, ageMs: 1_000, syncLossRate: .001, quotaUsageRate: .2, costRate: .2 }, 'rollback'],
    [{ sampleSize: 100, errorRate: 0, p95Ms: 900, ageMs: 1_000, syncLossRate: 0, quotaUsageRate: .95, costRate: .2 }, 'rollback'],
    [{ sampleSize: 100, errorRate: 0, p95Ms: 900, ageMs: 1_000, syncLossRate: 0, quotaUsageRate: .2, costRate: 1.1 }, 'rollback'],
  ] as const)('returns deterministic canary action', (sample, action) => {
    expect(decideCanary(sample).action).toBe(action);
  });

  it('never promotes canary evidence when required measurements are missing', () => {
    expect(decideCanary({
      syncLossRate: 0,
      quotaUsageRate: 0.2,
      costRate: 0.2,
    } as never)).toEqual({ action: 'hold', reasons: ['missing-evidence'] });
  });

  it('rejects unknown or malformed canary evidence at runtime', () => {
    expect(() => decideCanary({
      sampleSize: 100,
      errorRate: 0,
      p95Ms: 500,
      ageMs: 1_000,
      syncLossRate: 0,
      quotaUsageRate: 0.2,
      costRate: 0.2,
      userId: 'private',
    } as never)).toThrow(/schema/);
    expect(() => decideCanary({
      sampleSize: 100.5,
      errorRate: 0,
      p95Ms: 500,
      ageMs: 1_000,
      syncLossRate: 0,
      quotaUsageRate: 0.2,
      costRate: 0.2,
    })).toThrow(/sampleSize/);
  });

  it('requires revision, health, security headers and a revalidating release manifest cache', () => {
    expect(evaluateStagingSmoke({
      appStatus: 200,
      expectedRevision: 'abc', actualRevision: 'abc', healthStatus: 200,
      headers: {
        'content-security-policy': "default-src 'self'",
        'x-content-type-options': 'nosniff',
        'referrer-policy': 'strict-origin-when-cross-origin',
      },
      releaseManifestCacheControl: 'no-cache, no-store, must-revalidate',
      probes: [{ name: 'auth', passed: true }, { name: 'firestore', passed: true }],
    })).toEqual({ status: 'passed', reasons: [] });
  });

  it.each([
    ['no-store, must-revalidate'],
    ['no-cache, must-revalidate'],
    ['no-cache, no-store'],
    ['no-cache, no-store, must-revalidate, immutable'],
    ['public, max-age=31536000, immutable'],
  ])('rejects unsafe release manifest cache policy %s', (releaseManifestCacheControl) => {
    expect(evaluateStagingSmoke({
      appStatus: 200,
      expectedRevision: 'abc', actualRevision: 'abc', healthStatus: 200,
      headers: {
        'content-security-policy': "default-src 'self'",
        'x-content-type-options': 'nosniff',
        'referrer-policy': 'strict-origin-when-cross-origin',
      },
      releaseManifestCacheControl,
    })).toEqual({ status: 'failed', reasons: ['release-manifest-cache'] });
  });

  it('fails smoke when a bounded service probe fails', () => {
    expect(evaluateStagingSmoke({
      appStatus: 200,
      expectedRevision: 'abc', actualRevision: 'abc', healthStatus: 200,
      headers: { 'content-security-policy': 'x', 'x-content-type-options': 'nosniff', 'referrer-policy': 'x', 'cache-control': 'immutable' },
      releaseManifestCacheControl: 'no-cache, no-store, must-revalidate',
      probes: [{ name: 'firestore', passed: false }],
    }).reasons).toContain('probe:firestore');
  });

  it('fails smoke when the deployed application document is unhealthy', () => {
    expect(evaluateStagingSmoke({
      appStatus: 503,
      expectedRevision: 'abc', actualRevision: 'abc', healthStatus: 200,
      headers: {
        'content-security-policy': "default-src 'self'",
        'x-content-type-options': 'nosniff',
        'referrer-policy': 'strict-origin-when-cross-origin',
      },
      releaseManifestCacheControl: 'no-cache, no-store, must-revalidate',
      probes: [{ name: 'catalog-manifest', passed: true }],
    } as never).reasons).toContain('app');
  });

  it('rejects an insecure staging origin', () => {
    expect(evaluateStagingSmoke({
      appStatus: 200,
      origin: 'http://staging.example.test', expectedRevision: 'abc', actualRevision: 'abc',
      healthStatus: 200, headers: {}, releaseManifestCacheControl: '',
    }).reasons).toContain('https');
  });
});
