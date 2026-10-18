import { useEffect, useRef, type FormEvent } from 'react';
import { i18n } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';
import { CheckCircle2, Volume2, X } from 'lucide-react';
import { GsapEntrance } from '../../components/motion/GsapEntrance';
import { Lumi } from '../../components/lumi/Lumi';
import { ThemeMenu } from '../../components/shell/ThemeMenu';
import { triggerHaptic } from '../../lib/haptics';
import { createImeSubmitGuard } from '../../lib/imeSubmitGuard';
import { playSuccessSound } from '../../lib/interactionSounds';
import { useTheme } from '../theme/ThemeProvider';
import { readLumiEnabled } from '../settings/lumi-preference';
import { reviewFeedbackCue, type LessonScreenActions, type LessonScreenModel } from './dailyLearningPresentation';
import './lesson-placement-canvas.css';

interface LessonScreenProps { readonly model: LessonScreenModel; readonly actions: LessonScreenActions; }

const actionClass = 'lesson-control min-h-11 rounded-2xl border border-[var(--sf-border)] bg-[var(--sf-surface-control)] px-5 py-2.5 font-bold text-[var(--sf-text)] shadow-[var(--sf-panel-shadow)] transition duration-200 hover:border-[var(--sf-brand)] hover:bg-[var(--sf-surface-raised)] active:scale-[.98] focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none';
const primaryClass = 'lesson-primary brand-action min-h-11 rounded-2xl bg-[var(--sf-brand)] px-6 py-3 font-extrabold text-[var(--sf-on-brand)] shadow-[var(--sf-panel-shadow)] transition duration-200 hover:bg-[var(--sf-brand-hover)] active:scale-[.98] focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none';
const ratings = [
  { id: 'again', label: msg({ id: 'daily.lesson.rating.again', message: 'Again' }), description: msg({ id: 'daily.lesson.rating.again.description', message: 'I did not remember' }) },
  { id: 'hard', label: msg({ id: 'daily.lesson.rating.hard', message: 'Hard' }), description: msg({ id: 'daily.lesson.rating.hard.description', message: 'I remembered with difficulty' }) },
  { id: 'good', label: msg({ id: 'daily.lesson.rating.good', message: 'Good' }), description: msg({ id: 'daily.lesson.rating.good.description', message: 'I remembered correctly' }) },
  { id: 'easy', label: msg({ id: 'daily.lesson.rating.easy', message: 'Easy' }), description: msg({ id: 'daily.lesson.rating.easy.description', message: 'I remembered immediately' }) },
] as const;

