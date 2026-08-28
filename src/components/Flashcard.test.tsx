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

  it('renders meaning reveal as a centered unframed secondary action', () => {
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
    expect(html).toContain('data-reveal-meaning="true"');
    expect(html).toContain('justify-center gap-2');
    expect(html).not.toContain('border-t border-cyan-400/90');
    expect(html).toContain('data-reveal-hover-edge="true"');
    expect(html).toContain('bg-gradient-to-r from-transparent via-cyan-400 to-transparent');
    expect(html).toContain('opacity-0 transition-opacity duration-200 group-hover/flip:opacity-100');
    expect(html).toContain('text-[10px] font-black uppercase tracking-[0.14em]');
    expect(html).not.toContain('box-border flex-shrink-0 overflow-hidden rounded-b-[31px]');
    expect(html).not.toContain('Flip to the Vietnamese side');
    expect(html).toContain('Reveal the Vietnamese meaning of focus');
  });

  it('keeps the yellow mnemonic hover free of scale and all-property transitions', () => {
    const html = renderToStaticMarkup(
      <Flashcard
        data={{
          id: 'mnemonic-hover',
          word: 'focus',
          translation: 'tập trung',
          explanation: 'A clear explanation.',
          phonetic: '/ˈfəʊkəs/',
          emoji: '🎯',
          category: 'Study',
          audioUrl: null,
          imageUrl: null,
        }}
        initialSide="back"
      />,
    );

    expect(html).toContain('data-mnemonic-generate="true"');
    expect(html).toContain('transition-[background-color,box-shadow] duration-200');
    expect(html).not.toContain('hover:scale-[1.02]');
  });
});
