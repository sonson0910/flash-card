import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Flashcard } from './Flashcard';

describe('Flashcard mobile controls', () => {
  it('keeps pronunciation controls in their own left-aligned row', () => {
    const source = readFileSync(fileURLToPath(new URL('./Flashcard.tsx', import.meta.url)), 'utf8');

    expect(source).toContain('w-full shrink-0 items-center justify-start gap-2" data-card-control data-card-controls="audio"');
    expect(source).not.toContain('sm:w-auto sm:justify-end sm:pt-4" data-card-control data-card-controls="audio"');
  });

  it('keeps touched flashcard surfaces on explicit motion transitions', () => {
    const sourcePaths = [
      './Flashcard.tsx',
      './flashcard/ActiveRecallQuiz.tsx',
      './flashcard/CardAiAssistantModal.tsx',
    ];

    for (const sourcePath of sourcePaths) {
      const source = readFileSync(fileURLToPath(new URL(sourcePath, import.meta.url)), 'utf8');

      expect(source, sourcePath).not.toContain('transition-all');
    }

    const flashcardSource = readFileSync(fileURLToPath(new URL('./Flashcard.tsx', import.meta.url)), 'utf8');
    expect(flashcardSource).toContain('transition-[filter,background-color,border-color]');
    expect(flashcardSource).toContain('transition-[filter,background-color,border-color,color,box-shadow]');
    expect(flashcardSource).toContain('transition-[filter,scale,opacity,background-color,border-color,color]');
    expect(flashcardSource).toContain('transition-[filter,background-color,scale]');
    expect(flashcardSource).toContain('transition-[filter,scale]');
  });

  it('only renders a media block for a supported image URL', () => {
    const renderCard = (imageUrl: string | null) => renderToStaticMarkup(
      <Flashcard
        data={{
          id: `media-${imageUrl ?? 'none'}`,
          word: 'focus',
          translation: 'tập trung',
          explanation: 'A clear explanation.',
          phonetic: '/ˈfəʊ.kəs/',
          emoji: '🎯',
          category: 'Study',
          audioUrl: null,
          imageUrl,
        }}
      />,
    );

    expect(renderCard(null)).not.toContain('data-card-media');
    expect(renderCard('http://untrusted.example/image.jpg')).not.toContain('data-card-media');
    expect(renderCard('https://images.unsplash.com/photo-123')).toContain('data-card-media');
  });

  it('keys failed media state to the image URL without a reset effect', () => {
    const source = readFileSync(fileURLToPath(new URL('./Flashcard.tsx', import.meta.url)), 'utf8');

    expect(source).toContain('const [failedImageUrl, setFailedImageUrl] = useState<string | null>(null);');
    expect(source).toContain('failedImageUrl !== supportedImageUrl');
    expect(source).not.toContain('setImageUnavailable(false)');
  });

  it('uses the stronger light-theme status color for new cards', () => {
    const html = renderToStaticMarkup(
      <Flashcard
        data={{
          id: 'new-card-status',
          word: 'focus',
          translation: 'tập trung',
          explanation: 'A clear explanation.',
          phonetic: '/fəʊ.kəs/',
          emoji: '🎯',
          category: 'Study',
          audioUrl: null,
          imageUrl: null,
        }}
      />,
    );

    expect(html).toContain('text-emerald-700 dark:text-emerald-400');
    expect(html).not.toContain('text-emerald-600 dark:text-emerald-400');
  });

  it('keeps touched syllable controls explicit and touch-sized', () => {
    const source = readFileSync(fileURLToPath(new URL('./flashcard/SyllableStressBadge.tsx', import.meta.url)), 'utf8');

    expect(source).toContain('min-h-11 min-w-11');
    expect(source).toContain('transition-[filter,background-color,border-color,color,scale,box-shadow]');
    expect(source).not.toContain('transition-all');
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

  it('keeps the meaning reveal action in its quiet pill treatment', () => {
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

    const revealButton = html.match(/<button[^>]*data-flip-card[^>]*>/)?.[0];

    expect(revealButton).toBeDefined();
    expect(revealButton).toContain('rounded-full');
    expect(revealButton).toContain('bg-white/90');
    expect(revealButton).not.toContain('data-color-role="primary"');
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