function AnswerControl({ model, actions }: LessonScreenProps) {
  const { _ } = useLingui();
  const disabled = model.status !== 'answering';
  if (model.answer.kind === 'choice') {
    const answer = model.answer;
    return <fieldset className="mt-6" disabled={disabled}>
      <legend className="lesson-field-label font-display text-sm font-black uppercase tracking-[.12em] text-[var(--sf-text-muted)]">{_(msg({ id: 'daily.lesson.choose-answer', message: 'Choose one answer' }))}</legend>
      <div className="lesson-choice-grid mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {answer.options.map((option, index) => {
          const selected = answer.selectedId === option.id;
          return <button
            key={option.id}
            type="button"
            lang={option.language}
            aria-pressed={selected}
            onClick={() => actions.chooseAnswer(option.id)}
            className={`${actionClass} lesson-choice min-h-16 text-left ${selected ? 'lesson-choice--selected border-[var(--sf-brand)] bg-[color-mix(in_srgb,var(--sf-brand)_12%,var(--sf-surface))] shadow-[inset_4px_0_0_var(--sf-brand),var(--sf-panel-shadow)]' : ''}`}
          >
            <span className="lesson-choice-index mr-3 inline-flex size-7 items-center justify-center rounded-full border border-current/20 bg-[var(--sf-surface-raised)] text-xs font-black" aria-hidden="true">{String.fromCharCode(65 + index)}</span>
            <span>{option.label}</span>
          </button>;
        })}
      </div>
    </fieldset>;
  }
  if (model.answer.kind === 'text') return <div className="mt-6">
    <label htmlFor="daily-lesson-answer" className="lesson-field-label block font-display text-sm font-black uppercase tracking-[.12em] text-[var(--sf-text-muted)]">{model.answer.label}</label>
    <input
      id="daily-lesson-answer"
      name="daily-lesson-answer"
      type="text"
      lang={model.answer.language}
      inputMode={model.answer.inputMode}
      autoComplete="off"
      autoCapitalize="off"
      autoCorrect="off"
      spellCheck={false}
      disabled={disabled}
      value={model.answer.value}
      onChange={event => actions.changeTextAnswer(event.target.value)}
      className="lesson-text-input crystal-chamfer-sm mt-2 min-h-14 w-full rounded-2xl border border-[var(--sf-border)] bg-[var(--sf-surface-control)] px-4 py-3 text-lg font-semibold text-[var(--sf-text)] shadow-[var(--sf-panel-shadow)] focus-visible:outline-2 focus-visible:outline-offset-2"
    />
  </div>;
  return <fieldset className="mt-6" disabled={disabled}>
    <legend className="lesson-field-label font-display text-sm font-black uppercase tracking-[.12em] text-[var(--sf-text-muted)]">{_(msg({ id: 'daily.lesson.build-sentence', message: 'Build the sentence' }))}</legend>
    <p className="mt-1 text-sm text-[var(--sf-text-muted)]">{_(msg({ id: 'daily.lesson.sentence-help', message: 'Select each word occurrence in order. Select it again to remove it.' }))}</p>
    <div className="lesson-token-list mt-4 flex flex-wrap gap-2">
      {model.answer.tokens.map(token => <button key={token.occurrenceId} type="button" lang={token.language} data-occurrence-id={token.occurrenceId} aria-pressed={token.isSelected} onClick={() => actions.toggleSentenceToken(token.occurrenceId)} className={`${actionClass} lesson-token ${token.isSelected ? 'lesson-token--selected border-[var(--sf-brand)] bg-[color-mix(in_srgb,var(--sf-brand)_12%,var(--sf-surface))]' : ''}`}>{token.label}</button>)}
    </div>
    <div className="lesson-sentence-output crystal-chamfer-sm mt-5 min-h-20 rounded-2xl border border-dashed border-[var(--sf-border)] bg-[var(--sf-surface-muted)] p-4" aria-live="polite">
      <p className="lesson-field-label font-display text-sm font-black uppercase tracking-[.12em] text-[var(--sf-text-muted)]">{_(msg({ id: 'daily.lesson.your-sentence', message: 'Your sentence' }))}</p>
      {model.answer.selectedOrder.length ? <ol className="mt-2 flex flex-wrap gap-x-3 gap-y-2 text-base font-semibold">{model.answer.selectedOrder.map((token, index) => <li key={token.occurrenceId} lang={token.language}>{index + 1}. {token.label}</li>)}</ol> : <p className="mt-1 text-sm text-[var(--sf-text-muted)]">{_(msg({ id: 'daily.lesson.no-words', message: 'No words selected yet.' }))}</p>}
    </div>
  </fieldset>;
}

