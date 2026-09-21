import { describe, expect, it, vi } from 'vitest';
import type { CardQueryState } from '../../lib/cardQuery';
import type { CardData } from '../../types/card';

const runtime = vi.hoisted(() => ({
  subscribeCardPage: vi.fn(),
}));

vi.mock('firebase/firestore', () => ({ doc: vi.fn(), onSnapshot: vi.fn() }));
vi.mock('../../lib/cardRepository', () => ({
  subscribeCardPage: runtime.subscribeCardPage,
  countCards: vi.fn(),
  fetchLibraryStats: vi.fn(),
}));

import { createCloudLibraryPageFirebaseAdapter } from './cloudLibraryPageFirebaseAdapter';

const filters: CardQueryState = {
  category: null, customDeck: { kind: 'all' }, difficulty: null, partOfSpeech: null,
  bookmarkedOnly: false, createdDate: null, wordPrefix: '',
};
const card = (id: string): CardData => ({
  id, word: id, normalizedWord: id, translation: '', explanation: '', phonetic: '', emoji: '📝',
  category: 'General', audioUrl: null, imageUrl: null,
});
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(resolvePromise => { resolve = resolvePromise; });
  return { promise, resolve };
};

describe('cloud library page Firebase adapter', () => {
  it('ignores an older snapshot when its transform completes after a newer one', async () => {
    let receivePage!: (page: { items: CardData[]; lastCursor: null; hasNext: boolean; changeTypes: []; fromCache: boolean; hasPendingWrites: boolean }) => void;
    runtime.subscribeCardPage.mockImplementation((_request, onPage) => {
      receivePage = onPage;
      return vi.fn();
    });
    const first = deferred<CardData[]>();
    const second = deferred<CardData[]>();
    const transformPage = vi.fn((_request, items: CardData[]) => items[0].id === 'first' ? first.promise : second.promise);
    const adapter = createCloudLibraryPageFirebaseAdapter({ database: {} as never, transformPage });
    const published = vi.fn();
    adapter.subscribePage({ ownerId: 'owner', query: filters, queryKey: 'all', page: 1, pageSize: 9, cursor: null }, published, vi.fn());

    receivePage({ items: [card('first')], lastCursor: null, hasNext: false, changeTypes: [], fromCache: false, hasPendingWrites: false });
    receivePage({ items: [card('second')], lastCursor: null, hasNext: false, changeTypes: [], fromCache: false, hasPendingWrites: false });
    second.resolve([card('second')]);
    await Promise.resolve();
    first.resolve([card('first')]);
    await Promise.resolve();

    expect(published).toHaveBeenCalledOnce();
    expect(published).toHaveBeenCalledWith(expect.objectContaining({ items: [card('second')] }));
  });
});
