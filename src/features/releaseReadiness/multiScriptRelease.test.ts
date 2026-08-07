import { describe, expect, it } from 'vitest';
import { scoreScriptAnswer } from '../dailyLearning/scriptScoring';
import { createLexemeId } from '../multilingual/lexemeIdentity';
import { scriptPresentation } from './multiScriptRelease';

const cases = [
  { language: 'en', lemma: 'Vocabulary', policy: 'latin', answer: ' vocabulary! ', wrong: '词汇' },
  { language: 'zh', lemma: '学习', policy: 'han', answer: '学 习。', wrong: 'xuexi' },
  { language: 'ja', lemma: 'カタカナ', policy: 'kana', answer: 'ｶﾀｶﾅ', wrong: 'katakana' },
  { language: 'ko', lemma: '한글', policy: 'hangul', answer: '한글', wrong: 'hangeul' },
] as const;

describe('Phase 6 multi-script release matrix', () => {
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
  ] as const)('publishes valid lang and direction metadata for %s', (language, direction) => {
    expect(scriptPresentation(language)).toEqual({ lang: language, dir: direction });
  });
});
