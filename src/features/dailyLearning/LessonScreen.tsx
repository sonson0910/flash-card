import type { FormEvent } from 'react';
import { scriptPresentation } from '../releaseReadiness/multiScriptRelease';
import type { LessonScreenActions, LessonScreenModel, ReviewRating } from './dailyLearningPresentation';

interface LessonScreenProps {
  readonly model: LessonScreenModel;
  readonly actions: LessonScreenActions;
}

const actionClass = 'min-h-11 rounded-full border border-white/15 bg-white/5 px-5 py-2.5 font-bold text-white/90 transition-all duration-200 hover:border-cyan-400/50 hover:bg-white/10 hover:text-white hover:scale-[1.02] active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none cursor-pointer';
const primaryClass = 'brand-action min-h-11 rounded-full bg-cyan-400 px-6 py-3 font-extrabold text-[#071014] shadow-lg shadow-cyan-500/25 transition-all duration-300 hover:bg-cyan-300 hover:scale-[1.03] active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none cursor-pointer';

const ratingOptions: ReadonlyArray<{ id: ReviewRating; label: string; description: string }> = [
  { id: 'again', label: 'Again', description: 'I did not remember' },
  { id: 'hard', label: 'Hard', description: 'I remembered with difficulty' },
  { id: 'good', label: 'Good', description: 'I remembered correctly' },
  { id: 'easy', label: 'Easy', description: 'I remembered immediately' },
];

