import { describe, expect, it } from 'vitest';
import { computeWeeklyRecap, WEEKLY_RECAP_WINDOW_DAYS } from './weeklyRecapModel';

const NOW = new Date('2026-09-27T09:00:00.000Z');

describe('computeWeeklyRecap', () => {
  it('windows exactly the last 7 local calendar days, ending today', () => {
    const recap = computeWeeklyRecap([], NOW);

    expect(recap.days).toHaveLength(WEEKLY_RECAP_WINDOW_DAYS);
    expect(recap.rangeEnd).toBe('2026-09-27');
    expect(recap.rangeStart).toBe('2026-09-21');
  });

  it('sums same-day XP and marks the week inactive when every day is zero', () => {
    const recap = computeWeeklyRecap([], NOW);

    expect(recap.totalXp).toBe(0);
    expect(recap.activeDays).toBe(0);
    expect(recap.bestDay).toBeNull();
    expect(recap.hasActivity).toBe(false);
  });

  it('reads ISO-dated chart entries within the window and ignores days outside it', () => {
    const recap = computeWeeklyRecap([
      { date: '2026-09-25', XP: 40 },
      { date: '2026-09-26', XP: 60 },
      { date: '2026-09-27', XP: 10 },
      { date: '2026-09-01', XP: 999 }, // outside the 7-day window; must not leak in.
    ], NOW);

    expect(recap.totalXp).toBe(110);
    expect(recap.activeDays).toBe(3);
    expect(recap.hasActivity).toBe(true);
    expect(recap.bestDay).toEqual({ dateKey: '2026-09-26', xp: 60 });
  });

  it('normalizes legacy toDateString() chart-entry dates to the same day bucket', () => {
    const recap = computeWeeklyRecap([
      { date: 'Fri Sep 25 2026', XP: 15 },
      { date: '2026-09-25', XP: 5 }, // same calendar day under the ISO key; must merge, not double.
    ], NOW);

    const day = recap.days.find(entry => entry.dateKey === '2026-09-25');
    expect(day?.xp).toBe(20);
    expect(recap.totalXp).toBe(20);
  });

  it('ignores non-finite and non-positive chart entries without throwing', () => {
    const recap = computeWeeklyRecap([
      { date: '2026-09-27', XP: Number.NaN },
      { date: '2026-09-26', XP: -5 },
      { date: '2026-09-25', XP: 0 },
    ], NOW);

    expect(recap.totalXp).toBe(0);
    expect(recap.hasActivity).toBe(false);
  });
});
