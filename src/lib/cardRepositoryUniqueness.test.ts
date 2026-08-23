import { beforeEach, describe, expect, it, vi } from 'vitest';

const firestore = vi.hoisted(() => ({
  getDocs: vi.fn(),
  getDoc: vi.fn(),
  setDoc: vi.fn(() => Promise.resolve()),
  runTransaction: vi.fn(),
  serverTimestamp: vi.fn(() => ({ type: 'server-timestamp' })),
  transactionSet: vi.fn(),
}));

const firebaseRuntime = vi.hoisted(() => ({
  app: {},
  isFirebaseConfigured: false,
  protectedFunctionsCapability: {
    available: false,
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

import {
  CardMutationPreconditionError,
  createCardIfAbsent,
  applyCardPatchIfCurrent,
  clearCustomDeckAssignments,
  deleteCardWithTombstone,
  findCardByNormalizedWord,
  findCardsByNormalizedWords,
  getLegacyCardQueryMigrationProgress,
  getLibraryEpoch,
  incrementLibraryEpoch,
  migrateLegacyCardQueryFields,
  streamAllCardsInBatches,
} from './cardRepository';

const snapshot = (documents: Array<{ id: string; data: Record<string, unknown> }>) => ({
  empty: documents.length === 0,
  docs: documents.map(document => ({
    id: document.id,
    ref: { id: document.id },
    data: () => document.data,
  })),
});

beforeEach(() => {
  firebaseRuntime.isFirebaseConfigured = false;
  firebaseRuntime.protectedFunctionsCapability.available = false;
  functionsRuntime.getFunctions.mockClear();
  functionsRuntime.httpsCallable.mockReset();
});

describe('findCardByNormalizedWord', () => {
  beforeEach(() => {
    firestore.getDocs.mockReset();
    firestore.getDoc.mockReset();
    firestore.setDoc.mockClear();
    firestore.runTransaction.mockReset();
    firestore.transactionSet.mockReset();
    firestore.getDoc.mockResolvedValue({ exists: () => false });
    firestore.runTransaction.mockImplementation(async (_db, callback) => callback({
      get: vi.fn(async (reference: { args?: unknown[] }) => {
        const path = reference.args?.at(-1);
        const collectionName = reference.args?.at(-2);
        if (path === 'library_state' || collectionName === 'card_reservations') {
          return { exists: (): boolean => false };
        }
        return {
          exists: (): boolean => true,
          data: () => ({
            id: 'legacy-hidden',
            word: 'opportunity',
            translation: 'cơ hội',
            revision: 0,
          }),
        };
      }),
      set: firestore.transactionSet,
    }));
  });

  it('finds and indexes a legacy card outside the loaded page', async () => {
    firestore.getDocs
      .mockResolvedValueOnce(snapshot([]))
      .mockResolvedValueOnce(snapshot([{
        id: 'legacy-hidden',
        data: {
          word: 'opportunity',
          translation: 'cơ hội',
          explanation: '',
          category: 'Test',
        },
      }]));

    const result = await findCardByNormalizedWord({} as never, 'user-1', 'OPPORTUNITY');

    expect(result?.id).toBe('legacy-hidden');
    expect(firestore.setDoc).not.toHaveBeenCalled();
    expect(firestore.transactionSet).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        id: 'legacy-hidden',
        normalizedWord: 'opportunity',
        schemaVersion: 2,
      }),
      { merge: false },
    );
  });

  it('does not full-scan the collection when both indexed lookups miss', async () => {
    firestore.getDocs
      .mockResolvedValueOnce(snapshot([]))
      .mockResolvedValueOnce(snapshot([]))
      .mockResolvedValueOnce(snapshot([{
        id: 'unrelated-full-scan-result',
        data: {
          word: 'reasonable',
          translation: 'hợp lý',
          explanation: '',
          category: 'Test',
        },
      }]));

    await expect(findCardByNormalizedWord({} as never, 'user-1', 'brand new word'))
      .resolves.toBeNull();
    expect(firestore.getDocs).toHaveBeenCalledTimes(2);
  });

  it('selects the existing card with learning progress when duplicates already exist', async () => {
    firestore.getDocs.mockResolvedValueOnce(snapshot([
      {
        id: 'older',
        data: {
          word: 'chance',
          normalizedWord: 'chance',
          translation: 'cơ hội',
          explanation: '',
          category: 'Test',
          libraryEpoch: 0,
          difficulty: 'unrated',
          reviewHistory: [],
        },
      },
      {
        id: 'reviewed',
        data: {
          word: 'chance',
          normalizedWord: 'chance',
          translation: 'khả năng',
          explanation: '',
          category: 'Test',
          libraryEpoch: 0,
          difficulty: 'good',
          reviewHistory: [{ rating: 'good', reviewedAt: '2026-01-01T00:00:00.000Z' }],
        },
      },
    ]));

    await expect(findCardByNormalizedWord({} as never, 'user-1', 'chance'))
      .resolves.toMatchObject({ id: 'reviewed' });
    expect(firestore.getDocs).toHaveBeenCalledTimes(1);
  });

  it('ignores a normalized-word match from an older explicit library generation', async () => {
    firestore.getDocs
      .mockResolvedValueOnce(snapshot([{
        id: 'old-generation',
        data: {
          word: 'chance',
          normalizedWord: 'chance',
          translation: 'cũ',
          libraryEpoch: 1,
          revision: 4,
        },
      }]))
      .mockResolvedValueOnce(snapshot([]));

    await expect(findCardByNormalizedWord(
      {} as never,
      'user-1',
      'chance',
      2,
    )).resolves.toBeNull();
    expect(firestore.getDocs).toHaveBeenCalledTimes(1);
  });

  it('filters the active library epoch on the server before applying a bounded limit', async () => {
    firestore.getDocs.mockResolvedValueOnce(snapshot([{
      id: 'current-generation',
      data: {
        word: 'chance',
        normalizedWord: 'chance',
        translation: 'cơ hội',
        libraryEpoch: 4,
        revision: 2,
      },
    }]));

    await expect(findCardByNormalizedWord(
      {} as never,
      'user-1',
      'chance',
      4,
    )).resolves.toMatchObject({ id: 'current-generation' });
    expect(firestore.getDocs).toHaveBeenCalledWith(expect.objectContaining({
      args: [
        expect.anything(),
        expect.objectContaining({
          type: 'where',
          args: ['normalizedWord', '==', 'chance'],
        }),
        expect.objectContaining({
          type: 'where',
          args: ['libraryEpoch', '==', 4],
        }),
        expect.objectContaining({ type: 'limit', args: [20] }),
      ],
    }));
  });

  it('does not let stale documents consume the query limit and hide a current card', async () => {
    firestore.getDocs.mockImplementation(async (request: {
      args?: Array<{ type?: string; args?: unknown[] }>;
    }) => {
      const filtersCurrentEpoch = request.args?.some(constraint =>
        constraint.type === 'where'
        && constraint.args?.[0] === 'libraryEpoch'
        && constraint.args?.[1] === '=='
        && constraint.args?.[2] === 2);
      if (filtersCurrentEpoch) {
        return snapshot([{
          id: 'current-card',
          data: {
            word: 'chance',
            normalizedWord: 'chance',
            translation: 'hiện tại',
            libraryEpoch: 2,
            revision: 1,
          },
        }]);
      }
      return snapshot(Array.from({ length: 20 }, (_, index) => ({
        id: `stale-${index}`,
        data: {
          word: 'chance',
          normalizedWord: 'chance',
          translation: 'cũ',
          libraryEpoch: 1,
          revision: index + 1,
        },
      })));
    });

    await expect(findCardByNormalizedWord(
      {} as never,
      'user-1',
      'chance',
      2,
    )).resolves.toMatchObject({ id: 'current-card' });
    expect(firestore.getDocs).toHaveBeenCalledTimes(1);
  });

  it('never falls back to or repairs epochless cards after epoch zero', async () => {
    firestore.getDocs
      .mockResolvedValueOnce(snapshot([]))
      .mockResolvedValueOnce(snapshot([{
        id: 'legacy-chance',
        data: {
          word: 'chance',
          translation: 'cơ hội cũ',
          revision: 5,
        },
      }]));

    await expect(findCardByNormalizedWord(
      {} as never,
      'user-1',
      'chance',
      3,
    )).resolves.toBeNull();
    expect(firestore.getDocs).toHaveBeenCalledTimes(1);
    expect(firestore.transactionSet).not.toHaveBeenCalled();
  });

  it('prefers an explicit epoch-zero card over an epochless duplicate', async () => {
    firestore.getDocs.mockResolvedValueOnce(snapshot([
      {
        id: 'current-card',
        data: {
          word: 'chance',
          normalizedWord: 'chance',
          translation: 'hiện tại',
          libraryEpoch: 0,
          revision: 1,
          difficulty: 'unrated',
          reviewHistory: [],
        },
      },
      {
        id: 'legacy-reviewed-card',
        data: {
          word: 'chance',
          normalizedWord: 'chance',
          translation: 'cũ',
          revision: 8,
          difficulty: 'good',
          reviewHistory: [{ rating: 'good', reviewedAt: '2026-01-01T00:00:00.000Z' }],
        },
      },
    ]));

    await expect(findCardByNormalizedWord(
      {} as never,
      'user-1',
      'chance',
      0,
    )).resolves.toMatchObject({ id: 'current-card' });
  });
});

describe('streamAllCardsInBatches', () => {
  beforeEach(() => {
    firestore.getDocs.mockReset();
  });

  it('streams at most 100 cards at a time without returning the full collection', async () => {
    firestore.getDocs
      .mockResolvedValueOnce(snapshot(Array.from({ length: 100 }, (_, index) => ({
        id: `batch-a-${index}`,
        data: {
          word: `word ${index}`,
          translation: `translation ${index}`,
          explanation: '',
          category: 'Test',
        },
      }))))
      .mockResolvedValueOnce(snapshot(Array.from({ length: 5 }, (_, index) => ({
        id: `batch-b-${index}`,
        data: {
          word: `tail ${index}`,
          translation: `tail translation ${index}`,
          explanation: '',
          category: 'Test',
        },
      }))));
    const batches: number[] = [];

    const loaded = await streamAllCardsInBatches(
      {} as never,
      'user-1',
      async batch => { batches.push(batch.length); },
    );

    expect(batches).toEqual([100, 5]);
    expect(loaded).toBe(105);
  });
});

describe('findCardsByNormalizedWords', () => {
  beforeEach(() => {
    firestore.getDocs.mockReset();
    firestore.getDoc.mockReset();
    firestore.setDoc.mockClear();
    firestore.runTransaction.mockReset();
    firestore.transactionSet.mockReset();
    firestore.getDoc.mockResolvedValue({ exists: () => false });
    firestore.runTransaction.mockImplementation(async (_db, callback) => callback({
      get: vi.fn(async (reference: { args?: unknown[] }) => {
        const path = reference.args?.at(-1);
        const collectionName = reference.args?.at(-2);
        if (path === 'library_state' || collectionName === 'card_reservations') {
          return { exists: (): boolean => false };
        }
        return {
          exists: (): boolean => true,
          data: () => ({
            id: 'legacy-uppercase',
            word: 'OPPORTUNITY',
            translation: 'cơ hội',
            revision: 0,
          }),
        };
      }),
      set: firestore.transactionSet,
    }));
  });

  it('uses only bounded indexed queries when a new import word is absent', async () => {
    firestore.getDocs
      .mockResolvedValueOnce(snapshot([]))
      .mockResolvedValueOnce(snapshot([]))
      .mockResolvedValueOnce(snapshot([{
        id: 'must-not-be-full-scanned',
        data: { word: 'new term', translation: 'từ mới' },
      }]));

    await expect(findCardsByNormalizedWords({} as never, 'user-1', ['new term']))
      .resolves.toEqual(new Map());
    expect(firestore.getDocs).toHaveBeenCalledTimes(2);
    expect(firestore.getDocs.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
      args: expect.arrayContaining([
        expect.objectContaining({
          type: 'where',
          args: ['libraryEpoch', '==', 0],
        }),
        expect.objectContaining({ type: 'limit', args: [expect.any(Number)] }),
      ]),
    }));
    expect(firestore.getDocs.mock.calls[1]?.[0]).toEqual(expect.objectContaining({
      args: expect.arrayContaining([
        expect.objectContaining({ type: 'limit', args: [expect.any(Number)] }),
      ]),
    }));
  });

  it('keeps only current or legacy candidates when batch lookup has explicit generations', async () => {
    firestore.getDocs
      .mockResolvedValueOnce(snapshot([
        {
          id: 'old-apple',
          data: {
            word: 'apple',
            normalizedWord: 'apple',
            translation: 'táo cũ',
            libraryEpoch: 1,
            revision: 4,
          },
        },
        {
          id: 'current-pear',
          data: {
            word: 'pear',
            normalizedWord: 'pear',
            translation: 'lê',
            libraryEpoch: 2,
            revision: 1,
          },
        },
      ]))
      .mockResolvedValueOnce(snapshot([]));

    const matches = await findCardsByNormalizedWords(
      {} as never,
      'user-1',
      ['apple', 'pear'],
      2,
    );

    expect([...matches.keys()]).toEqual(['pear']);
  });

  it('does not query or repair epochless batch candidates after epoch zero', async () => {
    firestore.getDocs
      .mockResolvedValueOnce(snapshot([]))
      .mockResolvedValueOnce(snapshot([{
        id: 'legacy-apple',
        data: {
          word: 'apple',
          translation: 'táo cũ',
          revision: 4,
        },
      }]));

    await expect(findCardsByNormalizedWords(
      {} as never,
      'user-1',
      ['apple'],
      2,
    )).resolves.toEqual(new Map());
    expect(firestore.getDocs).toHaveBeenCalledTimes(1);
    expect(firestore.transactionSet).not.toHaveBeenCalled();
  });

  it('prefers an explicit epoch-zero batch match over an epochless duplicate', async () => {
    firestore.getDocs.mockResolvedValueOnce(snapshot([
      {
        id: 'current-apple',
        data: {
          word: 'apple',
          normalizedWord: 'apple',
          translation: 'táo',
          libraryEpoch: 0,
          revision: 1,
          difficulty: 'unrated',
          reviewHistory: [],
        },
      },
      {
        id: 'legacy-reviewed-apple',
        data: {
          word: 'apple',
          normalizedWord: 'apple',
          translation: 'táo cũ',
          revision: 9,
          difficulty: 'good',
          reviewHistory: [{ rating: 'good', reviewedAt: '2026-01-01T00:00:00.000Z' }],
        },
      },
    ]));

    const matches = await findCardsByNormalizedWords(
      {} as never,
      'user-1',
      ['apple'],
      0,
    );

    expect(matches.get('apple')?.id).toBe('current-apple');
  });

  it('finds a bounded legacy casing variant without performing an unsafe client identity claim', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    firestore.getDocs
      .mockResolvedValueOnce(snapshot([]))
      .mockResolvedValueOnce(snapshot([{
        id: 'legacy-uppercase',
        data: { word: 'OPPORTUNITY', translation: 'cơ hội' },
      }]));

    const result = await findCardsByNormalizedWords({} as never, 'user-1', ['opportunity']);

    expect(result.get('opportunity')?.id).toBe('legacy-uppercase');
    expect(firestore.getDocs).toHaveBeenCalledTimes(2);
    expect(firestore.setDoc).not.toHaveBeenCalled();
    expect(firestore.transactionSet).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      'A legacy card was found but its search identity could not be repaired.',
      expect.objectContaining({ reason: 'identity-conflict' }),
    );
    warn.mockRestore();
  });
});

