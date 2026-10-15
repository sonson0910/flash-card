import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { WordMatchView } from './WordMatchView';
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
    <I18nProvider i18n={i18n}><WordMatchView cards={cards} onClose={vi.fn()} /></I18nProvider>,
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
    expect(html).not.toContain('data-practice-combo');
  });

  it('renders empty when no cards match', () => {
    const html = render([]);

    expect(html).toContain('Word match');
  });

  it.each([4, 5])('uses the generated %s-pair board as the displayed denominator', count => {
    const html = render(sampleCards.slice(0, count));

    expect(html).toContain(`0 / ${count}`);
  });

  it('does not expose a client XP callback', () => {
    expect(WordMatchView.toString()).not.toContain('onAddXp');
    expect(WordMatchView.toString()).not.toContain('+20 XP');
  });

  it('celebrates only after the server confirms the completion', () => {
    const source = WordMatchView.toString();
    const completion = source.slice(source.indexOf('const submitCompletion'), source.indexOf('const handleTileClick'));
    const localVictory = source.slice(
      source.indexOf('if (nextMatched.size === tiles.length)'),
      source.indexOf('} else {', source.indexOf('if (nextMatched.size === tiles.length)')),
    );

    expect(completion).toMatch(/setCompletionStatus\(["']confirmed["']\)/);
    expect(completion).toContain('playRewardSound');
    expect(completion).toContain('triggerConfetti');
    expect(localVictory).not.toContain('playRewardSound');
    expect(localVictory).not.toContain('triggerConfetti');
  });
});
