import { msg } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react';
import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties, MouseEvent, PointerEvent } from 'react';
import { getCachedLanguagePack, loadLanguagePack, resolveLanguagePackId } from '../../features/languagePacks/registry';
import { loadScriptFont } from '../../features/theme/loadThemeAssets';
import type { LanguagePack } from '../../features/languagePacks/types';
import type { CardData } from '../../types/card';
import { buildExampleSegments, buildLanguageCardReading, type HeadwordSegment, type JapanesePitchType, type LanguageCardReading } from './languageCardReading';

type CardPack = 'ko' | 'ja' | 'zh';

/** BCP-47 tag for text in the card's target language, so the browser picks the right CJK glyphs. */
export function cardTextLang(card: Pick<CardData, 'language'>): string {
  return card.language?.trim() || 'en';
}

/** The target language's own name ("한국어", "日本語", "中文"), as the Crystal card prints it. */
export function cardEndonym(card: Pick<CardData, 'language'>): string | null {
  const code = resolveLanguagePackId(card.language);
  if (code === 'en') return null;
  try {
    return new Intl.DisplayNames([code], { type: 'language' }).of(code) ?? null;
  } catch {
    return null;
  }
}

/**
 * Reading aids of a language-pack card. The pack that validates the stored reading loads lazily, so
 * its code stays out of the initial bundle; until it resolves the card shows the plain headword.
 */
