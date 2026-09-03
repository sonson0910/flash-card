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
        <section
          aria-labelledby="progress-summary-heading"
          className="liquid-glass relative overflow-hidden rounded-[28px] border border-slate-200/90 bg-white/95 p-6 shadow-[0_28px_70px_-52px_var(--sf-shadow)] backdrop-blur-xl dark:border-white/10 dark:bg-[#071318]/90 sm:p-7"
        >
          {/* Ambient Aurora Glow */}
          <div className="pointer-events-none absolute -right-24 -top-24 size-80 rounded-full bg-cyan-500/15 blur-3xl dark:bg-cyan-400/15" aria-hidden="true" />
          <div className="pointer-events-none absolute -left-24 -bottom-24 size-80 rounded-full bg-emerald-500/15 blur-3xl dark:bg-emerald-400/15" aria-hidden="true" />

          <div className="relative grid gap-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
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

          <div data-progress-evidence="true" className="relative mt-6 border-t border-[var(--sf-border)] pt-5">
            <p className="premium-kicker uppercase tracking-[0.14em]">Supporting evidence</p>
            <dl className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-3">
              <div className="group relative overflow-hidden rounded-2xl border border-slate-200/80 bg-slate-50/80 p-4 transition-all duration-300 hover:border-sky-400/50 hover:shadow-md hover:shadow-sky-500/5 dark:border-white/10 dark:bg-white/[0.04]">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="size-2 rounded-full bg-sky-500 shadow-[0_0_8px_rgba(14,165,233,0.6)]" aria-hidden="true" />
                    <dt className="text-xs font-bold uppercase tracking-wider text-[var(--sf-text-muted)]">Reviewed</dt>
                  </div>
                </div>
                <dd className="mt-2 text-2xl font-black tabular-nums tracking-tight text-[var(--sf-text)]">
                  <CountUp to={model.reviewed} suffix=" reviewed" /> <span aria-hidden="true" className="text-xs font-semibold text-[var(--sf-text-muted)]">reviewed</span>
                </dd>
              </div>

              <div className="group relative overflow-hidden rounded-2xl border border-slate-200/80 bg-slate-50/80 p-4 transition-all duration-300 hover:border-emerald-400/50 hover:shadow-md hover:shadow-emerald-500/5 dark:border-white/10 dark:bg-white/[0.04]">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="size-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)]" aria-hidden="true" />
                    <dt className="text-xs font-bold uppercase tracking-wider text-[var(--sf-text-muted)]">Mastered</dt>
                  </div>
                </div>
                <dd className="mt-2 text-2xl font-black tabular-nums tracking-tight text-emerald-600 dark:text-emerald-400">
                  <CountUp to={model.mastered} suffix=" mastered" /> <span aria-hidden="true" className="text-xs font-semibold text-[var(--sf-text-muted)]">mastered</span>
                </dd>
              </div>

              <div className="group relative overflow-hidden rounded-2xl border border-slate-200/80 bg-slate-50/80 p-4 transition-all duration-300 hover:border-amber-400/50 hover:shadow-md hover:shadow-amber-500/5 dark:border-white/10 dark:bg-white/[0.04]">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="size-2 rounded-full bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.6)]" aria-hidden="true" />
                    <dt className="text-xs font-bold uppercase tracking-wider text-[var(--sf-text-muted)]">Due today</dt>
                  </div>
                </div>
                <dd className="mt-2 text-2xl font-black tabular-nums tracking-tight text-amber-600 dark:text-amber-400">
                  <CountUp to={model.dueToday} suffix=" due today" /> <span aria-hidden="true" className="text-xs font-semibold text-[var(--sf-text-muted)]">due today</span>
                </dd>
              </div>
            </dl>
          </div>
        </section>
      )}

      {children && <section aria-label="Detailed learning insights" className="min-w-0 motion-reduce:transition-none">{children}</section>}
    </section>
  );
}
