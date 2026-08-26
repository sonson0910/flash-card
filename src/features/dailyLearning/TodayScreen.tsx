import {
  Brain,
  ChevronDown,
  Eye,
  Headphones,
  PenLine,
  Puzzle,
  Shuffle,
  Sparkles,
  Zap,
} from 'lucide-react';
import type { LessonMode, TodayScreenActions, TodayScreenModel } from './dailyLearningPresentation';

interface TodayScreenProps {
  readonly model: TodayScreenModel;
  readonly actions: TodayScreenActions;
}

const lessonModes: ReadonlyArray<{
  id: LessonMode;
  label: string;
  description: string;
  tag: string;
  Icon: React.ComponentType<{ size?: number; className?: string }>;
  accentColor: string;
}> = [
  { id: 'recognition', label: 'Recognition', description: 'Choose the meaning you recognize.', tag: 'Quick recall', Icon: Eye, accentColor: 'from-cyan-500/20 to-sky-500/10 text-cyan-700 dark:text-cyan-300 border-cyan-500/30' },
  { id: 'active-recall', label: 'Active recall', description: 'Recall the answer without choices.', tag: 'Deep memory', Icon: Brain, accentColor: 'from-indigo-500/20 to-purple-500/10 text-indigo-700 dark:text-indigo-300 border-indigo-500/30' },
  { id: 'listening', label: 'Listening', description: 'Listen, then identify the word.', tag: 'Ear training', Icon: Headphones, accentColor: 'from-sky-500/20 to-blue-500/10 text-sky-700 dark:text-sky-300 border-sky-500/30' },
  { id: 'spelling', label: 'Spelling', description: 'Type the word from its meaning.', tag: 'Precision', Icon: PenLine, accentColor: 'from-amber-500/20 to-orange-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30' },
  { id: 'cloze', label: 'Cloze', description: 'Complete a real example sentence.', tag: 'Context', Icon: Puzzle, accentColor: 'from-emerald-500/20 to-teal-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30' },
  { id: 'sentence-building', label: 'Sentence building', description: 'Put every word occurrence in order.', tag: 'Structure', Icon: Shuffle, accentColor: 'from-violet-500/20 to-fuchsia-500/10 text-violet-700 dark:text-violet-300 border-violet-500/30' },
];

const featuredLessonModes = lessonModes.slice(0, 3);
const additionalLessonModes = lessonModes.slice(3);

