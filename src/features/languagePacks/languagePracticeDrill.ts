import { buildExercise, evaluateExerciseAnswer } from '../dailyLearning/exerciseEngine';
import { resolveLanguagePackId } from './registry';
import type { CardData } from '../../types/card';
import type { HeadwordReadingPlan, LanguagePackId, PinyinToneSyllable } from './types';

export type LanguagePracticeDrillKind = 'spelling' | 'hangul-blocks' | 'kana-reading' | 'tone-melody';

export interface LanguagePracticeDrillModel {
  readonly card: CardData;
  readonly packId: LanguagePackId;
  readonly kind: LanguagePracticeDrillKind;
  readonly prompt: string;
}

export interface LanguagePracticeDrillResult {
  readonly cardId: string;
  readonly correct: boolean;
  readonly answer: string | readonly number[];
}

export type LanguagePracticeDrillSurfaceState = 'loading' | 'error' | 'missing-tone-data' | 'ready';

/** Reveal a reading only after the learner asks for help or checks an answer. */
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

/** Compose compatibility jamo entered through the drill keyboard into Hangul blocks. */
export function composeHangulBlocks(value: string): string {
  // Keep compatibility jamo intact: NFKC composes an initial pair before we
  // can decide whether the following consonant is a final or next initial.
  const characters = Array.from(value);
  let result = '';
  for (let index = 0; index < characters.length;) {
    const lead = LEADS.indexOf(characters[index]);
    const vowel = VOWELS.indexOf(characters[index + 1]);
    if (lead < 0 || vowel < 0) {
      result += characters[index++];
      continue;
    }
    let final = 0;
    const candidate = FINALS.indexOf(characters[index + 2]);
    if (candidate > 0 && VOWELS.indexOf(characters[index + 3]) < 0) final = candidate;
    result += String.fromCodePoint(0xac00 + ((lead * 21 + vowel) * 28) + final);
    index += final ? 3 : 2;
  }
  return result;
}

export function createLanguagePracticeDrill(card: CardData, cards: readonly CardData[]): LanguagePracticeDrillModel {
  const exercise = buildExercise(card, cards, 'spelling');
  const packId = resolveLanguagePackId(card.language);
  return {
    card,
    packId,
    kind: packId === 'ko' ? 'hangul-blocks' : packId === 'ja' ? 'kana-reading' : packId === 'zh' ? 'tone-melody' : 'spelling',
    prompt: exercise.prompt,
  };
}

export function evaluateTypedLanguagePracticeDrill(
  model: LanguagePracticeDrillModel,
  answer: string,
  expectedAnswer = model.card.word,
): LanguagePracticeDrillResult {
  const exercise = buildExercise({ ...model.card, word: expectedAnswer }, [model.card], 'spelling');
  return { cardId: model.card.id, answer, correct: evaluateExerciseAnswer(exercise, answer).correct };
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
