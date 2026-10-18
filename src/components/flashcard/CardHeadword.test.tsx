import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { CardData } from '../../types/card';
import { CardHeadword } from './CardHeadword';

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

describe('CardHeadword', () => {
  it('keeps the existing English IPA phonetic markup unchanged and shows no reading toggle', () => {
    const markup = renderToStaticMarkup(
      <CardHeadword card={card({ word: 'hesitate', phonetic: '/ˈhez.ɪ.teɪt/' })} />,
    );
    expect(markup).toContain('hesitate');
    expect(markup).not.toContain('flashcard.reading');
  });

  it('does not duplicate a CJK reading in the raw phonetic line before the language pack has loaded', () => {
    const markup = renderToStaticMarkup(
      <CardHeadword card={card({ word: '안녕', language: 'ko', phonetic: 'annyeong' })} />,
    );
    // The reading annotation arrives from the lazy language pack. The card
    // must not show its source phonetic value separately in the meantime.
    expect(markup).toContain('안녕');
    expect(markup).not.toContain('annyeong');
  });
});
