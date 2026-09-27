import { describe, expect, it } from 'vitest';
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { CardData } from '../../types/card';
import { LanguagePracticeDrill } from './LanguagePracticeDrill';
import { composeHangulBlocks, createLanguagePracticeDrill, evaluateToneLanguagePracticeDrill, evaluateTypedLanguagePracticeDrill, findHangulFinalCorrection, languagePracticeDrillSurfaceState, shouldRevealLanguagePracticeReading } from './languagePracticeDrill';
import { jaLanguagePack } from './packs/ja';

const card = (language: string, word: string): CardData => ({
  id: `${language}-card`, language, word, translation: 'meaning', explanation: '', phonetic: '', emoji: '', category: '', audioUrl: null, imageUrl: null,
});

describe('language practice drill model', () => {
  i18n.load('en', {});
  i18n.activate('en');
  it.each([
    ['en', 'word', 'spelling'],
    ['ko', '한글', 'hangul-blocks'],
    ['ja', 'かな', 'kana-reading'],
    ['zh', '汉字', 'tone-melody'],
  ] as const)('selects the %s drill for %s', (language, word, kind) => {
    expect(createLanguagePracticeDrill(card(language, word), []).kind).toBe(kind);
  });

  it('grades a Kanji word against its stored kana reading', () => {
    const model = createLanguagePracticeDrill({ ...card('ja', '学校'), phonetic: 'がっこう' }, []);
    expect(evaluateTypedLanguagePracticeDrill(model, 'がっこう', 'がっこう').correct).toBe(true);
    expect(evaluateTypedLanguagePracticeDrill(model, 'かっこう', 'がっこう').correct).toBe(false);
  });

  it('keeps a verified kana reading as one annotation for the complete Kanji headword', () => {
    const reading = jaLanguagePack.rendering.buildReadingPlan({ word: '学校', phonetic: 'がっこう' });
    expect(reading.readingText).toBe('がっこう');
    expect(reading.readingText).not.toContain(' ');
  });

  it('keeps the Japanese reading hidden until a hint or answer check', () => {
    expect(shouldRevealLanguagePracticeReading(false, false)).toBe(false);
    expect(shouldRevealLanguagePracticeReading(true, false)).toBe(true);
    expect(shouldRevealLanguagePracticeReading(false, true)).toBe(true);
  });

  it('composes two-set Hangul jamo into displayed syllable blocks before grading', () => {
    expect(composeHangulBlocks('ㅎㅏㄴㄱㅡㄹ')).toBe('한글');
    expect(composeHangulBlocks('ㄱㅏㄱㅏ')).toBe('가가');
    expect(composeHangulBlocks('ㄱㅏㄴ')).toBe('간');
    const model = createLanguagePracticeDrill(card('ko', '한글'), []);
    expect(evaluateTypedLanguagePracticeDrill(model, composeHangulBlocks('ㅎㅏㄴㄱㅡㄹ')).correct).toBe(true);
  });

  it('identifies only a single final-consonant correction', () => {
    expect(findHangulFinalCorrection('결십', '결심')).toEqual({ typed: 'ㅂ', expected: 'ㅁ' });
    expect(findHangulFinalCorrection('결심', '결심')).toBeNull();
    expect(findHangulFinalCorrection('결싯', '결심')).toEqual({ typed: 'ㅅ', expected: 'ㅁ' });
    expect(findHangulFinalCorrection('걀십', '결심')).toBeNull();
    expect(findHangulFinalCorrection('결시', '결심')).toBeNull();
  });

  it('requires every stored pinyin tone to be selected correctly', () => {
    const expected = [{ text: 'nǐ', tone: 3 }, { text: 'hǎo', tone: 3 }] as const;
    expect(evaluateToneLanguagePracticeDrill('zh-card', expected, [3, 3]).correct).toBe(true);
    expect(evaluateToneLanguagePracticeDrill('zh-card', expected, [3, 2]).correct).toBe(false);
  });

  it('keeps tone exercises unavailable through loading, errors, and missing metadata', () => {
    expect(languagePracticeDrillSurfaceState('tone-melody', null, false, false)).toBe('loading');
    expect(languagePracticeDrillSurfaceState('tone-melody', null, true, true)).toBe('error');
    expect(languagePracticeDrillSurfaceState('tone-melody', null, true, false)).toBe('missing-tone-data');
    expect(languagePracticeDrillSurfaceState('tone-melody', { readingText: 'nǐ', readingLang: 'zh-Latn', kind: 'pinyin', toneSyllables: [{ text: 'nǐ', tone: 3 }] }, true, false)).toBe('ready');
  });

  it('renders an accessible, card-backed drill surface', () => {
    const current = card('ko', '한글');
    const html = renderToStaticMarkup(
      createElement(I18nProvider, { i18n }, createElement(LanguagePracticeDrill, {
        card: current, cards: [current], currentIndex: 1, total: 4, onClose: () => {}, onNext: () => {},
      })),
    );
    expect(html).toContain('Build the syllable blocks');
    expect(html).toContain('Item 2 of 4');
    expect(html).toContain('Korean pack');
    expect(html).toContain('Loading this language exercise');
    expect(html).not.toContain('type="text"');
  });
});
