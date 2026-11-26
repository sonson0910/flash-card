import { romanizeHangul } from '../../features/languagePacks/hangulRomanization';
import type { HeadwordReadingPlan, PinyinTone } from '../../features/languagePacks/types';
import { parseSyllables } from '../../lib/syllableParser';
import type { CardData } from '../../types/card';
import { cardTargetLanguageKey } from './cardLanguage';
import { romanizeKana, splitKanaMorae, toHiragana } from './kanaRomaji';

/** A run of the headword, with the reading drawn above it when the card's reading data places one. */
export interface HeadwordSegment {
  readonly text: string;
  readonly ruby?: string;
  readonly tone?: PinyinTone;
  /** The part of the word the card accents (the stem before 하다/다 on a Korean verb). */
  readonly accent?: boolean;
}

export interface HangulBlock {
  readonly text: string;
  readonly romanization: string;
}

export interface KanaMora {
  readonly text: string;
  /** Pitch height, present only when the card carries a verified pitch accent. */
  readonly high?: boolean;
  /** True where the pitch changes from the mora before. */
  readonly step?: boolean;
}

export type JapanesePitchType = 'heiban' | 'atamadaka' | 'nakadaka' | 'odaka';

export interface ToneSyllable {
  readonly text: string;
  readonly tone: PinyinTone;
}

export type LanguageCardReading =
  | { readonly pack: 'ko'; readonly headword: readonly HeadwordSegment[]; readonly blocks: readonly HangulBlock[]; readonly backReading: string | null }
  | { readonly pack: 'ja'; readonly headword: readonly HeadwordSegment[]; readonly kana: string | null; readonly morae: readonly KanaMora[]; readonly romaji: string | null; readonly pitch: { readonly type: JapanesePitchType; readonly downstep: number } | null; readonly backReading: string | null }
  | { readonly pack: 'zh'; readonly headword: readonly HeadwordSegment[]; readonly syllables: readonly ToneSyllable[]; readonly backReading: string | null };

const HANGUL_SYLLABLE = /^[가-힣]$/u;
const HAN = /\p{Script=Han}/u;
const HIRAGANA = /^\p{Script=Hiragana}$/u;
const ALL_HAN = /^\p{Script=Han}+$/u;
const KANA = /^[\p{Script=Hiragana}\p{Script=Katakana}ー]$/u;

/** A part of speech naming a verb or an adjective, in the languages card data is written in. */
const PREDICATE = /verb|adjective|động từ|tính từ|동사|형용사/iu;

/** Whether a Korean word is a predicate whose stem conjugates: a 하다 word, or a 다 word the card calls a verb or adjective. */
function koreanEnding(word: string, partOfSpeech: string | null | undefined): '하다' | '다' | '' {
  const length = Array.from(word).length;
  if (word.endsWith('하다') && length > 2) return '하다';
  if (word.endsWith('다') && length > 1 && PREDICATE.test(partOfSpeech ?? '')) return '다';
  return '';
}

/** Korean predicates accent the stem before 하다 or 다, as the language-card boards draw. */
function koreanHeadword(word: string, partOfSpeech: string | null | undefined): HeadwordSegment[] {
  const ending = koreanEnding(word, partOfSpeech);
  if (!ending) return [{ text: word }];
  return [{ text: word.slice(0, -ending.length), accent: true }, { text: ending }];
}

