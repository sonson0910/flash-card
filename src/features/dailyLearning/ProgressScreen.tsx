import { useLayoutEffect, type ReactNode } from 'react';
import { i18n } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import { Trans } from '@lingui/react';
import { CountUp } from '../../components/motion/CountUp';
import { Lumi } from '../../components/lumi/Lumi';
import { useTheme } from '../theme/ThemeProvider';
import { readLumiEnabled } from '../settings/lumi-preference';
import { ReviewRangeToggle } from '../../components/stats/ReviewRangeToggle';
import { GhostHeatmap, HeatmapLegend } from '../../components/stats/ActivityHeatmap';
import { useVerifiedStats } from '../../components/stats/VerifiedStatsContext';
import { resolveStudyTimeZone } from '../dailyGoals/studyDayCountdown';
import { ProgressLearningSince, ProgressStudiedTime } from '../../components/stats/ProgressStudyFacts';
import './daily-learning-canvas.css';
import '../../components/stats/stats-board.css';
import './progress-screen.css';
import type { ProgressScreenProps } from './dailyLearningPresentation';

const primaryClass = 'progress-board-cta brand-action crystal-chamfer min-h-11 px-6 py-3 font-extrabold transition duration-200 active:scale-[.98] focus-visible:outline-2 focus-visible:outline-offset-2 motion-reduce:transition-none cursor-pointer';

function ProgressHeading({ model, isCrystal }: Pick<ProgressScreenProps, 'model'> & { readonly isCrystal: boolean }) {
  const assignHeading = (heading: HTMLHeadingElement | null) => {
    if (model.headingRef) model.headingRef.current = heading;
  };
  return <h1 id="daily-progress-heading" ref={assignHeading} tabIndex={-1} className={`progress-board-title${!isCrystal ? ' fx-title' : ''} text-balance focus-visible:outline-2`}><Trans {...msg({ context: 'progress.title', message: 'Progress' })} /></h1>;
}

function Metric({ label, value, tone }: { readonly label: React.ReactNode; readonly value: number | null; readonly tone: string }) {
  return <div className="progress-metric crystal-chamfer-sm min-w-0 p-4"><dt className="progress-metric-label">{label}</dt><dd className={`progress-metric-value mt-2 tabular-nums ${tone}`}>{value === null ? '—' : <CountUp to={value} />}</dd></div>;
}

function LumiLink({ model }: Pick<ProgressScreenProps, 'model'>) {
  const message = model.status === 'ready' && model.dueToday !== null && model.dueToday > 0
    ? <Trans {...msg({ context: 'progress.lumi.due', message: '{count, plural, one {# word is} other {# words are}} due today. Let’s keep them blooming!' })} values={{ count: model.dueToday }} />
    : model.status === 'ready' && model.dueToday === 0
      ? <Trans {...msg({ context: 'progress.lumi.clear', message: 'Nothing due right now. Your words are blooming!' })} />
      : <Trans {...msg({ context: 'progress.lumi.start', message: 'Every review helps your words bloom.' })} />;
  return <div className="progress-board-lumi">
    <Lumi pose="proud" className="progress-board-lumi-figure motion-reduce:animate-none" />
    <p className="progress-board-lumi-bubble"><span className="progress-board-lumi-name"><Trans {...msg({ context: 'progress.lumi.link', message: 'Lumi · Link' })} /></span><span className="progress-board-lumi-message">{message}</span></p>
  </div>;
}

function EmptyAction({ model, actions }: Omit<ProgressScreenProps, 'children'>) {
  return <button type="button" data-primary-learning-action="true" disabled={model.isOffline && model.hasVocabulary} onClick={model.hasVocabulary ? actions.startReview : actions.openVocabulary} className={`${primaryClass} w-full sm:w-auto`}><span className="progress-board-cta-label">{model.hasVocabulary ? <Trans {...msg({ context: 'progress.start-review', message: 'Start your first review' })} /> : <Trans {...msg({ context: 'progress.add-vocabulary', message: 'Add vocabulary' })} />}</span></button>;
}

