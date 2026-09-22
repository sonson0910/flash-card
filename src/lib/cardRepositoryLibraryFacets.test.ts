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

class MemoryStorage {
  private readonly values = new Map<string, string>();
  failWrites = false;

  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) {
    if (this.failWrites) throw new Error('quota');
    this.values.set(key, value);
  }
  removeItem(key: string) { this.values.delete(key); }
}

let storage: MemoryStorage;

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
    storage = new MemoryStorage();
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
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
      op: 'delta', ownerId: 'owner-1', opId: expect.stringMatching(/^v2:/),
      operationCreatedAt: expect.any(String), delta: { IELTS: 1 },
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

  it('binds a stable caller operation ID across separate invocations', async () => {
    const callable = vi.fn().mockResolvedValue({ data: { categories: { IELTS: 2 }, complete: true } });
    functionsRuntime.httpsCallable.mockReturnValue(callable);

    await applyCategoryDeltas({} as never, 'owner-1', { IELTS: 1 }, 'derived-create-operation');
    const first = callable.mock.calls[0][0];
    await applyCategoryDeltas({} as never, 'owner-1', { IELTS: 1 }, 'derived-create-operation');

    const second = callable.mock.calls[1][0];
    expect(first).toMatchObject({
      op: 'delta', ownerId: 'owner-1', opId: expect.stringMatching(/^v2:/), delta: { IELTS: 1 },
      operationCreatedAt: expect.any(String),
    });
    expect(second).toEqual(first);
  });

  it('retains operation identity beyond 256 later operations within the receipt window', async () => {
    const callable = vi.fn().mockResolvedValue({ data: { categories: { IELTS: 2 }, complete: true } });
    functionsRuntime.httpsCallable.mockReturnValue(callable);
    await applyCategoryDeltas({} as never, 'owner-1', { IELTS: 1 }, 'operation-0');
    const first = callable.mock.calls[0][0];

    for (let index = 1; index <= 256; index += 1) {
      await applyCategoryDeltas({} as never, 'owner-1', { IELTS: 1 }, `operation-${index}`);
    }
    await applyCategoryDeltas({} as never, 'owner-1', { IELTS: 1 }, 'operation-0');

    expect(callable.mock.calls.at(-1)?.[0]).toEqual(first);
  });

  it('keeps a facet operation timestamp after a module reload', async () => {
    const callable = vi.fn().mockResolvedValue({ data: { categories: { IELTS: 2 }, complete: true } });
    functionsRuntime.httpsCallable.mockReturnValue(callable);
    await applyCategoryDeltas({} as never, 'owner-1', { IELTS: 1 }, 'derived-delete-operation');
    const first = callable.mock.calls[0][0];

    vi.resetModules();
    const reloaded = await import('./cardRepository');
    await reloaded.applyCategoryDeltas({} as never, 'owner-1', { IELTS: 1 }, 'derived-delete-operation');

    expect(callable.mock.calls[1][0]).toEqual(first);
  });

  it('prunes expired operation times and clears corrupt operation storage safely', async () => {
    const callable = vi.fn().mockResolvedValue({ data: { categories: { IELTS: 2 }, complete: true } });
    functionsRuntime.httpsCallable.mockReturnValue(callable);
    await applyCategoryDeltas({} as never, 'owner-1', { IELTS: 1 });
    const expired = callable.mock.calls[0][0];
    storage.setItem('lingoflash_library_facet_operation_times_v1', JSON.stringify([
      { logicalOperationId: 'expired-operation', opId: expired.opId, operationCreatedAt: '2020-01-01T00:00:00.000Z' },
    ]));
    await expect(applyCategoryDeltas({} as never, 'owner-1', { IELTS: 1 }, expired.opId))
      .rejects.toThrow('timestamp is unavailable');

    storage.setItem('lingoflash_library_facet_operation_times_v1', '{not-json');
    await expect(applyCategoryDeltas({} as never, 'owner-1', { IELTS: 1 }, expired.opId))
      .rejects.toThrow('timestamp is unavailable');
    expect(storage.getItem('lingoflash_library_facet_operation_times_v1')).toBeNull();
  });

  it('does not call the server until a V2 operation pair is durably stored', async () => {
    const callable = vi.fn().mockResolvedValue({ data: { categories: { IELTS: 2 }, complete: true } });
    functionsRuntime.httpsCallable.mockReturnValue(callable);
    storage.failWrites = true;

    await expect(applyCategoryDeltas({} as never, 'owner-1', { IELTS: 1 }, 'storage-retry-operation'))
      .rejects.toThrow('could not be stored safely');
    expect(callable).not.toHaveBeenCalled();

    storage.failWrites = false;
    await applyCategoryDeltas({} as never, 'owner-1', { IELTS: 1 }, 'storage-retry-operation');
    expect(callable).toHaveBeenCalledOnce();
    expect(callable).toHaveBeenCalledWith(expect.objectContaining({
      opId: expect.stringMatching(/^v2:/), operationCreatedAt: expect.any(String),
    }));
  });

  it('rejects a callable response after the auth owner switches during invocation', async () => {
    const callable = vi.fn(async (request: { ownerId: string }) => {
      firebaseRuntime.auth.currentUser = { uid: 'other-owner' };
      if (request.ownerId !== firebaseRuntime.auth.currentUser?.uid) {
        throw Object.assign(new Error('owner changed'), { code: 'permission-denied' });
      }
      return { data: { categories: { IELTS: 2 }, complete: true } };
    });
    functionsRuntime.httpsCallable.mockReturnValue(callable);

    await expect(applyCategoryDeltas({} as never, 'owner-1', { IELTS: 1 }, 'switch-operation'))
      .rejects.toMatchObject({ kind: 'permission', code: 'permission-denied' });
    expect(callable).toHaveBeenCalledWith(expect.objectContaining({ ownerId: 'owner-1' }));
  });

  it('uses the same callable for clear and rejects malformed responses', async () => {
    const callable = vi.fn().mockResolvedValue({ data: { categories: {}, complete: true, extra: true } });
    functionsRuntime.httpsCallable.mockReturnValue(callable);

    await expect(clearLibraryFacets({} as never, 'owner-1', 'derived-clear-operation'))
      .rejects.toMatchObject({ code: 'failed-precondition' });
    expect(callable).toHaveBeenCalledWith(expect.objectContaining({
      op: 'clear', ownerId: 'owner-1', opId: expect.stringMatching(/^v2:/), operationCreatedAt: expect.any(String),
    }));
  });
});
