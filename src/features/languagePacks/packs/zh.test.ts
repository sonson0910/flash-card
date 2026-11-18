import { describe, expect, it } from 'vitest';
import { zhLanguagePack } from './zh';

describe('zhLanguagePack.rendering.buildReadingPlan', () => {
  it('parses pinyin tone marks per syllable', () => {
    const plan = zhLanguagePack.rendering.buildReadingPlan({ word: '你好', phonetic: 'nǐ hǎo' });
    expect(plan.readingText).toBe('nǐ hǎo');
    expect(plan.kind).toBe('pinyin');
    expect(plan.toneSyllables).toEqual([
      { text: 'nǐ', tone: 3 },
      { text: 'hǎo', tone: 3 },
    ]);
  });

  it('reports a neutral tone for a syllable without a diacritic', () => {
    const plan = zhLanguagePack.rendering.buildReadingPlan({ word: '的', phonetic: 'de' });
    expect(plan.toneSyllables).toEqual([{ text: 'de', tone: 5 }]);
  });

  it('hides the reading when phonetic is missing or contains Han characters instead of pinyin', () => {
    expect(zhLanguagePack.rendering.buildReadingPlan({ word: '你好', phonetic: '' }).readingText).toBeNull();
    expect(zhLanguagePack.rendering.buildReadingPlan({ word: '你好', phonetic: '你好' }).readingText).toBeNull();
  });
});
