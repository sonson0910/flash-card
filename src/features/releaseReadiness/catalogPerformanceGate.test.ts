import { describe, expect, it } from 'vitest';
import { assessCatalogPerformance } from './catalogPerformanceGate';

describe('Phase 6 catalog performance gate', () => {
  it('accepts a bounded 10,000-item sample inside the release budgets', () => {
    expect(assessCatalogPerformance({
      itemCount: 10_000, cachedOpenMs: 92, indexedQueryMs: 38, scanned: 40,
    })).toEqual({ status: 'passed', reasons: [] });
  });

  it.each([
    [{ itemCount: 9_999, cachedOpenMs: 92, indexedQueryMs: 38, scanned: 40 }, 'sample-size'],
    [{ itemCount: 10_000, cachedOpenMs: 501, indexedQueryMs: 38, scanned: 40 }, 'cached-open'],
    [{ itemCount: 10_000, cachedOpenMs: 92, indexedQueryMs: 101, scanned: 40 }, 'indexed-query'],
    [{ itemCount: 10_000, cachedOpenMs: 92, indexedQueryMs: 38, scanned: 501 }, 'scan-bound'],
  ] as const)('fails closed when %s violates %s', (sample, reason) => {
    expect(assessCatalogPerformance(sample)).toMatchObject({ status: 'failed', reasons: [reason] });
  });

  it('rejects non-finite or negative evidence', () => {
    expect(() => assessCatalogPerformance({
      itemCount: 10_000, cachedOpenMs: Number.NaN, indexedQueryMs: 1, scanned: 1,
    })).toThrow(/finite/);
  });
});
