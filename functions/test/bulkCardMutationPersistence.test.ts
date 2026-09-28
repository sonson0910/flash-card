import type { DocumentData, DocumentReference, DocumentSnapshot, Firestore, Transaction } from 'firebase-admin/firestore';
import { describe, expect, it, vi } from 'vitest';
import {
  applyBulkCardMutationsForOwner,
  BulkMutationEpochError,
  parseBulkCardMutationRequest,
  type BulkCardMutationRequest,
} from '../src/bulkCardMutationPersistence.js';

const snapshot = (exists: boolean, data?: DocumentData): DocumentSnapshot => ({
  exists,
  data: () => data,
} as DocumentSnapshot);

const baseCard = (overrides: DocumentData = {}): DocumentData => ({
  id: 'word-focus',
  word: 'focus',
  normalizedWord: 'focus',
  customDeck: null,
  bookmarked: false,
  schemaVersion: 2,
  revision: 3,
  libraryEpoch: 2,
  ...overrides,
});

const harness = (
  entries: Record<string, DocumentSnapshot> = {},
  fenced = false,
) => {
  const values = new Map<string, DocumentSnapshot>([
    ['users/owner/profile/library_state', snapshot(true, { libraryEpoch: 2 })],
    ...(fenced ? [['users/owner/profile/library_migration_fence', snapshot(true, { schemaVersion: 1, active: true })] as const] : []),
    ...Object.entries(entries),
  ]);
  const writes: Array<{ path: string; data: DocumentData }> = [];
  const deletes: string[] = [];
  const transaction = {
    get: vi.fn(async (reference: DocumentReference) => values.get(reference.path) ?? snapshot(false)),
    getAll: vi.fn(async (...refs: DocumentReference[]) => refs.map(reference => values.get(reference.path) ?? snapshot(false))),
    set: vi.fn((reference: DocumentReference, data: DocumentData) => {
      writes.push({ path: reference.path, data });
      return transaction;
    }),
    delete: vi.fn((reference: DocumentReference) => {
      deletes.push(reference.path);
      return transaction;
    }),
  } as unknown as Transaction;
  const nestedCollection = (path: string) => ({
    doc: (documentId: string) => nestedDoc(`${path}/${documentId}`),
  });
  const nestedDoc = (path: string) => ({
    path,
    collection: (subcollection: string) => nestedCollection(`${path}/${subcollection}`),
  });
  const database = {
    collection: (name: string) => nestedCollection(name),
    runTransaction: vi.fn(async (update: (value: Transaction) => Promise<unknown>) => update(transaction)),
  } as unknown as Firestore;
  return { database, writes, deletes, values };
};

const patchRequest = (overrides: Partial<BulkCardMutationRequest> = {}): BulkCardMutationRequest => ({
  libraryEpoch: 2,
  patches: [{
    cardId: 'word-focus',
    baseRevision: 3,
    fields: { customDeck: 'irregular-verbs' },
    fieldMask: ['customDeck'],
  }],
  deletes: [],
  ...overrides,
});

describe('parseBulkCardMutationRequest', () => {
  it('parses a valid patch command', () => {
    const parsed = parseBulkCardMutationRequest(patchRequest());
    expect(parsed.patches).toHaveLength(1);
    expect(parsed.deletes).toHaveLength(0);
  });

  it('parses a valid delete command', () => {
    const parsed = parseBulkCardMutationRequest({
      libraryEpoch: 0,
      patches: [],
      deletes: [{ cardId: 'word-focus', baseRevision: 1, opId: 'device-a:delete-1' }],
    });
    expect(parsed.deletes).toEqual([{ cardId: 'word-focus', baseRevision: 1, opId: 'device-a:delete-1' }]);
  });

  it('rejects an unsupported top-level field', () => {
    expect(() => parseBulkCardMutationRequest({ ...patchRequest(), extra: true })).toThrow();
  });

  it('rejects an empty request', () => {
    expect(() => parseBulkCardMutationRequest({ libraryEpoch: 0, patches: [], deletes: [] })).toThrow();
  });

  it('rejects fields that do not exactly match the field mask', () => {
    expect(() => parseBulkCardMutationRequest(patchRequest({
      patches: [{
        cardId: 'word-focus',
        baseRevision: 3,
        fields: { customDeck: 'a', bookmarked: true },
        fieldMask: ['customDeck'],
      }],
    }))).toThrow();
  });

  it('rejects a fieldMask field outside the bulk-patchable allowlist', () => {
    expect(() => parseBulkCardMutationRequest({
      libraryEpoch: 0,
      patches: [{ cardId: 'word-focus', baseRevision: 0, fields: { word: 'x' }, fieldMask: ['word'] }],
      deletes: [],
    })).toThrow();
  });

  it('rejects an invalid card ID', () => {
    expect(() => parseBulkCardMutationRequest(patchRequest({
      patches: [{ cardId: '../escape', baseRevision: 0, fields: { customDeck: null }, fieldMask: ['customDeck'] }],
    }))).toThrow();
  });

  it('rejects an invalid delete operation ID', () => {
    expect(() => parseBulkCardMutationRequest({
      libraryEpoch: 0,
      patches: [],
      deletes: [{ cardId: 'word-focus', baseRevision: 0, opId: '../unsafe' }],
    })).toThrow();
  });

  it('rejects the same card targeted by two commands', () => {
    expect(() => parseBulkCardMutationRequest({
      libraryEpoch: 0,
      patches: [{ cardId: 'word-focus', baseRevision: 0, fields: { customDeck: null }, fieldMask: ['customDeck'] }],
      deletes: [{ cardId: 'word-focus', baseRevision: 0, opId: 'device-a:delete-1' }],
    })).toThrow();
  });

  it('rejects a request whose document footprint exceeds the transaction bound', () => {
    const patches = Array.from({ length: 401 }, (_, index) => ({
      cardId: `word-${index}`,
      baseRevision: 0,
      fields: { bookmarked: true },
      fieldMask: ['bookmarked'] as const,
    }));
    expect(() => parseBulkCardMutationRequest({ libraryEpoch: 0, patches, deletes: [] })).toThrow();
  });

  it('accounts for a catalog projection as the third delete document', () => {
    const deletes = Array.from({ length: 134 }, (_, index) => ({
      cardId: `word-${index}`,
      baseRevision: 0,
      opId: `device-a:delete-${index}`,
    }));
    expect(() => parseBulkCardMutationRequest({ libraryEpoch: 0, patches: [], deletes })).toThrow();
  });

  it('accepts a request exactly at the document footprint bound', () => {
    const patches = Array.from({ length: 400 }, (_, index) => ({
      cardId: `word-${index}`,
      baseRevision: 0,
      fields: { bookmarked: true },
      fieldMask: ['bookmarked'] as const,
    }));
    expect(() => parseBulkCardMutationRequest({ libraryEpoch: 0, patches, deletes: [] })).not.toThrow();
  });
});

