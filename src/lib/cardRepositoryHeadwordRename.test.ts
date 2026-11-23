import { beforeEach, describe, expect, it, vi } from 'vitest';

const firebaseRuntime = vi.hoisted(() => ({
  app: { kind: 'app' },
  auth: { currentUser: { uid: 'owner-a' } as { uid: string } | null },
  isFirebaseConfigured: true,
  protectedFunctionsCapability: { available: true } as { available: boolean; reason?: string },
  getSonFlashFunctions: vi.fn(async () => ({ kind: 'functions' })),
}));
const functionsRuntime = vi.hoisted(() => ({ httpsCallable: vi.fn() }));

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
  runTransaction: vi.fn(),
  serverTimestamp: vi.fn(),
  setDoc: vi.fn(),
  startAfter: vi.fn(),
  startAt: vi.fn(),
  where: vi.fn(),
}));
vi.mock('./firebase', () => firebaseRuntime);
vi.mock('firebase/functions', () => functionsRuntime);

import { renameCardHeadword } from './cardRepository';

const renamedCard = {
  id: 'word-hello', word: 'Goodbye', normalizedWord: 'goodbye', translation: 'tạm biệt',
  schemaVersion: 2, revision: 2, libraryEpoch: 0,
};

describe('renameCardHeadword', () => {
  beforeEach(() => {
    firebaseRuntime.auth.currentUser = { uid: 'owner-a' };
    firebaseRuntime.getSonFlashFunctions.mockReset().mockResolvedValue({ kind: 'functions' });
    functionsRuntime.httpsCallable.mockReset();
  });

  it('names the account the rename was prepared for in the request', async () => {
    const callable = vi.fn().mockResolvedValue({ data: { card: renamedCard } });
    functionsRuntime.httpsCallable.mockReturnValue(callable);

    await renameCardHeadword('owner-a', 'word-hello', 'Goodbye', 1, 0);

    expect(callable).toHaveBeenCalledWith({
      cardId: 'word-hello', word: 'Goodbye', baseRevision: 1, libraryEpoch: 0, expectedOwnerId: 'owner-a',
    });
  });

  it('does not call the service when another account signs in while the service loads', async () => {
    const callable = vi.fn();
    functionsRuntime.httpsCallable.mockReturnValue(callable);
    firebaseRuntime.getSonFlashFunctions.mockImplementation(async () => {
      firebaseRuntime.auth.currentUser = { uid: 'owner-b' };
      return { kind: 'functions' };
    });

    await expect(renameCardHeadword('owner-a', 'word-hello', 'Goodbye', 1, 0)).rejects.toMatchObject({
      kind: 'authentication', code: 'owner-mismatch',
    });
    expect(callable).not.toHaveBeenCalled();
  });
});
