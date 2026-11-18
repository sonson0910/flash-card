import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CardData } from '../types/card';

const mocks = vi.hoisted(() => ({
  getDocs: vi.fn(),
}));

vi.mock('firebase/firestore', () => ({
  collection: vi.fn(() => ({ type: 'collection' })),
  doc: vi.fn(),
  documentId: vi.fn(() => ({ type: 'documentId' })),
  endAt: vi.fn(),
  getCountFromServer: vi.fn(),
  getDocs: mocks.getDocs,
  getDocsFromServer: vi.fn(),
  getDoc: vi.fn(),
  limit: vi.fn((...args: unknown[]) => ({ type: 'limit', args })),
  onSnapshot: vi.fn(),
  orderBy: vi.fn((...args: unknown[]) => ({ type: 'orderBy', args })),
  query: vi.fn((...args: unknown[]) => ({ type: 'query', args })),
  runTransaction: vi.fn(),
  serverTimestamp: vi.fn(),
  setDoc: vi.fn(),
  startAfter: vi.fn(),
  startAt: vi.fn((...args: unknown[]) => ({ type: 'startAt', args })),
  where: vi.fn((...args: unknown[]) => ({ type: 'where', args })),
  writeBatch: vi.fn(),
}));

vi.mock('./firebase', () => ({
  app: null,
  auth: null,
  isFirebaseConfigured: false,
  protectedFunctionsCapability: { available: false, reason: 'app-check-unconfigured' },
}));

import { fetchPracticeCards } from './cardRepository';

/** A minimal snapshot shape: only `id` and `data()` are read by `fetchPracticeCards`. */
const snapshotFor = (ids: readonly string[]) => ({
  docs: ids.map(id => ({
    id,
    data: () => ({ word: id } as Partial<CardData>),
  })),
});

const cardIds = (cards: readonly CardData[]) => cards.map(card => card.id);

describe('fetchPracticeCards query count', () => {
  beforeEach(() => {
    mocks.getDocs.mockReset();
  });

  it('returns due cards alone and issues a single query when the due pool already fills the request', async () => {
    mocks.getDocs.mockResolvedValueOnce(snapshotFor(['due-1', 'due-2', 'due-3']));

    const cards = await fetchPracticeCards({} as never, 'user-1', 3);

    expect(mocks.getDocs).toHaveBeenCalledTimes(1);
    expect(cardIds(cards)).toEqual(['due-1', 'due-2', 'due-3']);
  });

  it('adds a new-card query only when the due pool is short, then stops before any rotation query', async () => {
    mocks.getDocs
      .mockResolvedValueOnce(snapshotFor(['due-1']))
      .mockResolvedValueOnce(snapshotFor(['new-1', 'new-2']));

    const cards = await fetchPracticeCards({} as never, 'user-1', 3);

    expect(mocks.getDocs).toHaveBeenCalledTimes(2);
    expect(cardIds(cards)).toEqual(['due-1', 'new-1', 'new-2']);
  });

  it('stops after the new-card query when includeFuture is false, even if the combined pool is short', async () => {
    mocks.getDocs
      .mockResolvedValueOnce(snapshotFor(['due-1']))
      .mockResolvedValueOnce(snapshotFor(['new-1']));

    const cards = await fetchPracticeCards({} as never, 'user-1', 5, { includeFuture: false });

    expect(mocks.getDocs).toHaveBeenCalledTimes(2);
    expect(cardIds(cards)).toEqual(['due-1', 'new-1']);
  });

  it('runs a rotation query when due and new cards leave the pool short, and skips the wrap-around query once rotation alone fills it', async () => {
    // maximum=5, due=1, new=1 -> scheduled=2, need 3 more.
    // sampleSize = min(100, max(5, 3*2)) = 6.
    // Rotated query returns 5 (< sampleSize=6, so the OLD gate would have
    // fired a 4th query), but scheduled(2) + rotated(5) = 7 >= maximum(5),
    // so the new gate must skip the wrap-around query.
    mocks.getDocs
      .mockResolvedValueOnce(snapshotFor(['due-1']))
      .mockResolvedValueOnce(snapshotFor(['new-1']))
      .mockResolvedValueOnce(snapshotFor(['rot-1', 'rot-2', 'rot-3', 'rot-4', 'rot-5']));

    const cards = await fetchPracticeCards({} as never, 'user-1', 5);

    expect(mocks.getDocs).toHaveBeenCalledTimes(3);
    expect(cardIds(cards)).toEqual(['due-1', 'new-1', 'rot-1', 'rot-2', 'rot-3']);
  });

  it('falls back to the wrap-around query only when the combined pool is still short after rotation', async () => {
    // maximum=5, due=0, new=0 -> scheduled=0, need 5 more.
    // sampleSize = min(100, max(5, 5*2)) = 10.
    // Rotated query returns 3 (< sampleSize=10), and scheduled(0)+rotated(3)=3 < maximum(5),
    // so the wrap-around query must run.
    mocks.getDocs
      .mockResolvedValueOnce(snapshotFor([]))
      .mockResolvedValueOnce(snapshotFor([]))
      .mockResolvedValueOnce(snapshotFor(['rot-1', 'rot-2', 'rot-3']))
      .mockResolvedValueOnce(snapshotFor(['wrap-1', 'wrap-2']));

    const cards = await fetchPracticeCards({} as never, 'user-1', 5);

    expect(mocks.getDocs).toHaveBeenCalledTimes(4);
    expect(cardIds(cards)).toEqual(['rot-1', 'rot-2', 'rot-3', 'wrap-1', 'wrap-2']);
  });

  it('skips the rotation query entirely when due and new cards already fill the pool', async () => {
    mocks.getDocs
      .mockResolvedValueOnce(snapshotFor(['due-1', 'due-2']))
      .mockResolvedValueOnce(snapshotFor(['new-1']));

    const cards = await fetchPracticeCards({} as never, 'user-1', 3);

    expect(mocks.getDocs).toHaveBeenCalledTimes(2);
    expect(cardIds(cards)).toEqual(['due-1', 'due-2', 'new-1']);
  });
});