describe('applyBulkCardMutationsForOwner', () => {
  it('rejects the whole batch while the durable migration fence is active', async () => {
    const test = harness({ 'users/owner/cards/word-focus': snapshot(true, baseCard()) }, true);
    await expect(applyBulkCardMutationsForOwner(test.database, 'owner', patchRequest()))
      .rejects.toMatchObject({ name: 'LegacyLibraryMigrationFenceError' });
    expect(test.writes).toEqual([]);
  });

  it('rejects the whole batch on a shared library-epoch mismatch without any writes', async () => {
    const test = harness({ 'users/owner/cards/word-focus': snapshot(true, baseCard()) });
    await expect(applyBulkCardMutationsForOwner(test.database, 'owner', patchRequest({ libraryEpoch: 1 })))
      .rejects.toBeInstanceOf(BulkMutationEpochError);
    expect(test.writes).toEqual([]);
  });

  it('patches a current-protocol card and advances its revision', async () => {
    const test = harness({ 'users/owner/cards/word-focus': snapshot(true, baseCard()) });
    const result = await applyBulkCardMutationsForOwner(test.database, 'owner', patchRequest());
    expect(result.results).toEqual([{ cardId: 'word-focus', op: 'patch', applied: true, revision: 4 }]);
    expect(test.writes).toEqual([{
      path: 'users/owner/cards/word-focus',
      data: expect.objectContaining({ customDeck: 'irregular-verbs', revision: 4 }),
    }]);
  });

  it('reports a missing card without writing anything', async () => {
    const test = harness();
    const result = await applyBulkCardMutationsForOwner(test.database, 'owner', patchRequest());
    expect(result.results).toEqual([{ cardId: 'word-focus', op: 'patch', applied: false, reason: 'missing' }]);
    expect(test.writes).toEqual([]);
  });

  it('reports a legacy (pre-protocol) card as requiring migration instead of overwriting it', async () => {
    const test = harness({
      'users/owner/cards/word-focus': snapshot(true, baseCard({ schemaVersion: 1, revision: undefined })),
    });
    const result = await applyBulkCardMutationsForOwner(test.database, 'owner', patchRequest());
    expect(result.results).toEqual([{ cardId: 'word-focus', op: 'patch', applied: false, reason: 'requires-migration' }]);
    expect(test.writes).toEqual([]);
  });

  it('reports a stale card epoch instead of overwriting it', async () => {
    const test = harness({
      'users/owner/cards/word-focus': snapshot(true, baseCard({ libraryEpoch: 1 })),
    });
    const result = await applyBulkCardMutationsForOwner(test.database, 'owner', patchRequest());
    expect(result.results).toEqual([{ cardId: 'word-focus', op: 'patch', applied: false, reason: 'stale-library-epoch' }]);
    expect(test.writes).toEqual([]);
  });

  it('treats a revision conflict whose stored fields already match the request as already applied', async () => {
    const test = harness({
      'users/owner/cards/word-focus': snapshot(true, baseCard({ revision: 5, customDeck: 'irregular-verbs' })),
    });
    const result = await applyBulkCardMutationsForOwner(test.database, 'owner', patchRequest());
    expect(result.results).toEqual([{ cardId: 'word-focus', op: 'patch', applied: true, revision: 5 }]);
    expect(test.writes).toEqual([]);
  });

  it('reports a genuine revision conflict with the current revision instead of overwriting', async () => {
    const test = harness({
      'users/owner/cards/word-focus': snapshot(true, baseCard({ revision: 5, customDeck: 'other-deck' })),
    });
    const result = await applyBulkCardMutationsForOwner(test.database, 'owner', patchRequest());
    expect(result.results).toEqual([{ cardId: 'word-focus', op: 'patch', applied: false, reason: 'revision-conflict', currentRevision: 5 }]);
    expect(test.writes).toEqual([]);
  });

  it('applies a fresh delete and writes a tombstone while removing the card', async () => {
    const test = harness({ 'users/owner/cards/word-focus': snapshot(true, baseCard()) });
    const result = await applyBulkCardMutationsForOwner(test.database, 'owner', {
      libraryEpoch: 2,
      patches: [],
      deletes: [{ cardId: 'word-focus', baseRevision: 3, opId: 'device-a:delete-1' }],
    });
    expect(result.results).toEqual([{
      cardId: 'word-focus', op: 'delete', applied: true, revision: 4, deletedAt: expect.any(String),
      opId: 'device-a:delete-1', libraryEpoch: 2,
    }]);
    expect(test.deletes).toEqual(['users/owner/cards/word-focus']);
    expect(test.writes).toEqual([{
      path: 'users/owner/card_tombstones/word-focus',
      data: expect.objectContaining({ opId: 'device-a:delete-1', libraryEpoch: 2, revision: 4 }),
    }]);
  });

  it('removes a canonical card projection with its successful delete', async () => {
    const test = harness({
      'users/owner/cards/word-focus': snapshot(true, baseCard({
        lexemeId: 'lexeme-focus', language: 'en',
      })),
    });
    await applyBulkCardMutationsForOwner(test.database, 'owner', {
      libraryEpoch: 2,
      patches: [],
      deletes: [{ cardId: 'word-focus', baseRevision: 3, opId: 'device-a:delete-1' }],
    });
    expect(test.deletes).toEqual(expect.arrayContaining([
      'users/owner/catalog_progress/lexeme-focus',
      'users/owner/cards/word-focus',
    ]));
  });

  it('replays an idempotent delete retry without writing again', async () => {
    const test = harness({
      'users/owner/card_tombstones/word-focus': snapshot(true, {
        cardId: 'word-focus', opId: 'device-a:delete-1', libraryEpoch: 2, revision: 4, deletedAt: '2026-08-24T00:00:00.000Z',
      }),
    });
    const result = await applyBulkCardMutationsForOwner(test.database, 'owner', {
      libraryEpoch: 2,
      patches: [],
      deletes: [{ cardId: 'word-focus', baseRevision: 3, opId: 'device-a:delete-1' }],
    });
    expect(result.results).toEqual([{
      cardId: 'word-focus', op: 'delete', applied: true, revision: 4, deletedAt: '2026-08-24T00:00:00.000Z',
      opId: 'device-a:delete-1', libraryEpoch: 2,
    }]);
    expect(test.writes).toEqual([]);
    expect(test.deletes).toEqual([]);
  });

  it('reports a delete revision conflict without writing anything', async () => {
    const test = harness({ 'users/owner/cards/word-focus': snapshot(true, baseCard({ revision: 9 })) });
    const result = await applyBulkCardMutationsForOwner(test.database, 'owner', {
      libraryEpoch: 2,
      patches: [],
      deletes: [{ cardId: 'word-focus', baseRevision: 3, opId: 'device-a:delete-1' }],
    });
    expect(result.results).toEqual([{
      cardId: 'word-focus', op: 'delete', applied: false, reason: 'revision-conflict', currentRevision: 9,
    }]);
    expect(test.writes).toEqual([]);
    expect(test.deletes).toEqual([]);
  });

  it('processes a mixed batch independently, applying the valid command and reporting the conflicting one', async () => {
    const test = harness({
      'users/owner/cards/word-focus': snapshot(true, baseCard()),
      'users/owner/cards/word-other': snapshot(true, baseCard({ id: 'word-other', revision: 9 })),
    });
    const result = await applyBulkCardMutationsForOwner(test.database, 'owner', {
      libraryEpoch: 2,
      patches: [
        { cardId: 'word-focus', baseRevision: 3, fields: { customDeck: 'irregular-verbs' }, fieldMask: ['customDeck'] },
        { cardId: 'word-other', baseRevision: 3, fields: { customDeck: 'irregular-verbs' }, fieldMask: ['customDeck'] },
      ],
      deletes: [],
    });
    expect(result.results).toEqual([
      { cardId: 'word-focus', op: 'patch', applied: true, revision: 4 },
      { cardId: 'word-other', op: 'patch', applied: false, reason: 'revision-conflict', currentRevision: 9 },
    ]);
    expect(test.writes).toHaveLength(1);
    expect(test.writes[0]).toMatchObject({ path: 'users/owner/cards/word-focus' });
  });
});
