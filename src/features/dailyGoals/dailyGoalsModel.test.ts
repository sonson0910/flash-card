import { describe, expect, it } from 'vitest';
import * as serverXpRules from '../../../functions/src/xp-rules';
import { sessionXpCeiling } from '../dailyLearning/todayScreenFacts';
import { buildDailyGoals, type DailyGoalsInput } from './dailyGoalsModel';

const HCM = 'Asia/Ho_Chi_Minh';
const now = new Date('2026-11-19T08:00:00.000Z'); // 15:00 on 2026-11-19 in Ho Chi Minh City

const input = (overrides: Partial<DailyGoalsInput> = {}): DailyGoalsInput => ({
  now,
  timeZone: HCM,
  dailyPace: 10,
  planHasMatch: true,
  xpHistory: {},
  streak: 0,
  dailyGoals: { coverageStartedOn: '2026-11-10', days: {} },
  ...overrides,
});

const goal = <Id extends string>(model: ReturnType<typeof buildDailyGoals>, id: Id) => model.goals.find(item => item.id === id);

describe('daily goals model', () => {
  it('shows only the XP amounts the server grants', () => {
    expect(serverXpRules.REVIEW_CARD_XP).toBe(2);
    expect(serverXpRules.MATCH_WIN_XP).toBe(20);
    const model = buildDailyGoals(input({ dailyPace: 15 }));
    expect(goal(model, 'study-cards')).toMatchObject({ cards: 15, xp: 15 * serverXpRules.REVIEW_CARD_XP });
    expect(goal(model, 'win-match')).toMatchObject({ xp: serverXpRules.MATCH_WIN_XP });
    expect(goal(model, 'keep-streak')).not.toHaveProperty('xp');
    expect(model.goals.map(item => item.id)).toEqual(['study-cards', 'win-match', 'keep-streak']);
  });

  it('agrees with the XP amounts the Today session ceiling still keeps locally', () => {
    // The Today screen keeps its own copies of these amounts; this fails if either side drifts.
    expect(sessionXpCeiling([
      { id: 'review', count: 3, skipped: false },
      { id: 'new', count: 2, skipped: false },
      { id: 'match', count: 1, skipped: false },
    ])).toBe(5 * serverXpRules.REVIEW_CARD_XP + serverXpRules.MATCH_WIN_XP);
  });

  it('reads today from the server counters in the reward time zone and caps the bar at the target', () => {
    const model = buildDailyGoals(input({
      dailyGoals: { coverageStartedOn: '2026-11-10', days: { '2026-11-19': { studiedCards: 12, matchWins: 1 }, '2026-11-18': { studiedCards: 3, matchWins: 0 } } },
    }));
    expect(model.studyDay).toBe('2026-11-19');
    expect(goal(model, 'study-cards')?.progress).toEqual({ state: 'counted', done: 10, target: 10, percent: 100 });
    expect(goal(model, 'win-match')?.progress).toEqual({ state: 'counted', done: 1, target: 1, percent: 100 });
    const early = buildDailyGoals(input({
      now: new Date('2026-11-18T18:00:00.000Z'), // 01:00 on 2026-11-19 in Ho Chi Minh City, still the 18th in UTC
      dailyGoals: { coverageStartedOn: '2026-11-10', days: { '2026-11-18': { studiedCards: 3, matchWins: 0 } } },
    }));
    expect(early.studyDay).toBe('2026-11-19');
    expect(goal(early, 'study-cards')?.progress).toMatchObject({ state: 'counted', done: 0 });
  });

  it('shows unknown progress on the first counted day when XP was earned before the counter started', () => {
    const counters = { coverageStartedOn: '2026-11-19', days: { '2026-11-19': { studiedCards: 2, matchWins: 0 } } };
    const uncounted = buildDailyGoals(input({ dailyGoals: counters, xpHistory: { '2026-11-19': 30 } }));
    expect(goal(uncounted, 'study-cards')?.progress).toEqual({ state: 'unknown', target: 10 });
    expect(goal(uncounted, 'win-match')?.progress).toEqual({ state: 'unknown', target: 1 });
    const fullyCounted = buildDailyGoals(input({ dailyGoals: counters, xpHistory: { '2026-11-19': 4 } }));
    expect(goal(fullyCounted, 'study-cards')?.progress).toMatchObject({ state: 'counted', done: 2 });
  });

  it('treats missing counters as zero only when no XP was earned today', () => {
    expect(goal(buildDailyGoals(input({ dailyGoals: undefined })), 'study-cards')?.progress).toMatchObject({ state: 'counted', done: 0 });
    expect(goal(buildDailyGoals(input({ dailyGoals: undefined, xpHistory: { '2026-11-19': 2 } })), 'study-cards')?.progress)
      .toEqual({ state: 'unknown', target: 10 });
    expect(goal(buildDailyGoals(input({ dailyGoals: { coverageStartedOn: '2026-11-20', days: {} } })), 'study-cards')?.progress)
      .toEqual({ state: 'unknown', target: 10 });
  });

  it('offers the match goal only when the plan has a match or one was won', () => {
    expect(goal(buildDailyGoals(input({ planHasMatch: false })), 'win-match')).toBeUndefined();
    const won = buildDailyGoals(input({
      planHasMatch: false,
      dailyGoals: { coverageStartedOn: '2026-11-10', days: { '2026-11-19': { studiedCards: 0, matchWins: 1 } } },
    }));
    expect(goal(won, 'win-match')?.progress).toMatchObject({ done: 1 });
  });

  it('keeps an open streak, completes it after studying today, and starts over when it lapsed', () => {
    expect(goal(buildDailyGoals(input({ streak: 12, lastStudyDay: '2026-11-18' })), 'keep-streak'))
      .toMatchObject({ streakDays: 12, progress: { done: 0, target: 1 } });
    expect(goal(buildDailyGoals(input({ streak: 13, lastStudyDay: '2026-11-19' })), 'keep-streak'))
      .toMatchObject({ streakDays: 13, progress: { done: 1, target: 1 } });
    expect(goal(buildDailyGoals(input({ streak: 12, lastStudyDay: '2026-11-16' })), 'keep-streak'))
      .toMatchObject({ streakDays: 0, progress: { done: 0 } });
    expect(goal(buildDailyGoals(input({ streak: 0, lastStudyDay: undefined })), 'keep-streak'))
      .toMatchObject({ streakDays: 0 });
  });

  it('counts down to the end of the study day', () => {
    expect(buildDailyGoals(input()).resetsIn).toEqual({ hours: 9, minutes: 0 });
  });
});
