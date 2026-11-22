import { buildStreakView } from '../../features/gamification/streakView';
import { buildStudyTimeView } from '../../features/gamification/studyTimeView';
import type { VerifiedGamificationState } from '../../features/gamification/verifiedGamificationClient';

const STUDY_DAY = /^\d{4}-\d{2}-\d{2}$/;
const MINUTE_MS = 60_000;

export interface ProgressStudyFacts {
  /** The first day with verified XP, or null before any. */
  readonly learningSince: string | null;
  /** Account-wide study time; null before a full minute is counted. */
  readonly studied: { readonly totalMs: number; readonly since: string | null } | null;
  /** Rounded minutes a day on the days studied in the recent window: undefined before study time is counted, null without enough days. */
  readonly dailyMinutes: number | null | undefined;
  /** Longest verified run, or null until the server records a run of at least one day. */
  readonly bestStreak: number | null;
}

/** The earliest `verifiedByDayV1` key: XP the server credited, never a device-reported day. */
export function firstVerifiedStudyDay(xpHistory: Readonly<Record<string, number>>): string | null {
  let first: string | null = null;
  for (const [day, xp] of Object.entries(xpHistory)) {
    if (STUDY_DAY.test(day) && xp > 0 && (first === null || day < first)) first = day;
  }
  return first;
}

/** Everything the Progress and Stats surfaces read from the verified state; no extra document. */
export function buildProgressStudyFacts(state: VerifiedGamificationState, now: Date): ProgressStudyFacts {
  const studyTime = buildStudyTimeView(state, now);
  const best = buildStreakView(state, now).best;
  return {
    learningSince: firstVerifiedStudyDay(state.xpHistory),
    studied: studyTime && studyTime.totalMs >= MINUTE_MS
      ? { totalMs: studyTime.totalMs, since: studyTime.fromFirstAction ? null : studyTime.coverageStartedOn }
      : null,
    dailyMinutes: studyTime === null ? undefined : studyTime.dailyAverageMs === null ? null : Math.max(1, Math.round(studyTime.dailyAverageMs / MINUTE_MS)),
    bestStreak: best && best.length > 0 ? best.length : null,
  };
}

/** Whole hours and the remaining whole minutes of a duration. */
export const hoursAndMinutes = (ms: number): { readonly hours: number; readonly minutes: number } => {
  const totalMinutes = Math.floor(Math.max(0, ms) / MINUTE_MS);
  return { hours: Math.floor(totalMinutes / 60), minutes: totalMinutes % 60 };
};

/** Whole minutes and the remaining whole seconds of a duration. */
export const minutesAndSeconds = (ms: number): { readonly minutes: number; readonly seconds: number } => {
  const totalSeconds = Math.floor(Math.max(0, ms) / 1000);
  return { minutes: Math.floor(totalSeconds / 60), seconds: totalSeconds % 60 };
};

/** Minutes the due cards take at the learner's recent pace; null without cards or without a pace. */
export const reviewEstimateMinutes = (count: number, msPerReview: number | null): number | null =>
  count > 0 && msPerReview !== null && msPerReview > 0 ? Math.max(1, Math.round((count * msPerReview) / MINUTE_MS)) : null;

/**
 * The boards write dates day first ("2 June 2026", "16 – 22 Nov"). English takes the British order;
 * every other locale keeps its own.
 */
export const boardDateLocale = (locale: string): string => (!locale || locale === 'pseudo' || locale === 'en' || locale.startsWith('en-') ? 'en-GB' : locale);

const studyDayDate = (day: string): Date => new Date(`${day}T12:00:00Z`);

export const formatBoardDate = (day: string, locale: string, options: Intl.DateTimeFormatOptions): string =>
  new Intl.DateTimeFormat(boardDateLocale(locale), { ...options, timeZone: 'UTC' }).format(studyDayDate(day));

/** "Monday" for a study day, in the UI locale. */
export const formatStudyWeekday = (day: string, locale: string): string =>
  new Intl.DateTimeFormat(boardDateLocale(locale), { weekday: 'long', timeZone: 'UTC' }).format(studyDayDate(day));
