import { CheckCircle2, HelpCircle, Sparkles, XCircle } from 'lucide-react';
import React, { useMemo, useState } from 'react';
import type { CardData } from '../../types/card';
import { playRewardSound } from '../../lib/interactionSounds';
import { triggerHaptic } from '../../lib/haptics';

interface ActiveRecallQuizProps {
  card: CardData;
  onRevealMeaning: () => void;
  className?: string;
}

const DISTRACTORS_FALLBACK: Record<string, string[]> = {
  default: [
    'sự ngẫu nhiên may mắn',
    'sự kiên trì bền bỉ',
    'sự hoài niệm sâu sắc',
    'khả năng phục hồi nhanh',
    'sự hào phóng rộng lượng',
    'sự nhạy bén tinh tế',
    'sự nhiệt huyết đam mê',
    'trạng thái cân bằng',
  ],
};

export const ActiveRecallQuiz = React.memo(function ActiveRecallQuiz({
  card,
  onRevealMeaning,
  className = '',
}: ActiveRecallQuizProps) {
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [isAnswered, setIsAnswered] = useState(false);

  // Generate 3 choices: 1 correct + 2 distractors
  const options = useMemo(() => {
    const correct = card.translation.trim();
    const pool = DISTRACTORS_FALLBACK.default.filter(item => item !== correct.toLowerCase());
    
    // Pick 2 random distractors
    const shuffledPool = [...pool].sort(() => 0.5 - Math.random());
    const distractors = shuffledPool.slice(0, 2);

    return [correct, ...distractors].sort(() => 0.5 - Math.random());
  }, [card.translation]);

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
      className={`mt-3.5 w-full rounded-[24px] border border-cyan-400/35 bg-cyan-500/[0.08] p-4 text-left shadow-[0_16px_35px_-10px_rgba(6,182,212,0.18),inset_0_1px_0_rgba(255,255,255,0.15)] backdrop-blur-2xl ${className}`}
      data-card-control
    >
      <div className="flex items-center justify-between gap-2 border-b border-cyan-400/20 pb-2.5 mb-3">
        <div className="flex items-center gap-1.5 text-cyan-300">
          <HelpCircle size={14} className="text-cyan-400" />
          <span className="text-[10px] font-black uppercase tracking-[0.16em]">
            Active Recall Quiz · Guess the Meaning
          </span>
        </div>
        <span className="text-[10px] font-bold text-slate-400">Select 1 option</span>
      </div>

      <div className="grid grid-cols-1 gap-2">
        {options.map((option, idx) => {
          const isChosen = selectedOption === option;
          const isCorrect = option === card.translation.trim();

          let buttonStyle = 'border-white/12 bg-white/5 text-slate-200 hover:border-cyan-400/50 hover:bg-white/10 hover:scale-[1.01] active:scale-[0.99]';
          if (isAnswered) {
            if (isCorrect) {
              buttonStyle = 'border-emerald-400/80 bg-emerald-500/25 text-emerald-300 font-black shadow-[0_0_15px_rgba(16,185,129,0.3)]';
            } else if (isChosen) {
              buttonStyle = 'border-rose-400/80 bg-rose-500/25 text-rose-300 line-through';
            } else {
              buttonStyle = 'opacity-40 border-white/8 bg-white/3 text-slate-400';
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
              className={`flex items-center justify-between rounded-full border px-4 py-2.5 text-xs font-bold transition-[filter,opacity,background-color,border-color,color,scale,box-shadow] duration-200 cursor-pointer ${buttonStyle}`}
            >
              <span className="first-letter:uppercase">{option}</span>
              {isAnswered && isCorrect && <CheckCircle2 size={14} className="text-emerald-400 shrink-0 ml-2" />}
              {isAnswered && isChosen && !isCorrect && <XCircle size={14} className="text-rose-400 shrink-0 ml-2" />}
            </button>
          );
        })}
      </div>

      {isAnswered && (
        <div className="mt-3 pt-2.5 border-t border-cyan-400/20 flex items-center justify-between gap-2 animate-in fade-in duration-300">
          <p className="text-[11px] font-bold text-cyan-300 flex items-center gap-1.5">
            <Sparkles size={13} className="text-cyan-400 shrink-0" />
            <span>{selectedOption === card.translation.trim() ? 'Excellent! You recalled it accurately.' : 'Nice try! Flip the card to review the definition.'}</span>
          </p>
          <button
            type="button"
            data-card-control
            onPointerDown={e => e.stopPropagation()}
            onClick={e => {
              e.stopPropagation();
              onRevealMeaning();
            }}
            className="shrink-0 rounded-full bg-cyan-400 px-4 py-1.5 text-[11px] font-black uppercase tracking-wider text-[#071014] shadow-md shadow-cyan-500/25 hover:bg-cyan-300 active:scale-95 transition-[filter,background-color,scale] cursor-pointer"
          >
            Flip card now
          </button>
        </div>
      )}
    </div>
  );
});
