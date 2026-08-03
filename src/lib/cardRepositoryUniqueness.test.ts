import { beforeEach, describe, expect, it, vi } from 'vitest';

const firestore = vi.hoisted(() => ({
  getDocs: vi.fn(),
  getDoc: vi.fn(),
  setDoc: vi.fn(() => Promise.resolve()),
  runTransaction: vi.fn(),
  serverTimestamp: vi.fn(() => ({ type: 'server-timestamp' })),
  transactionSet: vi.fn(),
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

import {
  createCardIfAbsent,
  applyCardPatchIfCurrent,
  clearCustomDeckAssignments,
  deleteCardWithTombstone,
  findCardByNormalizedWord,
  findCardsByNormalizedWords,
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
        if (path === 'library_state') return { exists: (): boolean => false };
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
          difficulty: 'good',
          reviewHistory: [{ rating: 'good', reviewedAt: '2026-01-01T00:00:00.000Z' }],
        },
      },
    ]));

    await expect(findCardByNormalizedWord({} as never, 'user-1', 'chance'))
      .resolves.toMatchObject({ id: 'reviewed' });
    expect(firestore.getDocs).toHaveBeenCalledTimes(1);
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
        if (path === 'library_state') return { exists: (): boolean => false };
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
  });

  it('finds a bounded legacy casing variant and repairs its normalized identity', async () => {
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
    expect(firestore.transactionSet).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        id: 'legacy-uppercase',
        normalizedWord: 'opportunity',
        schemaVersion: 2,
      }),
      { merge: false },
    );
  });
});

describe('createCardIfAbsent', () => {
  beforeEach(() => {
    firestore.runTransaction.mockReset();
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
  });

  it('applies only masked patch fields when epoch and base revision are current', async () => {
    const set = vi.fn();
    firestore.runTransaction.mockImplementation(async (_db, callback) => callback({
      get: vi.fn(async (reference: { args?: unknown[] }) => {
        const path = reference.args?.at(-1);
        if (path === 'library_state') {
          return { exists: () => true, data: () => ({ libraryEpoch: 3 }) };
        }
        return {
          exists: () => true,
          data: () => ({
            id: 'word-quite',
            word: 'quite',
            translation: 'old',
            explanation: '',
            phonetic: '',
            emoji: '📝',
            category: 'Other',
            audioUrl: null,
            imageUrl: 'https://untrusted.example/legacy.jpg',
            revision: 8,
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
                translation: 'cloud',
                bookmarked: true,
                revision: 9,
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
        revision: 6,
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
    firestore.setDoc.mockClear();
    firestore.transactionSet.mockReset();
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
        if (path === 'library_state') return { exists: (): boolean => false };
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

  it('migrates legacy query fields through the same rules-safe transaction', async () => {
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
            id: 'legacy-migration-card',
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
