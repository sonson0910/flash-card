import { buildExercise, evaluateExerciseAnswer } from '../dailyLearning/exerciseEngine';
import { resolveLanguagePackId } from './registry';
import { segmentWords } from './unicodeSegmentation';
import type { CardData } from '../../types/card';
import type { HeadwordReadingPlan, LanguagePackId, PinyinToneSyllable } from './types';

export type LanguagePracticeDrillKind = 'spelling' | 'hangul-blocks' | 'kana-reading' | 'tone-melody';

export interface LanguagePracticeDrillModel {
  readonly card: CardData;
  readonly packId: LanguagePackId;
  readonly kind: LanguagePracticeDrillKind;
  readonly prompt: string;
  readonly sentenceCloze?: JapaneseSentenceCloze;
}

export interface JapaneseSentenceCloze {
  readonly before: string;
  readonly after: string;
  readonly answer: string;
  readonly choices: readonly JapaneseSentenceClozeChoice[];
}

export interface JapaneseSentenceClozeChoice {
  readonly word: string;
  readonly reading?: string;
  readonly meaning?: string;
}

export interface LanguagePracticeDrillResult {
  readonly cardId: string;
  readonly correct: boolean;
  readonly answer: string | readonly number[];
}

export type LanguagePracticeDrillSurfaceState = 'loading' | 'error' | 'missing-tone-data' | 'ready';

/** Reveal a reading only after the learner asks for help or checks an answer. */
/** A pinyin syllable without its tone mark; the diaeresis of ü stays so lü and lu remain distinct. */
export function toneSyllableLabel(text: string): string {
  return text.normalize('NFD').replace(/[\u0300\u0301\u0304\u030c]/gu, '').normalize('NFC');
}

export function shouldRevealLanguagePracticeReading(showHint: boolean, checked: boolean): boolean {
  return showHint || checked;
}

export function languagePracticeDrillSurfaceState(
  kind: LanguagePracticeDrillKind,
  reading: HeadwordReadingPlan | null,
  loaded: boolean,
  loadError: boolean,
): LanguagePracticeDrillSurfaceState {
  if (loadError) return 'error';
  if (!loaded) return 'loading';
  if (kind === 'tone-melody' && !reading?.toneSyllables?.length) return 'missing-tone-data';
  return 'ready';
}

