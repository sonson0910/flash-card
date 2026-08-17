import { describe, expect, it } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';
import {
  createFirestoreLegacyLibraryMigrationStore,
  LegacyLibraryExecutionChangedError,
  LegacyLibraryGenerationChangedError,
} from '../src/legacyLibraryMigrationFirestore.js';
import { LegacyLibrarySourceLimitError } from '../src/legacyLibraryMigration.js';

type FakeReference = {
  kind: 'card' | 'reservation';
  id: string;
  word?: string;
};

const missingSnapshot = (id = '') => ({
  id,
  exists: false,
  data: () => undefined,
});

const createLargeLibraryReadFake = (
  cardCount: number,
  libraryEpochs: readonly number[] = [7],
  migrationComplete = false,
  mutationGenerations: readonly number[] = [0],
  completedMigrationVersion: 2 | 3 = 2,
  executionIdentity?: { migrationRunId: string; migrationRunAttempt: number },
) => {
  const cards = Array.from({ length: cardCount }, (_, index) => ({
    id: `zlegacy-${String(index).padStart(5, '0')}`,
    data: () => ({ word: `word-${index}`, translation: 'translation' }),
  }));
  const calls = { queryLimit: 0, cardQueryDocuments: 0, lookupReferences: 0 };
  let cursor: string | undefined;
  let libraryStateReads = 0;

  const cardsCollection = {
    orderBy: () => cardsCollection,
    startAfter: (nextCursor: string) => {
      cursor = nextCursor;
      return cardsCollection;
    },
    limit: (value: number) => {
      calls.queryLimit = value;
      return cardsCollection;
    },
    get: async () => {
      const page = cards.filter(card => !cursor || card.id > cursor).slice(0, calls.queryLimit);
      calls.cardQueryDocuments += page.length;
      return { docs: page };
    },
    doc: (id: string): FakeReference => ({ kind: 'card', id }),
  };
  const profileCollection = {
    doc: (id: string) => ({
      get: async () => {
        if (id === 'query_migration' && migrationComplete) {
          return {
            exists: true,
            data: () => completedMigrationVersion === 3 ? ({
              migrationVersion: 3,
              jobId: 'query-v2',
              phase: 'complete',
              complete: true,
              completedMutationGeneration: 0,
              ...(executionIdentity ?? {}),
            }) : ({
              migrationVersion: 2,
              jobId: 'query-v2',
              complete: true,
              lastDocumentId: null,
              scanned: 0,
            }),
          };
        }
        if (id !== 'library_state') return missingSnapshot(id);
        const libraryEpoch = libraryEpochs.at(libraryStateReads) ?? libraryEpochs.at(-1) ?? 0;
        const mutationGeneration = mutationGenerations.at(libraryStateReads)
          ?? mutationGenerations.at(-1) ?? 0;
        libraryStateReads += 1;
        return { exists: true, data: () => ({ libraryEpoch, mutationGeneration }) };
      },
    }),
  };
  const owner = {
    collection: (name: string) => name === 'cards' ? cardsCollection : profileCollection,
  };
  const database = {
    collection: () => ({ doc: () => owner }),
    getAll: async (...references: FakeReference[]) => {
      calls.lookupReferences += references.length;
      return references.map(reference => missingSnapshot(reference.id));
    },
  } as unknown as Firestore;
  return { database, calls };
};

