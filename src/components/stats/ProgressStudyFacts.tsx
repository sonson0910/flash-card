import { useMemo } from 'react';
import { Trans, useLingui } from '@lingui/react';
import { msg } from '@lingui/core/macro';
import { formatNumber } from '../../lib/format';
import { useVerifiedStats } from './VerifiedStatsContext';
import { buildProgressStudyFacts, formatBoardDate, hoursAndMinutes, type ProgressStudyFacts } from './studyFacts';
import './stats-board.css';

/** The Progress study facts for the signed-in learner, or null without verified stats. */
export function useProgressStudyFacts(): ProgressStudyFacts | null {
  const source = useVerifiedStats();
  const state = source?.state ?? null;
  return useMemo(() => (state ? buildProgressStudyFacts(state, new Date()) : null), [state]);
}

/** "14 h 20 m" or "20 m": the Progress board's studied duration. */
export function studiedDurationText(_: ReturnType<typeof useLingui>['_'], ms: number): string {
  const { hours, minutes } = hoursAndMinutes(ms);
  return hours > 0
    ? _(msg({ id: 'stats.duration.hours-minutes', message: '{hours} h {minutes} m' }), { hours: formatNumber(hours), minutes: formatNumber(minutes) })
    : _(msg({ id: 'stats.duration.minutes', message: '{minutes} m' }), { minutes: formatNumber(minutes) });
}

/**
 * "Learning since 2 June 2026" as the first part of the Progress subtitle (classic), or
 * " // since 2 Jun 2026" after the Crystal "Study diary" kicker. Renders nothing before the
 * first verified XP day.
 */
export function ProgressLearningSince({ variant }: { readonly variant: 'subtitle' | 'kicker' }) {
  const { i18n } = useLingui();
  const facts = useProgressStudyFacts();
  if (!facts?.learningSince) return null;
  const locale = i18n.locale || 'en';
  if (variant === 'kicker') {
    const date = formatBoardDate(facts.learningSince, locale, { day: 'numeric', month: 'short', year: 'numeric' });
    return <><span className="progress-learning-since-sep" aria-hidden="true"> // </span><span data-progress-learning-since="kicker"><Trans {...msg({ context: 'progress.learning-since.kicker', message: 'since {date}' })} values={{ date }} /></span></>;
  }
  const date = formatBoardDate(facts.learningSince, locale, { day: 'numeric', month: 'long', year: 'numeric' });
  return <><span className="progress-board-stat" data-progress-learning-since="subtitle"><Trans {...msg({ context: 'progress.learning-since', message: 'Learning since {date}' })} values={{ date }} /></span><span className="progress-board-dot"> · </span></>;
}

/**
 * " · 14 h 20 m studied" as the last part of the Progress subtitle. Study time is account-wide;
 * an account that studied before counting began reads "studied since 26 Nov". Renders nothing
 * before a full minute is counted.
 */
export function ProgressStudiedTime() {
  const { _, i18n } = useLingui();
  const facts = useProgressStudyFacts();
  if (!facts?.studied) return null;
  const duration = studiedDurationText(_, facts.studied.totalMs);
  const strong = <strong className="progress-studied-value" />;
  const since = facts.studied.since ? formatBoardDate(facts.studied.since, i18n.locale || 'en', { day: 'numeric', month: 'short' }) : null;
  return <><span className="progress-board-dot"> · </span><span className="progress-board-stat" data-progress-studied="">{since
    ? <Trans {...msg({ context: 'progress.studied-since', message: '<0>{duration}</0> studied since {date}' })} values={{ duration, date: since }} components={{ 0: strong }} />
    : <Trans {...msg({ context: 'progress.studied', message: '<0>{duration}</0> studied' })} values={{ duration }} components={{ 0: strong }} />}</span></>;
}

export const studyPaceText = {
  label: msg({ id: 'stats.study-pace.label', message: 'Study pace' }),
  value: msg({ id: 'stats.study-pace.value', message: '{minutes} min a day' }),
  hint: msg({ id: 'stats.study-pace.hint', message: 'Average on days you studied, last 4 weeks' }),
};

/**
 * The learner's own pace, which stands in for the board's percentile: "{n} min a day" from at
 * least three study days in the last four weeks, "—" with fewer, nothing before study time is
 * counted. Rendered as one fact of a description list.
 */
export function StudyPaceFact({ className }: { readonly className?: string }) {
  const { _ } = useLingui();
  const facts = useProgressStudyFacts();
  if (!facts || facts.dailyMinutes === undefined) return null;
  return <div className={className} data-study-pace="" title={_(studyPaceText.hint)}>
    <dt>{_(studyPaceText.label)}</dt>
    <dd>{facts.dailyMinutes === null ? '—' : _(studyPaceText.value, { minutes: formatNumber(facts.dailyMinutes) })}</dd>
  </div>;
}
