import { describe, expect, it } from 'vitest';
import { parseAchievements, zeroAchievementCounters, type AchievementsStateV1 } from '../src/achievement-rules';
import { backfilledAchievements, evaluateAchievements, isLateHour, type AchievementSignals } from '../src/achievements';

const signals = (fields: Partial<AchievementSignals> = {}): AchievementSignals => ({
  studyDay: '2026-12-03', xpGained: 2, firstReview: false, firstEasy: false, lateReview: false, correctAnswers: 0, ...fields,
});

// Already recorded for the default stored counters, so a test sees only what its action changes.
const earned = {
  'active-days-3': { on: '2026-11-27', exact: false },
  'active-days-5': { on: '2026-11-29', exact: true },
};

const stored = (fields: Partial<AchievementsStateV1> = {}, counters: Partial<AchievementsStateV1['counters']> = {}): AchievementsStateV1 => ({
  catalogVersion: 1,
  recordingStartedOn: '2026-11-27',
  counters: { ...zeroAchievementCounters(), activeDays: 6, lastXpDay: '2026-12-02', lastXpDayXp: 30, bestDayXp: 60, ...counters },
  badges: earned,
  titles: {},
  ...fields,
});

const evaluate = (input: Partial<Parameters<typeof evaluateAchievements>[0]> = {}) => evaluateAchievements({
  stored: stored(),
  rebuilt: false,
  signals: signals(),
  before: { verifiedXp: 100, streak: 1 },
  after: { verifiedXp: 102, streak: 1 },
  ...input,
});

describe('backfilledAchievements and the worked examples', () => {
  it('records the first review of a new learner with its exact day', () => {
    const base = backfilledAchievements('2026-12-01', { verifiedByDay: undefined, reviewedCards: 0, masteredWords: 0 });
    const result = evaluate({
      stored: base, rebuilt: true,
      signals: signals({ studyDay: '2026-12-01', firstReview: true }),
      before: { verifiedXp: 0, streak: 0 }, after: { verifiedXp: 2, streak: 1 },
    });
    expect(result.state.counters).toMatchObject({ activeDays: 1, lastXpDay: '2026-12-01', lastXpDayXp: 2, bestDayXp: 2, reviewedCards: 1 });
    expect(result.state.badges).toEqual({ 'first-review': { on: '2026-12-01', exact: true } });
    expect(result.patch).toEqual({
      catalogVersion: 1, recordingStartedOn: '2026-12-01', counters: result.state.counters,
      badges: { 'first-review': { on: '2026-12-01', exact: true } },
    });
  });

  it('marks what an existing learner met before recording began as earned by the first day', () => {
    const verifiedByDay = {
      '2026-10-01': 40, '2026-10-02': 130, '2026-10-05': 60, '2026-10-09': 70, '2026-10-20': 80,
      '2026-11-01': 90, '2026-11-10': 50, '2026-11-20': 60, '2026-11-25': 40,
      '2026-11-26': 0, 'not-a-day': 999, '2026-11-24': -5,
    };
    const base = backfilledAchievements('2026-11-27', { verifiedByDay, reviewedCards: 37, masteredWords: 12 });
    expect(base.counters).toMatchObject({ activeDays: 9, lastXpDay: '2026-11-25', lastXpDayXp: 40, bestDayXp: 130 });
    // An Easy review at 22:40 in Ho Chi Minh City of a card never rated Easy.
    const result = evaluate({
      stored: base, rebuilt: true,
      signals: signals({ studyDay: '2026-11-27', firstEasy: true, lateReview: isLateHour(new Date('2026-11-27T15:40:00.000Z'), 'Asia/Ho_Chi_Minh') }),
      before: { verifiedXp: 620, streak: 4 }, after: { verifiedXp: 622, streak: 4 },
    });
    expect(result.state).toEqual({
      catalogVersion: 1,
      recordingStartedOn: '2026-11-27',
      counters: {
        activeDays: 10, lastXpDay: '2026-11-27', lastXpDayXp: 2, bestDayXp: 130,
        reviewedCards: 37, masteredWords: 13, lateReviews: 1, spellingCorrect: 0,
      },
      badges: Object.fromEntries(['first-review', 'active-days-3', 'active-days-5', 'reviewed-10', 'day-xp-100', 'xp-500']
        .map(id => [id, { on: '2026-11-27', exact: false }])),
      titles: {},
    });
  });

  it('gives a threshold crossed by this action its exact day', () => {
    const result = evaluate({ stored: stored({}, { masteredWords: 49 }), signals: signals({ firstEasy: true }) });
    expect(result.state.badges['mastered-50']).toEqual({ on: '2026-12-03', exact: true });
    expect(result.patch).toEqual({
      counters: { lastXpDay: '2026-12-03', lastXpDayXp: 2, activeDays: 7, masteredWords: 50 },
      badges: { 'mastered-50': { on: '2026-12-03', exact: true } },
    });
  });

  it('records a title on the action that reaches its level, including a card create', () => {
    const keeper = evaluate({ signals: signals({ xpGained: 10 }), before: { verifiedXp: 1_590, streak: 0 }, after: { verifiedXp: 1_600, streak: 0 } });
    expect(keeper.state.titles).toEqual({ 'word-keeper': { on: '2026-12-03', exact: true } });
    const collector = evaluate({
      stored: stored({ titles: { 'word-keeper': { on: '2026-11-27', exact: false } } }),
      before: { verifiedXp: 14_399, streak: 0 }, after: { verifiedXp: 14_401, streak: 0 },
    });
    expect(collector.patch?.titles).toEqual({ 'word-collector': { on: '2026-12-03', exact: true } });
  });

  it('records a held 30-day badge and the 7-day badge as earned by the first day', () => {
    const base = backfilledAchievements('2026-11-27', { verifiedByDay: {}, reviewedCards: 80, masteredWords: 20 });
    const result = evaluate({
      stored: base, rebuilt: true, signals: signals({ studyDay: '2026-11-27' }),
      before: { verifiedXp: 3_000, streak: 30 }, after: { verifiedXp: 3_002, streak: 30 },
    });
    expect(result.state.badges).toMatchObject({
      'streak-7': { on: '2026-11-27', exact: false },
      'web-wanderer': { on: '2026-11-27', exact: false },
    });
  });
});