describe('createCardIfAbsent', () => {
  beforeEach(() => {
    firestore.runTransaction.mockReset();
  });

  const candidate = {
    id: 'temporary',
    word: 'Quite',
    normalizedWord: 'quite',
    translation: 'khá',
    explanation: '',
    phonetic: '',
    emoji: '📝',
    category: 'Other',
    audioUrl: null,
    imageUrl: null,
  };

  const callableCard = {
    ...candidate,
    id: 'word-quite',
    schemaVersion: 2,
    revision: 1,
    libraryEpoch: 4,
    createdAt: '2026-08-23T00:00:00.000Z',
  };

  it('fails closed when Firebase is configured but protected functions are unavailable', async () => {
    firebaseRuntime.isFirebaseConfigured = true;
    firebaseRuntime.protectedFunctionsCapability.available = false;

    await expect(createCardIfAbsent({} as never, 'user-1', candidate, {
      libraryEpoch: 4,
    })).rejects.toMatchObject({
      kind: 'configuration',
      code: 'app-check-unconfigured',
    });
    expect(firestore.runTransaction).not.toHaveBeenCalled();
    expect(functionsRuntime.httpsCallable).not.toHaveBeenCalled();
  });

  it('uses the protected callable and forwards the card mutation protocol', async () => {
    firebaseRuntime.isFirebaseConfigured = true;
    firebaseRuntime.protectedFunctionsCapability.available = true;
    const callable = vi.fn().mockResolvedValue({
      data: { created: true, card: callableCard },
    });
    functionsRuntime.httpsCallable.mockReturnValue(callable);

    await expect(createCardIfAbsent({} as never, 'user-1', candidate, {
      libraryEpoch: 4,
      baseRevision: 2,
      opId: 'create-quite-1',
      operationCreatedAt: '2026-08-23T00:00:00.000Z',
    })).resolves.toMatchObject({
      created: true,
      card: { id: 'word-quite', normalizedWord: 'quite', libraryEpoch: 4 },
    });
    expect(functionsRuntime.getFunctions).toHaveBeenCalledWith(firebaseRuntime.app, 'asia-southeast1');
    expect(functionsRuntime.httpsCallable).toHaveBeenCalledWith(
      { region: 'asia-southeast1' },
      'createCard',
    );
    expect(callable).toHaveBeenCalledWith({
      card: candidate,
      libraryEpoch: 4,
      baseRevision: 2,
      opId: 'create-quite-1',
      operationCreatedAt: '2026-08-23T00:00:00.000Z',
    });
  });

  it('rejects callable responses containing Firestore timestamps', async () => {
    firebaseRuntime.isFirebaseConfigured = true;
    firebaseRuntime.protectedFunctionsCapability.available = true;
    functionsRuntime.httpsCallable.mockReturnValue(vi.fn().mockResolvedValue({
      data: {
        created: true,
        card: {
          ...callableCard,
          updatedAt: { toDate: () => new Date('2026-08-23T00:00:00.000Z') },
        },
      },
    }));

    await expect(createCardIfAbsent({} as never, 'user-1', candidate, {
      libraryEpoch: 4,
    })).rejects.toMatchObject({
      kind: 'configuration',
      code: 'failed-precondition',
    });
  });

  it.each([
    ['deleted', '2026-08-11T09:00:00.000Z'],
    ['stale-library-epoch', '2026-08-11T09:00:00.000Z'],
  ] as const)('rehydrates callable precondition details as the existing %s contract', async (reason, operationCreatedAt) => {
    firebaseRuntime.isFirebaseConfigured = true;
    firebaseRuntime.protectedFunctionsCapability.available = true;
    const callable = vi.fn().mockRejectedValue(Object.assign(new Error('private server detail'), {
      code: 'functions/failed-precondition',
      details: { reason, ownerId: 'must-not-escape' },
    }));
    functionsRuntime.httpsCallable.mockReturnValue(callable);

    const error = await createCardIfAbsent({} as never, 'user-1', candidate, {
      libraryEpoch: 4,
      baseRevision: 2,
      operationCreatedAt,
    }).catch(cause => cause);

    expect(error).toBeInstanceOf(CardMutationPreconditionError);
    expect(error).toMatchObject({ reason });
    expect((error as Error).message).not.toContain('private server detail');
  });

  it('atomically creates the stable word document with v2 metadata', async () => {
    const set = vi.fn();
    firestore.runTransaction.mockImplementation(async (_db, callback) => callback({
      get: vi.fn(async (reference: { args?: unknown[] }) => {
        const path = reference.args?.at(-1);
        if (path === 'library_state') {
          return { exists: (): boolean => true, data: () => ({ libraryEpoch: 6 }) };
        }
        return { exists: (): boolean => false };
      }),
      set,
    }));
    const candidate = {
      id: 'temporary',
      word: 'Quite',
      normalizedWord: 'quite',
      translation: 'khá',
      explanation: 'x'.repeat(2_100),
      phonetic: '',
      emoji: '📝',
      category: 'Other',
      audioUrl: null,
      imageUrl: 'https://untrusted.example/quite.jpg',
    };

    await expect(createCardIfAbsent({} as never, 'user-1', candidate, {
      libraryEpoch: 6,
    })).resolves.toMatchObject({
      created: true,
      card: {
        id: 'word-quite',
        schemaVersion: 2,
        revision: 1,
        libraryEpoch: 6,
      },
    });
    expect(set).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        id: 'word-quite',
        explanation: 'x'.repeat(2_048),
        imageUrl: null,
        schemaVersion: 2,
        revision: 1,
        libraryEpoch: 6,
      }),
    );
  });

  it('rejects a new card whose word contradicts its proposed normalized identity', async () => {
    const set = vi.fn();
    firestore.runTransaction.mockImplementation(async (_db, callback) => callback({
      get: vi.fn(async () => ({ exists: (): boolean => false })),
      set,
    }));

    await expect(createCardIfAbsent({} as never, 'user-1', {
      id: 'temporary',
      word: 'Other',
      normalizedWord: 'quite',
      translation: 'khác',
      explanation: '',
      phonetic: '',
      emoji: '📝',
      category: 'Other',
      audioUrl: null,
      imageUrl: null,
    }, { libraryEpoch: 0 })).rejects.toMatchObject({ reason: 'identity-conflict' });
    expect(set).not.toHaveBeenCalled();
  });

  it('accepts a new card whose word is NFKC-equivalent to its normalized identity', async () => {
    const set = vi.fn();
    firestore.runTransaction.mockImplementation(async (_db, callback) => callback({
      get: vi.fn(async () => ({ exists: (): boolean => false })),
      set,
    }));

    await expect(createCardIfAbsent({} as never, 'user-1', {
      id: 'temporary',
      word: '  ＱＵＩＴＥ  ',
      normalizedWord: 'quite',
      translation: 'khá',
      explanation: '',
      phonetic: '',
      emoji: '📝',
      category: 'Other',
      audioUrl: null,
      imageUrl: null,
    }, { libraryEpoch: 0 })).resolves.toMatchObject({
      created: true,
      card: { id: 'word-quite', normalizedWord: 'quite' },
    });
  });

  it('rejects reusing an existing card whose word contradicts its persisted identity', async () => {
    const set = vi.fn();
    firestore.runTransaction.mockImplementation(async (_db, callback) => callback({
      get: vi.fn(async (reference: { args?: unknown[] }) => {
        const path = reference.args?.at(-1);
        const collectionName = reference.args?.at(-2);
        if (
          path === 'library_state'
          || collectionName === 'card_reservations'
          || collectionName === 'card_tombstones'
        ) {
          return { exists: (): boolean => false };
        }
        return {
          exists: (): boolean => true,
          data: () => ({
            id: 'word-quite',
            word: 'Other',
            normalizedWord: 'quite',
            translation: 'khác',
            schemaVersion: 2,
            revision: 2,
            libraryEpoch: 0,
          }),
        };
      }),
      set,
    }));

    await expect(createCardIfAbsent({} as never, 'user-1', {
      id: 'temporary',
      word: 'Quite',
      normalizedWord: 'quite',
      translation: 'khá',
      explanation: '',
      phonetic: '',
      emoji: '📝',
      category: 'Other',
      audioUrl: null,
      imageUrl: null,
    }, { libraryEpoch: 0 })).rejects.toMatchObject({ reason: 'identity-conflict' });
    expect(set).not.toHaveBeenCalled();
  });

  it('reuses an existing card whose word is NFKC-equivalent to its persisted identity', async () => {
    const set = vi.fn();
    firestore.runTransaction.mockImplementation(async (_db, callback) => callback({
      get: vi.fn(async (reference: { args?: unknown[] }) => {
        const path = reference.args?.at(-1);
        const collectionName = reference.args?.at(-2);
        if (
          path === 'library_state'
          || collectionName === 'card_reservations'
          || collectionName === 'card_tombstones'
        ) {
          return { exists: (): boolean => false };
        }
        return {
          exists: (): boolean => true,
          data: () => ({
            id: 'word-quite',
            word: '  ＱＵＩＴＥ  ',
            normalizedWord: 'quite',
            translation: 'khá',
            schemaVersion: 2,
            revision: 2,
            libraryEpoch: 0,
          }),
        };
      }),
      set,
    }));

    await expect(createCardIfAbsent({} as never, 'user-1', {
      id: 'temporary',
      word: 'Quite',
      normalizedWord: 'quite',
      translation: 'khá',
      explanation: '',
      phonetic: '',
      emoji: '📝',
      category: 'Other',
      audioUrl: null,
      imageUrl: null,
    }, { libraryEpoch: 0 })).resolves.toMatchObject({
      created: false,
      card: { id: 'word-quite', normalizedWord: 'quite' },
    });
    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({ args: expect.arrayContaining(['card_reservations']) }),
      {
        schemaVersion: 1,
        cardId: 'word-quite',
        normalizedWord: 'quite',
      },
      { merge: false },
    );
  });

  it('claims one reservation and converges concurrent arbitrary input ids', async () => {
    let storedReservation: Record<string, unknown> | null = null;
    let storedCard: Record<string, unknown> | null = null;
    const set = vi.fn((reference: { args?: unknown[] }, data: Record<string, unknown>) => {
      const collectionName = reference.args?.at(-2);
      if (collectionName === 'card_reservations') storedReservation = data;
      if (collectionName === 'cards') storedCard = data;
    });
    firestore.runTransaction.mockImplementation(async (_db, callback) => callback({
      get: vi.fn(async (reference: { args?: unknown[] }) => {
        const path = reference.args?.at(-1);
        const collectionName = reference.args?.at(-2);
        if (path === 'library_state' || collectionName === 'card_tombstones') {
          return { exists: (): boolean => false };
        }
        if (collectionName === 'card_reservations') {
          return {
            exists: (): boolean => storedReservation !== null,
            data: () => storedReservation,
          };
        }
        return {
          exists: (): boolean => storedCard !== null,
          id: 'word-chance',
          data: () => storedCard,
        };
      }),
      set,
    }));
    const firstCandidate = {
      id: 'old-client-random-a',
      word: 'Chance',
      normalizedWord: 'chance',
      translation: 'cơ hội',
      explanation: '',
      phonetic: '',
      emoji: '📝',
      category: 'Other',
      audioUrl: null,
      imageUrl: null,
    };
    const secondCandidate = {
      ...firstCandidate,
      id: 'old-client-random-b',
      word: ' chance ',
    };

    await expect(createCardIfAbsent(
      {} as never,
      'user-1',
      firstCandidate,
      { libraryEpoch: 0 },
    )).resolves.toMatchObject({ created: true, card: { id: 'word-chance' } });
    await expect(createCardIfAbsent(
      {} as never,
      'user-1',
      secondCandidate,
      { libraryEpoch: 0 },
    )).resolves.toMatchObject({ created: false, card: { id: 'word-chance' } });

    expect(storedReservation).toEqual({
      schemaVersion: 1,
      cardId: 'word-chance',
      normalizedWord: 'chance',
    });
    expect(storedCard).toEqual(expect.objectContaining({
      id: 'word-chance',
      normalizedWord: 'chance',
    }));
    expect(set.mock.calls.filter(([reference]) =>
      reference.args?.at(-2) === 'card_reservations')).toHaveLength(1);
  });

  it('recreates a missing card at the immutable id stored by an existing reservation', async () => {
    const set = vi.fn();
    firestore.runTransaction.mockImplementation(async (_db, callback) => callback({
      get: vi.fn(async (reference: { args?: unknown[] }) => {
        const path = reference.args?.at(-1);
        const collectionName = reference.args?.at(-2);
        if (path === 'library_state' || collectionName === 'card_tombstones') {
          return { exists: (): boolean => false };
        }
        if (collectionName === 'card_reservations') {
          return {
            exists: (): boolean => true,
            data: () => ({
              schemaVersion: 1,
              cardId: 'legacy-quite-id',
              normalizedWord: 'quite',
            }),
          };
        }
        expect(path).toBe('legacy-quite-id');
        return { exists: (): boolean => false };
      }),
      set,
    }));

    await expect(createCardIfAbsent({} as never, 'user-1', {
      id: 'temporary',
      word: 'Quite',
      normalizedWord: 'quite',
      translation: 'khá',
      explanation: '',
      phonetic: '',
      emoji: '📝',
      category: 'Other',
      audioUrl: null,
      imageUrl: null,
    }, { libraryEpoch: 0 })).resolves.toMatchObject({
      created: true,
      card: { id: 'legacy-quite-id', normalizedWord: 'quite' },
    });
    expect(set).toHaveBeenCalledOnce();
    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({
        args: expect.arrayContaining(['cards', 'legacy-quite-id']),
      }),
      expect.objectContaining({ id: 'legacy-quite-id', normalizedWord: 'quite' }),
    );
  });

  it('backfills a reservation while atomically upgrading a card missing its identity field', async () => {
    const set = vi.fn();
    firestore.runTransaction.mockImplementation(async (_db, callback) => callback({
      get: vi.fn(async (reference: { args?: unknown[] }) => {
        const path = reference.args?.at(-1);
        const collectionName = reference.args?.at(-2);
        if (path === 'library_state' || collectionName === 'card_tombstones') {
          return { exists: (): boolean => false };
        }
        if (collectionName === 'card_reservations') {
          return { exists: (): boolean => false };
        }
        return {
          exists: (): boolean => true,
          id: 'word-quite',
          data: () => ({
            id: 'word-quite',
            word: 'quite',
            translation: 'khá',
            revision: 2,
          }),
        };
      }),
      set,
    }));

    await expect(createCardIfAbsent({} as never, 'user-1', {
      id: 'random-id',
      word: 'Quite',
      normalizedWord: 'quite',
      translation: 'khá',
      explanation: '',
      phonetic: '',
      emoji: '📝',
      category: 'Other',
      audioUrl: null,
      imageUrl: null,
    }, { libraryEpoch: 0 })).resolves.toMatchObject({
      created: false,
      card: {
        id: 'word-quite',
        normalizedWord: 'quite',
        schemaVersion: 2,
        revision: 3,
        libraryEpoch: 0,
      },
    });
    expect(set).toHaveBeenCalledTimes(2);
    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({
        args: expect.arrayContaining([
          'card_reservations',
          '9a3058157de8b004fc5ddeea90813a3bba456c76dfa4b9c6dc0dcc64476d8f8d',
        ]),
      }),
      {
        schemaVersion: 1,
        cardId: 'word-quite',
        normalizedWord: 'quite',
      },
      { merge: false },
    );
    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({
        args: expect.arrayContaining(['cards', 'word-quite']),
      }),
      expect.objectContaining({
        id: 'word-quite',
        normalizedWord: 'quite',
        schemaVersion: 2,
        revision: 3,
        libraryEpoch: 0,
      }),
      { merge: false },
    );
  });

  it('rejects backfill when the canonical path contains a different word identity', async () => {
    const set = vi.fn();
    firestore.runTransaction.mockImplementation(async (_db, callback) => callback({
      get: vi.fn(async (reference: { args?: unknown[] }) => {
        const path = reference.args?.at(-1);
        const collectionName = reference.args?.at(-2);
        if (path === 'library_state' || collectionName === 'card_tombstones') {
          return { exists: (): boolean => false };
        }
        if (collectionName === 'card_reservations') {
          return { exists: (): boolean => false };
        }
        return {
          exists: (): boolean => true,
          id: 'word-quite',
          data: () => ({
            id: 'word-quite',
            word: 'other',
            normalizedWord: 'other',
            translation: 'khác',
            schemaVersion: 2,
            revision: 1,
            libraryEpoch: 0,
          }),
        };
      }),
      set,
    }));

    await expect(createCardIfAbsent({} as never, 'user-1', {
      id: 'temporary',
      word: 'Quite',
      normalizedWord: 'quite',
      translation: 'khá',
      explanation: '',
      phonetic: '',
      emoji: '📝',
      category: 'Other',
      audioUrl: null,
      imageUrl: null,
    }, { libraryEpoch: 0 })).rejects.toMatchObject({ reason: 'identity-conflict' });
    expect(set).not.toHaveBeenCalled();
  });

  it('rejects a mismatched immutable reservation without creating a card', async () => {
    const set = vi.fn();
    firestore.runTransaction.mockImplementation(async (_db, callback) => callback({
      get: vi.fn(async (reference: { args?: unknown[] }) => {
        const path = reference.args?.at(-1);
        const collectionName = reference.args?.at(-2);
        if (path === 'library_state' || collectionName === 'card_tombstones') {
          return { exists: (): boolean => false };
        }
        if (collectionName === 'card_reservations') {
          return {
            exists: (): boolean => true,
            data: () => ({
              schemaVersion: 1,
              cardId: 'word-quite',
              normalizedWord: 'different-word',
            }),
          };
        }
        return { exists: (): boolean => false };
      }),
      set,
    }));

    await expect(createCardIfAbsent({} as never, 'user-1', {
      id: 'random-id',
      word: 'Quite',
      normalizedWord: 'quite',
      translation: 'khá',
      explanation: '',
      phonetic: '',
      emoji: '📝',
      category: 'Other',
      audioUrl: null,
      imageUrl: null,
    }, { libraryEpoch: 0 })).rejects.toMatchObject({ reason: 'identity-conflict' });
    expect(set).not.toHaveBeenCalled();
  });

  it('recreates a card when the explicit create happened after its current-epoch tombstone', async () => {
    const set = vi.fn();
    firestore.runTransaction.mockImplementation(async (_db, callback) => callback({
      get: vi.fn(async (reference: { args?: unknown[] }) => {
        const path = reference.args?.at(-1);
        const collectionName = reference.args?.at(-2);
        if (path === 'library_state') return { exists: (): boolean => false };
        if (collectionName === 'card_reservations') {
          return {
            exists: (): boolean => true,
            data: () => ({
              schemaVersion: 1,
              cardId: 'word-quite',
              normalizedWord: 'quite',
            }),
          };
        }
        if (collectionName === 'card_tombstones') {
          return {
            exists: (): boolean => true,
            data: () => ({
              cardId: 'word-quite',
              opId: 'delete-quite',
              libraryEpoch: 0,
              revision: 3,
              deletedAt: '2026-08-11T10:00:00.000Z',
            }),
          };
        }
        return { exists: (): boolean => false };
      }),
      set,
    }));

    await expect(createCardIfAbsent({} as never, 'user-1', {
      id: 'word-quite',
      word: 'Quite',
      normalizedWord: 'quite',
      translation: 'khá',
      explanation: '',
      phonetic: '',
      emoji: '📝',
      category: 'Other',
      audioUrl: null,
      imageUrl: null,
      createdAt: '2026-08-11T11:00:00.000Z',
    }, {
      libraryEpoch: 0,
      baseRevision: 0,
      operationCreatedAt: '2026-08-11T11:00:00.000Z',
    })).resolves.toMatchObject({
      created: true,
      card: { id: 'word-quite', libraryEpoch: 0, revision: 4 },
    });
    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({ args: expect.arrayContaining(['cards', 'word-quite']) }),
      expect.objectContaining({ id: 'word-quite', libraryEpoch: 0, revision: 4 }),
    );
  });

  it('keeps blocking a stale create that predates its current-epoch tombstone', async () => {
    const set = vi.fn();
    firestore.runTransaction.mockImplementation(async (_db, callback) => callback({
      get: vi.fn(async (reference: { args?: unknown[] }) => {
        const path = reference.args?.at(-1);
        const collectionName = reference.args?.at(-2);
        if (path === 'library_state') return { exists: (): boolean => false };
        if (collectionName === 'card_reservations') {
          return {
            exists: (): boolean => true,
            data: () => ({
              schemaVersion: 1,
              cardId: 'word-quite',
              normalizedWord: 'quite',
            }),
          };
        }
        if (collectionName === 'card_tombstones') {
          return {
            exists: (): boolean => true,
            data: () => ({
              cardId: 'word-quite',
              opId: 'delete-quite',
              libraryEpoch: 0,
              revision: 3,
              deletedAt: '2026-08-11T10:00:00.000Z',
            }),
          };
        }
        return { exists: (): boolean => false };
      }),
      set,
    }));

    await expect(createCardIfAbsent({} as never, 'user-1', {
      id: 'word-quite',
      word: 'Quite',
      normalizedWord: 'quite',
      translation: 'khá',
      explanation: '',
      phonetic: '',
      emoji: '📝',
      category: 'Other',
      audioUrl: null,
      imageUrl: null,
      createdAt: '2026-08-11T09:00:00.000Z',
    }, {
      libraryEpoch: 0,
      baseRevision: 0,
      operationCreatedAt: '2026-08-11T09:00:00.000Z',
    })).rejects.toMatchObject({ reason: 'deleted' });
    expect(set).not.toHaveBeenCalled();
  });

  it('does not let a tombstone from an earlier library epoch block a new card', async () => {
    const set = vi.fn();
    firestore.runTransaction.mockImplementation(async (_db, callback) => callback({
      get: vi.fn(async (reference: { args?: unknown[] }) => {
        const path = reference.args?.at(-1);
        const collectionName = reference.args?.at(-2);
        if (path === 'library_state') {
          return { exists: (): boolean => true, data: () => ({ libraryEpoch: 7 }) };
        }
        if (collectionName === 'card_tombstones') {
          return {
            exists: (): boolean => true,
            data: () => ({
              cardId: 'word-quite',
              opId: 'old-delete',
              libraryEpoch: 6,
              revision: 12,
              deletedAt: '2026-07-25T00:00:00.000Z',
            }),
          };
        }
        if (collectionName === 'card_reservations') {
          return {
            exists: (): boolean => true,
            data: () => ({
              schemaVersion: 1,
              cardId: 'word-quite',
              normalizedWord: 'quite',
            }),
          };
        }
        return { exists: (): boolean => false };
      }),
      set,
    }));

    await expect(createCardIfAbsent({} as never, 'user-1', {
      id: 'temporary',
      word: 'Quite',
      normalizedWord: 'quite',
      translation: 'khá',
      explanation: '',
      phonetic: '',
      emoji: '📝',
      category: 'Other',
      audioUrl: null,
      imageUrl: null,
    }, {
      libraryEpoch: 7,
      baseRevision: 0,
    })).resolves.toMatchObject({
      created: true,
      card: {
        id: 'word-quite',
        libraryEpoch: 7,
        revision: 1,
      },
    });
    expect(set).toHaveBeenCalledOnce();
    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({
        args: expect.arrayContaining(['cards', 'word-quite']),
      }),
      expect.objectContaining({ id: 'word-quite', libraryEpoch: 7, revision: 1 }),
    );
  });

  it('deletes a recreated card without carrying an older epoch tombstone revision forward', async () => {
    const set = vi.fn();
    const remove = vi.fn();
    firestore.runTransaction.mockImplementation(async (_db, callback) => callback({
      get: vi.fn(async (reference: { args?: unknown[] }) => {
        const path = reference.args?.at(-1);
        const collectionName = reference.args?.at(-2);
        if (path === 'library_state') {
          return { exists: (): boolean => true, data: () => ({ libraryEpoch: 7 }) };
        }
        if (collectionName === 'card_tombstones') {
          return {
            exists: (): boolean => true,
            data: () => ({
              cardId: 'word-quite',
              opId: 'old-delete',
              libraryEpoch: 6,
              revision: 12,
              deletedAt: '2026-07-25T00:00:00.000Z',
            }),
          };
        }
        return {
          exists: (): boolean => true,
          data: () => ({ id: 'word-quite', schemaVersion: 2, revision: 1, libraryEpoch: 7 }),
        };
      }),
      set,
      delete: remove,
    }));

    await expect(deleteCardWithTombstone({} as never, 'user-1', {
      cardId: 'word-quite',
      opId: 'delete-current',
      libraryEpoch: 7,
      baseRevision: 1,
    })).resolves.toMatchObject({
      deleted: true,
      tombstone: { cardId: 'word-quite', libraryEpoch: 7, revision: 2 },
    });
    expect(set).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ libraryEpoch: 7, revision: 2 }),
      { merge: false },
    );
    expect(remove).toHaveBeenCalledOnce();
  });

  it('does not promote a deterministic-id card from an older explicit generation', async () => {
    const set = vi.fn();
    firestore.runTransaction.mockImplementation(async (_db, callback) => callback({
      get: vi.fn(async (reference: { args?: unknown[] }) => {
        const path = reference.args?.at(-1);
        const collectionName = reference.args?.at(-2);
        if (path === 'library_state') {
          return { exists: (): boolean => true, data: () => ({ libraryEpoch: 7 }) };
        }
        if (collectionName === 'card_tombstones') return { exists: (): boolean => false };
        if (collectionName === 'card_reservations') return { exists: (): boolean => false };
        return {
          exists: (): boolean => true,
          data: () => ({
            id: 'word-quite',
            word: 'quite',
            translation: 'stale',
            schemaVersion: 2,
            revision: 4,
            libraryEpoch: 6,
          }),
        };
      }),
      set,
    }));

    const result = await createCardIfAbsent({} as never, 'user-1', {
      id: 'temporary',
      word: 'Quite',
      normalizedWord: 'quite',
      translation: 'khá',
      explanation: '',
      phonetic: '',
      emoji: '📝',
      category: 'Other',
      audioUrl: null,
      imageUrl: null,
    }, { libraryEpoch: 7 });
    expect(result.created).toBe(true);
    expect(result.card.revision).toBe(1);
    expect(set).toHaveBeenCalled();
  });

  it('treats an epochless canonical card as existing during epoch zero', async () => {
    const set = vi.fn();
    firestore.runTransaction.mockImplementation(async (_db, callback) => callback({
      get: vi.fn(async (reference: { args?: unknown[] }) => {
        const path = reference.args?.at(-1);
        const collectionName = reference.args?.at(-2);
        if (path === 'library_state') return { exists: (): boolean => false };
        if (collectionName === 'card_tombstones') return { exists: (): boolean => false };
        if (collectionName === 'card_reservations') return { exists: (): boolean => false };
        return {
          exists: (): boolean => true,
          data: () => ({
            id: 'word-quite',
            word: 'quite',
            normalizedWord: 'quite',
            translation: 'khá cũ',
            revision: 3,
          }),
        };
      }),
      set,
    }));

    await expect(createCardIfAbsent({} as never, 'user-1', {
      id: 'temporary',
      word: 'Quite',
      normalizedWord: 'quite',
      translation: 'khá',
      explanation: '',
      phonetic: '',
      emoji: '📝',
      category: 'Other',
      audioUrl: null,
      imageUrl: null,
    }, { libraryEpoch: 0 })).resolves.toMatchObject({
      created: false,
      card: { id: 'word-quite', translation: 'khá cũ' },
    });
    expect(set).toHaveBeenCalledOnce();
    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({
        args: expect.arrayContaining([
          'card_reservations',
          '9a3058157de8b004fc5ddeea90813a3bba456c76dfa4b9c6dc0dcc64476d8f8d',
        ]),
      }),
      expect.objectContaining({ cardId: 'word-quite', normalizedWord: 'quite' }),
      { merge: false },
    );
  });

  it('rejects the same epochless canonical card after the library epoch advances', async () => {
    const set = vi.fn();
    firestore.runTransaction.mockImplementation(async (_db, callback) => callback({
      get: vi.fn(async (reference: { args?: unknown[] }) => {
        const path = reference.args?.at(-1);
        const collectionName = reference.args?.at(-2);
        if (path === 'library_state') {
          return { exists: (): boolean => true, data: () => ({ libraryEpoch: 2 }) };
        }
        if (collectionName === 'card_tombstones') return { exists: (): boolean => false };
        if (collectionName === 'card_reservations') return { exists: (): boolean => false };
        return {
          exists: (): boolean => true,
          data: () => ({
            id: 'word-quite',
            word: 'quite',
            normalizedWord: 'quite',
            translation: 'khá cũ',
            revision: 3,
          }),
        };
      }),
      set,
    }));

    const result = await createCardIfAbsent({} as never, 'user-1', {
      id: 'temporary',
      word: 'Quite',
      normalizedWord: 'quite',
      translation: 'khá',
      explanation: '',
      phonetic: '',
      emoji: '📝',
      category: 'Other',
      audioUrl: null,
      imageUrl: null,
    }, { libraryEpoch: 2 });
    expect(result.created).toBe(true);
    expect(result.card.revision).toBe(1);
    expect(set).toHaveBeenCalled();
  });

  it('fully upgrades an epoch-zero v2 card whose library epoch is missing', async () => {
    const set = vi.fn();
    firestore.runTransaction.mockImplementation(async (_db, callback) => callback({
      get: vi.fn(async (reference: { args?: unknown[] }) => {
        const path = reference.args?.at(-1);
        const collectionName = reference.args?.at(-2);
        if (path === 'library_state' || collectionName === 'card_reservations') {
          return { exists: (): boolean => false };
        }
        return {
          exists: (): boolean => true,
          data: () => ({
            id: 'word-quite',
            word: 'quite',
            translation: 'old',
            schemaVersion: 2,
            revision: 2,
          }),
        };
      }),
      set,
    }));

    await expect(applyCardPatchIfCurrent({} as never, 'user-1', {
      cardId: 'word-quite',
      fields: { bookmarked: true, normalizedWord: ' Quite ' },
      fieldMask: ['bookmarked', 'normalizedWord'],
      baseRevision: 2,
      libraryEpoch: 0,
    })).resolves.toEqual({ applied: true, revision: 3 });
    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({
        args: expect.arrayContaining([
          'card_reservations',
          '9a3058157de8b004fc5ddeea90813a3bba456c76dfa4b9c6dc0dcc64476d8f8d',
        ]),
      }),
      {
        schemaVersion: 1,
        cardId: 'word-quite',
        normalizedWord: 'quite',
      },
      { merge: false },
    );
    expect(set).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        id: 'word-quite',
        schemaVersion: 2,
        revision: 3,
        libraryEpoch: 0,
        bookmarked: true,
        normalizedWord: 'quite',
      }),
      { merge: false },
    );
  });

  it('rejects a legacy upgrade when another card owns the normalized identity', async () => {
    const set = vi.fn();
    firestore.runTransaction.mockImplementation(async (_db, callback) => callback({
      get: vi.fn(async (reference: { args?: unknown[] }) => {
        const path = reference.args?.at(-1);
        const collectionName = reference.args?.at(-2);
        if (path === 'library_state') return { exists: (): boolean => false };
        if (collectionName === 'card_reservations') {
          return {
            exists: (): boolean => true,
            data: () => ({
              schemaVersion: 1,
              cardId: 'different-card',
              normalizedWord: 'quite',
            }),
          };
        }
        return {
          exists: (): boolean => true,
          data: () => ({
            id: 'word-quite',
            word: 'quite',
            translation: 'old',
            schemaVersion: 2,
            revision: 2,
          }),
        };
      }),
      set,
    }));

    await expect(applyCardPatchIfCurrent({} as never, 'user-1', {
      cardId: 'word-quite',
      fields: { bookmarked: true },
      fieldMask: ['bookmarked'],
      baseRevision: 2,
      libraryEpoch: 0,
    })).rejects.toMatchObject({ reason: 'identity-conflict' });
    expect(set).not.toHaveBeenCalled();
  });

  it('rejects changing the normalized identity of a current card before writing', async () => {
    const set = vi.fn();
    firestore.runTransaction.mockImplementation(async (_db, callback) => callback({
      get: vi.fn(async (reference: { args?: unknown[] }) => {
        const path = reference.args?.at(-1);
        return path === 'library_state'
          ? { exists: (): boolean => true, data: () => ({ libraryEpoch: 3 }) }
          : {
              exists: (): boolean => true,
              data: () => ({
                id: 'word-quite',
                word: 'quite',
                normalizedWord: 'quite',
                translation: 'old',
                schemaVersion: 2,
                revision: 2,
                libraryEpoch: 3,
              }),
            };
      }),
      set,
    }));

    await expect(applyCardPatchIfCurrent({} as never, 'user-1', {
      cardId: 'word-quite',
      fields: { normalizedWord: 'other' },
      fieldMask: ['normalizedWord'],
      baseRevision: 2,
      libraryEpoch: 3,
    })).rejects.toMatchObject({ reason: 'identity-conflict' });
    expect(set).not.toHaveBeenCalled();
  });

  it('rejects changing the word to a different normalized identity', async () => {
    const set = vi.fn();
    firestore.runTransaction.mockImplementation(async (_db, callback) => callback({
      get: vi.fn(async (reference: { args?: unknown[] }) => {
        const path = reference.args?.at(-1);
        return path === 'library_state'
          ? { exists: (): boolean => true, data: () => ({ libraryEpoch: 3 }) }
          : {
              exists: (): boolean => true,
              data: () => ({
                id: 'word-quite',
                word: 'Quite',
                normalizedWord: 'quite',
                translation: 'khá',
                schemaVersion: 2,
                revision: 2,
                libraryEpoch: 3,
              }),
            };
      }),
      set,
    }));

    await expect(applyCardPatchIfCurrent({} as never, 'user-1', {
      cardId: 'word-quite',
      fields: { word: 'Other' },
      fieldMask: ['word'],
      baseRevision: 2,
      libraryEpoch: 3,
    })).rejects.toMatchObject({ reason: 'identity-conflict' });
    expect(set).not.toHaveBeenCalled();
  });

  it('rejects changing the exact word even when case and whitespace normalize equivalently', async () => {
    const set = vi.fn();
    firestore.runTransaction.mockImplementation(async (_db, callback) => callback({
      get: vi.fn(async (reference: { args?: unknown[] }) => {
        const path = reference.args?.at(-1);
        return path === 'library_state'
          ? { exists: (): boolean => true, data: () => ({ libraryEpoch: 3 }) }
          : {
              exists: (): boolean => true,
              data: () => ({
                id: 'word-quite',
                word: 'Quite',
                normalizedWord: 'quite',
                translation: 'khá',
                schemaVersion: 2,
                revision: 2,
                libraryEpoch: 3,
              }),
            };
      }),
      set,
    }));

    await expect(applyCardPatchIfCurrent({} as never, 'user-1', {
      cardId: 'word-quite',
      fields: { word: '  QUITE  ' },
      fieldMask: ['word'],
      baseRevision: 2,
      libraryEpoch: 3,
    })).rejects.toMatchObject({ reason: 'identity-conflict' });
    expect(set).not.toHaveBeenCalled();
  });

  it('rejects claiming an identity that contradicts the word of a card without identity', async () => {
    const set = vi.fn();
    firestore.runTransaction.mockImplementation(async (_db, callback) => callback({
      get: vi.fn(async (reference: { args?: unknown[] }) => {
        const path = reference.args?.at(-1);
        const collectionName = reference.args?.at(-2);
        if (path === 'library_state') {
          return { exists: (): boolean => true, data: () => ({ libraryEpoch: 3 }) };
        }
        if (collectionName === 'card_reservations') {
          return { exists: (): boolean => false };
        }
        return {
          exists: (): boolean => true,
          data: () => ({
            id: 'legacy-card',
            word: 'Other',
            translation: 'khác',
            schemaVersion: 2,
            revision: 2,
            libraryEpoch: 3,
          }),
        };
      }),
      set,
    }));

    await expect(applyCardPatchIfCurrent({} as never, 'user-1', {
      cardId: 'legacy-card',
      fields: { normalizedWord: 'quite' },
      fieldMask: ['normalizedWord'],
      baseRevision: 2,
      libraryEpoch: 3,
    })).rejects.toMatchObject({ reason: 'identity-conflict' });
    expect(set).not.toHaveBeenCalled();
  });

  it('rejects changing a card word before claiming a matching identity', async () => {
    const set = vi.fn();
    firestore.runTransaction.mockImplementation(async (_db, callback) => callback({
      get: vi.fn(async (reference: { args?: unknown[] }) => {
        const path = reference.args?.at(-1);
        const collectionName = reference.args?.at(-2);
        if (path === 'library_state') {
          return { exists: (): boolean => true, data: () => ({ libraryEpoch: 3 }) };
        }
        if (collectionName === 'card_reservations') {
          return { exists: (): boolean => false };
        }
        return {
          exists: (): boolean => true,
          data: () => ({
            id: 'legacy-card',
            word: 'Other',
            translation: 'khác',
            schemaVersion: 2,
            revision: 2,
            libraryEpoch: 3,
          }),
        };
      }),
      set,
    }));

    await expect(applyCardPatchIfCurrent({} as never, 'user-1', {
      cardId: 'legacy-card',
      fields: { word: 'quite', normalizedWord: 'quite' },
      fieldMask: ['word', 'normalizedWord'],
      baseRevision: 2,
      libraryEpoch: 3,
    })).rejects.toMatchObject({ reason: 'identity-conflict' });
    expect(set).not.toHaveBeenCalled();
  });

  it('does not upgrade an epochless card after the library epoch advances', async () => {
    const set = vi.fn();
    firestore.runTransaction.mockImplementation(async (_db, callback) => callback({
      get: vi.fn(async (reference: { args?: unknown[] }) => {
        const path = reference.args?.at(-1);
        return path === 'library_state'
          ? { exists: (): boolean => true, data: () => ({ libraryEpoch: 5 }) }
          : {
              exists: (): boolean => true,
              data: () => ({
                id: 'word-quite',
                word: 'quite',
                translation: 'stale',
                schemaVersion: 2,
                revision: 2,
              }),
            };
      }),
      set,
    }));

    await expect(applyCardPatchIfCurrent({} as never, 'user-1', {
      cardId: 'word-quite',
      fields: { bookmarked: true },
      fieldMask: ['bookmarked'],
      baseRevision: 2,
      libraryEpoch: 5,
    })).resolves.toEqual({ applied: false, reason: 'stale-library-epoch' });
    expect(set).not.toHaveBeenCalled();
  });

  it('claims an existing identity while upgrading a legacy protocol shape', async () => {
    const set = vi.fn();
    firestore.runTransaction.mockImplementation(async (_db, callback) => callback({
      get: vi.fn(async (reference: { args?: unknown[] }) => {
        const path = reference.args?.at(-1);
        const collectionName = reference.args?.at(-2);
        if (path === 'library_state') {
          return { exists: (): boolean => true, data: () => ({ libraryEpoch: 3 }) };
        }
        if (collectionName === 'card_reservations') {
          return { exists: (): boolean => false };
        }
        return {
          exists: (): boolean => true,
          data: () => ({
            id: 'word-quite',
            word: 'quite',
            normalizedWord: 'quite',
            translation: 'old',
            explanation: '',
            phonetic: '',
            emoji: '📝',
            category: 'Other',
            audioUrl: null,
            imageUrl: 'https://untrusted.example/legacy.jpg',
            revision: 8,
            libraryEpoch: 3,
            bookmarked: false,
          }),
        };
      }),
      set,
    }));

    await expect(applyCardPatchIfCurrent({} as never, 'user-1', {
      cardId: 'word-quite',
      fields: { translation: 'new', bookmarked: true },
      fieldMask: ['bookmarked'],
      baseRevision: 8,
      libraryEpoch: 3,
    })).resolves.toEqual({ applied: true, revision: 9 });
    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({
        args: expect.arrayContaining([
          'card_reservations',
          '9a3058157de8b004fc5ddeea90813a3bba456c76dfa4b9c6dc0dcc64476d8f8d',
        ]),
      }),
      {
        schemaVersion: 1,
        cardId: 'word-quite',
        normalizedWord: 'quite',
      },
      { merge: false },
    );
    expect(set).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        bookmarked: true,
        id: 'word-quite',
        imageUrl: null,
        libraryEpoch: 3,
        revision: 9,
        schemaVersion: 2,
        updatedAt: { type: 'server-timestamp' },
      }),
      { merge: false },
    );
  });

  it('rejects a current command targeting a card from an older explicit generation', async () => {
    const set = vi.fn();
    firestore.runTransaction.mockImplementation(async (_db, callback) => callback({
      get: vi.fn(async (reference: { args?: unknown[] }) => {
        const path = reference.args?.at(-1);
        return path === 'library_state'
          ? { exists: (): boolean => true, data: () => ({ libraryEpoch: 5 }) }
          : {
              exists: (): boolean => true,
              data: () => ({
                id: 'word-quite',
                word: 'quite',
                translation: 'stale',
                schemaVersion: 2,
                revision: 2,
                libraryEpoch: 4,
              }),
            };
      }),
      set,
    }));

    await expect(applyCardPatchIfCurrent({} as never, 'user-1', {
      cardId: 'word-quite',
      fields: { bookmarked: true },
      fieldMask: ['bookmarked'],
      baseRevision: 2,
      libraryEpoch: 5,
    })).resolves.toEqual({ applied: false, reason: 'stale-library-epoch' });
    expect(set).not.toHaveBeenCalled();
  });

  it('rejects patch writes when the library epoch is stale', async () => {
    const update = vi.fn();
    firestore.runTransaction.mockImplementation(async (_db, callback) => callback({
      get: vi.fn(async (reference: { args?: unknown[] }) => {
        const path = reference.args?.at(-1);
        return path === 'library_state'
          ? { exists: () => true, data: () => ({ libraryEpoch: 5 }) }
          : { exists: () => true, data: () => ({ revision: 2 }) };
      }),
      update,
    }));

    await expect(applyCardPatchIfCurrent({} as never, 'user-1', {
      cardId: 'word-quite',
      fields: { bookmarked: true },
      fieldMask: ['bookmarked'],
      baseRevision: 2,
      libraryEpoch: 4,
    })).resolves.toEqual({ applied: false, reason: 'stale-library-epoch' });
    expect(update).not.toHaveBeenCalled();
  });

  it('returns the latest revision when a patch conflicts', async () => {
    const set = vi.fn();
    firestore.runTransaction.mockImplementation(async (_db, callback) => callback({
      get: vi.fn(async (reference: { args?: unknown[] }) => {
        const path = reference.args?.at(-1);
        return path === 'library_state'
          ? { exists: () => true, data: () => ({ libraryEpoch: 3 }) }
          : {
              exists: () => true,
              data: () => ({
                id: 'word-quite',
                word: 'quite',
                translation: 'cloud',
                revision: 9,
                libraryEpoch: 3,
              }),
            };
      }),
      set,
    }));

    await expect(applyCardPatchIfCurrent({} as never, 'user-1', {
      cardId: 'word-quite',
      fields: { bookmarked: true },
      fieldMask: ['bookmarked'],
      baseRevision: 8,
      libraryEpoch: 3,
    })).resolves.toEqual({
      applied: false,
      reason: 'revision-conflict',
      currentRevision: 9,
    });
    expect(set).not.toHaveBeenCalled();
  });

  it('treats a previously committed masked patch as idempotently applied', async () => {
    const set = vi.fn();
    firestore.runTransaction.mockImplementation(async (_db, callback) => callback({
      get: vi.fn(async (reference: { args?: unknown[] }) => {
        const path = reference.args?.at(-1);
        return path === 'library_state'
          ? { exists: () => true, data: () => ({ libraryEpoch: 3 }) }
          : {
              exists: () => true,
              data: () => ({
                id: 'word-quite',
                word: 'quite',
                normalizedWord: 'quite',
                translation: 'cloud',
                bookmarked: true,
                schemaVersion: 2,
                revision: 9,
                libraryEpoch: 3,
              }),
            };
      }),
      set,
    }));

    await expect(applyCardPatchIfCurrent({} as never, 'user-1', {
      cardId: 'word-quite',
      fields: {
        bookmarked: true,
        translation: 'stale local value outside the mask',
      },
      fieldMask: ['bookmarked'],
      baseRevision: 8,
      libraryEpoch: 3,
    })).resolves.toEqual({ applied: true, revision: 9 });
    expect(set).not.toHaveBeenCalled();
  });

  it('preserves every unrelated field when patching a current v2 card', async () => {
    const set = vi.fn();
    firestore.runTransaction.mockImplementation(async (_db, callback) => callback({
      get: vi.fn(async (reference: { args?: unknown[] }) => {
        const path = reference.args?.at(-1);
        return path === 'library_state'
          ? { exists: () => true, data: () => ({ libraryEpoch: 3 }) }
          : {
              exists: () => true,
              data: () => ({
                id: 'word-quite',
                word: 'quite',
                translation: 'cloud translation',
                imageUrl: 'https://images.pexels.com/cloud-quite.jpg',
                explanation: 'cloud explanation',
                schemaVersion: 2,
                revision: 9,
                libraryEpoch: 3,
              }),
            };
      }),
      set,
    }));

    await expect(applyCardPatchIfCurrent({} as never, 'user-1', {
      cardId: 'word-quite',
      fields: {
        bookmarked: true,
        translation: 'stale local translation outside mask',
      },
      fieldMask: ['bookmarked'],
      baseRevision: 9,
      libraryEpoch: 3,
    })).resolves.toEqual({ applied: true, revision: 10 });
    expect(set).toHaveBeenCalledWith(
      expect.anything(),
      {
        bookmarked: true,
        revision: 10,
        updatedAt: { type: 'server-timestamp' },
      },
      { merge: true },
    );
  });

  it('deletes a card and writes its revisioned tombstone in one transaction', async () => {
    const set = vi.fn();
    const remove = vi.fn();
    firestore.runTransaction.mockImplementation(async (_db, callback) => callback({
      get: vi.fn(async (reference: { args?: unknown[] }) => {
        const path = reference.args?.at(-1);
        if (path === 'library_state') {
          return { exists: (): boolean => true, data: () => ({ libraryEpoch: 2 }) };
        }
        if (path === 'word-quite') {
          const collectionName = reference.args?.at(-2);
          if (collectionName === 'card_tombstones') return { exists: () => false };
          return { exists: () => true, data: () => ({ revision: 4 }) };
        }
        return { exists: () => false };
      }),
      set,
      delete: remove,
    }));

    const result = await deleteCardWithTombstone({} as never, 'user-1', {
      cardId: 'word-quite',
      opId: 'legacy-delete-word-quite-2026-07-26T04:12:03.456Z',
      libraryEpoch: 2,
      baseRevision: 4,
    });
    expect(result).toMatchObject({
      deleted: true,
      tombstone: {
        cardId: 'word-quite',
        libraryEpoch: 2,
        revision: 5,
      },
    });
    if (!result.deleted) throw new Error('Expected the delete to succeed.');
    expect(result.tombstone.opId).toMatch(/^[a-zA-Z0-9_-]{1,128}$/);
    expect(set).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        opId: expect.stringMatching(/^[a-zA-Z0-9_-]{1,128}$/),
        revision: 5,
      }),
      { merge: false },
    );
    expect(remove).toHaveBeenCalledWith(expect.anything());
  });

  it('acknowledges a different same-epoch delete when the card is already gone', async () => {
    const set = vi.fn();
    const existingTombstone = {
      cardId: 'word-quite',
      opId: 'other-device-delete',
      libraryEpoch: 2,
      revision: 5,
      deletedAt: '2026-07-26T00:00:00.000Z',
    };
    firestore.runTransaction.mockImplementation(async (_db, callback) => callback({
      get: vi.fn(async (reference: { args?: unknown[] }) => {
        const path = reference.args?.at(-1);
        const collectionName = reference.args?.at(-2);
        if (path === 'library_state') {
          return { exists: () => true, data: () => ({ libraryEpoch: 2 }) };
        }
        if (collectionName === 'card_tombstones') {
          return { exists: (): boolean => true, data: () => existingTombstone };
        }
        return { exists: (): boolean => false };
      }),
      set,
      delete: vi.fn(),
    }));

    await expect(deleteCardWithTombstone({} as never, 'user-1', {
      cardId: 'word-quite',
      opId: 'local-delete',
      libraryEpoch: 2,
      baseRevision: 3,
    })).resolves.toEqual({
      deleted: true,
      tombstone: existingTombstone,
    });
    expect(set).not.toHaveBeenCalled();
  });

  it('does not treat the same delete id from an earlier epoch as a current retry', async () => {
    const set = vi.fn();
    firestore.runTransaction.mockImplementation(async (_db, callback) => callback({
      get: vi.fn(async (reference: { args?: unknown[] }) => {
        const path = reference.args?.at(-1);
        const collectionName = reference.args?.at(-2);
        if (path === 'library_state') {
          return { exists: (): boolean => true, data: () => ({ libraryEpoch: 3 }) };
        }
        if (collectionName === 'card_tombstones') {
          return {
            exists: (): boolean => true,
            data: () => ({
              cardId: 'word-quite',
              opId: 'same-delete-id',
              libraryEpoch: 2,
              revision: 5,
              deletedAt: '2026-07-25T00:00:00.000Z',
            }),
          };
        }
        return { exists: (): boolean => false };
      }),
      set,
      delete: vi.fn(),
    }));

    await expect(deleteCardWithTombstone({} as never, 'user-1', {
      cardId: 'word-quite',
      opId: 'same-delete-id',
      libraryEpoch: 3,
      baseRevision: 0,
    })).resolves.toMatchObject({
      deleted: true,
      tombstone: {
        libraryEpoch: 3,
        revision: 1,
      },
    });
    expect(set).toHaveBeenCalled();
  });
});

