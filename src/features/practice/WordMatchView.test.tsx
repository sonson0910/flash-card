import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { WordMatchView } from './WordMatchView';
import type { CardData } from '../../types/card';

const sampleCards: CardData[] = [
  { id: '1', word: 'serendipity', translation: 'sự may mắn tình cờ' } as CardData,
  { id: '2', word: 'ephemeral', translation: 'chóng tàn, phù du' } as CardData,
  { id: '3', word: 'eloquent', translation: 'hùng hồn, lưu loát' } as CardData,
  { id: '4', word: 'resilient', translation: 'kiên cường, bền bỉ' } as CardData,
  { id: '5', word: 'pristine', translation: 'nguyên sơ, thuần khiết' } as CardData,
  { id: '6', word: 'lucid', translation: 'rõ ràng, minh bạch' } as CardData,
];

describe('WordMatchView', () => {
  it('renders matching tiles for both words and translations', () => {
    const html = renderToStaticMarkup(
      <WordMatchView cards={sampleCards} onClose={vi.fn()} onAddXp={vi.fn()} />
    );

    expect(html).toContain('Word Match Speed-Run');
    expect(html).toContain('serendipity');
    expect(html).toContain('sự may mắn tình cờ');
    expect(html).toContain('60s');
  });

  it('renders empty when no cards match', () => {
    const html = renderToStaticMarkup(
      <WordMatchView cards={[]} onClose={vi.fn()} />
    );

    expect(html).toContain('Word Match Speed-Run');
  });

  it.each([4, 5, 6])('shows the actual %s-pair round size', pairCount => {
    const html = renderToStaticMarkup(
      <WordMatchView cards={sampleCards.slice(0, pairCount)} onClose={vi.fn()} />,
    );

    expect(html).toContain(`0 / ${pairCount}`);
  });

  it('shows an empty zero-pair score when no eligible cards exist', () => {
    const html = renderToStaticMarkup(<WordMatchView cards={[]} onClose={vi.fn()} />);

    expect(html).toContain('0 / 0');
  });
});
