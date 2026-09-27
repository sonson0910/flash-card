import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CardData } from '../../types/card';

const mocks = vi.hoisted(() => ({
  getDocs: vi.fn(),
}));

vi.mock('firebase/firestore', () => ({
  collection: vi.fn((...args: unknown[]) => ({ type: 'collection', args })),
  documentId: vi.fn(() => ({ type: 'documentId' })),
  getDocs: mocks.getDocs,
  limit: vi.fn((...args: unknown[]) => ({ type: 'limit', args })),
  orderBy: vi.fn((...args: unknown[]) => ({ type: 'orderBy', args })),
  query: vi.fn((...args: unknown[]) => ({ type: 'query', args })),
  startAfter: vi.fn((...args: unknown[]) => ({ type: 'startAfter', args })),
  where: vi.fn((...args: unknown[]) => ({ type: 'where', args })),
}));

import { collection, orderBy, where } from 'firebase/firestore';
import { fetchWebWordsPage, WEB_WORDS_PAGE_SIZE } from './webWordsQuery';

/** A minimal doc snapshot: only `id` and `data()` are read by `fetchWebWordsPage`. */
const docFor = (card: Partial<CardData> & { id: string }) => ({ id: card.id, data: () => card });

const snapshotFor = (cards: readonly (Partial<CardData> & { id: string })[]) => ({ docs: cards.map(docFor) });

const webCard = (id: string, capturedAt: string): Partial<CardData> & { id: string } => ({
  id, word: id, translation: 'x', language: 'en', createdAt: capturedAt,
  source: { url: 'https://example.com', capturedAt },
});

describe('fetchWebWordsPage', () => {
  beforeEach(() => {
    mocks.getDocs.mockReset();
    vi.mocked(collection).mockClear();
    vi.mocked(where).mockClear();
    vi.mocked(orderBy).mockClear();
  });

  it('filters by language and orders by source.capturedAt desc, with no separate "has a source" where clause', async () => {
    mocks.getDocs.mockResolvedValueOnce(snapshotFor([webCard('a', '2026-09-27T00:00:00.000Z')]));

    await fetchWebWordsPage({ db: {} as never, ownerId: 'owner-1', targetLanguage: 'en' });

    expect(collection).toHaveBeenCalledWith({}, 'users', 'owner-1', 'cards');
    expect(where).toHaveBeenCalledTimes(1);
    expect(where).toHaveBeenCalledWith('language', '==', 'en');
    expect(orderBy).toHaveBeenCalledWith('source.capturedAt', 'desc');
  });

  it('requests pageSize+1 documents to detect hasNext, then trims the lookahead document from the returned page', async () => {
    const cards = Array.from({ length: 3 }, (_, index) => webCard(`c${index}`, `2026-09-2${index}T00:00:00.000Z`));
    mocks.getDocs.mockResolvedValueOnce(snapshotFor(cards));

    const page = await fetchWebWordsPage({ db: {} as never, ownerId: 'owner-1', targetLanguage: 'en', pageSize: 2 });

    expect(page.items).toHaveLength(2);
    expect(page.hasNext).toBe(true);
    expect(page.cursor).not.toBeNull();
  });

  it('reports hasNext false and returns every item when fewer than pageSize+1 documents come back', async () => {
    mocks.getDocs.mockResolvedValueOnce(snapshotFor([webCard('only', '2026-09-27T00:00:00.000Z')]));

    const page = await fetchWebWordsPage({ db: {} as never, ownerId: 'owner-1', targetLanguage: 'en', pageSize: 5 });

    expect(page.items).toHaveLength(1);
    expect(page.hasNext).toBe(false);
  });

  it('requests exactly pageSize documents and skips the lookahead read when detectHasNext is false', async () => {
    mocks.getDocs.mockResolvedValueOnce(snapshotFor([webCard('only', '2026-09-27T00:00:00.000Z')]));

    await fetchWebWordsPage({
      db: {} as never, ownerId: 'owner-1', targetLanguage: 'en', pageSize: 5, detectHasNext: false,
    });

    const limitMock = (await import('firebase/firestore')).limit;
    expect(limitMock).toHaveBeenCalledWith(5);
  });

  it('defaults to a page size of 30', () => {
    expect(WEB_WORDS_PAGE_SIZE).toBe(30);
  });

  it('drops a normalized card that ends up without a source, as defense in depth against a future query-shape change', async () => {
    mocks.getDocs.mockResolvedValueOnce(snapshotFor([
      { id: 'no-source', word: 'x', translation: 'y', language: 'en', createdAt: '2026-09-27T00:00:00.000Z' },
    ]));

    const page = await fetchWebWordsPage({ db: {} as never, ownerId: 'owner-1', targetLanguage: 'en' });

    expect(page.items).toHaveLength(0);
  });
});