const primaryButton = 'brand-action shimmer-sweep min-h-11 rounded-full bg-[var(--sf-brand)] px-6 py-3 font-extrabold text-[var(--sf-on-brand)] shadow-md shadow-sky-600/20 transition-all duration-300 hover:brightness-110 hover:scale-[1.03] active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 motion-reduce:transition-none cursor-pointer';
const secondaryButton = 'min-h-11 rounded-full border border-slate-200 bg-slate-100/90 dark:border-white/15 dark:bg-white/5 px-5 py-2.5 font-bold text-slate-800 dark:text-white/90 transition-all duration-200 hover:border-cyan-400/50 hover:bg-slate-200 dark:hover:bg-white/10 hover:text-slate-900 dark:hover:text-white hover:scale-[1.02] active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 motion-reduce:transition-none cursor-pointer';
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
    <section aria-labelledby="daily-plan-heading" className="liquid-glass rounded-[28px] border border-[var(--sf-border)] p-6 sm:p-7 shadow-[0_28px_70px_-52px_var(--sf-shadow)]">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(16rem,0.52fr)] lg:items-end">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <span className="flex items-center gap-1.5 rounded-full border border-cyan-500/30 bg-cyan-500/10 px-3 py-1 text-[11px] font-black uppercase tracking-[0.16em] text-cyan-800 dark:text-cyan-300">
              <Sparkles size={13} className="shrink-0 text-cyan-600 dark:text-cyan-400" />
              Daily focus
            </span>
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

      <ol className="mt-6 grid overflow-hidden rounded-[22px] border border-[var(--sf-border)] bg-[var(--sf-surface)] sm:grid-cols-3" aria-label="Daily plan order">
        {planStages.map((stage, index) => (
          <li key={stage.key} className="flex min-w-0 gap-3.5 border-b border-[var(--sf-border)] p-4 last:border-b-0 sm:border-b-0 sm:border-r sm:p-5 sm:last:border-r-0">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full border border-cyan-500/25 bg-cyan-500/10 text-xs font-black tabular-nums text-[var(--sf-brand-text)]" aria-hidden="true">
              0{index + 1}
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-extrabold text-[var(--sf-text)]">{stage.label}</p>
              <p className="mt-0.5 text-sm font-semibold text-[var(--sf-brand-text)]">{plan[stage.key]} {stage.key === 'fresh' ? 'new' : stage.key}</p>
              <p className="mt-1.5 text-pretty text-xs leading-5 text-[var(--sf-text-muted)]">{stage.description}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
function PracticeModes({ actions }: Pick<TodayScreenProps, 'actions'>) {
  return (
    <section aria-labelledby="practice-mode-heading" className="rounded-[28px] border border-[var(--sf-border)] bg-[var(--sf-surface)] p-5 shadow-[0_18px_48px_-38px_var(--sf-shadow)] sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-1.5">
            <Zap size={14} className="text-cyan-700 dark:text-cyan-400" />
            <p className="premium-kicker uppercase tracking-[0.14em]">Extra practice</p>
          </div>
          <h2 id="practice-mode-heading" className="mt-1 text-xl font-black tracking-tight">Practice your way</h2>
          <p className="mt-1 text-sm text-[var(--sf-text-muted)]">Use another exercise when you want a different kind of recall.</p>
        </div>
        <button type="button" onClick={event => actions.openMorePractice(event.currentTarget)} className="liquid-control min-h-10 rounded-full px-4 py-2 text-sm font-bold text-[var(--sf-text)] transition-all hover:border-[var(--sf-brand)] hover:scale-105 active:scale-95 cursor-pointer">More practice</button>
      </div>
      <div className="mt-5 grid grid-cols-1 gap-3 border-t border-[var(--sf-border)] pt-5 sm:grid-cols-3">
          {featuredLessonModes.map((mode) => (
            <button
              key={mode.id}
              type="button"
              data-practice-mode="true"
              onClick={() => actions.startLesson(mode.id)}
              className="practice-bento-card min-h-24 rounded-xl group flex flex-col justify-between p-4 text-left cursor-pointer focus-visible:outline-2 focus-visible:outline-[var(--sf-brand)]"
            >
              <div className="flex items-start justify-between gap-2">
                <div className={`flex size-9 items-center justify-center rounded-xl border bg-gradient-to-br ${mode.accentColor} shadow-xs transition-transform duration-200 group-hover:scale-110`}>
                  <mode.Icon size={18} />
                </div>
                <span className="rounded-full border border-slate-200/90 bg-slate-100/90 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-700 dark:border-white/10 dark:bg-white/5 dark:text-slate-300">
                  {mode.tag}
                </span>
              </div>
              <div className="mt-3">
                <span className="block text-sm font-black text-[var(--sf-text)] group-hover:text-[var(--sf-brand)] transition-colors">{mode.label}</span>
                <span className="mt-0.5 block text-xs leading-5 text-[var(--sf-text-muted)]">{mode.description}</span>
              </div>
            </button>
          ))}
      </div>
      <details className="group mt-3">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between rounded-xl px-2 text-sm font-bold text-[var(--sf-brand-text)] hover:bg-[var(--sf-surface-raised)] focus-visible:outline-2 focus-visible:outline-offset-2 [&::-webkit-details-marker]:hidden">
          <span>More lesson modes</span>
          <ChevronDown size={16} className="transition-transform duration-200 group-open:rotate-180 motion-reduce:transition-none" aria-hidden="true" />
        </summary>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {additionalLessonModes.map((mode) => (
            <button
              key={mode.id}
              type="button"
              data-practice-catalog-mode="true"
              onClick={() => actions.startLesson(mode.id)}
              className="practice-bento-card min-h-20 rounded-xl p-4 text-left cursor-pointer focus-visible:outline-2 focus-visible:outline-[var(--sf-brand)]"
            >
              <span className="flex items-center gap-2 font-black text-[var(--sf-text)]"><mode.Icon size={17} className="text-[var(--sf-brand-text)]" />{mode.label}</span>
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
    return (
      <section aria-labelledby="daily-today-heading" className="mx-auto max-w-6xl">
        <p className="premium-kicker uppercase tracking-[0.16em]">Daily learning</p>
        <PageHeading model={model} />
        <div className="liquid-glass mt-6 max-w-3xl rounded-[28px] border border-[var(--sf-border)] p-6 sm:p-8 shadow-[0_28px_70px_-52px_var(--sf-shadow)]">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-cyan-500/30 bg-cyan-500/10 px-3 py-1 text-[11px] font-black uppercase tracking-[0.16em] text-cyan-800 dark:text-cyan-300">
            <Sparkles size={13} className="text-cyan-600 dark:text-cyan-400" />
            Start here
          </span>
          <h2 className="mt-3 text-balance text-2xl font-black tracking-tight sm:text-3xl">Build your first learning plan</h2>
          <p className="mt-3 max-w-xl text-pretty leading-7 text-[var(--sf-text-muted)]" role="status" aria-live="polite">{model.message} Add a word you care about, or begin with a reviewed learning path.</p>
          <div className="mt-6 flex flex-wrap gap-3">
            <button type="button" onClick={actions.openVocabulary} className={primaryButton}>Add vocabulary</button>
            <button type="button" onClick={actions.openPaths} className={secondaryButton}>Explore learning paths</button>
          </div>
        </div>
      </section>
    );
  }

  if (model.status === 'error') {
    return (
      <section aria-labelledby="daily-today-heading" className="mx-auto max-w-6xl">
        <PageHeading model={model} />
        <div className="mt-6 max-w-3xl rounded-[28px] border border-rose-500/70 bg-[var(--sf-surface)] p-6 sm:p-8" role="alert" aria-live="assertive">
          <p className="premium-kicker uppercase tracking-[0.16em]">Plan unavailable</p>
          <h2 className="mt-3 text-2xl font-black tracking-tight">Today needs attention</h2>
          <p className="mt-2 max-w-xl text-[var(--sf-text-muted)]">{model.message}</p>
          <button type="button" onClick={actions.retry} className={`${primaryButton} mt-5`}>Try again</button>
        </div>
      </section>
    );
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
        {model.placementAvailable && (
          <aside aria-labelledby="placement-invite-heading" className="liquid-glass rounded-[28px] border border-[var(--sf-border)] p-5 sm:p-6">
            <p className="premium-kicker uppercase tracking-[0.14em]">Optional</p>
            <h2 id="placement-invite-heading" className="mt-2 text-xl font-black tracking-tight">Not sure where to begin?</h2>
            <p className="mt-2 text-pretty text-sm leading-6 text-[var(--sf-text-muted)]">Take a diagnostic check. It will not change your review history or unlock content.</p>
            <button type="button" onClick={actions.startPlacement} className={`${secondaryButton} mt-5 w-full`}>Take placement check</button>
          </aside>
        )}
      </div>
    </section>
  );
}
