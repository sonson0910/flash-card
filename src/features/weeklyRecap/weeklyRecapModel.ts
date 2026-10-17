/**
 * Weekly recap data model.
 *
 * Read budget: this module performs zero Firestore reads of its own. It only
 * transforms `LibraryStatsViewModel.xpChartData` and the already hydrated
 * `reviewActivityV1` projection. Opening the recap never scans a card's
 * `reviewHistory` or issues a new query — see the phase report for accounting.
 *
 * XP cannot yield "words learned" or a recall rate. The review projection
 * supplies a count only after it covers all seven days; no approved formula
 * currently turns its rating buckets into a recall percentage.
 */

import type { ReviewActivity } from '../gamification/verifiedGamificationClient';

export interface WeeklyRecapDay {
  /** Local calendar day, `YYYY-MM-DD`. */
  readonly dateKey: string;
  readonly xp: number;
}

/** Matches `LibraryStatsViewModel['xpChartData']` without importing across feature boundaries. */
export interface WeeklyRecapXpChartEntry {
  readonly date: string;
  readonly XP: number;
}

export interface WeeklyRecapData {
  readonly rangeStart: string;
  readonly rangeEnd: string;
  /** Exactly 7 entries, oldest first, ending on `rangeEnd`. */
  readonly days: readonly WeeklyRecapDay[];
  readonly totalXp: number;
  readonly activeDays: number;
  readonly bestDay: WeeklyRecapDay | null;
  /** Null until the authoritative activity projection covers the full week. */
  readonly reviewedCount?: number | null;
  readonly hasActivity: boolean;
}

export const WEEKLY_RECAP_WINDOW_DAYS = 7;

const dateKeyFromDate = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

const dateKeyInTimeZone = (date: Date, timeZone: string): string | null => {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
    const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
  } catch {
    return null;
  }
};

const sevenDaysEndingOn = (todayKey: string): WeeklyRecapDay[] => Array.from({ length: WEEKLY_RECAP_WINDOW_DAYS }, (_, index) => {
  const date = new Date(`${todayKey}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - (WEEKLY_RECAP_WINDOW_DAYS - 1 - index));
  return { dateKey: date.toISOString().slice(0, 10), xp: 0 };
});

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
  const zonedTodayKey = rewardTimeZone ? dateKeyInTimeZone(now, rewardTimeZone) : null;
  const days = sevenDaysEndingOn(zonedTodayKey ?? dateKeyFromDate(now)).map(day => ({ ...day, xp: xpByDate.get(day.dateKey) ?? 0 }));
  let totalXp = 0;
  let activeDays = 0;
  let bestDay: WeeklyRecapDay | null = null;
  for (const day of days) {
    totalXp += day.xp;
    if (day.xp <= 0) continue;
    activeDays += 1;
    if (!bestDay || day.xp > bestDay.xp) bestDay = day;
  }
  const rangeStart = days[0].dateKey;
  const reviewedCount = reviewActivity && zonedTodayKey && reviewActivity.coverageStartedOn <= rangeStart
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
