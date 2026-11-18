import type { ReactNode } from 'react';
import { i18n } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';
import { CircleHelp, Compass, X } from 'lucide-react';
import { Lumi } from '../../components/lumi/Lumi';
import { ThemeMenu } from '../../components/shell/ThemeMenu';
import { useTheme } from '../theme/ThemeProvider';
import { readLumiEnabled } from '../settings/lumi-preference';
import type { PlacementScreenActions, PlacementScreenModel } from './dailyLearningPresentation';
import './lesson-placement-canvas.css';

interface PlacementScreenProps { readonly model: PlacementScreenModel; readonly actions: PlacementScreenActions; }

const primaryClass = 'placement-primary brand-action min-h-11 rounded-2xl bg-[var(--sf-brand)] px-6 py-3 font-extrabold text-[var(--sf-on-brand)] shadow-[var(--sf-panel-shadow)] transition duration-200 hover:bg-[var(--sf-brand-hover)] active:scale-[.98] focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none';
const buttonClass = 'placement-control min-h-11 rounded-2xl border border-[var(--sf-border)] bg-[var(--sf-surface-control)] px-5 py-2.5 font-bold text-[var(--sf-text)] shadow-[var(--sf-panel-shadow)] transition duration-200 hover:border-[var(--sf-brand)] hover:bg-[var(--sf-surface-raised)] active:scale-[.98] focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none';
const confidenceLabels = {
  low: msg({ id: 'daily.placement.confidence.low', message: 'Low confidence' }),
  medium: msg({ id: 'daily.placement.confidence.medium', message: 'Medium confidence' }),
  high: msg({ id: 'daily.placement.confidence.high', message: 'High confidence' }),
};

function Shell({ children, model, actions }: { readonly children: ReactNode; readonly model: PlacementScreenModel; readonly actions: PlacementScreenActions }) {
  const { _ } = useLingui();
  return <section aria-labelledby="daily-placement-heading" className="daily-canvas placement-canvas" data-session-shell="placement" data-learning-canvas="placement" data-placement-status={model.status}>
    <header className="placement-header">
      <div className="placement-header-start">
        <button type="button" onClick={actions.exit} aria-label={i18n._(msg({ id: 'daily.placement.exit', message: 'Exit placement check' }).id)} className={`${buttonClass} placement-exit shrink-0`}><X size={17} aria-hidden="true" /></button>
        <div className="placement-heading-copy min-w-0"><h1 id="daily-placement-heading" ref={model.headingRef} tabIndex={-1} className="placement-title text-balance text-3xl font-black tracking-tight focus-visible:outline-2 sm:text-4xl">{_(msg({ id: 'daily.placement.title', message: 'Placement check' }))}</h1></div>
      </div>
      {model.status === 'question' && <Progress current={model.current} total={model.total} />}
      <div className="placement-header-actions ml-auto flex items-center gap-2"><ThemeMenu /></div>
    </header>
    {children}
  </section>;
}

function Progress({ current, total }: { readonly current: number; readonly total: number }) {
  const { _ } = useLingui();
  const safeTotal = Math.max(1, total);
  const safeCurrent = Math.min(safeTotal, Math.max(0, current));
  const percentage = safeCurrent / safeTotal * 100;
  return <div className="placement-progress" role="progressbar" aria-label={i18n._(msg({ id: 'daily.placement.progress-label', message: 'Placement progress' }).id)} aria-valuemin={0} aria-valuemax={safeTotal} aria-valuenow={safeCurrent}>
    <div className="placement-progress-copy flex justify-between gap-4 text-sm font-bold"><span>{_({ ...msg({ id: 'daily.placement.question-progress', message: 'Question {current} of {total}' }), values: { current: safeCurrent, total: safeTotal } })}</span><span className="tabular-nums text-[var(--sf-text-muted)]">{Math.round(percentage)}%</span></div>
    <div className="placement-progress-track mt-2 h-2 overflow-hidden rounded-full bg-[var(--sf-surface-muted)]"><div className="h-full w-full origin-left rounded-full bg-[var(--sf-brand)] transition-transform duration-200 motion-reduce:transition-none" style={{ transform: `scaleX(${percentage / 100})` }} /></div>
  </div>;
}

