import { beforeEach, describe, expect, it, vi } from 'vitest';

const firestore = vi.hoisted(() => ({
  getDocs: vi.fn(),
  getDoc: vi.fn(),
  setDoc: vi.fn(() => Promise.resolve()),
  runTransaction: vi.fn(),
  serverTimestamp: vi.fn(() => ({ type: 'server-timestamp' })),
}));

const firebaseRuntime = vi.hoisted(() => ({
  app: {},
  isFirebaseConfigured: true,
  protectedFunctionsCapability: {
    available: true,
    reason: 'app-check-unconfigured' as const,
  },
}));

const functionsRuntime = vi.hoisted(() => ({
  getFunctions: vi.fn(() => ({ region: 'asia-southeast1' })),
  httpsCallable: vi.fn(),
}));

vi.mock('firebase/firestore', () => ({
  collection: vi.fn((...args: unknown[]) => ({ type: 'collection', args })),
  doc: vi.fn((...args: unknown[]) => ({ type: 'doc', args })),
  documentId: vi.fn(() => 'documentId'),
  endAt: vi.fn((...args: unknown[]) => ({ type: 'endAt', args })),
  getCountFromServer: vi.fn(),
  getDocs: firestore.getDocs,
  getDocsFromServer: firestore.getDocs,
  getDoc: firestore.getDoc,
  getFirestore: vi.fn(() => ({})),
  initializeFirestore: vi.fn(() => ({})),
  limit: vi.fn((...args: unknown[]) => ({ type: 'limit', args })),
  onSnapshot: vi.fn(),
  orderBy: vi.fn((...args: unknown[]) => ({ type: 'orderBy', args })),
  persistentLocalCache: vi.fn(() => ({})),
  persistentMultipleTabManager: vi.fn(() => ({})),
  query: vi.fn((...args: unknown[]) => ({ type: 'query', args })),
  runTransaction: firestore.runTransaction,
  serverTimestamp: firestore.serverTimestamp,
  setDoc: firestore.setDoc,
  startAfter: vi.fn((...args: unknown[]) => ({ type: 'startAfter', args })),
  startAt: vi.fn((...args: unknown[]) => ({ type: 'startAt', args })),
  where: vi.fn((...args: unknown[]) => ({ type: 'where', args })),
  writeBatch: vi.fn(),
}));

vi.mock('./firebase', () => firebaseRuntime);

vi.mock('firebase/functions', () => ({
  getFunctions: functionsRuntime.getFunctions,
  httpsCallable: functionsRuntime.httpsCallable,
}));

import { CardMutationPreconditionError, bulkPatchCards } from './cardRepository';

beforeEach(() => {
  firestore.getDocs.mockReset();
  firestore.getDoc.mockReset();
  firestore.runTransaction.mockReset();
  firebaseRuntime.isFirebaseConfigured = true;
  firebaseRuntime.protectedFunctionsCapability.available = true;
  functionsRuntime.getFunctions.mockClear();
  functionsRuntime.httpsCallable.mockReset();
});