/** Puts the kana reading over the kanji core of the word, leaving shared kana (okurigana) outside the ruby. */
function japaneseHeadword(word: string, kana: string | null): HeadwordSegment[] {
  if (!kana || !HAN.test(word)) return [{ text: word }];
  const wordCharacters = Array.from(word);
  const readingCharacters = Array.from(kana);
  let prefix = 0;
  while (prefix < wordCharacters.length - 1 && prefix < readingCharacters.length - 1
    && KANA.test(wordCharacters[prefix]) && toHiragana(wordCharacters[prefix]) === toHiragana(readingCharacters[prefix])) prefix += 1;
  let suffix = 0;
  while (suffix < wordCharacters.length - prefix - 1 && suffix < readingCharacters.length - prefix - 1
    && KANA.test(wordCharacters[wordCharacters.length - 1 - suffix])
    && toHiragana(wordCharacters[wordCharacters.length - 1 - suffix]) === toHiragana(readingCharacters[readingCharacters.length - 1 - suffix])) suffix += 1;
  const core = wordCharacters.slice(prefix, wordCharacters.length - suffix).join('');
  const ruby = readingCharacters.slice(prefix, readingCharacters.length - suffix).join('');
  return [
    ...(prefix ? [{ text: wordCharacters.slice(0, prefix).join('') }] : []),
    { text: core, ruby },
    ...(suffix ? [{ text: wordCharacters.slice(wordCharacters.length - suffix).join('') }] : []),
  ];
}

/** One pinyin syllable over each Han character when the counts agree; otherwise the whole reading over the word. */
function chineseHeadword(word: string, syllables: readonly ToneSyllable[], reading: string | null): HeadwordSegment[] {
  const characters = Array.from(word);
  if (syllables.length > 0 && characters.length === syllables.length && characters.every(character => HAN.test(character))) {
    return characters.map((text, index) => ({ text, ruby: syllables[index].text, tone: syllables[index].tone }));
  }
  return reading ? [{ text: word, ruby: reading }] : [{ text: word }];
}

function pitchType(downstep: number, moraCount: number): JapanesePitchType {
  if (downstep === 0) return 'heiban';
  if (downstep === 1) return 'atamadaka';
  return downstep < moraCount ? 'nakadaka' : 'odaka';
}

/**
 * The reading aids of a language-pack card, built from the pack's reading plan for the card's own
 * stored fields: Hangul blocks with romanization, kana morae with a verified pitch accent, or pinyin
 * syllables with tones. Nothing here is guessed: a missing or unverified field leaves its aid out.
 */
export function buildLanguageCardReading(card: Pick<CardData, 'word' | 'partOfSpeech'>, plan: HeadwordReadingPlan): LanguageCardReading | null {
  const word = card.word.trim();
  if (!word) return null;
  if (plan.kind === 'romanization') {
    const blocks = Array.from(word)
      .filter(character => HANGUL_SYLLABLE.test(character))
      .map(text => ({ text, romanization: romanizeHangul(text) ?? '' }));
    return { pack: 'ko', headword: koreanHeadword(word, card.partOfSpeech), blocks, backReading: plan.readingText };
  }
  if (plan.kind === 'furigana') {
    // A word written wholly in kana is its own reading.
    const kana = plan.readingText ?? (Array.from(word).every(character => KANA.test(character)) ? word : null);
    const moraTexts = kana ? splitKanaMorae(kana) : [];
    const accent = plan.japanesePitchAccent;
    const verified = accent && accent.moraCount === moraTexts.length ? accent : undefined;
    const highAt = (index: number) => !verified ? undefined
      : verified.downstep === 0 ? index > 0
        : verified.downstep === 1 ? index === 0
          : index > 0 && index < verified.downstep;
    const morae = moraTexts.map((text, index) => ({
      text,
      high: highAt(index),
      step: verified !== undefined && index > 0 && highAt(index) !== highAt(index - 1),
    }));
    const romaji = kana ? romanizeKana(kana) : null;
    return {
      pack: 'ja',
      headword: japaneseHeadword(word, kana),
      kana,
      morae,
      romaji,
      pitch: verified ? { type: pitchType(verified.downstep, verified.moraCount), downstep: verified.downstep } : null,
      backReading: kana ? `${kana} · ${romaji}` : null,
    };
  }
  const syllables = plan.toneSyllables ?? [];
  return { pack: 'zh', headword: chineseHeadword(word, syllables, plan.readingText), syllables, backReading: plan.readingText };
}

