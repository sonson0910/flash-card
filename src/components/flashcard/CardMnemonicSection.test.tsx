import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { CardData } from '../../types/card';
import { CardMnemonicSection } from './CardMnemonicSection';

const sampleCard = {
  id: 'card-1',
  word: 'resilient',
  translation: 'bền bỉ',
  explanation: 'Able to recover quickly.',
  phonetic: '/rɪˈzɪliənt/',
  emoji: '🌱',
  category: 'Work',
  audioUrl: null,
  imageUrl: null,
  partOfSpeech: 'adjective',
} satisfies CardData;

describe('CardMnemonicSection', () => {
  it('renders the mnemonic action', () => {
    const html = renderToStaticMarkup(
      <CardMnemonicSection card={sampleCard} onUpdateCard={vi.fn()} />,
    );

    expect(html).toContain('Generate AI Mnemonic');
  });

  it('routes mnemonic generation through the dedicated operation', () => {
    const source = readFileSync(fileURLToPath(new URL('./CardMnemonicSection.tsx', import.meta.url)), 'utf8');

    expect(source).toContain('generateMnemonic');
    expect(source).not.toContain('translateText');
  });
});
