import { describe, expect, it } from 'vitest';
import { buildStreakView } from '../gamification/streakView';
import { acceptAuthoritativeGamificationOutcome, verifiedGamificationFromDocuments } from '../gamification/verifiedGamificationClient';
import { runDayNumber } from './todayScreenFacts';
import { verifiedStreakFigures } from './todayStreakFigures';

const shift = (iso: string, days: number) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
};

describe('verifiedStreakFigures', () => {
  it('does not resurrect an ended run after a create-only or practice-only day', () => {
    const now = new Date('2026-11-20T10:00:00Z');
    const last = shift('2026-11-20', -5);
    const byDay: Record<string, number> = { '2026-11-20': 5 };
    for (let i = 0; i < 12; i += 1) byDay[shift(last, -i)] = 10;
    const state = verifiedGamificationFromDocuments(
      { verifiedXp: 125, verifiedStreak: 12, lastVerifiedStudyDay: last, rewardTimeZone: 'UTC' },
      { verifiedByDayV1: byDay },
      {},
    );
    const figures = verifiedStreakFigures(buildStreakView(state, now));
    expect(figures.streakDays).toBe(0);
    expect(figures.run).toEqual({ studiedToday: false, days: 0 });
    expect(runDayNumber(figures.run)).toBe(1);
  });

  it('does not count a new day on match XP alone before a review', () => {
    const now = new Date('2026-11-21T00:05:00Z');
    const byDay: Record<string, number> = {};
    for (let i = 0; i < 5; i += 1) byDay[shift('2026-11-20', -i)] = 10;
    let state = verifiedGamificationFromDocuments(
      { verifiedXp: 50, verifiedStreak: 5, lastVerifiedStudyDay: '2026-11-20', rewardTimeZone: 'UTC' },
      { verifiedByDayV1: byDay },
      {},
    );
    state = acceptAuthoritativeGamificationOutcome(state, {
      xp: 70, level: 1, streak: 5, studyDay: '2026-11-21', events: [], rewardTimeZone: 'UTC',
    } as never);
    const figures = verifiedStreakFigures(buildStreakView(state, now));
    expect(figures.streakDays).toBe(0);
    expect(figures.run).toEqual({ studiedToday: false, days: 5 });
    expect(runDayNumber(figures.run)).toBe(6);
  });

  it('counts today once the server accepted a review for it', () => {
    const now = new Date('2026-11-20T10:00:00Z');
    const state = verifiedGamificationFromDocuments(
      { verifiedXp: 50, verifiedStreak: 5, lastVerifiedStudyDay: '2026-11-20', rewardTimeZone: 'UTC' },
      { verifiedByDayV1: { '2026-11-20': 10 } },
      {},
    );
    const figures = verifiedStreakFigures(buildStreakView(state, now));
    expect(figures.streakDays).toBe(5);
    expect(figures.run).toEqual({ studiedToday: true, days: 5 });
  });
});
