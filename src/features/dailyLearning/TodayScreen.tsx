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

const primaryButton = 'brand-action min-h-11 rounded-full bg-cyan-400 px-6 py-3 font-extrabold text-[#071014] shadow-lg shadow-cyan-500/25 transition-all duration-300 hover:bg-cyan-300 hover:scale-[1.03] active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 motion-reduce:transition-none cursor-pointer';
const secondaryButton = 'min-h-11 rounded-full border border-white/15 bg-white/5 px-5 py-2.5 font-bold text-white/90 transition-all duration-200 hover:border-cyan-400/50 hover:bg-white/10 hover:text-white hover:scale-[1.02] active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 motion-reduce:transition-none cursor-pointer';
const practiceModeButton = 'min-h-24 rounded-xl border border-[var(--sf-border)] bg-[var(--sf-surface)] p-4 text-left transition-colors hover:border-[var(--sf-brand)] hover:bg-[var(--sf-surface-raised)] focus-visible:outline-2 focus-visible:outline-offset-2 motion-reduce:transition-none';
const headingClass = 'text-balance text-3xl font-black tracking-tight focus-visible:outline-2 sm:text-4xl';

const planStages = [
  { key: 'due', label: 'Review due', description: 'Bring scheduled words back first.' },
  { key: 'weak', label: 'Strengthen', description: 'Practice words that need another pass.' },
  { key: 'fresh', label: 'First look', description: 'Meet new vocabulary after review.' },
] as const;

function PageHeading({ model }: Pick<TodayScreenProps, 'model'>) {
  const assignHeading = (heading: HTMLHeadingElement | null) => {
    if (model.headingRef) model.headingRef.current = heading;
  };

  return <h1 id="daily-today-heading" ref={assignHeading} tabIndex={-1} className={headingClass}>Today</h1>;
}

