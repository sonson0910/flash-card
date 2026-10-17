import { describe, expect, it } from 'vitest';
import { koLanguagePack } from './ko';

describe('koLanguagePack.rendering.buildReadingPlan', () => {
  it('romanizes the Hangul word as the reading', () => {
    const plan = koLanguagePack.rendering.buildReadingPlan({ word: '안녕' });
    expect(plan).toMatchObject({ readingText: 'annyeong', readingLang: 'ko-Latn', kind: 'romanization' });
  });

  it('reports no reading for a word without Hangul', () => {
    expect(koLanguagePack.rendering.buildReadingPlan({ word: '' }).readingText).toBeNull();
  });
});
