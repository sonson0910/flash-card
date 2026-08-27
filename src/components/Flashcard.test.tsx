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

  it('presents meaning reveal as the primary card action', () => {
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

    expect(html).toContain('data-color-role="primary"');
    expect(html).toContain('Reveal the Vietnamese meaning of focus');
  });

  it('marks the front hierarchy and revealed reading sequence for choreography', () => {
    const frontHtml = renderToStaticMarkup(
      <Flashcard
        data={{
          id: 'hierarchy-check',
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
    const revealedHtml = renderToStaticMarkup(
      <Flashcard
        data={{
          id: 'hierarchy-check-revealed',
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

    expect(frontHtml).toContain('data-card-face="front"');
    expect(frontHtml).toContain('data-card-primary="word"');
    expect(frontHtml).toContain('data-card-primary="pronunciation"');
    expect(frontHtml).toContain('data-card-controls="audio"');
    expect(revealedHtml).toContain('data-card-reveal="sequence"');
    expect(revealedHtml).toMatch(/data-reveal-order="meaning"[\s\S]*data-reveal-order="explanation"[\s\S]*data-reveal-order="memory-hook"/);
  });
});