function Question({ model, actions, showLumi }: { readonly model: Extract<PlacementScreenModel, { status: 'question' }>; readonly actions: PlacementScreenActions; readonly showLumi: boolean }) {
  const { _ } = useLingui();
  return <>
    <div className="placement-layout">
      <main className="placement-question-card">
        <p className="placement-card-kicker">{_({ ...msg({ id: 'daily.placement.question-progress', message: 'Question {current} of {total}' }), values: { current: model.current, total: model.total } })}</p>
        <h2 className="placement-question-title">{_(msg({ id: 'daily.placement.intro-title', message: 'Find your starting level.' }))}</h2>
        <p className="placement-question-note">{_(msg({ id: 'daily.placement.lumi-copy', message: 'There is no score here. Choose what feels most familiar.' }))}</p>
        <div className="placement-word-block relative">
          <h3 className="placement-word mt-3 text-balance text-3xl font-black tracking-tight sm:text-5xl" lang={model.promptLanguage}>{model.prompt}</h3>
        </div>
        <fieldset className="mt-6">
          <legend className="placement-field-label font-display text-sm font-black uppercase tracking-[.12em] text-[var(--sf-text-muted)]">{_(msg({ id: 'daily.placement.choose-answer', message: 'Choose one answer' }))}</legend>
          <div className="placement-choice-grid mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {model.options.map((option, index) => {
              const selected = model.selectedId === option.id;
              return <button key={option.id} type="button" lang={option.language} aria-pressed={selected} onClick={() => actions.chooseAnswer(option.id)} className={`${buttonClass} placement-choice min-h-16 text-left ${selected ? 'placement-choice--selected border-[var(--sf-brand)] bg-[color-mix(in_srgb,var(--sf-brand)_12%,var(--sf-surface))] shadow-[inset_4px_0_0_var(--sf-brand),var(--sf-panel-shadow)]' : ''}`}><span className="placement-choice-index mr-3 inline-flex size-7 items-center justify-center rounded-full border border-current/20 bg-[var(--sf-surface-raised)] text-xs font-black" aria-hidden="true">{String.fromCharCode(65 + index)}</span><span>{option.label}</span></button>;
            })}
          </div>
        </fieldset>
        <div className="placement-action-row mt-6"><button type="button" disabled={!model.selectedId} onClick={actions.submitAnswer} className={`${primaryClass} placement-submit w-full sm:w-auto`}>{_(msg({ id: 'daily.placement.submit', message: 'Submit answer' }))}</button></div>
      </main>
      <aside className="placement-guidance crystal-chamfer border border-[var(--sf-border)] bg-[var(--sf-surface-glass)] p-5 shadow-[var(--sf-panel-shadow)]">
        <p className="placement-guidance-kicker font-display text-xs font-black uppercase tracking-[.14em] text-[var(--sf-brand-text)]">{_(msg({ id: 'daily.placement.diagnostic', message: 'Diagnostic' }))}</p>
        {showLumi && <Lumi pose="hint" size={104} className="crystal-ornament placement-lumi mx-auto" />}
        <p className="mt-3 text-lg font-black">{_(msg({ id: 'daily.placement.lumi-label', message: 'Lumi’s note' }))}</p>
        <p className="mt-2 text-sm leading-6 text-[var(--sf-text-muted)]">{_(msg({ id: 'daily.placement.lumi-copy', message: 'There is no score here. Choose what feels most familiar.' }))}</p>
      </aside>
    </div>
    <p className="sr-only" role="status">{model.message}</p>
  </>;
}