const LEADS = ['ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];
const VOWELS = ['ㅏ', 'ㅐ', 'ㅑ', 'ㅒ', 'ㅓ', 'ㅔ', 'ㅕ', 'ㅖ', 'ㅗ', 'ㅘ', 'ㅙ', 'ㅚ', 'ㅛ', 'ㅜ', 'ㅝ', 'ㅞ', 'ㅟ', 'ㅠ', 'ㅡ', 'ㅢ', 'ㅣ'];
const FINALS = ['', 'ㄱ', 'ㄲ', 'ㄳ', 'ㄴ', 'ㄵ', 'ㄶ', 'ㄷ', 'ㄹ', 'ㄺ', 'ㄻ', 'ㄼ', 'ㄽ', 'ㄾ', 'ㄿ', 'ㅀ', 'ㅁ', 'ㅂ', 'ㅄ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];
// The two-set layout has no key for these: a learner types the pair, and the input method merges it.
const COMPOUND_VOWELS: Readonly<Record<string, string>> = {
  'ㅗㅏ': 'ㅘ', 'ㅗㅐ': 'ㅙ', 'ㅗㅣ': 'ㅚ', 'ㅜㅓ': 'ㅝ', 'ㅜㅔ': 'ㅞ', 'ㅜㅣ': 'ㅟ', 'ㅡㅣ': 'ㅢ',
};
const COMPOUND_FINALS: Readonly<Record<string, string>> = {
  'ㄱㅅ': 'ㄳ', 'ㄴㅈ': 'ㄵ', 'ㄴㅎ': 'ㄶ', 'ㄹㄱ': 'ㄺ', 'ㄹㅁ': 'ㄻ', 'ㄹㅂ': 'ㄼ', 'ㄹㅅ': 'ㄽ', 'ㄹㅌ': 'ㄾ', 'ㄹㅍ': 'ㄿ', 'ㄹㅎ': 'ㅀ', 'ㅂㅅ': 'ㅄ',
};
const COMPOUND_FINAL_KEYS: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(COMPOUND_FINALS).map(([keys, final]) => [final, keys]),
);
const isVowel = (character: string | undefined): boolean => character !== undefined && VOWELS.includes(character);
const stableHash = (value: string): number => {
  let hash = 0;
  for (const character of value) hash = ((hash * 31) + (character.codePointAt(0) ?? 0)) >>> 0;
  return hash;
};
const rotateChoices = <T>(choices: readonly T[], offset: number): readonly T[] => {
  if (choices.length < 2) return [...choices];
  const pivot = offset % choices.length;
  return [...choices.slice(pivot), ...choices.slice(0, pivot)];
};

/**
 * Compose compatibility jamo entered through the drill keyboard into Hangul blocks, as a two-set
 * input method does: vowel pairs merge, a consonant pair closes a block as a compound final unless
 * a vowel follows it, and anything that is not part of a block (a space) passes through.
 */
export function composeHangulBlocks(value: string): string {
  // Keep compatibility jamo intact: NFKC composes an initial pair before we
  // can decide whether the following consonant is a final or next initial.
  const characters = Array.from(value);
  let result = '';
  for (let index = 0; index < characters.length;) {
    const lead = LEADS.indexOf(characters[index]);
    if (lead < 0 || !isVowel(characters[index + 1])) {
      result += characters[index++];
      continue;
    }
    let next = index + 2;
    let vowelJamo = characters[index + 1];
    const compoundVowel = COMPOUND_VOWELS[vowelJamo + (characters[next] ?? '')];
    if (compoundVowel) {
      vowelJamo = compoundVowel;
      next++;
    }
    let final = 0;
    const candidate = FINALS.indexOf(characters[next]);
    if (candidate > 0 && !isVowel(characters[next + 1])) {
      const compoundFinal = COMPOUND_FINALS[characters[next] + (characters[next + 1] ?? '')];
      if (compoundFinal && !isVowel(characters[next + 2])) {
        final = FINALS.indexOf(compoundFinal);
        next += 2;
      } else {
        final = candidate;
        next++;
      }
    }
    result += String.fromCodePoint(0xac00 + ((lead * 21 + VOWELS.indexOf(vowelJamo)) * 28) + final);
    index = next;
  }
  return result;
}

/** The drill-keyboard keys that type a final consonant: a compound final takes two. */
export function hangulFinalKeys(final: string): string {
  return COMPOUND_FINAL_KEYS[final] ?? final;
}

/** Explain a single wrong final consonant, as the keys to press, without guessing about other spelling errors. */
export function findHangulFinalCorrection(answer: string, expected: string): { typed: string; expected: string } | null {
  const actualBlocks = Array.from(answer);
  const expectedBlocks = Array.from(expected);
  if (actualBlocks.length !== expectedBlocks.length) return null;
  let correction: { typed: string; expected: string } | null = null;
  for (let index = 0; index < actualBlocks.length; index++) {
    if (actualBlocks[index] === expectedBlocks[index]) continue;
    const actual = actualBlocks[index].codePointAt(0)! - 0xac00;
    const target = expectedBlocks[index].codePointAt(0)! - 0xac00;
    if (actual < 0 || actual >= 11172 || target < 0 || target >= 11172 || Math.floor(actual / 28) !== Math.floor(target / 28) || correction) return null;
    const typed = FINALS[actual % 28];
    const wanted = FINALS[target % 28];
    if (!typed || !wanted) return null;
    correction = { typed: hangulFinalKeys(typed), expected: hangulFinalKeys(wanted) };
  }
  return correction;
}

export function createLanguagePracticeDrill(card: CardData, cards: readonly CardData[]): LanguagePracticeDrillModel {
  const exercise = buildExercise(card, cards, 'spelling');
  const packId = resolveLanguagePackId(card.language);
  return {
    card,
    packId,
    kind: packId === 'ko' ? 'hangul-blocks' : packId === 'ja' ? 'kana-reading' : packId === 'zh' ? 'tone-melody' : 'spelling',
    prompt: exercise.prompt,
    ...(packId === 'ja' ? { sentenceCloze: createJapaneseSentenceCloze(card, cards) } : {}),
  };
}

export function createJapaneseSentenceCloze(card: CardData, cards: readonly CardData[]): JapaneseSentenceCloze | undefined {
  const sentence = card.exampleSentence;
  if (resolveLanguagePackId(card.language) !== 'ja' || !sentence) return undefined;
  let offset = 0;
  let bounds: { before: string; after: string } | undefined;
  for (const segment of segmentWords(sentence)) {
    const index = sentence.indexOf(segment, offset);
    if (index < 0) return undefined;
    if (segment === card.word) {
      bounds = { before: sentence.slice(0, index), after: sentence.slice(index + segment.length) };
      break;
    }
    offset = index + segment.length;
  }
  if (!bounds) return undefined;
  const choices = new Map<string, JapaneseSentenceClozeChoice>();
  for (const candidate of [card, ...cards]) {
    if (resolveLanguagePackId(candidate.language) !== 'ja' || !candidate.word || choices.has(candidate.word)) continue;
    choices.set(candidate.word, {
      word: candidate.word,
      ...(candidate.phonetic ? { reading: candidate.phonetic } : {}),
      ...(candidate.translation ? { meaning: candidate.translation } : {}),
    });
  }
  const values = [...choices.values()];
  return { ...bounds, answer: card.word, choices: rotateChoices(values, stableHash(card.id)) };
}

export function evaluateTypedLanguagePracticeDrill(
  model: LanguagePracticeDrillModel,
  answer: string,
  expectedAnswer = model.card.word,
): LanguagePracticeDrillResult {
  const exercise = buildExercise({ ...model.card, word: expectedAnswer }, [model.card], 'spelling');
  return { cardId: model.card.id, answer, correct: evaluateExerciseAnswer(exercise, answer).correct };
}

export function shouldStartJapaneseSentenceCloze(model: LanguagePracticeDrillModel, result: LanguagePracticeDrillResult): boolean {
  return model.kind === 'kana-reading' && Boolean(model.sentenceCloze) && result.correct;
}

export function evaluateJapaneseSentenceCloze(model: LanguagePracticeDrillModel, answer: string): LanguagePracticeDrillResult {
  const expected = model.sentenceCloze?.answer;
  return { cardId: model.card.id, answer, correct: expected !== undefined && answer.normalize('NFKC').trim() === expected.normalize('NFKC') };
}

export function evaluateToneLanguagePracticeDrill(
  cardId: string,
  expected: readonly PinyinToneSyllable[],
  selected: readonly number[],
): LanguagePracticeDrillResult {
  return {
    cardId,
    answer: selected,
    correct: expected.length > 0 && expected.length === selected.length && expected.every((syllable, index) => syllable.tone === selected[index]),
  };
}