describe('bulkPatchCards', () => {
  it('patches every requested card through a single callable invocation', async () => {
    firestore.getDoc.mockResolvedValue({ exists: () => false });
    const callable = vi.fn().mockResolvedValueOnce({
      data: {
        results: [
          { cardId: 'card-1', op: 'patch', applied: true, revision: 1 },
          { cardId: 'card-2', op: 'patch', applied: true, revision: 4 },
          { cardId: 'card-3', op: 'patch', applied: true, revision: 9 },
        ],
      },
    });
    functionsRuntime.httpsCallable.mockReturnValue(callable);

    const result = await bulkPatchCards({} as never, 'user-1', [
      { cardId: 'card-1', baseRevision: 0, fields: { bookmarked: true }, fieldMask: ['bookmarked'] },
      { cardId: 'card-2', baseRevision: 3, fields: { bookmarked: true }, fieldMask: ['bookmarked'] },
      { cardId: 'card-3', baseRevision: 8, fields: { bookmarked: true }, fieldMask: ['bookmarked'] },
    ]);

    expect(functionsRuntime.httpsCallable).toHaveBeenCalledTimes(1);
    expect(callable).toHaveBeenCalledTimes(1);
    expect(callable).toHaveBeenCalledWith({
      libraryEpoch: 0,
      patches: [
        { cardId: 'card-1', baseRevision: 0, fields: { bookmarked: true }, fieldMask: ['bookmarked'] },
        { cardId: 'card-2', baseRevision: 3, fields: { bookmarked: true }, fieldMask: ['bookmarked'] },
        { cardId: 'card-3', baseRevision: 8, fields: { bookmarked: true }, fieldMask: ['bookmarked'] },
      ],
      deletes: [],
    });
    expect(result).toEqual({
      libraryEpoch: 0,
      outcomes: [
        { cardId: 'card-1', applied: true, revision: 1 },
        { cardId: 'card-2', applied: true, revision: 4 },
        { cardId: 'card-3', applied: true, revision: 9 },
      ],
    });
  });

  it('refreshes the library epoch and retries only the drifted cards', async () => {
    firestore.getDoc
      .mockResolvedValueOnce({ exists: () => true, data: () => ({ libraryEpoch: 1 }) })
      .mockResolvedValueOnce({ exists: () => true, data: () => ({ libraryEpoch: 2 }) });
    const callable = vi.fn()
      .mockResolvedValueOnce({
        data: {
          results: [
            { cardId: 'stable-card', op: 'patch', applied: true, revision: 5 },
            { cardId: 'drifted-card', op: 'patch', applied: false, reason: 'stale-library-epoch' },
          ],
        },
      })
      .mockResolvedValueOnce({
        data: { results: [{ cardId: 'drifted-card', op: 'patch', applied: true, revision: 6 }] },
      });
    functionsRuntime.httpsCallable.mockReturnValue(callable);

    const result = await bulkPatchCards({} as never, 'user-1', [
      { cardId: 'stable-card', baseRevision: 4, fields: { customDeck: 'Deck A' }, fieldMask: ['customDeck'] },
      { cardId: 'drifted-card', baseRevision: 2, fields: { customDeck: 'Deck A' }, fieldMask: ['customDeck'] },
    ]);

    expect(callable).toHaveBeenCalledTimes(2);
    expect(callable.mock.calls[0][0]).toMatchObject({ libraryEpoch: 1 });
    expect(callable.mock.calls[1][0]).toMatchObject({
      libraryEpoch: 2,
      patches: [{ cardId: 'drifted-card', baseRevision: 2, fields: { customDeck: 'Deck A' }, fieldMask: ['customDeck'] }],
    });
    expect(result).toEqual({
      libraryEpoch: 2,
      outcomes: [
        { cardId: 'stable-card', applied: true, revision: 5 },
        { cardId: 'drifted-card', applied: true, revision: 6 },
      ],
    });
  });

  it('rejects with a precondition error when the command epoch is ahead of the server', async () => {
    firestore.getDoc.mockResolvedValue({ exists: () => true, data: () => ({ libraryEpoch: 2 }) });
    const httpsError = Object.assign(new Error('failed-precondition'), {
      code: 'functions/failed-precondition',
      details: { reason: 'future-library-epoch' },
    });
    const callable = vi.fn().mockRejectedValueOnce(httpsError);
    functionsRuntime.httpsCallable.mockReturnValue(callable);

    await expect(bulkPatchCards({} as never, 'user-1', [
      { cardId: 'card-1', baseRevision: 0, fields: { bookmarked: false }, fieldMask: ['bookmarked'] },
    ])).rejects.toThrow('Card mutation rejected: future-library-epoch.');
    expect(callable).toHaveBeenCalledTimes(1);
  });

  it('rejects with a precondition error when a per-card result reports a future epoch', async () => {
    firestore.getDoc.mockResolvedValue({ exists: () => false });
    const callable = vi.fn().mockResolvedValueOnce({
      data: { results: [{ cardId: 'card-1', op: 'patch', applied: false, reason: 'future-library-epoch' }] },
    });
    functionsRuntime.httpsCallable.mockReturnValue(callable);

    await expect(bulkPatchCards({} as never, 'user-1', [
      { cardId: 'card-1', baseRevision: 0, fields: { bookmarked: false }, fieldMask: ['bookmarked'] },
    ])).rejects.toBeInstanceOf(CardMutationPreconditionError);
    expect(callable).toHaveBeenCalledTimes(1);
  });

  it('falls back to the single-card path when a card requires migration', async () => {
    firestore.getDoc.mockResolvedValue({ exists: () => false });
    const callable = vi.fn().mockResolvedValueOnce({
      data: {
        results: [
          { cardId: 'current-card', op: 'patch', applied: true, revision: 2 },
          { cardId: 'legacy-card', op: 'patch', applied: false, reason: 'requires-migration' },
        ],
      },
    });
    functionsRuntime.httpsCallable.mockReturnValue(callable);
    const set = vi.fn();
    firestore.runTransaction.mockImplementation(async (_db, callback) => callback({
      get: vi.fn(async (reference: { args?: unknown[] }) => {
        const path = reference.args?.at(-1);
        return path === 'library_state'
          ? { exists: () => true, data: () => ({ libraryEpoch: 0 }) }
          : {
              exists: () => true,
              data: () => ({
                id: 'legacy-card',
                word: 'legacy',
                translation: 'cũ',
                schemaVersion: 2,
                revision: 1,
                libraryEpoch: 0,
              }),
            };
      }),
      set,
    }));

    const result = await bulkPatchCards({} as never, 'user-1', [
      { cardId: 'current-card', baseRevision: 1, fields: { bookmarked: true }, fieldMask: ['bookmarked'] },
      { cardId: 'legacy-card', baseRevision: 1, fields: { bookmarked: true }, fieldMask: ['bookmarked'] },
    ]);

    expect(callable).toHaveBeenCalledTimes(1);
    expect(firestore.runTransaction).toHaveBeenCalledTimes(1);
    expect(result.outcomes).toEqual(
      expect.arrayContaining([
        { cardId: 'current-card', applied: true, revision: 2 },
        { cardId: 'legacy-card', applied: true, revision: 2 },
      ]),
    );
  });

  it('reports a revision conflict as a failed outcome without retrying', async () => {
    firestore.getDoc.mockResolvedValue({ exists: () => false });
    const callable = vi.fn().mockResolvedValueOnce({
      data: {
        results: [
          { cardId: 'card-1', op: 'patch', applied: false, reason: 'revision-conflict', currentRevision: 5 },
        ],
      },
    });
    functionsRuntime.httpsCallable.mockReturnValue(callable);

    const result = await bulkPatchCards({} as never, 'user-1', [
      { cardId: 'card-1', baseRevision: 2, fields: { customDeck: null }, fieldMask: ['customDeck'] },
    ]);

    expect(callable).toHaveBeenCalledTimes(1);
    expect(result.outcomes).toEqual([
      { cardId: 'card-1', applied: false, reason: 'revision-conflict', currentRevision: 5 },
    ]);
  });

  it('gives up after the epoch retry limit and reports the card as failed', async () => {
    firestore.getDoc.mockResolvedValue({ exists: () => true, data: () => ({ libraryEpoch: 0 }) });
    const callable = vi.fn().mockResolvedValue({
      data: { results: [{ cardId: 'card-1', op: 'patch', applied: false, reason: 'stale-library-epoch' }] },
    });
    functionsRuntime.httpsCallable.mockReturnValue(callable);

    const result = await bulkPatchCards({} as never, 'user-1', [
      { cardId: 'card-1', baseRevision: 0, fields: { bookmarked: true }, fieldMask: ['bookmarked'] },
    ]);

    expect(callable).toHaveBeenCalledTimes(3);
    expect(result.outcomes).toEqual([
      { cardId: 'card-1', applied: false, reason: 'revision-conflict' },
    ]);
  });
});
