import { readFileSync } from 'node:fs';
import { PassThrough } from 'node:stream';
import { renderToPipeableStream, renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CardData } from '../types/card';
import type { PracticeWorkspace } from '../features/practice/usePracticeWorkspace';
import { AppDeferredPracticeView, AppViewFallback } from './AppDeferredViews';

const practiceViews = vi.hoisted(() => ({
  match: null as null | { cards: CardData[]; click: () => void },
  shadowing: null as null | { cards: CardData[]; click: () => void },
}));

vi.mock('../features/practice/WordMatchView', () => ({
  WordMatchView: ({ cards, onAddXp }: { cards: CardData[]; onAddXp?: (amount: number) => void }) => {
    practiceViews.match = { cards, click: () => onAddXp?.(20) };
    return <button type="button">Match view</button>;
  },
}));

vi.mock('../features/practice/ShadowingView', () => ({
  ShadowingView: ({ cards, onAddXp }: { cards: CardData[]; onAddXp?: (amount: number) => void }) => {
    practiceViews.shadowing = { cards, click: () => onAddXp?.(10) };
    return <button type="button">Shadowing view</button>;
  },
}));

const card = (id: string): CardData => ({ id, word: `word-${id}`, translation: `translation-${id}` } as CardData);

const renderDeferredPractice = async (mode: 'match' | 'shadowing', cards: CardData[], addXp: (amount: number) => void) => {
  const session = {
    mode,
    study: { cards: [] },
    quiz: { spellingCards: cards },
    learning: {},
  } as unknown as PracticeWorkspace['model']['session'];
  const actions = { close: vi.fn() } as unknown as PracticeWorkspace['actions'];
  const output = await new Promise<string>((resolve, reject) => {
    const { pipe } = renderToPipeableStream(
      <AppDeferredPracticeView session={session} actions={actions} customDecks={[]} addXp={addXp} />,
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

  it('reaches Match and Shadowing through the deferred production composition with the XP port', async () => {
    const addXp = vi.fn();
    const cards = [card('one'), card('two'), card('three'), card('four')];

    const matchHtml = await renderDeferredPractice('match', cards, addXp);
    expect(matchHtml).toContain('Match view');
    expect(practiceViews.match?.cards).toEqual(cards);
    practiceViews.match?.click();

    const shadowingHtml = await renderDeferredPractice('shadowing', cards, addXp);
    expect(shadowingHtml).toContain('Shadowing view');
    expect(practiceViews.shadowing?.cards).toEqual(cards);
    practiceViews.shadowing?.click();

    expect(addXp).toHaveBeenNthCalledWith(1, 20);
    expect(addXp).toHaveBeenNthCalledWith(2, 10);
  });

  it('provides one accessible fallback presentation for deferred core views', () => {
    const html = renderToStaticMarkup(<AppViewFallback label="Loading library" />);

    expect(html).toContain('role="status"');
    expect(html).toContain('skeleton-sheen');
    expect(html).toContain('<span class="sr-only">Loading library</span>');
  });

  it('keeps offline preparation inside the non-landing runtime workspace', () => {
    const runtimeSource = readFileSync(new URL('./AppRuntime.tsx', import.meta.url), 'utf8');

    expect(runtimeSource).toContain("import { OfflineReadiness } from '../features/offlineApp/OfflineReadiness';");
    expect(runtimeSource).toContain("{viewMode !== 'landing' && <OfflineReadiness />}");
  });
});
