import { scoreSpeechMatch } from '../../../lib/speechMatch';
import { resolveStoredJapanesePitchAccent } from '../japanesePitch';
import type { JapanesePitchAccent } from '../japanesePitch';
import { segmentGraphemes, segmentWords } from '../unicodeSegmentation';
import { COMMON_LANGUAGE_PACK_GOALS } from './sharedGoalCatalog';
import type { HeadwordReadingPlan, LanguagePack } from '../types';

const KANA_PATTERN = /[\p{Script=Hiragana}\p{Script=Katakana}]/u;

/**
 * Japanese vocabulary generation (functions/src/index.ts) is asked to store
 * the hiragana reading of the word in `phonetic` instead of IPA. This builds
 * the furigana-style reading toggle from that field. Falls back to no
 * reading (readingText: null) when phonetic is empty, identical to the
 * word, or does not look like kana at all - the "fallback phonetic
 * contract" for cards generated before this pack existed.
 */
const buildReadingPlan = (card: {
  readonly word: string;
  readonly phonetic?: string | null;
  readonly japanesePitchAccent?: JapanesePitchAccent;
}): HeadwordReadingPlan => {
  const phonetic = card.phonetic?.trim() ?? '';
  const looksLikeReading = phonetic.length > 0
    && phonetic !== card.word.trim()
    && KANA_PATTERN.test(phonetic);
  return {
    readingText: looksLikeReading ? phonetic : null,
    readingLang: 'ja',
    kind: 'furigana',
    japanesePitchAccent: looksLikeReading ? resolveStoredJapanesePitchAccent(card) : undefined,
  };
};

export const jaLanguagePack: LanguagePack = {
  id: 'ja',
  rendering: { buildReadingPlan },
  normalization: { scriptFamily: 'kana' },
  tokenization: { segmentGraphemes, segmentWords },
  speech: { speechLocale: 'ja-JP', scoreTranscript: scoreSpeechMatch },
  goalCatalog: { goals: COMMON_LANGUAGE_PACK_GOALS },
};
