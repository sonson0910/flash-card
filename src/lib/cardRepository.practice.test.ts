import { beforeEach, describe, expect, it, vi } from 'vitest';

const firestore = vi.hoisted(() => ({
  collection: vi.fn((...args: unknown[]) => ({ type: 'collection', args })),
  documentId: vi.fn(() => 'documentId'),
  getDocs: vi.fn(),
  limit: vi.fn((...args: unknown[]) => ({ type: 'limit', args })),
  orderBy: vi.fn((...args: unknown[]) => ({ type: 'orderBy', args })),
  query: vi.fn((...args: unknown[]) => ({ type: 'query', args })),
  startAt: vi.fn((...args: unknown[]) => ({ type: 'startAt', args })),
  where: vi.fn((...args: unknown[]) => ({ type: 'where', args })),
}));

vi.mock('firebase/firestore', () => ({
  collection: firestore.collection,
  doc: vi.fn(),
  documentId: firestore.documentId,
  endAt: vi.fn(),
  getCountFromServer: vi.fn(),
  getDocs: firestore.getDocs,
  getDocsFromServer: vi.fn(),
  getDoc: vi.fn(),
  limit: firestore.limit,
  onSnapshot: vi.fn(),
  orderBy: firestore.orderBy,
  query: firestore.query,
  runTransaction: vi.fn(),
  serverTimestamp: vi.fn(),
  setDoc: vi.fn(),
  startAfter: vi.fn(),
  startAt: firestore.startAt,
  where: firestore.where,
}));

vi.mock('./firebase', () => ({
  app: null,
  auth: null,
  isFirebaseConfigured: false,
  protectedFunctionsCapability: { available: false },
}));

import { fetchPracticeCards } from './cardRepository';

const snapshot = (documents: Array<{ id: string; data: Record<string, unknown> }>) => ({
  docs: documents.map(document => ({
    id: document.id,
    data: () => document.data,
  })),
});

const rawCard = (id: string, fields: Record<string, unknown> = {}) => ({
  word: id,
  translation: id,
  explanation: '',
  category: 'General',
  ...fields,
});

const constraintsFor = (queryResult: unknown) =>
  (queryResult as { args: unknown[] }).args.slice(1) as Array<{ type: string; args: unknown[] }>;

beforeEach(() => {
  firestore.getDocs.mockReset();
  firestore.query.mockClear();
  firestore.where.mockClear();
  firestore.limit.mockClear();
  firestore.orderBy.mockClear();
  firestore.startAt.mockClear();
});

describe('fetchPracticeCards deck scope', () => {
  it('puts a custom deck constraint before every bounded practice query', async () => {
    firestore.getDocs
      .mockResolvedValueOnce(snapshot([]))
      .mockResolvedValueOnce(snapshot([]))
      .mockResolvedValueOnce(snapshot([{ id: 'rotated', data: rawCard('rotated', { customDeck: 'IELTS' }) }]))
      .mockResolvedValueOnce(snapshot([{ id: 'wrapped', data: rawCard('wrapped', { customDeck: 'IELTS' }) }]));

    await expect(fetchPracticeCards({} as never, 'owner-1', 2, {
      customDeck: 'IELTS',
      includeFuture: true,
      now: new Date('2026-01-01T00:00:00.000Z'),
    })).resolves.toHaveLength(2);

    expect(firestore.query).toHaveBeenCalledTimes(4);
    for (const queryResult of firestore.query.mock.results) {
      const constraints = constraintsFor(queryResult.value);
      const deckIndex = constraints.findIndex(item => item.type === 'where' && item.args[0] === 'customDeck');
      const limitIndex = constraints.findIndex(item => item.type === 'limit');
      expect(deckIndex).toBeGreaterThanOrEqual(0);
      expect(deckIndex).toBeLessThan(limitIndex);
    }
    expect(firestore.where).toHaveBeenCalledWith('customDeck', '==', 'IELTS');
  });

  it('uses a null custom deck equality for the unassigned scope', async () => {
    firestore.getDocs
      .mockResolvedValueOnce(snapshot([]))
      .mockResolvedValueOnce(snapshot([]))
      .mockResolvedValueOnce(snapshot([]))
      .mockResolvedValueOnce(snapshot([]));

    await expect(fetchPracticeCards({} as never, 'owner-1', 1, {
      customDeck: 'unassigned',
      includeFuture: true,
      now: new Date('2026-01-01T00:00:00.000Z'),
    })).resolves.toEqual([]);

    expect(firestore.where).toHaveBeenCalledWith('customDeck', '==', null);
  });

  it('leaves every cloud query unfiltered for the all-decks scope', async () => {
    firestore.getDocs
      .mockResolvedValueOnce(snapshot([]))
      .mockResolvedValueOnce(snapshot([]))
      .mockResolvedValueOnce(snapshot([{ id: 'rotated', data: rawCard('rotated') }]))
      .mockResolvedValueOnce(snapshot([{ id: 'wrapped', data: rawCard('wrapped') }]));

    await expect(fetchPracticeCards({} as never, 'owner-1', 2, {
      customDeck: null,
      includeFuture: true,
      now: new Date('2026-01-01T00:00:00.000Z'),
    })).resolves.toHaveLength(2);

    for (const queryResult of firestore.query.mock.results) {
      const constraints = constraintsFor(queryResult.value);
      expect(constraints.some(item => item.type === 'where' && item.args[0] === 'customDeck')).toBe(false);
    }
  });
});
