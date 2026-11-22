import type { ReactNode } from 'react';
import { i18n } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';
import { Check, CircleHelp, Play, X } from 'lucide-react';
import { Lumi } from '../../components/lumi/Lumi';
import { ThemeMenu } from '../../components/shell/ThemeMenu';
import { useTheme } from '../theme/ThemeProvider';
import { readLumiEnabled } from '../settings/lumi-preference';
import type { PlacementScreenActions, PlacementScreenModel } from './dailyLearningPresentation';
import type { PlacementConfidence, PlacementTier } from './placementEngine';
import './lesson-placement-canvas.css';

/** The running estimate from the placement engine; absent until enough answers exist to evaluate. */
interface PlacementEstimate { readonly tier: PlacementTier; readonly confidence: PlacementConfidence; }

type PlacementModel = PlacementScreenModel;
type PlacementActions = PlacementScreenActions;

interface PlacementScreenProps { readonly model: PlacementModel; readonly actions: PlacementActions; }

const confidenceLabels = {
  low: msg({ id: 'daily.placement.confidence.low', message: 'Low confidence' }),
  medium: msg({ id: 'daily.placement.confidence.medium', message: 'Medium confidence' }),
  high: msg({ id: 'daily.placement.confidence.high', message: 'High confidence' }),
};
const confidenceSteps: Record<PlacementConfidence, number> = { low: 1, medium: 2, high: 3 };

// Highest tier first, as the ladder reads from the top. Tiers come from the placement engine; the
// check is too short to support exam bands, so no CEFR code is ever shown.
const ladder: readonly { readonly tier: PlacementTier; readonly rung: number; readonly label: ReturnType<typeof msg>; readonly note: ReturnType<typeof msg> }[] = [
  { tier: 'advanced', rung: 3, label: msg({ id: 'today.placement.advanced', message: 'Advanced' }), note: msg({ id: 'daily.placement.tier.advanced.note', message: 'Nuance and academic writing' }) },
  { tier: 'core', rung: 2, label: msg({ id: 'today.placement.core', message: 'Core' }), note: msg({ id: 'daily.placement.tier.core.note', message: 'Work, study and opinions' }) },
  { tier: 'foundation', rung: 1, label: msg({ id: 'today.placement.foundation', message: 'Foundation' }), note: msg({ id: 'daily.placement.tier.foundation.note', message: 'Everyday words and short texts' }) },
];
const tierRank: Record<PlacementTier, number> = { foundation: 1, core: 2, advanced: 3 };

function PlacementLadder({ estimate, mode }: { readonly estimate?: PlacementEstimate; readonly mode: 'estimate' | 'result' | 'preview' }) {
  const { _ } = useLingui();
  const title = mode === 'result'
    ? _(msg({ id: 'daily.placement.ladder.result-title', message: 'Where you start' }))
    : _(msg({ id: 'daily.placement.ladder.title', message: 'Your estimate so far' }));
  const note = mode === 'preview'
    ? _(msg({ id: 'daily.placement.ladder.preview-note', message: 'Three tiers. The check suggests one.' }))
    : estimate
      ? _(msg({ id: 'daily.placement.ladder.note', message: 'Sharpens with every answer' }))
      : _(msg({ id: 'daily.placement.ladder.pending-note', message: 'An estimate appears after six answers' }));
  const steps = estimate ? confidenceSteps[estimate.confidence] : 0;
  return <aside className="placement-ladder" aria-labelledby="placement-ladder-title">
    <p id="placement-ladder-title" className="placement-ladder-title">{title}</p>
    <p className="placement-ladder-note">{note}</p>
    <ol className="placement-rungs">
      {ladder.map(rung => {
        const state = !estimate ? 'idle' : rung.tier === estimate.tier ? 'likely' : tierRank[rung.tier] < tierRank[estimate.tier] ? 'below' : 'above';
        return <li key={rung.tier} className="placement-rung" data-rung-state={state}>
          <span className="placement-rung-code" aria-hidden="true">{rung.rung}</span>
          <span className="placement-rung-meter" aria-hidden="true">{[1, 2, 3].map(bar => <i key={bar} data-on={bar <= rung.rung ? 'true' : 'false'} />)}</span>
          <span className="placement-rung-copy"><span className="placement-rung-name">{_(rung.label)}</span><span className="placement-rung-note">{_(rung.note)}</span></span>
          {state === 'likely' && <span className="placement-rung-flag">{mode === 'result' ? _(msg({ id: 'daily.placement.ladder.recommended', message: 'Recommended' })) : _(msg({ id: 'daily.placement.ladder.likely', message: 'Likely' }))}</span>}
          {state === 'below' && <Check size={14} strokeWidth={2.5} className="placement-rung-check" aria-hidden="true" />}
        </li>;
      })}
    </ol>
    {mode !== 'preview' && <div className="placement-confidence">
      <span className="placement-confidence-track" aria-hidden="true">{[1, 2, 3].map(step => <span key={step} data-filled={step <= steps ? 'true' : 'false'} />)}</span>
      <span className="placement-confidence-label">{estimate ? _(confidenceLabels[estimate.confidence]) : _(msg({ id: 'daily.placement.ladder.no-confidence', message: 'Not enough answers yet' }))}</span>
    </div>}
  </aside>;
}