function Feedback({ model, actions }: LessonScreenProps) {
  const { _ } = useLingui();
  if (!model.feedback || model.status === 'answering' || model.status === 'complete') return null;
  const saving = model.status === 'rating-saving';
  const tone = model.feedback.outcome === 'correct' ? 'lesson-feedback--correct border-[var(--sf-success)] bg-[color-mix(in_srgb,var(--sf-success)_10%,var(--sf-surface))]' : 'lesson-feedback--incorrect border-[var(--sf-reward)] bg-[color-mix(in_srgb,var(--sf-reward)_10%,var(--sf-surface))]';
  return <section aria-labelledby="lesson-feedback-heading" className={`lesson-feedback crystal-chamfer relative mt-5 overflow-hidden rounded-[28px] border p-5 shadow-[var(--sf-panel-shadow)] sm:p-6 ${tone}`}>
    <div className="lesson-feedback-rule" aria-hidden="true" />
    <div role="status" aria-live="polite" aria-atomic="true">
      <p className="lesson-field-label font-display text-xs font-black uppercase tracking-[.16em] text-[var(--sf-text-muted)]">{_(msg({ id: 'daily.lesson.answer-feedback', message: 'Answer feedback' }))}</p>
      <h2 id="lesson-feedback-heading" className="mt-2 flex items-center gap-2 text-2xl font-black tracking-tight"><CheckCircle2 size={23} aria-hidden="true" />{model.feedback.message}</h2>
      <p className="mt-3"><strong>{_(msg({ id: 'daily.lesson.correct-answer', message: 'Correct answer:' }))}</strong> <span lang={model.feedback.answerLanguage}>{model.feedback.expectedAnswer}</span></p>
      {model.feedback.explanation && <p className="mt-2 max-w-2xl text-pretty text-sm leading-6 text-[var(--sf-text-muted)]">{model.feedback.explanation}</p>}
    </div>
    {model.status === 'rating-error' && <div className="lesson-feedback-error mt-5 rounded-2xl border border-[var(--sf-danger)] bg-[var(--sf-surface)] p-4" role="alert"><p>{model.errorMessage}</p><button type="button" onClick={actions.retryRating} className={`${actionClass} mt-3`}>{_(msg({ id: 'daily.lesson.retry-rating', message: 'Retry saving rating' }))}</button></div>}
    <fieldset className="mt-5" disabled={saving || model.status === 'rating-error'} aria-busy={saving || undefined}>
      <legend className="text-lg font-black">{_(msg({ id: 'daily.lesson.rate-memory', message: 'How well did you remember?' }))}</legend>
      <p className="mt-1 text-sm text-[var(--sf-text-muted)]">{_(msg({ id: 'daily.lesson.rate-memory-help', message: 'Choose one rating to save this review and continue.' }))}</p>
      <div className="lesson-rating-grid mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">{ratings.map(rating => <button key={rating.id} type="button" onClick={() => { triggerHaptic('light'); actions.rate(rating.id); }} className={`${actionClass} lesson-rating text-left`}><span className="block">{_(rating.label)}</span><span className="mt-1 block text-xs font-normal leading-4 text-[var(--sf-text-muted)]">{_(rating.description)}</span></button>)}</div>
      {saving && <p className="mt-3" role="status">{_(msg({ id: 'daily.lesson.saving', message: 'Saving your rating before the next question…' }))}</p>}
    </fieldset>
  </section>;
}

const ProgressSegments = ({ total, current }: { readonly total: number; readonly current: number }) => <div className="lesson-sequence-track" aria-hidden="true">{Array.from({ length: total }, (_, index) => <span key={index} data-segment-state={index < current - 1 ? 'complete' : index === current - 1 ? 'current' : 'upcoming'} />)}</div>;

function CardDetails({ model }: LessonScreenProps) {
  const card = model.card;
  if (!card) return null;
  return (
    <div className="mt-5 rounded-2xl border border-[var(--sf-border)] bg-[var(--sf-surface-muted)] p-5">
      <h2 className="text-3xl font-black tracking-tight">{card.word}</h2>
      <p className="mt-2 text-xl font-semibold" lang={model.card?.translationLanguage || 'vi'}>{card.translation}</p>
      {card.phonetic && <p className="mt-2 text-sm text-[var(--sf-text-muted)]">{card.phonetic}</p>}
      {card.explanation && <p className="mt-4 leading-6 text-[var(--sf-text-muted)]">{card.explanation}</p>}
      {card.exampleSentence && <p className="mt-4 font-semibold">“{card.exampleSentence}”</p>}
      {card.exampleTranslation && <p className="mt-1 text-sm text-[var(--sf-text-muted)]" lang={model.card?.translationLanguage || 'vi'}>{card.exampleTranslation}</p>}
    </div>
  );
}

