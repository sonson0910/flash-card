/**
 * Small, pure derivations for the Today screen. Every value comes from data the
 * learner already has (plan counts, XP, streak, goals); nothing is invented.
 */

import { shiftStudyDay, weekStartOf } from '../../../functions/src/study-day-rules';
import type { WordWeeksV1 } from '../../../functions/src/word-week-rules';
import { MATCH_WIN_XP, REVIEW_CARD_XP } from '../../../functions/src/xp-rules';
import type { ReviewActivity } from '../gamification/verifiedGamificationClient';

export type TodayStageId = 'review' | 'new' | 'match' | 'recap';

export interface TodayStageFact {
  readonly id: TodayStageId;
  readonly count: number;
  readonly skipped: boolean;
}

/** Review needs one recall; a new word needs an introduction plus a recall. */
const SECONDS_PER_REVIEW_CARD = 20;
const SECONDS_PER_NEW_CARD = 40;

/** Rounded-up minutes for one stage; Match is a one-minute round and Recap a one-minute summary. */
export const stageMinutes = (stage: TodayStageFact): number => {
  if (stage.skipped) return 0;
  if (stage.id === 'review') return Math.max(1, Math.ceil((stage.count * SECONDS_PER_REVIEW_CARD) / 60));
  if (stage.id === 'new') return Math.max(1, Math.ceil((stage.count * SECONDS_PER_NEW_CARD) / 60));
  return 1;
};

export const sessionMinutes = (stages: readonly TodayStageFact[]): number =>
  stages.reduce((total, stage) => total + stageMinutes(stage), 0);

export type DayPeriod = 'morning' | 'afternoon' | 'evening';

export const dayPeriod = (now: Date): DayPeriod => {
  const hour = now.getHours();
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 18) return 'afternoon';
  return 'evening';
};

/** ISO-8601 week number of the local calendar date. */
export const isoWeekNumber = (now: Date): number => {
  const date = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  const weekday = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - weekday);
  const yearStart = Date.UTC(date.getUTCFullYear(), 0, 1);
  return Math.ceil(((date.getTime() - yearStart) / 86_400_000 + 1) / 7);
};

/** Whole local days from today until an ISO `yyyy-mm-dd` date; null for an invalid or past date. */
export const daysUntil = (isoDate: string, now: Date): number | null => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) return null;
  const target = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.round((target - today) / 86_400_000);
  return Number.isFinite(days) && days >= 0 ? days : null;
};

/** Matches the verified gamification curve: level = floor(sqrt(xp / 100)) + 1. */
export const levelProgress = (xp: number) => {
  const safeXp = Number.isFinite(xp) && xp > 0 ? Math.floor(xp) : 0;
  const level = Math.floor(Math.sqrt(safeXp / 100)) + 1;
  const start = 100 * (level - 1) ** 2;
  const next = 100 * level ** 2;
  return { level, xp: safeXp, start, next, remaining: next - safeXp, percent: Math.round(((safeXp - start) / (next - start)) * 100) };
};

/**
 * Sessions to the next level, from the average XP of recent study days. Null
 * without enough history to say anything honest.
 */
export const sessionsToNextLevel = (remainingXp: number, history: readonly { readonly XP: number }[]): number | null => {
  const studyDays = history.slice(-14).map(day => day.XP).filter(xp => Number.isFinite(xp) && xp > 0);
  if (studyDays.length < 2 || remainingXp <= 0) return null;
  const average = studyDays.reduce((total, xp) => total + xp, 0) / studyDays.length;
  return Math.max(1, Math.ceil(remainingXp / average));
};

/** Most XP the planned session can award; a card already reviewed today earns nothing again. */
export const sessionXpCeiling = (stages: readonly TodayStageFact[]): number => stages.reduce((total, stage) => {
  if (stage.skipped) return total;
  if (stage.id === 'review' || stage.id === 'new') return total + stage.count * REVIEW_CARD_XP;
  if (stage.id === 'match') return total + MATCH_WIN_XP;
  return total;
}, 0);

const previousIsoDay = (isoDay: string): string => {
  const [year, month, day] = isoDay.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day - 1)).toISOString().slice(0, 10);
};

export interface StudyRun {
  readonly studiedToday: boolean;
  /** Consecutive study days ending today (when studied) or yesterday. */
  readonly days: number;
}

/**
 * Reads the current run of study days from the verified per-day XP history. `evidencedStreak`
 * is the server's streak once today is evidenced (0 otherwise); it wins over the history count
 * because the stored history may not reach back to the start of the run, and the streak chip
 * shows that same number.
 */
export const studyRun = (
  history: readonly { readonly date: string; readonly XP: number }[],
  todayIso: string,
  evidencedStreak = 0,
): StudyRun => {
  const studied = new Set(history.filter(entry => entry.XP > 0).map(entry => entry.date));
  const studiedToday = studied.has(todayIso);
  let cursor = studiedToday ? todayIso : previousIsoDay(todayIso);
  let days = 0;
  while (studied.has(cursor) && days < studied.size) {
    days += 1;
    cursor = previousIsoDay(cursor);
  }
  return { studiedToday, days: studiedToday ? Math.max(days, evidencedStreak) : days };
};

/** "Day N" of the run: today counts once the learner has studied, otherwise finishing today makes it the next day. */
export const runDayNumber = (run: StudyRun): number => run.studiedToday ? Math.max(1, run.days) : run.days + 1;

export type StudyWeekDayState = 'done' | 'missed' | 'today' | 'future';

