import { useEffect, useRef, type FormEvent, type ReactNode } from 'react';
import { i18n } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';
import { CheckCircle2, Play, X } from 'lucide-react';
import { GsapEntrance } from '../../components/motion/GsapEntrance';
import { Lumi } from '../../components/lumi/Lumi';
import { ThemeMenu } from '../../components/shell/ThemeMenu';
import { triggerHaptic } from '../../lib/haptics';
import { createImeSubmitGuard } from '../../lib/imeSubmitGuard';
import { playSuccessSound } from '../../lib/interactionSounds';
import { useTheme } from '../theme/ThemeProvider';
import { readLumiEnabled } from '../settings/lumi-preference';
import { reviewFeedbackCue, type LessonMode, type LessonScreenActions, type LessonScreenModel } from './dailyLearningPresentation';
import './lesson-placement-canvas.css';

interface LessonScreenProps { readonly model: LessonScreenModel; readonly actions: LessonScreenActions; }

const ratings = [
  { id: 'again', label: msg({ id: 'daily.lesson.rating.again', message: 'Again' }), description: msg({ id: 'daily.lesson.rating.again.description', message: 'I did not remember' }) },
  { id: 'hard', label: msg({ id: 'daily.lesson.rating.hard', message: 'Hard' }), description: msg({ id: 'daily.lesson.rating.hard.description', message: 'I remembered with difficulty' }) },
  { id: 'good', label: msg({ id: 'daily.lesson.rating.good', message: 'Good' }), description: msg({ id: 'daily.lesson.rating.good.description', message: 'I remembered correctly' }) },
  { id: 'easy', label: msg({ id: 'daily.lesson.rating.easy', message: 'Easy' }), description: msg({ id: 'daily.lesson.rating.easy.description', message: 'I remembered immediately' }) },
] as const;

// The six exercise types a daily lesson draws from, in the order the Today journey presents them.
const stageOrder: readonly { readonly mode: LessonMode; readonly label: ReturnType<typeof msg> }[] = [
  { mode: 'recognition', label: msg({ id: 'daily.lesson.stage.recognition', message: 'Recognition' }) },
  { mode: 'active-recall', label: msg({ id: 'daily.lesson.stage.active-recall', message: 'Active recall' }) },
  { mode: 'listening', label: msg({ id: 'daily.lesson.stage.listening', message: 'Listening' }) },
  { mode: 'cloze', label: msg({ id: 'daily.lesson.stage.cloze', message: 'Cloze' }) },
  { mode: 'spelling', label: msg({ id: 'daily.lesson.stage.spelling', message: 'Spelling' }) },
  { mode: 'sentence-building', label: msg({ id: 'daily.lesson.stage.sentence-building', message: 'Sentence building' }) },
];

const clozeBlank = /_{3,}/;

function ProgressSegments({ total, current }: { readonly total: number; readonly current: number }) {
  return <span className="lesson-segments" data-segment-count={total > 16 ? 'many' : 'few'} aria-hidden="true">
    {Array.from({ length: total }, (_, index) => <span key={index} data-segment-state={index < current - 1 ? 'complete' : index === current - 1 ? 'current' : 'upcoming'} />)}
  </span>;
}

function TopBar({ model, actions, title }: LessonScreenProps & { readonly title: ReactNode }) {
  const { _ } = useLingui();
  const total = Math.max(1, model.progress.total);
  const current = Math.min(total, Math.max(0, model.progress.current));
  return <>
    <div className="lesson-topbar">
      <button type="button" onClick={actions.exit} aria-label={i18n._(msg({ id: 'daily.lesson.exit', message: 'Exit lesson' }).id)} className="lesson-round lesson-exit"><X size={18} aria-hidden="true" /></button>
      <div className="lesson-topbar-title min-w-0">{title}</div>
      <div className="lesson-progress" role="progressbar" aria-label={i18n._(msg({ id: 'daily.lesson.progress-label', message: 'Lesson progress' }).id)} aria-valuemin={0} aria-valuemax={total} aria-valuenow={current}>
        <ProgressSegments total={total} current={current} />
        <span className="sr-only">{_({ ...msg({ id: 'daily.lesson.question-progress', message: 'Question {current} of {total}' }), values: { current, total } })}</span>
      </div>
      <span className="lesson-count font-mono tabular-nums" aria-hidden="true"><strong>{current}</strong><span> / {total}</span></span>
      <div className="lesson-topbar-actions"><ThemeMenu /></div>
    </div>
  </>;
}

