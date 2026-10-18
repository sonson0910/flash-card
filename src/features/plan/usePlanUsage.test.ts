import { describe, expect, it } from 'vitest';
import { resolvePlanPeriod } from './usePlanUsage';

const timestamp = (date: Date) => ({ toDate: () => date });

describe('resolvePlanPeriod', () => {
  it('treats a Pro plan as active once its start and end bracket the current time', () => {
    const now = new Date('2026-09-24T10:00:00.000Z');
    const plan = {
      tier: 'pro', entitlementId: 'ent-1',
      startsAt: timestamp(new Date('2026-09-01T00:00:00.000Z')),
      expiresAt: timestamp(new Date('2026-10-01T00:00:00.000Z')),
    };

    const resolved = resolvePlanPeriod(plan, now);

    expect(resolved.tier).toBe('pro');
    expect(resolved.key).toBe('pro-ent-1');
    expect(resolved.endsAt).toEqual(new Date('2026-10-01T00:00:00.000Z'));
  });

  it('still treats a just-granted Pro plan as active when the device clock is a few minutes behind the server', () => {
    const proStart = new Date('2026-09-24T10:00:00.000Z');
    // The device clock is 4 minutes slow, so `now` reads as being before `startsAt`.
    const now = new Date(proStart.getTime() - 4 * 60_000);
    const plan = {
      tier: 'pro', entitlementId: 'ent-1',
      startsAt: timestamp(proStart),
      expiresAt: timestamp(new Date('2026-10-01T00:00:00.000Z')),
    };

    const resolved = resolvePlanPeriod(plan, now);

    expect(resolved.tier).toBe('pro');
  });

  it('falls back to free and schedules a refresh at startsAt when the clock skew exceeds the tolerance', () => {
    const proStart = new Date('2026-09-24T10:00:00.000Z');
    // A 20-minute skew is outside the 5-minute tolerance: the grant is not yet treated as active.
    const now = new Date(proStart.getTime() - 20 * 60_000);
    const plan = {
      tier: 'pro', entitlementId: 'ent-1',
      startsAt: timestamp(proStart),
      expiresAt: timestamp(new Date('2026-10-01T00:00:00.000Z')),
    };

    const resolved = resolvePlanPeriod(plan, now);

    expect(resolved.tier).toBe('free');
    // The refresh is scheduled for when startsAt clears the tolerance window, not for the free period's end.
    expect(resolved.nextRefreshAt).toEqual(new Date(proStart.getTime() - 5 * 60_000));
  });

  it('falls back to free once the Pro grant has expired', () => {
    const now = new Date('2026-10-02T00:00:00.000Z');
    const plan = {
      tier: 'pro', entitlementId: 'ent-1',
      startsAt: timestamp(new Date('2026-09-01T00:00:00.000Z')),
      expiresAt: timestamp(new Date('2026-10-01T00:00:00.000Z')),
    };

    const resolved = resolvePlanPeriod(plan, now);

    expect(resolved.tier).toBe('free');
  });

  it('treats a missing or malformed plan document as free, keyed by the current Ho Chi Minh month', () => {
    const now = new Date('2026-09-24T10:00:00.000Z');

    expect(resolvePlanPeriod(undefined, now).tier).toBe('free');
    expect(resolvePlanPeriod({ tier: 'pro' }, now).tier).toBe('free');
    expect(resolvePlanPeriod(undefined, now).key).toBe('free-2026-09');
  });
});
