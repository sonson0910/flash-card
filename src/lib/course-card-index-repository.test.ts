import { beforeEach, describe, expect, it, vi } from 'vitest';

const firestore = vi.hoisted(() => ({
  getDoc: vi.fn(),
  getDocs: vi.fn(),
  getCountFromServer: vi.fn(),
  onSnapshot: vi.fn(),
}));

vi.mock('firebase/firestore', () => ({
  collection: vi.fn((...path: unknown[]) => ({ kind: 'collection', path })),
  doc: vi.fn((...path: unknown[]) => ({ kind: 'doc', path })),
  documentId: vi.fn(() => '__name__'),
  endAt: vi.fn((...args: unknown[]) => ({ kind: 'endAt', args })),
  getCountFromServer: firestore.getCountFromServer,
  getDocs: firestore.getDocs,
  getDoc: firestore.getDoc,
  limit: vi.fn((...args: unknown[]) => ({ kind: 'limit', args })),
  onSnapshot: firestore.onSnapshot,
  orderBy: vi.fn((...args: unknown[]) => ({ kind: 'orderBy', args })),
  query: vi.fn((...args: unknown[]) => ({ kind: 'query', args })),
  startAfter: vi.fn((...args: unknown[]) => ({ kind: 'startAfter', args })),
  startAt: vi.fn((...args: unknown[]) => ({ kind: 'startAt', args })),
  where: vi.fn((...args: unknown[]) => ({ kind: 'where', args })),
}));

import {
  CourseIndexNotReadyError,
  CourseIndexStaleError,
  countCourseCards,
  fetchCourseCardPage,
  fetchCoursePracticeCards,
  type CourseCardPageOptions,
} from './course-card-index-repository';

const context = {
  courseId: 'english-course',
  targetLanguage: 'en' as const,
  libraryEpoch: 4,
  activeGenerationId: 'generation-a',
};

const row = (cardId: string, revision = 2) => ({
  schemaVersion: 1,
  cardId,
  targetLanguage: 'en',
  sourceLibraryEpoch: 4,
  sourceRevision: revision,
  normalizedWord: cardId,
  category: 'Other',
  partOfSpeech: '',
  customDeck: null,
  difficulty: 'unrated',
  bookmarked: false,
  createdAt: '2026-09-25T00:00:00.000Z',
});

const projectionSnapshot = (rows: ReturnType<typeof row>[]) => ({
  docs: rows.map(value => ({
    id: value.cardId,
    data: () => value,
    ref: { path: `users/owner-1/course_query_generations/generation-a/cards/${value.cardId}` },
  })),
});

const primarySnapshot = (cards: Array<Record<string, unknown>>) => ({
  docs: cards.map(card => ({ id: String(card.id), data: () => card })),
});

const validPointer = () => ({
  schemaVersion: 1,
  projectionVersion: 1,
  libraryEpoch: 4,
  activeGenerationId: 'generation-a',
  buildingGenerationId: null,
});

const validGeneration = () => ({
  schemaVersion: 1,
  projectionVersion: 1,
  libraryEpoch: 4,
  status: 'ready',
  lastCardId: null,
  scanned: 2,
  leaseToken: null,
  leaseExpiresAt: null,
  startedAt: '2026-09-25T00:00:00.000Z',
});

const pageOptions = (overrides: Partial<CourseCardPageOptions> = {}): CourseCardPageOptions => ({
  db: {} as never,
  userId: 'owner-1',
  filters: {
    category: null,
    customDeck: null,
    difficulty: null,
    partOfSpeech: null,
    bookmarkedOnly: false,
    createdDate: null,
    wordPrefix: '',
    courseId: 'english-course',
    targetLanguage: 'en',
  },
  context,
  pageSize: 2,
  ...overrides,
});

beforeEach(() => {
  firestore.getDoc.mockReset();
  firestore.getDocs.mockReset();
  firestore.getCountFromServer.mockReset();
  firestore.onSnapshot.mockReset();
  firestore.getDoc.mockImplementation(async (reference: { path?: unknown[] }) => {
    const path = Array.isArray(reference.path) ? reference.path : [];
    if (path.at(-1) === 'course_query_index') return { exists: () => true, data: validPointer };
    if (path.at(-1) === 'library_state') return { exists: () => true, data: () => ({ libraryEpoch: 4 }) };
    if (path.at(-2) === 'course_query_generations') return { exists: () => true, data: validGeneration };
    return { exists: () => false };
  });
});

