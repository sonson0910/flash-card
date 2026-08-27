import { Eye, Image as ImageIcon, Volume2 } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import type { CardData } from '../../types/card';
import { buildRecallPrompt, isRecallAnswerCorrect, type RecallMode } from '../../lib/recall';
import { isSupportedImageUrl } from '../../lib/images';
import { CardImage } from './CardImage';

interface ActiveRecallPromptProps {
  card: CardData;
  mode: RecallMode;
  onReveal: () => void;
  onImageUnavailable?: () => void;
}

export function ActiveRecallPrompt({ card, mode, onReveal, onImageUnavailable }: ActiveRecallPromptProps) {
  const prompt = buildRecallPrompt(card, mode);
  const imageUrl = isSupportedImageUrl(card.imageUrl) ? card.imageUrl : null;
  const [answerInput, setAnswerInput] = useState('');
  const [answerCorrect, setAnswerCorrect] = useState<boolean | null>(null);

  useEffect(() => {
    setAnswerInput('');
    setAnswerCorrect(null);
  }, [card.id, mode]);

  const speakPrompt = () => {
    if (!('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(card.word);
    utterance.lang = 'en-US';
    utterance.rate = 0.85;
    window.speechSynthesis.speak(utterance);
  };

  const playPrompt = () => {
    if (card.audioUrl && typeof Audio !== 'undefined') {
      const audio = new Audio(card.audioUrl);
      void audio.play().catch(speakPrompt);
      return;
    }
    speakPrompt();
  };

  const checkAnswer = (event: FormEvent) => {
    event.preventDefault();
    if (!answerInput.trim()) return;
    setAnswerCorrect(isRecallAnswerCorrect(answerInput, prompt.answer));
  };

  return (
    <section
      className="group mx-auto flex h-[480px] w-full max-w-xl flex-col overflow-hidden rounded-[32px] border border-[var(--sf-border)] bg-[var(--sf-surface)] shadow-xl md:max-w-2xl"
      aria-labelledby="recall-instruction"
    >
      <div className="px-6 pt-6 text-center">
        <p id="recall-instruction" className="text-[11px] font-black uppercase tracking-[0.2em] text-[var(--sf-brand-text)]">
          {prompt.instruction}
        </p>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center gap-4 p-6 sm:p-8 text-center overflow-y-auto">
        {prompt.showImage ? (
          imageUrl ? (
            <div className="w-full max-w-sm h-52 overflow-hidden rounded-3xl shadow-lg">
              <CardImage
                src={imageUrl}
                alt={`Illustration for ${card.word}`}
                priority
                onUnavailable={onImageUnavailable}
              />
            </div>
          ) : (
            <div className="flex h-44 w-44 items-center justify-center rounded-3xl border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] text-[var(--sf-text-muted)]" role="img" aria-label="No illustration available">
              <ImageIcon size={48} strokeWidth={1.5} />
            </div>
          )
        ) : prompt.playAudio ? (
          <button
            type="button"
            onClick={playPrompt}
            className="flex h-28 w-28 items-center justify-center rounded-full border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] text-[var(--sf-brand-text)] transition-transform hover:scale-[1.03] active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--sf-brand)]"
            aria-label="Play word for listening practice"
          >
            <Volume2 size={46} />
          </button>
        ) : (
          <h2 className="text-balance text-4xl font-black capitalize text-[var(--sf-text)] sm:text-5xl">{prompt.promptText}</h2>
        )}

        <p className="text-sm text-[var(--sf-text-muted)]">Recall first, then type your answer to check it.</p>

        <form onSubmit={checkAnswer} className="w-full max-w-sm flex gap-2" aria-label="Check recalled answer">
          <label htmlFor={`recall-answer-${card.id}`} className="sr-only">Your answer</label>
          <input
            id={`recall-answer-${card.id}`}
            value={answerInput}
            onChange={event => {
              setAnswerInput(event.target.value);
              setAnswerCorrect(null);
            }}
            autoComplete="off"
            spellCheck="false"
            placeholder="Type your answer…"
            className="min-h-11 min-w-0 flex-1 rounded-xl border-2 border-[var(--sf-border)] bg-[var(--sf-surface)] px-4 text-base text-[var(--sf-text)] placeholder:text-[var(--sf-text-muted)] focus:border-[var(--sf-brand)] focus:outline-none focus:ring-2 focus:ring-cyan-600/25"
          />
          <button
            type="submit"
            disabled={!answerInput.trim()}
            className="min-h-11 rounded-xl border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] px-4 text-xs font-black uppercase tracking-wider text-[var(--sf-text)] transition-colors hover:border-[var(--sf-brand)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            Check
          </button>
        </form>

        <p className={`min-h-5 text-sm font-bold ${answerCorrect === true ? 'text-emerald-700 dark:text-emerald-300' : answerCorrect === false ? 'text-rose-700 dark:text-rose-300' : 'text-[var(--sf-text-muted)]'}`} aria-live="polite">
          {answerCorrect === true ? 'Correct. Reveal the answer to compare.' : answerCorrect === false ? 'Not quite. Try again or reveal the answer to check.' : ''}
        </p>
      </div>

      <button
        type="button"
        onClick={onReveal}
        className="flex h-16 flex-shrink-0 items-center justify-center gap-2 bg-[var(--sf-brand)] text-xs font-black uppercase tracking-[0.15em] text-[var(--sf-on-brand)] transition-colors hover:bg-[var(--sf-brand-hover)] focus-visible:outline-2 focus-visible:outline-offset-[-4px] focus-visible:outline-[var(--sf-on-brand)]"
      >
        <Eye size={16} /> Reveal answer
      </button>
    </section>
  );
}
