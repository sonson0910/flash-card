import { describe, expect, it } from 'vitest';
import { resolveStaticJapanesePitchAccent } from '../japanesePitch';
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

  it('includes pitch only when persisted metadata matches the pinned source subset', () => {
    const japanesePitchAccent = resolveStaticJapanesePitchAccent({ word: '形態', phonetic: 'けーたい' });
    const plan = jaLanguagePack.rendering.buildReadingPlan({
      word: '形態',
      phonetic: 'けーたい',
      japanesePitchAccent,
    });

    expect(plan.japanesePitchAccent).toMatchObject({ readingKana: 'けーたい', downstep: 0 });
    expect(jaLanguagePack.rendering.buildReadingPlan({
      word: '形態',
      phonetic: 'けーたい',
    }).japanesePitchAccent).toBeUndefined();
  });
});