export interface StudyWeekDay {
  /** Calendar day in the reward time zone, `yyyy-mm-dd`. */
  readonly date: string;
  readonly state: StudyWeekDayState;
  readonly isToday: boolean;
  /** Verified XP recorded for the day; 0 when the history has no entry. */
  readonly xp: number;
}

const shiftIsoDay = (isoDay: string, days: number): string => {
  const [year, month, day] = isoDay.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
};

/** Older history snapshots key a day by `Date#toDateString()`; newer ones use an ISO date. */
const historyDayKey = (value: string): string => {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}-${String(parsed.getDate()).padStart(2, '0')}`;
};

/**
 * Monday to Sunday of the week holding `todayIso`. A day is `done` when the verified history
 * has XP for it or it falls inside the current run (the run can reach further back than the
 * stored history); an earlier day without study is `missed`, and later days are `future`.
 */
export const studyWeek = (
  history: readonly { readonly date: string; readonly XP: number }[],
  todayIso: string,
  run: StudyRun,
): StudyWeekDay[] => {
  const xpByDay = new Map<string, number>();
  for (const entry of history) {
    if (!Number.isFinite(entry.XP) || entry.XP <= 0) continue;
    const key = historyDayKey(entry.date);
    xpByDay.set(key, (xpByDay.get(key) ?? 0) + entry.XP);
  }
  const runEnd = run.studiedToday ? todayIso : shiftIsoDay(todayIso, -1);
  const runStart = run.days > 0 ? shiftIsoDay(runEnd, 1 - run.days) : null;
  const [year, month, day] = todayIso.split('-').map(Number);
  const mondayOffset = (new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % 7;
  return Array.from({ length: 7 }, (_, index) => {
    const date = shiftIsoDay(todayIso, index - mondayOffset);
    const xp = xpByDay.get(date) ?? 0;
    const inRun = runStart !== null && date >= runStart && date <= runEnd;
    const isToday = index === mondayOffset;
    const state: StudyWeekDayState = xp > 0 || inRun ? 'done' : isToday ? 'today' : index < mondayOffset ? 'missed' : 'future';
    return { date, state, isToday, xp };
  });
};

/** Longest display name the greeting and Lumi's bubble can hold without wrapping the heading. */
const GREETING_NAME_MAX = 24;

/**
 * The learner's display name for a greeting, or null when there is none or it is too long to
 * greet by. The whole name is kept: name order differs by culture, so no "first name" is guessed.
 */
export const greetingName = (name: string | undefined): string | null => {
  const trimmed = name?.trim();
  if (!trimmed) return null;
  return [...trimmed].length <= GREETING_NAME_MAX ? trimmed : null;
};

/** Reviews, new words, recall and XP over the days of the current streak run. */
export interface StreakRunStats {
  /** Reviews over the run; null when the review counters do not hold the whole run. */
  readonly reviews: number | null;
  /** Cards reviewed for the first time over the run; null when the word counts do not hold the whole run. */
  readonly newWords: number | null;
  /** Share of graded reviews not rated Again, in percent; null when nothing graded was counted. */
  readonly recallPercent: number | null;
  /** Verified XP over the run; null when the XP history starts after the run did. */
  readonly xp: number | null;
}

/** The server keeps this many days of review counters per language. */
const REVIEW_COUNTER_DAYS = 182;

/**
 * Totals for the run that ends on `today`. A total is left out when the server's counters do not
 * hold every day of the run: they started after it, or the oldest days were already dropped (review
 * counters keep 182 days, word counts keep the previous and the current week). The first day of a
 * run is a study day and a day's first review always earns XP, so the XP history holds the whole
 * run exactly when it has XP on that day. Null when no total is known.
 */
export const streakRunStats = (
  activityByLanguage: Readonly<Record<string, ReviewActivity>>,
  wordWeeks: WordWeeksV1 | undefined,
  xpByDay: Readonly<Record<string, number>>,
  today: string,
  length: number,
): StreakRunStats | null => {
  if (length < 1) return null;
  const first = shiftStudyDay(today, 1 - length);
  const runDays = Array.from({ length }, (_, offset) => shiftStudyDay(first, offset));
  const activities = Object.values(activityByLanguage);
  const reviewsCovered = length <= REVIEW_COUNTER_DAYS && activities.some(activity => activity.coverageStartedOn <= first);
  let reviews = 0;
  let graded = 0;
  let again = 0;
  if (reviewsCovered) {
    for (const day of runDays) {
      for (const activity of activities) {
        const counters = activity.days[day];
        if (!counters) continue;
        reviews += counters.reviewed;
        graded += counters.again + counters.hard + counters.good + counters.easy;
        again += counters.again;
      }
    }
  }
  const wordsCovered = wordWeeks !== undefined
    && (wordWeeks.fromFirstAction || wordWeeks.coverageStartedOn <= first)
    && first >= shiftStudyDay(weekStartOf(today), -7);
  const newWords = wordsCovered
    ? runDays.reduce((total, day) => total + Object.values(wordWeeks.daysByLanguage)
      .reduce((sum, days) => sum + (days[day]?.started ?? 0), 0), 0)
    : null;
  const xp = (xpByDay[first] ?? 0) > 0
    ? runDays.reduce((total, day) => total + Math.max(0, xpByDay[day] ?? 0), 0)
    : null;
  if (!reviewsCovered && newWords === null && xp === null) return null;
  return {
    reviews: reviewsCovered ? reviews : null,
    newWords,
    recallPercent: reviewsCovered && graded > 0 ? Math.round(((graded - again) / graded) * 100) : null,
    xp,
  };
};

/** Hostname without `www.` for a captured page, or null when the URL cannot be parsed. */
export const sourceSite = (url: string | undefined): string | null => {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, '') || null;
  } catch {
    return null;
  }
};
