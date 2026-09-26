import { describe, expect, it } from 'vitest';
import { jaLanguagePack } from './ja';

describe('jaLanguagePack.rendering.buildReadingPlan', () => {
  it('shows the hiragana reading when phonetic differs from the word', () => {
    const plan = jaLanguagePack.rendering.buildReadingPlan({ word: '今日', phonetic: 'きょう' });
    expect(plan).toMatchObject({ readingText: 'きょう', readingLang: 'ja', kind: 'furigana' });
  });

  it('hides the reading when phonetic is missing, identical to the word, or not kana', () => {
    expect(jaLanguagePack.rendering.buildReadingPlan({ word: '今日', phonetic: '' }).readingText).toBeNull();
    expect(jaLanguagePack.rendering.buildReadingPlan({ word: 'こんにちは', phonetic: 'こんにちは' }).readingText).toBeNull();
    expect(jaLanguagePack.rendering.buildReadingPlan({ word: '今日', phonetic: '/kyoː/' }).readingText).toBeNull();
  });
});
