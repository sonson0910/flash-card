import { msg } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react';
import { AudioLines } from 'lucide-react';
import type { CSSProperties, MouseEvent, PointerEvent, ReactNode } from 'react';
import { cardTargetLanguageKey } from './cardLanguage';
import { parseSyllables } from '../../lib/syllableParser';
import type { CardData } from '../../types/card';
import { ReadingToggle } from './ReadingToggle';
import { SyllableStressBadge } from './SyllableStressBadge';

function renderLuminescentPhonetic(phonetic?: string | null, onDarkSurface = false) {
  if (!phonetic) return '/.../';
  if (!phonetic.includes('ˈ')) return phonetic;

  const parts = phonetic.split('ˈ');
  const before = parts[0];
  const after = parts.slice(1).join('ˈ');
  const match = after.match(/^([^\s.,/]+)(.*)$/);
  if (!match) return phonetic;

  const [, stressedSyl, rest] = match;
  return (
    <>
      {before}
      <span className={`font-black ${onDarkSurface ? 'text-cyan-200 drop-shadow-[0_0_6px_rgba(6,182,212,0.8)]' : 'text-[var(--sf-brand-text)]'}`}>
        <span aria-hidden="true">{'ˈ'}</span>
        {stressedSyl}
      </span>
      {rest}
    </>
  );
}

/**
 * Splits an English headword around its stressed first syllable. The accent is
 * only drawn when the IPA marks primary stress on the opening syllable, which
 * is the one case the orthographic split can place without guessing.
 */
export function headwordStressParts(card: Pick<CardData, 'word' | 'phonetic' | 'language'>) {
  if (cardTargetLanguageKey(card) !== 'en') return null;
  const ipa = (card.phonetic || '').trim().replace(/^[/[]\s*/, '');
  if (!ipa.startsWith('ˈ')) return null;
  const word = card.word.trim();
  if (!word || /\s/.test(word)) return null;
  const analysis = parseSyllables(word);
  if (!analysis.hasMultipleSyllables) return null;
  const stressed = analysis.syllables[0]?.text ?? '';
  if (!stressed || !word.startsWith(stressed) || stressed.length >= word.length) return null;
  return { stressed, rest: word.slice(stressed.length) };
}

interface CardHeadwordProps {
  card: CardData;
  variant?: 'standard' | 'zen' | 'zen-back';
  onPlayAudio?: (event: MouseEvent | PointerEvent) => void;
  isPlayingAudio?: boolean;
  /** Rendered first in the pronunciation line, before the IPA (the paper card puts the part of speech there). */
  leading?: ReactNode;
}

export function CardHeadword({ card, variant = 'standard', onPlayAudio, isPlayingAudio = false, leading }: CardHeadwordProps) {
  const { _ } = useLingui();
  const { word, phonetic } = card;
  const targetLanguage = card.language || 'en';
  const isEnglish = cardTargetLanguageKey(card) === 'en';

  if (variant !== 'standard') {
    return (
      <div data-card-headword>
        {card.partOfSpeech && <span className="mb-1 inline-flex rounded-lg border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] px-2 py-0.5 text-[10px] font-semibold text-[var(--sf-text-muted)]"><span className="sr-only"><Trans {...msg({ context: 'flashcard.part-of-speech-prefix', message: 'Part of speech:' })} /> </span><span lang={targetLanguage}>{card.partOfSpeech}</span></span>}
        <h2 className={`zen-editorial-serif break-words text-balance font-normal tracking-tight text-white ${variant === 'zen' ? 'text-5xl sm:text-6xl' : 'text-4xl sm:text-5xl'}`} lang={targetLanguage}>{word}</h2>
        {isEnglish && <div className="mt-1.5 flex items-center gap-2">
          <span className={variant === 'zen'
            ? 'inline-flex items-center gap-1.5 font-mono text-sm text-white/70'
            : 'inline-flex items-center gap-1.5 font-mono text-xs font-medium text-[var(--sf-text-muted)]'}>
            <AudioLines size={13} className="shrink-0 text-[var(--sf-brand)]" aria-hidden="true" />
            <span lang={targetLanguage}>{renderLuminescentPhonetic(phonetic, true)}</span>
          </span>
        </div>}
        <SyllableStressBadge card={card} onDarkSurface />
        <ReadingToggle card={card} onDarkSurface />
      </div>
    );
  }

  const stress = headwordStressParts(card);
  const headwordStyle = { '--headword-chars': Math.max(4, Array.from(word).length) } as CSSProperties;
  return (
    <div data-card-headword className="flashcard-headword">
      <h2
        className="flashcard-headword-word flashcard-word-gradient break-words text-balance [overflow-wrap:anywhere]"
        style={headwordStyle}
        lang={targetLanguage}
        aria-label={stress ? word : undefined}
      >
        {stress ? <><span data-headword-stress className="flashcard-headword-stress">{stress.stressed}</span>{stress.rest}</> : word}
      </h2>
      <div data-card-pronunciation className="flashcard-pronunciation flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1">
        {leading}
        {onPlayAudio && (
          <button
            type="button"
            data-card-control
            data-card-effect="audio"
            data-playing={isPlayingAudio ? 'true' : 'false'}
            onPointerDown={event => event.stopPropagation()}
            onClick={onPlayAudio}
            className="flashcard-play-button touch-manipulation flex size-11 shrink-0 items-center justify-center focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sf-brand)]"
            aria-label={_(msg({ id: 'flashcard.audio.play-pronunciation', message: 'Play pronunciation' }))}
            title={_(msg({ id: 'flashcard.audio.play-pronunciation', message: 'Play pronunciation' }))}
          >
            {isPlayingAudio
              ? <span data-audio-waves="active" className="flex h-3.5 items-center gap-0.5" aria-hidden="true"><span className="wave-bar-1 h-full w-[3px] rounded-full bg-current" /><span className="wave-bar-2 h-full w-[3px] rounded-full bg-current" /><span className="wave-bar-3 h-full w-[3px] rounded-full bg-current" /><span className="wave-bar-4 h-full w-[3px] rounded-full bg-current" /></span>
              : <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13l11-6.5z" /></svg>}
          </button>
        )}
        {isEnglish && phonetic && <span lang={targetLanguage} className="flashcard-ipa font-mono">{phonetic}</span>}
        <SyllableStressBadge card={card} />
      </div>
      <ReadingToggle card={card} />
    </div>
  );
}
