import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { CardData } from '../../types/card';
import { SyllableStressBadge } from './SyllableStressBadge';

vi.mock('@lingui/react', async importOriginal => ({
  ...(await importOriginal<typeof import('@lingui/react')>()),
  Trans: ({ message, values }: { message: string; values?: Record<string, unknown> }) => message.split(/(\{\w+\})/).map(part => {
    const key = part.slice(1, -1);
    return part.startsWith('{') && part.endsWith('}') ? (values?.[key] ?? part) : part;
  }),
  useLingui: () => ({
    _: (descriptor: { message: string }) => descriptor.message,
    i18n: {
      locale: 'en',
      _: (id: string, values?: Record<string, unknown>) => id.replace(/\{(\w+)\}/g, (_match, key) => String(values?.[key] ?? `{${key}}`)),
    },
  }),
}));

const card = (overrides: Partial<CardData> = {}): CardData => ({
  id: 'card',
  word: 'word',
  normalizedWord: 'word',
  translation: 'meaning',
  explanation: '',
  phonetic: '',
  emoji: '',
  category: 'General',
  audioUrl: null,
  imageUrl: null,
  ...overrides,
});

describe('SyllableStressBadge', () => {
  it('still shows the English syllable breakdown', () => {
    const markup = renderToStaticMarkup(
      <SyllableStressBadge card={card({ word: 'serendipity', phonetic: '/ˌser.ənˈdɪp.ə.ti/' })} />,
    );
    expect(markup).toContain('Syllables');
  });

  it('renders nothing for a Korean card instead of running the English vowel-cluster heuristic on it', () => {
    const markup = renderToStaticMarkup(
      <SyllableStressBadge card={card({ word: '안녕하세요', language: 'ko' })} />,
    );
    expect(markup).toBe('');
  });

  it('renders nothing for a Chinese card', () => {
    const markup = renderToStaticMarkup(
      <SyllableStressBadge card={card({ word: '你好', language: 'zh' })} />,
    );
    expect(markup).toBe('');
  });
});
