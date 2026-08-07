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

  it('requires revision, health, security headers and immutable catalog cache', () => {
    expect(evaluateStagingSmoke({
      expectedRevision: 'abc', actualRevision: 'abc', healthStatus: 200,
      headers: {
        'content-security-policy': "default-src 'self'",
        'x-content-type-options': 'nosniff',
        'referrer-policy': 'strict-origin-when-cross-origin',
      },
      catalogCacheControl: 'public, max-age=31536000, immutable',
      probes: [{ name: 'auth', passed: true }, { name: 'firestore', passed: true }],
    })).toEqual({ status: 'passed', reasons: [] });
  });

  it('fails smoke when a bounded service probe fails', () => {
    expect(evaluateStagingSmoke({
      expectedRevision: 'abc', actualRevision: 'abc', healthStatus: 200,
      headers: { 'content-security-policy': 'x', 'x-content-type-options': 'nosniff', 'referrer-policy': 'x', 'cache-control': 'immutable' },
      catalogCacheControl: 'immutable',
      probes: [{ name: 'firestore', passed: false }],
    }).reasons).toContain('probe:firestore');
  });

  it('rejects an insecure staging origin', () => {
    expect(evaluateStagingSmoke({
      origin: 'http://staging.example.test', expectedRevision: 'abc', actualRevision: 'abc',
      healthStatus: 200, headers: {}, catalogCacheControl: '',
    }).reasons).toContain('https');
  });
});
