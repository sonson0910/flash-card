/**
 * Weekly recap data model.
 *
 * Read budget: this module performs zero Firestore reads of its own. It only
 * transforms `LibraryStatsViewModel.xpChartData`, the per-day gamification XP
 * history that the app already loads once per session for the streak/XP
 * badges shown elsewhere (Today, Progress, Achievements). Opening the recap
 * never scans a card's `reviewHistory`, and never issues a new query — see
 * the phase report for the full accounting.
 *
 * Because the only bounded source available here is per-day XP totals, this
 * model deliberately does not compute "words reviewed", "words learned" or a
 * recall rate for the week: XP is not a fixed, invertible function of review
 * count (bonuses and rating differ), so backing into a review count from XP
 * would be an invented metric. Those fields are surfaced as unavailable by
 * the caller instead of being guessed here.
 */

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
  readonly hasActivity: boolean;
}

export const WEEKLY_RECAP_WINDOW_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

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

export function computeWeeklyRecap(xpChartData: readonly WeeklyRecapXpChartEntry[], now: Date): WeeklyRecapData {
  const xpByDate = new Map<string, number>();
  for (const entry of xpChartData) {
    if (!Number.isFinite(entry.XP) || entry.XP <= 0) continue;
    const dateKey = normalizeHistoryDateKey(entry.date);
    xpByDate.set(dateKey, (xpByDate.get(dateKey) ?? 0) + entry.XP);
  }
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const days: WeeklyRecapDay[] = [];
  for (let offset = WEEKLY_RECAP_WINDOW_DAYS - 1; offset >= 0; offset -= 1) {
    const date = new Date(today.getTime() - offset * DAY_MS);
    const dateKey = dateKeyFromDate(date);
    days.push({ dateKey, xp: xpByDate.get(dateKey) ?? 0 });
  }
  const totalXp = days.reduce((sum, day) => sum + day.xp, 0);
  const activeDays = days.filter(day => day.xp > 0).length;
  const bestDay = days.reduce<WeeklyRecapDay | null>(
    (best, day) => (day.xp > 0 && (!best || day.xp > best.xp) ? day : best),
    null,
  );
  return {
    rangeStart: days[0].dateKey,
    rangeEnd: days[days.length - 1].dateKey,
    days,
    totalXp,
    activeDays,
    bestDay,
    hasActivity: totalXp > 0,
  };
}
