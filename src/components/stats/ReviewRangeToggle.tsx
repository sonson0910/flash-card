import { Trans, useLingui } from '@lingui/react';
import { msg } from '@lingui/core/macro';

export type ReviewRangeDays = 30 | 182;

interface ReviewRangeToggleProps {
  readonly value: ReviewRangeDays;
  readonly onChange: (days: ReviewRangeDays) => void;
  readonly className?: string;
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

/** The range switch for the review activity heatmap and its totals. */
export function ReviewRangeToggle({ value, onChange, className }: ReviewRangeToggleProps) {
  const { _ } = useLingui();
  return <div className={className ? `stats-range ${className}` : 'stats-range'} role="group" aria-label={_(msg({ id: 'stats.heatmap-title', message: 'Review activity' }))}>
    <button type="button" onClick={() => onChange(30)} aria-pressed={value === 30} className={buttonClass}><span><Trans {...msg({ context: 'stats.review-range-30-days', message: '30 days' })} /></span></button>
    <button type="button" onClick={() => onChange(182)} aria-pressed={value === 182} className={buttonClass}><span><Trans {...msg({ context: 'stats.review-range-26-weeks', message: '26 weeks' })} /></span></button>
  </div>;
}
