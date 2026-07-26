import { beforeEach, describe, expect, it, vi } from 'vitest';

const firestore = vi.hoisted(() => ({
  getDocs: vi.fn(),
  setDoc: vi.fn(() => Promise.resolve()),
}));

vi.mock('firebase/firestore', () => ({
  collection: vi.fn((...args: unknown[]) => ({ type: 'collection', args })),
  doc: vi.fn((...args: unknown[]) => ({ type: 'doc', args })),
  documentId: vi.fn(() => 'documentId'),
  endAt: vi.fn((...args: unknown[]) => ({ type: 'endAt', args })),
  getCountFromServer: vi.fn(),
  getDocs: firestore.getDocs,
  getDocsFromServer: firestore.getDocs,
  getDoc: vi.fn(),
  getFirestore: vi.fn(() => ({})),
  initializeFirestore: vi.fn(() => ({})),
  limit: vi.fn((...args: unknown[]) => ({ type: 'limit', args })),
  onSnapshot: vi.fn(),
  orderBy: vi.fn((...args: unknown[]) => ({ type: 'orderBy', args })),
  persistentLocalCache: vi.fn(() => ({})),
  persistentMultipleTabManager: vi.fn(() => ({})),
  query: vi.fn((...args: unknown[]) => ({ type: 'query', args })),
  runTransaction: vi.fn(),
  setDoc: firestore.setDoc,
  startAfter: vi.fn((...args: unknown[]) => ({ type: 'startAfter', args })),
  startAt: vi.fn((...args: unknown[]) => ({ type: 'startAt', args })),
  where: vi.fn((...args: unknown[]) => ({ type: 'where', args })),
  writeBatch: vi.fn(),
}));

import { findCardByNormalizedWord, findCardsByNormalizedWords, streamAllCardsInBatches } from './cardRepository';

const snapshot = (documents: Array<{ id: string; data: Record<string, unknown> }>) => ({
  empty: documents.length === 0,
  docs: documents.map(document => ({
    id: document.id,
    ref: { id: document.id },
    data: () => document.data,
  })),
});

describe('findCardByNormalizedWord', () => {
  beforeEach(() => {
    firestore.getDocs.mockReset();
    firestore.setDoc.mockClear();
  });

  it('finds and indexes a legacy card outside the loaded page', async () => {
    firestore.getDocs
      .mockResolvedValueOnce(snapshot([]))
      .mockResolvedValueOnce(snapshot([{
        id: 'legacy-hidden',
        data: {
          word: 'opportunity',
          translation: 'cơ hội',
          explanation: '',
          category: 'Test',
        },
      }]));

    const result = await findCardByNormalizedWord({} as never, 'user-1', 'OPPORTUNITY');

    expect(result?.id).toBe('legacy-hidden');
    expect(firestore.setDoc).toHaveBeenCalledWith(
      { id: 'legacy-hidden' },
      { normalizedWord: 'opportunity' },
      { merge: true },
    );
  });

  it('does not full-scan the collection when both indexed lookups miss', async () => {
    firestore.getDocs
      .mockResolvedValueOnce(snapshot([]))
      .mockResolvedValueOnce(snapshot([]))
      .mockResolvedValueOnce(snapshot([{
        id: 'unrelated-full-scan-result',
        data: {
          word: 'reasonable',
          translation: 'hợp lý',
          explanation: '',
          category: 'Test',
        },
      }]));

    await expect(findCardByNormalizedWord({} as never, 'user-1', 'brand new word'))
      .resolves.toBeNull();
    expect(firestore.getDocs).toHaveBeenCalledTimes(2);
  });

  it('selects the existing card with learning progress when duplicates already exist', async () => {
    firestore.getDocs.mockResolvedValueOnce(snapshot([
      {
        id: 'older',
        data: {
          word: 'chance',
          normalizedWord: 'chance',
          translation: 'cơ hội',
          explanation: '',
          category: 'Test',
          difficulty: 'unrated',
          reviewHistory: [],
        },
      },
      {
        id: 'reviewed',
        data: {
          word: 'chance',
          normalizedWord: 'chance',
          translation: 'khả năng',
          explanation: '',
          category: 'Test',
          difficulty: 'good',
          reviewHistory: [{ rating: 'good', reviewedAt: '2026-01-01T00:00:00.000Z' }],
        },
      },
    ]));

    await expect(findCardByNormalizedWord({} as never, 'user-1', 'chance'))
      .resolves.toMatchObject({ id: 'reviewed' });
    expect(firestore.getDocs).toHaveBeenCalledTimes(1);
  });
});

describe('streamAllCardsInBatches', () => {
  beforeEach(() => {
    firestore.getDocs.mockReset();
  });

  it('streams at most 100 cards at a time without returning the full collection', async () => {
    firestore.getDocs
      .mockResolvedValueOnce(snapshot(Array.from({ length: 100 }, (_, index) => ({
        id: `batch-a-${index}`,
        data: {
          word: `word ${index}`,
          translation: `translation ${index}`,
          explanation: '',
          category: 'Test',
        },
      }))))
      .mockResolvedValueOnce(snapshot(Array.from({ length: 5 }, (_, index) => ({
        id: `batch-b-${index}`,
        data: {
          word: `tail ${index}`,
          translation: `tail translation ${index}`,
          explanation: '',
          category: 'Test',
        },
      }))));
    const batches: number[] = [];

    const loaded = await streamAllCardsInBatches(
      {} as never,
      'user-1',
      async batch => { batches.push(batch.length); },
    );

    expect(batches).toEqual([100, 5]);
    expect(loaded).toBe(105);
  });
});

describe('findCardsByNormalizedWords', () => {
  beforeEach(() => {
    firestore.getDocs.mockReset();
    firestore.setDoc.mockClear();
  });

  it('uses only bounded indexed queries when a new import word is absent', async () => {
    firestore.getDocs
      .mockResolvedValueOnce(snapshot([]))
      .mockResolvedValueOnce(snapshot([]))
      .mockResolvedValueOnce(snapshot([{
        id: 'must-not-be-full-scanned',
        data: { word: 'new term', translation: 'từ mới' },
      }]));

    await expect(findCardsByNormalizedWords({} as never, 'user-1', ['new term']))
      .resolves.toEqual(new Map());
    expect(firestore.getDocs).toHaveBeenCalledTimes(2);
  });

  it('finds a bounded legacy casing variant and repairs its normalized identity', async () => {
    firestore.getDocs
      .mockResolvedValueOnce(snapshot([]))
      .mockResolvedValueOnce(snapshot([{
        id: 'legacy-uppercase',
        data: { word: 'OPPORTUNITY', translation: 'cơ hội' },
      }]));

    const result = await findCardsByNormalizedWords({} as never, 'user-1', ['opportunity']);

    expect(result.get('opportunity')?.id).toBe('legacy-uppercase');
    expect(firestore.getDocs).toHaveBeenCalledTimes(2);
    expect(firestore.setDoc).toHaveBeenCalledWith(
      { id: 'legacy-uppercase' },
      { normalizedWord: 'opportunity' },
      { merge: true },
    );
  });
});
