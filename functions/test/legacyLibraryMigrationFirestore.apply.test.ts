import { describe, expect, it } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';
import { createFirestoreLegacyLibraryMigrationStore } from '../src/legacyLibraryMigrationFirestore.js';
import { LegacyLibrarySourceLimitError } from '../src/legacyLibraryMigration.js';
import type { DuplicateCleanupPlan } from '../src/duplicateCleanup.js';

type FakeReferenceKind = 'card' | 'plan' | 'profile' | 'reservation' | 'root' | 'source' | 'tombstone';
type FakeReference = { kind: FakeReferenceKind; id: string; collection?: (name: string) => { doc(id: string): FakeReference } };
type FakeSnapshot = { id: string; exists: boolean; data(): Record<string, unknown> | undefined };

type Write = { operation: 'delete' | 'set'; reference: FakeReference };

const snapshot = (id: string, data?: Record<string, unknown>): FakeSnapshot => ({
  id,
  exists: data !== undefined,
  data: () => data,
});

const overflowPlan: DuplicateCleanupPlan = {
  normalizedWord: 'overflow',
  primaryId: 'word-overflow',
  strongestSourceId: 'legacy-overflow',
  loserIds: ['legacy-overflow'],
  merged: { id: 'word-overflow' },
  tombstones: [{
    cardId: 'legacy-overflow',
    opId: 'duplicate-cleanup-job-1-legacy-overflow',
    libraryEpoch: 2,
    revision: 1,
    deletedAt: null,
  }],
};

const createApplyFake = (sourceCount: number) => {
  const writes: Write[] = [];
  const root: FakeReference = {
    kind: 'root',
    id: 'job-1',
    collection: name => ({
      doc: id => ({ kind: name === 'sources' ? 'source' : 'plan', id }),
    }),
  };
  const owner = {
    collection: (name: string) => ({
      doc: (id: string): FakeReference => {
        if (name === 'admin_library_migration_backups') return root;
        const kind: FakeReferenceKind = name === 'cards' ? 'card'
          : name === 'profile' ? 'profile'
            : name === 'card_reservations' ? 'reservation'
              : name === 'card_tombstones' ? 'tombstone' : 'plan';
        return { kind, id };
      },
    }),
  };
  const read = (reference: FakeReference): FakeSnapshot => {
    if (reference.kind === 'root') {
      return snapshot(reference.id, {
        sourceCount,
        libraryEpoch: 2,
        expectedMutationGeneration: 0,
      });
    }
    if (reference.kind === 'profile') {
      return reference.id === 'library_state'
        ? snapshot(reference.id, { libraryEpoch: 2, mutationGeneration: 0 })
        : snapshot(reference.id, {
          migrationVersion: 3,
          jobId: 'job-1',
          phase: 'apply',
          complete: false,
          expectedEpoch: 2,
          expectedMutationGeneration: 0,
          applyCursor: null,
          applyScanned: 0,
          verificationCursor: null,
          verificationScanned: 0,
        });
    }
    if (reference.kind === 'card' && reference.id === 'legacy-overflow') {
      return snapshot(reference.id, { word: 'overflow', translation: 'tràn' });
    }
    return snapshot(reference.id);
  };
  const transaction = {
    get: async (reference: FakeReference) => read(reference),
    getAll: async (...references: FakeReference[]) => references.map(read),
    set: (reference: FakeReference) => { writes.push({ operation: 'set', reference }); },
    delete: (reference: FakeReference) => { writes.push({ operation: 'delete', reference }); },
  };
  const database = {
    collection: () => ({ doc: () => owner }),
    runTransaction: async (callback: (value: typeof transaction) => Promise<unknown>) => callback(transaction),
  } as unknown as Firestore;
  return { database, writes };
};

const applyOverflowPlan = (database: Firestore) => createFirestoreLegacyLibraryMigrationStore(database).apply(
  'owner-1',
  'job-1',
  overflowPlan,
  2,
  0,
  { phase: 'apply', cursor: null, scanned: 0 },
);

describe('Firestore legacy migration apply backup cap', () => {
  it('rejects the 101st unique source backup before migration writes', async () => {
    const { database, writes } = createApplyFake(100);

    await expect(applyOverflowPlan(database)).rejects.toBeInstanceOf(LegacyLibrarySourceLimitError);

    expect(writes).toEqual([]);
  });

  it('allows the 100th unique source backup and applies its migration writes', async () => {
    const { database, writes } = createApplyFake(99);

    await expect(applyOverflowPlan(database)).resolves.toBeUndefined();

    expect(writes).toHaveLength(7);
    expect(writes.map(write => [write.operation, write.reference.kind])).toEqual([
      ['set', 'source'],
      ['set', 'root'],
      ['set', 'plan'],
      ['set', 'card'],
      ['set', 'reservation'],
      ['set', 'tombstone'],
      ['delete', 'card'],
    ]);
  });
});