export interface ExampleSegment {
  readonly text: string;
  readonly highlight?: boolean;
  readonly ruby?: string;
}

export interface LatinHeadwordParts {
  readonly article: string;
  readonly bareWord: string;
  readonly wPre: string;
  readonly wStress: string;
  readonly wRest: string;
  readonly syllables: readonly string[];
  readonly stressIndex: number | null;
}

const escapePattern = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');

/** Removes a matching leading article from the headword so display and example matching avoid duplication. */
export function stripLeadingArticle(word: string, article?: string): string {
  const trimmedWord = word.trim();
  const trimmedArticle = article?.trim();
  if (!trimmedWord || !trimmedArticle) return trimmedWord;
  const spaced = new RegExp(`^${escapePattern(trimmedArticle)}\\s+(.+)$`, 'iu').exec(trimmedWord);
  if (spaced) return spaced[1].trim();
  if (trimmedArticle.endsWith('\'') || trimmedArticle.endsWith('’')) {
    const elided = new RegExp(`^${escapePattern(trimmedArticle)}(.+)$`, 'iu').exec(trimmedWord);
    if (elided) return elided[1].trim();
  }
  return trimmedWord;
}

/**
 * Splits a Latin-script headword into optional article plus pre-stress, stressed, and trailing
 * spans, reading `languageDetails.syllables` + `stressIndex` first and falling back to English
 * opening stress / syllable analysis only when the target language is English.
 */