function Shell({ children, model, actions, crystal }: { readonly children: ReactNode; readonly model: PlacementModel; readonly actions: PlacementActions; readonly crystal: boolean }) {
  const { _ } = useLingui();
  return <section aria-labelledby="daily-placement-heading" className="daily-canvas placement-canvas" data-session-shell="placement" data-learning-canvas="placement" data-placement-status={model.status}>
    {crystal && <><span className="lesson-shard lesson-shard--left crystal-wing crystal-ornament" aria-hidden="true" /><span className="lesson-shard lesson-shard--right crystal-wing crystal-ornament" aria-hidden="true" /></>}
    <header className="placement-header lesson-topbar">
      <button type="button" onClick={actions.exit} aria-label={i18n._(msg({ id: 'daily.placement.exit', message: 'Exit placement check' }).id)} className="lesson-round placement-exit"><X size={18} aria-hidden="true" /></button>
      <div className="lesson-topbar-title min-w-0"><h1 id="daily-placement-heading" ref={model.headingRef} tabIndex={-1} className="lesson-title placement-title">
        <span className="placement-title-kicker" aria-hidden="true">{_(msg({ id: 'daily.placement.title-kicker', message: 'Level check' }))}<span className="lesson-title-sep"> // </span></span>
        <span>{_(msg({ id: 'daily.placement.title', message: 'Placement check' }))}</span>
      </h1></div>
      {model.status === 'question' ? <><Progress current={model.current} total={model.total} /><span className="lesson-count placement-count font-mono tabular-nums" aria-hidden="true"><strong>{model.current}</strong><span> / {model.total}</span></span></> : <span className="placement-progress-spacer" aria-hidden="true" />}
      {model.status === 'question' && <button type="button" onClick={actions.exit} className="lesson-link placement-skip">{_(msg({ id: 'daily.placement.skip', message: 'Skip placement' }))}</button>}
      <div className="lesson-topbar-actions"><ThemeMenu /></div>
    </header>
    {children}
  </section>;
}

function Progress({ current, total }: { readonly current: number; readonly total: number }) {
  const { _ } = useLingui();
  const safeTotal = Math.max(1, total);
  const safeCurrent = Math.min(safeTotal, Math.max(0, current));
  return <div className="placement-progress lesson-progress" role="progressbar" aria-label={i18n._(msg({ id: 'daily.placement.progress-label', message: 'Placement progress' }).id)} aria-valuemin={0} aria-valuemax={safeTotal} aria-valuenow={safeCurrent}>
    <span className="lesson-segments" aria-hidden="true">{Array.from({ length: safeTotal }, (_, index) => <span key={index} data-segment-state={index < safeCurrent - 1 ? 'complete' : index === safeCurrent - 1 ? 'current' : 'upcoming'} />)}</span>
    <span className="placement-progress-copy sr-only">{_({ ...msg({ id: 'daily.placement.question-progress', message: 'Question {current} of {total}' }), values: { current: safeCurrent, total: safeTotal } })}</span>
  </div>;
}

function LumiNote({ show, pose, children }: { readonly show: boolean; readonly pose: 'hint' | 'happy'; readonly children: ReactNode }) {
  const { _ } = useLingui();
  if (!show) return null;
  return <aside className="placement-lumi" aria-label={i18n._(msg({ id: 'daily.placement.lumi-label', message: 'Lumi’s note' }).id)}>
    <Lumi pose={pose} size={168} className="crystal-ornament placement-lumi-figure" />
    <div className="lesson-lumi-bubble"><p className="lesson-lumi-label">{_(msg({ id: 'daily.placement.lumi-label', message: 'Lumi’s note' }))}</p><p className="lesson-lumi-copy">{children}</p></div>
  </aside>;
}

