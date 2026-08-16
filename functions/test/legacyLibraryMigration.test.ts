import { describe, expect, it } from 'vitest';
import {
  buildLegacyLibraryMigrationBatch,
  LegacyLibraryGenerationChangedError,
  LegacyLibrarySourceLimitError,
  MAX_BROWSER_LEGACY_LIBRARY_MIGRATION_SOURCE_CARDS,
  legacyLibraryMigrationCompletionBatchLimit,
  runLegacyLibraryMigration,
  runLegacyLibraryMigrationPreflight,
  runLegacyLibraryMigrationToCompletion,
  type LegacyLibraryMigrationPage,
  type LegacyLibraryMigrationPreflightEvidence,
  type LegacyLibraryMigrationStore,
} from '../src/legacyLibraryMigration.js';
import {
  createCanonicalCleanupCardId,
  normalizeCleanupWord,
  type CleanupCard,
  type DuplicateCleanupPlan,
} from '../src/duplicateCleanup.js';

const legacy = (id: string, word: string, overrides: Record<string, unknown> = {}): CleanupCard => ({
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

type ReadCounters = {
  cardReads: number[];
  reservationReads: number[];
  preflightReads: number;
  preflightWrites: number;
};

const createPagedStore = (
  initialCards: CleanupCard[],
  config: {
    libraryEpochs?: readonly number[];
    mutationGenerations?: readonly number[];
    reservations?: ReadonlyMap<string, unknown>;
  } = {},
): {
  store: LegacyLibraryMigrationStore;
  counters: ReadCounters;
} => {
  let cards = new Map(initialCards.map(card => [card.id, card]));
  const reservations = new Map(config.reservations);
  let cursor: string | null = null;
  let scanned = 0;
  let phase: 'apply' | 'verify' = 'apply';
  let complete = false;
  let pageReads = 0;
  let preflight: LegacyLibraryMigrationPreflightEvidence | null = null;
  const counters: ReadCounters = {
    cardReads: [], reservationReads: [], preflightReads: 0, preflightWrites: 0,
  };

  const readPage = async (
    _ownerId: string,
    options: {
      jobId: string;
      batchSize: number;
      cursor?: string | null;
      scannedBefore?: number;
      phase?: 'apply' | 'verify';
    },
  ): Promise<LegacyLibraryMigrationPage> => {
    const libraryEpoch = config.libraryEpochs?.[pageReads] ?? 3;
    const mutationGeneration = config.mutationGenerations?.[pageReads] ?? 0;
    pageReads += 1;
    if (complete) {
      return {
        libraryEpoch,
        mutationGeneration,
        phase: 'complete',
        sourceCards: [],
        canonicalCards: new Map(),
        reservations: new Map(),
        progressCursor: cursor,
        lastDocumentId: cursor,
        hasMore: false,
        scannedBefore: scanned,
        alreadyComplete: true,
      };
    }
    const pageCursor = options.cursor === undefined ? cursor : options.cursor;
    const pageScanned = options.cursor === undefined ? scanned : options.scannedBefore ?? scanned;
    const pagePhase = options.cursor === undefined ? phase : options.phase ?? 'apply';
    const ordered = [...cards.values()]
      .filter(card => !pageCursor || card.id > pageCursor)
      .sort((left, right) => left.id.localeCompare(right.id, 'en-US'));
    const sourceCards = ordered.slice(0, options.batchSize);
    const words = [...new Set(sourceCards.map(card => (
      normalizeCleanupWord(card.normalizedWord) || normalizeCleanupWord(card.word)
    )).filter(Boolean))];
    const sourceIds = new Set(sourceCards.map(card => card.id));
    const canonicalCards = new Map<string, CleanupCard>();
    for (const word of words) {
      const canonicalId = createCanonicalCleanupCardId(word);
      const canonical = cards.get(canonicalId);
      if (canonical && !sourceIds.has(canonicalId)) canonicalCards.set(word, canonical);
    }
    counters.cardReads.push(sourceCards.length + canonicalCards.size);
    counters.reservationReads.push(words.length);
    return {
      libraryEpoch,
      mutationGeneration,
      phase: pagePhase,
      sourceCards,
      canonicalCards,
      reservations: new Map(words.flatMap(word => (
        reservations.has(word) ? [[word, reservations.get(word)]] : []
      ))),
      progressCursor: pageCursor,
      lastDocumentId: sourceCards.at(-1)?.id ?? pageCursor,
      hasMore: ordered.length > sourceCards.length,
      scannedBefore: pageScanned,
      alreadyComplete: false,
    };
  };

  const apply = async (_ownerId: string, _jobId: string, plan: DuplicateCleanupPlan): Promise<void> => {
    cards.set(plan.primaryId, plan.merged);
    for (const loserId of plan.loserIds) cards.delete(loserId);
    reservations.set(plan.normalizedWord, matchingReservation(plan.primaryId, plan.normalizedWord));
  };

  return {
    counters,
    store: {
      readPage,
      readPreflight: async () => {
        counters.preflightReads += 1;
        return preflight;
      },
      storePreflight: async (_ownerId, _jobId, evidence) => {
        counters.preflightWrites += 1;
        preflight = evidence;
      },
      backup: async () => undefined,
      apply,
      advanceProgress: async (_ownerId, _jobId, _epoch, _generation, _expected, next) => {
        phase = next.phase;
        cursor = next.cursor;
        scanned = next.scanned;
      },
      markComplete: async () => { complete = true; },
    },
  };
};

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
    expect(batch.scannedSourceCount).toBe(4);
    expect(batch.selectedSourceCount).toBe(3);
    expect(batch.plans.map(plan => plan.primaryId)).toEqual(['word-migrate', 'word-quite']);
    expect(batch.plans[1].strongestSourceId).toBe('duplicate-strong');
  });

  it('reports malformed cards while retaining a bounded source slice', () => {
    const batch = buildLegacyLibraryMigrationBatch({
      libraryEpoch: 0,
      cards: [legacy('invalid', '   '), legacy('valid', 'valid')],
      reservations: new Map(),
    }, { jobId: 'query-v2', batchSize: 1 });

    expect(batch.invalidCardIds).toEqual(['invalid']);
    expect(batch.scannedSourceCount).toBe(1);
    expect(batch.plans).toEqual([]);
  });
});