export function splitLatinHeadword(
  card: Pick<CardData, 'word' | 'phonetic' | 'language' | 'languageDetails'>,
): LatinHeadwordParts {
  const article = card.languageDetails?.article?.trim() ?? '';
  const bareWord = stripLeadingArticle(card.word, article);
  const explicitSyllables = card.languageDetails?.syllables?.map(part => part.trim()).filter(Boolean) ?? [];
  const explicitStress = card.languageDetails?.stressIndex;

  if (explicitSyllables.length > 0) {
    const validStress = typeof explicitStress === 'number'
      && Number.isInteger(explicitStress)
      && explicitStress >= 0
      && explicitStress < explicitSyllables.length
      ? explicitStress
      : null;

    if (validStress !== null) {
      const joined = explicitSyllables.join('');
      const preLen = explicitSyllables.slice(0, validStress).join('').length;
      const stressLen = explicitSyllables[validStress].length;
      if (joined.toLocaleLowerCase('en-US') === bareWord.toLocaleLowerCase('en-US') && bareWord.length >= preLen + stressLen) {
        return {
          article,
          bareWord,
          wPre: bareWord.slice(0, preLen),
          wStress: bareWord.slice(preLen, preLen + stressLen),
          wRest: bareWord.slice(preLen + stressLen),
          syllables: explicitSyllables,
          stressIndex: validStress,
        };
      }
      return {
        article,
        bareWord,
        wPre: explicitSyllables.slice(0, validStress).join(''),
        wStress: explicitSyllables[validStress],
        wRest: explicitSyllables.slice(validStress + 1).join(''),
        syllables: explicitSyllables,
        stressIndex: validStress,
      };
    }

    return {
      article,
      bareWord,
      wPre: bareWord,
      wStress: '',
      wRest: '',
      syllables: explicitSyllables,
      stressIndex: null,
    };
  }

  if (cardTargetLanguageKey(card) === 'en') {
    const analysis = parseSyllables(bareWord, card.phonetic);
    const syllables = analysis.hasMultipleSyllables && analysis.syllables.length > 1
      ? analysis.syllables.map(part => part.text)
      : [];
    const ipa = (card.phonetic || '').trim().replace(/^[/[]\s*/, '');
    if (ipa.startsWith('ˈ') && bareWord && !/\s/.test(bareWord)) {
      const orthographic = parseSyllables(bareWord);
      const opening = orthographic.syllables[0]?.text ?? '';
      if (orthographic.hasMultipleSyllables && opening && bareWord.startsWith(opening) && opening.length < bareWord.length) {
        return {
          article,
          bareWord,
          wPre: '',
          wStress: opening,
          wRest: bareWord.slice(opening.length),
          syllables,
          stressIndex: null,
        };
      }
    }
    return {
      article,
      bareWord,
      wPre: bareWord,
      wStress: '',
      wRest: '',
      syllables,
      stressIndex: null,
    };
  }

  return {
    article,
    bareWord,
    wPre: bareWord,
    wStress: '',
    wRest: '',
    syllables: [],
    stressIndex: null,
  };
}

/**
 * Finds the card's word in its example sentence. Korean and Japanese conjugate, so after the exact
 * word the stem is tried: a Korean stem takes the rest of its spaced word (결심했어요), a Japanese stem
 * stands alone (食べ in 食べました, 勉強 in 勉強します). Latin-script words match the bare headword
 * (after stripping any leading article) case-insensitively. Without a match the sentence stays unmarked.
 */
export function findExampleWord(
  sentence: string,
  card: Pick<CardData, 'word' | 'partOfSpeech' | 'languageDetails'>,
  pack: 'ko' | 'ja' | 'zh' | 'latin',
): { start: number; end: number } | null {
  const target = card.word.trim();
  if (!target || !sentence) return null;
  if (pack === 'latin') {
    const bare = stripLeadingArticle(target, card.languageDetails?.article);
    if (!bare) return null;
    const escaped = escapePattern(bare);
    const boundary = new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'iu').exec(sentence);
    if (boundary) return { start: boundary.index, end: boundary.index + boundary[0].length };
    const anywhere = new RegExp(escaped, 'iu').exec(sentence);
    return anywhere ? { start: anywhere.index, end: anywhere.index + anywhere[0].length } : null;
  }
  const exact = sentence.indexOf(target);
  if (exact >= 0) return { start: exact, end: exact + target.length };
  const characters = Array.from(target);
  const stems: RegExp[] = [];
  const ending = pack === 'ko' ? koreanEnding(target, card.partOfSpeech) : '';
  if (ending) {
    stems.push(new RegExp(`${escapePattern(target.slice(0, -1))}[\\uac00-\\ud7a3]*`, 'u'));
    if (ending === '하다') stems.push(new RegExp(`${escapePattern(target.slice(0, -2))}[\\uac00-\\ud7a3]*`, 'u'));
  }
  if (pack === 'ja' && characters.length > 1 && HIRAGANA.test(characters.at(-1)!)) {
    // 食べる → 食べ (食べました); 勉強する → 勉強 (勉強します).
    const shortStem = characters.slice(0, -1).join('');
    const hanStem = target.replace(/\p{Script=Hiragana}+$/u, '');
    for (const stem of new Set([shortStem, hanStem])) if (HAN.test(stem)) stems.push(new RegExp(escapePattern(stem), 'u'));
  }
  for (const stem of stems) {
    const match = stem.exec(sentence);
    if (match) return { start: match.index, end: match.index + match[0].length };
  }
  return null;
}

/** The example split around the card's word; the exact Japanese word carries its known reading. */
export function buildExampleSegments(
  sentence: string,
  card: Pick<CardData, 'word' | 'partOfSpeech' | 'languageDetails'>,
  pack: 'ko' | 'ja' | 'zh' | 'latin',
  reading: LanguageCardReading | null,
): ExampleSegment[] {
  const found = findExampleWord(sentence, card, pack);
  if (!found) return [{ text: sentence }];
  const text = sentence.slice(found.start, found.end);
  const ruby = reading?.pack === 'ja' && reading.kana && text === card.word.trim() && ALL_HAN.test(text) ? reading.kana : undefined;
  return [
    ...(found.start > 0 ? [{ text: sentence.slice(0, found.start) }] : []),
    { text, highlight: true, ruby },
    ...(found.end < sentence.length ? [{ text: sentence.slice(found.end) }] : []),
  ];
}
