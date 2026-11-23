import { msg } from '@lingui/core/macro';
import { CheckCircle2, HelpCircle, Sparkles, XCircle } from 'lucide-react';
import { Trans } from '@lingui/react';
import React, { useMemo, useState } from 'react';
import type { CardData } from '../../types/card';
import { playRewardSound } from '../../lib/interactionSounds';
import { triggerHaptic } from '../../lib/haptics';

interface ActiveRecallQuizProps {
  card: CardData;
  onRevealMeaning: () => void;
  className?: string;
}

// Wrong options come from the card's own translation language, so the right one never stands out by language.
const DISTRACTORS_BY_LANGUAGE: Record<string, string[]> = {
  vi: [
    'sự ngẫu nhiên may mắn',
    'sự kiên trì bền bỉ',
    'sự hoài niệm sâu sắc',
    'khả năng phục hồi nhanh',
    'sự hào phóng rộng lượng',
    'sự nhạy bén tinh tế',
    'sự nhiệt huyết đam mê',
    'trạng thái cân bằng',
  ],
  en: [
    'good fortune',
    'quiet persistence',
    'deep nostalgia',
    'quick recovery',
    'generous spirit',
    'keen insight',
    'passionate enthusiasm',
    'a state of balance',
  ],
};

export const ActiveRecallQuiz = React.memo(function ActiveRecallQuiz({
  card,
  onRevealMeaning,
  className = '',
}: ActiveRecallQuizProps) {
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [isAnswered, setIsAnswered] = useState(false);
  const translationLanguage = card.translationLanguage || 'vi';

  // Generate 3 choices: 1 correct + 2 distractors
  const options = useMemo(() => {
    const correct = card.translation.trim();
    const pool = (DISTRACTORS_BY_LANGUAGE[translationLanguage] ?? []).filter(item => item !== correct.toLowerCase());

    // Pick 2 random distractors
    const shuffledPool = [...pool].sort(() => 0.5 - Math.random());
    const distractors = shuffledPool.slice(0, 2);

    return [correct, ...distractors].sort(() => 0.5 - Math.random());
  }, [card.translation, translationLanguage]);

  // No distractors in this language: a quiz with one option would test nothing.
  if (options.length < 3) return null;

  const handleSelect = (e: React.MouseEvent, option: string) => {
    e.stopPropagation();
    if (isAnswered) return;

    setSelectedOption(option);
    setIsAnswered(true);

    const isCorrect = option === card.translation.trim();
    if (isCorrect) {
      playRewardSound();
      triggerHaptic('medium');
    } else {
      triggerHaptic('heavy');
    }
  };

  return (
    <div
      className={`mt-3.5 w-full rounded-[24px] border border-[color-mix(in_srgb,var(--sf-brand)_35%,transparent)] bg-[color-mix(in_srgb,var(--sf-brand)_8%,var(--sf-card-bg,var(--sf-surface)))] p-4 text-left text-[var(--sf-text)] shadow-[var(--sf-panel-shadow)] backdrop-blur-2xl [html[data-theme-family=crystal]_&]:rounded-none [html[data-theme-family=crystal]_&]:crystal-chamfer-sm ${className}`}
      data-card-control
    >
      <div className="flex items-center justify-between gap-2 border-b border-[var(--sf-border)] pb-2.5 mb-3">
        <div className="flex items-center gap-1.5 text-[var(--sf-brand-text)]">
          <HelpCircle size={14} aria-hidden="true" />
          <span className="text-[10px] font-black uppercase tracking-[0.16em]">
            <Trans {...msg({ context: 'flashcard.quiz.heading', message: 'Active Recall Quiz · Guess the Meaning' })} />
          </span>
        </div>
        <span className="text-[10px] font-bold text-[var(--sf-text-muted)]"><Trans {...msg({ context: 'flashcard.quiz.select-option', message: 'Select 1 option' })} /></span>
      </div>

      <div className="grid grid-cols-1 gap-2">
        {options.map((option, idx) => {
          const isChosen = selectedOption === option;
          const isCorrect = option === card.translation.trim();

          let buttonStyle = 'border-[var(--sf-border)] bg-[var(--sf-surface-control)] text-[var(--sf-text)] hover:border-[var(--sf-brand)] hover:bg-[var(--sf-surface-raised)] active:scale-[0.99]';
          if (isAnswered) {
            if (isCorrect) {
              buttonStyle = 'border-[var(--sf-success)] bg-[color-mix(in_srgb,var(--sf-success)_18%,transparent)] text-[var(--sf-text)] font-black';
            } else if (isChosen) {
              buttonStyle = 'border-[var(--sf-danger)] bg-[color-mix(in_srgb,var(--sf-danger)_14%,transparent)] text-[var(--sf-text)] line-through';
            } else {
              buttonStyle = 'opacity-40 border-[var(--sf-border)] bg-transparent text-[var(--sf-text-muted)]';
            }
          }

          return (
            <button
              key={`${option}-${idx}`}
              type="button"
              data-card-control
              disabled={isAnswered}
              onPointerDown={e => e.stopPropagation()}
              onClick={e => handleSelect(e, option)}
              className={`flex min-h-11 items-center justify-between rounded-full border px-4 py-2.5 text-xs font-bold transition-[background-color,border-color,transform] duration-200 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sf-brand)] motion-reduce:transition-none [html[data-theme-family=crystal]_&]:rounded-none [html[data-theme-family=crystal]_&]:crystal-chamfer-sm ${buttonStyle}`}
            >
              <span lang={translationLanguage} className="first-letter:uppercase">{option}</span>
              {isAnswered && isCorrect && <CheckCircle2 size={14} className="text-[var(--sf-success)] shrink-0 ml-2" aria-hidden="true" />}
              {isAnswered && isChosen && !isCorrect && <XCircle size={14} className="text-[var(--sf-danger)] shrink-0 ml-2" aria-hidden="true" />}
            </button>
          );
        })}
      </div>

      {isAnswered && (
        <div className="mt-3 pt-2.5 border-t border-[var(--sf-border)] flex items-center justify-between gap-2 animate-in fade-in duration-300">
          <p className="text-[11px] font-bold text-[var(--sf-brand-text)] flex items-center gap-1.5">
            <Sparkles size={13} className="shrink-0" aria-hidden="true" />
            <span>{selectedOption === card.translation.trim() ? <Trans {...msg({ context: 'flashcard.quiz.correct', message: 'Excellent! You recalled it accurately.' })} /> : <Trans {...msg({ context: 'flashcard.quiz.incorrect', message: 'Nice try! Flip the card to review the definition.' })} />}</span>
          </p>
          <button
            type="button"
            data-card-control
            onPointerDown={e => e.stopPropagation()}
            onClick={e => {
              e.stopPropagation();
              onRevealMeaning();
            }}
            className="flex min-h-11 shrink-0 items-center rounded-full bg-[var(--sf-brand)] px-4 text-[11px] font-black uppercase tracking-wider text-[var(--sf-on-brand)] hover:bg-[var(--sf-brand-hover)] active:scale-95 transition-[background-color,transform] cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sf-brand)] motion-reduce:transition-none [html[data-theme-family=crystal]_&]:rounded-none [html[data-theme-family=crystal]_&]:crystal-chamfer-sm"
          >
            <Trans {...msg({ context: 'flashcard.quiz.flip-now', message: 'Flip card now' })} />
          </button>
        </div>
      )}
    </div>
  );
});
