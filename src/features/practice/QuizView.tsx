import { CheckCircle2, ChevronRight, ImageOff, Trophy, X, XCircle } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { GsapEntrance } from '../../components/motion/GsapEntrance';
import { isSupportedImageUrl } from '../../lib/images';
import { getQuizFeedbackAnnouncement } from './practiceAccessibility';
import { isQuizAnswerCorrect, type QuizQuestion } from './practiceModel';

interface QuizViewProps {
  questions: QuizQuestion[];
  currentIndex: number;
  selectedAnswer: string | null;
  answeredCorrectly: boolean | null;
  score: number;
  showResults: boolean;
  onSelect: (answer: string) => void;
  onNext: () => void;
  onRestart: () => void;
  onClose: () => void;
}

export function QuizView({ questions, currentIndex, selectedAnswer, answeredCorrectly, score, showResults, onSelect, onNext, onRestart, onClose }: QuizViewProps) {
  const question = questions[currentIndex];
  const questionHeadingRef = useRef<HTMLHeadingElement>(null);
  const nextButtonRef = useRef<HTMLButtonElement>(null);
  const resultsHeadingRef = useRef<HTMLHeadingElement>(null);
  const previousShowResultsRef = useRef(showResults);

  useEffect(() => {
    const returnedFromResults = previousShowResultsRef.current && !showResults;
    previousShowResultsRef.current = showResults;
    if (showResults) {
      resultsHeadingRef.current?.focus();
      return;
    }
    if (selectedAnswer !== null) {
      nextButtonRef.current?.focus();
      return;
    }
    if (currentIndex > 0 || returnedFromResults) questionHeadingRef.current?.focus();
  }, [currentIndex, selectedAnswer, showResults]);

  if (!question && !showResults) return null;
  const accuracy = questions.length > 0 ? Math.round((score / questions.length) * 100) : 0;
  const answerLanguage = question?.type === 'en-to-vi' ? 'vi' : 'en';
  return (
    <div className="mx-auto flex max-w-4xl flex-col items-center py-4 sm:py-8">
      {showResults ? (
        <GsapEntrance animationKey="quiz-results" variant="result" className="w-full max-w-2xl rounded-[28px] border border-[var(--sf-border)] bg-[var(--sf-surface)] p-6 text-center text-[var(--sf-text)] shadow-[0_28px_70px_-52px_var(--sf-shadow)] sm:p-8" aria-labelledby="quiz-results-heading">
          <div data-color-role="reward" className="mx-auto mb-6 flex size-20 items-center justify-center rounded-full bg-amber-100 text-[var(--sf-reward)] dark:bg-amber-950/30" aria-hidden="true"><Trophy size={44} /></div>
          <h2 id="quiz-results-heading" ref={resultsHeadingRef} tabIndex={-1} className="mb-2 text-balance text-3xl font-black tracking-tight focus-visible:outline-2">Quiz complete</h2>
          <p className="text-pretty text-sm text-[var(--sf-text-muted)] mb-6 font-medium">Your vocabulary review results</p>
          <div className="grid grid-cols-2 gap-4 max-w-sm mx-auto mb-8">
            <div className="rounded-2xl border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] p-4"><span className="block text-xs font-bold text-[var(--sf-text-muted)]">Correct answers</span><span className="text-3xl font-black text-emerald-600 dark:text-emerald-400">{score} / {questions.length}</span></div>
            <div className="rounded-2xl border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] p-4"><span className="block text-xs font-bold text-[var(--sf-text-muted)]">Accuracy</span><span className="text-3xl font-black text-[var(--sf-brand-text)]">{accuracy}%</span></div>
          </div>
          <div className="mx-auto mb-8 max-w-md rounded-2xl border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] p-4 text-sm font-medium text-[var(--sf-text-muted)]">
            {score === questions.length ? 'Perfect. You answered every question correctly.' : score >= questions.length * 0.7 ? 'Great work. This vocabulary is becoming secure.' : 'Keep practising until the difficult words feel automatic.'}
          </div>
          <div className="flex flex-wrap justify-center gap-3">
            <button data-color-role="primary" type="button" onClick={onRestart} className="min-h-12 rounded-xl bg-[var(--sf-brand)] px-6 py-3 font-bold text-[var(--sf-on-brand)] transition-colors hover:bg-[var(--sf-brand-hover)] hover:text-white focus-visible:outline-2 motion-reduce:transition-none">Try again</button>
            <button type="button" onClick={onClose} className="min-h-12 rounded-xl border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] px-6 py-3 font-bold text-[var(--sf-text)] transition-colors hover:border-[var(--sf-brand)] focus-visible:outline-2 motion-reduce:transition-none">Back to library</button>
          </div>
        </GsapEntrance>
      ) : question ? (
        <div className="w-full">
          <div className="flex items-center justify-between mb-6 px-2">
            <button type="button" onClick={onClose} className="flex min-h-11 items-center gap-2 rounded-xl px-2 py-2 text-sm font-bold text-[var(--sf-text-muted)] hover:bg-[var(--sf-surface-raised)] hover:text-[var(--sf-text)] focus-visible:outline-2"><X size={18} aria-hidden="true" /> Exit</button>
            <div className="rounded-full border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] px-3.5 py-1.5 text-xs font-bold text-[var(--sf-text)]">Score: {score} / {questions.length}</div>
          </div>
          <GsapEntrance animationKey={currentIndex} variant="step" onEntered={() => { if (currentIndex > 0 && selectedAnswer === null) questionHeadingRef.current?.focus(); }} className="relative mb-6 flex flex-col items-center overflow-hidden rounded-[28px] border border-[var(--sf-border)] bg-[var(--sf-surface)] p-5 text-[var(--sf-text)] shadow-[0_28px_70px_-52px_var(--sf-shadow)] sm:p-8" aria-labelledby="quiz-question-heading">
            <div className="absolute right-4 top-4 max-w-40 break-words rounded-xl bg-[var(--sf-brand)] px-2.5 py-1 text-center text-xs font-black uppercase tracking-wider text-[var(--sf-on-brand)]">{question.card.category}</div>
            {isSupportedImageUrl(question.card.imageUrl) ? <div className="mb-4 size-20 overflow-hidden rounded-2xl shadow-md"><img src={question.card.imageUrl!} alt={`Illustration for ${question.card.word}`} width={80} height={80} className="h-full w-full object-cover" /></div> : <div className="mb-4 flex size-20 items-center justify-center rounded-2xl bg-[var(--sf-surface-raised)] text-[var(--sf-text-muted)]" aria-hidden="true"><ImageOff size={28} /></div>}
            <div className="text-center max-w-md w-full">
              <span className="text-xs font-bold text-[var(--sf-text-muted)] block mb-2">Question {currentIndex + 1} / {questions.length}</span>
              <h3 id="quiz-question-heading" ref={questionHeadingRef} tabIndex={-1} className="mb-4 text-balance text-xl font-extrabold leading-relaxed focus-visible:outline-2 sm:text-2xl">{question.type === 'en-to-vi' ? <>What is the Vietnamese meaning of <span className="font-black capitalize text-[var(--sf-brand-text)] underline decoration-[var(--sf-brand)] decoration-2 underline-offset-4">“{question.card.word}”</span>?</> : <>Which English word matches <span lang="vi" className="font-black capitalize text-[var(--sf-brand-text)] underline decoration-[var(--sf-brand)] decoration-2 underline-offset-4">“{question.card.translation}”</span>?</>}</h3>
            </div>
            <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">{selectedAnswer !== null ? answeredCorrectly ? getQuizFeedbackAnnouncement(true, question.correctAnswer) : <>Incorrect. The correct answer is <span lang={answerLanguage}>“{question.correctAnswer}”</span>.</> : ''}</p>
            <fieldset className="mt-4 min-w-0 w-full">
              <legend className="sr-only">Choose one answer</legend>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {question.options.map(option => {
                const correct = isQuizAnswerCorrect(question, option);
                const selected = selectedAnswer === option;
                const answered = selectedAnswer !== null;
                const style = answered ? correct ? 'bg-emerald-50 dark:bg-emerald-950/20 border-emerald-500 text-emerald-700 dark:text-emerald-400 font-extrabold' : selected ? 'bg-rose-50 dark:bg-rose-950/20 border-rose-500 text-rose-700 dark:text-rose-400 font-extrabold' : 'bg-[var(--sf-surface-raised)] border-[var(--sf-border)] text-[var(--sf-text-muted)] cursor-not-allowed' : 'bg-[var(--sf-surface-raised)] border-[var(--sf-border)] hover:border-[var(--sf-brand)] text-[var(--sf-text)]';
                return <button type="button" key={option} lang={answerLanguage} onClick={() => onSelect(option)} disabled={answered} aria-pressed={selected} className={`flex min-h-16 min-w-0 w-full items-center justify-between gap-3 rounded-xl border-2 p-4 text-left text-sm font-semibold capitalize transition-colors focus-visible:outline-2 motion-reduce:transition-none ${style}`}><span className="min-w-0 flex-1 whitespace-normal break-words [overflow-wrap:anywhere]">{option}</span>{answered && correct && <CheckCircle2 size={16} className="flex-shrink-0 text-emerald-500" aria-hidden="true" />}</button>;
              })}
              </div>
            </fieldset>
            {selectedAnswer !== null && <GsapEntrance animationKey={`${currentIndex}-feedback`} variant="feedback" className="mt-6 flex w-full flex-col items-center gap-4 border-t border-[var(--sf-border)] pt-6 text-center"><div aria-hidden="true">{answeredCorrectly ? <span className="flex items-center gap-2 text-sm font-bold text-emerald-600 dark:text-emerald-400"><CheckCircle2 size={17} /> Correct</span> : <span className="flex items-center gap-2 text-sm font-bold text-rose-600 dark:text-rose-400"><XCircle size={17} /> The correct answer is <span lang={answerLanguage} className="font-black capitalize underline">“{question.correctAnswer}”</span></span>}</div><button data-color-role="primary" ref={nextButtonRef} type="button" onClick={onNext} className="flex min-h-11 items-center gap-1 rounded-xl bg-[var(--sf-brand)] px-6 py-2.5 text-xs font-bold text-[var(--sf-on-brand)] transition-colors hover:bg-[var(--sf-brand-hover)] hover:text-white focus-visible:outline-2 motion-reduce:transition-none">{currentIndex === questions.length - 1 ? 'View results' : 'Next'} <ChevronRight size={14} aria-hidden="true" /></button></GsapEntrance>}
          </GsapEntrance>
          <div className="h-1 w-full overflow-hidden rounded-full bg-[var(--sf-surface-raised)]" role="progressbar" aria-label="Quiz progress" aria-valuemin={0} aria-valuemax={questions.length} aria-valuenow={currentIndex + (selectedAnswer !== null ? 1 : 0)}><div className="h-full w-full origin-left bg-[var(--sf-brand)] transition-transform duration-200 motion-reduce:transition-none" style={{ transform: `scaleX(${(currentIndex + (selectedAnswer !== null ? 1 : 0)) / questions.length})` }} /></div>
        </div>
      ) : null}
    </div>
  );
}
