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

  it('keeps explanation and memory hook visible while only secondary tools are disclosed', () => {
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
    const learningTools = html.indexOf('data-card-disclosure="learning-tools"');

    expect(meaning).toBeGreaterThanOrEqual(0);
    expect(explanation).toBeGreaterThan(meaning);
    expect(memoryHook).toBeGreaterThan(explanation);
    expect(learningTools).toBeGreaterThan(memoryHook);
    expect(html).not.toContain('data-card-disclosure="explanation"');
    expect(html).not.toContain('data-card-disclosure="memory-hook"');
    expect(html).toContain('mnemonic-card mt-3.5 w-full p-4 text-left');
    expect(html).toContain('AI Mnemonic · Memory Hook');
    expect(html).not.toContain('<details open=""');
    expect(html).toContain('data-translation-reveal="true"');
  });

  it('renders markdown emphasis in the memory hook', () => {
    const html = renderToStaticMarkup(
      <Flashcard
        data={{
          id: 'mnemonic-format',
          word: 'brush up on',
          translation: 'ôn tập',
          explanation: 'Review something again.',
          phonetic: '/brʌʃ ʌp ɒn/',
          emoji: '📚',
          category: 'Study',
          audioUrl: null,
          imageUrl: null,
          mnemonic: '“Bờ rát úp” — **bờ** tường **rát** nên phải **úp** mặt vào sách để **ôn tập**.',
        }}
        initialSide="back"
      />,
    );

    expect(html).toContain('<strong');
    expect(html).toContain('>bờ</strong>');
    expect(html).not.toContain('**bờ**');
  });

  it('uses the same centered minimal action for returning to English', () => {
    const html = renderToStaticMarkup(
      <Flashcard
        data={{
          id: 'return-action',
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

    expect(html).toContain('data-return-to-english="true"');
    expect(html).toContain('group/back relative z-20 flex min-h-[60px] w-full');
    expect(html).toContain('items-center justify-center gap-2');
    expect(html).toContain('bg-transparent');
    expect(html).toContain('data-return-hover-edge="true"');
    expect(html).toContain('border-t border-cyan-500/20');
    expect(html).toContain('from-cyan-500/10 via-cyan-400/55 to-cyan-500/10 opacity-75');
    expect(html).not.toContain('Return to “focus”');
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
    expect(html).toContain('group/flip relative z-20 flex min-h-[60px] w-full');
    expect(html).toContain('items-center justify-center gap-2');
    expect(html).toContain('bg-transparent');
    expect(html).toContain('border-t border-cyan-500/20');
    expect(html).toContain('data-reveal-hover-edge="true"');
    expect(html).toContain('from-cyan-500/10 via-cyan-400/55 to-cyan-500/10 opacity-75');
    expect(html).toContain('transition-opacity duration-200 group-hover/flip:opacity-100');
    expect(html).toContain('data-reveal-translate-icon="true"');
    expect(html).not.toContain('group-hover/flip:translate-x-0.5');
    expect(html).not.toContain('flashcard-reveal-button');
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

  it('uses restrained metadata and spotlight styling', () => {
    const source = readFileSync(fileURLToPath(new URL('./Flashcard.tsx', import.meta.url)), 'utf8');

    expect(source).toContain('data-card-metadata');
    expect(source).toContain('rgba(2, 132, 199, 0.11)');
    expect(source).toContain('rgba(6, 182, 212, 0.025)');
    expect(source).not.toContain('Meaning revealed');
  });
});
