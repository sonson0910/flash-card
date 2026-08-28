import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Flashcard } from './Flashcard';

describe('Flashcard mobile controls', () => {
  it('keeps pronunciation controls left-aligned on mobile and right-aligned from sm upward', () => {
    const source = readFileSync(fileURLToPath(new URL('./Flashcard.tsx', import.meta.url)), 'utf8');

    expect(source).toContain('w-full shrink-0 items-center justify-start gap-2 sm:w-auto sm:justify-end sm:pt-4');
  });

  it('keeps revealed content in meaning, explanation, and memory-hook order', () => {
    const html = renderToStaticMarkup(
      <Flashcard
        data={{
          id: 'order-check',
          word: 'focus',
          translation: 'tập trung',
          explanation: 'A clear explanation.',
          explanationTranslation: 'Một lời giải thích rõ ràng.',
          phonetic: '/ˈfəʊkəs/',
          emoji: '🎯',
          category: 'Study',
          audioUrl: null,
          imageUrl: null,
          mnemonic: 'Think of a camera lens.',
        }}
        initialSide="back"
      />,
    );

    const meaning = html.indexOf('data-card-section="meaning"');
    const explanation = html.indexOf('data-card-section="explanation"');
    const memoryHook = html.indexOf('data-card-section="memory-hook"');

    expect(meaning).toBeGreaterThanOrEqual(0);
    expect(explanation).toBeGreaterThan(meaning);
    expect(memoryHook).toBeGreaterThan(explanation);
  });

  it('keeps meaning reveal visually secondary to the card content', () => {
    const html = renderToStaticMarkup(
      <Flashcard
        data={{
          id: 'reveal-action',
          word: 'focus',
          translation: 'tập trung',
          explanation: 'A clear explanation.',
          phonetic: '/ˈfəʊkəs/',
          emoji: '🎯',
          category: 'Study',
          audioUrl: null,
          imageUrl: null,
        }}
      />,
    );

    expect(html).not.toContain('data-color-role="primary"');
    expect(html).toContain('rounded-full border border-slate-200/90 bg-white/90');
    expect(html).toContain('Reveal the Vietnamese meaning of focus');
  });
});
