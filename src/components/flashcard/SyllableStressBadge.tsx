import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';
import { voiceForActiveCourseCard } from '../../lib/courseVoicePreference';
import { speechLocaleFor } from '../../lib/speechLocale';
import { resolveLanguagePackId } from '../../features/languagePacks/registry';
import { useCourseSession } from '../../features/courses/CourseGate';
import type { CardData } from '../../types/card';
import React, { Fragment, useEffect, useMemo, useRef } from 'react';
import { parseSyllables, type SyllablePart } from '../../lib/syllableParser';
import { triggerHaptic } from '../../lib/haptics';
import { playWordAudio, type WordAudioPlayback } from '../../lib/audio';

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
  const playbackRef = useRef<WordAudioPlayback | null>(null);

  useEffect(() => () => playbackRef.current?.cancel(), [word]);

  if (!isEnglishPack || !analysis.hasMultipleSyllables || analysis.syllables.length <= 1) {
    return null;
  }

  const speakSyllable = (e: React.MouseEvent, syllable: SyllablePart) => {
    e.stopPropagation();
    triggerHaptic('light');

    playbackRef.current?.cancel();
    playbackRef.current = playWordAudio(syllable.text, null, {
      speed: 0.75, speechLocale: speechLocaleFor(card),
      voice: voiceForActiveCourseCard(card, courseModel.activeCourse),
    });
  };

  return (
    <div
      data-syllable-line
      className={`flashcard-syllables flex flex-wrap items-center ${className}`}
      aria-label={i18n._(msg({ id: 'flashcard.syllables.breakdown', message: 'Syllable breakdown for {word}' }).id, { word })}
      title={_(msg({ id: 'flashcard.syllables.help', message: 'Syllables & Stress. Tap a syllable to hear its pronunciation.' }))}
    >
      {analysis.syllables.map((syl, idx) => {
        const isStressed = syl.isPrimaryStress;
        return (
          <Fragment key={`${syl.text}-${idx}`}>
            {idx > 0 && <span className="-mx-1.5 text-[13px] text-[var(--sf-text-muted)]" aria-hidden="true">·</span>}
            <button
              type="button"
              data-card-control
              data-syllable-stressed={isStressed ? 'true' : undefined}
              onPointerDown={e => e.stopPropagation()}
              onClick={e => speakSyllable(e, syl)}
              className={`touch-manipulation inline-flex min-h-11 min-w-11 items-center justify-center rounded-md px-1 text-[13px] transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--sf-brand)] ${
                isStressed
                  ? 'font-bold text-[var(--sf-brand-text)]'
                  : onDarkSurface ? 'opacity-75 hover:opacity-100' : 'text-[var(--sf-text-muted)] hover:text-[var(--sf-text)]'
              }`}
              title={isStressed ? i18n._(msg({ id: 'flashcard.syllables.primary-stress', message: 'Primary stress: {syllable}' }).id, { syllable: syl.text }) : i18n._(msg({ id: 'flashcard.syllables.item', message: 'Syllable: {syllable}' }).id, { syllable: syl.text })}
            >
              <span lang={targetLanguage}>{syl.text}</span>
            </button>
          </Fragment>
        );
      })}
    </div>
  );
});
