import { useLayoutEffect } from 'react';
import { Sparkles } from 'lucide-react';
import { i18n } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import { Trans } from '@lingui/react';
import { CountUp } from '../../components/motion/CountUp';
import { Lumi } from '../../components/lumi/Lumi';
import { useTheme } from '../theme/ThemeProvider';
import { readLumiEnabled } from '../settings/lumi-preference';
import './daily-learning-canvas.css';
import type { ProgressScreenProps } from './dailyLearningPresentation';

const primaryClass = 'brand-action crystal-chamfer min-h-11 rounded-2xl bg-[var(--sf-brand)] px-6 py-3 font-extrabold text-[var(--sf-on-brand)] shadow-[var(--sf-panel-shadow)] transition duration-200 hover:bg-[var(--sf-brand-hover)] active:scale-[.98] focus-visible:outline-2 focus-visible:outline-offset-2 motion-reduce:transition-none cursor-pointer';

function ProgressHeading({ model }: Pick<ProgressScreenProps, 'model'>) {
  const assignHeading = (heading: HTMLHeadingElement | null) => {
    if (model.headingRef) model.headingRef.current = heading;
  };
  return <h1 id="daily-progress-heading" ref={assignHeading} tabIndex={-1} className="text-balance text-3xl font-black tracking-tight focus-visible:outline-2 sm:text-4xl"><Trans id="progress.title" message="Progress" /></h1>;
}

function Metric({ label, value, tone }: { readonly label: React.ReactNode; readonly value: number; readonly tone: string }) {
  return <div className="crystal-chamfer-sm min-w-0 rounded-2xl border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] p-4 shadow-[var(--sf-panel-shadow)]"><dt className="text-xs font-black uppercase tracking-[.12em] text-[var(--sf-text-muted)]">{label}</dt><dd className={`mt-2 text-2xl font-black tabular-nums tracking-tight ${tone}`}><CountUp to={value} /></dd></div>;
}

function Summary({ model, actions }: Omit<ProgressScreenProps, 'children'>) {
  const { family } = useTheme();
  const showLumi = family === 'crystal' && readLumiEnabled();
  const title = model.status === 'empty' ? <Trans id="progress.empty.title" message="Your learning story starts here" /> : model.status === 'loading' ? <Trans id="progress.loading.title" message="Your saved progress" /> : model.dueToday > 0 ? <Trans id="progress.due.title" message="Keep today’s memory work moving" /> : <Trans id="progress.clear.title" message="Your scheduled review is clear" />;
  return <section aria-labelledby="progress-summary-heading" className="liquid-glass crystal-chamfer relative overflow-hidden rounded-[28px] border border-[var(--sf-border)] p-6 shadow-[var(--sf-panel-shadow)] sm:p-7">
    {family === 'crystal' && <span aria-hidden="true" className="crystal-starfield pointer-events-none absolute inset-0 opacity-45 motion-reduce:animate-none" />}
    <div className="relative grid gap-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end"><div className="min-w-0"><div className="flex flex-wrap items-center gap-3"><span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--sf-brand)]/30 bg-[color-mix(in_srgb,var(--sf-brand)_10%,transparent)] px-3 py-1 text-[11px] font-black uppercase tracking-[.16em] text-[var(--sf-brand-text)]"><Sparkles size={13} aria-hidden="true" /><Trans id="progress.kicker" message="Study diary" /></span>{showLumi && <Lumi pose="proud" size={48} className="crystal-ornament -my-2" />}</div><h2 id="progress-summary-heading" className="mt-3 text-balance text-2xl font-black tracking-tight sm:text-3xl">{title}</h2><p className="mt-2 max-w-2xl text-pretty text-sm leading-6 text-[var(--sf-text-muted)]" role={model.status === 'loading' ? 'status' : undefined} aria-live={model.status === 'loading' ? 'polite' : undefined}>{model.status === 'empty' ? <Trans id="progress.empty.description" message="Complete a review to begin your progress history." /> : model.message}</p></div>
      {model.status === 'ready' && model.dueToday > 0 && <button type="button" data-primary-learning-action="true" onClick={actions.startReview} className={`${primaryClass} w-full sm:w-auto`}><Trans id="progress.review-due" message="Review {count, plural, one {# due word} other {# due words}}" values={{ count: model.dueToday }} /></button>}
      {model.status === 'empty' && <button type="button" data-primary-learning-action="true" onClick={model.hasVocabulary ? actions.startReview : actions.openVocabulary} className={`${primaryClass} w-full sm:w-auto`}>{model.hasVocabulary ? <Trans id="progress.start-review" message="Start your first review" /> : <Trans id="progress.add-vocabulary" message="Add vocabulary" />}</button>}</div>
    <div className="relative mt-6 border-t border-[var(--sf-border)] pt-5"><p className="premium-kicker uppercase tracking-[.14em]"><Trans id="progress.evidence" message="Supporting evidence" /></p><dl data-progress-evidence="true" className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3"><Metric label={<Trans id="progress.metric.reviewed" message="Reviewed" />} value={model.reviewed} tone="text-[var(--sf-text)]" /><Metric label={<Trans id="progress.metric.mastered" message="Mastered" />} value={model.mastered} tone="text-[var(--sf-reward)]" /><Metric label={<Trans id="progress.metric.due" message="Due today" />} value={model.dueToday} tone="text-[var(--sf-brand-text)]" /></dl></div>
  </section>;
}

export function ProgressScreen({ model, actions, children }: ProgressScreenProps) {
  useLayoutEffect(() => {
    if ((model.focusIntent ?? 0) > 0) model.headingRef?.current?.focus({ preventScroll: true });
  }, [model.focusIntent, model.headingRef]);
  return <section aria-labelledby="daily-progress-heading" aria-busy={model.status === 'loading' || undefined} className="mx-auto max-w-6xl space-y-5 sm:space-y-6"><header><p className="premium-kicker uppercase tracking-[.16em]"><Trans id="progress.history-kicker" message="Learning history" /></p><ProgressHeading model={model} />{model.isOffline && <p className="mt-2 text-xs font-medium text-[var(--sf-text-muted)]" role="status" aria-live="polite"><Trans id="progress.offline" message="Offline — this may be out of date." /></p>}</header>{model.status === 'error' ? <div className="crystal-chamfer max-w-3xl rounded-[28px] border border-[var(--sf-danger)] bg-[color-mix(in_srgb,var(--sf-danger)_8%,var(--sf-surface))] p-6 shadow-[var(--sf-panel-shadow)] sm:p-8" role="alert"><p className="premium-kicker uppercase tracking-[.16em]"><Trans id="progress.error.kicker" message="Progress unavailable" /></p><h2 className="mt-3 text-2xl font-black tracking-tight"><Trans id="progress.error.title" message="Progress needs attention" /></h2><p className="mt-2 text-[var(--sf-text-muted)]">{model.message}</p></div> : <Summary model={model} actions={actions} />}{children && <section aria-label={i18n._(msg({ id: 'progress.insights.label', message: 'Detailed learning insights' }))} className="min-w-0 motion-reduce:transition-none">{children}</section>}</section>;
}