function PlanSummary({ model, actions }: TodayScreenProps) {
  const { plan } = model;
  if (!plan) return null;

  return (
    <section aria-labelledby="daily-plan-heading" className="overflow-hidden rounded-[28px] border border-[var(--sf-border)] bg-[var(--sf-surface)] shadow-[0_28px_70px_-52px_var(--sf-shadow)]">
      <div className="grid gap-6 p-5 sm:p-7 lg:grid-cols-[minmax(0,1fr)_minmax(16rem,0.52fr)] lg:items-end">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <p className="premium-kicker uppercase tracking-[0.16em]">Daily focus</p>
            {plan.isShort && <span className="rounded-full border border-amber-500/60 bg-amber-400/10 px-3 py-1 text-xs font-bold text-[var(--sf-text)]">Short plan</span>}
          </div>
          <h2 id="daily-plan-heading" className="mt-3 text-balance text-2xl font-black tracking-tight sm:text-3xl">Your daily plan</h2>
          <p className="mt-2 max-w-2xl text-pretty font-semibold">Build memory in the right order.</p>
          <p className="mt-1 max-w-2xl text-pretty text-sm leading-6 text-[var(--sf-text-muted)]">{plan.total} items, sequenced from scheduled review to first look.</p>
          {plan.isShort && <p className="mt-3 max-w-2xl text-sm leading-6 text-[var(--sf-text-muted)]">There are fewer than 10 eligible cards today. You can still complete this shorter plan.</p>}
        </div>
        <button
          type="button"
          data-primary-learning-action="true"
          onClick={plan.due > 0 ? actions.continueReview : () => actions.startLesson('recognition')}
          className={`${primaryButton} w-full justify-self-stretch text-center sm:w-auto lg:w-full`}
        >
          {plan.due > 0 ? 'Continue review' : 'Start recognition lesson'}
        </button>
      </div>

      <ol className="grid border-t border-[var(--sf-border)] sm:grid-cols-3" aria-label="Daily plan order">
        {planStages.map((stage, index) => (
          <li key={stage.key} className="relative flex min-w-0 gap-3 border-b border-[var(--sf-border)] p-4 last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0 sm:p-5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--sf-surface-muted)] text-sm font-black tabular-nums text-[var(--sf-brand-text)]" aria-hidden="true">{index + 1}</span>
            <div className="min-w-0">
              <p className="font-extrabold">{stage.label}</p>
              <p className="mt-0.5 text-sm text-[var(--sf-text-muted)]">{plan[stage.key]} {stage.key === 'fresh' ? 'new' : stage.key}</p>
              <p className="mt-2 text-pretty text-xs leading-5 text-[var(--sf-text-muted)]">{stage.description}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

function PracticeModes({ actions }: Pick<TodayScreenProps, 'actions'>) {
  return (
    <section aria-labelledby="practice-mode-heading" className="liquid-glass rounded-[24px] p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="premium-kicker uppercase tracking-[0.14em]">Extra practice</p>
          <h2 id="practice-mode-heading" className="text-xl font-black tracking-tight">Practice your way</h2>
          <p className="mt-1 text-sm text-[var(--sf-text-muted)]">Use another exercise when you want a different kind of recall.</p>
        </div>
        <button type="button" onClick={event => actions.openMorePractice(event.currentTarget)} className="liquid-control min-h-10 rounded-xl px-4 py-2 text-sm font-semibold text-[var(--sf-text)] transition-colors hover:border-[var(--sf-brand)]">More practice</button>
      </div>
      <details className="group mt-4 border-t border-[var(--sf-border)] pt-1" open>
        <summary className="flex min-h-11 cursor-pointer list-none items-center rounded-xl px-1 text-sm font-bold text-[var(--sf-brand-text)] focus-visible:outline-2 focus-visible:outline-offset-2 [&::-webkit-details-marker]:hidden">
          Switch practice mode
          <span className="ml-2 transition-transform group-open:rotate-180 motion-reduce:transition-none" aria-hidden="true">⌄</span>
        </summary>
        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {lessonModes.map((mode) => (
            <button key={mode.id} type="button" data-practice-mode onClick={() => actions.startLesson(mode.id)} className={practiceModeButton}>
              <span className="block text-sm font-black text-[var(--sf-text)]">{mode.label}</span>
              <span className="mt-1 block text-xs leading-5 text-[var(--sf-text-muted)]">{mode.description}</span>
            </button>
          ))}
        </div>
      </details>
    </section>
  );
}

export function TodayScreen({ model, actions }: TodayScreenProps) {
  if (model.status === 'loading') {
    return <section aria-labelledby="daily-today-heading" aria-busy="true" className="mx-auto max-w-6xl"><PageHeading model={model} /><div className="skeleton-sheen mt-6 min-h-52 rounded-[28px] border border-[var(--sf-border)]" role="status" aria-live="polite"><span className="sr-only">{model.message}</span></div></section>;
  }

  if (model.status === 'empty') {
    return <section aria-labelledby="daily-today-heading" className="mx-auto max-w-6xl"><p className="premium-kicker uppercase tracking-[0.16em]">Daily learning</p><PageHeading model={model} /><div className="mt-6 max-w-3xl rounded-[28px] border border-[var(--sf-border)] bg-[var(--sf-surface)] p-6 shadow-[0_28px_70px_-52px_var(--sf-shadow)] sm:p-8"><p className="premium-kicker uppercase tracking-[0.16em]">Start here</p><h2 className="mt-3 text-balance text-2xl font-black tracking-tight sm:text-3xl">Build your first learning plan</h2><p className="mt-3 max-w-xl text-pretty leading-7 text-[var(--sf-text-muted)]" role="status" aria-live="polite">{model.message} Add a word you care about, or begin with a reviewed learning path.</p><div className="mt-6 flex flex-wrap gap-3"><button type="button" onClick={actions.openVocabulary} className={primaryButton}>Add vocabulary</button><button type="button" onClick={actions.openPaths} className={secondaryButton}>Explore learning paths</button></div></div></section>;
  }

  if (model.status === 'error') {
    return <section aria-labelledby="daily-today-heading" className="mx-auto max-w-6xl"><PageHeading model={model} /><div className="mt-6 max-w-3xl rounded-[28px] border border-rose-500/70 bg-[var(--sf-surface)] p-6 sm:p-8" role="alert" aria-live="assertive"><p className="premium-kicker uppercase tracking-[0.16em]">Plan unavailable</p><h2 className="mt-3 text-2xl font-black tracking-tight">Today needs attention</h2><p className="mt-2 max-w-xl text-[var(--sf-text-muted)]">{model.message}</p><button type="button" onClick={actions.retry} className={`${primaryButton} mt-5`}>Try again</button></div></section>;
  }

  return (
    <section aria-labelledby="daily-today-heading" className="mx-auto max-w-6xl space-y-5 sm:space-y-6">
      <header>
        <p className="premium-kicker uppercase tracking-[0.16em]">Daily learning</p>
        <PageHeading model={model} />
        <p className="mt-2 max-w-2xl text-pretty text-[var(--sf-text-muted)]" role="status" aria-live="polite">{model.message}</p>
      </header>
      {model.isOffline && <p className="rounded-xl border border-sky-500/70 bg-sky-500/10 p-3 font-semibold" role="status" aria-live="polite">Available offline · using saved learning data</p>}
      <PlanSummary model={model} actions={actions} />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(17rem,0.38fr)]">
        <PracticeModes actions={actions} />
        {model.placementAvailable && <aside aria-labelledby="placement-invite-heading" className="rounded-2xl border border-[var(--sf-border)] bg-[var(--sf-surface)] p-5"><p className="premium-kicker uppercase tracking-[0.14em]">Optional</p><h2 id="placement-invite-heading" className="mt-2 text-xl font-black tracking-tight">Not sure where to begin?</h2><p className="mt-2 text-pretty text-sm leading-6 text-[var(--sf-text-muted)]">Take a diagnostic check. It will not change your review history or unlock content.</p><button type="button" onClick={actions.startPlacement} className={`${secondaryButton} mt-4 w-full`}>Take placement check</button></aside>}
      </div>
    </section>
  );
}
