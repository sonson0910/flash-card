import { msg } from '@lingui/core/macro';
import { Trans } from '@lingui/react';
import { AudioLines } from 'lucide-react';
import { resolveLanguagePackId } from '../../features/languagePacks/registry';
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

interface CardHeadwordProps {
  card: CardData;
  variant?: 'standard' | 'zen' | 'zen-back';
}

export function CardHeadword({ card, variant = 'standard' }: CardHeadwordProps) {
  const { word, phonetic } = card;
  const targetLanguage = card.language || 'en';
  const isEnglish = resolveLanguagePackId(card.language) === 'en';
  return (
    <div data-card-headword>
      {card.partOfSpeech && <span className="mb-1 inline-flex rounded-lg border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] px-2 py-0.5 text-[10px] font-semibold text-[var(--sf-text-muted)]"><span className="sr-only"><Trans {...msg({ context: 'flashcard.part-of-speech-prefix', message: 'Part of speech:' })} /> </span><span lang={targetLanguage}>{card.partOfSpeech}</span></span>}
      <h2 className={variant !== 'standard'
        ? `zen-editorial-serif break-words text-balance font-normal tracking-tight text-white ${variant === 'zen' ? 'text-5xl sm:text-6xl' : 'text-4xl sm:text-5xl'}`
        : 'flashcard-word-gradient break-words text-balance text-3xl font-black tracking-[-0.04em] drop-shadow-xs [overflow-wrap:anywhere] sm:text-4xl'} lang={targetLanguage}>{word}</h2>
      {isEnglish && <div className="mt-1.5 flex items-center gap-2">
        <span className={variant === 'zen'
          ? 'inline-flex items-center gap-1.5 font-mono text-sm text-white/70'
          : 'inline-flex items-center gap-1.5 font-mono text-xs font-medium text-[var(--sf-text-muted)]'}>
          <AudioLines size={13} className="shrink-0 text-[var(--sf-brand)]" aria-hidden="true" />
          <span lang={targetLanguage}>{renderLuminescentPhonetic(phonetic, variant !== 'standard')}</span>
        </span>
      </div>}
      <SyllableStressBadge card={card} onDarkSurface={variant !== 'standard'} />
      <ReadingToggle card={card} onDarkSurface={variant !== 'standard'} />
    </div>
  );
}
