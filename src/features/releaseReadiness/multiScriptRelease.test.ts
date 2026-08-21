import { describe, expect, it } from 'vitest';
import { scoreScriptAnswer } from '../dailyLearning/scriptScoring';
import { createLexemeId } from '../multilingual/lexemeIdentity';
import { learnerContentLanguage, scriptPresentation } from './multiScriptRelease';

const cases = [
  { language: 'en', lemma: 'Vocabulary', policy: 'latin', answer: ' vocabulary! ', wrong: '词汇' },
  { language: 'zh', lemma: '学习', policy: 'han', answer: '学 习。', wrong: 'xuexi' },
  { language: 'ja', lemma: 'カタカナ', policy: 'kana', answer: 'ｶﾀｶﾅ', wrong: 'katakana' },
  { language: 'ko', lemma: '한글', policy: 'hangul', answer: '한글', wrong: 'hangeul' },
] as const;

describe('Multi-script release matrix', () => {
  it.each(cases)('scores $language/$policy safely', ({ lemma, policy, answer, wrong }) => {
    expect(scoreScriptAnswer(lemma, answer, policy)).toMatchObject({ correct: true, wrongScript: false });
    expect(scoreScriptAnswer(lemma, wrong, policy)).toMatchObject({ correct: false, wrongScript: true });
  });

  it('keeps identical lemmas isolated by language', () => {
    const identity = { normalizedLemma: 'bank', partOfSpeech: 'noun', senseKey: 'financial' };
    expect(createLexemeId({ language: 'en', ...identity }))
      .not.toBe(createLexemeId({ language: 'de', ...identity }));
  });

  it.each([
    ['en', 'ltr'], ['zh-Hans', 'ltr'], ['ja', 'ltr'], ['ko', 'ltr'], ['ar', 'rtl'],
    ['AR-eg', 'rtl'], ['he-IL', 'rtl'], ['fa', 'rtl'],
  ] as const)('publishes valid lang and direction metadata for %s', (language, direction) => {
    expect(scriptPresentation(language)).toEqual({ lang: language === 'AR-eg' ? 'ar-EG' : language, dir: direction });
  });

  it('rejects invalid language tags with a stable type error', () => {
    expect(() => scriptPresentation('not a language tag')).toThrow(TypeError);
  });

  it.each([
    ['Vocabulary', 'en', 'en'],
    ['تحليل دقيق', 'en', 'ar'],
    ['ניתוח מפורט', 'en', 'he'],
    ['学习', 'en', 'zh-Hans'],
    ['カタカナ', 'en', 'ja'],
    ['한글', 'en', 'ko'],
  ] as const)('derives presentation language from learner content %s', (content, fallback, expected) => {
    expect(learnerContentLanguage(content, fallback)).toBe(expected);
  });
});
