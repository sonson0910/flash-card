import { beforeEach, describe, expect, it, vi } from 'vitest';

const firestore = vi.hoisted(() => ({
  collection: vi.fn((_db: unknown, ...path: string[]) => ({ kind: 'collection', path: path.join('/') })),
  doc: vi.fn((_db: unknown, ...path: string[]) => ({ kind: 'doc', path: path.join('/') })),
  getCountFromServer: vi.fn(),
  query: vi.fn((source: unknown, ...constraints: unknown[]) => ({ kind: 'query', source, constraints })),
  setDoc: vi.fn(),
  where: vi.fn((field: string, op: string, value: unknown) => ({ field, op, value })),
}));
const repository = vi.hoisted(() => ({ getLegacyCardQueryMigrationProgress: vi.fn() }));

vi.mock('firebase/firestore', () => ({
  FieldPath: class {},
  arrayRemove: vi.fn(),
  collection: firestore.collection,
  deleteField: vi.fn(),
  doc: firestore.doc,
  getCountFromServer: firestore.getCountFromServer,
  onSnapshot: vi.fn(),
  query: firestore.query,
  runTransaction: vi.fn(),
  setDoc: firestore.setDoc,
  updateDoc: vi.fn(),
  where: firestore.where,
}));
vi.mock('../../lib/cardRepository', () => ({
  clearCustomDeckAssignments: vi.fn(),
  getLegacyCardQueryMigrationProgress: repository.getLegacyCardQueryMigrationProgress,
}));
vi.mock('./legacyLibraryMigrationService', () => ({ migrateLegacyLibraryWithAdmin: vi.fn() }));

import { createOwnerLibrarySessionFirebaseAdapter } from './ownerLibrarySessionFirebaseAdapter';

const counts = (all: number, current: number) => firestore.getCountFromServer.mockImplementation(async (target: { kind: string }) => ({
  data: () => ({ count: target.kind === 'query' ? current : all }),
}));
const createAdapter = () => createOwnerLibrarySessionFirebaseAdapter({
  app: null, database: {} as never, configured: true,
});

describe('owner library session Firebase adapter legacy progress', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    firestore.setDoc.mockResolvedValue(undefined);
    repository.getLegacyCardQueryMigrationProgress.mockResolvedValue({ scanned: 0, complete: false });
  });

  it('reports a library of current cards as upgraded when no progress document exists', async () => {
    counts(5, 5);

    await expect(createAdapter().getLegacyMigrationProgress('owner-a')).resolves.toEqual({ scanned: 0, complete: true });

    expect(firestore.where).toHaveBeenCalledWith('schemaVersion', '==', 2);
    expect(firestore.setDoc).toHaveBeenCalledTimes(1);
    expect(firestore.setDoc).toHaveBeenCalledWith(
      { kind: 'doc', path: 'users/owner-a/profile/query_migration' },
      expect.objectContaining({ migrationVersion: 2, lastDocumentId: null, complete: true, scanned: 0 }),
    );
  });

  it('reports the exact number of cards that are not in the current shape', async () => {
    counts(5, 3);

    await expect(createAdapter().getLegacyMigrationProgress('owner-a')).resolves.toEqual({
      scanned: 0, complete: false, pending: 2,
    });
    expect(firestore.setDoc).not.toHaveBeenCalled();
  });

  it('does not count cards again once the progress document is complete', async () => {
    repository.getLegacyCardQueryMigrationProgress.mockResolvedValue({ scanned: 4, complete: true });

    await expect(createAdapter().getLegacyMigrationProgress('owner-a')).resolves.toEqual({ scanned: 4, complete: true });

    expect(firestore.getCountFromServer).not.toHaveBeenCalled();
    expect(firestore.setDoc).not.toHaveBeenCalled();
  });

  it('keeps the library usable when the completion note is refused', async () => {
    counts(2, 2);
    firestore.setDoc.mockRejectedValue(Object.assign(new Error('denied'), { code: 'permission-denied' }));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect(createAdapter().getLegacyMigrationProgress('owner-a')).resolves.toEqual({ scanned: 0, complete: true });
    warn.mockRestore();
  });

  it('falls back to the stored progress when the count is unavailable', async () => {
    firestore.getCountFromServer.mockRejectedValue(new Error('offline'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect(createAdapter().getLegacyMigrationProgress('owner-a')).resolves.toEqual({ scanned: 0, complete: false });
    expect(firestore.setDoc).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
