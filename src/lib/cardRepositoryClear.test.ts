import { beforeEach, describe, expect, it, vi } from 'vitest';

const firebaseRuntime = vi.hoisted(() => ({
  app: { kind: 'app' },
  auth: { currentUser: { uid: 'owner-a' } as { uid: string } | null },
  isFirebaseConfigured: true,
  protectedFunctionsCapability: { available: true } as { available: boolean; reason?: string },
  getSonFlashFunctions: vi.fn(() => ({ kind: 'functions' })),
}));
const firestore = vi.hoisted(() => ({
  getDocs: vi.fn(),
  getDocsFromServer: vi.fn(),
}));
const functionsRuntime = vi.hoisted(() => ({ httpsCallable: vi.fn() }));

vi.mock('firebase/firestore', () => ({
  collection: vi.fn(() => ({ kind: 'collection' })),
  doc: vi.fn(),
  documentId: vi.fn(() => ({ kind: 'document-id' })),
  endAt: vi.fn(),
  getCountFromServer: vi.fn(),
  getDocs: firestore.getDocs,
  getDocsFromServer: firestore.getDocsFromServer,
  getDoc: vi.fn(),
  limit: vi.fn(),
  onSnapshot: vi.fn(),
  orderBy: vi.fn(),
  query: vi.fn(() => ({ kind: 'query' })),
  runTransaction: vi.fn(),
  serverTimestamp: vi.fn(),
  setDoc: vi.fn(),
  startAfter: vi.fn(),
  startAt: vi.fn(),
  where: vi.fn(),
}));
vi.mock('./firebase', () => firebaseRuntime);
vi.mock('firebase/functions', () => functionsRuntime);

import { deleteAllCards } from './cardRepository';

const page = (...ids: string[]) => ({
  empty: ids.length === 0,
  docs: ids.map(id => ({ id, data: () => ({ word: id }) })),
});

describe('deleteAllCards protected clear', () => {
  beforeEach(() => {
    firebaseRuntime.auth.currentUser = { uid: 'owner-a' };
    firestore.getDocs.mockReset();
    firestore.getDocsFromServer.mockReset();
    functionsRuntime.httpsCallable.mockReset();
  });

  it('lists from the server before asking the trusted callable to delete', async () => {
    const callable = vi.fn().mockResolvedValue({ data: { deletedCardIds: ['card-a'], deletedProjectionLexemeIds: [] } });
    functionsRuntime.httpsCallable.mockReturnValue(callable);
    firestore.getDocsFromServer.mockResolvedValue(page('card-a'));

    await deleteAllCards({} as never, 'owner-a', 3);

    expect(firestore.getDocsFromServer).toHaveBeenCalledOnce();
    expect(firestore.getDocs).not.toHaveBeenCalled();
    expect(callable).toHaveBeenCalledWith({ expectedOwnerId: 'owner-a', libraryEpoch: 3, cardIds: ['card-a'] });
  });

  it('does not report success from an empty cache when the server listing is unavailable', async () => {
    const callable = vi.fn();
    functionsRuntime.httpsCallable.mockReturnValue(callable);
    firestore.getDocs.mockResolvedValue(page());
    firestore.getDocsFromServer.mockRejectedValue(Object.assign(new Error('offline'), { code: 'unavailable' }));

    await expect(deleteAllCards({} as never, 'owner-a', 3)).rejects.toMatchObject({ kind: 'network', code: 'unavailable' });
    expect(callable).not.toHaveBeenCalled();
  });

  it('stops before constructing or invoking a callable when the active owner changed', async () => {
    firebaseRuntime.auth.currentUser = { uid: 'owner-b' };

    await expect(deleteAllCards({} as never, 'owner-a', 3)).rejects.toMatchObject({
      kind: 'authentication', code: 'owner-mismatch',
    });
    expect(functionsRuntime.httpsCallable).not.toHaveBeenCalled();
    expect(firestore.getDocsFromServer).not.toHaveBeenCalled();
  });

  it('retries a transaction-size rejection in smaller atomic callable pages', async () => {
    const callable = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error('Clear library page is too large.'), {
        code: 'functions/resource-exhausted', details: { reason: 'transaction-too-large' },
      }))
      .mockResolvedValue({ data: { deletedCardIds: [], deletedProjectionLexemeIds: [] } });
    functionsRuntime.httpsCallable.mockReturnValue(callable);
    firestore.getDocsFromServer.mockResolvedValue(page('card-a', 'card-b'));

    await deleteAllCards({} as never, 'owner-a', 3);

    expect(callable.mock.calls.map(([request]) => request.cardIds)).toEqual([
      ['card-a', 'card-b'], ['card-a'], ['card-b'],
    ]);
  });
});