describe('legacy library migration orchestration', () => {
  it('moves a persisted cursor through bounded pages and completes after a clean verification scan', async () => {
    const { store, counters } = createPagedStore(Array.from({ length: 90 }, (_, index) => (
      legacy(`zlegacy-${String(index).padStart(3, '0')}`, `word-${index}`)
    )));

    await expect(runLegacyLibraryMigrationToCompletion(store, 'owner-1', {
      jobId: 'query-v2', batchSize: 40, maximumBatches: 100,
    })).resolves.toMatchObject({
      migrated: 90,
      scanned: 180,
      complete: true,
      remaining: 0,
      invalid: 0,
    });
    expect(counters.cardReads).toEqual([40, 40, 10, 40, 40, 10, 40, 40, 10]);
    expect(counters.reservationReads).toEqual([40, 40, 10, 40, 40, 10, 40, 40, 10]);
  });

  it('budgets complete apply and verification scans at the supported source limit', async () => {
    const batchSize = 100;
    const words = Array.from({ length: 10_000 }, (_, index) => `word-${String(index).padStart(5, '0')}`);
    const cards = words.map(word => legacy(createCanonicalCleanupCardId(word), word, {
      normalizedWord: word,
      schemaVersion: 2,
      revision: 1,
      libraryEpoch: 3,
      createdAt: '2026-01-01T00:00:00.000Z',
      bookmarked: false,
      customDeck: null,
      difficulty: 'unrated',
    }));
    const reservations = new Map(words.map(word => [
      word,
      matchingReservation(createCanonicalCleanupCardId(word), word),
    ]));
    const { store, counters } = createPagedStore(cards, { reservations });

    await expect(runLegacyLibraryMigrationToCompletion(store, 'owner-1', {
      jobId: 'query-v2',
      batchSize,
      maximumBatches: legacyLibraryMigrationCompletionBatchLimit(batchSize),
    })).resolves.toMatchObject({
      migrated: 0,
      scanned: 20_000,
      complete: true,
      remaining: 0,
      invalid: 0,
    });
    expect(legacyLibraryMigrationCompletionBatchLimit(batchSize)).toBe(200);
    expect(counters.cardReads).toHaveLength(300);
    expect(counters.cardReads.every(reads => reads === batchSize)).toBe(true);
  });

  it('accepts exactly 3,000 source cards within the browser 30-call budget', async () => {
    const words = Array.from({ length: MAX_BROWSER_LEGACY_LIBRARY_MIGRATION_SOURCE_CARDS }, (
      _value,
      index,
    ) => `word-${String(index).padStart(4, '0')}`);
    const cards = words.map(word => legacy(createCanonicalCleanupCardId(word), word, {
      normalizedWord: word,
      schemaVersion: 2,
      revision: 1,
      libraryEpoch: 3,
      createdAt: '2026-01-01T00:00:00.000Z',
      bookmarked: false,
      customDeck: null,
      difficulty: 'unrated',
    }));
    const reservations = new Map(words.map(word => [
      word,
      matchingReservation(createCanonicalCleanupCardId(word), word),
    ]));
    const { store, counters } = createPagedStore(cards, { reservations });

    let result = await runLegacyLibraryMigration(store, 'owner-1', {
      jobId: 'query-v2', batchSize: 100, dryRun: false,
    });
    let calls = 1;
    while (!result.complete) {
      result = await runLegacyLibraryMigration(store, 'owner-1', {
        jobId: 'query-v2', batchSize: 100, dryRun: false,
      });
      calls += 1;
    }

    expect(result).toMatchObject({ complete: true, remaining: 0, invalid: 0 });
    expect(calls).toBe(30);
    // One write-free preflight, then 30 apply and 30 verification pages.
    expect(counters.cardReads).toHaveLength(90);
    expect(counters.cardReads.every(reads => reads === 100)).toBe(true);
  });

  it('rejects 3,001 browser source cards before preflight or migration writes', async () => {
    const { store, counters } = createPagedStore(Array.from({ length: 3_001 }, (_, index) => (
      legacy(`zlegacy-${String(index).padStart(4, '0')}`, `word-${index}`)
    )));
    const writes = { backup: 0, apply: 0, advance: 0, complete: 0 };
    const writeTrackedStore: LegacyLibraryMigrationStore = {
      ...store,
      backup: async () => { writes.backup += 1; },
      apply: async () => { writes.apply += 1; },
      advanceProgress: async () => { writes.advance += 1; },
      markComplete: async () => { writes.complete += 1; },
    };

    await expect(runLegacyLibraryMigration(writeTrackedStore, 'owner-1', {
      jobId: 'query-v2', batchSize: 100, dryRun: false,
    })).rejects.toMatchObject({
      name: 'LegacyLibrarySourceLimitError',
      maximumSourceCards: MAX_BROWSER_LEGACY_LIBRARY_MIGRATION_SOURCE_CARDS,
    });
    expect(counters.preflightWrites).toBe(0);
    expect(writes).toEqual({ backup: 0, apply: 0, advance: 0, complete: 0 });
    expect(counters.cardReads).toHaveLength(31);
    expect(counters.cardReads.at(-1)).toBe(1);
  });

  it('rejects oversized persisted browser preflight evidence before mutation', async () => {
    const { store, counters } = createPagedStore([]);
    const writes = { backup: 0, apply: 0, advance: 0, complete: 0 };
    const stalePreflightStore: LegacyLibraryMigrationStore = {
      ...store,
      readPreflight: async () => ({
        libraryEpoch: 3,
        mutationGeneration: 0,
        result: {
          scanned: 3_001,
          pending: 0,
          merged: 0,
          invalid: 0,
          preflightComplete: true,
          migrationComplete: true,
        },
      }),
      backup: async () => { writes.backup += 1; },
      apply: async () => { writes.apply += 1; },
      advanceProgress: async () => { writes.advance += 1; },
      markComplete: async () => { writes.complete += 1; },
    };

    await expect(runLegacyLibraryMigration(stalePreflightStore, 'owner-1', {
      jobId: 'query-v2', batchSize: 100, dryRun: false,
    })).rejects.toMatchObject({
      maximumSourceCards: MAX_BROWSER_LEGACY_LIBRARY_MIGRATION_SOURCE_CARDS,
    });
    expect(counters.cardReads).toEqual([]);
    expect(writes).toEqual({ backup: 0, apply: 0, advance: 0, complete: 0 });
  });

  it('rejects a 10,000-card browser library while the protected operator supports it', async () => {
    const words = Array.from({ length: 10_000 }, (_, index) => `word-${String(index).padStart(5, '0')}`);
    const cards = words.map(word => legacy(createCanonicalCleanupCardId(word), word, {
      normalizedWord: word,
      schemaVersion: 2,
      revision: 1,
      libraryEpoch: 3,
      createdAt: '2026-01-01T00:00:00.000Z',
      bookmarked: false,
      customDeck: null,
      difficulty: 'unrated',
    }));
    const reservations = new Map(words.map(word => [
      word,
      matchingReservation(createCanonicalCleanupCardId(word), word),
    ]));
    const { store: browserStore, counters: browserCounters } = createPagedStore(cards, { reservations });
    const { store: operatorStore } = createPagedStore(cards, { reservations });

    await expect(runLegacyLibraryMigration(browserStore, 'owner-1', {
      jobId: 'query-v2', batchSize: 100, dryRun: false,
    })).rejects.toMatchObject({
      name: 'LegacyLibrarySourceLimitError',
      maximumSourceCards: MAX_BROWSER_LEGACY_LIBRARY_MIGRATION_SOURCE_CARDS,
    });
    expect(browserCounters.preflightWrites).toBe(0);

    await expect(runLegacyLibraryMigrationToCompletion(operatorStore, 'owner-1', {
      jobId: 'query-v2',
      batchSize: 100,
      maximumBatches: legacyLibraryMigrationCompletionBatchLimit(100),
    })).resolves.toMatchObject({ complete: true, remaining: 0, invalid: 0 });
  });

  it('resumes a 1,501-card browser migration within 30 calls without repeating preflight', async () => {
    const currentWords = Array.from({ length: 1_401 }, (_, index) => (
      `current-${String(index).padStart(4, '0')}`
    ));
    const legacyWords = Array.from({ length: 100 }, (_, index) => (
      `legacy-${String(index).padStart(3, '0')}`
    ));
    const currentCards = currentWords.map(word => legacy(createCanonicalCleanupCardId(word), word, {
      normalizedWord: word,
      schemaVersion: 2,
      revision: 1,
      libraryEpoch: 3,
      createdAt: '2026-01-01T00:00:00.000Z',
      bookmarked: false,
      customDeck: null,
      difficulty: 'unrated',
    }));
    const legacyCards = legacyWords.map((word, index) => (
      legacy(`zlegacy-${String(index).padStart(3, '0')}`, word)
    ));
    const reservations = new Map(currentWords.map(word => [
      word,
      matchingReservation(createCanonicalCleanupCardId(word), word),
    ]));
    const { store, counters } = createPagedStore([...currentCards, ...legacyCards], { reservations });

    let result = await runLegacyLibraryMigration(store, 'owner-1', {
      jobId: 'query-v2', batchSize: 100, dryRun: false,
    });
    let calls = 1;
    expect(result).toMatchObject({ complete: false, scanned: 200 });

    // Resume from persisted apply cursors as a new browser action would.
    while (!result.complete) {
      result = await runLegacyLibraryMigration(store, 'owner-1', {
        jobId: 'query-v2', batchSize: 100, dryRun: false,
      });
      calls += 1;
    }

    expect(result).toMatchObject({ complete: true, remaining: 0, invalid: 0 });
    expect(calls).toBe(16);
    expect(calls).toBeLessThanOrEqual(30);
    expect(counters.preflightWrites).toBe(1);
    expect(counters.preflightReads).toBe(calls);
    // One complete 16-page preflight, then exactly 16 apply and 16 verify pages.
    expect(counters.cardReads).toHaveLength(48);
    expect(counters.cardReads.slice(0, 16)).toEqual([
      ...Array.from({ length: 15 }, () => 100), 1,
    ]);
    expect(counters.cardReads.slice(16)).toHaveLength(32);
  });

  it('does not apply more than the configured number of migration batches', async () => {
    const { store, counters } = createPagedStore([
      legacy('legacy-a', 'alpha'),
      legacy('legacy-b', 'beta'),
    ]);
    const appliedWords: string[] = [];
    const boundedStore: LegacyLibraryMigrationStore = {
      ...store,
      apply: async (ownerId, jobId, plan, expectedEpoch, expectedGeneration, expected) => {
        appliedWords.push(plan.normalizedWord);
        await store.apply(ownerId, jobId, plan, expectedEpoch, expectedGeneration, expected);
      },
    };

    await expect(runLegacyLibraryMigrationToCompletion(boundedStore, 'owner-1', {
      jobId: 'query-v2', batchSize: 1, maximumBatches: 1,
    })).rejects.toThrow('did not converge within 1 batches');
    expect(appliedWords).toEqual(['alpha']);
    expect(counters.cardReads).toEqual([1, 1, 1]);
  });

  it('requires a clean from-start verification page after the final apply page', async () => {
    const { store, counters } = createPagedStore([legacy('zlegacy-a', 'alpha')]);

    await expect(runLegacyLibraryMigrationToCompletion(store, 'owner-1', {
      jobId: 'query-v2', batchSize: 1, maximumBatches: 2,
    })).resolves.toMatchObject({ migrated: 1, scanned: 2, complete: true });
    expect(counters.cardReads).toEqual([1, 1, 1]);
  });

  it('bounds card and reservation reads for every batch of a large library', async () => {
    const batchSize = 100;
    const { store, counters } = createPagedStore(Array.from({ length: 10_000 }, (_, index) => (
      legacy(`zlegacy-${String(index).padStart(5, '0')}`, `word-${index}`)
    )));

    const first = await runLegacyLibraryMigration(store, 'owner-1', {
      jobId: 'query-v2', batchSize, dryRun: true,
    });
    const second = await runLegacyLibraryMigration(store, 'owner-1', {
      jobId: 'query-v2', batchSize, dryRun: true,
    });

    expect(first).toMatchObject({ scanned: batchSize, complete: false });
    expect(second).toMatchObject({ scanned: batchSize, complete: false });
    expect(counters.cardReads).toEqual([batchSize, batchSize]);
    expect(counters.reservationReads).toEqual([batchSize, batchSize]);
    expect(counters.cardReads.every(reads => reads <= batchSize * 2)).toBe(true);
    expect(counters.reservationReads.every(reads => reads <= batchSize)).toBe(true);
  });

  it('reports pending valid cards across pages separately from preflight completion', async () => {
    const { store, counters } = createPagedStore([
      legacy('legacy-a', 'alpha'),
      legacy('legacy-b', 'beta'),
    ]);

    await expect(runLegacyLibraryMigrationPreflight(store, 'owner-1', {
      jobId: 'query-v2', batchSize: 1, maximumBatches: 10,
    })).resolves.toEqual({
      scanned: 2,
      pending: 2,
      merged: 0,
      invalid: 0,
      preflightComplete: true,
      migrationComplete: false,
    });
    expect(counters.cardReads).toEqual([1, 1]);
  });

  it('calculates pending and merged groups from the complete bounded scan', async () => {
    const cards = [
      legacy('word-alpha', 'alpha', {
        normalizedWord: 'alpha', schemaVersion: 2, revision: 5, libraryEpoch: 3,
        createdAt: '2026-01-01T00:00:00.000Z', bookmarked: false,
        customDeck: null, difficulty: 'unrated',
      }),
      legacy('zlegacy-alpha', 'alpha'),
      legacy('zlegacy-beta-a', 'beta'),
      legacy('zlegacy-beta-b', ' beta '),
    ];
    const config = {
      reservations: new Map([['alpha', matchingReservation('word-alpha', 'alpha')]]),
    };
    const { store: pageByPageStore } = createPagedStore(cards, config);
    const { store: singlePageStore } = createPagedStore(cards, config);

    const pageByPage = await runLegacyLibraryMigrationPreflight(pageByPageStore, 'owner-1', {
      jobId: 'query-v2', batchSize: 1, maximumBatches: 10,
    });
    const singlePage = await runLegacyLibraryMigrationPreflight(singlePageStore, 'owner-1', {
      jobId: 'query-v2', batchSize: 4, maximumBatches: 10,
    });

    expect(pageByPage).toEqual({
      scanned: 4,
      pending: 4,
      merged: 2,
      invalid: 0,
      preflightComplete: true,
      migrationComplete: false,
    });
    expect(singlePage).toEqual(pageByPage);
  });

  it('rejects 101 projected rollback sources before any migration write', async () => {
    const { store } = createPagedStore(Array.from({ length: 101 }, (_, index) => (
      legacy(`legacy-${String(index).padStart(3, '0')}`, `word-${index}`)
    )));
    const calls = { backup: 0, apply: 0, advance: 0, complete: 0 };
    const writeFreeStore: LegacyLibraryMigrationStore = {
      ...store,
      backup: async () => { calls.backup += 1; },
      apply: async () => { calls.apply += 1; },
      advanceProgress: async () => { calls.advance += 1; },
      markComplete: async () => { calls.complete += 1; },
    };

    await expect(runLegacyLibraryMigrationToCompletion(writeFreeStore, 'owner-1', {
      jobId: 'query-v2', batchSize: 100, maximumBatches: 100,
    })).rejects.toBeInstanceOf(LegacyLibrarySourceLimitError);
    expect(calls).toEqual({ backup: 0, apply: 0, advance: 0, complete: 0 });
  });

  it('allows exactly 100 projected rollback sources after a complete preflight', async () => {
    const { store } = createPagedStore(Array.from({ length: 100 }, (_, index) => (
      legacy(`legacy-${String(index).padStart(3, '0')}`, `word-${index}`)
    )));

    await expect(runLegacyLibraryMigrationToCompletion(store, 'owner-1', {
      jobId: 'query-v2', batchSize: 100, maximumBatches: 100,
    })).resolves.toMatchObject({ migrated: 100, complete: true, invalid: 0 });
  });

  it('fails closed when a later preflight page has a different library generation', async () => {
    const { store } = createPagedStore([
      legacy('legacy-a', 'alpha'),
      legacy('legacy-b', 'beta'),
    ], { libraryEpochs: [3, 4] });

    await expect(runLegacyLibraryMigrationPreflight(store, 'owner-1', {
      jobId: 'query-v2', batchSize: 1, maximumBatches: 10,
    })).rejects.toBeInstanceOf(LegacyLibraryGenerationChangedError);
  });

  it('fails closed rather than reuse persisted preflight evidence after an owner generation change', async () => {
    const { store, counters } = createPagedStore([
      legacy('legacy-a', 'alpha'),
    ], { mutationGenerations: [0, 1] });
    const calls = { backup: 0, apply: 0, advance: 0, complete: 0 };
    const guardedStore: LegacyLibraryMigrationStore = {
      ...store,
      backup: async () => { calls.backup += 1; },
      apply: async () => { calls.apply += 1; },
      advanceProgress: async () => { calls.advance += 1; },
      markComplete: async () => { calls.complete += 1; },
    };

    await expect(runLegacyLibraryMigration(guardedStore, 'owner-1', {
      jobId: 'query-v2', batchSize: 100, dryRun: false,
    })).rejects.toBeInstanceOf(LegacyLibraryGenerationChangedError);
    expect(counters.preflightWrites).toBe(1);
    expect(calls).toEqual({ backup: 0, apply: 0, advance: 0, complete: 0 });
  });

  it('fails without a result when the preflight scan reaches its batch limit', async () => {
    const { store, counters } = createPagedStore([
      legacy('legacy-a', 'alpha'),
      legacy('legacy-b', 'beta'),
      legacy('legacy-c', 'gamma'),
    ]);

    await expect(runLegacyLibraryMigrationPreflight(store, 'owner-1', {
      jobId: 'query-v2', batchSize: 1, maximumBatches: 2,
    })).rejects.toThrow('did not converge within 2 batches');
    expect(counters.cardReads).toEqual([1, 1]);
  });

  it('keeps dry-run write-free and does not persist cursor progress', async () => {
    const { store } = createPagedStore([legacy('legacy', 'Migrate')]);
    const calls = { backup: 0, apply: 0, advance: 0, complete: 0 };
    const writeFreeStore: LegacyLibraryMigrationStore = {
      ...store,
      backup: async () => { calls.backup += 1; },
      apply: async () => { calls.apply += 1; },
      advanceProgress: async () => { calls.advance += 1; },
      markComplete: async () => { calls.complete += 1; },
    };

    await expect(runLegacyLibraryMigration(writeFreeStore, 'owner-1', {
      jobId: 'query-v2', batchSize: 100, dryRun: true,
    })).resolves.toMatchObject({ migrated: 0, scanned: 1, complete: false, remaining: 0 });
    expect(calls).toEqual({ backup: 0, apply: 0, advance: 0, complete: 0 });
  });

  it('moves an empty apply pass into verification before writing complete', async () => {
    const { store } = createPagedStore([]);
    await expect(runLegacyLibraryMigration(store, 'owner-1', {
      jobId: 'query-v2', batchSize: 100, dryRun: false,
    })).resolves.toMatchObject({ complete: false, remaining: 1 });
    await expect(runLegacyLibraryMigration(store, 'owner-1', {
      jobId: 'query-v2', batchSize: 100, dryRun: false,
    })).resolves.toMatchObject({ complete: true, remaining: 0 });
  });

  it.each(['apply', 'verify'] as const)(
    'rejects page 101 of the persisted %s scan before writes',
    async phase => {
      const calls = { backup: 0, apply: 0, advance: 0, complete: 0 };
      const source = legacy('overflow', 'overflow');
      const store: LegacyLibraryMigrationStore = {
        readPage: async () => ({
          libraryEpoch: 3,
          mutationGeneration: 0,
          phase,
          sourceCards: [source],
          canonicalCards: new Map(),
          reservations: new Map(),
          progressCursor: 'zlegacy-09999',
          lastDocumentId: source.id,
          hasMore: true,
          scannedBefore: 10_000,
          alreadyComplete: false,
        }),
        backup: async () => { calls.backup += 1; },
        apply: async () => { calls.apply += 1; },
        advanceProgress: async () => { calls.advance += 1; },
        markComplete: async () => { calls.complete += 1; },
      };

      await expect(runLegacyLibraryMigration(store, 'owner-1', {
        jobId: 'query-v2', batchSize: 100, dryRun: false,
      })).rejects.toBeInstanceOf(LegacyLibrarySourceLimitError);
      expect(calls).toEqual({ backup: 0, apply: 0, advance: 0, complete: 0 });
    },
  );
});
