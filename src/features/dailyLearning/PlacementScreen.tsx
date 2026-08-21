import type { PlacementScreenActions, PlacementScreenModel } from './dailyLearningPresentation';
import { scriptPresentation } from '../releaseReadiness/multiScriptRelease';

interface PlacementScreenProps {
  readonly model: PlacementScreenModel;
  readonly actions: PlacementScreenActions;
}

const primaryClass = 'brand-action min-h-11 rounded-full bg-cyan-400 px-6 py-3 font-extrabold text-[#071014] shadow-lg shadow-cyan-500/25 transition-all duration-300 hover:bg-cyan-300 hover:scale-[1.03] active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none cursor-pointer';
const buttonClass = 'min-h-11 rounded-full border border-white/15 bg-white/5 px-5 py-2.5 font-bold text-white/90 transition-all duration-200 hover:border-cyan-400/50 hover:bg-white/10 hover:text-white hover:scale-[1.02] active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none cursor-pointer';
const confidenceLabels = { low: 'Low confidence', medium: 'Medium confidence', high: 'High confidence' } as const;

function PlacementHeading({ model }: { readonly model: PlacementScreenModel }) {
  return <h1 id="daily-placement-heading" ref={model.headingRef} tabIndex={-1} className="text-balance text-3xl font-black tracking-tight focus-visible:outline-2 sm:text-4xl">Placement check</h1>;
}

