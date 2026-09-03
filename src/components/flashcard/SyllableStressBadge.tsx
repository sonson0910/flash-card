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
              className={`group relative flex items-center gap-1.5 rounded-full border border-slate-200/80 bg-slate-100/70 px-2.5 py-0.5 text-xs transition-all duration-200 cursor-pointer dark:border-white/10 dark:bg-white/5 hover:border-cyan-400/40 hover:bg-white/10 active:scale-95 ${
                isStressed
                  ? 'text-cyan-600 dark:text-cyan-300 font-extrabold'
                  : 'text-slate-600 dark:text-slate-400 font-medium'
              }`}
              title={isStressed ? `Primary stress: ${syl.text}` : `Syllable: ${syl.text}`}
            >
              <span className="inline-flex items-center">
                {isStressed && (
                  <span
                    className="mr-1 inline-block size-1.5 rounded-full bg-cyan-500 dark:bg-cyan-300 shadow-[0_0_8px_currentColor] animate-pulse"
                    aria-hidden="true"
                  />
                )}
                <span className={isStressed ? 'drop-shadow-[0_0_8px_rgba(6,182,212,0.85)]' : undefined}>{syl.text}</span>
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