describe('evaluateAchievements counters', () => {
  it('adds XP on the same day, starts a later day and ignores an earlier day', () => {
    expect(evaluate({ signals: signals({ studyDay: '2026-12-02', xpGained: 40 }) }).state.counters)
      .toMatchObject({ activeDays: 6, lastXpDay: '2026-12-02', lastXpDayXp: 70, bestDayXp: 70 });
    expect(evaluate({ signals: signals({ studyDay: '2026-12-05', xpGained: 5 }) }).state.counters)
      .toMatchObject({ activeDays: 7, lastXpDay: '2026-12-05', lastXpDayXp: 5, bestDayXp: 60 });
    expect(evaluate({ signals: signals({ studyDay: '2026-12-01', xpGained: 500 }) }).state.counters)
      .toMatchObject({ activeDays: 6, lastXpDay: '2026-12-02', lastXpDayXp: 30, bestDayXp: 60 });
  });

  it('counts first reviews, first Easy ratings, late reviews and spelling answers', () => {
    expect(evaluate({ signals: signals({ firstReview: true, firstEasy: true, lateReview: true, correctAnswers: 7 }) }).state.counters)
      .toMatchObject({ reviewedCards: 1, masteredWords: 1, lateReviews: 1, spellingCorrect: 7 });
    expect(evaluate({ signals: signals({ correctAnswers: -3 }) }).state.counters.spellingCorrect).toBe(0);
  });

  it('writes nothing when an action changes no counter and meets nothing new', () => {
    expect(evaluate({ signals: signals({ xpGained: 0 }), after: { verifiedXp: 100, streak: 1 } }).patch).toBeUndefined();
  });

  it('never removes or changes a record, keeps unknown ids and never lowers the catalog version', () => {
    const records = {
      ...earned,
      'first-review': { on: '2026-11-01', exact: true },
      'from-a-newer-catalog': { on: '2026-11-02', exact: true },
    };
    const result = evaluate({
      stored: stored({ catalogVersion: 3, badges: records }),
      signals: signals({ firstReview: true }),
    });
    expect(result.state.catalogVersion).toBe(3);
    expect(result.state.badges).toEqual(records);
    expect(result.patch).not.toHaveProperty('catalogVersion');
    expect(result.patch).not.toHaveProperty('badges');
  });

  it('writes every field of a rebuilt record and never an empty map', () => {
    const base = backfilledAchievements('2026-12-03', { verifiedByDay: null, reviewedCards: 0, masteredWords: 0 },
      { badges: { 'xp-500': { on: '2026-11-01', exact: true } }, titles: {} }, 4);
    const result = evaluate({ stored: base, rebuilt: true, signals: signals({ xpGained: 0 }), after: { verifiedXp: 100, streak: 1 } });
    expect(result.patch).toEqual({
      catalogVersion: 4, recordingStartedOn: '2026-12-03', counters: zeroAchievementCounters(),
      badges: { 'xp-500': { on: '2026-11-01', exact: true } },
    });
    expect(parseAchievements(result.patch)).toEqual(result.state);
  });
});

describe('isLateHour', () => {
  it('covers 22:00 until 04:00 local time', () => {
    expect(isLateHour(new Date('2026-11-27T15:00:00.000Z'), 'Asia/Ho_Chi_Minh')).toBe(true);
    expect(isLateHour(new Date('2026-11-27T20:59:59.000Z'), 'Asia/Ho_Chi_Minh')).toBe(true);
    expect(isLateHour(new Date('2026-11-27T21:00:00.000Z'), 'Asia/Ho_Chi_Minh')).toBe(false);
    expect(isLateHour(new Date('2026-11-27T14:59:59.000Z'), 'Asia/Ho_Chi_Minh')).toBe(false);
  });

  it('follows a daylight saving change', () => {
    // 08:30 UTC is 03:30 in New York in winter and 04:30 once summer time starts on 8 March 2026.
    expect(isLateHour(new Date('2026-03-07T08:30:00.000Z'), 'America/New_York')).toBe(true);
    expect(isLateHour(new Date('2026-03-09T08:30:00.000Z'), 'America/New_York')).toBe(false);
  });
});
