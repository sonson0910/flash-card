import { shiftStudyDay, weekStartOf } from '../../../functions/src/study-day-rules';
import {
  WEEK_RECALL_MIN_REVIEWS,
  WORD_OF_WEEK_MIN_REVIEWS,
  type BestWordWeek,
  type WordOfWeek,
} from '../../../functions/src/word-week-rules';
import { resolveStudyTimeZone, studyDayInZone } from '../dailyGoals/studyDayCountdown';
import type { VerifiedGamificationState } from './verifiedGamificationClient';

export interface WordWeekDayView {
  readonly day: string;
  readonly started: number;
  readonly mastered: number;
  readonly future: boolean;
}

export interface WeeklyWordsView {
  /** Counting began inside this week, on this day, for an account that already studied before. */
  readonly since: string | null;
  /** Monday to Sunday. */
  readonly days: readonly WordWeekDayView[];
  /** Words reviewed for the first time this week. */
  readonly started: number;
  readonly mastered: number;
  /** Words started last week; null unless last week was fully counted. */
  readonly lastWeekStarted: number | null;
  /** This week minus last week, when last week was fully counted and this week is ahead. */
  readonly aheadOfLastWeek: number | null;
  /** The best complete week counted so far, or null before one exists. */
  readonly best: BestWordWeek | null;
  /** This week has started more words than the best complete week. */
  readonly isBestWeek: boolean;
  /** Best weeks count from this day for accounts that studied before counting began. */
  readonly bestSince: string | null;
  /** The card reviewed most this week, once it has enough reviews to show. */
  readonly wordOfWeek: WordOfWeek | null;
}

export interface WeeklyRecallView {
  /** Graded reviews this week in the course language. */
  readonly graded: number;
  /** Reviews not rated Again: Hard, Good and Easy count as recalled. */
  readonly recalled: number;
  /** Rounded percent, or null until the week has enough graded reviews. */
  readonly percent: number | null;
  /** Recall counting began inside this week, on this day. */
  readonly since: string | null;
}

export interface WordWeekView {
  readonly weekStart: string;
  readonly weekEnd: string;
  readonly today: string;
  /** Null until the server has counted words for this course language. */
  readonly words: WeeklyWordsView | null;
  /** Null without review activity for this course language. */
  readonly recall: WeeklyRecallView | null;
}

/** The Monday week containing `now` in the account's reward time zone, for one course language. */
export function buildWordWeekView(state: VerifiedGamificationState, language: string, now: Date): WordWeekView {
  const today = studyDayInZone(now, resolveStudyTimeZone(state.rewardTimeZone));
  const weekStart = weekStartOf(today);
  const weekEnd = shiftStudyDay(weekStart, 6);
  const lastWeekStart = shiftStudyDay(weekStart, -7);
  const record = state.wordWeeks;
  const days = record?.daysByLanguage[language] ?? {};
  const total = (from: string, to: string, key: 'started' | 'mastered') => Object.entries(days)
    .filter(([day]) => day >= from && day <= to)
    .reduce((sum, [, entry]) => sum + entry[key], 0);
  let words: WeeklyWordsView | null = null;
  if (record) {
    const started = total(weekStart, weekEnd, 'started');
    // A new learner's first week is complete from their first action, as for best weeks.
    const lastWeekCovered = record.coverageStartedOn <= lastWeekStart
      || (record.fromFirstAction && record.coverageStartedOn < weekStart);
    const lastWeekStarted = lastWeekCovered ? total(lastWeekStart, shiftStudyDay(weekStart, -1), 'started') : null;
    const best = record.bestWeekByLanguage[language] ?? null;
    const pick = record.wordOfWeekByLanguage[language]?.[weekStart];
    words = {
      since: record.coverageStartedOn > weekStart && !record.fromFirstAction ? record.coverageStartedOn : null,
      days: Array.from({ length: 7 }, (_, index) => {
        const day = shiftStudyDay(weekStart, index);
        return { day, started: days[day]?.started ?? 0, mastered: days[day]?.mastered ?? 0, future: day > today };
      }),
      started,
      mastered: total(weekStart, weekEnd, 'mastered'),
      lastWeekStarted,
      aheadOfLastWeek: lastWeekStarted !== null && started > lastWeekStarted ? started - lastWeekStarted : null,
      best,
      isBestWeek: best !== null && started > best.started,
      bestSince: record.fromFirstAction ? null : record.coverageStartedOn,
      wordOfWeek: pick && pick.reviews >= WORD_OF_WEEK_MIN_REVIEWS ? pick : null,
    };
  }
  const activity = state.reviewActivityByLanguage[language];
  let recall: WeeklyRecallView | null = null;
  if (activity) {
    const week = Object.entries(activity.days).filter(([day]) => day >= weekStart && day <= weekEnd);
    const graded = week.reduce((sum, [, counters]) => sum + counters.reviewed, 0);
    const recalled = graded - week.reduce((sum, [, counters]) => sum + counters.again, 0);
    recall = {
      graded,
      recalled,
      percent: graded >= WEEK_RECALL_MIN_REVIEWS ? Math.round((recalled / graded) * 100) : null,
      since: activity.coverageStartedOn > weekStart ? activity.coverageStartedOn : null,
    };
  }
  return { weekStart, weekEnd, today, words, recall };
}
