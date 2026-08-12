import type { LessonMode, TodayScreenActions, TodayScreenModel } from './dailyLearningPresentation';

interface TodayScreenProps {
  readonly model: TodayScreenModel;
  readonly actions: TodayScreenActions;
}

const lessonModes: ReadonlyArray<{ id: LessonMode; label: string; description: string }> = [
  { id: 'recognition', label: 'Recognition', description: 'Choose the meaning you recognize.' },
  { id: 'active-recall', label: 'Active recall', description: 'Recall the answer without choices.' },
  { id: 'listening', label: 'Listening', description: 'Listen, then identify the word.' },
  { id: 'spelling', label: 'Spelling', description: 'Type the word from its meaning.' },
  { id: 'cloze', label: 'Cloze', description: 'Complete a real example sentence.' },
  { id: 'sentence-building', label: 'Sentence building', description: 'Put every word occurrence in order.' },
];

// The base and hover brand surfaces need different foreground tokens. Swap both
// discretely so a color transition cannot pass through a low-contrast midpoint.
const primaryButton = 'brand-action min-h-11 rounded-xl bg-[var(--sf-brand)] px-4 py-2 font-bold text-[var(--sf-on-brand)] hover:bg-[var(--sf-brand-hover)] hover:text-[var(--sf-on-brand-hover)] focus-visible:outline-2 focus-visible:outline-offset-2';
const secondaryButton = 'min-h-11 rounded-xl border border-[var(--sf-border)] bg-[var(--sf-surface)] px-4 py-2 font-bold transition-colors hover:border-[var(--sf-brand)] focus-visible:outline-2 focus-visible:outline-offset-2 motion-reduce:transition-none';

function PlanSummary({ model, actions }: TodayScreenProps) {
  const { plan } = model;
  if (!plan) return null;

  return (
    <section aria-labelledby="daily-plan-heading" className="rounded-2xl border border-[var(--sf-border)] bg-[var(--sf-surface)] p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="daily-plan-heading" className="text-xl font-black">Your daily plan</h2>
          <p className="mt-1 text-sm text-[var(--sf-text-muted)]">{plan.total} items · ordered due, weak, then new</p>
        </div>
        {plan.isShort && <span className="rounded-full border border-amber-500 px-3 py-2 text-sm font-bold">Short plan</span>}
      </div>
      <dl className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-xl bg-[var(--sf-surface-muted)] p-3"><dt className="text-sm text-[var(--sf-text-muted)]">Due review</dt><dd className="text-xl font-black">{plan.due} due</dd></div>
        <div className="rounded-xl bg-[var(--sf-surface-muted)] p-3"><dt className="text-sm text-[var(--sf-text-muted)]">Needs practice</dt><dd className="text-xl font-black">{plan.weak} weak</dd></div>
        <div className="rounded-xl bg-[var(--sf-surface-muted)] p-3"><dt className="text-sm text-[var(--sf-text-muted)]">First look</dt><dd className="text-xl font-black">{plan.fresh} new</dd></div>
      </dl>
      {plan.isShort && <p className="mt-3 text-sm">There are fewer than 10 eligible cards today. You can still complete this shorter plan.</p>}
      {plan.due > 0 && <button type="button" onClick={actions.continueReview} className={`${primaryButton} mt-4`}>Continue review</button>}
    </section>
  );
}

export function TodayScreen({ model, actions }: TodayScreenProps) {
  const assignHeading = (heading: HTMLHeadingElement | null) => {
    if (model.headingRef) model.headingRef.current = heading;
  };
  if (model.status === 'loading') {
    return <section aria-labelledby="daily-today-heading" aria-busy="true"><h1 id="daily-today-heading" ref={assignHeading} tabIndex={-1} className="text-3xl font-black focus-visible:outline-2">Today</h1><p role="status" aria-live="polite" className="mt-4">{model.message}</p></section>;
  }

  if (model.status === 'empty') {
    return <section aria-labelledby="daily-today-heading"><h1 id="daily-today-heading" ref={assignHeading} tabIndex={-1} className="text-3xl font-black focus-visible:outline-2">Today</h1><div className="mt-5 rounded-2xl border border-[var(--sf-border)] p-5"><h2 className="text-xl font-black">Build your first plan</h2><p className="mt-2" role="status" aria-live="polite">{model.message}</p><div className="mt-4 flex flex-wrap gap-3"><button type="button" onClick={actions.openVocabulary} className={primaryButton}>Add vocabulary</button><button type="button" onClick={actions.openPaths} className={secondaryButton}>Explore learning paths</button></div></div></section>;
  }

  if (model.status === 'error') {
    return <section aria-labelledby="daily-today-heading"><h1 id="daily-today-heading" ref={assignHeading} tabIndex={-1} className="text-3xl font-black focus-visible:outline-2">Today</h1><div className="mt-5 rounded-2xl border border-rose-500 p-5" role="alert" aria-live="assertive"><h2 className="text-xl font-black">Today needs attention</h2><p className="mt-2">{model.message}</p><button type="button" onClick={actions.retry} className={`${primaryButton} mt-4`}>Try again</button></div></section>;
  }

  return (
    <section aria-labelledby="daily-today-heading" className="space-y-6">
      <header><p className="text-sm font-bold text-[var(--sf-brand-text)]">Daily learning</p><h1 id="daily-today-heading" ref={assignHeading} tabIndex={-1} className="text-3xl font-black focus-visible:outline-2">Today</h1><p className="mt-2 text-[var(--sf-text-muted)]" role="status" aria-live="polite">{model.message}</p></header>
      {model.isOffline && <p className="rounded-xl border border-sky-500 p-3 font-semibold" role="status" aria-live="polite">Available offline · using saved learning data</p>}
      <PlanSummary model={model} actions={actions} />
      <section aria-labelledby="practice-mode-heading">
        <h2 id="practice-mode-heading" className="text-xl font-black">Choose a practice mode</h2>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {lessonModes.map((mode) => <button key={mode.id} type="button" onClick={() => actions.startLesson(mode.id)} className={`${secondaryButton} text-left`}><span className="block font-black">{mode.label}</span><span className="mt-1 block text-sm font-normal text-[var(--sf-text-muted)]">{mode.description}</span></button>)}
        </div>
        <button type="button" onClick={event => actions.openMorePractice(event.currentTarget)} className={`${secondaryButton} mt-3`}>More practice</button>
      </section>
      {model.placementAvailable && <section aria-labelledby="placement-invite-heading" className="rounded-2xl border border-[var(--sf-border)] p-5"><h2 id="placement-invite-heading" className="text-xl font-black">Not sure where to begin?</h2><p className="mt-2 text-sm text-[var(--sf-text-muted)]">Take a short diagnostic check. It will not change your review history or unlock content.</p><button type="button" onClick={actions.startPlacement} className={`${secondaryButton} mt-4`}>Take placement check</button></section>}
    </section>
  );
}

export type { TodayScreenProps };
