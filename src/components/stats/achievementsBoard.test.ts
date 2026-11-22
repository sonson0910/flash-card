import { afterEach, describe, expect, it } from 'vitest';
import type { LibraryStatsViewModel } from '../../features/library/libraryViewModel';
import { achievementsFixture, stateFromFixture, type VerifiedStatsFixture } from '../../features/gamification/testing/verifiedStatsFixtures';
import { setFormatLocale } from '../../lib/format';
import { buildAchievementsBoard, formatEarnedDay, formatEarnedDayLong, lateReviewWindow } from './achievementsBoard';

const stats = (): LibraryStatsViewModel => ({ total: 1, reviewed: 1, learned: 0, learning: 1, dueToday: 1, categoryChart: [], categoryChartIsPartial: false, difficultyChart: [], xpChartData: [{ date: '2026-09-28', XP: 100 }] });

const recordOf = (fixture: VerifiedStatsFixture) => fixture.stats.achievementsV1 as Record<string, unknown>;

/** The achievements fixture with its record replaced field by field. */
const withRecord = (fields: Record<string, unknown>, statsFields: Record<string, unknown> = {}, rewards?: Record<string, unknown>): VerifiedStatsFixture => ({
  ...achievementsFixture,
  stats: { ...achievementsFixture.stats, ...statsFields, achievementsV1: { ...recordOf(achievementsFixture), ...fields } },
  rewards: rewards ?? achievementsFixture.rewards,
});

const learnerFor = (fixture: VerifiedStatsFixture) => {
  const gamification = stateFromFixture(fixture);
  return { level: 1, xp: gamification.xp, gamification };
};

afterEach(() => setFormatLocale('en'));