function Introduction({ model, actions }: LessonScreenProps) {
  const { _ } = useLingui();
  return (
    <section aria-labelledby="daily-lesson-heading" className="mx-auto max-w-3xl py-6 sm:py-12" data-session-shell="lesson">
      <header className="flex items-start justify-between gap-4">
        <div><p className="premium-kicker uppercase tracking-[0.16em]">{_(msg({ id: 'daily.lesson.guidance.0', message: 'Introduction' }))}</p><h1 id="daily-lesson-heading" ref={model.headingRef} tabIndex={-1} className="mt-2 text-3xl font-black tracking-tight focus-visible:outline-2 sm:text-4xl">{_(msg({ id: 'daily.lesson.guidance.1', message: 'Meet this word' }))}</h1></div>
        <button type="button" onClick={actions.exit} className={`${actionClass} shrink-0`}>{_(msg({ id: 'daily.lesson.guidance.2', message: 'Exit lesson' }))}</button>
      </header>
      <CardDetails model={model} actions={actions} />
      {model.canPlayAudio && <button type="button" onClick={actions.playAudio} className={`${actionClass} mt-5`}>{_(msg({ id: 'daily.lesson.guidance.3', message: 'Play audio' }))}</button>}
      {model.audioErrorMessage && <p className="mt-4 rounded-xl border border-rose-500/70 bg-rose-500/5 p-4" role="alert">{model.audioErrorMessage}</p>}
      <p className="mt-5 text-sm text-[var(--sf-text-muted)]">{_(msg({ id: 'daily.lesson.guidance.4', message: 'Take a moment to connect the word with its meaning.' }))}</p>
      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        <button type="button" onClick={() => actions.chooseIntroduction?.('guided')} className={`${primaryClass} w-full`}>{_(msg({ id: 'daily.lesson.guidance.5', message: "I don't know this yet" }))}</button>
        <button type="button" onClick={() => actions.chooseIntroduction?.('independent-recall')} className={`${actionClass} w-full`}>{_(msg({ id: 'daily.lesson.guidance.6', message: 'I already know it — test me' }))}</button>
      </div>
    </section>
  );
}

function GuidedPractice({ model, actions }: LessonScreenProps) {
  const { _ } = useLingui();
  return (
    <section aria-labelledby="daily-lesson-heading" className="mx-auto max-w-3xl py-6 sm:py-12" data-session-shell="lesson">
      <header className="flex items-start justify-between gap-4">
        <div><p className="premium-kicker uppercase tracking-[0.16em]">{_(msg({ id: 'daily.lesson.guidance.7', message: 'Guided practice' }))}</p><h1 id="daily-lesson-heading" ref={model.headingRef} tabIndex={-1} className="mt-2 text-3xl font-black tracking-tight focus-visible:outline-2 sm:text-4xl">{_(msg({ id: 'daily.lesson.guidance.8', message: 'See it in context' }))}</h1></div>
        <button type="button" onClick={actions.exit} className={`${actionClass} shrink-0`}>{_(msg({ id: 'daily.lesson.guidance.2', message: 'Exit lesson' }))}</button>
      </header>
      <CardDetails model={model} actions={actions} />
      {model.canPlayAudio && <button type="button" onClick={actions.playAudio} className={`${actionClass} mt-5`}>{_(msg({ id: 'daily.lesson.guidance.3', message: 'Play audio' }))}</button>}
      {model.audioErrorMessage && <p className="mt-4 rounded-xl border border-rose-500/70 bg-rose-500/5 p-4" role="alert">{model.audioErrorMessage}</p>}
      <button type="button" onClick={actions.continueGuided} className={`${primaryClass} mt-6 w-full sm:w-auto`}>{_(msg({ id: 'daily.lesson.guidance.9', message: 'Continue to independent recall' }))}</button>
    </section>
  );
}

