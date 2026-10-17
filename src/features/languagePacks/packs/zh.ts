import { scoreSpeechMatch } from '../../../lib/speechMatch';
import { segmentGraphemes, segmentWords } from '../unicodeSegmentation';
import { COMMON_LANGUAGE_PACK_GOALS } from './sharedGoalCatalog';
import type { HeadwordReadingPlan, LanguagePack, PinyinTone, PinyinToneSyllable } from '../types';

/** Precomposed Hanyu Pinyin tone-diacritic vowels, mapped to their tone number. */
const TONE_VOWEL: Readonly<Record<string, PinyinTone>> = {
  ā: 1, ē: 1, ī: 1, ō: 1, ū: 1, ǖ: 1,
  á: 2, é: 2, í: 2, ó: 2, ú: 2, ǘ: 2,
  ǎ: 3, ě: 3, ǐ: 3, ǒ: 3, ǔ: 3, ǚ: 3,
  à: 4, è: 4, ì: 4, ò: 4, ù: 4, ǜ: 4,
};

const HAN_PATTERN = /\p{Script=Han}/u;
const LATIN_PATTERN = /\p{Script=Latin}/u;

function toneOf(syllable: string): PinyinTone {
  for (const character of syllable) {
    const tone = TONE_VOWEL[character.toLowerCase()];
    if (tone) return tone;
  }
  return 5;
}

function parseToneSyllables(phonetic: string): readonly PinyinToneSyllable[] {
  return phonetic
    .split(/[\s-]+/u)
    .filter(Boolean)
    .map(text => ({ text, tone: toneOf(text) }));
}

/**
 * Chinese vocabulary generation (functions/src/index.ts) is asked to store
 * Hanyu Pinyin with tone marks in `phonetic` instead of IPA. This builds the
 * pinyin reading toggle and per-syllable tone classification from that
 * field. Falls back to no reading when phonetic is empty or looks like Han
 * characters/plain Latin text rather than diacritic pinyin.
 */
const buildReadingPlan = (card: { readonly word: string; readonly phonetic?: string | null }): HeadwordReadingPlan => {
  const phonetic = card.phonetic?.trim() ?? '';
  const looksLikePinyin = phonetic.length > 0 && !HAN_PATTERN.test(phonetic) && LATIN_PATTERN.test(phonetic);
  if (!looksLikePinyin) return { readingText: null, readingLang: 'zh-Latn', kind: 'pinyin' };
  return {
    readingText: phonetic,
    readingLang: 'zh-Latn',
    kind: 'pinyin',
    toneSyllables: parseToneSyllables(phonetic),
  };
};

export const zhLanguagePack: LanguagePack = {
  id: 'zh',
  rendering: { buildReadingPlan },
  normalization: { scriptFamily: 'han' },
  tokenization: { segmentGraphemes, segmentWords },
  speech: { speechLocale: 'zh-CN', scoreTranscript: scoreSpeechMatch },
  goalCatalog: { goals: COMMON_LANGUAGE_PACK_GOALS },
};
