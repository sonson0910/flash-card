import type { Firestore } from 'firebase/firestore';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Constraint = { kind: string; args: unknown[] };
type QueryShape = { path: string; constraints: Constraint[] };

const firestore = vi.hoisted(() => ({
  queries: [] as QueryShape[],
  respond: (_query: QueryShape): Array<{ id: string; data: Record<string, unknown> }> => [],
}));

vi.mock('firebase/firestore', () => ({
  collection: (_database: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
  documentId: () => '__name__',
  where: (...args: unknown[]) => ({ kind: 'where', args }),
  orderBy: (...args: unknown[]) => ({ kind: 'orderBy', args }),
  limit: (...args: unknown[]) => ({ kind: 'limit', args }),
  query: (reference: { path: string }, ...constraints: Constraint[]) => ({ path: reference.path, constraints }),
  getDocs: async (shape: QueryShape) => {
    firestore.queries.push(shape);
    return { docs: firestore.respond(shape).map(item => ({ id: item.id, data: () => item.data })) };
  },
}));

import { CATALOG_PROGRESS_BATCH_SIZE, readIeltsPathCounts, RECENT_MASTERY_LIMIT } from './ieltsPathProgress';

const database = {} as Firestore;
const now = new Date('2026-11-19T08:00:00.000Z');
const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString();
const projection = (lexemeId: string, status: 'active' | 'mastered', overrides: Record<string, unknown> = {}) => ({
  id: lexemeId,
  data: { schemaVersion: 1, ownerId: 'owner-1', lexemeId, targetLanguage: 'en', status, cardRevision: 3, libraryEpoch: 2, ...overrides },
});
const card = (id: string, lexemeId: string, masteredAt: string) => ({ id, data: { lexemeId, masteredAt, language: 'en' } });

const lexemeIds = Array.from({ length: 65 }, (_, index) => `lexeme-${index}`);

describe('IELTS path progress', () => {
  beforeEach(() => {
    firestore.queries = [];
    firestore.respond = () => [];
  });

  it('reads only the path projections in batches and counts valid started and mastered words', async () => {
    firestore.respond = shape => {
      if (!shape.path.endsWith('catalog_progress')) return [];
      const batch = shape.constraints[0].args[2] as string[];
      return batch.flatMap(id => {
        if (id === 'lexeme-0' || id === 'lexeme-1') return [projection(id, 'mastered')];
        if (id === 'lexeme-2') return [projection(id, 'active')];
        if (id === 'lexeme-3') return [projection(id, 'mastered', { libraryEpoch: 1 })];
        if (id === 'lexeme-4') return [projection(id, 'mastered', { targetLanguage: 'ko' })];
        return [];
      });
    };
    const result = await readIeltsPathCounts({ database, ownerId: 'owner-1', libraryEpoch: 2, lexemeIds, now });
    const progressQueries = firestore.queries.filter(shape => shape.path === 'users/owner-1/catalog_progress');
    expect(progressQueries.map(shape => (shape.constraints[0].args[2] as string[]).length)).toEqual([30, 30, 5]);
    expect(progressQueries.every(shape => shape.constraints[0].args[0] === '__name__' && shape.constraints[0].args[1] === 'in')).toBe(true);
    expect(CATALOG_PROGRESS_BATCH_SIZE).toBe(30);
    expect(result).toMatchObject({ total: 65, started: 3, mastered: 2 });
  });

  it('counts recent mastery only for path words that are still mastered', async () => {
    firestore.respond = shape => {
      if (shape.path.endsWith('catalog_progress')) return [projection('lexeme-0', 'mastered'), projection('lexeme-1', 'mastered'), projection('lexeme-2', 'active')];
      return [
        card('c1', 'lexeme-0', daysAgo(2)),
        card('c2', 'lexeme-0', daysAgo(20)),
        card('c3', 'lexeme-1', daysAgo(10)),
        card('c4', 'lexeme-2', daysAgo(1)),
        card('c5', 'not-on-path', daysAgo(1)),
      ];
    };
    const result = await readIeltsPathCounts({ database, ownerId: 'owner-1', libraryEpoch: 2, lexemeIds: lexemeIds.slice(0, 3), now });
    expect(result).toEqual({ total: 3, started: 3, mastered: 2, masteredLast7: 1, masteredLast28: 2 });
    const cardsQuery = firestore.queries.find(shape => shape.path === 'users/owner-1/cards')!;
    expect(cardsQuery.constraints).toEqual([
      { kind: 'where', args: ['language', '==', 'en'] },
      { kind: 'where', args: ['masteredAt', '>=', daysAgo(28)] },
      { kind: 'orderBy', args: ['masteredAt', 'desc'] },
      { kind: 'limit', args: [RECENT_MASTERY_LIMIT + 1] },
    ]);
  });

  it('marks the 28-day pace unknown at the limit, keeping the week when the read covered it', async () => {
    const recent = (oldestDaysAgo: number) => Array.from({ length: RECENT_MASTERY_LIMIT + 1 }, (_, index) => (
      card(`c${index}`, `other-${index}`, daysAgo(index === RECENT_MASTERY_LIMIT - 1 ? oldestDaysAgo : 0.5))
    ));
    firestore.respond = shape => (shape.path.endsWith('cards') ? recent(9) : []);
    await expect(readIeltsPathCounts({ database, ownerId: 'owner-1', libraryEpoch: 2, lexemeIds, now }))
      .resolves.toMatchObject({ masteredLast7: 0, masteredLast28: null });
    firestore.respond = shape => (shape.path.endsWith('cards') ? recent(3) : []);
    await expect(readIeltsPathCounts({ database, ownerId: 'owner-1', libraryEpoch: 2, lexemeIds, now }))
      .resolves.toMatchObject({ masteredLast7: null, masteredLast28: null });
  });

  it('refuses unbounded owners and lexeme ids before reading', async () => {
    await expect(readIeltsPathCounts({ database, ownerId: 'a/b', libraryEpoch: 2, lexemeIds, now })).rejects.toThrow(TypeError);
    await expect(readIeltsPathCounts({ database, ownerId: 'owner-1', libraryEpoch: 2, lexemeIds: ['x/y'], now })).rejects.toThrow(TypeError);
    expect(firestore.queries).toEqual([]);
  });
});
