import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { CardData } from '../../types/card';
import { CardAiAssistantModal } from './CardAiAssistantModal';

const sampleCard = {
  id: 'card-1',
  word: 'lead',
  translation: 'lãnh đạo',
  explanation: 'Guide a group.',
  phonetic: '/liːd/',
  emoji: '🧭',
  category: 'Work',
  audioUrl: null,
  imageUrl: null,
  partOfSpeech: 'verb',
} satisfies CardData;

describe('CardAiAssistantModal', () => {
  it('does not render a closed modal on the server', () => {
    const html = renderToStaticMarkup(
      <CardAiAssistantModal card={sampleCard} open={false} onOpenChange={vi.fn()} />,
    );

    expect(html).toBe('');
  });

  it('routes questions through the dedicated tutor operation', () => {
    const source = readFileSync(fileURLToPath(new URL('./CardAiAssistantModal.tsx', import.meta.url)), 'utf8');

    expect(source).toContain('askVocabularyTutor');
    expect(source).toContain('Ask anything about');
    expect(source).not.toContain('translateText');
  });
});