describe('achievements board model', () => {
  it('keeps the six library badges and no level while signed out', () => {
    const model = buildAchievementsBoard(stats(), null, new Date('2026-11-27T15:45:00Z'));
    expect(model.recorded).toBe(false);
    expect(model.badges.map(badge => badge.id)).toEqual(['streak_3', 'mastery_10', 'mastery_50', 'xp_100', 'xp_total_500', 'night_owl']);
    expect(model.badges.every(badge => badge.earned === null)).toBe(true);
    expect(model).toMatchObject({ level: null, titles: [], shownTitleId: null, totalXp: null, bestStreak: null, paceMinutes: null });
  });

  it('measures the level inside its span and ignores a level that is not usable', () => {
    const now = new Date('2026-11-27T15:45:00Z');
    expect(buildAchievementsBoard(stats(), { level: 0, xp: 10 }, now).level).toBeNull();
    expect(buildAchievementsBoard(stats(), { level: 2, xp: Number.NaN }, now).level).toBeNull();
    expect(buildAchievementsBoard(stats(), { level: 2, xp: 150 }, now).level).toEqual({ level: 2, xpIntoLevel: 50, levelSpan: 300, progress: 50 / 300 });
    // The level alone does not bring the summary tiles: those read the verified state.
    expect(buildAchievementsBoard(stats(), { level: 2, xp: 150 }, now).totalXp).toBeNull();
  });

  it('draws the twelve recorded badges with their recorded days, real progress and real conditions', () => {
    const model = buildAchievementsBoard(stats(), learnerFor(achievementsFixture), achievementsFixture.now);
    expect(model.recorded).toBe(true);
    expect(model.badges).toHaveLength(12);
    expect(model.earnedCount).toBe(6);
    const byId = Object.fromEntries(model.badges.map(badge => [badge.id, badge]));
    expect(byId['reviewed-10']).toMatchObject({ state: 'earned', value: 10, target: 10, percent: 100, earned: { on: '2026-11-27', exact: false } });
    expect(byId['mastered-50']).toMatchObject({ state: 'in-progress', value: 13, target: 50, percent: 26, unit: 'words', earned: null });
    expect(byId['late-reviews-10']).toMatchObject({ state: 'in-progress', value: 1, percent: 10, unit: 'reviews' });
    expect(byId['spelling-50']).toMatchObject({ state: 'locked', value: 0, percent: 0, unit: 'answers' });
    // A badge the server has not recorded never reads as complete.
    expect(model.badges.filter(badge => badge.state !== 'earned').every(badge => badge.percent < 100)).toBe(true);
    expect(model.featured.state).toBe('in-progress');
    expect(model.featured.percent).toBe(Math.max(...model.badges.filter(badge => badge.state === 'in-progress').map(badge => badge.percent)));
    expect(model.level).toMatchObject({ level: 3, xpIntoLevel: 222, levelSpan: 500 });
    expect(model.totalXp).toBe(622);
    expect(model.titles.map(title => [title.id, title.level, title.held, title.shown])).toEqual([['word-keeper', 5, false, false], ['word-collector', 13, false, false]]);
    expect(model.shownTitleId).toBeNull();
  });

  it('shows every recorded badge as not started for an account with no study yet', () => {
    const empty = withRecord({
      counters: { activeDays: 0, lastXpDay: null, lastXpDayXp: 0, bestDayXp: 0, reviewedCards: 0, masteredWords: 0, lateReviews: 0, spellingCorrect: 0 },
      badges: {},
    }, { verifiedXp: 0, verifiedStreak: 0, lastVerifiedStudyDay: null });
    const model = buildAchievementsBoard(stats(), learnerFor(empty), empty.now);
    expect(model.recorded).toBe(true);
    expect(model.earnedCount).toBe(0);
    expect(model.badges.every(badge => badge.state === 'locked' && badge.value === 0)).toBe(true);
    expect(model.featured.id).toBe('first-review');
  });

  it('shows the highest title held, with the day it was recorded', () => {
    const titled = withRecord({ titles: { 'word-keeper': { on: '2026-12-02', exact: true } } }, { verifiedXp: 1_700 });
    const model = buildAchievementsBoard(stats(), learnerFor(titled), titled.now);
    expect(model.shownTitleId).toBe('word-keeper');
    expect(model.titles[0]).toMatchObject({ id: 'word-keeper', held: true, shown: true, earned: { on: '2026-12-02', exact: true } });
    expect(model.titles[1]).toMatchObject({ id: 'word-collector', held: false, shown: false, earned: null });
  });

  it('keeps a title the rewards inventory granted before titles were recorded, without a day', () => {
    const granted = withRecord({}, { verifiedXp: 1_700 }, { ownedTitleIds: ['word-keeper'] });
    const model = buildAchievementsBoard(stats(), learnerFor(granted), granted.now);
    expect(model.titles[0]).toMatchObject({ held: true, shown: true, earned: null });
  });
});

describe('earned dates', () => {
  it('shows day and short month in the learner locale, with the year only when it is not the current one', () => {
    const now = new Date('2026-11-27T15:45:00Z');
    expect(formatEarnedDay('2026-06-02', now)).toBe('02 Jun');
    expect(formatEarnedDay('2025-12-31', now)).toBe('31 Dec 2025');
    expect(formatEarnedDayLong('2026-11-27')).toBe('November 27, 2026');
    setFormatLocale('vi');
    expect(formatEarnedDay('2026-06-02', now)).toBe('02 thg 6');
    expect(formatEarnedDayLong('2026-11-27')).toBe('27 tháng 11, 2026');
  });

  it('keeps the recorded study day whatever the device time zone', () => {
    // The study day is a calendar day: a device west of UTC must not show the day before.
    const previous = process.env.TZ;
    process.env.TZ = 'America/Los_Angeles';
    try {
      expect(formatEarnedDay('2026-11-27', new Date('2026-11-27T12:00:00Z'))).toBe('27 Nov');
      expect(formatEarnedDayLong('2026-11-27')).toBe('November 27, 2026');
    } finally {
      if (previous === undefined) delete process.env.TZ;
      else process.env.TZ = previous;
    }
  });

  it('names the late-review window in the learner clock', () => {
    expect(lateReviewWindow()).toEqual({ start: '10:00 PM', end: '4:00 AM' });
    setFormatLocale('vi');
    expect(lateReviewWindow()).toEqual({ start: '22:00', end: '4:00' });
  });
});