function StageChips({ mode }: { readonly mode: LessonMode }) {
  const { _ } = useLingui();
  return <nav className="lesson-stages" aria-label={i18n._(msg({ id: 'daily.lesson.stages-label', message: 'Exercise types' }).id)}>
    <ol>
      {stageOrder.map(stage => <li key={stage.mode} className="lesson-stage-chip" data-stage-state={stage.mode === mode ? 'current' : 'other'} aria-current={stage.mode === mode ? 'step' : undefined}>
        <span className="lesson-stage-dot" aria-hidden="true" /><span>{_(stage.label)}</span>
      </li>)}
    </ol>
  </nav>;
}

function Prompt({ model }: LessonScreenProps) {
  const blank = model.mode === 'cloze' && model.answer.kind === 'text' ? clozeBlank.exec(model.prompt) : null;
  if (!blank || model.answer.kind !== 'text') return <h2 className="lesson-prompt" lang={model.promptLanguage}>{model.prompt}</h2>;
  const before = model.prompt.slice(0, blank.index);
  const after = model.prompt.slice(blank.index + blank[0].length);
  return <h2 className="lesson-prompt" lang={model.promptLanguage}>
    {before}
    <span className="lesson-blank" data-filled={model.answer.value ? 'true' : 'false'}>
      <span className="sr-only">{blank[0]}</span>
      <span aria-hidden="true" lang={model.answer.language}>{model.answer.value}</span>
      {model.status === 'answering' && <span className="lesson-caret" aria-hidden="true" />}
    </span>
    {after}
  </h2>;
}

function ChoiceAnswer({ model, actions }: LessonScreenProps) {
  const { _ } = useLingui();
  if (model.answer.kind !== 'choice') return null;
  const answer = model.answer;
  return <fieldset className="mt-6" disabled={model.status !== 'answering'}>
    <legend className="sr-only">{_(msg({ id: 'daily.lesson.choose-answer', message: 'Choose one answer' }))}</legend>
    <div className="lesson-choice-grid">
      {answer.options.map((option, index) => {
        const selected = answer.selectedId === option.id;
        return <button key={option.id} type="button" lang={option.language} aria-pressed={selected} onClick={() => actions.chooseAnswer(option.id)} className="lesson-choice" data-selected={selected ? 'true' : 'false'}>
          <span className="lesson-choice-index font-mono" aria-hidden="true">{index + 1}</span>
          <span className="min-w-0">{option.label}</span>
        </button>;
      })}
    </div>
  </fieldset>;
}

function SentenceAnswer({ model, actions }: LessonScreenProps) {
  const { _ } = useLingui();
  if (model.answer.kind !== 'sentence') return null;
  const answer = model.answer;
  return <fieldset className="mt-6" disabled={model.status !== 'answering'}>
    <legend className="sr-only">{_(msg({ id: 'daily.lesson.build-sentence', message: 'Build the sentence' }))}</legend>
    <p className="lesson-help">{_(msg({ id: 'daily.lesson.sentence-help', message: 'Select each word occurrence in order. Select it again to remove it.' }))}</p>
    <div className="lesson-sentence-output" aria-live="polite">
      <p className="lesson-field-label">{_(msg({ id: 'daily.lesson.your-sentence', message: 'Your sentence' }))}</p>
      {answer.selectedOrder.length ? <ol className="lesson-sentence-words">{answer.selectedOrder.map((token, index) => <li key={token.occurrenceId} lang={token.language}>{index + 1}. {token.label}</li>)}</ol> : <p className="lesson-help mt-1">{_(msg({ id: 'daily.lesson.no-words', message: 'No words selected yet.' }))}</p>}
    </div>
    <div className="lesson-token-list">
      {answer.tokens.map(token => <button key={token.occurrenceId} type="button" lang={token.language} data-occurrence-id={token.occurrenceId} aria-pressed={token.isSelected} onClick={() => actions.toggleSentenceToken(token.occurrenceId)} className="lesson-token" data-selected={token.isSelected ? 'true' : 'false'}>{token.label}</button>)}
    </div>
  </fieldset>;
}

