import { describe, expect, it } from 'vitest';
import { summarizeAiCosts, validateAiCostReportTarget } from '../src/aiCostReportOperator.js';

describe('AI cost report', () => {
  it('accepts only a sealed project and date range before making a client', () => {
    const base = {
      FIREBASE_PROJECT_ID: 'sonflash-staging-20260906',
      FIRESTORE_DATABASE_ID: 'ai-studio-945b4052-4462-4668-8936-277f09f07a37',
      PILOT_REPORT_FROM: '2026-09-23', PILOT_REPORT_TO: '2026-09-24',
      ANALYTICS_PSEUDONYM_KEY: 'x'.repeat(32),
    };
    expect(validateAiCostReportTarget(base).projectId).toBe('sonflash-staging-20260906');
    expect(() => validateAiCostReportTarget({ ...base, FIREBASE_PROJECT_ID: 'unexpected' })).toThrow();
    expect(() => validateAiCostReportTarget({ ...base, PILOT_REPORT_TO: '2026-01-01' })).toThrow();
    expect(() => validateAiCostReportTarget({ ...base, ANALYTICS_PSEUDONYM_KEY: '' })).toThrow();
  });

  it('reports daily distribution and pseudonymous top accounts', () => {
    const report = summarizeAiCosts([
      { uid: 'learner-a', day: '2026-09-24', action: 'word', outcome: 'ok', estimatedUsdMicros: 500 },
      { uid: 'learner-a', day: '2026-09-24', action: 'word', outcome: 'timeout', estimatedUsdMicros: 900 },
      { uid: 'learner-b', day: '2026-09-24', action: 'translate', outcome: 'ok', estimatedUsdMicros: 100 },
    ], 'x'.repeat(32));
    expect(report.days).toEqual([{
      day: '2026-09-24', calls: 3, spendUsdMicros: 1_500,
      wordMeanUsdMicros: 700, wordP50UsdMicros: 500, wordP95UsdMicros: 900,
      timeoutShare: 1 / 3,
    }]);
    expect(report.topAccounts[0]).toMatchObject({ calls: 2, spendUsdMicros: 1_400 });
    expect(report.topAccounts[0]?.pid).toMatch(/^[a-f0-9]{32}$/);
    expect(JSON.stringify(report)).not.toContain('learner-a');
  });
});
