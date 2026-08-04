import { useCallback } from 'react';
import type { ProgressScreenProps } from './dailyLearningPresentation';

export function ProgressScreen({ model, children }: ProgressScreenProps) {
  const focusHeading = useCallback((heading: HTMLHeadingElement | null) => {
    if (model.headingRef) model.headingRef.current = heading;
    heading?.focus({ preventScroll: true });
  }, [model.headingRef]);

  return (
    <section aria-labelledby="daily-progress-heading" className="space-y-6">
      <header><p className="text-sm font-bold text-[var(--sf-brand-text)]">Learning history</p><h1 id="daily-progress-heading" ref={focusHeading} tabIndex={-1} className="text-3xl font-black focus-visible:outline-2">Learning progress</h1><p className="mt-2 text-[var(--sf-text-muted)]" role={model.status === 'loading' ? 'status' : undefined} aria-live={model.status === 'loading' ? 'polite' : undefined}>{model.message}</p></header>
      {model.isOffline && <p className="rounded-xl border border-sky-500 p-3 font-semibold" role="status" aria-live="polite">Available offline · showing saved progress</p>}
      {model.status === 'error' ? <div className="rounded-2xl border border-rose-500 p-5" role="alert"><h2 className="text-xl font-black">Progress needs attention</h2><p className="mt-2">{model.message}</p></div> : <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3"><div className="rounded-2xl border border-[var(--sf-border)] p-4"><dt className="text-sm text-[var(--sf-text-muted)]">Reviewed</dt><dd className="mt-1 text-2xl font-black">{model.reviewed} reviewed</dd></div><div className="rounded-2xl border border-[var(--sf-border)] p-4"><dt className="text-sm text-[var(--sf-text-muted)]">Mastered</dt><dd className="mt-1 text-2xl font-black">{model.mastered} mastered</dd></div><div className="rounded-2xl border border-[var(--sf-border)] p-4"><dt className="text-sm text-[var(--sf-text-muted)]">Due</dt><dd className="mt-1 text-2xl font-black">{model.dueToday} due today</dd></div></dl>}
      {model.status === 'empty' && <p className="rounded-2xl border border-[var(--sf-border)] p-5" role="status">Complete a review to begin your progress history.</p>}
      {children && <section aria-label="Detailed learning insights" className="min-w-0 motion-reduce:transition-none">{children}</section>}
    </section>
  );
}
