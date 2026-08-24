import { beforeEach, describe, expect, it, vi } from 'vitest';

const firestore = vi.hoisted(() => ({ runTransaction: vi.fn() }));
const firebaseRuntime = vi.hoisted(() => ({
  app: { kind: 'app' },
  auth: { currentUser: { uid: 'owner-1' } as { uid: string } | null },
  isFirebaseConfigured: true,
  protectedFunctionsCapability: { available: true } as { available: boolean; reason?: string },
}));
const functionsRuntime = vi.hoisted(() => ({
  getFunctions: vi.fn(() => ({ region: 'asia-southeast1' })),
  httpsCallable: vi.fn(),
}));

vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  doc: vi.fn(),
  documentId: vi.fn(),
  endAt: vi.fn(),
  getCountFromServer: vi.fn(),
  getDocs: vi.fn(),
  getDocsFromServer: vi.fn(),
  getDoc: vi.fn(),
  limit: vi.fn(),
  onSnapshot: vi.fn(),
  orderBy: vi.fn(),
  query: vi.fn(),
  runTransaction: firestore.runTransaction,
  serverTimestamp: vi.fn(),
  setDoc: vi.fn(),
  startAfter: vi.fn(),
  startAt: vi.fn(),
  where: vi.fn(),
  writeBatch: vi.fn(),
}));

vi.mock('./firebase', () => firebaseRuntime);
vi.mock('firebase/functions', () => functionsRuntime);

import { applyCategoryDeltas, clearLibraryFacets } from './cardRepository';

describe('card repository library facets', () => {
  beforeEach(() => {
    firebaseRuntime.auth.currentUser = { uid: 'owner-1' };
    firebaseRuntime.protectedFunctionsCapability.available = true;
    functionsRuntime.getFunctions.mockClear();
    functionsRuntime.httpsCallable.mockReset();
    firestore.runTransaction.mockReset();
  });

  it('uses the authenticated callable without a client transaction', async () => {
    const callable = vi.fn().mockResolvedValue({ data: { categories: { IELTS: 2 }, complete: true } });
    functionsRuntime.httpsCallable.mockReturnValue(callable);

    await expect(applyCategoryDeltas({} as never, 'owner-1', { IELTS: 1 })).resolves.toEqual({
      categories: { IELTS: 2 }, complete: true,
    });
    expect(functionsRuntime.httpsCallable).toHaveBeenCalledWith(
      { region: 'asia-southeast1' },
      'updateLibraryFacets',
    );
    expect(callable).toHaveBeenCalledWith(expect.objectContaining({
      op: 'delta', opId: expect.any(String), delta: { IELTS: 1 },
    }));
    expect(firestore.runTransaction).not.toHaveBeenCalled();
  });

  it('does not call the service after the active owner changes', async () => {
    firebaseRuntime.auth.currentUser = { uid: 'other-owner' };
    await expect(applyCategoryDeltas({} as never, 'owner-1', { IELTS: 1 })).rejects.toMatchObject({
      kind: 'authentication', code: 'owner-mismatch',
    });
    expect(functionsRuntime.httpsCallable).not.toHaveBeenCalled();
  });

  it('uses the same callable for clear and rejects malformed responses', async () => {
    const callable = vi.fn().mockResolvedValue({ data: { categories: {}, complete: true, extra: true } });
    functionsRuntime.httpsCallable.mockReturnValue(callable);

    await expect(clearLibraryFacets({} as never, 'owner-1', 'clear-operation'))
      .rejects.toMatchObject({ code: 'failed-precondition' });
    expect(callable).toHaveBeenCalledWith({ op: 'clear', opId: 'clear-operation' });
  });
});
