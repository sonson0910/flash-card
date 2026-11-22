import { describe, expect, it } from 'vitest';
import {
  dayPeriod,
  daysUntil,
  greetingName,
  isoWeekNumber,
  levelProgress,
  runDayNumber,
  sessionMinutes,
  sessionXpCeiling,
  sessionsToNextLevel,
  sourceSite,
  stageMinutes,
  streakRunStats,
  studyRun,
  studyWeek,
} from './todayScreenFacts';

describe('todayScreenFacts', () => {
  it('estimates whole minutes per stage and skips empty stages', () => {
    expect(stageMinutes({ id: 'review', count: 14, skipped: false })).toBe(5);
    expect(stageMinutes({ id: 'new', count: 6, skipped: false })).toBe(4);
    expect(stageMinutes({ id: 'match', count: 6, skipped: false })).toBe(1);
    expect(stageMinutes({ id: 'recap', count: 0, skipped: false })).toBe(1);
    expect(stageMinutes({ id: 'review', count: 0, skipped: true })).toBe(0);
    expect(sessionMinutes([
      { id: 'review', count: 14, skipped: false },
      { id: 'new', count: 6, skipped: false },
      { id: 'match', count: 6, skipped: false },
      { id: 'recap', count: 0, skipped: false },
    ])).toBe(11);
  });

  it('names the part of the day from the local hour', () => {
    expect(dayPeriod(new Date(2026, 10, 18, 7))).toBe('morning');
    expect(dayPeriod(new Date(2026, 10, 18, 13))).toBe('afternoon');
    expect(dayPeriod(new Date(2026, 10, 18, 22))).toBe('evening');
    expect(dayPeriod(new Date(2026, 10, 18, 2))).toBe('evening');
  });

  it('computes ISO weeks across year boundaries', () => {
    expect(isoWeekNumber(new Date(2026, 8, 15))).toBe(38);
    expect(isoWeekNumber(new Date(2027, 0, 1))).toBe(53);
    expect(isoWeekNumber(new Date(2026, 0, 1))).toBe(1);
  });

  it('counts days until a goal date and ignores invalid or past dates', () => {
    const now = new Date(2026, 10, 18, 9);
    expect(daysUntil('2026-11-20', now)).toBe(2);
    expect(daysUntil('2026-11-18', now)).toBe(0);
    expect(daysUntil('2026-11-01', now)).toBeNull();
    expect(daysUntil('next week', now)).toBeNull();
  });

  it('follows the verified level curve', () => {
    expect(levelProgress(0)).toMatchObject({ level: 1, start: 0, next: 100, remaining: 100, percent: 0 });
    expect(levelProgress(30)).toMatchObject({ level: 1, percent: 30 });
    expect(levelProgress(2_340)).toMatchObject({ level: 5, start: 1_600, next: 2_500, remaining: 160 });
  });

  it('estimates sessions to the next level only with enough study history', () => {
    expect(sessionsToNextLevel(100, [{ XP: 30 }])).toBeNull();
    expect(sessionsToNextLevel(100, [{ XP: 30 }, { XP: 0 }, { XP: 20 }])).toBe(4);
    expect(sessionsToNextLevel(0, [{ XP: 30 }, { XP: 20 }])).toBeNull();
  });

  it('caps the session XP at the server award rules', () => {
    expect(sessionXpCeiling([
      { id: 'review', count: 14, skipped: false },
      { id: 'new', count: 6, skipped: false },
      { id: 'match', count: 6, skipped: false },
      { id: 'recap', count: 0, skipped: false },
    ])).toBe(60);
    expect(sessionXpCeiling([
      { id: 'review', count: 3, skipped: false },
      { id: 'new', count: 0, skipped: true },
      { id: 'match', count: 0, skipped: true },
    ])).toBe(6);
  });

  it('reads the current study run from verified day history', () => {
    const history = [
      { date: '2026-11-14', XP: 10 },
      { date: '2026-11-16', XP: 4 },
      { date: '2026-11-17', XP: 6 },
      { date: '2026-11-18', XP: 0 },
    ];
    expect(studyRun(history, '2026-11-18')).toEqual({ studiedToday: false, days: 2 });
    expect(runDayNumber(studyRun(history, '2026-11-18'))).toBe(3);
    expect(studyRun([...history, { date: '2026-11-18', XP: 2 }], '2026-11-18')).toEqual({ studiedToday: true, days: 3 });
    expect(runDayNumber({ studiedToday: true, days: 3 })).toBe(3);
    expect(studyRun(history, '2026-11-20')).toEqual({ studiedToday: false, days: 0 });
    expect(runDayNumber(studyRun([], '2026-11-20'))).toBe(1);
    expect(studyRun([{ date: '2026-03-01', XP: 1 }, { date: '2026-02-28', XP: 1 }], '2026-03-02').days).toBe(2);
  });

  it('counts the run from the server streak once today is evidenced', () => {
    const onlyToday = [{ date: '2026-11-18', XP: 4 }];
    expect(studyRun(onlyToday, '2026-11-18', 3)).toEqual({ studiedToday: true, days: 3 });
    expect(runDayNumber(studyRun(onlyToday, '2026-11-18', 3))).toBe(3);
    expect(studyRun([{ date: '2026-11-17', XP: 4 }], '2026-11-18', 3)).toEqual({ studiedToday: false, days: 1 });
  });

  it('greets by the whole display name only when it fits', () => {
    expect(greetingName('  Nguyễn Khánh ')).toBe('Nguyễn Khánh');
    expect(greetingName('')).toBeNull();
    expect(greetingName(undefined)).toBeNull();
    expect(greetingName('A display name that is far too long to greet by')).toBeNull();
  });

  it('reads a display hostname from a captured URL', () => {
    expect(sourceSite('https://www.bbc.com/news/article')).toBe('bbc.com');
    expect(sourceSite('not a url')).toBeNull();
    expect(sourceSite(undefined)).toBeNull();
  });
  it('marks the Monday-to-Sunday week from verified XP and the current run', () => {
    // 2026-11-19 is a Thursday.
    const history = [
      { date: '2026-11-16', XP: 12 },
      { date: '2026-11-18', XP: 6 },
      { date: '2026-11-19', XP: 4 },
    ];
    const week = studyWeek(history, '2026-11-19', studyRun(history, '2026-11-19'));
    expect(week.map(day => day.date)).toEqual(['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21', '2026-11-22']);
    expect(week.map(day => day.state)).toEqual(['done', 'missed', 'done', 'done', 'future', 'future', 'future']);
    expect(week.filter(day => day.isToday).map(day => day.date)).toEqual(['2026-11-19']);
    expect(week.reduce((total, day) => total + day.xp, 0)).toBe(22);
  });

  it('keeps today open until the learner studies and trusts the server run over a short history', () => {
    const notYet = studyWeek([{ date: '2026-11-18', XP: 6 }], '2026-11-19', { studiedToday: false, days: 1 });
    expect(notYet.map(day => day.state)).toEqual(['missed', 'missed', 'done', 'today', 'future', 'future', 'future']);
    const longRun = studyWeek([{ date: '2026-11-19', XP: 30 }], '2026-11-19', { studiedToday: true, days: 3 });
    expect(longRun.map(day => day.state)).toEqual(['missed', 'done', 'done', 'done', 'future', 'future', 'future']);
    expect(longRun.map(day => day.xp)).toEqual([0, 0, 0, 30, 0, 0, 0]);
  });

  it('reads legacy day keys and starts the week on Monday for a Sunday', () => {
    const legacy = new Date(2026, 10, 22).toDateString();
    const week = studyWeek([{ date: legacy, XP: 5 }], '2026-11-22', { studiedToday: true, days: 1 });
    expect(week[0].date).toBe('2026-11-16');
    expect(week[6]).toEqual({ date: '2026-11-22', state: 'done', isToday: true, xp: 5 });
  });

  it('totals the streak run only where the server counters hold every day of it', () => {
    const counters = (reviewed: number, again: number, good: number) => ({ reviewed, again, hard: 0, good, easy: 0 });
    const activity = {
      en: { coverageStartedOn: '2026-11-17', days: { '2026-11-16': counters(9, 0, 9), '2026-11-17': counters(10, 2, 8), '2026-11-19': counters(5, 0, 5) } },
      ja: { coverageStartedOn: '2026-11-18', days: { '2026-11-18': counters(5, 1, 4) } },
    };
    const words = (coverageStartedOn: string) => ({
      coverageStartedOn, fromFirstAction: false, bestWeekByLanguage: {}, wordOfWeekByLanguage: {},
      daysByLanguage: { en: { '2026-11-16': { started: 9, mastered: 0 }, '2026-11-17': { started: 4, mastered: 1 } }, ja: { '2026-11-19': { started: 3, mastered: 0 } } },
    });
    const xp = { '2026-11-16': 30, '2026-11-17': 40, '2026-11-18': 10, '2026-11-19': 20 };
    // 2026-11-19 is a Thursday; the word counts keep days from Monday 2026-11-09.
    expect(streakRunStats(activity, words('2026-11-02'), xp, '2026-11-19', 3)).toEqual({ reviews: 20, newWords: 7, recallPercent: 85, xp: 70 });
    expect(streakRunStats(activity, words('2026-11-18'), {}, '2026-11-19', 3)).toEqual({ reviews: 20, newWords: null, recallPercent: 85, xp: null });
    expect(streakRunStats(activity, { ...words('2026-11-18'), fromFirstAction: true }, {}, '2026-11-19', 3)?.newWords).toBe(7);
    expect(streakRunStats({ en: activity.ja }, words('2026-11-02'), { '2026-11-17': 0, '2026-11-18': 10 }, '2026-11-19', 3)).toEqual({ reviews: null, newWords: 7, recallPercent: null, xp: null });
    expect(streakRunStats({ en: activity.ja }, undefined, {}, '2026-11-19', 3)).toBeNull();
    expect(streakRunStats({}, undefined, {}, '2026-11-19', 3)).toBeNull();
    expect(streakRunStats(activity, words('2026-11-02'), xp, '2026-11-19', 0)).toBeNull();
    expect(streakRunStats({ en: { coverageStartedOn: '2026-11-19', days: {} } }, undefined, {}, '2026-11-19', 1)).toEqual({ reviews: 0, newWords: null, recallPercent: null, xp: null });
  });

  it('leaves out totals whose oldest days the server has already dropped', () => {
    const longRun = { en: { coverageStartedOn: '2025-01-01', days: { '2026-11-19': { reviewed: 4, again: 0, hard: 0, good: 4, easy: 0 } } } };
    const words = { coverageStartedOn: '2025-01-01', fromFirstAction: false, bestWeekByLanguage: {}, wordOfWeekByLanguage: {}, daysByLanguage: { en: { '2026-11-19': { started: 2, mastered: 0 } } } };
    // A 30-day run starts before the word counts' two weeks; a 183-day run outlasts the review counters.
    expect(streakRunStats(longRun, words, {}, '2026-11-19', 30)).toEqual({ reviews: 4, newWords: null, recallPercent: 100, xp: null });
    expect(streakRunStats(longRun, words, {}, '2026-11-19', 11)?.newWords).toBe(2);
    expect(streakRunStats(longRun, words, {}, '2026-11-19', 12)?.newWords).toBeNull();
    expect(streakRunStats(longRun, words, {}, '2026-11-19', 182)?.reviews).toBe(4);
    expect(streakRunStats(longRun, words, {}, '2026-11-19', 183)).toBeNull();
  });
});
