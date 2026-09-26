import type { DocumentData, Firestore, Transaction } from 'firebase-admin/firestore';
import { describe, expect, it } from 'vitest';
import {
  buildCourseQueryIndexBatch,
  courseQueryIndexCardReference,
  courseQueryIndexGenerationReference,
  courseQueryIndexPointerReference,
  CourseQueryIndexLeaseError,
  invalidateCourseQueryIndexInTransaction,
  mirrorCourseCardIndexInTransaction,
  parseBuildCourseQueryIndexBatchRequest,
} from '../src/course-card-index-persistence.js';

type StoredValue = { exists: boolean; data?: DocumentData };

const snapshot = (value: StoredValue) => ({
  exists: value.exists,
  id: '',
  data: () => value.data,
});

const reference = (path: string) => ({
  path,
  collection: (name: string) => reference(`${path}/${name}`),
  doc: (id: string) => reference(`${path}/${id}`),
});

const createHarness = (cards: Record<string, DocumentData>, libraryEpoch = 0) => {
  const cardEntries: Array<[string, StoredValue]> = Object.entries(cards).map(([id, data]) => [
    `users/owner/cards/${id}`,
    { exists: true, data },
  ]);
  const values = new Map<string, StoredValue>([
    ['users/owner/profile/library_state', { exists: true, data: { libraryEpoch } }],
    ...cardEntries,
  ]);
  const database = {
    collection: (name: string) => reference(name),
    runTransaction: async (update: (transaction: Transaction) => Promise<unknown>) => {
      const writes: Array<{ method: 'set' | 'create' | 'delete'; path: string; data?: DocumentData; merge?: boolean }> = [];
      const transaction = {
        get: async (ref: { path: string }) => snapshot(values.get(ref.path) ?? { exists: false }),
        set: (ref: { path: string }, data: DocumentData, options?: { merge?: boolean }) => {
          writes.push({ method: 'set', path: ref.path, data, merge: options?.merge });
        },
        create: (ref: { path: string }, data: DocumentData) => {
          writes.push({ method: 'create', path: ref.path, data });
        },
        delete: (ref: { path: string }) => {
          writes.push({ method: 'delete', path: ref.path });
        },
      } as unknown as Transaction;
      const result = await update(transaction);
      for (const write of writes) {
        if (write.method === 'delete') values.delete(write.path);
        else values.set(write.path, {
          exists: true,
          data: write.merge
            ? { ...(values.get(write.path)?.data ?? {}), ...write.data }
            : write.data,
        });
      }
      return result;
    },
  } as unknown as Firestore;

  const cardsReference = reference('users/owner/cards');
  (cardsReference as typeof cardsReference & { orderBy: Function }).orderBy = () => {
    let cursor: string | null = null;
    return {
      limit: (limit: number) => ({
        startAfter: (value: string) => {
          cursor = value;
          return {
            get: async () => ({
              docs: Object.keys(cards).sort()
                .filter(id => cursor === null || id > cursor)
                .slice(0, limit)
                .map(id => ({ id, data: () => values.get(`users/owner/cards/${id}`)?.data })),
            }),
          };
        },
        get: async () => ({
          docs: Object.keys(cards).sort()
            .filter(id => cursor === null || id > cursor)
            .slice(0, limit)
            .map(id => ({ id, data: () => values.get(`users/owner/cards/${id}`)?.data })),
        }),
      }),
      startAfter: (value: string) => {
        cursor = value;
        return {
          limit: (limit: number) => ({
            get: async () => ({
              docs: Object.keys(cards).sort()
                .filter(id => id > cursor!)
                .slice(0, limit)
                .map(id => ({ id, data: () => values.get(`users/owner/cards/${id}`)?.data })),
            }),
          }),
        };
      },
      get: async () => ({
        docs: Object.keys(cards).sort().map(id => ({ id, data: () => values.get(`users/owner/cards/${id}`)?.data })),
      }),
    };
  };
  const originalCollection = database.collection;
  database.collection = ((name: string) => {
    if (name !== 'users') return originalCollection(name);
    return {
      doc: (ownerId: string) => {
        if (ownerId !== 'owner') return reference(`users/${ownerId}`);
        return {
          path: 'users/owner',
          collection: (subcollection: string) => {
            if (subcollection === 'cards') return cardsReference;
            return reference(`users/owner/${subcollection}`);
          },
        };
      },
    };
  }) as typeof database.collection;
  return { database, values };
};

const card = (index: number, language?: string) => ({
  word: `Word ${index}`,
  normalizedWord: `word ${index}`,
  language,
  category: 'Basics',
  partOfSpeech: 'noun',
  createdAt: '2026-09-25T00:00:00.000Z',
  libraryEpoch: 0,
});

const advance = async (
  database: Firestore,
  result: { generationId: string; leaseToken: string },
) => buildCourseQueryIndexBatch(database, 'owner', {
  generationId: result.generationId,
  leaseToken: result.leaseToken,
});