describe('Firestore legacy migration page reads', () => {
  it('limits a 10,000-card owner page and its reservation lookups to batch scale', async () => {
    const batchSize = 100;
    const { database, calls } = createLargeLibraryReadFake(10_000);
    const store = createFirestoreLegacyLibraryMigrationStore(database);

    const page = await store.readPage('owner-1', { jobId: 'query-v2', batchSize });

    expect(page.sourceCards).toHaveLength(batchSize);
    expect(page.hasMore).toBe(true);
    expect(calls.queryLimit).toBe(batchSize + 1);
    expect(calls.cardQueryDocuments).toBe(batchSize + 1);
    expect(calls.lookupReferences).toBe(batchSize * 2);
  });

  it('rejects a page when its library generation changes during page reads', async () => {
    const { database } = createLargeLibraryReadFake(1, [7, 8]);
    const store = createFirestoreLegacyLibraryMigrationStore(database);

    await expect(store.readPage('owner-1', { jobId: 'query-v2', batchSize: 1 }))
      .rejects.toBeInstanceOf(LegacyLibraryGenerationChangedError);
  });

  it('rejects a completed migration page when its generation changes during the read', async () => {
    const { database } = createLargeLibraryReadFake(0, [7, 8], true);
    const store = createFirestoreLegacyLibraryMigrationStore(database);

    await expect(store.readPage('owner-1', { jobId: 'query-v2', batchSize: 1 }))
      .rejects.toBeInstanceOf(LegacyLibraryGenerationChangedError);
  });

  it('treats a missing owner generation as zero', async () => {
    const { database } = createLargeLibraryReadFake(1, [7]);
    const store = createFirestoreLegacyLibraryMigrationStore(database);

    await expect(store.readPage('owner-1', { jobId: 'query-v2', batchSize: 1 }))
      .resolves.toMatchObject({ libraryEpoch: 7, mutationGeneration: 0 });
  });

  it('rejects a page when mutation generation changes during page reads', async () => {
    const { database } = createLargeLibraryReadFake(1, [7], false, [4, 5]);
    const store = createFirestoreLegacyLibraryMigrationStore(database);

    await expect(store.readPage('owner-1', { jobId: 'query-v2', batchSize: 1 }))
      .rejects.toBeInstanceOf(LegacyLibraryGenerationChangedError);
  });

  it('does not trust a version-two complete marker', async () => {
    const { database } = createLargeLibraryReadFake(0, [7], true);
    const store = createFirestoreLegacyLibraryMigrationStore(database);

    await expect(store.readPage('owner-1', { jobId: 'query-v2', batchSize: 1 }))
      .resolves.toMatchObject({ phase: 'apply', alreadyComplete: false, mutationGeneration: 0 });
  });

  it('keeps a valid v3 completion after later owner mutations', async () => {
    const { database } = createLargeLibraryReadFake(0, [7], true, [4, 5], 3);
    const store = createFirestoreLegacyLibraryMigrationStore(database);

    await expect(store.readPage('owner-1', { jobId: 'query-v2', batchSize: 1 }))
      .resolves.toMatchObject({ phase: 'complete', alreadyComplete: true, mutationGeneration: 4 });
    await expect(store.readPage('owner-1', { jobId: 'query-v2', batchSize: 1 }))
      .resolves.toMatchObject({ phase: 'complete', alreadyComplete: true, mutationGeneration: 5 });
  });

  it('rejects resuming persisted Admin progress under a different workflow execution', async () => {
    const persistedIdentity = { migrationRunId: '123456789', migrationRunAttempt: 1 };
    const requestedIdentity = { migrationRunId: '987654321', migrationRunAttempt: 1 };
    const { database } = createLargeLibraryReadFake(0, [7], true, [4], 3, persistedIdentity);
    const store = createFirestoreLegacyLibraryMigrationStore(database, requestedIdentity);

    await expect(store.readPage('owner-1', { jobId: 'query-v2', batchSize: 1 }))
      .rejects.toBeInstanceOf(LegacyLibraryExecutionChangedError);
  });

  it('allows the exact authorized workflow execution to read its persisted progress', async () => {
    const executionIdentity = { migrationRunId: '123456789', migrationRunAttempt: 1 };
    const { database } = createLargeLibraryReadFake(0, [7], true, [4], 3, executionIdentity);
    const store = createFirestoreLegacyLibraryMigrationStore(database, executionIdentity);

    await expect(store.readPage('owner-1', { jobId: 'query-v2', batchSize: 1 }))
      .resolves.toMatchObject({ phase: 'complete', alreadyComplete: true });
  });

  it('rejects the 10,001st persisted source card before lookups', async () => {
    const { database, calls } = createLargeLibraryReadFake(10_001);
    const store = createFirestoreLegacyLibraryMigrationStore(database);

    await expect(store.readPage('owner-1', {
      jobId: 'query-v2', batchSize: 100, cursor: 'zlegacy-09999', scannedBefore: 10_000,
    })).rejects.toBeInstanceOf(LegacyLibrarySourceLimitError);
    expect(calls.lookupReferences).toBe(0);
  });
});
