import { useEffect, useRef, type FormEvent } from 'react';
import { CheckCircle2, ChevronRight, Trophy, Volume2, X, XCircle } from 'lucide-react';
import { GsapEntrance } from '../../components/motion/GsapEntrance';
import { playWordAudio } from '../../lib/audio';
import type { CardData } from '../../types/card';
import { getSpellingFeedbackAnnouncement } from './practiceAccessibility';

interface SpellingViewProps {
  cards: CardData[];
  currentIndex: number;
  input: string;
  checked: boolean;
  correct: boolean;
  score: number;
  showResults: boolean;
  onInput: (value: string) => void;
  onCheck: (event: FormEvent) => void;
  onNext: () => void;
  onRestart: () => void;
  onClose: () => void;
}

export function SpellingView({ cards, currentIndex, input, checked, correct, score, showResults, onInput, onCheck, onNext, onRestart, onClose }: SpellingViewProps) {
  const card = cards[currentIndex];
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
    if (checked) {
      nextButtonRef.current?.focus();
      return;
    }
    if (currentIndex > 0 || returnedFromResults) questionHeadingRef.current?.focus();
  }, [checked, currentIndex, showResults]);

  if (!card && !showResults) return null;
  const accuracy = cards.length > 0 ? Math.round((score / cards.length) * 100) : 0;
  return (
    <div className="mx-auto flex max-w-4xl flex-col items-center py-4 sm:py-8">
      {showResults ? (
        <GsapEntrance animationKey="spelling-results" variant="result" className="w-full max-w-2xl rounded-[28px] border border-[var(--sf-border)] bg-[var(--sf-surface)] p-6 text-center text-[var(--sf-text)] shadow-[0_28px_70px_-52px_var(--sf-shadow)] sm:p-8" aria-labelledby="spelling-results-heading">
          <div data-color-role="reward" className="mx-auto mb-6 flex size-20 items-center justify-center rounded-full bg-amber-100 text-[var(--sf-reward)] dark:bg-amber-950/30" aria-hidden="true"><Trophy size={40} /></div>
          <h2 id="spelling-results-heading" ref={resultsHeadingRef} tabIndex={-1} className="mb-2 text-balance text-3xl font-black tracking-tight focus-visible:outline-2">Complete</h2>
          <p className="text-pretty text-sm text-[var(--sf-text-muted)] mb-6 font-medium">Your spelling practice results</p>
          <div className="grid grid-cols-2 gap-4 max-w-sm mx-auto mb-8">
            <div className="rounded-2xl border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] p-4"><span className="block text-xs font-bold text-[var(--sf-text-muted)]">Correct answers</span><span className="text-3xl font-black text-emerald-600 dark:text-emerald-400">{score} / {cards.length}</span></div>
            <div className="rounded-2xl border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] p-4"><span className="block text-xs font-bold text-[var(--sf-text-muted)]">Accuracy</span><span className="text-3xl font-black text-[var(--sf-brand-text)]">{accuracy}%</span></div>
          </div>
          <div className="flex flex-wrap justify-center gap-3"><button data-color-role="primary" type="button" onClick={onRestart} className="min-h-12 rounded-xl bg-[var(--sf-brand)] px-6 py-3 font-bold text-[var(--sf-on-brand)] transition-colors hover:bg-[var(--sf-brand-hover)] hover:text-white focus-visible:outline-2 motion-reduce:transition-none">Try again</button><button type="button" onClick={onClose} className="min-h-12 rounded-xl border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] px-6 py-3 font-bold text-[var(--sf-text)] transition-colors hover:border-[var(--sf-brand)] focus-visible:outline-2 motion-reduce:transition-none">Back to library</button></div>
        </GsapEntrance>
      ) : card ? (
        <div className="w-full">
          <h1 className="mb-4 px-2 text-2xl font-black tracking-tight text-[var(--sf-text)]">Spelling practice</h1>
          <div className="mb-6 flex items-center justify-between px-2"><button type="button" onClick={onClose} className="flex min-h-11 items-center gap-2 rounded-xl px-2 py-2 text-sm font-bold text-[var(--sf-text-muted)] hover:bg-[var(--sf-surface-raised)] hover:text-[var(--sf-text)] focus-visible:outline-2"><X size={18} aria-hidden="true" /> Exit</button><div className="rounded-full border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] px-3.5 py-1.5 text-xs font-bold text-[var(--sf-text)]">Score: {score} / {cards.length}</div></div>
          <GsapEntrance animationKey={currentIndex} variant="step" onEntered={() => { if (currentIndex > 0 && !checked) questionHeadingRef.current?.focus(); }} className="relative mb-6 flex flex-col items-center overflow-hidden rounded-[28px] border border-[var(--sf-border)] bg-[var(--sf-surface)] p-5 text-[var(--sf-text)] shadow-[0_28px_70px_-52px_var(--sf-shadow)] sm:p-8" aria-labelledby="spelling-question-heading">
            <div className="absolute right-4 top-4 max-w-40 break-words rounded-xl bg-[var(--sf-brand)] px-2.5 py-1 text-center text-xs font-black uppercase tracking-wider text-[var(--sf-on-brand)]">{card.category}</div>
            <div className="mb-6 mt-4 w-full max-w-md text-center"><span className="mb-4 block text-xs font-bold text-[var(--sf-text-muted)]">Question {currentIndex + 1} / {cards.length}</span><button type="button" onClick={() => playWordAudio(card.word, card.audioUrl)} className="mx-auto mb-6 flex size-16 items-center justify-center rounded-full border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] text-[var(--sf-brand-text)] transition-colors hover:border-[var(--sf-brand)] focus-visible:outline-2 motion-reduce:transition-none" aria-label={`Play pronunciation for ${card.word}`}><Volume2 size={32} aria-hidden="true" /></button><h3 id="spelling-question-heading" ref={questionHeadingRef} tabIndex={-1} lang="vi" className="text-balance text-2xl font-extrabold tracking-tight focus-visible:outline-2">{card.translation}</h3></div>
            <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">{checked ? getSpellingFeedbackAnnouncement(correct, card.word) : ''}</p>
            <form onSubmit={onCheck} className="mt-2 w-full max-w-sm"><input name="spelling-answer" type="text" disabled={checked} value={input} onChange={event => onInput(event.target.value)} autoComplete="off" spellCheck={false} placeholder="Type the English word…" aria-label="Type the English word" className={`min-h-14 w-full rounded-xl border-2 bg-[var(--sf-surface-raised)] p-4 text-center text-xl font-bold text-[var(--sf-text)] focus-visible:outline-2 focus-visible:outline-offset-2 ${checked ? correct ? 'border-emerald-500 bg-emerald-50 text-emerald-600 dark:bg-emerald-950/20 dark:text-emerald-400' : 'border-rose-500 bg-rose-50 text-rose-600 dark:bg-rose-950/20 dark:text-rose-400' : 'border-[var(--sf-border)]'}`} /></form>
            {checked && <GsapEntrance animationKey={`${currentIndex}-feedback`} variant="feedback" className="mt-6 flex w-full flex-col items-center justify-between gap-4 rounded-xl bg-[var(--sf-surface-raised)] p-4 sm:flex-row"><div aria-hidden="true">{correct ? <span className="flex items-center gap-2 text-sm font-bold text-emerald-600 dark:text-emerald-400"><CheckCircle2 size={17} /> Correct</span> : <span className="flex items-center gap-2 text-sm font-bold text-rose-600 dark:text-rose-400"><XCircle size={17} /> The answer is <span className="font-black underline">{card.word}</span></span>}</div><button data-color-role="primary" ref={nextButtonRef} type="button" onClick={onNext} className="flex min-h-11 items-center gap-1 rounded-xl bg-[var(--sf-brand)] px-6 py-2.5 text-xs font-bold text-[var(--sf-on-brand)] transition-colors hover:bg-[var(--sf-brand-hover)] hover:text-white focus-visible:outline-2 motion-reduce:transition-none">{currentIndex === cards.length - 1 ? 'View results' : 'Next'} <ChevronRight size={14} aria-hidden="true" /></button></GsapEntrance>}
          </GsapEntrance>
          <div className="h-1 w-full overflow-hidden rounded-full bg-[var(--sf-surface-raised)]" role="progressbar" aria-label="Spelling progress" aria-valuemin={0} aria-valuemax={cards.length} aria-valuenow={currentIndex + (checked ? 1 : 0)}><div className="h-full w-full origin-left bg-[var(--sf-brand)] transition-transform duration-200 motion-reduce:transition-none" style={{ transform: `scaleX(${(currentIndex + (checked ? 1 : 0)) / cards.length})` }} /></div>
        </div>
      ) : null}
    </div>
  );
}
