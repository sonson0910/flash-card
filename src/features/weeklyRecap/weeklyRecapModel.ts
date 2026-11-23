/**
 * Weekly recap data model: the Monday week that contains today in the account's reward time zone.
 *
 * Read budget: this module performs zero Firestore reads of its own. It transforms
 * `LibraryStatsViewModel.xpChartData`, the already hydrated `reviewActivityV1` projection and the
 * verified stats state the app already holds (`studyTimeV1`, `wordWeeksV1`, the streak record).
 * Opening the recap never scans a card's `reviewHistory` or issues a new query.
 */

import { shiftStudyDay, weekStartOf } from '../../../functions/src/study-day-rules';
import { resolveStudyTimeZone, studyDayInZone } from '../dailyGoals/studyDayCountdown';
import { buildStreakView } from '../gamification/streakView';
import { buildStudyTimeView } from '../gamification/studyTimeView';
import type { ReviewActivity, VerifiedGamificationState } from '../gamification/verifiedGamificationClient';
import { buildWordWeekView } from '../gamification/wordWeekView';

export interface WeeklyRecapDay {
  /** Calendar day in the reward time zone, `YYYY-MM-DD`. */
  readonly dateKey: string;
  readonly xp: number;
  /** Later than today: drawn empty. */
  readonly future?: boolean;
}

/** Matches `LibraryStatsViewModel['xpChartData']` without importing across feature boundaries. */
export interface WeeklyRecapXpChartEntry {
  readonly date: string;
  readonly XP: number;
}

export interface WeeklyRecapData {
  /** Monday. */
  readonly rangeStart: string;
  /** Sunday. */
  readonly rangeEnd: string;
  /** Exactly 7 entries, Monday to Sunday. */
  readonly days: readonly WeeklyRecapDay[];
  readonly totalXp: number;
  readonly activeDays: number;
  readonly bestDay: WeeklyRecapDay | null;
  /** Null until the authoritative activity projection covers the whole week. */
  readonly reviewedCount?: number | null;
  readonly hasActivity: boolean;
}

export const WEEKLY_RECAP_WINDOW_DAYS = 7;

const dateKeyFromDate = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

/**
 * The stored gamification history keys days by `Date#toDateString()` (legacy
 * snapshots) or an ISO calendar date (current snapshots). Normalize both to
 * the same `YYYY-MM-DD` key this module uses, matching the approach already
 * used by `ActivityHeatmap`.
 */
const normalizeHistoryDateKey = (value: string): string => {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : dateKeyFromDate(parsed);
};

/** Today in the reward time zone; the device zone when none is stored or it is invalid. */
export const weeklyRecapToday = (now: Date, rewardTimeZone?: string | null): string =>
  studyDayInZone(now, resolveStudyTimeZone(rewardTimeZone));

export function computeWeeklyRecap(
  xpChartData: readonly WeeklyRecapXpChartEntry[],
  now: Date,
  reviewActivity?: ReviewActivity,
  rewardTimeZone?: string,
): WeeklyRecapData {
  const xpByDate = new Map<string, number>();
  for (const entry of xpChartData) {
    if (!Number.isFinite(entry.XP) || entry.XP <= 0) continue;
    const dateKey = normalizeHistoryDateKey(entry.date);
    xpByDate.set(dateKey, (xpByDate.get(dateKey) ?? 0) + entry.XP);
  }
  const today = weeklyRecapToday(now, rewardTimeZone);
  const rangeStart = weekStartOf(today);
  const days: WeeklyRecapDay[] = Array.from({ length: WEEKLY_RECAP_WINDOW_DAYS }, (_, index) => {
    const dateKey = shiftStudyDay(rangeStart, index);
    return dateKey > today ? { dateKey, xp: 0, future: true } : { dateKey, xp: xpByDate.get(dateKey) ?? 0 };
  });
  let totalXp = 0;
  let activeDays = 0;
  let bestDay: WeeklyRecapDay | null = null;
  for (const day of days) {
    totalXp += day.xp;
    if (day.xp <= 0) continue;
    activeDays += 1;
    if (!bestDay || day.xp > bestDay.xp) bestDay = day;
  }
  // Review counts are keyed by the persisted zone's days; without it they could fall on the wrong day.
  const zoneKnown = rewardTimeZone !== undefined && resolveStudyTimeZone(rewardTimeZone) === rewardTimeZone;
  const reviewedCount = reviewActivity && zoneKnown && reviewActivity.coverageStartedOn <= rangeStart
    ? days.reduce((sum, day) => sum + (reviewActivity.days[day.dateKey]?.reviewed ?? 0), 0)
    : null;
  return {
    rangeStart,
    rangeEnd: days[days.length - 1].dateKey,
    days,
    totalXp,
    activeDays,
    bestDay,
    reviewedCount,
    hasActivity: totalXp > 0 || (reviewedCount ?? 0) > 0,
  };
}

/** What the recap card and its controls show from the verified stats, for one course language. */
export interface WeeklyRecapStats {
  readonly weekStart: string;
  /** Null until the server counts words for the course language: the card keeps its XP hero. */
  readonly words: {
    readonly started: number;
    readonly mastered: number;
    /** Counting began inside this week, on this day. */
    readonly since: string | null;
  } | null;
  /** This week beats the best complete week; `since` is null when weeks count from the first action. */
  readonly bestWeek: { readonly since: string | null } | null;
  /** Words ahead of last week, when last week was fully counted. */
  readonly aheadOfLastWeek: number | null;
  /** The open streak; null once the run has ended or before it starts. */
  readonly streakDays: number | null;
  /** Null without review activity for the course language; `percent` null below the review minimum. */
  readonly recall: { readonly percent: number | null; readonly since: string | null } | null;
  /** Account-wide time this week; null before study time is counted. */
  readonly studied: { readonly activeMs: number; readonly since: string | null } | null;
  /** The most reviewed card of the week, once it has enough reviews. */
  readonly wordOfWeek: { readonly cardId: string; readonly reviews: number } | null;
}

export function computeWeeklyRecapStats(state: VerifiedGamificationState, language: string, now: Date): WeeklyRecapStats {
  const week = buildWordWeekView(state, language, now);
  const studyTime = buildStudyTimeView(state, now);
  const streak = buildStreakView(state, now);
  const words = week.words;
  return {
    weekStart: week.weekStart,
    words: words ? { started: words.started, mastered: words.mastered, since: words.since } : null,
    bestWeek: words?.isBestWeek ? { since: words.bestSince } : null,
    aheadOfLastWeek: words?.aheadOfLastWeek ?? null,
    streakDays: streak.length > 0 ? streak.length : null,
    recall: week.recall ? { percent: week.recall.percent, since: week.recall.since } : null,
    studied: studyTime ? { activeMs: studyTime.week.activeMs, since: studyTime.week.since } : null,
    wordOfWeek: words?.wordOfWeek ? { cardId: words.wordOfWeek.cardId, reviews: words.wordOfWeek.reviews } : null,
  };
}

/** The card shows study activity when either XP, reviews or new words were counted this week. */
export const weeklyRecapHasActivity = (data: WeeklyRecapData, stats: WeeklyRecapStats | null): boolean =>
  data.hasActivity || (stats?.words?.started ?? 0) > 0;
