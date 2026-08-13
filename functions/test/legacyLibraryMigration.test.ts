import { describe, expect, it } from 'vitest';
import {
  buildLegacyLibraryMigrationBatch,
  runLegacyLibraryMigration,
  type LegacyLibraryMigrationStore,
  type LegacyLibrarySnapshot,
} from '../src/legacyLibraryMigration.js';

const legacy = (id: string, word: string, overrides: Record<string, unknown> = {}) => ({
  id,
  word,
  translation: `translation-${id}`,
  ...overrides,
});

const matchingReservation = (cardId: string, normalizedWord: string) => ({
  schemaVersion: 1,
  cardId,
  normalizedWord,
});

describe('legacy library migration planning', () => {
  it('selects non-canonical and duplicate identities while leaving current cards alone', () => {
    const batch = buildLegacyLibraryMigrationBatch({
      libraryEpoch: 2,
      cards: [
        legacy('legacy-capital', 'Migrate'),
        legacy('duplicate-weak', 'Quite', { reviews: 1, revision: 3 }),
        legacy('duplicate-strong', ' quite ', { reviews: 9, revision: 2 }),
        legacy('word-current', 'current', {
          normalizedWord: 'current', schemaVersion: 2, revision: 5, libraryEpoch: 2,
          createdAt: '2026-01-01T00:00:00.000Z', bookmarked: false,
          customDeck: null, difficulty: 'unrated',
        }),
      ],
      reservations: new Map([
        ['current', matchingReservation('word-current', 'current')],
      ]),
    }, { jobId: 'query-v2', batchSize: 100 });

    expect(batch.invalidCardIds).toEqual([]);
    expect(batch.pendingSourceCount).toBe(3);
    expect(batch.selectedSourceCount).toBe(3);
    expect(batch.plans.map(plan => plan.primaryId)).toEqual(['word-migrate', 'word-quite']);
    expect(batch.plans[1].strongestSourceId).toBe('duplicate-strong');
    expect(batch.complete).toBe(false);
  });

  it('never splits a duplicate identity group at the chunk boundary', () => {
    const batch = buildLegacyLibraryMigrationBatch({
      libraryEpoch: 0,
      cards: [
        legacy('a-1', 'alpha'),
        legacy('a-2', 'ALPHA'),
        legacy('b-1', 'beta'),
      ],
      reservations: new Map(),
    }, { jobId: 'query-v2', batchSize: 1 });

    expect(batch.plans).toHaveLength(1);
    expect(batch.plans[0].normalizedWord).toBe('alpha');
    expect(batch.selectedSourceCount).toBe(2);
    expect(batch.remainingSourceCount).toBe(1);
  });

  it('reports malformed cards and refuses to mark the plan complete', () => {
    const batch = buildLegacyLibraryMigrationBatch({
      libraryEpoch: 0,
      cards: [legacy('invalid', '   ')],
      reservations: new Map(),
    }, { jobId: 'query-v2', batchSize: 100 });

    expect(batch.invalidCardIds).toEqual(['invalid']);
    expect(batch.complete).toBe(false);
    expect(batch.plans).toEqual([]);
  });

  it('refuses an identity group that cannot fit in one bounded migration transaction', () => {
    const cards = Array.from({ length: 101 }, (_, index) => (
      legacy(`duplicate-${index}`, 'oversized')
    ));

    expect(() => buildLegacyLibraryMigrationBatch({
      libraryEpoch: 0,
      cards,
      reservations: new Map(),
    }, { jobId: 'query-v2', batchSize: 100 })).toThrow(
      'Legacy identity "oversized" contains 101 cards; the maximum safe group size is 100.',
    );
  });
});

describe('legacy library migration orchestration', () => {
  it('keeps dry-run write-free and applies a resumable chunk before final verification', async () => {
    const snapshot: LegacyLibrarySnapshot = {
      libraryEpoch: 1,
      cards: [legacy('legacy', 'Migrate')],
      reservations: new Map(),
    };
    const calls = { backup: 0, apply: 0, complete: 0 };
    const store: LegacyLibraryMigrationStore = {
      read: async () => snapshot,
      backup: async () => { calls.backup += 1; },
      apply: async () => { calls.apply += 1; },
      markComplete: async () => { calls.complete += 1; },
    };

    const dryRun = await runLegacyLibraryMigration(store, 'owner-1', {
      jobId: 'query-v2', batchSize: 100, dryRun: true,
    });
    expect(dryRun).toMatchObject({ migrated: 0, scanned: 1, complete: false, remaining: 1 });
    expect(calls).toEqual({ backup: 0, apply: 0, complete: 0 });

    const applied = await runLegacyLibraryMigration(store, 'owner-1', {
      jobId: 'query-v2', batchSize: 100, dryRun: false,
    });
    expect(applied).toMatchObject({ migrated: 1, scanned: 1, complete: false, remaining: 0 });
    expect(calls).toEqual({ backup: 1, apply: 1, complete: 0 });
  });

  it('marks completion only after a clean read finds no pending or invalid cards', async () => {
    let backupCalls = 0;
    const store: LegacyLibraryMigrationStore = {
      read: async () => ({ libraryEpoch: 3, cards: [], reservations: new Map() }),
      backup: async () => { backupCalls += 1; },
      apply: async () => { throw new Error('must not apply'); },
      markComplete: async () => undefined,
    };

    await expect(runLegacyLibraryMigration(store, 'owner-1', {
      jobId: 'query-v2', batchSize: 100, dryRun: false,
    })).resolves.toEqual({
      migrated: 0,
      merged: 0,
      scanned: 0,
      complete: true,
      remaining: 0,
      invalid: 0,
    });
    expect(backupCalls).toBe(1);
  });
});