function Headline({ id }: { readonly id?: string }) {
  const { _ } = useLingui();
  return <h2 id={id} className="placement-question-title">
    {_(msg({ id: 'daily.placement.headline.lead', message: 'Find your' }))}{' '}<em className="placement-accent">{_(msg({ id: 'daily.placement.headline.accent', message: 'starting level.' }))}</em>
  </h2>;
}

function Question({ model, actions, showLumi }: { readonly model: Extract<PlacementModel, { status: 'question' }>; readonly actions: PlacementActions; readonly showLumi: boolean }) {
  const { _ } = useLingui();
  const lumiCopy = _(msg({ id: 'daily.placement.lumi-copy', message: 'There is no score here. Choose what feels most familiar.' }));
  return <>
    <div className="placement-layout">
      <div className="placement-question-card">
        <p className="placement-card-kicker">{_({ ...msg({ id: 'daily.placement.question-progress', message: 'Question {current} of {total}' }), values: { current: model.current, total: model.total } })}</p>
        <Headline />
        <p className="placement-question-note">{_(msg({ id: 'daily.placement.question-note', message: 'No score, no pressure. Your answers only shape where your learning starts.' }))}</p>
        <div className="placement-word-block">
          <span className="placement-word-mark" aria-hidden="true"><CircleHelp size={18} /></span>
          <h3 className="placement-word" lang={model.promptLanguage}>{model.word ?? model.prompt}</h3>
          {model.word && model.phonetic && <span className="placement-phonetic font-mono">{model.phonetic}</span>}
          {model.canPlayAudio && actions.playAudio && <button type="button" onClick={actions.playAudio} className="placement-play" aria-label={i18n._(msg({ id: 'daily.lesson.play-audio', message: 'Play audio' }).id)}><Play size={12} fill="currentColor" aria-hidden="true" /></button>}
        </div>
        <fieldset className="placement-choices">
          <legend className="placement-field-label">{model.word ? model.prompt : _(msg({ id: 'daily.placement.choose-answer', message: 'Choose one answer' }))}</legend>
          <div className="placement-choice-grid">
            {model.options.map((option, index) => {
              const selected = model.selectedId === option.id;
              return <button key={option.id} type="button" lang={option.language} aria-pressed={selected} onClick={() => actions.chooseAnswer(option.id)} className="placement-choice lesson-choice" data-selected={selected ? 'true' : 'false'}><span className="lesson-choice-index font-mono" aria-hidden="true">{index + 1}</span><span className="min-w-0">{option.label}</span></button>;
            })}
          </div>
        </fieldset>
        <div className="placement-action-row">
          <button type="button" disabled={!model.selectedId} onClick={actions.submitAnswer} className="lesson-primary placement-submit">{_(msg({ id: 'daily.placement.next-question', message: 'Next question' }))}</button>
          {actions.markUnsure && <button type="button" onClick={actions.markUnsure} className="lesson-link">{_(msg({ id: 'daily.placement.unsure', message: 'I’m not sure' }))}</button>}
        </div>
        {!showLumi && <p className="placement-guidance-copy">{lumiCopy}</p>}
      </div>
      <PlacementLadder estimate={model.estimate} mode="estimate" />
    </div>
    <LumiNote show={showLumi} pose="hint">{lumiCopy}</LumiNote>
    <p className="sr-only" role="status">{model.message}</p>
  </>;
}

