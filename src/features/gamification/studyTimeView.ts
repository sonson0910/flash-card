import type { StudyTimeDay } from '../../../functions/src/study-time-rules';
import { shiftStudyDay, weekStartOf } from '../../../functions/src/study-day-rules';
import { resolveStudyTimeZone, studyDayInZone } from '../dailyGoals/studyDayCountdown';
import type { VerifiedGamificationState } from './verifiedGamificationClient';

/** The pace estimate needs at least this many timed reviews in the recent window. */
export const STUDY_PACE_MIN_TIMED_REVIEWS = 20;
/** The daily average needs at least this many study days in the recent window. */
export const STUDY_AVERAGE_MIN_DAYS = 3;
/** The recent window, in study days ending today. */
export const STUDY_RECENT_DAYS = 28;

export interface StudyTimeWeekView {
  readonly weekStart: string;
  readonly activeMs: number;
  readonly reviewMs: number;
  readonly timedReviews: number;
  /** Counting began inside this week, on this day; the totals cover only part of the week. */
  readonly since: string | null;
}

export interface StudyTimeView {
  readonly coverageStartedOn: string;
  /** Totals are lifetime totals; otherwise they count from `coverageStartedOn`. */
  readonly fromFirstAction: boolean;
  readonly totalMs: number;
  readonly today: StudyTimeDay;
  readonly week: StudyTimeWeekView;
  /** Average review time from the recent window, or null without enough timed reviews. */
  readonly msPerReview: number | null;
  /** Average study time on the days studied in the recent window, or null without enough days. */
  readonly dailyAverageMs: number | null;
}

const zeroDay: StudyTimeDay = Object.freeze({ activeMs: 0, reviewMs: 0, timedReviews: 0 });

/** Study time surfaces: today, this Monday week, lifetime and recent pace. Null before any counting. */
export function buildStudyTimeView(state: VerifiedGamificationState, now: Date): StudyTimeView | null {
  const record = state.studyTime;
  if (!record) return null;
  const today = studyDayInZone(now, resolveStudyTimeZone(state.rewardTimeZone));
  const weekStart = weekStartOf(today);
  const recentStart = shiftStudyDay(today, 1 - STUDY_RECENT_DAYS);
  const sum = (from: string) => Object.entries(record.days)
    .filter(([day]) => day >= from && day <= today)
    .reduce((total, [, entry]) => ({
      activeMs: total.activeMs + entry.activeMs,
      reviewMs: total.reviewMs + entry.reviewMs,
      timedReviews: total.timedReviews + entry.timedReviews,
      days: total.days + (entry.activeMs > 0 ? 1 : 0),
    }), { activeMs: 0, reviewMs: 0, timedReviews: 0, days: 0 });
  const week = sum(weekStart);
  const recent = sum(recentStart);
  return {
    coverageStartedOn: record.coverageStartedOn,
    fromFirstAction: record.fromFirstAction,
    totalMs: record.totalMs,
    today: record.days[today] ?? zeroDay,
    week: {
      weekStart,
      activeMs: week.activeMs,
      reviewMs: week.reviewMs,
      timedReviews: week.timedReviews,
      since: record.coverageStartedOn > weekStart && !record.fromFirstAction ? record.coverageStartedOn : null,
    },
    msPerReview: recent.timedReviews >= STUDY_PACE_MIN_TIMED_REVIEWS
      ? Math.round(recent.reviewMs / recent.timedReviews) : null,
    dailyAverageMs: recent.days >= STUDY_AVERAGE_MIN_DAYS ? Math.round(recent.activeMs / recent.days) : null,
  };
}
