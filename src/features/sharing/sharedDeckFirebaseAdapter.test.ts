import { beforeEach, describe, expect, it, vi } from 'vitest';

const firestore = vi.hoisted(() => ({
  doc: vi.fn((_database: unknown, ...path: string[]) => ({ path: path.join('/') })),
  getDoc: vi.fn(),
}));

vi.mock('firebase/firestore', () => firestore);
vi.mock('./sharedDeckService', () => ({
  createSharedDeckShare: vi.fn(),
  revokeSharedDeckShare: vi.fn(),
}));

import { createSharedDeckFirebaseAdapter } from './sharedDeckFirebaseAdapter';

describe('shared deck Firebase adapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    firestore.getDoc.mockResolvedValue({ exists: () => true, data: () => ({ schemaVersion: 2 }) });
  });

  it('prepares the public read before it reaches Firestore', async () => {
    const beforeRead = vi.fn();
    const adapter = createSharedDeckFirebaseAdapter({
      app: null,
      database: { kind: 'database' } as never,
      configured: true,
      beforeRead,
    });

    await expect(adapter.load('share-1')).resolves.toEqual({ schemaVersion: 2 });

    expect(beforeRead).toHaveBeenCalledOnce();
    expect(beforeRead.mock.invocationCallOrder[0]).toBeLessThan(firestore.getDoc.mock.invocationCallOrder[0]);
    expect(firestore.doc).toHaveBeenCalledWith({ kind: 'database' }, 'shared_decks', 'share-1');
  });

  it('does not prepare anything when shared-deck storage is unavailable', async () => {
    const beforeRead = vi.fn();
    const adapter = createSharedDeckFirebaseAdapter({ app: null, database: null, configured: true, beforeRead });

    await expect(adapter.load('share-1')).rejects.toThrow('Shared-deck storage is unavailable.');
    expect(beforeRead).not.toHaveBeenCalled();
  });
});