export function PlacementScreen({ model, actions }: PlacementScreenProps) {
  if (model.status === 'loading') {
    return <section aria-labelledby="daily-placement-heading" aria-busy="true" className="mx-auto max-w-4xl"><p className="premium-kicker uppercase tracking-[0.16em]">Diagnostic</p><PlacementHeading model={model} /><div className="skeleton-sheen mt-6 min-h-52 rounded-[28px] border border-[var(--sf-border)]" role="status" aria-live="polite"><span className="sr-only">{model.message}</span></div></section>;
  }

  if (model.status === 'intro') {
    return (
      <section aria-labelledby="daily-placement-heading" className="mx-auto max-w-4xl">
        <p className="premium-kicker uppercase tracking-[0.16em]">Diagnostic</p>
        <PlacementHeading model={model} />
        <div className="mt-6 rounded-[28px] border border-[var(--sf-border)] bg-[var(--sf-surface)] p-6 shadow-[0_28px_70px_-52px_var(--sf-shadow)] sm:p-8">
          <h2 className="text-2xl font-black tracking-tight">Find a sensible starting point</h2>
          <p className="mt-3 max-w-2xl text-pretty leading-7 text-[var(--sf-text-muted)]">{model.message}</p>
          <p className="mt-4 rounded-xl bg-[var(--sf-surface-muted)] p-4 text-sm leading-6"><strong>{model.eligibleCount} eligible words</strong> are available. This check is diagnostic and does not change learning history.</p>
          <div className="mt-6 flex flex-wrap gap-3"><button type="button" onClick={actions.start} className={primaryClass}>Start placement check</button><button type="button" onClick={actions.exit} className={buttonClass}>Back to Today</button></div>
        </div>
      </section>
    );
  }

  if (model.status === 'question') {
    const total = Math.max(1, model.total);
    const current = Math.min(total, Math.max(0, model.current));
    const percentage = current / total * 100;
    const promptScript = model.promptLanguage ? scriptPresentation(model.promptLanguage) : undefined;
    return (
      <section aria-labelledby="daily-placement-heading" className="mx-auto max-w-4xl" data-session-shell="placement">
        <header className="flex items-start justify-between gap-4">
          <div><p className="premium-kicker uppercase tracking-[0.16em]">Diagnostic</p><PlacementHeading model={model} /></div>
          <button type="button" onClick={actions.exit} className={`${buttonClass} shrink-0`}>Exit placement check</button>
        </header>
        <div className="mt-5" role="progressbar" aria-label="Placement progress" aria-valuemin={0} aria-valuemax={total} aria-valuenow={current}>
          <div className="flex justify-between gap-4 text-sm font-bold"><span>Question {current} of {total}</span><span className="tabular-nums text-[var(--sf-text-muted)]">{Math.round(percentage)}%</span></div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-[var(--sf-surface-muted)]"><div className="h-full w-full origin-left rounded-full bg-[var(--sf-brand)] transition-transform duration-200 motion-reduce:transition-none" style={{ transform: `scaleX(${percentage / 100})` }} /></div>
        </div>
        <div className="mt-6 rounded-[28px] border border-[var(--sf-border)] bg-[var(--sf-surface)] p-5 shadow-[0_28px_70px_-52px_var(--sf-shadow)] sm:p-8">
          <p className="text-xs font-extrabold uppercase tracking-[0.16em] text-[var(--sf-text-muted)]">Prompt</p>
          <div data-script-content="placement" lang={promptScript?.lang} dir={promptScript?.dir}>
            <h2 className="mt-3 text-balance text-2xl font-black tracking-tight sm:text-3xl">{model.prompt}</h2>
          </div>
          <div dir="ltr">
            <fieldset className="mt-6">
              <legend className="text-sm font-bold text-[var(--sf-text-muted)]">Choose one answer</legend>
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                {model.options.map((option) => {
                  const isSelected = model.selectedId === option.id;
                  const optionScript = option.language ? scriptPresentation(option.language) : undefined;
                  return <button key={option.id} type="button" lang={optionScript?.lang} dir={optionScript?.dir} aria-pressed={isSelected} onClick={() => actions.chooseAnswer(option.id)} className={`${buttonClass} min-h-16 text-start text-base ${isSelected ? 'border-[var(--sf-brand)] bg-[color-mix(in_srgb,var(--sf-brand)_10%,var(--sf-surface))] shadow-[inset_4px_0_0_var(--sf-brand)]' : ''}`}>{option.label}</button>;
                })}
              </div>
            </fieldset>
            <button type="button" disabled={!model.selectedId} onClick={actions.submitAnswer} className={`${primaryClass} mt-6 w-full sm:w-auto`}>Submit answer</button>
          </div>
        </div>
        <p className="sr-only" role="status" aria-live="polite">{model.message}</p>
      </section>
    );
  }

  if (model.status === 'insufficient') {
    return <section aria-labelledby="daily-placement-heading" className="mx-auto max-w-4xl"><p className="premium-kicker uppercase tracking-[0.16em]">Diagnostic</p><PlacementHeading model={model} /><div className="mt-6 rounded-[28px] border border-amber-500/70 bg-amber-500/5 p-6 sm:p-8" role="status" aria-live="polite"><h2 className="text-2xl font-black tracking-tight">Not enough evidence</h2><p className="mt-3 text-[var(--sf-text-muted)]">{model.message}</p><p className="mt-4 font-bold tabular-nums">{model.eligibleCount} of {model.requiredCount} eligible words</p><p className="mt-2 text-sm text-[var(--sf-text-muted)]">No learning path has been inferred.</p></div><div className="mt-5 flex flex-wrap gap-3"><button type="button" onClick={actions.openPaths} className={primaryClass}>Open Paths</button><button type="button" onClick={actions.exit} className={buttonClass}>Back to Today</button></div></section>;
  }

  if (model.status === 'error') {
    return <section aria-labelledby="daily-placement-heading" className="mx-auto max-w-4xl"><p className="premium-kicker uppercase tracking-[0.16em]">Diagnostic</p><PlacementHeading model={model} /><div className="mt-6 rounded-[28px] border border-rose-500/70 bg-rose-500/5 p-6 sm:p-8" role="alert" aria-live="assertive"><h2 className="text-2xl font-black tracking-tight">Placement check needs attention</h2><p className="mt-3 text-[var(--sf-text-muted)]">{model.message}</p><button type="button" onClick={actions.retry} className={`${primaryClass} mt-5`}>Try again</button></div></section>;
  }

  return (
    <section aria-labelledby="daily-placement-heading" className="mx-auto max-w-4xl">
      <p className="premium-kicker uppercase tracking-[0.16em]">Diagnostic result</p>
      <PlacementHeading model={model} />
      <div className="mt-6 rounded-[28px] border border-[var(--sf-border)] bg-[var(--sf-surface)] p-6 shadow-[0_28px_70px_-52px_var(--sf-shadow)] sm:p-8" role="status" aria-live="polite">
        <p className="premium-kicker uppercase tracking-[0.14em]">Recommended path</p>
        <h2 className="mt-2 text-3xl font-black tracking-tight">{model.recommendationLabel}</h2>
        <div className="mt-4 flex flex-wrap gap-2 text-sm font-bold"><span className="rounded-full bg-[var(--sf-surface-muted)] px-3 py-2">{confidenceLabels[model.confidence]}</span><span className="rounded-full bg-[var(--sf-surface-muted)] px-3 py-2 tabular-nums">{model.correctCount} of {model.answeredCount} correct</span></div>
        <p className="mt-5 max-w-2xl text-pretty leading-7">{model.message}</p>
        <p className="mt-4 max-w-2xl text-pretty text-sm leading-6 text-[var(--sf-text-muted)]">This is a diagnostic guide, not an official exam score. It does not change your review history, mastery, XP, or path access.</p>
      </div>
      <div className="mt-5 flex flex-wrap gap-3"><button type="button" onClick={actions.openPaths} className={primaryClass}>Open Paths</button><button type="button" onClick={actions.exit} className={buttonClass}>Back to Today</button></div>
    </section>
  );
}
