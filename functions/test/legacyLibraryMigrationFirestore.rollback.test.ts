import { describe, expect, it } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';
import { rollbackLegacyLibraryMigration } from '../src/legacyLibraryMigrationFirestore.js';

type FakeReference = { kind: 'card' | 'profile' | 'source' | 'tombstone'; id: string };

const snapshot = (id: string, data?: Record<string, unknown>) => ({
  id,
  exists: data !== undefined,
  data: () => data,
});

const createRollbackPreflightFake = (
  laterTombstoneMatches = false,
  rollbackIdentity?: { migrationRunId: string; migrationRunAttempt: number },
  empty = false,
) => {
  const expectedTombstone = (cardId: string) => ({
    cardId,
    opId: `applied-${cardId}`,
    libraryEpoch: 2,
    revision: 1,
    deletedAt: '2026-08-15T00:00:00.000Z',
  });
  const words = empty ? [] : ['alpha', 'beta'];
  const plans = words.map(word => ({
    id: word,
    data: () => ({
      primaryId: `word-${word}`,
      normalizedWord: word,
      sourceIds: [`legacy-${word}`],
      loserIds: [`legacy-${word}`],
      appliedRevision: 5,
      beforeReservation: null,
      beforeTombstones: [{ cardId: `legacy-${word}`, data: null }],
      afterTombstones: [{ cardId: `legacy-${word}`, data: expectedTombstone(`legacy-${word}`) }],
    }),
  }));
  const sources = words.map(word => ({
    id: `legacy-${word}`,
    exists: true,
    data: () => ({ sourceId: `legacy-${word}`, source: { id: `legacy-${word}`, word } }),
  }));
  const cards = new Map(words.map(word => [
    `word-${word}`,
    { id: `word-${word}`, revision: 5 },
  ]));
  const tombstones = new Map([
    ['legacy-alpha', expectedTombstone('legacy-alpha')],
    ['legacy-beta', laterTombstoneMatches
      ? expectedTombstone('legacy-beta')
      : { ...expectedTombstone('legacy-beta'), opId: 'tampered-after-apply' }],
  ]);
  const writes = { count: 0 };
  const root = {
    get: async () => snapshot('query-v2', {
      migrationVersion: 3,
      libraryEpoch: 2,
      completedMutationGeneration: 0,
      sourceCount: sources.length,
      ...(rollbackIdentity ? {
        rollbackMigrationRunId: rollbackIdentity.migrationRunId,
        rollbackMigrationRunAttempt: rollbackIdentity.migrationRunAttempt,
      } : {}),
    }),
    collection: (name: 'sources' | 'plans') => {
      const documents = name === 'sources' ? sources : plans;
      const query = {
        doc: (id: string): FakeReference => ({ kind: 'source', id }),
        limit: () => query,
        get: async () => ({ size: documents.length, docs: documents }),
      };
      return query;
    },
  };
  const owner = {
    collection: (name: string) => ({
      doc: (id: string) => {
        if (name === 'admin_library_migration_backups') return root;
        const reference: FakeReference = {
          kind: name === 'cards' ? 'card' : name === 'card_tombstones' ? 'tombstone' : 'profile',
          id,
        };
        return { ...reference, get: async () => read(reference) };
      },
    }),
  };
  const read = (reference: FakeReference) => {
    if (reference.kind === 'profile') return snapshot(reference.id, reference.id === 'library_state'
      ? { libraryEpoch: 2, mutationGeneration: 0 } : undefined);
    if (reference.kind === 'source') {
      return sources.find(document => document.id === reference.id) ?? snapshot(reference.id);
    }
    if (reference.kind === 'card') return snapshot(reference.id, cards.get(reference.id));
    return snapshot(reference.id, tombstones.get(reference.id));
  };
  const transactions = { count: 0 };
  const transaction = {
    get: async (reference: FakeReference | typeof root) => {
      if (reference === root) return root.get();
      return read(reference as FakeReference);
    },
    getAll: async (...references: FakeReference[]) => {
      if (references.length === 0) throw new Error('Transaction.getAll requires at least one reference.');
      return references.map(read);
    },
    set: () => { writes.count += 1; },
    delete: () => { writes.count += 1; },
  };
  const database = {
    collection: () => ({ doc: () => owner }),
    runTransaction: async (callback: (value: typeof transaction) => Promise<unknown>) => {
      transactions.count += 1;
      return callback(transaction);
    },
  } as unknown as Firestore;
  return { database, transactions, writes };
};

describe('Firestore legacy migration rollback preflight', () => {
  it('performs zero restore writes when a later plan tombstone differs', async () => {
    const { database, writes } = createRollbackPreflightFake();

    await expect(rollbackLegacyLibraryMigration(database, 'owner-1', 'query-v2'))
      .rejects.toThrow('A migration tombstone changed after apply; automatic rollback was refused.');
    expect(writes.count).toBe(0);
  });

  it('rejects replay under a different rollback workflow execution before writes', async () => {
    const persistedIdentity = { migrationRunId: '123456789', migrationRunAttempt: 1 };
    const requestedIdentity = { migrationRunId: '987654321', migrationRunAttempt: 1 };
    const { database, transactions, writes } = createRollbackPreflightFake(true, persistedIdentity);

    await expect(rollbackLegacyLibraryMigration(
      database,
      'owner-1',
      'query-v2',
      requestedIdentity,
    )).rejects.toThrow(/execution authorization/i);
    expect(transactions.count).toBe(0);
    expect(writes.count).toBe(0);
  });

  it('restores all bounded plans in one transaction without duplicate source writes', async () => {
    const { database, transactions, writes } = createRollbackPreflightFake(true);

    await expect(rollbackLegacyLibraryMigration(database, 'owner-1', 'query-v2')).resolves.toBeUndefined();
    expect(transactions.count).toBe(1);
    expect(writes.count).toBe(11);
  });

  it('restores an empty completed migration without an empty getAll call', async () => {
    const { database, transactions, writes } = createRollbackPreflightFake(true, undefined, true);

    await expect(rollbackLegacyLibraryMigration(database, 'owner-1', 'query-v2')).resolves.toBeUndefined();
    expect(transactions.count).toBe(1);
    expect(writes.count).toBe(3);
  });
});