/** Crystal before the first review: the board's activity panel with every day at rest, and the first step written
    across it. The zero counters of the plain summary are left out; the grid already says there is nothing yet. */
function EmptyActivity({ model, actions }: Omit<ProgressScreenProps, 'children'>) {
  const timeZone = resolveStudyTimeZone(useVerifiedStats()?.state?.rewardTimeZone);
  return <section aria-labelledby="progress-summary-heading" className="progress-summary progress-summary--ghost stats-panel stats-activity crystal-chamfer relative min-w-0 overflow-hidden">
    <div className="stats-panel-head"><p className="stats-panel-title"><Trans {...msg({ id: 'stats.activity-title', message: 'Activity' })} /></p><span className="stats-panel-note"><Trans {...msg({ id: 'stats.activity-note-26-weeks', message: 'Reviews per day, last 26 weeks' })} /></span><HeatmapLegend /></div>
    <div className="progress-ghost-stage">
      <GhostHeatmap timeZone={timeZone} />
      <div className="progress-ghost-call">
        <h2 id="progress-summary-heading" className="progress-ghost-heading text-balance"><Trans {...msg({ context: 'progress.empty.title', message: 'Your learning story starts here' })} /></h2>
        <p className="progress-summary-copy text-pretty"><Trans {...msg({ context: 'progress.empty.description', message: 'Complete a review to begin your progress history.' })} /></p>
        <EmptyAction model={model} actions={actions} />
      </div>
    </div>
  </section>;
}

function Summary({ model, actions }: Omit<ProgressScreenProps, 'children'>) {
  const title = model.status === 'empty' ? <Trans {...msg({ context: 'progress.empty.title', message: 'Your learning story starts here' })} /> : model.status === 'loading' || model.dueToday === null ? <Trans {...msg({ context: 'progress.loading.title', message: 'Your saved progress' })} /> : model.dueToday > 0 ? <Trans {...msg({ context: 'progress.due.title', message: 'Keep today’s memory work moving' })} /> : <Trans {...msg({ context: 'progress.clear.title', message: 'Your scheduled review is clear' })} />;
  return <section aria-labelledby="progress-summary-heading" className="progress-summary stats-panel crystal-chamfer relative overflow-hidden p-6 sm:p-7">
    <div className="relative grid gap-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end"><div className="min-w-0"><h2 id="progress-summary-heading" className="stats-panel-title text-balance">{title}</h2><p className="progress-summary-copy mt-2 max-w-2xl text-pretty" role={model.status === 'loading' ? 'status' : undefined} aria-live={model.status === 'loading' ? 'polite' : undefined}>{model.status === 'empty' ? <Trans {...msg({ context: 'progress.empty.description', message: 'Complete a review to begin your progress history.' })} /> : model.message}</p></div>
      {model.status === 'ready' && model.dueToday !== null && model.dueToday > 0 && <button type="button" data-primary-learning-action="true" disabled={model.isOffline} onClick={actions.startReview} className={`${primaryClass} w-full sm:w-auto`}><span className="progress-board-cta-label"><Trans {...msg({ context: 'progress.review-due', message: 'Review {count, plural, one {# due word} other {# due words}}' })} values={{ count: model.dueToday }} /></span></button>}
      {model.status === 'empty' && <EmptyAction model={model} actions={actions} />}</div>
    <div className="progress-summary-evidence relative mt-6 pt-5"><p className="progress-summary-kicker"><Trans {...msg({ context: 'progress.evidence', message: 'Supporting evidence' })} /></p><dl data-progress-evidence="true" className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3"><Metric label={<Trans {...msg({ context: 'progress.metric.reviewed', message: 'Reviewed' })} />} value={model.reviewed} tone="progress-metric-value--plain" /><Metric label={<Trans {...msg({ context: 'progress.metric.mastered', message: 'Mastered' })} />} value={model.mastered} tone="progress-metric-value--reward" /><Metric label={<Trans {...msg({ context: 'progress.metric.due', message: 'Due today' })} />} value={model.dueToday} tone="progress-metric-value--brand" /></dl></div>
  </section>;
}

