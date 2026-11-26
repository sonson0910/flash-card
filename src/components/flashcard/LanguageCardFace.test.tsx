import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { CardData } from '../../types/card';
import { LanguageCardChips } from './LanguageCardFace';

i18n.load('en', {});
i18n.activate('en');

const baseCard: CardData = {
  id: 'chips',
  word: 'word',
  translation: 'nghĩa',
  explanation: '',
  phonetic: '',
  emoji: '',
  category: 'General',
  audioUrl: null,
  imageUrl: null,
};

/** The chip texts in document order, with markup stripped. */
function chipTexts(card: CardData): string[] {
  const html = renderToStaticMarkup(<I18nProvider i18n={i18n}><LanguageCardChips card={card} /></I18nProvider>);
  return [...html.matchAll(/class="flashcard-lang-chip">(.*?)<\/span>(?=<span[^>]*class="flashcard-lang-chip"|<\/div>)/g)]
    .map(match => match[1].replace(/<[^>]+>/g, ''));
}

describe('LanguageCardChips order', () => {
  it('leads a Korean card with the verb class, then the hanja, then the spoken form', () => {
    expect(chipTexts({
      ...baseCard,
      word: '결심하다',
      language: 'ko',
      languageDetails: { sinoForm: { source: '決心' }, spokenForm: '[결씸하다]', hints: ['Động từ 하다'] },
    })).toEqual(['Động từ 하다', 'Hanja 決心', 'Spoken [결씸하다]']);
  });

  it('leads a Chinese card with the measure word, then the traditional form', () => {
    expect(chipTexts({
      ...baseCard,
      word: '机会',
      language: 'zh',
      languageDetails: { sinoForm: { source: '機會' }, measureWord: { word: '个', reading: 'gè' }, hints: ['HSK 3'] },
    })).toEqual(['Measure word 个 gè', 'Traditional 機會', 'HSK 3']);
  });

  it('leads a Japanese card with the kanji form, then its hints', () => {
    expect(chipTexts({
      ...baseCard,
      word: '経験',
      language: 'ja',
      languageDetails: { sinoForm: { source: '經驗' }, hints: ['Động từ: 経験する'] },
    })).toEqual(['Kanji 經驗', 'Động từ: 経験する']);
  });

  it('leads a Latin-script card with the stress, then hints, then the plural', () => {
    expect(chipTexts({
      ...baseCard,
      word: 'immediate',
      language: 'en',
      languageDetails: { stressIndex: 1, hints: ['formal'], plural: 'immediates' },
    })).toEqual(['Stress syllable 2', 'formal', 'pl. immediates']);
  });
});
