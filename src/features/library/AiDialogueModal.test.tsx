import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { AiDialogueContent, AiDialogueModal } from './AiDialogueModal';

import type { CardData } from '../../types/card';

const sampleCards: CardData[] = [
  { id: '1', word: 'serendipity', translation: 'sự may mắn tình cờ', phonetic: '', explanation: '', category: 'All', customDeck: null } as CardData,
  { id: '2', word: 'ephemeral', translation: 'chóng tàn', phonetic: '', explanation: '', category: 'All', customDeck: null } as CardData,
];

describe('AiDialogueModal', () => {
  it('renders dialogue generator content', () => {
    const html = renderToStaticMarkup(
      <AiDialogueContent
        cards={sampleCards}
        onClose={vi.fn()}
      />
    );

    expect(html).toContain('AI Dialogue Generator');
    expect(html).toContain('serendipity');
    expect(html).toContain('Generate Script');
    expect(html).toContain('Practice this mission by text');
  });

  it('renders nothing when closed modal', () => {
    const html = renderToStaticMarkup(
      <AiDialogueModal
        cards={sampleCards}
        open={false}
        onOpenChange={vi.fn()}
      />
    );

    expect(html).toBe('');
  });

  it('uses the typed dialogue operation and never parses model JSON in the component', () => {
    const source = readFileSync(fileURLToPath(new URL('./AiDialogueModal.tsx', import.meta.url)), 'utf8');

    expect(source).toContain('generateDialogue');
    expect(source).not.toContain('translateText');
    expect(source).not.toContain('JSON.parse');
  });
});