function Feedback({ model, actions }: LessonScreenProps) {
  const { _ } = useLingui();
  if (!model.feedback || model.status === 'answering' || model.status === 'complete') return null;
  const saving = model.status === 'rating-saving';
  return <section aria-labelledby="lesson-feedback-heading" className="lesson-feedback" data-outcome={model.feedback.outcome}>
    <div role="status" aria-live="polite" aria-atomic="true">
      <p className="lesson-field-label">{_(msg({ id: 'daily.lesson.answer-feedback', message: 'Answer feedback' }))}</p>
      <h2 id="lesson-feedback-heading" className="lesson-feedback-title"><CheckCircle2 size={22} aria-hidden="true" />{model.feedback.message}</h2>
      <p className="lesson-feedback-answer"><strong>{_(msg({ id: 'daily.lesson.correct-answer', message: 'Correct answer:' }))}</strong> <span lang={model.feedback.answerLanguage}>{model.feedback.expectedAnswer}</span></p>
      {model.feedback.explanation && <p className="lesson-help mt-2 max-w-2xl text-pretty">{model.feedback.explanation}</p>}
    </div>
    {model.status === 'rating-error' && <div className="lesson-feedback-error" role="alert"><p>{model.errorMessage}</p><button type="button" onClick={actions.retryRating} className="lesson-secondary mt-3">{_(msg({ id: 'daily.lesson.retry-rating', message: 'Retry saving rating' }))}</button></div>}
    <fieldset className="mt-5" disabled={saving || model.status === 'rating-error'} aria-busy={saving || undefined}>
      <legend className="lesson-rating-legend">{_(msg({ id: 'daily.lesson.rate-memory', message: 'How well did you remember?' }))}</legend>
      <p className="lesson-help mt-1">{_(msg({ id: 'daily.lesson.rate-memory-help', message: 'Choose one rating to save this review and continue.' }))}</p>
      <div className="lesson-rating-grid">{ratings.map(rating => <button key={rating.id} type="button" data-rating={rating.id} onClick={() => { triggerHaptic('light'); actions.rate(rating.id); }} className="lesson-rating"><span className="block">{_(rating.label)}</span><span className="lesson-rating-note">{_(rating.description)}</span></button>)}</div>
      {saving && <p className="lesson-help mt-3" role="status">{_(msg({ id: 'daily.lesson.saving', message: 'Saving your rating before the next question…' }))}</p>}
    </fieldset>
  </section>;
}

function CardDetails({ model }: LessonScreenProps) {
  const card = model.card;
  if (!card) return null;
  const translationLanguage = card.translationLanguage || 'vi';
  return <div className="lesson-word-panel">
    <p className="lesson-word" lang={card.language}>{card.word}</p>
    {card.phonetic && <p className="lesson-phonetic font-mono">{card.phonetic}</p>}
    <p className="lesson-translation" lang={translationLanguage}>{card.translation}</p>
    {card.explanation && <p className="lesson-help mt-4">{card.explanation}</p>}
    {card.exampleSentence && <p className="lesson-example" lang={card.language}>“{card.exampleSentence}”</p>}
    {card.exampleTranslation && <p className="lesson-help mt-1" lang={translationLanguage}>{card.exampleTranslation}</p>}
  </div>;
}

