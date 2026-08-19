import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { WordMatchView } from './WordMatchView';
import type { CardData } from '../../types/card';

const sampleCards: CardData[] = [
  { id: '1', word: 'serendipity', translation: 'sự may mắn tình cờ', tags: [] },
  { id: '2', word: 'ephemeral', translation: 'chóng tàn, phù du', tags: [] },
  { id: '3', word: 'eloquent', translation: 'hùng hồn, lưu loát', tags: [] },
  { id: '4', word: 'resilient', translation: 'kiên cường, bền bỉ', tags: [] },
  { id: '5', word: 'pristine', translation: 'nguyên sơ, thuần khiết', tags: [] },
  { id: '6', word: 'lucid', translation: 'rõ ràng, minh bạch', tags: [] },
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
});