export function PlacementScreen({ model, actions }: PlacementScreenProps) {
  const { _ } = useLingui();
  const { family } = useTheme();
  const showLumi = family === 'crystal' && readLumiEnabled();
  if (model.status === 'loading') return <Shell model={model} actions={actions}><div aria-busy="true" className="placement-status-panel skeleton-sheen mt-6 min-h-52 rounded-[28px] border border-[var(--sf-border)]" role="status"><span className="sr-only">{model.message}</span></div></Shell>;
  if (model.status === 'intro') return <Shell model={model} actions={actions}>
    <div className="placement-intro-panel crystal-chamfer relative mt-6 overflow-hidden rounded-[28px] border border-[var(--sf-border)] bg-[var(--sf-surface-glass)] p-6 shadow-[var(--sf-panel-shadow)] sm:p-8">
      <Compass className="placement-intro-mark absolute right-6 top-6 text-[var(--sf-brand-text)] opacity-30" size={80} aria-hidden="true" />
      <p className="placement-panel-kicker premium-kicker uppercase tracking-[.14em]">{_(msg({ id: 'daily.placement.diagnostic', message: 'Diagnostic' }))}</p>
      <h2 className="mt-2 max-w-xl text-3xl font-black tracking-tight">{_(msg({ id: 'daily.placement.intro-title', message: 'Find your starting level.' }))}</h2>
      <p className="mt-3 max-w-2xl text-pretty leading-7 text-[var(--sf-text-muted)]">{model.message}</p>
      <p className="placement-count-note mt-4 max-w-2xl rounded-2xl bg-[var(--sf-surface-muted)] p-4 text-sm leading-6"><strong>{_({ ...msg({ id: 'daily.placement.eligible-count', message: '{count, plural, one {# eligible word} other {# eligible words}}' }), values: { count: model.eligibleCount } })}</strong>{' '}{_(msg({ id: 'daily.placement.intro-note', message: 'are available. This check is diagnostic and does not change learning history.' }))}</p>
      <div className="placement-action-row mt-6 flex flex-wrap gap-3"><button type="button" onClick={actions.start} className={primaryClass}>{_(msg({ id: 'daily.placement.start', message: 'Start placement check' }))}</button><button type="button" onClick={actions.exit} className={buttonClass}>{_(msg({ id: 'daily.placement.back-to-today', message: 'Back to Today' }))}</button></div>
    </div>
  </Shell>;
  if (model.status === 'question') return <Shell model={model} actions={actions}><Question model={model} actions={actions} showLumi={showLumi} /></Shell>;
  if (model.status === 'insufficient') return <Shell model={model} actions={actions}>
    <div className="placement-status-panel placement-insufficient crystal-chamfer mt-6 rounded-[28px] border border-[var(--sf-reward)] bg-[color-mix(in_srgb,var(--sf-reward)_10%,var(--sf-surface))] p-6 shadow-[var(--sf-panel-shadow)] sm:p-8" role="status">
      <CircleHelp size={28} className="text-[var(--sf-reward)]" aria-hidden="true" />
      <h2 className="mt-3 text-2xl font-black tracking-tight">{_(msg({ id: 'daily.placement.insufficient-title', message: 'Not enough evidence' }))}</h2>
      <p className="mt-3 text-[var(--sf-text-muted)]">{model.message}</p>
      <p className="mt-4 font-bold tabular-nums">{_({ ...msg({ id: 'daily.placement.insufficient-count', message: '{eligible} of {required} eligible words' }), values: { eligible: model.eligibleCount, required: model.requiredCount } })}</p>
      <p className="mt-2 text-sm text-[var(--sf-text-muted)]">{_(msg({ id: 'daily.placement.insufficient-note', message: 'No learning path has been inferred.' }))}</p>
    </div>
    <div className="placement-action-row mt-5 flex flex-wrap gap-3"><button type="button" onClick={actions.openPaths} className={primaryClass}>{_(msg({ id: 'daily.placement.open-paths', message: 'Open Paths' }))}</button><button type="button" onClick={actions.exit} className={buttonClass}>{_(msg({ id: 'daily.placement.back-to-today', message: 'Back to Today' }))}</button></div>
  </Shell>;
  if (model.status === 'error') return <Shell model={model} actions={actions}>
    <div className="placement-status-panel placement-error crystal-chamfer mt-6 rounded-[28px] border border-[var(--sf-danger)] bg-[color-mix(in_srgb,var(--sf-danger)_10%,var(--sf-surface))] p-6 shadow-[var(--sf-panel-shadow)] sm:p-8" role="alert">
      <h2 className="text-2xl font-black tracking-tight">{_(msg({ id: 'daily.placement.error-title', message: 'Placement check needs attention' }))}</h2>
      <p className="mt-3 text-[var(--sf-text-muted)]">{model.message}</p>
      <button type="button" onClick={actions.retry} className={`${primaryClass} mt-5`}>{_(msg({ id: 'daily.placement.retry', message: 'Try again' }))}</button>
    </div>
  </Shell>;
  return <Shell model={model} actions={actions}>
    <div className="placement-result-layout mt-6">
      <div className="placement-result-panel crystal-chamfer relative overflow-hidden rounded-[28px] border border-[var(--sf-border)] bg-[var(--sf-surface-glass)] p-6 shadow-[var(--sf-panel-shadow)] sm:p-8" role="status">
        <span className="placement-result-flare crystal-flare absolute -right-20 -top-20 size-44 opacity-25" aria-hidden="true" />
        <div className="relative">
          <p className="premium-kicker uppercase tracking-[.14em]">{_(msg({ id: 'daily.placement.result-kicker', message: 'Recommended path' }))}</p>
          <h2 className="placement-result-title mt-2 text-4xl font-black tracking-tight">{model.recommendationLabel}</h2>
          <div className="placement-result-facts mt-4 flex flex-wrap gap-2 text-sm font-bold"><span className="placement-fact rounded-full bg-[var(--sf-surface-muted)] px-3 py-2">{_(confidenceLabels[model.confidence])}</span><span className="placement-fact rounded-full bg-[var(--sf-surface-muted)] px-3 py-2 tabular-nums">{_({ ...msg({ id: 'daily.placement.correct-count', message: '{correct} of {answered} correct' }), values: { correct: model.correctCount, answered: model.answeredCount } })}</span></div>
          <p className="mt-5 max-w-2xl text-pretty leading-7">{model.message}</p>
          <p className="mt-4 max-w-2xl text-pretty text-sm leading-6 text-[var(--sf-text-muted)]">{_(msg({ id: 'daily.placement.result-note', message: 'This is a diagnostic guide, not an official exam score. It does not change your review history, mastery, XP, or path access.' }))}</p>
        </div>
      </div>
      <div className="placement-result-summary crystal-chamfer mt-4 border border-[var(--sf-border)] bg-[var(--sf-surface-glass)] p-5"><p className="placement-guidance-kicker font-display text-xs font-black uppercase tracking-[.14em] text-[var(--sf-brand-text)]">{_(msg({ id: 'daily.placement.diagnostic', message: 'Diagnostic' }))}</p><p className="mt-2 text-sm leading-6 text-[var(--sf-text-muted)]">{_(msg({ id: 'daily.placement.lumi-copy', message: 'There is no score here. Choose what feels most familiar.' }))}</p></div>
    </div>
    <div className="placement-action-row mt-5 flex flex-wrap gap-3"><button type="button" onClick={actions.openPaths} className={primaryClass}>{_(msg({ id: 'daily.placement.open-paths', message: 'Open Paths' }))}</button><button type="button" onClick={actions.exit} className={buttonClass}>{_(msg({ id: 'daily.placement.back-to-today', message: 'Back to Today' }))}</button></div>
  </Shell>;
}
