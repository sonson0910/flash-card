import { describe, expect, it } from 'vitest';
import {
  OperationalEventBuffer, createOperationalEvent, decideCanary, evaluateStagingSmoke,
} from './operationalReadiness';

describe('Phase 6 operational readiness', () => {
  it('emits bounded allowlisted telemetry without user or learning content', () => {
    expect(createOperationalEvent('catalog_query', {
      durationMs: 38, resultCount: 20, scanned: 20, userId: 'secret', answer: 'private',
    })).toEqual({
      name: 'catalog_query', schemaVersion: 1,
      metrics: { durationMs: 38, resultCount: 20, scanned: 20 },
    });
  });

  it('rejects unknown events and invalid metrics', () => {
    expect(() => createOperationalEvent('login', {})).toThrow(/allowlisted/);
    expect(() => createOperationalEvent('catalog_query', { durationMs: -1 })).toThrow(/metric/);
  });

  it('caps correlated operational evidence in memory', () => {
    const buffer = new OperationalEventBuffer(2);
    buffer.push('release:1', createOperationalEvent('app_start', { durationMs: 2 }));
    buffer.push('release:2', createOperationalEvent('catalog_query', { durationMs: 3 }));
    buffer.push('release:3', createOperationalEvent('catalog_query', { durationMs: 4 }));
    expect(buffer.snapshot()).toMatchObject({ size: 2, eventCounts: { catalog_query: 2 } });
    expect(() => buffer.push('private email@example.com', createOperationalEvent('app_start', {})))
      .toThrow(/correlation/);
  });

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

  it('accepts a canonical credential-free HTTPS staging origin', () => {
    expect(evaluateStagingSmoke({
      appStatus: 200,
      origin: 'https://staging.example.test', expectedRevision: 'abc', actualRevision: 'abc',
      healthStatus: 200,
      headers: {
        'content-security-policy': 'x',
        'x-content-type-options': 'nosniff',
        'referrer-policy': 'x',
      },
      releaseManifestCacheControl: 'no-cache, no-store, must-revalidate',
    }).reasons).not.toContain('https');
  });

  it.each([
    'http://staging.example.test',
    'https://staging.example.test/',
    'https://staging.example.test/health.json',
    'https://staging.example.test?mode=test',
    'https://staging.example.test#test',
    'https://staging.example.test@attacker.example',
    'not-a-url',
  ])('rejects a non-canonical staging origin: %s', origin => {
    expect(evaluateStagingSmoke({
      appStatus: 200,
      origin, expectedRevision: 'abc', actualRevision: 'abc',
      healthStatus: 200, headers: {}, releaseManifestCacheControl: '',
    }).reasons).toContain('https');
  });

  it('rejects unknown fields and oversized staging inputs at runtime', () => {
    const base = {
      appStatus: 200,
      expectedRevision: 'abc',
      actualRevision: 'abc',
      healthStatus: 200,
      headers: {},
      releaseManifestCacheControl: 'no-cache, no-store, must-revalidate',
    };
    expect(() => evaluateStagingSmoke({ ...base, email: 'private@example.test' } as never))
      .toThrow(/schema/);
    expect(() => evaluateStagingSmoke({ ...base, headers: { x: 'a'.repeat(4_097) } }))
      .toThrow(/headers/);
    expect(() => evaluateStagingSmoke({
      ...base,
      probes: Array.from({ length: 65 }, (_, index) => ({ name: `probe-${index}`, passed: true })),
    })).toThrow(/probes/);
  });
});