function AudioError({ message }: { readonly message?: string }) {
  return message ? <p className="lesson-audio-error" role="alert">{message}</p> : null;
}

function LessonDecor({ crystal }: { readonly crystal: boolean }) {
  if (!crystal) return null;
  return <>
    <span className="lesson-shard lesson-shard--left crystal-wing crystal-ornament" aria-hidden="true" />
    <span className="lesson-shard lesson-shard--right crystal-wing crystal-ornament" aria-hidden="true" />
  </>;
}

function Guidance({ showLumi, pose }: { readonly showLumi: boolean; readonly pose: 'thinking' | 'hint' }) {
  const { _ } = useLingui();
  const copy = _(msg({ id: 'daily.lesson.lumi-copy', message: 'Take your time. One clear answer at a time.' }));
  if (!showLumi) return <p className="lesson-guidance-copy">{copy}</p>;
  return <aside className="lesson-lumi" aria-label={i18n._(msg({ id: 'daily.lesson.lumi-label', message: 'Lumi is here' }).id)}>
    <div className="lesson-lumi-bubble">
      <p className="lesson-lumi-label">{_(msg({ id: 'daily.lesson.lumi-label', message: 'Lumi is here' }))}</p>
      <p className="lesson-lumi-copy">{copy}</p>
    </div>
    <Lumi pose={pose} size={168} className="crystal-ornament lesson-lumi-figure" />
  </aside>;
}

function LessonTitle({ heading, model }: { readonly heading: boolean; readonly model: LessonScreenModel }) {
  const { _ } = useLingui();
  const title = _(msg({ id: 'daily.lesson.title', message: 'Today’s lesson' }));
  const content = <><span className="lesson-title-main">{title}</span><span className="lesson-title-context"><span className="lesson-title-sep" aria-hidden="true"> · </span><span className="lesson-eyebrow">{model.modeLabel}</span></span></>;
  if (!heading) return <p className="lesson-title">{content}</p>;
  return <h1 id="daily-lesson-heading" ref={model.headingRef} tabIndex={-1} className="lesson-title">{content}</h1>;
}

function Introduction({ model, actions, showLumi, crystal }: LessonScreenProps & { readonly showLumi: boolean; readonly crystal: boolean }) {
  const { _ } = useLingui();
  return <section aria-labelledby="daily-lesson-heading" className="lesson-canvas daily-canvas" data-session-shell="lesson" data-learning-canvas="lesson-introduction">
    <LessonDecor crystal={crystal} />
    <TopBar model={model} actions={actions} title={<LessonTitle heading={false} model={model} />} />
    <div className="lesson-stage">
      <div className="lesson-card" data-lesson-card="true">
        <div className="lesson-card-meta"><span className="lesson-chip">{_(msg({ id: 'daily.lesson.guidance.0', message: 'Introduction' }))}</span></div>
        <h1 id="daily-lesson-heading" ref={model.headingRef} tabIndex={-1} className="lesson-card-title">{_(msg({ id: 'daily.lesson.guidance.1', message: 'Meet this word' }))}</h1>
        <CardDetails model={model} actions={actions} />
        {model.canPlayAudio && <button type="button" onClick={actions.playAudio} className="lesson-pill mt-5"><Play size={11} fill="currentColor" aria-hidden="true" />{_(msg({ id: 'daily.lesson.guidance.3', message: 'Play audio' }))}</button>}
        <AudioError message={model.audioErrorMessage} />
        <p className="lesson-help mt-5">{_(msg({ id: 'daily.lesson.guidance.4', message: 'Take a moment to connect the word with its meaning.' }))}</p>
        <div className="lesson-action-pair">
          <button type="button" onClick={() => actions.chooseIntroduction?.('guided')} className="lesson-primary">{_(msg({ id: 'daily.lesson.guidance.5', message: "I don't know this yet" }))}</button>
          <button type="button" onClick={() => actions.chooseIntroduction?.('independent-recall')} className="lesson-secondary">{_(msg({ id: 'daily.lesson.guidance.6', message: 'I already know it — test me' }))}</button>
        </div>
      </div>
      <Guidance showLumi={showLumi} pose="hint" />
    </div>
  </section>;
}

