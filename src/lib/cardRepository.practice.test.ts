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
    firestore.getDocs.mockImplementation(async queryResult => {
      const constraints = constraintsFor(queryResult);
      const difficultyConstraint = constraints.find(item => item.type === 'where' && item.args[0] === 'difficulty');
      if (constraints.some(item => item.type === 'where' && item.args[0] === 'nextReviewDate')) return snapshot([]);
      if (difficultyConstraint?.args[1] === '==' && difficultyConstraint.args[2] === 'hard') {
        return snapshot([{ id: 'rotated', data: rawCard('rotated', { customDeck: 'IELTS' }) }]);
      }
      if (difficultyConstraint?.args[1] === 'in') {
        return snapshot([{ id: 'wrapped', data: rawCard('wrapped', { customDeck: 'IELTS' }) }]);
      }
      return snapshot([]);
    });

    await expect(fetchPracticeCards({} as never, 'owner-1', 2, {
      customDeck: { kind: 'deck', name: 'IELTS' },
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
    firestore.getDocs.mockResolvedValue(snapshot([]));

    await expect(fetchPracticeCards({} as never, 'owner-1', 1, {
      customDeck: { kind: 'unassigned' },
      includeFuture: true,
      now: new Date('2026-01-01T00:00:00.000Z'),
    })).resolves.toEqual([]);

    expect(firestore.where).toHaveBeenCalledWith('customDeck', '==', null);
  });

  it('uses exact custom deck equality for a literal unassigned deck', async () => {
    firestore.getDocs.mockResolvedValue(snapshot([]));

    await expect(fetchPracticeCards({} as never, 'owner-1', 1, {
      customDeck: { kind: 'deck', name: 'unassigned' },
      includeFuture: true,
      now: new Date('2026-01-01T00:00:00.000Z'),
    })).resolves.toEqual([]);

    expect(firestore.where).toHaveBeenCalledWith('customDeck', '==', 'unassigned');
  });

  it('leaves every cloud query unfiltered for the all-decks scope', async () => {
    firestore.getDocs.mockImplementation(async queryResult => {
      const constraints = constraintsFor(queryResult);
      if (constraints.some(item => item.type === 'where' && item.args[0] === 'nextReviewDate')) return snapshot([]);
      if (constraints.some(item => item.type === 'startAt')) {
        return snapshot([{ id: 'rotated', data: rawCard('rotated') }]);
      }
      if (
        !constraints.some(item => item.type === 'where' && item.args[0] === 'difficulty')
        && constraints.some(item => item.type === 'orderBy' && item.args[0] === 'documentId')
      ) {
        return snapshot([{ id: 'wrapped', data: rawCard('wrapped') }]);
      }
      return snapshot([]);
    });

    await expect(fetchPracticeCards({} as never, 'owner-1', 2, {
      customDeck: { kind: 'all' },
      includeFuture: true,
      now: new Date('2026-01-01T00:00:00.000Z'),
    })).resolves.toHaveLength(2);

    for (const queryResult of firestore.query.mock.results) {
      const constraints = constraintsFor(queryResult.value);
      expect(constraints.some(item => item.type === 'where' && item.args[0] === 'customDeck')).toBe(false);
    }
  });
});

