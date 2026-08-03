import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const firestore = vi.hoisted(() => ({
  collection: vi.fn((...segments: unknown[]) => ({ kind: 'collection', segments })),
  doc: vi.fn((...segments: unknown[]) => ({ kind: 'doc', segments })),
  documentId: vi.fn(() => '__name__'),
  getDoc: vi.fn(),
  getDocs: vi.fn(),
  limit: vi.fn((value: number) => ({ kind: 'limit', value })),
  orderBy: vi.fn((field: unknown, direction: string) => ({ kind: 'orderBy', field, direction })),
  query: vi.fn((...constraints: unknown[]) => ({ kind: 'query', constraints })),
  where: vi.fn((field: string, operation: string, value: unknown) => ({
    kind: 'where', field, operation, value,
  })),
}));

vi.mock('firebase/firestore', async importOriginal => ({
  ...await importOriginal<typeof import('firebase/firestore')>(),
  ...firestore,
}));

import { createMultilingualFirebaseSourcePort } from './multilingualFirebaseReader';

const document = (id: string, value: Record<string, unknown>) => ({ id, data: () => value });

describe('multilingual Firebase source port', () => {
  beforeEach(() => vi.clearAllMocks());

  it('joins bounded owner state, lexeme and published membership sources', async () => {
    firestore.getDocs
      .mockResolvedValueOnce({ docs: [document('lexeme-a', { ownerId: 'owner-a' })] })
      .mockResolvedValueOnce({ docs: [document('membership-a', {
        lexemeId: 'lexeme-a', editorialStatus: 'published',
      })] });
    firestore.getDoc.mockResolvedValue({
      exists: () => true,
      data: () => ({ id: 'lexeme-a' }),
    });

    const source = createMultilingualFirebaseSourcePort({ kind: 'database' } as never);
    const result = await source.fetchSources('owner-a', 25);

    expect(result).toEqual([{
      documentId: 'lexeme-a',
      learningState: { ownerId: 'owner-a' },
      lexeme: { id: 'lexeme-a' },
      memberships: [{ lexemeId: 'lexeme-a', editorialStatus: 'published' }],
    }]);
    expect(firestore.collection).toHaveBeenCalledWith(
      { kind: 'database' }, 'users', 'owner-a', 'learning_states',
    );
    expect(firestore.where).toHaveBeenCalledWith('editorialStatus', '==', 'published');
    expect(firestore.where).toHaveBeenCalledWith('schemaVersion', '==', 3);
    expect(firestore.limit).toHaveBeenCalledWith(25);
  });

  it('declares the composite index required by the published v3 membership query', () => {
    const indexes = JSON.parse(readFileSync(
      new URL('../../../firestore.indexes.json', import.meta.url),
      'utf8',
    )) as { indexes: Array<{ collectionGroup: string; fields: Array<{ fieldPath: string }> }> };
    const membershipIndex = indexes.indexes.find(index => (
      index.collectionGroup === 'track_memberships'
    ));

    expect(membershipIndex?.fields.map(field => field.fieldPath)).toEqual([
      'lexemeId',
      'editorialStatus',
      'schemaVersion',
    ]);
  });

  it('preserves a missing lexeme as null so the domain reader can quarantine it', async () => {
    firestore.getDocs
      .mockResolvedValueOnce({ docs: [document('lexeme-missing', { ownerId: 'owner-a' })] })
      .mockResolvedValueOnce({ docs: [] });
    firestore.getDoc.mockRejectedValue({ code: 'permission-denied' });

    const source = createMultilingualFirebaseSourcePort({ kind: 'database' } as never);
    await expect(source.fetchSources('owner-a', 10)).resolves.toEqual([{
      documentId: 'lexeme-missing',
      learningState: { ownerId: 'owner-a' },
      lexeme: null,
      memberships: [],
    }]);
  });

  it('propagates retryable catalog failures instead of misclassifying them as bad content', async () => {
    firestore.getDocs.mockResolvedValueOnce({
      docs: [document('lexeme-retry', { ownerId: 'owner-a' })],
    });
    firestore.getDoc.mockRejectedValue({ code: 'unavailable' });

    const source = createMultilingualFirebaseSourcePort({ kind: 'database' } as never);
    await expect(source.fetchSources('owner-a', 10)).rejects.toMatchObject({ code: 'unavailable' });
    expect(firestore.getDocs).toHaveBeenCalledTimes(1);
  });

  it('does not issue catalog queries for an empty owner state collection', async () => {
    firestore.getDocs.mockResolvedValueOnce({ docs: [] });

    const source = createMultilingualFirebaseSourcePort({ kind: 'database' } as never);
    await expect(source.fetchSources('owner-a', 10)).resolves.toEqual([]);
    expect(firestore.getDoc).not.toHaveBeenCalled();
    expect(firestore.getDocs).toHaveBeenCalledTimes(1);
  });
});
