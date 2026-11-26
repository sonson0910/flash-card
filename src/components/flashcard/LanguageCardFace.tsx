import { msg } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react';
import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties, MouseEvent, PointerEvent, ReactNode } from 'react';
import { getCachedLanguagePack, loadLanguagePack, resolveLanguagePackId } from '../../features/languagePacks/registry';
import { loadScriptFont } from '../../features/theme/loadThemeAssets';
import type { LanguagePack } from '../../features/languagePacks/types';
import type { CardData } from '../../types/card';
import { cardTargetLanguageKey, isLanguagePackCard } from './cardLanguage';
import { buildExampleSegments, buildLanguageCardReading, splitLatinHeadword, type HeadwordSegment, type JapanesePitchType, type LanguageCardReading } from './languageCardReading';

type CardPack = 'ko' | 'ja' | 'zh' | 'latin';

/** BCP-47 tag for text in the card's target language, so the browser picks the right CJK glyphs. */
export function cardTextLang(card: Pick<CardData, 'language'>): string {
  return card.language?.trim() || 'en';
}

function primaryLanguageCode(card: Pick<CardData, 'language'>): string {
  const pack = resolveLanguagePackId(card.language);
  if (pack !== 'en') return pack;
  return (card.language ?? '').trim().toLowerCase().split(/[-_]/)[0] || 'en';
}