function GuidedPractice({ model, actions, showLumi, crystal }: LessonScreenProps & { readonly showLumi: boolean; readonly crystal: boolean }) {
  const { _ } = useLingui();
  return <section aria-labelledby="daily-lesson-heading" className="lesson-canvas daily-canvas" data-session-shell="lesson" data-learning-canvas="lesson-guided">
    <LessonDecor crystal={crystal} />
    <TopBar model={model} actions={actions} title={<LessonTitle heading={false} model={model} />} />
    <div className="lesson-stage">
      <div className="lesson-card" data-lesson-card="true">
        <div className="lesson-card-meta"><span className="lesson-chip">{_(msg({ id: 'daily.lesson.guidance.7', message: 'Guided practice' }))}</span></div>
        <h1 id="daily-lesson-heading" ref={model.headingRef} tabIndex={-1} className="lesson-card-title">{_(msg({ id: 'daily.lesson.guidance.8', message: 'See it in context' }))}</h1>
        <CardDetails model={model} actions={actions} />
        {model.canPlayAudio && <button type="button" onClick={actions.playAudio} className="lesson-pill mt-5"><Play size={11} fill="currentColor" aria-hidden="true" />{_(msg({ id: 'daily.lesson.guidance.3', message: 'Play audio' }))}</button>}
        <AudioError message={model.audioErrorMessage} />
        <div className="lesson-action-pair"><button type="button" onClick={actions.continueGuided} className="lesson-primary">{_(msg({ id: 'daily.lesson.guidance.9', message: 'Continue to independent recall' }))}</button></div>
      </div>
      <Guidance showLumi={showLumi} pose="hint" />
    </div>
  </section>;
}

