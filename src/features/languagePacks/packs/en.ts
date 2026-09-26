import { scoreSpeechMatch } from '../../../lib/speechMatch';
import { segmentGraphemes, segmentWords } from '../unicodeSegmentation';
import { COMMON_LANGUAGE_PACK_GOALS } from './sharedGoalCatalog';
import type { HeadwordReadingPlan, LanguagePack } from '../types';

/**
 * English keeps its existing IPA-stress presentation (CardHeadword,
 * SyllableStressBadge, syllableParser.ts) unchanged; this pack exists only
 * for registry symmetry so callers can treat all four packs uniformly. It
 * intentionally does not add a reading toggle since English already shows
 * IPA phonetics inline.
 */
const buildReadingPlan = (): HeadwordReadingPlan => ({ readingText: null, readingLang: 'en', kind: 'romanization' });

export const enLanguagePack: LanguagePack = {
  id: 'en',
  rendering: { buildReadingPlan },
  normalization: { scriptFamily: 'latin' },
  tokenization: { segmentGraphemes, segmentWords },
  speech: { speechLocale: 'en-US', scoreTranscript: scoreSpeechMatch },
  goalCatalog: { goals: COMMON_LANGUAGE_PACK_GOALS },
};
