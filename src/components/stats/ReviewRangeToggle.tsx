import { useMemo } from 'react';
import { Trans, useLingui } from '@lingui/react';
import { msg } from '@lingui/core/macro';
import { shiftStudyDay } from '../../../functions/src/study-day-rules';
import type { ReviewActivity } from '../../features/gamification/verifiedGamificationClient';
import { useVerifiedStats } from './VerifiedStatsContext';
import { dayInTimeZone } from './ActivityHeatmap';

/** The fixed-length review ranges, in study days ending today. */
export type ReviewRangeDays = 30 | 182;

/**
 * The review range the Progress activity panel reads, all from `stats.reviewActivityV1` for the
 * course language, which the app already holds:
 * - 30: the last 30 study days, today included;
 * - 182: the last 26 weeks;
 * - 'all': every day since review counting began for the language.
 */
export type ReviewRange = ReviewRangeDays | 'all';

/** The server keeps this many days of review activity, today included. */
export const REVIEW_ACTIVITY_RETAINED_DAYS = 182;

interface ReviewRangeToggleProps {
  readonly value: ReviewRange;
  // A method signature, so a page that still stores only the fixed ranges can pass its setter.
  onChange(range: ReviewRange): void;
  readonly className?: string;
  /** Offers "All time"; when omitted, the toggle asks the verified stats of the course language. */
  readonly allTime?: boolean;
}

const buttonClass = 'stats-range-button min-h-11 px-3.5 focus-visible:outline-2 focus-visible:outline-offset-2 motion-reduce:transition-none';

/** Review activity is drawn only with a server time zone that the browser can resolve. */
export function hasReviewRange(data: { readonly reviewActivity?: unknown; readonly rewardTimeZone?: string }): boolean {
  if (!data.reviewActivity || !data.rewardTimeZone) return false;
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: data.rewardTimeZone });
    return true;
  } catch {
    return false;
  }
}

/**
 * The first day of the "All time" range, or null when that range would not be complete: the
 * server trims review activity to the last 182 days, so "All time" is offered only while the day
 * counting began is still inside the kept window.
 */
export function allTimeReviewStart(activity: Pick<ReviewActivity, 'coverageStartedOn'> | undefined, today: string | undefined): string | null {
  if (!activity || !today) return null;
  const oldestKept = shiftStudyDay(today, 1 - REVIEW_ACTIVITY_RETAINED_DAYS);
  return activity.coverageStartedOn >= oldestKept && activity.coverageStartedOn <= today ? activity.coverageStartedOn : null;
}

function useContextAllTime(): boolean {
  const source = useVerifiedStats();
  return useMemo(() => {
    const activity = source?.state?.reviewActivityByLanguage[source.language];
    const timeZone = source?.state?.rewardTimeZone;
    if (!activity || !timeZone) return false;
    try {
      return allTimeReviewStart(activity, dayInTimeZone(new Date(), timeZone)) !== null;
    } catch {
      return false;
    }
  }, [source]);
}

/** The range switch for the review activity heatmap and its totals. */
export function ReviewRangeToggle({ value, onChange, className, allTime }: ReviewRangeToggleProps) {
  const { _ } = useLingui();
  const contextAllTime = useContextAllTime();
  const offersAllTime = allTime ?? contextAllTime;
  const selected = value === 'all' && !offersAllTime ? 182 : value;
  return <div className={className ? `stats-range ${className}` : 'stats-range'} role="group" aria-label={_(msg({ id: 'stats.heatmap-title', message: 'Review activity' }))}>
    <button type="button" onClick={() => onChange(30)} aria-pressed={selected === 30} className={buttonClass}><span><Trans {...msg({ context: 'stats.review-range-30-days', message: '30 days' })} /></span></button>
    <button type="button" onClick={() => onChange(182)} aria-pressed={selected === 182} className={buttonClass}><span><Trans {...msg({ context: 'stats.review-range-26-weeks', message: '26 weeks' })} /></span></button>
    {offersAllTime && <button type="button" onClick={() => onChange('all')} aria-pressed={selected === 'all'} className={buttonClass}><span><Trans {...msg({ context: 'stats.review-range-all-time', message: 'All time' })} /></span></button>}
  </div>;
}
