import { beforeEach, describe, expect, it, vi } from 'vitest';

const firestore = vi.hoisted(() => ({
  collection: vi.fn((...segments: unknown[]) => ({ kind: 'collection', segments })),
  documentId: vi.fn(() => '__name__'),
  getDocs: vi.fn(),
  limit: vi.fn((value: number) => ({ kind: 'limit', value })),
  orderBy: vi.fn((field: unknown, direction: string) => ({ kind: 'orderBy', field, direction })),
  query: vi.fn((...constraints: unknown[]) => ({ kind: 'query', constraints })),
}));

vi.mock('firebase/firestore', async importOriginal => ({
  ...await importOriginal<typeof import('firebase/firestore')>(),
  ...firestore,
}));

import { createCatalogLearningStateFirebaseReader } from './catalogLearningStateFirebaseReader';
import type { LearningStateV3 } from './schemaV3';

const state = (overrides: Partial<LearningStateV3> = {}): LearningStateV3 => ({
  schemaVersion: 3,
  ownerId: 'owner-a',
  lexemeId: 'lexeme-1',
  legacyCardId: 'word-1',
  reviewHistory: [],
  bookmarked: false,
  difficulty: 'unrated',
  correctStreak: 0,
  customCollections: [],
  createdAt: '2026-08-04T00:00:00.000Z',
  ...overrides,
});

const document = (id: string, value: unknown) => ({ id, data: () => value });

describe('catalog Learning State Firebase reader', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reads only the owner Learning State collection in document ID order with a bounded limit', async () => {
    firestore.getDocs.mockResolvedValue({ docs: [document('lexeme-1', state())] });
    const reader = createCatalogLearningStateFirebaseReader({ kind: 'database' } as never);

    const result = await reader.read('owner-a', 500);

    expect([...(result?.states ?? new Map())]).toEqual([['lexeme-1', state()]]);
    expect(result?.rejected).toBe(0);
    expect(firestore.collection).toHaveBeenCalledWith(
      { kind: 'database' }, 'users', 'owner-a', 'learning_states',
    );
    expect(firestore.orderBy).toHaveBeenCalledWith('__name__', 'asc');
    expect(firestore.limit).toHaveBeenCalledWith(500);
  });

  it('caps the production query at 10,000 and rejects nonsensical limits', async () => {
    firestore.getDocs.mockResolvedValue({ docs: [] });
    const reader = createCatalogLearningStateFirebaseReader({ kind: 'database' } as never);

    await reader.read('owner-a', 50_000);
    expect(firestore.limit).toHaveBeenLastCalledWith(10_000);
    await expect(reader.read('owner-a', 0)).rejects.toThrow(/maximum/i);
    await expect(reader.read('owner-a', Number.NaN)).rejects.toThrow(/maximum/i);
  });

  it('quarantines owner, lexeme and document identity mismatches without poisoning valid state', async () => {
    firestore.getDocs.mockResolvedValue({ docs: [
      document('lexeme-1', state()),
      document('lexeme-owner', state({ ownerId: 'owner-b', lexemeId: 'lexeme-owner' })),
      document('lexeme-key', state({ lexemeId: 'lexeme-other' })),
      document('../unsafe', state({ lexemeId: '../unsafe' })),
    ] });
    const reader = createCatalogLearningStateFirebaseReader({ kind: 'database' } as never);

    const result = await reader.read('owner-a', 10);

    expect([...(result?.states.keys() ?? [])]).toEqual(['lexeme-1']);
    expect(result?.rejected).toBe(3);
  });

  it('rejects unsafe owner paths before I/O and performs no read for a null owner', async () => {
    const reader = createCatalogLearningStateFirebaseReader({ kind: 'database' } as never);

    await expect(reader.read('../owner', 10)).rejects.toThrow(/ownerId/i);
    await expect(reader.read(null, 10)).resolves.toBeNull();
    expect(firestore.getDocs).not.toHaveBeenCalled();
  });

  it('rejects a source that violates the requested result bound', async () => {
    firestore.getDocs.mockResolvedValue({ docs: [
      document('lexeme-1', state()),
      document('lexeme-2', state({ lexemeId: 'lexeme-2', legacyCardId: 'word-2' })),
    ] });
    const reader = createCatalogLearningStateFirebaseReader({ kind: 'database' } as never);

    await expect(reader.read('owner-a', 1)).rejects.toThrow(/bounded query/i);
  });
});