/** The target language's own name ("English", "Français", "Deutsch", "한국어", "日本語", "中文"), as Crystal renders it. */
export function cardEndonym(card: Pick<CardData, 'language'>): string | null {
  const code = primaryLanguageCode(card);
  try {
    const raw = new Intl.DisplayNames([code], { type: 'language' }).of(code);
    if (!raw) return null;
    const chars = Array.from(raw);
    return chars.length > 0 ? `${chars[0].toLocaleUpperCase(code)}${chars.slice(1).join('')}` : raw;
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
  const isPackCard = isLanguagePackCard(card);
  const pronunciations = card.languageDetails?.pronunciations ?? [];
  const [variant, setVariant] = useState(0);
  useEffect(() => {
    setVariant(0);
  }, [card.id]);
  const activeVariant = pronunciations.length > 0 ? Math.min(variant, pronunciations.length - 1) : 0;
  const activeIpa = pronunciations.length > 0 ? pronunciations[activeVariant].ipa : (card.phonetic?.trim() ?? '');
  const latin = useMemo(() => (isPackCard ? null : splitLatinHeadword(card)), [card, isPackCard]);
  const latinCharLength = latin ? Array.from(latin.article + latin.bareWord).length : 0;
  const latinSizeTier = latinCharLength > 13 ? 'long' : latin?.article ? 'article' : 'short';
  const segments: readonly HeadwordSegment[] = reading?.headword ?? [{ text: card.word.trim() }];
  const hideRuby = reading?.pack === 'zh' && !showReading;
  const pitch = reading?.pack === 'ja' ? reading.pitch : null;
  const pitchLabel = pitch ? _({ ...pitchAccentLabelMessage, values: { name: pitchName(pitch.type) } }) : undefined;
  return (
    <div data-card-headword className="flashcard-headword flashcard-lang-headword" data-card-pack={reading?.pack ?? (!isPackCard ? 'latin' : undefined)}>
      {latin ? (
        <h2
          lang={lang}
          data-latin-headword="true"
          data-latin-size={latinSizeTier}
          className="flashcard-lang-word break-words [overflow-wrap:anywhere]"
          style={{ '--headword-chars': Math.max(latinCharLength, 1) } as CSSProperties}
        >
          {latin.article && (
            <span data-headword-article data-gender={card.languageDetails?.gender} className="flashcard-lang-article">
              {latin.article}
              {latin.article.endsWith('\'') || latin.article.endsWith('’') ? '' : ' '}
            </span>
          )}
          {latin.wPre}
          {latin.wStress && <span data-headword-accent="true" className="flashcard-lang-accent">{latin.wStress}</span>}
          {latin.wRest}
        </h2>
      ) : (
        <h2 lang={lang} className="flashcard-lang-word break-words [overflow-wrap:anywhere]" style={{ '--headword-chars': Math.max(Array.from(card.word.trim()).length, 1) } as CSSProperties}>
          {segments.map((segment, index) => segment.ruby
            ? (
              <ruby key={index} data-tone={segment.tone}>
                {segment.text}
                <rt data-reading-aid aria-hidden={isBlindMode || hideRuby || undefined} className="flashcard-lang-rt sf-ease-filter">{hideRuby ? ' ' : segment.ruby}</rt>
              </ruby>
            )
            : <span key={index} data-headword-accent={segment.accent ? 'true' : undefined} className={segment.accent ? 'flashcard-lang-accent' : undefined}>{segment.text}</span>)}
        </h2>
      )}
      <div data-card-pronunciation className="flashcard-lang-reading flex flex-wrap items-center">
        <button
          type="button"
          data-card-control
          data-card-effect="audio"
          data-playing={isPlayingAudio ? 'true' : 'false'}
          onPointerDown={event => event.stopPropagation()}
          onClick={onPlayAudio}
          className="flashcard-play-button fx-press touch-manipulation flex size-11 shrink-0 items-center justify-center focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sf-brand)]"
          aria-label={_(msg({ id: 'flashcard.audio.play-pronunciation', message: 'Play pronunciation' }))}
          title={_(msg({ id: 'flashcard.audio.play-pronunciation', message: 'Play pronunciation' }))}
        >
          {isPlayingAudio
            ? <span data-audio-waves="active" className="flex h-3.5 items-center gap-0.5" aria-hidden="true"><span className="wave-bar-1 h-full w-0.5 rounded-full bg-current" /><span className="wave-bar-2 h-full w-0.5 rounded-full bg-current" /><span className="wave-bar-3 h-full w-0.5 rounded-full bg-current" /><span className="wave-bar-4 h-full w-0.5 rounded-full bg-current" /></span>
            : <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13l11-6.5z" /></svg>}
        </button>
        {latin && (pronunciations.length > 0 || activeIpa || latin.syllables.length > 0) && (
          <div data-reading-aid aria-hidden={isBlindMode || undefined} className="flashcard-lang-latin-reading sf-ease-filter flex min-w-0 flex-1 flex-col">
            {(pronunciations.length > 0 || activeIpa) && (
              <div className="flashcard-lang-ipa-row flex flex-wrap items-center">
                {pronunciations.map((entry, index) => (
                  <button
                    key={`${entry.tag}-${index}`}
                    type="button"
                    data-card-control
                    aria-pressed={index === activeVariant}
                    onPointerDown={event => event.stopPropagation()}
                    onClick={event => {
                      event.stopPropagation();
                      setVariant(index);
                    }}
                    className="flashcard-lang-ipa-pill sf-ease cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sf-brand)]"
                  >
                    <span className="flashcard-lang-ipa-pill-face">{entry.tag}</span>
                  </button>
                ))}
                {activeIpa && <span lang={lang} className="flashcard-lang-ipa font-mono">{activeIpa}</span>}
              </div>
            )}
            {latin.syllables.length > 0 && (
              <span lang={lang} className="flashcard-lang-syllables">{latin.syllables.join('·')}</span>
            )}
          </div>
        )}
        {reading?.pack === 'ko' && reading.blocks.length > 0 && (
          <div data-reading-aid aria-hidden={isBlindMode || undefined} className="flashcard-lang-blocks sf-ease-filter flex flex-wrap">
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
          <div data-reading-aid aria-hidden={isBlindMode || undefined} className="flashcard-lang-kana sf-ease-filter flex flex-col">
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
          <div data-reading-aid aria-hidden={isBlindMode || undefined} className="flashcard-lang-tones sf-ease-filter flex flex-wrap">
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

const GENDER_PRESETS: Readonly<Record<string, readonly { art: string; g: 'm' | 'f' | 'n' }[]>> = {
  fr: [{ art: 'le', g: 'm' }, { art: 'la', g: 'f' }],
  de: [{ art: 'der', g: 'm' }, { art: 'die', g: 'f' }, { art: 'das', g: 'n' }],
  es: [{ art: 'el', g: 'm' }, { art: 'la', g: 'f' }],
};

/** Compact linguistic cue chips in board order; omitted completely when a card carries none. */
export function LanguageCardChips({ card }: { card: CardData }) {
  const lang = cardTextLang(card);
  const pack = resolveLanguagePackId(card.language);
  const targetLang = cardTargetLanguageKey(card);
  const details = card.languageDetails;
  if (!details) return null;

  const stress = targetLang === 'en' && details.stressIndex !== undefined
    ? (
      <span key="stress" className="flashcard-lang-chip">
        <Trans {...msg({ context: 'flashcard.language.stress-syllable', message: 'Stress syllable {n}' })} values={{ n: details.stressIndex + 1 }} />
      </span>
    )
    : null;

  // The Han characters behind the word: the traditional form for Chinese, hanja for Korean, kanji for Japanese.
  const sinoSource = details.sinoForm?.source ? { source: details.sinoForm.source } : null;
  const glyphs = { 0: <span lang={pack === 'zh' ? 'zh-Hant' : lang} /> };
  const sino = sinoSource
    ? (
      <span key="sino" className="flashcard-lang-chip">
        {pack === 'zh'
          ? <Trans {...msg({ context: 'flashcard.language.sino-traditional', message: 'Traditional <0>{source}</0>' })} values={sinoSource} components={glyphs} />
          : pack === 'ko'
            ? <Trans {...msg({ context: 'flashcard.language.sino-hanja', message: 'Hanja <0>{source}</0>' })} values={sinoSource} components={glyphs} />
            : <Trans {...msg({ context: 'flashcard.language.sino-kanji', message: 'Kanji <0>{source}</0>' })} values={sinoSource} components={glyphs} />}
      </span>
    )
    : null;

  const measureWord = pack === 'zh' ? details.measureWord : undefined;
  const measure = measureWord?.word
    ? (
      <span key="measure" lang={lang} className="flashcard-lang-chip">
        <Trans
          {...msg({ context: 'flashcard.language.measure-word', message: 'Measure word {word}' })}
          values={{ word: measureWord.reading ? `${measureWord.word} ${measureWord.reading}` : measureWord.word }}
        />
      </span>
    )
    : null;

  const spoken = pack === 'ko' && details.spokenForm
    ? (
      <span key="spoken" lang={lang} className="flashcard-lang-chip">
        <Trans {...msg({ context: 'flashcard.language.spoken-form', message: 'Spoken {form}' })} values={{ form: details.spokenForm }} />
      </span>
    )
    : null;

  const hints = (details.hints ?? []).map((hint, index) => {
    const trimmed = hint.trim();
    return trimmed
      ? <span key={`hint-${index}`} lang={lang} className="flashcard-lang-chip">{trimmed}</span>
      : null;
  });

  const pluralText = details.plural?.trim();
  const plural = pluralText
    ? (
      <span key="plural" lang={lang} className="flashcard-lang-chip">
        {/^pl\.\s+/i.test(pluralText)
          ? pluralText
          : <Trans {...msg({ context: 'flashcard.language.plural-prefix', message: 'pl. {plural}' })} values={{ plural: pluralText }} />}
      </span>
    )
    : null;

  // Each language leads with the fact its learners reach for first: the verb class for Korean, the measure word for
  // Chinese, the characters for Japanese, the stress for English.
  const ordered: ReactNode[] = pack === 'ko'
    ? [...hints, sino, spoken, plural]
    : pack === 'zh'
      ? [measure, sino, ...hints, plural]
      : [stress, sino, ...hints, plural];
  const chips = ordered.filter(Boolean);

  if (chips.length === 0) return null;
  return (
    <div data-card-section="chips" className="flashcard-lang-chips flex flex-wrap">
      {chips}
    </div>
  );
}

/** Grammatical gender selector row for French, German, and Spanish nouns when gender metadata exists. */
export function LanguageCardGender({ card }: { card: CardData }) {
  const { _ } = useLingui();
  const gender = card.languageDetails?.gender;
  if (!gender) return null;
  const code = primaryLanguageCode(card);
  const options = GENDER_PRESETS[code];
  if (!options) return null;

  return (
    <div
      role="group"
      data-card-section="genders"
      aria-label={_(msg({ context: 'flashcard.language.gender-aria', message: 'Grammatical gender' }))}
      className="flashcard-lang-genders flex flex-wrap"
    >
      {options.map((option) => (
        <span
          key={option.art}
          data-gender={option.g}
          data-active={option.g === gender ? 'true' : 'false'}
          className="flashcard-lang-gender"
        >
          <span className="flashcard-lang-gender-inner">
            <span className="flashcard-lang-gender-art">{option.art}</span>
            <span>
              {option.g === 'm'
                ? <Trans {...msg({ context: 'flashcard.language.gender-m', message: 'masc.' })} />
                : option.g === 'f'
                  ? <Trans {...msg({ context: 'flashcard.language.gender-f', message: 'fem.' })} />
                  : <Trans {...msg({ context: 'flashcard.language.gender-n', message: 'neut.' })} />}
            </span>
          </span>
        </span>
      ))}
    </div>
  );
}

/** The card's example on the front, its word marked; the block is left out when the card has no example. */
export function LanguageCardExample({
  card,
  reading,
  showReading = true,
  isBlindMode = false,
}: {
  card: CardData;
  reading: LanguageCardReading | null;
  showReading?: boolean;
  isBlindMode?: boolean;
}) {
  const sentence = card.exampleSentence?.trim();
  if (!sentence) return null;
  const pack = resolveLanguagePackId(card.language);
  const segmentPack: CardPack = pack === 'en' ? 'latin' : pack;
  const segments = buildExampleSegments(sentence, card, segmentPack, reading);
  const exampleReading = showReading ? card.languageDetails?.exampleReading?.trim() : '';
  return (
    <figure data-card-section="example" className="flashcard-lang-example">
      <figcaption className="flashcard-lang-label"><Trans {...msg({ context: 'flashcard.language-card.example', message: 'Example' })} /></figcaption>
      <p
        lang={cardTextLang(card)}
        data-latin-example={segmentPack === 'latin' ? 'true' : undefined}
        className="flashcard-lang-example-text"
      >
        {segments.map((segment, index) => !segment.highlight
          ? <span key={index}>{segment.text}</span>
          : segment.ruby
            ? <ruby key={index} data-example-word className="flashcard-lang-example-word">{segment.text}<rt data-reading-aid aria-hidden={isBlindMode || undefined} className="flashcard-lang-example-rt sf-ease-filter">{segment.ruby}</rt></ruby>
            : <span key={index} data-example-word className="flashcard-lang-example-word">{segment.text}</span>)}
      </p>
      {exampleReading && (
        <p data-reading-aid aria-hidden={isBlindMode || undefined} className="flashcard-lang-example-reading sf-ease-filter">
          {exampleReading}
        </p>
      )}
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
      className="flashcard-action flashcard-lang-switch sf-ease touch-manipulation ml-auto flex min-h-11 shrink-0 items-center"
    >
      <span className="flashcard-lang-switch-track" aria-hidden="true"><span className="flashcard-lang-switch-knob" /></span>
      <span>{label}</span>
    </button>
  );
}
