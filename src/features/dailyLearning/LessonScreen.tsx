import type { FormEvent } from 'react';
import type { LessonScreenActions, LessonScreenModel, ReviewRating } from './dailyLearningPresentation';

interface LessonScreenProps {
  readonly model: LessonScreenModel;
  readonly actions: LessonScreenActions;
}

const actionClass = 'min-h-11 rounded-xl border border-[var(--sf-border)] bg-[var(--sf-surface)] px-4 py-2 font-bold transition-colors hover:border-[var(--sf-brand)] focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none';

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
    return <fieldset className="mt-5" disabled={answerLocked}><legend className="font-bold">Choose one answer</legend><div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">{answer.options.map((option) => <button key={option.id} type="button" lang={option.language} aria-pressed={answer.selectedId === option.id} onClick={() => actions.chooseAnswer(option.id)} className={`${actionClass} text-left`}>{option.label}</button>)}</div></fieldset>;
  }
  if (model.answer.kind === 'text') {
    return <div className="mt-5"><label htmlFor="daily-lesson-answer" className="block font-bold">{model.answer.label}</label><input id="daily-lesson-answer" type="text" inputMode={model.answer.inputMode} autoComplete="off" autoCapitalize="none" disabled={answerLocked} value={model.answer.value} onChange={(event) => actions.changeTextAnswer(event.target.value)} className="mt-2 min-h-11 w-full rounded-xl border border-[var(--sf-border)] bg-[var(--sf-surface)] px-3 py-2 text-base focus-visible:outline-2 focus-visible:outline-offset-2" /></div>;
  }
  return <fieldset className="mt-5" disabled={answerLocked}><legend className="font-bold">Build the sentence</legend><p className="mt-1 text-sm text-[var(--sf-text-muted)]">Select each word occurrence in order. Select it again to remove it.</p><div className="mt-3 flex flex-wrap gap-2">{model.answer.tokens.map((token) => <button key={token.occurrenceId} type="button" data-occurrence-id={token.occurrenceId} aria-pressed={token.isSelected} onClick={() => actions.toggleSentenceToken(token.occurrenceId)} className={actionClass}>{token.label}</button>)}</div><div className="mt-4 rounded-xl bg-[var(--sf-surface-muted)] p-3" aria-live="polite"><p className="font-bold">Your sentence</p>{model.answer.selectedOrder.length ? <ol className="mt-2 flex flex-wrap gap-2">{model.answer.selectedOrder.map((token, index) => <li key={token.occurrenceId}>{index + 1}. {token.label}</li>)}</ol> : <p className="mt-1 text-sm text-[var(--sf-text-muted)]">No words selected yet.</p>}</div></fieldset>;
}

function Feedback({ model, actions }: LessonScreenProps) {
  if (!model.feedback || model.status === 'answering' || model.status === 'complete') return null;
  const isSaving = model.status === 'rating-saving';
  return (
    <section aria-labelledby="lesson-feedback-heading" className="mt-6 rounded-2xl border border-[var(--sf-border)] p-5">
      <div role="status" aria-live="polite" aria-atomic="true">
        <h2 id="lesson-feedback-heading" className="text-xl font-black">{model.feedback.message}</h2>
        <p className="mt-2"><strong>Correct answer:</strong> <span lang={model.feedback.answerLanguage}>{model.feedback.expectedAnswer}</span></p>
        {model.feedback.explanation && <p className="mt-2 text-sm text-[var(--sf-text-muted)]">{model.feedback.explanation}</p>}
      </div>
      {model.status === 'rating-error' && <div className="mt-4 rounded-xl border border-rose-500 p-3" role="alert" aria-live="assertive"><p>{model.errorMessage}</p><button type="button" onClick={actions.retryRating} className={`${actionClass} mt-3`}>Retry saving rating</button></div>}
      <fieldset className="mt-5" disabled={isSaving || model.status === 'rating-error'} aria-busy={isSaving || undefined}>
        <legend className="font-black">How well did you remember?</legend>
        <p className="mt-1 text-sm text-[var(--sf-text-muted)]">Choose one rating to save this review and continue.</p>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">{ratingOptions.map((rating) => <button key={rating.id} type="button" onClick={() => actions.rate(rating.id)} className={actionClass}><span className="block">{rating.label}</span><span className="mt-1 block text-xs font-normal">{rating.description}</span></button>)}</div>
        {isSaving && <p className="mt-3" role="status" aria-live="polite">Saving your rating before the next question…</p>}
      </fieldset>
    </section>
  );
}

export function LessonScreen({ model, actions }: LessonScreenProps) {
  const total = Math.max(1, model.progress.total);
  const current = Math.min(total, Math.max(0, model.progress.current));
  const submit = (event: FormEvent) => { event.preventDefault(); if (model.canSubmit) actions.submitAnswer(); };

  if (model.status === 'complete') {
    return <section aria-labelledby="daily-lesson-heading"><h1 id="daily-lesson-heading" ref={model.headingRef} tabIndex={-1} className="text-3xl font-black focus-visible:outline-2">Lesson complete</h1><p className="mt-3" role="status" aria-live="polite">{model.liveMessage}</p><button type="button" onClick={actions.finish} className={`${actionClass} mt-5`}>Back to Today</button></section>;
  }

  return (
    <section aria-labelledby="daily-lesson-heading">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-sm font-bold text-[var(--sf-brand-text)]">{model.modeLabel}</p><h1 id="daily-lesson-heading" ref={model.headingRef} tabIndex={-1} className="text-3xl font-black focus-visible:outline-2">Lesson</h1></div><button type="button" onClick={actions.exit} className={actionClass}>Exit lesson</button></div>
      <div className="mt-5" role="progressbar" aria-label="Lesson progress" aria-valuemin={0} aria-valuemax={total} aria-valuenow={current}><div className="flex justify-between text-sm font-bold"><span>Question {current} of {total}</span><span>{Math.round((current / total) * 100)}%</span></div><div className="mt-2 h-2 overflow-hidden rounded-full bg-[var(--sf-surface-muted)]"><div className="h-full bg-[var(--sf-brand)] motion-reduce:transition-none" style={{ width: `${(current / total) * 100}%` }} /></div></div>
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">{model.liveMessage}</p>
      <form onSubmit={submit} className="mt-6 rounded-2xl border border-[var(--sf-border)] bg-[var(--sf-surface)] p-5">
        <h2 className="text-xl font-black" lang={model.promptLanguage}>{model.prompt}</h2>
        {model.mode === 'listening' && model.canPlayAudio && <button type="button" onClick={actions.playAudio} className={`${actionClass} mt-4`}>Play audio</button>}
        {model.audioErrorMessage && <p className="mt-3 rounded-xl border border-rose-500 p-3" role="alert">{model.audioErrorMessage}</p>}
        <AnswerControl model={model} actions={actions} />
        {model.status === 'answering' && <button type="submit" disabled={!model.canSubmit} className={`${actionClass} mt-5`}>Submit answer</button>}
      </form>
      <Feedback model={model} actions={actions} />
    </section>
  );
}

export type { LessonScreenProps };
