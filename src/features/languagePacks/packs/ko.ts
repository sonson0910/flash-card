import { scoreSpeechMatch } from '../../../lib/speechMatch';
import { romanizeHangul } from '../hangulRomanization';
import { segmentGraphemes, segmentWords } from '../unicodeSegmentation';
import { COMMON_LANGUAGE_PACK_GOALS } from './sharedGoalCatalog';
import type { HeadwordReadingPlan, LanguagePack } from '../types';

const buildReadingPlan = (card: { readonly word: string }): HeadwordReadingPlan => {
  const readingText = romanizeHangul(card.word);
  return { readingText, readingLang: 'ko-Latn', kind: 'romanization' };
};

export const koLanguagePack: LanguagePack = {
  id: 'ko',
  rendering: { buildReadingPlan },
  normalization: { scriptFamily: 'hangul' },
  tokenization: { segmentGraphemes, segmentWords },
  speech: { speechLocale: 'ko-KR', scoreTranscript: scoreSpeechMatch },
  goalCatalog: { goals: COMMON_LANGUAGE_PACK_GOALS },
};
