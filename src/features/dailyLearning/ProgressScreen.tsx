import { useLayoutEffect } from 'react';
import { Sparkles } from 'lucide-react';
import { CountUp } from '../../components/motion/CountUp';
import type { ProgressScreenProps } from './dailyLearningPresentation';

const primaryClass = 'brand-action shimmer-sweep min-h-11 rounded-full bg-[var(--sf-brand)] px-6 py-3 font-extrabold text-[var(--sf-on-brand)] shadow-md shadow-sky-600/20 transition-all duration-300 hover:brightness-110 hover:scale-[1.03] active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 motion-reduce:transition-none cursor-pointer';

export function ProgressScreen({ model, actions, children }: ProgressScreenProps) {
  const assignHeading = (heading: HTMLHeadingElement | null) => {
    if (model.headingRef) model.headingRef.current = heading;
  };

  useLayoutEffect(() => {
    if ((model.focusIntent ?? 0) > 0) model.headingRef?.current?.focus({ preventScroll: true });
  }, [model.focusIntent, model.headingRef]);

  const heading = <h1 id="daily-progress-heading" ref={assignHeading} tabIndex={-1} className="text-balance text-3xl font-black tracking-tight focus-visible:outline-2 sm:text-4xl">Learning progress</h1>;

  return (
    <section aria-labelledby="daily-progress-heading" className="mx-auto max-w-6xl space-y-5 sm:space-y-6">
      <header>
        <p className="premium-kicker uppercase tracking-[0.16em]">Learning history</p>
        {heading}
        <p className="mt-2 max-w-2xl text-pretty text-[var(--sf-text-muted)]" role={model.status === 'loading' ? 'status' : undefined} aria-live={model.status === 'loading' ? 'polite' : undefined}>{model.message}</p>
      </header>

      {model.isOffline && <p className="rounded-xl border border-sky-500/70 bg-sky-500/10 p-3 font-semibold" role="status" aria-live="polite">Available offline · showing saved progress</p>}

      {model.status === 'error' ? (
        <div className="max-w-3xl rounded-[28px] border border-rose-500/70 bg-rose-500/5 p-6 sm:p-8" role="alert">
          <p className="premium-kicker uppercase tracking-[0.16em]">Progress unavailable</p>
          <h2 className="mt-3 text-2xl font-black tracking-tight">Progress needs attention</h2>
          <p className="mt-2 text-[var(--sf-text-muted)]">{model.message}</p>
        </div>
      ) : (
        <section aria-labelledby="progress-summary-heading" className="liquid-glass rounded-[28px] border border-[var(--sf-border)] p-6 sm:p-7 shadow-[0_28px_70px_-52px_var(--sf-shadow)]">
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
            <div>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-cyan-500/30 bg-cyan-500/10 px-3 py-1 text-[11px] font-black uppercase tracking-[0.16em] text-cyan-800 dark:text-cyan-300">
                <Sparkles size={13} className="text-cyan-600 dark:text-cyan-400" />
                Next useful step
              </span>
              <h2 id="progress-summary-heading" className="mt-3 text-balance text-2xl font-black tracking-tight sm:text-3xl">
                {model.status === 'empty' ? 'Begin your learning history' : model.dueToday > 0 ? 'Keep today’s memory work moving' : 'Your scheduled review is clear'}
              </h2>
              <p className="mt-2 max-w-2xl text-pretty text-sm leading-6 text-[var(--sf-text-muted)]">
                {model.status === 'empty' ? 'Complete a review to begin your progress history.' : model.dueToday > 0 ? `${model.dueToday} words are ready for review now.` : 'New review activity will appear here as you learn.'}
              </p>
            </div>
            {model.status === 'ready' && model.dueToday > 0 && <button type="button" data-primary-learning-action="true" onClick={actions.startReview} className={`${primaryClass} w-full sm:w-auto`}>Review {model.dueToday} due words</button>}
            {model.status === 'empty' && <button type="button" data-primary-learning-action="true" onClick={model.hasVocabulary ? actions.startReview : actions.openVocabulary} className={`${primaryClass} w-full sm:w-auto`}>{model.hasVocabulary ? 'Start your first review' : 'Add vocabulary'}</button>}
          </div>

          <div data-progress-evidence="true" className="mt-6 border-t border-[var(--sf-border)] pt-5">
            <p className="premium-kicker uppercase tracking-[0.14em]">Supporting evidence</p>
            <dl className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-0">
              <div className="flex items-baseline gap-2 border-b border-[var(--sf-border)] pb-3 sm:border-b-0 sm:border-r sm:pr-4">
                <dt className="text-xs font-bold uppercase tracking-wider text-[var(--sf-text)]">Reviewed</dt>
                <dd className="text-sm font-bold tabular-nums text-[var(--sf-text)]"><CountUp to={model.reviewed} suffix=" reviewed" /> <span aria-hidden="true">reviewed</span></dd>
              </div>
              <div className="flex items-baseline gap-2 border-b border-[var(--sf-border)] pb-3 sm:border-b-0 sm:border-r sm:px-4">
                <dt className="text-xs font-bold uppercase tracking-wider text-[var(--sf-text)]">Mastered</dt>
                <dd className="text-sm font-bold tabular-nums text-[var(--sf-text)]"><CountUp to={model.mastered} suffix=" mastered" /> <span aria-hidden="true">mastered</span></dd>
              </div>
              <div className="flex items-baseline gap-2 sm:pl-4">
                <dt className="text-xs font-bold uppercase tracking-wider text-[var(--sf-text)]">Due today</dt>
                <dd className="text-sm font-bold tabular-nums text-[var(--sf-text)]"><CountUp to={model.dueToday} suffix=" due today" /> <span aria-hidden="true">due today</span></dd>
              </div>
            </dl>
          </div>
        </section>
      )}

      {children && <section aria-label="Detailed learning insights" className="min-w-0 motion-reduce:transition-none">{children}</section>}
    </section>
  );
}