function Subtitle({ model, isCrystal }: Pick<ProgressScreenProps, 'model'> & { readonly isCrystal: boolean }) {
  if (model.status !== 'ready' || model.reviewed === null) return null;
  return <p className={`progress-board-subtitle${!isCrystal ? ' fx-enter' : ''}`}>
    {!isCrystal && <ProgressLearningSince variant="subtitle" />}
    <span className="progress-board-stat"><Trans {...msg({ context: 'progress.subtitle.reviewed', message: '{count, plural, one {<0>#</0> card reviewed} other {<0>#</0> cards reviewed}}' })} values={{ count: model.reviewed }} components={{ 0: <strong /> }} /></span>
    {model.mastered !== null && <><span className="progress-board-dot"> · </span><span className="progress-board-stat"><Trans {...msg({ context: 'progress.subtitle.mastered', message: '<0>{count}</0> mastered' })} values={{ count: model.mastered }} components={{ 0: <strong /> }} /></span></>}
    <ProgressStudiedTime />
  </p>;
}

interface ProgressScreenViewProps extends ProgressScreenProps {
  /** Drawn beside the Crystal empty activity panel, in the board's side column (the mastery ring). */
  readonly emptyAside?: ReactNode;
}

export function ProgressScreen({ model, actions, children, emptyAside }: ProgressScreenViewProps) {
  const { family } = useTheme();
  const isCrystal = family === 'crystal';
  const showLumi = isCrystal && readLumiEnabled();
  useLayoutEffect(() => {
    if ((model.focusIntent ?? 0) > 0) model.headingRef?.current?.focus({ preventScroll: true });
  }, [model.focusIntent, model.headingRef]);
  const insights = children && <section aria-label={i18n._(msg({ id: 'progress.insights.label', message: 'Detailed learning insights' }))} className="progress-board-insights min-w-0 motion-reduce:transition-none">{children}</section>;
  return <section aria-labelledby="daily-progress-heading" aria-busy={model.status === 'loading' || undefined} className="progress-board mx-auto max-w-6xl space-y-5 sm:space-y-6">
    <header className="progress-board-header">
      <div className="progress-board-titles">
        {isCrystal && <p className="progress-board-kicker"><Trans {...msg({ context: 'progress.kicker', message: 'Study diary' })} /><ProgressLearningSince variant="kicker" /></p>}
        <ProgressHeading model={model} isCrystal={isCrystal} />
      </div>
      <Subtitle model={model} isCrystal={isCrystal} />
      {showLumi && <LumiLink model={model} />}
      {model.status !== 'error' && model.reviewRangeDays && actions.changeReviewRange && <ReviewRangeToggle value={model.reviewRangeDays} onChange={actions.changeReviewRange} className="progress-board-range" />}
      {model.isOffline && <p className="progress-board-offline" role="status" aria-live="polite"><Trans {...msg({ context: 'progress.offline.reconnect', message: 'You’re offline. Reconnect to review and save your progress.' })} /></p>}
    </header>
    {model.status === 'error' ? <div className="progress-board-error stats-panel crystal-chamfer max-w-3xl p-6 sm:p-8" role="alert"><p className="progress-summary-kicker"><Trans {...msg({ context: 'progress.error.kicker', message: 'Progress unavailable' })} /></p><h2 className="stats-panel-title mt-3"><Trans {...msg({ context: 'progress.error.title', message: 'Progress needs attention' })} /></h2><p className="progress-summary-copy mt-2">{model.message}</p></div>
      : isCrystal && model.status === 'empty' ? <><div className="progress-empty-grid stats-grid grid grid-cols-1"><EmptyActivity model={model} actions={actions} />{emptyAside}</div>{insights}</>
      : <>{model.status === 'ready' && insights}<Summary model={model} actions={actions} />{model.status !== 'ready' && insights}</>}
  </section>;
}