describe('library epoch', () => {
  beforeEach(() => {
    firestore.getDoc.mockReset();
    firestore.runTransaction.mockReset();
  });

  it('treats a missing or invalid legacy epoch as zero', async () => {
    firestore.getDoc
      .mockResolvedValueOnce({ exists: () => false })
      .mockResolvedValueOnce({ exists: () => true, data: () => ({ libraryEpoch: -4 }) });

    await expect(getLibraryEpoch({} as never, 'legacy-user')).resolves.toBe(0);
    await expect(getLibraryEpoch({} as never, 'invalid-user')).resolves.toBe(0);
  });

  it('increments the epoch atomically and returns the new generation', async () => {
    const set = vi.fn();
    firestore.runTransaction.mockImplementation(async (_db, callback) => callback({
      get: vi.fn().mockResolvedValue({
        exists: () => true,
        data: () => ({ libraryEpoch: 8 }),
      }),
      set,
    }));

    await expect(incrementLibraryEpoch({} as never, 'user-reset')).resolves.toBe(9);
    expect(set).toHaveBeenCalledWith(
      expect.anything(),
      { libraryEpoch: 9, schemaVersion: 2 },
      { merge: true },
    );
  });
});

describe('legacy card maintenance', () => {
  beforeEach(() => {
    firestore.getDocs.mockReset();
    firestore.getDoc.mockReset();
    firestore.runTransaction.mockReset();
    firestore.setDoc.mockReset();
    firestore.setDoc.mockResolvedValue(undefined);
    firestore.transactionSet.mockReset();
  });

  it('treats versionless or malformed migration progress as incomplete', async () => {
    firestore.getDoc.mockResolvedValue({
      exists: () => true,
      data: () => ({ complete: true, scanned: 99, lastDocumentId: 'legacy-tail' }),
    });

    await expect(getLegacyCardQueryMigrationProgress(
      {} as never,
      'user-1',
    )).resolves.toEqual({ scanned: 0, complete: false });
  });

  it('reads only sanitized progress from the current query migration version', async () => {
    firestore.getDoc
      .mockResolvedValueOnce({
        exists: () => true,
        data: () => ({ migrationVersion: 2, complete: false, scanned: 41 }),
      })
      .mockResolvedValueOnce({
        exists: () => true,
        data: () => ({ migrationVersion: 2, complete: true, scanned: -1 }),
      })
      .mockResolvedValueOnce({
        exists: () => true,
        data: () => ({ migrationVersion: 2, complete: true, scanned: 42 }),
      });

    await expect(getLegacyCardQueryMigrationProgress(
      {} as never,
      'user-1',
    )).resolves.toEqual({ scanned: 41, complete: false });
    await expect(getLegacyCardQueryMigrationProgress(
      {} as never,
      'user-1',
    )).resolves.toEqual({ scanned: 0, complete: false });
    await expect(getLegacyCardQueryMigrationProgress(
      {} as never,
      'user-1',
    )).resolves.toEqual({ scanned: 42, complete: true });
  });

  it('clears deck assignments through the v2 transaction protocol', async () => {
    firestore.getDocs
      .mockResolvedValueOnce(snapshot([{
        id: 'legacy-deck-card',
        data: {
          id: 'legacy-deck-card',
          word: 'legacy',
          translation: 'cũ',
          customDeck: 'Old deck',
        },
      }]))
      .mockResolvedValueOnce(snapshot([]));
    firestore.getDoc.mockResolvedValue({ exists: () => false });
    firestore.runTransaction.mockImplementation(async (_db, callback) => callback({
      get: vi.fn(async (reference: { args?: unknown[] }) => {
        const path = reference.args?.at(-1);
        const collectionName = reference.args?.at(-2);
        if (path === 'library_state' || collectionName === 'card_reservations') {
          return { exists: (): boolean => false };
        }
        return {
          exists: (): boolean => true,
          data: () => ({
            id: 'legacy-deck-card',
            word: 'legacy',
            translation: 'cũ',
            customDeck: 'Old deck',
          }),
        };
      }),
      set: firestore.transactionSet,
    }));

    await expect(clearCustomDeckAssignments(
      {} as never,
      'user-1',
      'Old deck',
    )).resolves.toBeUndefined();
    expect(firestore.transactionSet).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        id: 'legacy-deck-card',
        customDeck: null,
        schemaVersion: 2,
      }),
      { merge: false },
    );
  });

  it('refreshes the library epoch after a stale deck patch', async () => {
    const deckCard = {
      id: 'stale-epoch-card',
      data: {
        id: 'stale-epoch-card',
        word: 'stale',
        translation: 'cũ',
        customDeck: 'Old deck',
        schemaVersion: 2,
        revision: 4,
        libraryEpoch: 2,
      },
    };
    firestore.getDocs
      .mockResolvedValueOnce(snapshot([deckCard]))
      .mockResolvedValueOnce(snapshot([deckCard]))
      .mockResolvedValueOnce(snapshot([]));
    firestore.getDoc
      .mockResolvedValueOnce({
        exists: () => true,
        data: () => ({ libraryEpoch: 1 }),
      })
      .mockResolvedValueOnce({
        exists: () => true,
        data: () => ({ libraryEpoch: 2 }),
      });
    firestore.runTransaction.mockImplementation(async (_db, callback) => callback({
      get: vi.fn(async (reference: { args?: unknown[] }) => {
        const path = reference.args?.at(-1);
        return path === 'library_state'
          ? { exists: () => true, data: () => ({ libraryEpoch: 2 }) }
          : { exists: () => true, data: () => deckCard.data };
      }),
      set: firestore.transactionSet,
    }));

    await expect(clearCustomDeckAssignments(
      {} as never,
      'user-1',
      'Old deck',
    )).resolves.toBeUndefined();
    expect(firestore.getDoc).toHaveBeenCalledTimes(2);
    expect(firestore.transactionSet).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ customDeck: null, revision: 5 }),
      { merge: true },
    );
  });

  it('retries a conflicting deck patch only while the card remains in that deck', async () => {
    const queriedCard = {
      id: 'conflicting-card',
      data: {
        id: 'conflicting-card',
        word: 'conflict',
        translation: 'xung đột',
        customDeck: 'Old deck',
        schemaVersion: 2,
        revision: 8,
        libraryEpoch: 3,
      },
    };
    const currentCard = { ...queriedCard.data, revision: 9 };
    firestore.getDocs
      .mockResolvedValueOnce(snapshot([queriedCard]))
      .mockResolvedValueOnce(snapshot([]));
    firestore.getDoc.mockImplementation(async (reference: { args?: unknown[] }) => {
      const path = reference.args?.at(-1);
      return path === 'library_state'
        ? { exists: () => true, data: () => ({ libraryEpoch: 3 }) }
        : { exists: () => true, data: () => currentCard };
    });
    firestore.runTransaction.mockImplementation(async (_db, callback) => callback({
      get: vi.fn(async (reference: { args?: unknown[] }) => {
        const path = reference.args?.at(-1);
        return path === 'library_state'
          ? { exists: () => true, data: () => ({ libraryEpoch: 3 }) }
          : { exists: () => true, data: () => currentCard };
      }),
      set: firestore.transactionSet,
    }));

    await expect(clearCustomDeckAssignments(
      {} as never,
      'user-1',
      'Old deck',
    )).resolves.toBeUndefined();
    expect(firestore.transactionSet).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ customDeck: null, revision: 10 }),
      { merge: true },
    );
  });

  it('preserves a concurrent reassignment when retrying a deck patch', async () => {
    const queriedCard = {
      id: 'reassigned-card',
      data: {
        id: 'reassigned-card',
        word: 'moved',
        translation: 'đã chuyển',
        customDeck: 'Old deck',
        schemaVersion: 2,
        revision: 8,
        libraryEpoch: 3,
      },
    };
    const reassignedCard = {
      ...queriedCard.data,
      customDeck: 'New deck',
      revision: 9,
    };
    firestore.getDocs
      .mockResolvedValueOnce(snapshot([queriedCard]))
      .mockResolvedValueOnce(snapshot([]));
    firestore.getDoc.mockImplementation(async (reference: { args?: unknown[] }) => {
      const path = reference.args?.at(-1);
      return path === 'library_state'
        ? { exists: () => true, data: () => ({ libraryEpoch: 3 }) }
        : { exists: () => true, data: () => reassignedCard };
    });
    firestore.runTransaction.mockImplementation(async (_db, callback) => callback({
      get: vi.fn(async (reference: { args?: unknown[] }) => {
        const path = reference.args?.at(-1);
        return path === 'library_state'
          ? { exists: () => true, data: () => ({ libraryEpoch: 3 }) }
          : { exists: () => true, data: () => reassignedCard };
      }),
      set: firestore.transactionSet,
    }));

    await expect(clearCustomDeckAssignments(
      {} as never,
      'user-1',
      'Old deck',
    )).resolves.toBeUndefined();
    expect(firestore.transactionSet).not.toHaveBeenCalled();
  });

  it('waits for sibling deck mutations to settle before reporting a batch failure', async () => {
    const documents = [
      {
        id: 'failing-card',
        data: {
          id: 'failing-card', word: 'fail', translation: 'lỗi', customDeck: 'Old deck',
          schemaVersion: 2, revision: 1, libraryEpoch: 0,
        },
      },
      {
        id: 'in-flight-card',
        data: {
          id: 'in-flight-card', word: 'wait', translation: 'chờ', customDeck: 'Old deck',
          schemaVersion: 2, revision: 1, libraryEpoch: 0,
        },
      },
    ];
    let releaseSibling!: () => void;
    const siblingGate = new Promise<void>(resolve => { releaseSibling = resolve; });
    firestore.getDoc.mockResolvedValue({ exists: () => false });
    firestore.getDocs.mockResolvedValueOnce(snapshot(documents));
    firestore.runTransaction
      .mockRejectedValueOnce(new Error('first deck mutation failed'))
      .mockImplementationOnce(async () => {
        await siblingGate;
        return { applied: true, revision: 2 };
      });

    let settled = false;
    let rejection: unknown;
    const observed = clearCustomDeckAssignments(
      {} as never,
      'user-1',
      'Old deck',
    ).catch(error => {
      settled = true;
      rejection = error;
    });

    await vi.waitFor(() => expect(firestore.runTransaction).toHaveBeenCalledTimes(2));
    await Promise.resolve();
    expect(settled).toBe(false);

    releaseSibling();
    await observed;
    expect(rejection).toEqual(new Error('first deck mutation failed'));
  });

  it('stops immediately when the command epoch is ahead of the server', async () => {
    const deckCard = {
      id: 'future-epoch-card',
      data: {
        id: 'future-epoch-card',
        word: 'future',
        translation: 'tương lai',
        customDeck: 'Old deck',
        revision: 2,
      },
    };
    firestore.getDocs
      .mockResolvedValueOnce(snapshot([deckCard]))
      .mockResolvedValueOnce(snapshot([]));
    firestore.getDoc.mockResolvedValue({
      exists: () => true,
      data: () => ({ libraryEpoch: 3 }),
    });
    firestore.runTransaction.mockImplementation(async (_db, callback) => callback({
      get: vi.fn(async () => ({
        exists: () => true,
        data: () => ({ libraryEpoch: 2 }),
      })),
      set: firestore.transactionSet,
    }));

    await expect(clearCustomDeckAssignments(
      {} as never,
      'user-1',
      'Old deck',
    )).rejects.toThrow('Card mutation rejected: future-library-epoch.');
    expect(firestore.getDocs).toHaveBeenCalledTimes(1);
    expect(firestore.transactionSet).not.toHaveBeenCalled();
  });

  it('fails a repeated non-empty deck batch that cannot make progress', async () => {
    const conflictingCard = {
      id: 'moving-conflict-card',
      data: {
        id: 'moving-conflict-card',
        word: 'moving',
        translation: 'đang thay đổi',
        customDeck: 'Old deck',
        schemaVersion: 2,
        revision: 1,
        libraryEpoch: 0,
      },
    };
    let currentRevision = 1;
    firestore.getDocs.mockImplementation(async () => {
      if (firestore.getDocs.mock.calls.length > 3) {
        throw new Error('deck query exceeded its safety bound');
      }
      return snapshot([conflictingCard]);
    });
    firestore.getDoc.mockImplementation(async (reference: { args?: unknown[] }) => {
      const path = reference.args?.at(-1);
      return path === 'library_state'
        ? { exists: () => false }
        : {
            exists: () => true,
            data: () => ({ ...conflictingCard.data, revision: currentRevision }),
          };
    });
    firestore.runTransaction.mockImplementation(async (_db, callback) => {
      currentRevision += 1;
      return callback({
        get: vi.fn(async (reference: { args?: unknown[] }) => {
          const path = reference.args?.at(-1);
          return path === 'library_state'
            ? { exists: (): boolean => false }
            : {
                exists: (): boolean => true,
                data: () => ({ ...conflictingCard.data, revision: currentRevision }),
              };
        }),
        set: firestore.transactionSet,
      });
    });

    await expect(clearCustomDeckAssignments(
      {} as never,
      'user-1',
      'Old deck',
    )).rejects.toThrow('same card batch made no progress');
    expect(firestore.getDocs).toHaveBeenCalledTimes(3);
    expect(firestore.runTransaction).toHaveBeenCalledTimes(9);
    expect(firestore.transactionSet).not.toHaveBeenCalled();
  });

  it('restarts a versionless completed scan and claims a fully current card identity', async () => {
    const currentCard = {
      id: 'legacy-arbitrary-id',
      word: 'Quite',
      normalizedWord: 'quite',
      translation: 'khá',
      createdAt: '2026-08-01T00:00:00.000Z',
      schemaVersion: 2,
      revision: 4,
      libraryEpoch: 0,
      customDeck: null,
      difficulty: 'unrated',
      bookmarked: false,
    };
    firestore.getDoc.mockImplementation(async (reference: { args?: unknown[] }) => {
      const path = reference.args?.at(-1);
      return path === 'query_migration'
        ? {
            exists: () => true,
            data: () => ({
              complete: true,
              lastDocumentId: 'old-version-tail',
              scanned: 99,
            }),
          }
        : { exists: () => false };
    });
    firestore.getDocs.mockResolvedValueOnce(snapshot([{
      id: currentCard.id,
      data: currentCard,
    }]));
    firestore.runTransaction.mockImplementation(async (_db, callback) => callback({
      get: vi.fn(async (reference: { args?: unknown[] }) => {
        const path = reference.args?.at(-1);
        const collectionName = reference.args?.at(-2);
        if (path === 'library_state' || collectionName === 'card_reservations') {
          return { exists: (): boolean => false };
        }
        return { exists: (): boolean => true, data: () => currentCard };
      }),
      set: firestore.transactionSet,
    }));

    await expect(migrateLegacyCardQueryFields(
      {} as never,
      'user-1',
      100,
    )).resolves.toEqual({ migrated: 1, scanned: 1, complete: true });
    expect(firestore.transactionSet).toHaveBeenCalledTimes(1);
    expect(firestore.transactionSet).toHaveBeenCalledWith(
      expect.objectContaining({
        args: expect.arrayContaining([
          'card_reservations',
          '9a3058157de8b004fc5ddeea90813a3bba456c76dfa4b9c6dc0dcc64476d8f8d',
        ]),
      }),
      {
        schemaVersion: 1,
        cardId: 'legacy-arbitrary-id',
        normalizedWord: 'quite',
      },
      { merge: false },
    );
    expect(firestore.setDoc).toHaveBeenCalledWith(
      expect.objectContaining({ args: expect.arrayContaining(['profile', 'query_migration']) }),
      expect.objectContaining({
        migrationVersion: 2,
        lastDocumentId: 'legacy-arbitrary-id',
        complete: true,
        scanned: 1,
      }),
      { merge: true },
    );
  });

  it('fails closed without advancing migration progress when another card owns the identity', async () => {
    const currentCard = {
      id: 'legacy-arbitrary-id',
      word: 'Quite',
      normalizedWord: 'quite',
      translation: 'khá',
      createdAt: '2026-08-01T00:00:00.000Z',
      schemaVersion: 2,
      revision: 4,
      libraryEpoch: 0,
      customDeck: null,
      difficulty: 'unrated',
      bookmarked: false,
    };
    firestore.getDoc.mockResolvedValue({ exists: () => false });
    firestore.getDocs.mockResolvedValueOnce(snapshot([{
      id: currentCard.id,
      data: currentCard,
    }]));
    firestore.runTransaction.mockImplementation(async (_db, callback) => callback({
      get: vi.fn(async (reference: { args?: unknown[] }) => {
        const path = reference.args?.at(-1);
        const collectionName = reference.args?.at(-2);
        if (path === 'library_state') return { exists: (): boolean => false };
        if (collectionName === 'card_reservations') {
          return {
            exists: (): boolean => true,
            data: () => ({
              schemaVersion: 1,
              cardId: 'different-card',
              normalizedWord: 'quite',
            }),
          };
        }
        return { exists: (): boolean => true, data: () => currentCard };
      }),
      set: firestore.transactionSet,
    }));

    await expect(migrateLegacyCardQueryFields(
      {} as never,
      'user-1',
      100,
    )).rejects.toMatchObject({ reason: 'identity-conflict' });
    expect(firestore.transactionSet).not.toHaveBeenCalled();
    expect(firestore.setDoc).not.toHaveBeenCalled();
  });

  it('does not claim or complete migration for a card whose word contradicts its identity', async () => {
    const inconsistentCard = {
      id: 'legacy-inconsistent-id',
      word: 'Other',
      normalizedWord: 'quite',
      translation: 'khác',
      createdAt: '2026-08-01T00:00:00.000Z',
      schemaVersion: 2,
      revision: 4,
      libraryEpoch: 0,
      customDeck: null,
      difficulty: 'unrated',
      bookmarked: false,
    };
    firestore.getDoc.mockResolvedValue({ exists: () => false });
    firestore.getDocs.mockResolvedValueOnce(snapshot([{
      id: inconsistentCard.id,
      data: inconsistentCard,
    }]));
    firestore.runTransaction.mockImplementation(async (_db, callback) => callback({
      get: vi.fn(async (reference: { args?: unknown[] }) => {
        const path = reference.args?.at(-1);
        const collectionName = reference.args?.at(-2);
        if (path === 'library_state' || collectionName === 'card_reservations') {
          return { exists: (): boolean => false };
        }
        return { exists: (): boolean => true, data: () => inconsistentCard };
      }),
      set: firestore.transactionSet,
    }));

    await expect(migrateLegacyCardQueryFields(
      {} as never,
      'user-1',
      100,
    )).rejects.toMatchObject({ reason: 'identity-conflict' });
    expect(firestore.transactionSet).not.toHaveBeenCalled();
    expect(firestore.setDoc).not.toHaveBeenCalled();
  });

  it('does not advance migration progress when a required patch loses a revision race', async () => {
    const queriedCard = {
      id: 'legacy-conflicting-id',
      word: 'Quite',
      normalizedWord: 'quite',
      translation: 'khá',
      createdAt: '2026-08-01T00:00:00.000Z',
      schemaVersion: 2,
      revision: 4,
      libraryEpoch: 0,
      customDeck: null,
      difficulty: 'unrated',
    };
    const concurrentlyUpdatedCard = { ...queriedCard, revision: 5 };
    firestore.getDoc.mockResolvedValue({ exists: () => false });
    firestore.getDocs.mockResolvedValueOnce(snapshot([{
      id: queriedCard.id,
      data: queriedCard,
    }]));
    firestore.runTransaction.mockImplementation(async (_db, callback) => callback({
      get: vi.fn(async (reference: { args?: unknown[] }) => {
        const path = reference.args?.at(-1);
        const collectionName = reference.args?.at(-2);
        if (path === 'library_state' || collectionName === 'card_reservations') {
          return { exists: (): boolean => false };
        }
        return {
          exists: (): boolean => true,
          data: () => concurrentlyUpdatedCard,
        };
      }),
      set: firestore.transactionSet,
    }));

    await expect(migrateLegacyCardQueryFields(
      {} as never,
      'user-1',
      100,
    )).rejects.toThrow('revision-conflict');
    expect(firestore.transactionSet).not.toHaveBeenCalled();
    expect(firestore.setDoc).not.toHaveBeenCalled();
  });

  it('does not advance migration progress when the library epoch changes mid-batch', async () => {
    const queriedCard = {
      id: 'legacy-stale-epoch-id',
      word: 'Quite',
      normalizedWord: 'quite',
      translation: 'khá',
      createdAt: '2026-08-01T00:00:00.000Z',
      schemaVersion: 2,
      revision: 4,
      libraryEpoch: 0,
      customDeck: null,
      difficulty: 'unrated',
      bookmarked: false,
    };
    firestore.getDoc.mockResolvedValue({ exists: () => false });
    firestore.getDocs.mockResolvedValueOnce(snapshot([{
      id: queriedCard.id,
      data: queriedCard,
    }]));
    firestore.runTransaction.mockImplementation(async (_db, callback) => callback({
      get: vi.fn(async () => ({
        exists: (): boolean => true,
        data: () => ({ libraryEpoch: 1 }),
      })),
      set: firestore.transactionSet,
    }));

    await expect(migrateLegacyCardQueryFields(
      {} as never,
      'user-1',
      100,
    )).rejects.toThrow('stale-library-epoch');
    expect(firestore.transactionSet).not.toHaveBeenCalled();
    expect(firestore.setDoc).not.toHaveBeenCalled();
  });

  it('safely advances migration when a queried card was concurrently deleted', async () => {
    const queriedCard = {
      id: 'legacy-deleted-id',
      word: 'Quite',
      normalizedWord: 'quite',
      translation: 'khá',
      createdAt: '2026-08-01T00:00:00.000Z',
      schemaVersion: 2,
      revision: 4,
      libraryEpoch: 0,
      customDeck: null,
      difficulty: 'unrated',
      bookmarked: false,
    };
    firestore.getDoc.mockResolvedValue({ exists: () => false });
    firestore.getDocs.mockResolvedValueOnce(snapshot([{
      id: queriedCard.id,
      data: queriedCard,
    }]));
    firestore.runTransaction.mockImplementation(async (_db, callback) => callback({
      get: vi.fn(async () => ({ exists: (): boolean => false })),
      set: firestore.transactionSet,
    }));

    await expect(migrateLegacyCardQueryFields(
      {} as never,
      'user-1',
      100,
    )).resolves.toEqual({ migrated: 0, scanned: 1, complete: true });
    expect(firestore.transactionSet).not.toHaveBeenCalled();
    expect(firestore.setDoc).toHaveBeenCalledWith(
      expect.objectContaining({ args: expect.arrayContaining(['profile', 'query_migration']) }),
      expect.objectContaining({
        migrationVersion: 2,
        lastDocumentId: 'legacy-deleted-id',
        complete: true,
        scanned: 1,
      }),
      { merge: true },
    );
  });

  it('claims the identity before accepting an empty migration patch after a revision race', async () => {
    const queriedCard = {
      id: 'legacy-racing-id',
      word: 'Quite',
      normalizedWord: 'quite',
      translation: 'khá',
      createdAt: '2026-08-01T00:00:00.000Z',
      schemaVersion: 2,
      revision: 4,
      libraryEpoch: 0,
      customDeck: null,
      difficulty: 'unrated',
      bookmarked: false,
    };
    const concurrentlyUpdatedCard = { ...queriedCard, revision: 5 };
    firestore.getDoc.mockResolvedValue({ exists: () => false });
    firestore.getDocs.mockResolvedValueOnce(snapshot([{
      id: queriedCard.id,
      data: queriedCard,
    }]));
    firestore.runTransaction.mockImplementation(async (_db, callback) => callback({
      get: vi.fn(async (reference: { args?: unknown[] }) => {
        const path = reference.args?.at(-1);
        const collectionName = reference.args?.at(-2);
        if (path === 'library_state' || collectionName === 'card_reservations') {
          return { exists: (): boolean => false };
        }
        return {
          exists: (): boolean => true,
          data: () => concurrentlyUpdatedCard,
        };
      }),
      set: firestore.transactionSet,
    }));

    await expect(migrateLegacyCardQueryFields(
      {} as never,
      'user-1',
      100,
    )).resolves.toEqual({ migrated: 1, scanned: 1, complete: true });
    expect(firestore.transactionSet).toHaveBeenCalledWith(
      expect.objectContaining({
        args: expect.arrayContaining([
          'card_reservations',
          '9a3058157de8b004fc5ddeea90813a3bba456c76dfa4b9c6dc0dcc64476d8f8d',
        ]),
      }),
      {
        schemaVersion: 1,
        cardId: 'legacy-racing-id',
        normalizedWord: 'quite',
      },
      { merge: false },
    );
  });

  it('claims a legacy protocol identity before accepting an idempotent revision race', async () => {
    const concurrentlyUpdatedLegacyCard = {
      id: 'legacy-racing-id',
      word: 'Quite',
      normalizedWord: 'quite',
      translation: 'khá',
      revision: 5,
      bookmarked: true,
    };
    const set = vi.fn();
    firestore.runTransaction.mockImplementation(async (_db, callback) => callback({
      get: vi.fn(async (reference: { args?: unknown[] }) => {
        const path = reference.args?.at(-1);
        const collectionName = reference.args?.at(-2);
        if (path === 'library_state' || collectionName === 'card_reservations') {
          return { exists: (): boolean => false };
        }
        return {
          exists: (): boolean => true,
          data: () => concurrentlyUpdatedLegacyCard,
        };
      }),
      set,
    }));

    await expect(applyCardPatchIfCurrent({} as never, 'user-1', {
      cardId: 'legacy-racing-id',
      fields: { bookmarked: true },
      fieldMask: ['bookmarked'],
      baseRevision: 4,
      libraryEpoch: 0,
    })).resolves.toEqual({ applied: true, revision: 5 });
    expect(set).toHaveBeenCalledTimes(1);
    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({
        args: expect.arrayContaining([
          'card_reservations',
          '9a3058157de8b004fc5ddeea90813a3bba456c76dfa4b9c6dc0dcc64476d8f8d',
        ]),
      }),
      {
        schemaVersion: 1,
        cardId: 'legacy-racing-id',
        normalizedWord: 'quite',
      },
      { merge: false },
    );
  });

  it('marks an exact-size migration batch complete only after the empty follow-up scan', async () => {
    const currentCard = {
      id: 'legacy-boundary-id',
      word: 'Boundary',
      normalizedWord: 'boundary',
      translation: 'ranh giới',
      createdAt: '2026-08-01T00:00:00.000Z',
      schemaVersion: 2,
      revision: 2,
      libraryEpoch: 0,
      customDeck: null,
      difficulty: 'unrated',
      bookmarked: false,
    };
    firestore.getDoc
      .mockResolvedValueOnce({ exists: () => false })
      .mockResolvedValueOnce({ exists: () => false })
      .mockResolvedValueOnce({
        exists: () => true,
        data: () => ({
          migrationVersion: 2,
          lastDocumentId: 'legacy-boundary-id',
          complete: false,
          scanned: 1,
        }),
      });
    firestore.getDocs
      .mockResolvedValueOnce(snapshot([{ id: currentCard.id, data: currentCard }]))
      .mockResolvedValueOnce(snapshot([]));
    firestore.runTransaction.mockImplementation(async (_db, callback) => callback({
      get: vi.fn(async (reference: { args?: unknown[] }) => {
        const path = reference.args?.at(-1);
        const collectionName = reference.args?.at(-2);
        if (path === 'library_state' || collectionName === 'card_reservations') {
          return { exists: (): boolean => false };
        }
        return { exists: (): boolean => true, data: () => currentCard };
      }),
      set: firestore.transactionSet,
    }));

    await expect(migrateLegacyCardQueryFields(
      {} as never,
      'user-1',
      1,
    )).resolves.toEqual({ migrated: 1, scanned: 1, complete: false });
    expect(firestore.setDoc).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ args: expect.arrayContaining(['profile', 'query_migration']) }),
      expect.objectContaining({
        migrationVersion: 2,
        lastDocumentId: 'legacy-boundary-id',
        complete: false,
        scanned: 1,
      }),
      { merge: true },
    );

    await expect(migrateLegacyCardQueryFields(
      {} as never,
      'user-1',
      1,
    )).resolves.toEqual({ migrated: 0, scanned: 0, complete: true });
    expect(firestore.setDoc).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ args: expect.arrayContaining(['profile', 'query_migration']) }),
      expect.objectContaining({
        migrationVersion: 2,
        lastDocumentId: 'legacy-boundary-id',
        complete: true,
        scanned: 1,
      }),
      { merge: true },
    );
    expect(firestore.getDocs).toHaveBeenCalledTimes(2);
  });

  it('does not advance migration for a noncanonical legacy word that requires trusted repair', async () => {
    firestore.getDoc.mockResolvedValue({ exists: () => false });
    firestore.getDocs.mockResolvedValueOnce(snapshot([{
      id: 'legacy-noncanonical-card',
      data: {
        id: 'legacy-noncanonical-card',
        word: 'Migrate',
        translation: 'di chuyển',
      },
    }]));
    firestore.runTransaction.mockImplementation(async (_db, callback) => callback({
      get: vi.fn(async (reference: { args?: unknown[] }) => {
        const path = reference.args?.at(-1);
        if (path === 'library_state') return { exists: (): boolean => false };
        return {
          exists: (): boolean => true,
          data: () => ({
            id: 'legacy-noncanonical-card',
            word: 'Migrate',
            translation: 'di chuyển',
          }),
        };
      }),
      set: firestore.transactionSet,
    }));

    await expect(migrateLegacyCardQueryFields(
      {} as never,
      'user-1',
      100,
    )).rejects.toMatchObject({ reason: 'identity-conflict' });
    expect(firestore.transactionSet).not.toHaveBeenCalled();
    expect(firestore.setDoc).not.toHaveBeenCalled();
  });

  it('migrates canonical legacy query fields through the same rules-safe transaction', async () => {
    firestore.getDoc.mockImplementation(async (reference: { args?: unknown[] }) => {
      const path = reference.args?.at(-1);
      return path === 'query_migration'
        ? { exists: () => false }
        : { exists: () => false };
    });
    firestore.getDocs.mockResolvedValueOnce(snapshot([{
      id: 'legacy-migration-card',
      data: {
        id: 'legacy-migration-card',
        word: 'migrate',
        translation: 'di chuyển',
      },
    }]));
    firestore.runTransaction.mockImplementation(async (_db, callback) => callback({
      get: vi.fn(async (reference: { args?: unknown[] }) => {
        const path = reference.args?.at(-1);
        const collectionName = reference.args?.at(-2);
        if (path === 'library_state' || collectionName === 'card_reservations') {
          return { exists: (): boolean => false };
        }
        return {
          exists: (): boolean => true,
          data: () => ({
            id: 'legacy-migration-card',
            word: 'migrate',
            translation: 'di chuyển',
          }),
        };
      }),
      set: firestore.transactionSet,
    }));

    await expect(migrateLegacyCardQueryFields(
      {} as never,
      'user-1',
      100,
    )).resolves.toMatchObject({ migrated: 1, scanned: 1, complete: true });
    expect(firestore.transactionSet).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        id: 'legacy-migration-card',
        normalizedWord: 'migrate',
        schemaVersion: 2,
      }),
      { merge: false },
    );
  });
});