export function PlacementScreen({ model, actions }: PlacementScreenProps) {
  const { _ } = useLingui();
  const { family } = useTheme();
  const crystal = family === 'crystal';
  const showLumi = crystal && readLumiEnabled();
  const backToToday = <button type="button" onClick={actions.exit} className="lesson-secondary">{_(msg({ id: 'daily.placement.back-to-today', message: 'Back to Today' }))}</button>;
  if (model.status === 'loading') return <Shell model={model} actions={actions} crystal={crystal}><div className="placement-layout"><div aria-busy="true" className="placement-status-panel skeleton-sheen" role="status"><span className="sr-only">{model.message}</span></div></div></Shell>;
  if (model.status === 'intro') return <Shell model={model} actions={actions} crystal={crystal}>
    <div className="placement-layout">
      <div className="placement-question-card placement-intro-panel">
        <p className="placement-card-kicker">{_(msg({ id: 'daily.placement.diagnostic', message: 'Diagnostic' }))}</p>
        <Headline />
        <p className="placement-question-note">{model.message}</p>
        <p className="placement-count-note"><strong>{_({ ...msg({ id: 'daily.placement.eligible-count', message: '{count, plural, one {# eligible word} other {# eligible words}}' }), values: { count: model.eligibleCount } })}</strong>{' '}{_(msg({ id: 'daily.placement.intro-note', message: 'are available. This check is diagnostic and does not change learning history.' }))}</p>
        <div className="placement-action-row"><button type="button" onClick={actions.start} className="lesson-primary">{_(msg({ id: 'daily.placement.start', message: 'Start placement check' }))}</button>{backToToday}</div>
      </div>
      <PlacementLadder mode="preview" />
    </div>
    <LumiNote show={showLumi} pose="hint">{_(msg({ id: 'daily.placement.lumi-copy', message: 'There is no score here. Choose what feels most familiar.' }))}</LumiNote>
  </Shell>;
  if (model.status === 'question') return <Shell model={model} actions={actions} crystal={crystal}><Question model={model} actions={actions} showLumi={showLumi} /></Shell>;
  if (model.status === 'insufficient') return <Shell model={model} actions={actions} crystal={crystal}>
    <div className="placement-layout">
      <div className="placement-question-card">
        <div className="placement-status-panel placement-insufficient" role="status">
          <CircleHelp size={28} className="placement-status-icon" aria-hidden="true" />
          <h2 className="placement-status-title">{_(msg({ id: 'daily.placement.insufficient-title', message: 'Not enough evidence' }))}</h2>
          <p className="placement-question-note">{model.message}</p>
          <p className="placement-status-count tabular-nums">{_({ ...msg({ id: 'daily.placement.insufficient-count', message: '{eligible} of {required} eligible words' }), values: { eligible: model.eligibleCount, required: model.requiredCount } })}</p>
          <p className="placement-guidance-copy">{_(msg({ id: 'daily.placement.insufficient-note', message: 'No learning path has been inferred.' }))}</p>
        </div>
        <div className="placement-action-row"><button type="button" onClick={actions.openPaths} className="lesson-primary">{_(msg({ id: 'daily.placement.open-paths', message: 'Open Paths' }))}</button>{backToToday}</div>
      </div>
    </div>
  </Shell>;
  if (model.status === 'error') return <Shell model={model} actions={actions} crystal={crystal}>
    <div className="placement-layout">
      <div className="placement-question-card">
        <div className="placement-status-panel placement-error" role="alert">
          <h2 className="placement-status-title">{_(msg({ id: 'daily.placement.error-title', message: 'Placement check needs attention' }))}</h2>
          <p className="placement-question-note">{model.message}</p>
          <button type="button" onClick={actions.retry} className="lesson-primary mt-5">{_(msg({ id: 'daily.placement.retry', message: 'Try again' }))}</button>
        </div>
      </div>
    </div>
  </Shell>;
  return <Shell model={model} actions={actions} crystal={crystal}>
    <div className="placement-layout placement-result-layout">
      <div className="placement-question-card placement-result-panel" role="status">
        <p className="placement-card-kicker">{_(msg({ id: 'daily.placement.result-kicker', message: 'Recommended path' }))}</p>
        <h2 className="placement-question-title placement-result-title"><em className="placement-accent">{model.recommendationLabel}</em></h2>
        <div className="placement-result-facts"><span className="placement-fact">{_(confidenceLabels[model.confidence])}</span><span className="placement-fact tabular-nums">{_({ ...msg({ id: 'daily.placement.correct-count', message: '{correct} of {answered} correct' }), values: { correct: model.correctCount, answered: model.answeredCount } })}</span></div>
        <p className="placement-result-message">{model.message}</p>
        <p className="placement-guidance-copy">{_(msg({ id: 'daily.placement.result-note', message: 'This is a diagnostic guide, not an official exam score. It does not change your review history, mastery, XP, or path access.' }))}</p>
        <div className="placement-action-row"><button type="button" onClick={actions.openPaths} className="lesson-primary">{_(msg({ id: 'daily.placement.open-paths', message: 'Open Paths' }))}</button>{backToToday}</div>
      </div>
      <PlacementLadder estimate={{ tier: model.recommendation, confidence: model.confidence }} mode="result" />
    </div>
    <LumiNote show={showLumi} pose="happy">{_(msg({ id: 'today.placement.result', message: 'Your answers suggest starting here.' }))}</LumiNote>
  </Shell>;
}