function AnswerControl({ model, actions }: LessonScreenProps) {
  const answerLocked = model.status !== 'answering';

  if (model.answer.kind === 'choice') {
    const answer = model.answer;
    return (
      <fieldset className="mt-5" disabled={answerLocked}>
        <legend className="text-sm font-bold text-[var(--sf-text-muted)]">Choose one answer</legend>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {answer.options.map((option) => {
            const isSelected = answer.selectedId === option.id;
            const optionScript = option.language ? scriptPresentation(option.language) : undefined;
            return (
              <button
                key={option.id}
                type="button"
                lang={optionScript?.lang}
                dir={optionScript?.dir}
                aria-pressed={isSelected}
                onClick={() => actions.chooseAnswer(option.id)}
                className={`${actionClass} min-h-16 text-start text-base ${isSelected ? 'border-[var(--sf-brand)] bg-[color-mix(in_srgb,var(--sf-brand)_10%,var(--sf-surface))] shadow-[inset_4px_0_0_var(--sf-brand)]' : ''}`}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </fieldset>
    );
  }

  if (model.answer.kind === 'text') {
    const answerScript = model.answer.language ? scriptPresentation(model.answer.language) : undefined;
    return (
      <div className="mt-6">
        <label htmlFor="daily-lesson-answer" className="block text-sm font-bold text-[var(--sf-text-muted)]">{model.answer.label}</label>
        <input
          id="daily-lesson-answer"
          name="daily-lesson-answer"
          type="text"
          lang={answerScript?.lang}
          dir={answerScript?.dir}
          inputMode={model.answer.inputMode}
          autoComplete="off"
          autoCapitalize="none"
          disabled={answerLocked}
          value={model.answer.value}
          onChange={(event) => actions.changeTextAnswer(event.target.value)}
          className="mt-2 min-h-14 w-full rounded-xl border border-[var(--sf-border)] bg-[var(--sf-surface)] px-4 py-3 text-start text-lg font-semibold focus-visible:outline-2 focus-visible:outline-offset-2"
        />
      </div>
    );
  }

  const answerScript = model.answer.language ? scriptPresentation(model.answer.language) : undefined;
  return (
    <fieldset className="mt-6" disabled={answerLocked}>
      <legend className="text-sm font-bold text-[var(--sf-text-muted)]">Build the sentence</legend>
      <p className="mt-1 text-sm text-[var(--sf-text-muted)]">Select each word occurrence in order. Select it again to remove it.</p>
      <div className="mt-4 flex flex-wrap gap-2">
        {model.answer.tokens.map((token) => (
          <button
            key={token.occurrenceId}
            type="button"
            data-occurrence-id={token.occurrenceId}
            lang={answerScript?.lang}
            dir={answerScript?.dir}
            aria-pressed={token.isSelected}
            onClick={() => actions.toggleSentenceToken(token.occurrenceId)}
            className={`${actionClass} text-start ${token.isSelected ? 'border-[var(--sf-brand)] bg-[color-mix(in_srgb,var(--sf-brand)_10%,var(--sf-surface))]' : ''}`}
          >
            {token.label}
          </button>
        ))}
      </div>
      <div className="mt-5 min-h-20 rounded-xl border border-dashed border-[var(--sf-border)] bg-[var(--sf-surface-muted)] p-4" aria-live="polite">
        <p className="text-sm font-bold text-[var(--sf-text-muted)]">Your sentence</p>
        {model.answer.selectedOrder.length > 0
          ? <ol data-script-content="lesson-sentence" lang={answerScript?.lang} dir={answerScript?.dir} className="mt-2 flex flex-wrap gap-x-3 gap-y-2 text-start text-base font-semibold">{model.answer.selectedOrder.map((token, index) => <li key={token.occurrenceId}>{index + 1}. {token.label}</li>)}</ol>
          : <p className="mt-1 text-sm text-[var(--sf-text-muted)]">No words selected yet.</p>}
      </div>
    </fieldset>
  );
}

function Feedback({ model, actions }: LessonScreenProps) {
  if (!model.feedback || model.status === 'answering' || model.status === 'complete') return null;
  const isSaving = model.status === 'rating-saving';
  const feedbackTone = model.feedback.outcome === 'correct' ? 'border-emerald-500/70 bg-emerald-500/5' : 'border-amber-500/70 bg-amber-500/5';
  const answerScript = model.feedback.answerLanguage ? scriptPresentation(model.feedback.answerLanguage) : undefined;
  const explanationScript = model.feedback.explanationLanguage
    ? scriptPresentation(model.feedback.explanationLanguage)
    : undefined;

  return (
    <section aria-labelledby="lesson-feedback-heading" className={`mt-4 rounded-[24px] border p-5 sm:p-6 ${feedbackTone}`}>
      <div role="status" aria-live="polite" aria-atomic="true">
        <p className="text-xs font-extrabold uppercase tracking-[0.16em] text-[var(--sf-text-muted)]">Answer feedback</p>
        <h2 id="lesson-feedback-heading" className="mt-2 text-2xl font-black tracking-tight">{model.feedback.message}</h2>
        <p className="mt-3"><strong>Correct answer:</strong> <span lang={answerScript?.lang} dir={answerScript?.dir}>{model.feedback.expectedAnswer}</span></p>
        {model.feedback.explanation && <p data-script-content="lesson-feedback-explanation" lang={explanationScript?.lang} dir={explanationScript?.dir} className="mt-2 max-w-2xl text-pretty text-start text-sm leading-6 text-[var(--sf-text-muted)]">{model.feedback.explanation}</p>}
      </div>

      {model.status === 'rating-error' && <div className="mt-5 rounded-xl border border-rose-500/70 bg-[var(--sf-surface)] p-4" role="alert" aria-live="assertive"><p>{model.errorMessage}</p><button type="button" onClick={actions.retryRating} className={`${actionClass} mt-3`}>Retry saving rating</button></div>}

      <fieldset className="mt-5" disabled={isSaving || model.status === 'rating-error'} aria-busy={isSaving || undefined}>
        <legend className="font-black">How well did you remember?</legend>
        <p className="mt-1 text-sm text-[var(--sf-text-muted)]">Choose one rating to save this review and continue.</p>
        <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {ratingOptions.map((rating) => (
            <button key={rating.id} type="button" onClick={() => actions.rate(rating.id)} className={`${actionClass} text-start`}>
              <span className="block">{rating.label}</span>
              <span className="mt-1 block text-xs font-normal leading-4 text-[var(--sf-text-muted)]">{rating.description}</span>
            </button>
          ))}
        </div>
        {isSaving && <p className="mt-3" role="status" aria-live="polite">Saving your rating before the next question…</p>}
      </fieldset>
    </section>
  );
}

export function LessonScreen({ model, actions }: LessonScreenProps) {
  const total = Math.max(1, model.progress.total);
  const current = Math.min(total, Math.max(0, model.progress.current));
  const percentage = current / total * 100;
  const promptScript = model.promptLanguage ? scriptPresentation(model.promptLanguage) : undefined;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (model.canSubmit) actions.submitAnswer();
  };

  if (model.status === 'complete') {
    return (
      <section aria-labelledby="daily-lesson-heading" className="mx-auto max-w-3xl py-6 text-center sm:py-12">
        <p className="premium-kicker uppercase tracking-[0.16em]">Session complete</p>
        <h1 id="daily-lesson-heading" ref={model.headingRef} tabIndex={-1} className="mt-3 text-balance text-3xl font-black tracking-tight focus-visible:outline-2 sm:text-4xl">Lesson complete</h1>
        <p className="mx-auto mt-3 max-w-xl text-pretty text-[var(--sf-text-muted)]" role="status" aria-live="polite">{model.liveMessage}</p>
        <button type="button" onClick={actions.finish} className={`${primaryClass} mt-6`}>Back to Today</button>
      </section>
    );
  }

  return (
    <section aria-labelledby="daily-lesson-heading" className="mx-auto max-w-4xl" data-session-shell="lesson">
      <header className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="premium-kicker uppercase tracking-[0.16em]">{model.modeLabel}</p>
          <h1 id="daily-lesson-heading" ref={model.headingRef} tabIndex={-1} className="mt-1 text-3xl font-black tracking-tight focus-visible:outline-2 sm:text-4xl">Lesson</h1>
        </div>
        <button type="button" onClick={actions.exit} className={`${actionClass} shrink-0`}>Exit lesson</button>
      </header>

      <div className="mt-5" role="progressbar" aria-label="Lesson progress" aria-valuemin={0} aria-valuemax={total} aria-valuenow={current}>
        <div className="flex justify-between gap-4 text-sm font-bold"><span>Question {current} of {total}</span><span className="tabular-nums text-[var(--sf-text-muted)]">{Math.round(percentage)}%</span></div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-[var(--sf-surface-muted)]"><div className="h-full w-full origin-left rounded-full bg-[var(--sf-brand)] transition-transform duration-200 motion-reduce:transition-none" style={{ transform: `scaleX(${percentage / 100})` }} /></div>
      </div>

      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">{model.liveMessage}</p>
      <form onSubmit={submit} className="mt-6 rounded-[28px] border border-[var(--sf-border)] bg-[var(--sf-surface)] p-5 shadow-[0_28px_70px_-52px_var(--sf-shadow)] sm:p-8">
        <p className="text-xs font-extrabold uppercase tracking-[0.16em] text-[var(--sf-text-muted)]">Prompt</p>
        <div data-script-content="lesson" lang={promptScript?.lang} dir={promptScript?.dir}>
          <h2 className="mt-3 text-balance text-2xl font-black tracking-tight sm:text-3xl">{model.prompt}</h2>
        </div>
        {model.mode === 'listening' && model.canPlayAudio && <button type="button" onClick={actions.playAudio} className={`${actionClass} mt-5`}>Play audio</button>}
        {model.audioErrorMessage && <p className="mt-4 rounded-xl border border-rose-500/70 bg-rose-500/5 p-4" role="alert">{model.audioErrorMessage}</p>}
        <div dir="ltr">
          <AnswerControl model={model} actions={actions} />
          {model.status === 'answering' && <button type="submit" disabled={!model.canSubmit} className={`${primaryClass} mt-6 w-full sm:w-auto`}>Submit answer</button>}
        </div>
      </form>
      <Feedback model={model} actions={actions} />
    </section>
  );
}

export type { LessonScreenProps };
