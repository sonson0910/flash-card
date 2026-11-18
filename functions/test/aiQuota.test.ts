import { describe, expect, it } from 'vitest';
import { freePeriod, resolvePlan } from '../src/aiQuota.js';
import { PILOT_CONFIG_DEFAULTS } from '../src/pilotConfig.js';

const config = { ...PILOT_CONFIG_DEFAULTS };

describe('AI quota periods', () => {
  it('changes the Free month at midnight in Vietnam', () => {
    expect(freePeriod(new Date('2026-09-30T16:59:59.000Z'), config).periodKey).toBe('free-2026-09');
    const october = freePeriod(new Date('2026-09-30T17:00:00.000Z'), config);
    expect(october.periodKey).toBe('free-2026-10');
    expect(october.endsAt.toISOString()).toBe('2026-10-31T17:00:00.000Z');
  });

  it('uses the fixed entitlement window while active and Free after expiry', () => {
    const plan = {
      tier: 'pro', entitlementId: 'grant-1',
      startsAt: new Date('2026-09-01T00:00:00.000Z'),
      expiresAt: new Date('2026-10-01T00:00:00.000Z'),
    };
    expect(resolvePlan(plan, new Date('2026-09-24T00:00:00.000Z'), config))
      .toMatchObject({ tier: 'pro', periodKey: 'pro-grant-1', limit: 1_000 });
    expect(resolvePlan(plan, plan.expiresAt, config))
      .toMatchObject({ tier: 'free', periodKey: 'free-2026-10', limit: 30 });
  });
});