describe('fetchPracticeCards new-card reservation', () => {
  it('reserves room for reviewed cards when new cards exceed five', async () => {
    const newCards = Array.from({ length: 7 }, (_, index) => ({
      id: `new-${index}`,
      data: rawCard(`new-${index}`, { difficulty: 'unrated' }),
    }));
    const reviewedCards = [
      { id: 'weak', data: rawCard('weak', { difficulty: 'hard', reviews: 1 }) },
      { id: 'learned', data: rawCard('learned', { difficulty: 'good', reviews: 2 }) },
    ];

    firestore.getDocs.mockImplementation(async queryResult => {
      const constraints = constraintsFor(queryResult);
      const queryLimit = Number(constraints.find(item => item.type === 'limit')?.args[0] ?? 0);
      const difficultyConstraint = constraints.find(item => item.type === 'where' && item.args[0] === 'difficulty');
      if (constraints.some(item => item.type === 'where' && item.args[0] === 'nextReviewDate')) {
        return snapshot([]);
      }
      if (difficultyConstraint?.args[1] === '==' && difficultyConstraint.args[2] === 'hard') {
        return snapshot(reviewedCards.slice(0, 1));
      }
      if (difficultyConstraint?.args[1] === 'in') {
        return snapshot(reviewedCards.slice(1));
      }
      if (difficultyConstraint?.args[1] === '==' && difficultyConstraint.args[2] === 'unrated') {
        return snapshot(newCards.slice(0, queryLimit));
      }
      return snapshot([]);
    });

    await expect(fetchPracticeCards({} as never, 'owner-1', 7, {
      includeFuture: true,
      now: new Date('2026-01-01T00:00:00.000Z'),
    })).resolves.toMatchObject([
      { id: 'weak' },
      ...newCards.slice(0, 5).map(card => ({ id: card.id })),
      { id: 'learned' },
    ]);

    expect(firestore.limit).toHaveBeenCalledWith(5);
  });

  it('limits new cards to the smaller remaining capacity after due cards', async () => {
    const dueCards = Array.from({ length: 8 }, (_, index) => ({
      id: `due-${index}`,
      data: rawCard(`due-${index}`, { difficulty: 'good', nextReviewDate: '2025-12-31T00:00:00.000Z' }),
    }));
    const newCards = Array.from({ length: 5 }, (_, index) => ({
      id: `new-${index}`,
      data: rawCard(`new-${index}`, { difficulty: 'unrated' }),
    }));

    firestore.getDocs.mockImplementation(async queryResult => {
      const constraints = constraintsFor(queryResult);
      const queryLimit = Number(constraints.find(item => item.type === 'limit')?.args[0] ?? 0);
      if (constraints.some(item => item.type === 'where' && item.args[0] === 'nextReviewDate')) {
        return snapshot(dueCards.slice(0, queryLimit));
      }
      return snapshot(newCards.slice(0, queryLimit));
    });

    await expect(fetchPracticeCards({} as never, 'owner-1', 10, {
      includeFuture: false,
      now: new Date('2026-01-01T00:00:00.000Z'),
    })).resolves.toMatchObject([
      ...dueCards.map(card => ({ id: card.id })),
      { id: 'new-0' },
      { id: 'new-1' },
    ]);

    expect(firestore.limit).toHaveBeenNthCalledWith(2, 2);
  });

  it('prioritizes reviewed candidates before an unseen rotated fallback', async () => {
    const dueCards = [{ id: 'due', data: rawCard('due', {
      difficulty: 'hard',
      nextReviewDate: '2025-12-31T00:00:00.000Z',
    }) }];
    const newCards = Array.from({ length: 3 }, (_, index) => ({
      id: `new-${index}`,
      data: rawCard(`new-${index}`, { difficulty: 'unrated' }),
    }));
    const weakCards = [{ id: 'weak', data: rawCard('weak', { difficulty: 'hard', reviews: 1 }) }];
    const learnedCards = [{ id: 'learned', data: rawCard('learned', { difficulty: 'good', reviews: 2 }) }];
    const unseenCards = Array.from({ length: 7 }, (_, index) => ({
      id: `unseen-${index}`,
      data: rawCard(`unseen-${index}`),
    }));

    firestore.getDocs.mockImplementation(async queryResult => {
      const constraints = constraintsFor(queryResult);
      const queryLimit = Number(constraints.find(item => item.type === 'limit')?.args[0] ?? 0);
      const difficultyConstraint = constraints.find(item => item.type === 'where' && item.args[0] === 'difficulty');
      if (constraints.some(item => item.type === 'where' && item.args[0] === 'nextReviewDate')) {
        return snapshot(dueCards.slice(0, queryLimit));
      }
      if (difficultyConstraint?.args[1] === '==' && difficultyConstraint.args[2] === 'unrated') {
        return snapshot(newCards.slice(0, queryLimit));
      }
      if (difficultyConstraint?.args[1] === '==' && difficultyConstraint.args[2] === 'hard') {
        return snapshot(weakCards.slice(0, queryLimit));
      }
      if (difficultyConstraint?.args[1] === 'in') {
        return snapshot(learnedCards.slice(0, queryLimit));
      }
      if (constraints.some(item => item.type === 'startAt')) {
        return snapshot(unseenCards.slice(0, queryLimit));
      }
      return snapshot([]);
    });

    await expect(fetchPracticeCards({} as never, 'owner-1', 8, {
      includeFuture: true,
      now: new Date('2026-01-01T00:00:00.000Z'),
    })).resolves.toMatchObject([
      { id: 'due' },
      { id: 'weak' },
      ...newCards.map(card => ({ id: card.id })),
      { id: 'learned' },
      { id: 'unseen-0' },
      { id: 'unseen-1' },
    ]);
  });

  it('does not let duplicate due cards starve future weak cards', async () => {
    const dueCards = [
      { id: 'due-0', data: rawCard('due-0', { difficulty: 'hard', nextReviewDate: '2025-12-30T00:00:00.000Z' }) },
      { id: 'due-1', data: rawCard('due-1', { difficulty: 'hard', nextReviewDate: '2025-12-31T00:00:00.000Z' }) },
    ];
    const weakPool = [
      ...dueCards,
      { id: 'weak', data: rawCard('weak', { difficulty: 'hard', reviews: 1, nextReviewDate: '2026-01-03T00:00:00.000Z' }) },
    ];
    const newCards = [{ id: 'new-0', data: rawCard('new-0', { difficulty: 'unrated' }) }];

    firestore.getDocs.mockImplementation(async queryResult => {
      const constraints = constraintsFor(queryResult);
      const queryLimit = Number(constraints.find(item => item.type === 'limit')?.args[0] ?? 0);
      const difficultyConstraint = constraints.find(item => item.type === 'where' && item.args[0] === 'difficulty');
      if (constraints.some(item => item.type === 'where' && item.args[0] === 'nextReviewDate')) {
        return snapshot(dueCards.slice(0, queryLimit));
      }
      if (difficultyConstraint?.args[1] === '==' && difficultyConstraint.args[2] === 'hard') {
        return snapshot(weakPool.slice(0, queryLimit));
      }
      if (difficultyConstraint?.args[1] === '==' && difficultyConstraint.args[2] === 'unrated') {
        return snapshot(newCards.slice(0, queryLimit));
      }
      return snapshot([]);
    });

    await expect(fetchPracticeCards({} as never, 'owner-1', 3, {
      includeFuture: true,
      now: new Date('2026-01-01T00:00:00.000Z'),
    })).resolves.toMatchObject([
      { id: 'due-0' },
      { id: 'due-1' },
      { id: 'weak' },
    ]);

    expect(firestore.limit).toHaveBeenNthCalledWith(2, 3);
  });
});
