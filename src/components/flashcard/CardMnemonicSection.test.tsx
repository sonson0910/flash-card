import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
i18n.load('en', {}); i18n.activate('en');
import { createElement } from 'react';
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
      createElement(I18nProvider, { i18n }, <CardMnemonicSection card={sampleCard} onUpdateCard={vi.fn()} />),
    );

    expect(html).toContain('Memory hook');
  });

  it('routes mnemonic generation through the dedicated operation', () => {
    const source = readFileSync(fileURLToPath(new URL('./CardMnemonicSection.tsx', import.meta.url)), 'utf8');

    expect(source).toContain('generateMnemonic');
    expect(source).not.toContain('translateText');
  });
});