export function useLanguageCardReading(card: CardData): LanguageCardReading | null {
  const packId = resolveLanguagePackId(card.language);
  const [pack, setPack] = useState<LanguagePack | undefined>(() => packId === 'en' ? undefined : getCachedLanguagePack(packId));
  const ready = pack?.id === packId;
  useEffect(() => {
    if (packId !== 'en') void loadScriptFont(packId === 'zh' ? 'zh-Hans' : packId).catch(() => undefined);
  }, [packId]);
  useEffect(() => {
    if (packId === 'en' || ready) return undefined;
    let cancelled = false;
    loadLanguagePack(packId).then(loaded => {
      if (!cancelled) setPack(loaded);
    }).catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [packId, ready]);
  const { word, phonetic, japanesePitchAccent, partOfSpeech } = card;
  return useMemo(() => {
    if (!pack || pack.id !== packId) return null;
    return buildLanguageCardReading({ word, partOfSpeech }, pack.rendering.buildReadingPlan({ word, phonetic, japanesePitchAccent }));
  }, [pack, packId, word, phonetic, japanesePitchAccent, partOfSpeech]);
}

/** Pitch contour of each tone on the Chinese chips; the neutral tone is a dot. */
const TONE_PATH: Readonly<Record<number, string>> = {
  1: 'M3 3H21',
  2: 'M3 13L21 3',
  3: 'M3 6L10 13L21 3',
  4: 'M3 3L21 13',
  5: 'M12 8h.01',
};

const circledNumber = (value: number) => value === 0 ? '⓪' : value <= 20 ? String.fromCodePoint(0x245f + value) : String(value);

const pitchTypeMessage = msg({ id: 'flashcard.reading.pitch-type', message: '{type, select, heiban {Heiban} atamadaka {Atamadaka} nakadaka {Nakadaka} other {Odaka}}' });
const pitchAccentLabelMessage = msg({ id: 'flashcard.reading.pitch-accent-label', message: 'Pitch accent: {name}' });

function usePitchName() {
  const { _ } = useLingui();
  return (type: JapanesePitchType) => _({ ...pitchTypeMessage, values: { type } });
}

interface LanguageCardHeadwordProps {
  card: CardData;
  reading: LanguageCardReading | null;
  showReading: boolean;
  isBlindMode: boolean;
  onPlayAudio: (event: MouseEvent | PointerEvent) => void;
  isPlayingAudio: boolean;
}

/** Headword with its reading above, then the listen control and the script's reading aids. */
export function LanguageCardHeadword({ card, reading, showReading, isBlindMode, onPlayAudio, isPlayingAudio }: LanguageCardHeadwordProps) {
  const { _ } = useLingui();
  const pitchName = usePitchName();
  const lang = cardTextLang(card);
  const segments: readonly HeadwordSegment[] = reading?.headword ?? [{ text: card.word.trim() }];
  const hideRuby = reading?.pack === 'zh' && !showReading;
  const pitch = reading?.pack === 'ja' ? reading.pitch : null;
  const pitchLabel = pitch ? _({ ...pitchAccentLabelMessage, values: { name: pitchName(pitch.type) } }) : undefined;
  return (
    <div data-card-headword className="flashcard-headword flashcard-lang-headword" data-card-pack={reading?.pack}>
      <h2 lang={lang} className="flashcard-lang-word break-words [overflow-wrap:anywhere]" style={{ '--headword-chars': Math.max(Array.from(card.word.trim()).length, 1) } as CSSProperties}>
        {segments.map((segment, index) => segment.ruby
          ? (
            <ruby key={index} data-tone={segment.tone}>
              {segment.text}
              <rt data-reading-aid aria-hidden={isBlindMode || hideRuby || undefined} className="flashcard-lang-rt">{hideRuby ? ' ' : segment.ruby}</rt>
            </ruby>
          )
          : <span key={index} data-headword-accent={segment.accent ? 'true' : undefined} className={segment.accent ? 'flashcard-lang-accent' : undefined}>{segment.text}</span>)}
      </h2>
      <div data-card-pronunciation className="flashcard-lang-reading flex flex-wrap items-center">
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
            ? <span data-audio-waves="active" className="flex h-3.5 items-center gap-0.5" aria-hidden="true"><span className="wave-bar-1 h-full w-0.5 rounded-full bg-current" /><span className="wave-bar-2 h-full w-0.5 rounded-full bg-current" /><span className="wave-bar-3 h-full w-0.5 rounded-full bg-current" /><span className="wave-bar-4 h-full w-0.5 rounded-full bg-current" /></span>
            : <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13l11-6.5z" /></svg>}
        </button>
        {reading?.pack === 'ko' && reading.blocks.length > 0 && (
          <div data-reading-aid aria-hidden={isBlindMode || undefined} className="flashcard-lang-blocks flex flex-wrap">
            {reading.blocks.map((block, index) => (
              <span key={index} className="flashcard-lang-block">
                <span lang="ko" className="flashcard-lang-block-text">{block.text}</span>
                {showReading
                  ? <span lang="ko-Latn" data-reading-romanization className="flashcard-lang-block-roman">{block.romanization}</span>
                  : <span className="flashcard-lang-block-roman" aria-hidden="true">{' '}</span>}
              </span>
            ))}
          </div>
        )}
        {reading?.pack === 'ja' && reading.morae.length > 0 && (
          <div data-reading-aid aria-hidden={isBlindMode || undefined} className="flashcard-lang-kana flex flex-col">
            <span className="flashcard-lang-morae flex" role={pitch ? 'img' : undefined} aria-label={pitchLabel} data-pitch={pitch?.type}>
              {reading.morae.map((mora, index) => (
                <span key={index} lang="ja" className="flashcard-lang-mora" data-high={mora.high === undefined ? undefined : String(mora.high)} data-step={mora.step ? 'true' : undefined}>{mora.text}</span>
              ))}
            </span>
            {((showReading && reading.romaji) || pitch) && (
              <span className="flashcard-lang-kana-line">
                {showReading && reading.romaji && <span lang="ja-Latn" data-reading-romaji className="flashcard-lang-romaji">{reading.romaji}</span>}
                {showReading && reading.romaji && pitch && <span aria-hidden="true">{' · '}</span>}
                {pitch && <span>{`${pitchName(pitch.type)} ${circledNumber(pitch.downstep)}`}</span>}
              </span>
            )}
          </div>
        )}
        {reading?.pack === 'zh' && reading.syllables.length > 0 && (
          <div data-reading-aid aria-hidden={isBlindMode || undefined} className="flashcard-lang-tones flex flex-wrap">
            {reading.syllables.map((syllable, index) => (
              <span key={index} className="flashcard-lang-tone" data-tone={syllable.tone}>
                <svg width="24" height="16" viewBox="0 0 24 16" aria-hidden="true"><path d={TONE_PATH[syllable.tone]} fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" /></svg>
                <span>
                  {showReading && <><span lang="zh-Latn" data-reading-pinyin>{syllable.text}</span><span aria-hidden="true">{' · '}</span></>}
                  {syllable.tone}
                </span>
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** The card's example on the front, its word marked; the block is left out when the card has no example. */
export function LanguageCardExample({ card, reading }: { card: CardData; reading: LanguageCardReading | null }) {
  const sentence = card.exampleSentence?.trim();
  const pack = resolveLanguagePackId(card.language);
  if (!sentence || pack === 'en') return null;
  const segments = buildExampleSegments(sentence, card, pack as CardPack, reading);
  return (
    <figure data-card-section="example" className="flashcard-lang-example">
      <figcaption className="flashcard-lang-label"><Trans {...msg({ context: 'flashcard.language-card.example', message: 'Example' })} /></figcaption>
      <p lang={cardTextLang(card)} className="flashcard-lang-example-text">
        {segments.map((segment, index) => !segment.highlight
          ? <span key={index}>{segment.text}</span>
          : segment.ruby
            ? <ruby key={index} data-example-word className="flashcard-lang-example-word">{segment.text}<rt data-reading-aid className="flashcard-lang-example-rt">{segment.ruby}</rt></ruby>
            : <span key={index} data-example-word className="flashcard-lang-example-word">{segment.text}</span>)}
      </p>
    </figure>
  );
}

/** The card's collocations as phrase chips; left out when the card has none. */
export function LanguageCardPhrases({ card }: { card: CardData }) {
  const phrases = (card.collocations ?? []).map(phrase => phrase.trim()).filter(Boolean);
  if (phrases.length === 0) return null;
  const labelId = `flashcard-phrases-${card.id}`;
  return (
    <div data-card-section="phrases" className="flashcard-lang-phrases">
      <p id={labelId} className="flashcard-lang-label"><Trans {...msg({ context: 'flashcard.language-card.phrases', message: 'Common phrases' })} /></p>
      <ul aria-labelledby={labelId} className="flashcard-lang-phrase-list flex flex-wrap">
        {phrases.map((phrase, index) => <li key={`${phrase}-${index}`} lang={cardTextLang(card)} className="flashcard-lang-phrase"><span>{phrase}</span></li>)}
      </ul>
    </div>
  );
}

/** Switch for the Latin reading aids: romanization under Hangul, romaji under kana, pinyin over Han. */
export function LanguageReadingSwitch({ card, showReading, onToggle }: { card: CardData; showReading: boolean; onToggle: () => void }) {
  const { _, i18n } = useLingui();
  const pack = resolveLanguagePackId(card.language);
  if (pack === 'en') return null;
  const label = pack === 'ko'
    ? _(msg({ id: 'flashcard.reading.toggle-romanization', message: 'Romanization' }))
    : pack === 'ja'
      ? _(msg({ id: 'flashcard.reading.toggle-romaji', message: 'Romaji' }))
      : _(msg({ id: 'flashcard.reading.toggle-pinyin', message: 'Pinyin' }));
  return (
    <button
      type="button"
      data-reading-toggle
      data-card-control
      aria-pressed={showReading}
      aria-label={i18n._(msg({ id: 'flashcard.reading.toggle-aria', message: 'Toggle {label} for {word}' }).id, { label, word: card.word })}
      onPointerDown={event => event.stopPropagation()}
      onClick={event => {
        event.stopPropagation();
        onToggle();
      }}
      className="flashcard-action flashcard-lang-switch touch-manipulation ml-auto flex min-h-11 shrink-0 items-center"
    >
      <span className="flashcard-lang-switch-track" aria-hidden="true"><span className="flashcard-lang-switch-knob" /></span>
      <span>{label}</span>
    </button>
  );
}
