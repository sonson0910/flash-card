import { useLayoutEffect } from 'react';
import type { ProgressScreenProps } from './dailyLearningPresentation';

const primaryClass = 'brand-action min-h-11 rounded-full bg-[var(--sf-brand)] px-6 py-3 font-extrabold text-[var(--sf-on-brand)] shadow-md shadow-sky-600/20 transition-all duration-300 hover:brightness-110 hover:scale-[1.03] active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 motion-reduce:transition-none cursor-pointer';

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
        <section aria-labelledby="progress-summary-heading" className="overflow-hidden rounded-[28px] border border-[var(--sf-border)] bg-[var(--sf-surface)] shadow-[0_28px_70px_-52px_var(--sf-shadow)]">
          <div className="grid gap-5 p-5 sm:p-7 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
            <div>
              <p className="premium-kicker uppercase tracking-[0.16em]">Next useful step</p>
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
          <dl className="grid border-t border-[var(--sf-border)] sm:grid-cols-3">
            <div className="border-b border-[var(--sf-border)] p-4 sm:border-b-0 sm:border-r sm:p-5"><dt className="text-sm font-semibold text-[var(--sf-text-muted)]">Reviewed</dt><dd className="mt-1 text-2xl font-black tabular-nums">{model.reviewed} reviewed</dd></div>
            <div className="border-b border-[var(--sf-border)] p-4 sm:border-b-0 sm:border-r sm:p-5"><dt className="text-sm font-semibold text-[var(--sf-text-muted)]">Mastered</dt><dd className="mt-1 text-2xl font-black tabular-nums">{model.mastered} mastered</dd></div>
            <div className="p-4 sm:p-5"><dt className="text-sm font-semibold text-[var(--sf-text-muted)]">Due</dt><dd className="mt-1 text-2xl font-black tabular-nums">{model.dueToday} due today</dd></div>
          </dl>
        </section>
      )}

      {children && <section aria-label="Detailed learning insights" className="min-w-0 motion-reduce:transition-none">{children}</section>}
    </section>
  );
}