describe('course card index persistence', () => {
  it('validates the bounded callable input', () => {
    expect(parseBuildCourseQueryIndexBatchRequest({})).toEqual({});
    expect(parseBuildCourseQueryIndexBatchRequest({ generationId: 'generation', leaseToken: 'lease' }))
      .toEqual({ generationId: 'generation', leaseToken: 'lease' });
    expect(() => parseBuildCourseQueryIndexBatchRequest({ ownerId: 'other' })).toThrow();
    expect(() => parseBuildCourseQueryIndexBatchRequest({ leaseToken: 'lease' })).toThrow();
  });

  it('builds more than one bounded page and publishes only on the empty terminal page', async () => {
    const cards = Object.fromEntries(Array.from({ length: 201 }, (_, index) => [
      `card-${String(index).padStart(3, '0')}`,
      card(index),
    ]));
    const test = createHarness(cards);
    const first = await buildCourseQueryIndexBatch(test.database, 'owner');
    expect(first).toMatchObject({ status: 'building', complete: false, scanned: 100 });
    expect(first.activeGenerationId).toBeNull();
    const second = await advance(test.database, first as { generationId: string; leaseToken: string });
    const third = await advance(test.database, second as { generationId: string; leaseToken: string });
    expect(third).toMatchObject({ status: 'building', scanned: 201 });
    const published = await advance(test.database, third as { generationId: string; leaseToken: string });
    expect(published).toMatchObject({ status: 'ready', complete: true, scanned: 201 });
    expect(published.activeGenerationId).toBe(published.generationId);
    expect([...test.values.keys()].filter(path => /^users\/owner\/cards\/[^/]+$/.test(path)).length).toBe(201);
  });

  it('blocks malformed explicit targets without changing the source card', async () => {
    const source = card(1, 'fr');
    const test = createHarness({ 'card-001': source });
    const result = await buildCourseQueryIndexBatch(test.database, 'owner');
    expect(result).toMatchObject({ status: 'failed', complete: false });
    expect(result.diagnostics).toEqual([{ cardId: 'card-001', reason: 'unsupported-target-language' }]);
    expect(test.values.get('users/owner/cards/card-001')?.data).toEqual(source);
  });

  it('holds an active lease against a second builder', async () => {
    const test = createHarness({ 'card-001': card(1) });
    const first = await buildCourseQueryIndexBatch(test.database, 'owner');
    await expect(buildCourseQueryIndexBatch(test.database, 'owner', {
      generationId: first.generationId!,
    })).rejects.toBeInstanceOf(CourseQueryIndexLeaseError);
  });

  it('mirrors one authoritative card into active and building generations', async () => {
    const test = createHarness({ 'card-001': card(1) });
    const first = await buildCourseQueryIndexBatch(test.database, 'owner');
    const generationId = first.generationId!;
    const activeId = 'active-generation';
    const pointer = courseQueryIndexPointerReference(test.database, 'owner');
    const active = courseQueryIndexGenerationReference(test.database, 'owner', activeId);
    test.values.set(pointer.path, {
      exists: true,
      data: {
        schemaVersion: 1,
        projectionVersion: 1,
        libraryEpoch: 0,
        activeGenerationId: activeId,
        buildingGenerationId: generationId,
      },
    });
    test.values.set(active.path, {
      exists: true,
      data: {
        schemaVersion: 1, projectionVersion: 1, libraryEpoch: 0, status: 'ready', lastCardId: null,
        scanned: 0, leaseToken: null, leaseExpiresAt: null, startedAt: new Date().toISOString(),
      },
    });
    const activeRow = courseQueryIndexCardReference(test.database, 'owner', activeId, 'card-001');
    const buildingRow = courseQueryIndexCardReference(test.database, 'owner', generationId, 'card-001');
    await test.database.runTransaction(async transaction => {
      await mirrorCourseCardIndexInTransaction(test.database, transaction, 'owner', 'card-001', card(1));
    });
    expect(test.values.get(activeRow.path)?.data).toMatchObject({ cardId: 'card-001', targetLanguage: 'en' });
    expect(test.values.get(buildingRow.path)?.data).toMatchObject({ cardId: 'card-001', targetLanguage: 'en' });
  });

  it('clears the active and building pointers when the library epoch advances', async () => {
    const test = createHarness({ 'card-001': card(1) });
    const first = await buildCourseQueryIndexBatch(test.database, 'owner');
    await test.database.runTransaction(async transaction => {
      await invalidateCourseQueryIndexInTransaction(test.database, transaction, 'owner', 1);
    });
    const pointer = test.values.get(courseQueryIndexPointerReference(test.database, 'owner').path)?.data;
    expect(pointer).toMatchObject({ libraryEpoch: 1, activeGenerationId: null, buildingGenerationId: null });
    expect(test.values.get(courseQueryIndexGenerationReference(test.database, 'owner', first.generationId!).path)?.data)
      .toMatchObject({ status: 'retired', leaseToken: null });
  });
});
