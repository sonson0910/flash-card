import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getCountFromServer: vi.fn(),
}));

vi.mock('firebase/firestore', () => ({
  collection: vi.fn(() => ({ type: 'collection' })),
  doc: vi.fn(),
  documentId: vi.fn(() => ({ type: 'documentId' })),
  endAt: vi.fn((...args: unknown[]) => ({ type: 'endAt', args })),
  getCountFromServer: mocks.getCountFromServer,
  getDocs: vi.fn(),
  getDocsFromServer: vi.fn(),
  getDoc: vi.fn(),
  limit: vi.fn(),
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

import { query, where } from 'firebase/firestore';
import { fetchLibraryDueCount, fetchLibraryStats } from './cardRepository';

const countSnapshot = (count: number) => ({ data: () => ({ count }) });

/** Every countCards/raw query in fetchLibraryStats resolves in this Promise.all order. */
const queueCounts = (counts: {
  total: number;
  reviewed: number;
  easy: number;
  good: number;
  hard: number;
  unrated: number;
  bookmarked: number;
  due: number;
}) => {
  mocks.getCountFromServer
    .mockResolvedValueOnce(countSnapshot(counts.total))
    .mockResolvedValueOnce(countSnapshot(counts.reviewed))
    .mockResolvedValueOnce(countSnapshot(counts.easy))
    .mockResolvedValueOnce(countSnapshot(counts.good))
    .mockResolvedValueOnce(countSnapshot(counts.hard))
    .mockResolvedValueOnce(countSnapshot(counts.unrated))
    .mockResolvedValueOnce(countSnapshot(counts.bookmarked))
    .mockResolvedValueOnce(countSnapshot(counts.due));
};

const languageWhereCalls = () => vi.mocked(where).mock.calls.filter(call => call[0] === 'language');

describe('fetchLibraryStats course scoping', () => {
  beforeEach(() => {
    mocks.getCountFromServer.mockReset();
    vi.mocked(where).mockClear();
    vi.mocked(query).mockClear();
  });

  it('counts the whole library when no active course language is resolved yet', async () => {
    queueCounts({ total: 10, reviewed: 4, easy: 1, good: 2, hard: 1, unrated: 3, bookmarked: 2, due: 5 });

    const stats = await fetchLibraryStats({} as never, 'user-1');

    expect(mocks.getCountFromServer).toHaveBeenCalledTimes(8);
    expect(languageWhereCalls()).toHaveLength(0);
    expect(stats).toMatchObject({
      total: 10, reviewed: 4, easy: 1, good: 2, hard: 1, unrated: 6, bookmarked: 2, due: 5, legacyUnindexed: 3,
    });
    expect(stats.dueAsOfDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('scopes every underlying count to the active course language, including the raw reviewed-count query', async () => {
    queueCounts({ total: 3, reviewed: 1, easy: 1, good: 0, hard: 0, unrated: 2, bookmarked: 0, due: 1 });

    await fetchLibraryStats({} as never, 'user-1', 'ko');

    expect(mocks.getCountFromServer).toHaveBeenCalledTimes(8);
    // total, easy, good, hard, unrated, bookmarked, due (via countCards) + the raw reviewed query.
    expect(languageWhereCalls()).toHaveLength(8);
    languageWhereCalls().forEach(call => expect(call).toEqual(['language', '==', 'ko']));
  });

  it('orders the reviewed-count query fields to match the language+reviews composite index', async () => {
    queueCounts({ total: 0, reviewed: 0, easy: 0, good: 0, hard: 0, unrated: 0, bookmarked: 0, due: 0 });

    await fetchLibraryStats({} as never, 'user-1', 'ko');

    const reviewedQueryCall = vi.mocked(query).mock.calls.find(call =>
      call.some(argument => argument && typeof argument === 'object' && (argument as { args?: unknown[] }).args?.[0] === 'reviews'));
    expect(reviewedQueryCall).toBeDefined();
    expect(reviewedQueryCall).toEqual([
      { type: 'collection' },
      { type: 'where', args: ['language', '==', 'ko'] },
      { type: 'where', args: ['reviews', '>', 0] },
    ]);
  });

  it('never filters by language when the active course resolves to an empty string', async () => {
    queueCounts({ total: 1, reviewed: 0, easy: 0, good: 0, hard: 0, unrated: 1, bookmarked: 0, due: 0 });

    await fetchLibraryStats({} as never, 'user-1', '');

    expect(languageWhereCalls()).toHaveLength(0);
  });

  it('refreshes only the due count for a new local day', async () => {
    mocks.getCountFromServer.mockResolvedValueOnce(countSnapshot(4));

    const due = await fetchLibraryDueCount({} as never, 'user-1', 'ko');

    expect(mocks.getCountFromServer).toHaveBeenCalledOnce();
    expect(languageWhereCalls()).toEqual([['language', '==', 'ko']]);
    expect(due).toMatchObject({ due: 4 });
    expect(due.dueAsOfDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