export function LessonScreen({ model, actions }: LessonScreenProps) {
  const { _ } = useLingui();
  const { family } = useTheme();
  const crystal = family === 'crystal';
  const showLumi = crystal && readLumiEnabled();
  const total = Math.max(1, model.progress.total);
  const current = Math.min(total, Math.max(0, model.progress.current));
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
  if (model.status === 'introduction') return <Introduction model={model} actions={actions} showLumi={showLumi} crystal={crystal} />;
  if (model.status === 'guided') return <GuidedPractice model={model} actions={actions} showLumi={showLumi} crystal={crystal} />;
  if (model.status === 'complete') return <section aria-labelledby="daily-lesson-heading" className="lesson-complete-canvas daily-canvas" data-learning-canvas="lesson-complete">
    <div className="lesson-complete-card">
      {showLumi && <Lumi pose="proud" size={88} className="crystal-ornament mx-auto mb-2" />}
      <p className="lesson-field-label">{_(msg({ id: 'daily.lesson.session-complete-kicker', message: 'Session complete' }))}</p>
      <h1 id="daily-lesson-heading" ref={model.headingRef} tabIndex={-1} className="lesson-card-title mt-3">{_(msg({ id: 'daily.lesson.complete', message: 'Lesson complete' }))}</h1>
      <p className="lesson-help mx-auto mt-3 max-w-xl text-pretty" role="status">{model.liveMessage}</p>
      <button type="button" onClick={actions.finish} className="lesson-primary mt-6">{_(msg({ id: 'daily.lesson.back-to-today', message: 'Back to Today' }))}</button>
    </div>
  </section>;
  const answering = model.status === 'answering';
  const instruction = model.answer.kind === 'text'
    ? <label htmlFor="daily-lesson-answer" className="lesson-instruction">{model.answer.label}</label>
    : <span className="lesson-instruction" aria-hidden="true">{model.answer.kind === 'choice' ? _(msg({ id: 'daily.lesson.choose-answer', message: 'Choose one answer' })) : _(msg({ id: 'daily.lesson.build-sentence', message: 'Build the sentence' }))}</span>;
  const submitButton = answering && <button type="submit" onPointerDown={() => { pointerSubmit.current = true; setTimeout(() => { pointerSubmit.current = false; }, 0); }} disabled={!model.canSubmit} className="lesson-primary lesson-submit">
    {_(msg({ id: 'daily.lesson.submit', message: 'Submit answer' }))}<kbd className="lesson-kbd font-mono" aria-hidden="true">{_(msg({ id: 'daily.lesson.enter-key', message: 'Enter' }))}</kbd>
  </button>;
  const canAskForGuidance = Boolean(model.card && actions.requestGuidance && (model.status === 'answering' || model.status === 'feedback'));
  const showAudio = model.mode === 'listening' && model.canPlayAudio;
  return <section aria-labelledby="daily-lesson-heading" className="lesson-canvas daily-canvas" data-session-shell="lesson" data-learning-canvas="lesson" data-lesson-mode={model.mode}>
    <LessonDecor crystal={crystal} />
    <TopBar model={model} actions={actions} title={<LessonTitle heading model={model} />} />
    <StageChips mode={model.mode} />
    <p className="sr-only" role="status">{model.liveMessage}</p>
    <div className="lesson-stage">
      <GsapEntrance variant="step" animationKey={current} className="lesson-card" data-lesson-card="true">
        <form className="lesson-form" onSubmit={submit} onCompositionStart={imeSubmitGuard.onCompositionStart} onCompositionEnd={imeSubmitGuard.onCompositionEnd} onKeyDown={event => { if (imeSubmitGuard.shouldBlockKeyDown(event.nativeEvent)) event.preventDefault(); }}>
          <div className="lesson-card-meta"><span className="lesson-chip">{model.modeLabel}</span>{instruction}</div>
          <Prompt model={model} actions={actions} />
          <AudioError message={model.audioErrorMessage} />
          {model.answer.kind === 'text' && <div className="lesson-input-row" data-disabled={answering ? 'false' : 'true'}>
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
              disabled={!answering}
              value={model.answer.value}
              onChange={event => actions.changeTextAnswer(event.target.value)}
              className="lesson-text-input"
            />
            {submitButton}
          </div>}
          <ChoiceAnswer model={model} actions={actions} />
          <SentenceAnswer model={model} actions={actions} />
          {(model.answer.kind !== 'text' && submitButton) || showAudio || canAskForGuidance ? <div className="lesson-aux-row">
            {model.answer.kind !== 'text' && submitButton}
            {showAudio && <button type="button" onClick={actions.playAudio} className="lesson-pill lesson-audio"><Play size={11} fill="currentColor" aria-hidden="true" />{_(msg({ id: 'daily.lesson.play-audio', message: 'Play audio' }))}</button>}
            {canAskForGuidance && <button type="button" onClick={actions.requestGuidance} className="lesson-link">{_(msg({ id: 'daily.lesson.learn-first', message: "I don't know this — learn first" }))}</button>}
          </div> : null}
        </form>
        {model.feedback && model.status !== 'answering' && <GsapEntrance variant="feedback" animationKey={current} data-lesson-feedback="true"><Feedback model={model} actions={actions} /></GsapEntrance>}
      </GsapEntrance>
      <div className="lesson-footer">
        {!showLumi && <Guidance showLumi={false} pose="thinking" />}
        <span className="lesson-footer-count">{_({ ...msg({ id: 'daily.lesson.question-progress', message: 'Question {current} of {total}' }), values: { current, total } })}</span>
      </div>
      {showLumi && <Guidance showLumi pose="thinking" />}
    </div>
  </section>;
}

export type { LessonScreenProps };