describe('course card index repository', () => {
  it('queries the target sidecar before limit and hydrates visible rows in source order', async () => {
    firestore.getDocs
      .mockResolvedValueOnce(projectionSnapshot([row('card-a'), row('card-b'), row('card-c')]))
      .mockResolvedValueOnce(primarySnapshot([
        { id: 'card-b', word: 'B', normalizedWord: 'card-b', language: 'en', revision: 2, libraryEpoch: 4 },
        { id: 'card-a', word: 'A', normalizedWord: 'card-a', language: 'en', revision: 2, libraryEpoch: 4 },
      ]));

    const result = await fetchCourseCardPage(pageOptions());

    expect(result.items.map(card => card.id)).toEqual(['card-a', 'card-b']);
    expect(result.hasNext).toBe(true);
    const sidecarQuery = firestore.getDocs.mock.calls[0][0] as { args: unknown[] };
    const constraints = sidecarQuery.args.slice(1) as Array<{ kind?: string; args?: unknown[] }>;
    expect(constraints[0]).toMatchObject({ kind: 'where', args: ['targetLanguage', '==', 'en'] });
    expect(constraints.at(-1)).toMatchObject({ kind: 'limit', args: [3] });
  });

  it('retries the same cursor once after a stale visible row, then fails closed', async () => {
    const onStale = vi.fn();
    firestore.getDocs
      .mockResolvedValueOnce(projectionSnapshot([row('card-a', 1)]))
      .mockResolvedValueOnce(primarySnapshot([
        { id: 'card-a', word: 'A', normalizedWord: 'card-a', language: 'en', revision: 2, libraryEpoch: 4 },
      ]))
      .mockResolvedValueOnce(projectionSnapshot([row('card-a', 2)]))
      .mockResolvedValueOnce(primarySnapshot([
        { id: 'card-a', word: 'A', normalizedWord: 'card-a', language: 'en', revision: 3, libraryEpoch: 4 },
      ]));

    await expect(fetchCourseCardPage(pageOptions({ onStale }))).rejects.toBeInstanceOf(CourseIndexStaleError);
    expect(firestore.getDocs).toHaveBeenCalledTimes(4);
    expect(onStale).toHaveBeenCalledOnce();
    expect(onStale).toHaveBeenCalledWith(expect.objectContaining({ reason: 'revision' }));
  });

  it('does not fall back to the owner card collection when no compatible pointer exists', async () => {
    firestore.getDoc.mockImplementation(async (reference: { path?: unknown[] }) => {
      const path = Array.isArray(reference.path) ? reference.path : [];
      if (path.at(-1) === 'course_query_index') return { exists: () => false };
      return { exists: () => false };
    });

    await expect(fetchCourseCardPage(pageOptions())).rejects.toBeInstanceOf(CourseIndexNotReadyError);
    expect(firestore.getDocs).not.toHaveBeenCalled();
  });

  it('rejects a cursor registered for another target before querying sidecar rows', async () => {
    firestore.getDocs
      .mockResolvedValueOnce(projectionSnapshot([row('card-a')]))
      .mockResolvedValueOnce(primarySnapshot([
        { id: 'card-a', word: 'A', normalizedWord: 'card-a', language: 'en', revision: 2, libraryEpoch: 4 },
      ]));
    const first = await fetchCourseCardPage(pageOptions());
    const koreanContext = {
      ...context,
      targetLanguage: 'ko' as const,
    };
    await expect(fetchCourseCardPage(pageOptions({
      context: koreanContext,
      filters: { ...pageOptions().filters, targetLanguage: 'ko' },
      cursor: first.lastCursor,
    }))).rejects.toBeInstanceOf(CourseIndexStaleError);
    expect(firestore.getDocs).toHaveBeenCalledTimes(2);
  });

  it('restarts from page one when the active generation changes before the read', async () => {
    firestore.getDoc.mockImplementation(async (reference: { path?: unknown[] }) => {
      const path = Array.isArray(reference.path) ? reference.path : [];
      if (path.at(-1) === 'course_query_index') return {
        exists: () => true,
        data: () => ({ ...validPointer(), activeGenerationId: 'generation-b' }),
      };
      if (path.at(-1) === 'library_state') return { exists: () => true, data: () => ({ libraryEpoch: 4 }) };
      if (path.at(-2) === 'course_query_generations') return {
        exists: () => true,
        data: () => validGeneration(),
      };
      return { exists: () => false };
    });
    firestore.getDocs
      .mockResolvedValueOnce(projectionSnapshot([row('card-a')]))
      .mockResolvedValueOnce(primarySnapshot([
        { id: 'card-a', word: 'A', normalizedWord: 'card-a', language: 'en', revision: 2, libraryEpoch: 4 },
      ]));

    const result = await fetchCourseCardPage(pageOptions());

    expect(result.items.map(card => card.id)).toEqual(['card-a']);
    expect(firestore.getDocs).toHaveBeenCalledTimes(2);
  });

  it('counts only the selected target through the sidecar aggregate', async () => {
    firestore.getCountFromServer.mockResolvedValue({ data: () => ({ count: 7 }) });

    await expect(countCourseCards(
      {} as never,
      'owner-1',
      pageOptions().filters,
      context,
    )).resolves.toBe(7);

    const aggregateQuery = firestore.getCountFromServer.mock.calls[0][0] as { args: unknown[] };
    const constraints = aggregateQuery.args.slice(1) as Array<{ kind?: string; args?: unknown[] }>;
    expect(constraints[0]).toMatchObject({ kind: 'where', args: ['targetLanguage', '==', 'en'] });
  });

  it('applies the target predicate before practice limits and guards early returns', async () => {
    const dueRows = [row('card-a'), row('card-b')].map(value => ({
      ...value,
      nextReviewDate: '2026-09-24T00:00:00.000Z',
    }));
    firestore.getDocs
      .mockResolvedValueOnce(projectionSnapshot(dueRows))
      .mockResolvedValueOnce(primarySnapshot(dueRows.map(value => ({
        id: value.cardId,
        word: value.cardId,
        normalizedWord: value.cardId,
        language: 'en',
        revision: value.sourceRevision,
        libraryEpoch: value.sourceLibraryEpoch,
        nextReviewDate: value.nextReviewDate,
      }))));

    const result = await fetchCoursePracticeCards({
      db: {} as never,
      userId: 'owner-1',
      context,
      maximum: 2,
      includeFuture: false,
    });

    expect(result.map(card => card.id)).toEqual(['card-a', 'card-b']);
    const practiceQuery = firestore.getDocs.mock.calls[0][0] as { args: unknown[] };
    const constraints = practiceQuery.args.slice(1) as Array<{ kind?: string; args?: unknown[] }>;
    expect(constraints[0]).toMatchObject({ kind: 'where', args: ['targetLanguage', '==', 'en'] });
    expect(constraints.at(-1)).toMatchObject({ kind: 'limit', args: [2] });
  });

  it('hydrates 100 visible rows in batches no larger than 30 IDs', async () => {
    const rows = Array.from({ length: 101 }, (_, index) => row(`card-${index.toString().padStart(3, '0')}`));
    const hydrationBatchSizes: number[] = [];
    firestore.getDocs.mockImplementation(async (sourceQuery: { args: unknown[] }) => {
      const collectionReference = sourceQuery.args[0] as { path?: unknown[] };
      const path = Array.isArray(collectionReference.path) ? collectionReference.path : [];
      if (path.includes('course_query_generations')) return projectionSnapshot(rows);
      const constraints = sourceQuery.args.slice(1) as Array<{ kind?: string; args?: unknown[] }>;
      const idConstraint = constraints.find(constraint => constraint.kind === 'where'
        && constraint.args?.[0] === '__name__'
        && constraint.args?.[1] === 'in');
      const ids = Array.isArray(idConstraint?.args?.[2]) ? idConstraint.args[2] as string[] : [];
      hydrationBatchSizes.push(ids.length);
      return primarySnapshot(ids.map(id => ({
        id,
        word: id,
        normalizedWord: id,
        language: 'en',
        revision: 2,
        libraryEpoch: 4,
      })));
    });

    const result = await fetchCourseCardPage(pageOptions({ pageSize: 100 }));

    expect(result.items).toHaveLength(100);
    expect(hydrationBatchSizes).toEqual([30, 30, 30, 10]);
  });

  it('retries practice from the current generation after a scope switch during hydration', async () => {
    let pointerReadCount = 0;
    firestore.getDoc.mockImplementation(async (reference: { path?: unknown[] }) => {
      const path = Array.isArray(reference.path) ? reference.path : [];
      if (path.at(-1) === 'course_query_index') {
        pointerReadCount += 1;
        return {
          exists: () => true,
          data: () => ({ ...validPointer(), activeGenerationId: pointerReadCount < 2 ? 'generation-a' : 'generation-b' }),
        };
      }
      if (path.at(-1) === 'library_state') return { exists: () => true, data: () => ({ libraryEpoch: 4 }) };
      if (path.at(-2) === 'course_query_generations') return { exists: () => true, data: validGeneration };
      return { exists: () => false };
    });
    firestore.getDocs
      .mockResolvedValueOnce(projectionSnapshot([row('card-a')]))
      .mockResolvedValueOnce(primarySnapshot([{
        id: 'card-a',
        word: 'A',
        normalizedWord: 'card-a',
        language: 'en',
        revision: 2,
        libraryEpoch: 4,
      }]))
      .mockResolvedValueOnce(projectionSnapshot([row('card-a')]))
      .mockResolvedValueOnce(primarySnapshot([{
        id: 'card-a',
        word: 'A',
        normalizedWord: 'card-a',
        language: 'en',
        revision: 2,
        libraryEpoch: 4,
      }]));

    const result = await fetchCoursePracticeCards({
      db: {} as never,
      userId: 'owner-1',
      context,
      maximum: 1,
      includeFuture: false,
    });

    expect(result.map(card => card.id)).toEqual(['card-a']);
    const sidecarQueries = firestore.getDocs.mock.calls.filter(([sourceQuery]) => {
      const collectionReference = (sourceQuery as { args: unknown[] }).args[0] as { path?: unknown[] };
      return Array.isArray(collectionReference.path) && collectionReference.path.includes('course_query_generations');
    });
    expect(sidecarQueries).toHaveLength(2);
    expect((sidecarQueries[0][0] as { args: unknown[] }).args[0]).toMatchObject({
      path: expect.arrayContaining(['generation-a']),
    });
    expect((sidecarQueries[1][0] as { args: unknown[] }).args[0]).toMatchObject({
      path: expect.arrayContaining(['generation-b']),
    });
  });
});
