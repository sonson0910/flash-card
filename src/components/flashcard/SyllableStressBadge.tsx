import { Volume2 } from 'lucide-react';
import { msg } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react';
import React, { useMemo } from 'react';
import { parseSyllables, type SyllablePart } from '../../lib/syllableParser';
import { triggerHaptic } from '../../lib/haptics';
import { voiceForActiveCourseCard } from '../../lib/courseVoicePreference';
import { speechLocaleFor } from '../../lib/speechLocale';
import { resolveLanguagePackId } from '../../features/languagePacks/registry';
import { useCourseSession } from '../../features/courses/CourseGate';
import type { CardData } from '../../types/card';

interface SyllableStressBadgeProps {
  card: CardData;
  className?: string;
  onDarkSurface?: boolean;
}

export const SyllableStressBadge = React.memo(function SyllableStressBadge({
  card,
  className = '',
  onDarkSurface = false,
}: SyllableStressBadgeProps) {
  const { _, i18n } = useLingui();
  const { model: courseModel } = useCourseSession();
  const { word, phonetic } = card;
  const targetLanguage = card.language || 'en';
  // English-only: the vowel-cluster heuristic and IPA stress markers below
  // only model English syllabification. Non-English packs get a reading
  // toggle (romanization/furigana/pinyin) instead, rendered by CardHeadword.
  const isEnglishPack = resolveLanguagePackId(card.language) === 'en';
  const analysis = useMemo(() => parseSyllables(word, phonetic), [word, phonetic]);

  if (!isEnglishPack || !analysis.hasMultipleSyllables || analysis.syllables.length <= 1) {
    return null;
  }

  const speakSyllable = (e: React.MouseEvent, syllable: SyllablePart) => {
    e.stopPropagation();
    triggerHaptic('light');

    if ('speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined') {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(syllable.text);
      utterance.lang = speechLocaleFor(card);
      const voice = voiceForActiveCourseCard(card, courseModel.activeCourse);
      if (voice) utterance.voice = voice;
      utterance.rate = 0.75;
      window.speechSynthesis.speak(utterance);
    }
  };

  return (
    <div
      className={`mt-2 flex flex-wrap items-center gap-1.5 ${className}`}
      aria-label={i18n._(msg({ id: 'flashcard.syllables.breakdown', message: 'Syllable breakdown for {word}' }).id, { word })}
      title={_(msg({ id: 'flashcard.syllables.help', message: 'Syllables & Stress. Tap a syllable to hear its pronunciation.' }))}
    >
      <span className={`text-[10px] font-black uppercase tracking-[0.14em] mr-0.5 ${onDarkSurface ? 'text-slate-200' : 'text-slate-500 dark:text-slate-400'}`}>
        <Trans id="flashcard.syllables" message="Syllables:" />
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
              className={`group relative flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs transition-all duration-200 cursor-pointer hover:border-cyan-400/40 active:scale-95 ${onDarkSurface ? 'border-white/20 bg-white/10 hover:bg-white/15' : 'border-slate-200/80 bg-slate-100/70 dark:border-white/10 dark:bg-white/5 hover:bg-white/10'} ${
                isStressed
                  ? onDarkSurface ? 'text-cyan-200 font-extrabold' : 'text-cyan-600 dark:text-cyan-300 font-extrabold'
                  : onDarkSurface ? 'text-slate-100 font-medium' : 'text-slate-600 dark:text-slate-400 font-medium'
              }`}
              title={isStressed ? i18n._(msg({ id: 'flashcard.syllables.primary-stress', message: 'Primary stress: {syllable}' }).id, { syllable: syl.text }) : i18n._(msg({ id: 'flashcard.syllables.item', message: 'Syllable: {syllable}' }).id, { syllable: syl.text })}
            >
              <span className="inline-flex items-center">
                {isStressed && (
                  <span
                    className="mr-1 inline-block size-1.5 rounded-full bg-cyan-500 dark:bg-cyan-300 shadow-[0_0_8px_currentColor] animate-pulse"
                    aria-hidden="true"
                  />
                )}
                <span lang={targetLanguage} className={isStressed ? 'drop-shadow-[0_0_8px_rgba(6,182,212,0.85)]' : undefined}>{syl.text}</span>
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
