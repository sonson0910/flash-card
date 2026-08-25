import { Volume2 } from 'lucide-react';
import React, { useMemo } from 'react';
import { parseSyllables, type SyllablePart } from '../../lib/syllableParser';
import { triggerHaptic } from '../../lib/haptics';

interface SyllableStressBadgeProps {
  word: string;
  phonetic?: string;
  className?: string;
}

export const SyllableStressBadge = React.memo(function SyllableStressBadge({
  word,
  phonetic,
  className = '',
}: SyllableStressBadgeProps) {
  const analysis = useMemo(() => parseSyllables(word, phonetic), [word, phonetic]);

  if (!analysis.hasMultipleSyllables || analysis.syllables.length <= 1) {
    return null;
  }

  const speakSyllable = (e: React.MouseEvent, syllable: SyllablePart) => {
    e.stopPropagation();
    triggerHaptic('light');

    if ('speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined') {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(syllable.text);
      utterance.lang = 'en-US';
      utterance.rate = 0.75;
      window.speechSynthesis.speak(utterance);
    }
  };

  return (
    <div
      className={`mt-2 flex flex-wrap items-center gap-1.5 ${className}`}
      aria-label={`Syllable breakdown for ${word}`}
      title="Syllables & Stress. Tap a syllable to hear its pronunciation."
    >
      <span className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400 mr-0.5">
        Syllables:
      </span>
      <div className="flex flex-wrap items-center gap-1.5">
        {analysis.syllables.map((syl, idx) => {
          const isStressed = syl.isPrimaryStress;
          return (
            <button
              key={`${syl.text}-${idx}`}
              type="button"
              data-card-control
              onPointerDown={e => e.stopPropagation()}
              onClick={e => speakSyllable(e, syl)}
              className={`group relative flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs transition-all duration-200 cursor-pointer ${
                isStressed
                  ? 'border-cyan-400/80 bg-cyan-100 text-cyan-950 font-black shadow-xs ring-1 ring-cyan-400/30 dark:border-cyan-400/70 dark:bg-cyan-500/20 dark:text-cyan-300 dark:shadow-[0_0_12px_rgba(6,182,212,0.3)] hover:scale-105 active:scale-95'
                  : 'border-slate-200 bg-slate-100/90 text-slate-700 font-bold hover:border-cyan-400 hover:text-cyan-800 hover:bg-slate-200/80 dark:border-white/12 dark:bg-white/5 dark:text-slate-300 dark:hover:border-cyan-400/40 dark:hover:text-white dark:hover:bg-white/10 active:scale-95'
              }`}
              title={isStressed ? `Primary stress: ${syl.text}` : `Syllable: ${syl.text}`}
            >
              <span className="inline-flex items-center">
                {isStressed && (
                  <span className="mr-0.5 font-black text-cyan-700 dark:text-cyan-400" aria-hidden="true">
                    ˈ
                  </span>
                )}
                <span>{syl.text}</span>
              </span>
              <Volume2
                size={10}
                className="opacity-0 group-hover:opacity-100 transition-opacity text-cyan-700 dark:text-cyan-300 shrink-0"
                aria-hidden="true"
              />
            </button>
          );
        })}
      </div>
    </div>
  );
});
