import { PassThrough } from 'node:stream';
import { renderToPipeableStream, renderToStaticMarkup } from 'react-dom/server';
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CardData } from '../types/card';
import type { PracticeWorkspace } from '../features/practice/usePracticeWorkspace';
import { AppDeferredPracticeView, AppViewFallback } from './AppDeferredViews';

const practiceViews = vi.hoisted(() => ({
  match: null as null | { cards: CardData[]; complete: () => void },
  shadowing: null as null | { cards: CardData[] },
}));

vi.mock('../features/practice/WordMatchView', () => ({
  WordMatchView: ({ cards, onComplete }: { cards: CardData[]; onComplete?: (pairs: Array<{ cardId: string; word: string; translation: string }>) => void }) => {
    practiceViews.match = { cards, complete: () => onComplete?.(cards.map(card => ({ cardId: card.id, word: card.word, translation: card.translation }))) };
    return <button type="button">Match view</button>;
  },
}));

vi.mock('../features/practice/ShadowingView', () => ({
  ShadowingView: ({ cards }: { cards: CardData[] }) => {
    practiceViews.shadowing = { cards };
    return <button type="button">Shadowing view</button>;
  },
}));

const card = (id: string): CardData => ({ id, word: `word-${id}`, translation: `translation-${id}` } as CardData);

const renderDeferredPractice = async (mode: 'match' | 'shadowing', cards: CardData[], completeMatch: (pairs: Array<{ cardId: string; word: string; translation: string }>) => void) => {
  i18n.load('en', {});
  i18n.activate('en');
  const session = {
    mode,
    study: { cards: [] },
    quiz: { spellingCards: cards, completeMatch },
    learning: {},
  } as unknown as PracticeWorkspace['model']['session'];
  const actions = { close: vi.fn() } as unknown as PracticeWorkspace['actions'];
  const output = await new Promise<string>((resolve, reject) => {
    const { pipe } = renderToPipeableStream(
      <I18nProvider i18n={i18n}><AppDeferredPracticeView session={session} actions={actions} customDecks={[]} /></I18nProvider>,
      {
        onAllReady() {
          const stream = new PassThrough();
          const chunks: Buffer[] = [];
          stream.on('data', chunk => chunks.push(Buffer.from(chunk)));
          stream.on('end', () => resolve(Buffer.concat(chunks).toString()));
          stream.on('error', reject);
          pipe(stream);
        },
        onError: reject,
      },
    );
  });
  return output;
};

describe('AppDeferredViews', () => {
  beforeEach(() => {
    practiceViews.match = null;
    practiceViews.shadowing = null;
  });

  it('reaches Match and Shadowing through the deferred production composition', async () => {
    const completeMatch = vi.fn();
    const cards = [card('one'), card('two'), card('three'), card('four')];

    const matchHtml = await renderDeferredPractice('match', cards, completeMatch);
    expect(matchHtml).toContain('Match view');
    expect(practiceViews.match?.cards).toEqual(cards);
    practiceViews.match?.complete();

    const shadowingHtml = await renderDeferredPractice('shadowing', cards, completeMatch);
    expect(shadowingHtml).toContain('Shadowing view');
    expect(practiceViews.shadowing?.cards).toEqual(cards);

    expect(completeMatch).toHaveBeenCalledWith(cards.map(item => ({ cardId: item.id, word: item.word, translation: item.translation })));
  });

  it('provides one accessible fallback presentation for deferred core views', () => {
    i18n.load('en', {});
    i18n.activate('en');
    const html = renderToStaticMarkup(<I18nProvider i18n={i18n}><AppViewFallback label="Loading library" /></I18nProvider>);

    expect(html).toContain('role="status"');
    expect(html).toContain('skeleton-sheen');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('class="workspace-loading-label"');
    expect(html.replace(/<[^>]+>/g, '')).toBe('Loading library');
  });
});
