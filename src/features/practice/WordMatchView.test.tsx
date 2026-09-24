import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { awardMatchVictory, WordMatchView } from './WordMatchView';
import type { CardData } from '../../types/card';

const sampleCards: CardData[] = [
  { id: '1', language: 'en', translationLanguage: 'vi', word: 'serendipity', translation: 'sự may mắn tình cờ' } as CardData,
  { id: '2', word: 'ephemeral', translation: 'chóng tàn, phù du' } as CardData,
  { id: '3', word: 'eloquent', translation: 'hùng hồn, lưu loát' } as CardData,
  { id: '4', word: 'resilient', translation: 'kiên cường, bền bỉ' } as CardData,
  { id: '5', word: 'pristine', translation: 'nguyên sơ, thuần khiết' } as CardData,
  { id: '6', word: 'lucid', translation: 'rõ ràng, minh bạch' } as CardData,
];

describe('WordMatchView', () => {
  const render = (cards: CardData[]) => renderToStaticMarkup(
    <I18nProvider i18n={i18n}><WordMatchView cards={cards} onClose={vi.fn()} onAddXp={vi.fn()} /></I18nProvider>,
  );

  i18n.load('en', {});
  i18n.activate('en');

  it('renders matching tiles for both words and translations', () => {
    const html = render(sampleCards);

    expect(html).toContain('Word match');
    expect(html).toContain('serendipity');
    expect(html).toContain('sự may mắn tình cờ');
    expect(html).toContain('60s');
    expect(html).toContain('lang="en"');
    expect(html).toContain('lang="vi"');
  });

  it('renders empty when no cards match', () => {
    const html = render([]);

    expect(html).toContain('Word match');
  });

  it.each([4, 5])('uses the generated %s-pair board as the displayed denominator', count => {
    const html = render(sampleCards.slice(0, count));

    expect(html).toContain(`0 / ${count}`);
  });

  it('awards the completion XP once when victory settlement repeats', () => {
    const onAddXp = vi.fn();
    const awarded = { current: false };

    awardMatchVictory(onAddXp, awarded);
    awardMatchVictory(onAddXp, awarded);

    expect(onAddXp).toHaveBeenCalledOnce();
    expect(onAddXp).toHaveBeenCalledWith(20);
  });
});
