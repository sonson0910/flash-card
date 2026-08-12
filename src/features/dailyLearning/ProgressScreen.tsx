import { useLayoutEffect } from 'react';
import type { ProgressScreenProps } from './dailyLearningPresentation';

const actionClass = 'min-h-11 rounded-xl bg-[var(--sf-brand)] px-4 py-2 font-bold text-[var(--sf-on-brand)] hover:bg-[var(--sf-brand-hover)] hover:text-[var(--sf-on-brand-hover)] focus-visible:outline-2 focus-visible:outline-offset-2';

export function ProgressScreen({ model, actions, children }: ProgressScreenProps) {
  const assignHeading = (heading: HTMLHeadingElement | null) => {
    if (model.headingRef) model.headingRef.current = heading;
  };
  useLayoutEffect(() => {
    if ((model.focusIntent ?? 0) > 0) model.headingRef?.current?.focus({ preventScroll: true });
  }, [model.focusIntent, model.headingRef]);

  return (
    <section aria-labelledby="daily-progress-heading" className="space-y-6">
      <header><p className="text-sm font-bold text-[var(--sf-brand-text)]">Learning history</p><h1 id="daily-progress-heading" ref={assignHeading} tabIndex={-1} className="text-3xl font-black focus-visible:outline-2">Learning progress</h1><p className="mt-2 text-[var(--sf-text-muted)]" role={model.status === 'loading' ? 'status' : undefined} aria-live={model.status === 'loading' ? 'polite' : undefined}>{model.message}</p></header>
      {model.isOffline && <p className="rounded-xl border border-sky-500 p-3 font-semibold" role="status" aria-live="polite">Available offline · showing saved progress</p>}
      {model.status === 'error' ? <div className="rounded-2xl border border-rose-500 p-5" role="alert"><h2 className="text-xl font-black">Progress needs attention</h2><p className="mt-2">{model.message}</p></div> : <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3"><div className="rounded-2xl border border-[var(--sf-border)] p-4"><dt className="text-sm text-[var(--sf-text-muted)]">Reviewed</dt><dd className="mt-1 text-2xl font-black">{model.reviewed} reviewed</dd></div><div className="rounded-2xl border border-[var(--sf-border)] p-4"><dt className="text-sm text-[var(--sf-text-muted)]">Mastered</dt><dd className="mt-1 text-2xl font-black">{model.mastered} mastered</dd></div><div className="rounded-2xl border border-[var(--sf-border)] p-4"><dt className="text-sm text-[var(--sf-text-muted)]">Due</dt><dd className="mt-1 text-2xl font-black">{model.dueToday} due today</dd></div></dl>}
      {model.status === 'empty' && <div className="rounded-2xl border border-[var(--sf-border)] p-5"><p role="status">Complete a review to begin your progress history.</p><button type="button" onClick={model.hasVocabulary ? actions.startReview : actions.openVocabulary} className={`${actionClass} mt-4`}>{model.hasVocabulary ? 'Start your first review' : 'Add vocabulary'}</button></div>}
      {children && <section aria-label="Detailed learning insights" className="min-w-0 motion-reduce:transition-none">{children}</section>}
    </section>
  );
}
