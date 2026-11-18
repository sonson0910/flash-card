import { beforeEach, describe, expect, it, vi } from 'vitest';

const firestore = vi.hoisted(() => ({
  collection: vi.fn((...segments: unknown[]) => ({ kind: 'collection', segments })),
  getDocs: vi.fn(),
  limit: vi.fn((value: number) => ({ kind: 'limit', value })),
  query: vi.fn((...constraints: unknown[]) => ({ kind: 'query', constraints })),
  where: vi.fn((field: string, operator: string, value: unknown) => ({ kind: 'where', field, operator, value })),
}));

vi.mock('firebase/firestore', async importOriginal => ({
  ...await importOriginal<typeof import('firebase/firestore')>(),
  ...firestore,
}));

import type { CatalogWorkspaceSummary } from '../catalogCache/catalogSummary';
import {
  CATALOG_PROGRESS_PROJECTION_LIMIT,
  projectCatalogPathUnits,
  readCatalogProgressProjection,
} from './catalogProgressProjectionService';

const document = (id: string, value: Record<string, unknown>) => ({ id, data: () => value });

const projection = (lexemeId: string, overrides: Record<string, unknown> = {}) => ({
  schemaVersion: 1,
  ownerId: 'owner-a',
  lexemeId,
  targetLanguage: 'en',
  status: 'active',
  cardRevision: 2,
  libraryEpoch: 3,
  ...overrides,
});

const v2Summary = (units: CatalogWorkspaceSummary['units']): CatalogWorkspaceSummary => ({
  release: {
    catalogId: 'core', releaseId: 'release-2', schemaVersion: 2, contentLanguage: 'en',
    chunkCount: 1, lexemeCount: 2, membershipCount: 2, encodedBytes: 10, unitDescriptors: [],
  },
  scannedMemberships: 2,
  tracks: [],
  units,
});

describe('catalog progress projection reader', () => {
  beforeEach(() => vi.clearAllMocks());

  it('performs one owner-scoped target-language query and excludes invalid projections', async () => {
    firestore.getDocs.mockResolvedValue({ docs: [
      document('active', projection('active')),
      document('mastered', projection('mastered', { status: 'mastered' })),
      document('wrong-epoch', projection('wrong-epoch', { libraryEpoch: 2 })),
      document('wrong-language', projection('wrong-language', { targetLanguage: 'ko' })),
      document('wrong-id', projection('different-id')),
      document('bad-revision', projection('bad-revision', { cardRevision: -1 })),
    ] });

    await expect(readCatalogProgressProjection({ kind: 'database' } as never, 'owner-a', 'en', 3))
      .resolves.toEqual(new Map([['active', 'started'], ['mastered', 'mastered']]));
    expect(firestore.collection).toHaveBeenCalledWith(
      { kind: 'database' }, 'users', 'owner-a', 'catalog_progress',
    );
    expect(firestore.where).toHaveBeenCalledWith('targetLanguage', '==', 'en');
    expect(firestore.limit).toHaveBeenCalledWith(CATALOG_PROGRESS_PROJECTION_LIMIT + 1);
    expect(firestore.getDocs).toHaveBeenCalledTimes(1);
  });

  it('reports V1 summaries as unavailable', () => {
    expect(projectCatalogPathUnits({
      ...v2Summary([]), release: { ...v2Summary([]).release, schemaVersion: 1, unitDescriptors: undefined }, units: undefined,
    })).toBeNull();
  });

  it('uses complete membership-derived counts for units sharing a lexeme across tracks', () => {
    const units = projectCatalogPathUnits(v2Summary([
      {
        unitId: 'ielts-1', trackId: 'ielts', tier: 'foundation', ordinal: 1, titles: [],
        total: 2, started: 1, mastered: 1, preview: [{ lexemeId: 'shared', lemma: 'shared' }],
      },
      {
        unitId: 'toeic-1', trackId: 'toeic', tier: 'core', ordinal: 1, titles: [],
        total: 1, started: 1, mastered: 1, preview: [{ lexemeId: 'shared', lemma: 'shared' }],
      },
    ]));

    expect(units).toMatchObject([
      { unit: { unitId: 'ielts-1' }, introduced: 1, mastered: 1, status: 'active' },
      { unit: { unitId: 'toeic-1' }, introduced: 1, mastered: 1, status: 'complete' },
    ]);
  });

  it('keeps V2 descriptors and previews while making unavailable progress explicit', () => {
    const [unit] = projectCatalogPathUnits(v2Summary([{
      unitId: 'ielts-1', trackId: 'ielts', tier: 'foundation', ordinal: 1, titles: [],
      total: 2, started: 0, mastered: 0, preview: [{ lexemeId: 'one', lemma: 'one' }],
    }]), false)!;

    expect(unit).toMatchObject({ unit: { unitId: 'ielts-1', preview: [{ lemma: 'one' }] }, status: 'unavailable', introduced: null, mastered: null });
  });
});
