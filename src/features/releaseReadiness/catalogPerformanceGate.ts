export const PHASE6_PERFORMANCE_BUDGET = Object.freeze({
  itemCount: 10_000,
  cachedOpenMs: 500,
  indexedQueryMs: 100,
  maximumScanned: 500,
});

export interface CatalogPerformanceSample {
  readonly itemCount: number;
  readonly cachedOpenMs: number;
  readonly indexedQueryMs: number;
  readonly scanned: number;
}

export type CatalogPerformanceReason =
  | 'sample-size'
  | 'cached-open'
  | 'indexed-query'
  | 'scan-bound';

export function assessCatalogPerformance(sample: CatalogPerformanceSample): {
  readonly status: 'passed' | 'failed';
  readonly reasons: readonly CatalogPerformanceReason[];
} {
  for (const value of Object.values(sample)) {
    if (!Number.isFinite(value) || value < 0) throw new TypeError('Performance evidence must be finite and non-negative.');
  }
  const reasons: CatalogPerformanceReason[] = [];
  if (sample.itemCount !== PHASE6_PERFORMANCE_BUDGET.itemCount) reasons.push('sample-size');
  if (sample.cachedOpenMs > PHASE6_PERFORMANCE_BUDGET.cachedOpenMs) reasons.push('cached-open');
  if (sample.indexedQueryMs > PHASE6_PERFORMANCE_BUDGET.indexedQueryMs) reasons.push('indexed-query');
  if (sample.scanned > PHASE6_PERFORMANCE_BUDGET.maximumScanned) reasons.push('scan-bound');
  return { status: reasons.length === 0 ? 'passed' : 'failed', reasons };
}