export function LessonScreen({ model, actions }: LessonScreenProps) {
  const { _ } = useLingui();
  const { family } = useTheme();
  const showLumi = family === 'crystal' && readLumiEnabled();
  const total = Math.max(1, model.progress.total);
  const current = Math.min(total, Math.max(0, model.progress.current));
  const percentage = current / total * 100;
  // An IME confirms its candidate with Enter, which must not submit a half-typed answer.
  const imeSubmitGuard = useRef(createImeSubmitGuard()).current;
  const pointerSubmit = useRef(false);
  // Fire the reveal cue exactly once per question: `model` is rebuilt every render, so
  // tracking by question index (not object identity) is what keeps this from repeating.
  const revealedIndexRef = useRef(-1);
  useEffect(() => {
    if (model.status !== 'feedback' || !model.feedback) return;
    if (revealedIndexRef.current === model.progress.current) return;
    revealedIndexRef.current = model.progress.current;
    const cue = reviewFeedbackCue(model.feedback.outcome);
    if (cue.playSound) playSuccessSound();
    triggerHaptic(cue.haptic);
  }, [model.status, model.feedback, model.progress.current]);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const submittedByPointer = pointerSubmit.current;
    pointerSubmit.current = false;
    if (imeSubmitGuard.shouldBlockSubmit(event.nativeEvent as Event & { isComposing?: boolean; keyCode?: number }, submittedByPointer)) return;
    if (model.canSubmit) actions.submitAnswer();
  };
  if (model.status === 'introduction') return <Introduction model={model} actions={actions} />;
  if (model.status === 'guided') return <GuidedPractice model={model} actions={actions} />;
  if (model.status === 'complete') return <section aria-labelledby="daily-lesson-heading" className="lesson-complete-canvas daily-canvas" data-learning-canvas="lesson-complete">
    <div className="lesson-complete-card crystal-chamfer relative overflow-hidden rounded-[32px] border border-[var(--sf-border)] bg-[var(--sf-surface-glass)] p-7 shadow-[var(--sf-panel-shadow)] sm:p-10">
      {showLumi && <Lumi pose="proud" size={88} className="crystal-ornament mx-auto mb-2" />}
      <p className="premium-kicker uppercase tracking-[.16em]">{_(msg({ id: 'daily.lesson.session-complete-kicker', message: 'Session complete' }))}</p>
      <h1 id="daily-lesson-heading" ref={model.headingRef} tabIndex={-1} className="mt-3 text-balance text-3xl font-black tracking-tight focus-visible:outline-2 sm:text-4xl">{_(msg({ id: 'daily.lesson.complete', message: 'Lesson complete' }))}</h1>
      <p className="mx-auto mt-3 max-w-xl text-pretty text-[var(--sf-text-muted)]" role="status">{model.liveMessage}</p>
      <button type="button" onClick={actions.finish} className={`${primaryClass} mt-6`}>{_(msg({ id: 'daily.lesson.back-to-today', message: 'Back to Today' }))}</button>
    </div>
  </section>;
  return <section aria-labelledby="daily-lesson-heading" className="lesson-canvas daily-canvas" data-session-shell="lesson" data-learning-canvas="lesson">
    <header className="lesson-header">
      <div className="lesson-header-start">
        <button type="button" onClick={actions.exit} aria-label={i18n._(msg({ id: 'daily.lesson.exit', message: 'Exit lesson' }).id)} className={`${actionClass} lesson-exit shrink-0`}><X size={17} aria-hidden="true" /><span className="lesson-exit-label ml-1">{_(msg({ id: 'daily.lesson.exit', message: 'Exit lesson' }))}</span></button>
        <div className="lesson-heading-copy min-w-0">
          <p className="lesson-eyebrow premium-kicker uppercase tracking-[.16em]">{model.modeLabel}</p>
          <h1 id="daily-lesson-heading" ref={model.headingRef} tabIndex={-1} className="lesson-title mt-1 text-3xl font-black tracking-tight focus-visible:outline-2 sm:text-4xl">{_(msg({ id: 'daily.lesson.title', message: 'Lesson' }))}</h1>
        </div>
      </div>
      <div className="lesson-header-actions ml-auto flex items-center gap-2"><ThemeMenu /></div>
    </header>
    <div className="lesson-sequence" aria-hidden="true"><span className="lesson-sequence-label">{model.modeLabel}</span><ProgressSegments total={total} current={current} /><span className="lesson-sequence-count tabular-nums">{current} / {total}</span></div>
    <div className="lesson-progress" role="progressbar" aria-label={i18n._(msg({ id: 'daily.lesson.progress-label', message: 'Lesson progress' }).id)} aria-valuemin={0} aria-valuemax={total} aria-valuenow={current}>
      <div className="lesson-progress-copy flex justify-between gap-4 text-sm font-bold"><span>{_({ ...msg({ id: 'daily.lesson.question-progress', message: 'Question {current} of {total}' }), values: { current, total } })}</span><span className="tabular-nums text-[var(--sf-text-muted)]">{Math.round(percentage)}%</span></div>
      <ProgressSegments total={total} current={current} />
    </div>
    <p className="sr-only" role="status">{model.liveMessage}</p>
    <div className="lesson-flow">
      <GsapEntrance variant="step" animationKey={current} className="lesson-card crystal-chamfer relative overflow-hidden rounded-[28px] border border-[var(--sf-border)] bg-[var(--sf-surface-glass)] p-5 shadow-[var(--sf-panel-shadow)] sm:p-8" data-lesson-card="true">
        <form className="lesson-form" onSubmit={submit} onCompositionStart={imeSubmitGuard.onCompositionStart} onCompositionEnd={imeSubmitGuard.onCompositionEnd} onKeyDown={event => { if (imeSubmitGuard.shouldBlockKeyDown(event.nativeEvent)) event.preventDefault(); }}>
          {family === 'crystal' && <span className="crystal-flare lesson-card-flare absolute -right-20 -top-20 size-44 opacity-25" aria-hidden="true" />}
          <div className="lesson-card-meta"><span className="lesson-card-mode">{model.modeLabel}</span><span className="lesson-card-instruction">{_(msg({ id: 'daily.lesson.prompt', message: 'Prompt' }))}</span></div>
          <h2 className="lesson-prompt mt-3 text-balance text-2xl font-black tracking-tight sm:text-3xl" lang={model.promptLanguage}>{model.prompt}</h2>
          {model.mode === 'listening' && model.canPlayAudio && <button type="button" onClick={actions.playAudio} className={`${actionClass} lesson-audio mt-5`}><Volume2 size={17} aria-hidden="true" /><span className="ml-1">{_(msg({ id: 'daily.lesson.play-audio', message: 'Play audio' }))}</span></button>}
          {model.audioErrorMessage && <p className="lesson-audio-error mt-4 rounded-2xl border border-[var(--sf-danger)] bg-[color-mix(in_srgb,var(--sf-danger)_10%,var(--sf-surface))] p-4" role="alert">{model.audioErrorMessage}</p>}
          {model.card && actions.requestGuidance && (model.status === 'answering' || model.status === 'feedback') && <button type="button" onClick={actions.requestGuidance} className={`${actionClass} mt-4 w-full`}>{_(msg({ id: 'daily.lesson.learn-first', message: "I don't know this — learn first" }))}</button>}
          <AnswerControl model={model} actions={actions} />
          {model.status === 'answering' && <button type="submit" onPointerDown={() => { pointerSubmit.current = true; setTimeout(() => { pointerSubmit.current = false; }, 0); }} disabled={!model.canSubmit} className={`${primaryClass} lesson-submit mt-6 w-full sm:w-auto`}>{_(msg({ id: 'daily.lesson.submit', message: 'Submit answer' }))}</button>}
        </form>
        {model.feedback && model.status !== 'answering' && <GsapEntrance variant="feedback" animationKey={current} data-lesson-feedback="true"><Feedback model={model} actions={actions} /></GsapEntrance>}
      </GsapEntrance>
      <aside className="lesson-guidance crystal-chamfer border border-[var(--sf-border)] bg-[var(--sf-surface-glass)] p-4 text-center shadow-[var(--sf-panel-shadow)]">
        {showLumi && <><Lumi pose="thinking" size={104} className="crystal-ornament mx-auto" /><p className="mt-3 font-display text-xs font-black uppercase tracking-[.12em] text-[var(--sf-brand-text)]">{_(msg({ id: 'daily.lesson.lumi-label', message: 'Lumi is here' }))}</p></>}
        <p className={`${showLumi ? 'mt-2' : ''} text-sm leading-6 text-[var(--sf-text-muted)]`}>{_(msg({ id: 'daily.lesson.lumi-copy', message: 'Take your time. One clear answer at a time.' }))}</p>
      </aside>
    </div>
    <footer className="lesson-footer"><span>{_({ ...msg({ id: 'daily.lesson.question-progress', message: 'Question {current} of {total}' }), values: { current, total } })}</span><span className="tabular-nums text-[var(--sf-text-muted)]">{Math.round(percentage)}%</span></footer>
  </section>;
}

export type { LessonScreenProps };
