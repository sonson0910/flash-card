import { describe, expect, it } from 'vitest';
import { Timestamp } from 'firebase-admin/firestore';
import {
  buildLegacyLibraryMigrationBatch,
  canonicalLegacyLibraryUtf8Bytes,
  createLegacyLibraryInitialRevision,
  createLegacyLibrarySourceDescriptor,
  digestLegacyLibraryDiscoveryPage,
  digestLegacyLibraryValue,
  MAX_DISCOVERY_PAGE_BYTES,
  nextLegacyLibrarySourceRevision,
  runLegacyLibraryDiscovery,
  type LegacyLibraryDiscoveryJob,
  type LegacyLibraryDiscoveryStore,
  type LegacyLibraryIdentityGroup,
  type LegacyLibraryPage,
  runLegacyLibraryMigration,
  runLegacyLibraryMigrationToCompletion,
  summarizeLegacyLibrarySnapshot,
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
  it('reports integrity counts without exposing card data', () => {
    expect(summarizeLegacyLibrarySnapshot({
      libraryEpoch: 0,
      cards: [
        { id: 'a', word: 'Chance', normalizedWord: 'chance' },
        { id: 'b', word: 'chance', normalizedWord: 'chance' },
        { id: 'bad', word: '', normalizedWord: '' },
      ],
      reservations: new Map([
        ['chance', { schemaVersion: 1, cardId: 'wrong', normalizedWord: 'chance' }],
      ]),
    })).toEqual({
      cards: 3,
      canonicalIdentities: 1,
      reservations: 1,
      duplicateIdentities: 1,
      invalidIdentities: 1,
      missingReservations: 0,
      mismatchedReservations: 1,
    });
  });

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
  it('reuses one owner snapshot across bounded apply chunks before one final verification scan', async () => {
    let cards: LegacyLibrarySnapshot['cards'] = Array.from({ length: 205 }, (_, index) => (
      legacy(`legacy-${index}`, `word-${index}`)
    ));
    const reservations = new Map<string, unknown>();
    const calls = { read: 0, backup: 0, apply: 0, complete: 0 };
    const store: LegacyLibraryMigrationStore = {
      read: async () => {
        calls.read += 1;
        return { libraryEpoch: 3, cards, reservations };
      },
      backup: async () => { calls.backup += 1; },
      apply: async (_ownerId, _jobId, plan) => {
        calls.apply += 1;
        const replacedIds = new Set([plan.primaryId, ...plan.loserIds]);
        cards = [...cards.filter(card => !replacedIds.has(card.id)), plan.merged];
        reservations.set(plan.normalizedWord, matchingReservation(
          plan.primaryId,
          plan.normalizedWord,
        ));
      },
      markComplete: async () => { calls.complete += 1; },
    };

    await expect(runLegacyLibraryMigrationToCompletion(store, 'owner-1', {
      jobId: 'query-v2', batchSize: 100, maximumBatches: 100,
    })).resolves.toMatchObject({
      migrated: 205,
      complete: true,
      remaining: 0,
      invalid: 0,
    });
    expect(calls).toEqual({ read: 2, backup: 4, apply: 205, complete: 1 });
  });

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

describe('legacy library discovery', () => {
  const page = (documents: Array<{ id: string; data: Record<string, unknown> }>, cursor: string | null, terminal: boolean): LegacyLibraryPage => ({
    documents,
    cursor,
    terminal,
    libraryEpoch: 4,
  });

  const createStore = (pages: LegacyLibraryPage[]): LegacyLibraryDiscoveryStore & {
    jobs: LegacyLibraryDiscoveryJob | null;
    groups: readonly LegacyLibraryIdentityGroup[];
    commits: number;
  } => {
    let nextPage = 0;
    const store: LegacyLibraryDiscoveryStore & {
      jobs: LegacyLibraryDiscoveryJob | null;
      groups: readonly LegacyLibraryIdentityGroup[];
      commits: number;
    } = {
      jobs: null as LegacyLibraryDiscoveryJob | null,
      groups: [] as readonly LegacyLibraryIdentityGroup[],
      commits: 0,
      acquireDiscoveryLease: async (_ownerId: string, request: { jobId: string; scanId: string; leaseOwner: string }) => {
        if (!store.jobs) {
          store.jobs = {
            schemaVersion: 3,
            scanId: request.scanId,
            phase: 'discover',
            cursor: null,
            libraryEpoch: null,
            sourceRevision: '',
            scanned: 0,
            sourceCount: 0,
            groupCount: 0,
            lastPageDigest: null,
            leaseOwner: request.leaseOwner,
            leaseExpiresAt: Date.now() + 180_000,
          };
        }
        return store.jobs;
      },
      readPage: async (_ownerId: string, request: { limit: number; cursor: string | null }) => {
        expect(request.limit).toBeLessThanOrEqual(100);
        const result = pages[nextPage] ?? page([], request.cursor, true);
        nextPage += 1;
        return result;
      },
      readDiscoveryGroups: async () => store.groups,
      commitDiscoveryPage: async (_ownerId: string, request: Parameters<NonNullable<LegacyLibraryDiscoveryStore['commitDiscoveryPage']>>[1]) => {
        store.commits += 1;
        store.jobs = request.nextJob;
        if (request.groups.length > 0) store.groups = request.groups;
        return request.nextJob;
      },
    };
    return store;
  };

  it('keeps one identity group intact when duplicate sources cross document pages', async () => {
    const store = createStore([
      page([{ id: 'a', data: { word: 'Same', translation: 'one' } }], 'a', false),
      page([{ id: 'b', data: { word: 'same', translation: 'two' } }], 'b', true),
    ]);

    const first = await runLegacyLibraryDiscovery(store, 'owner-1', {
      jobId: 'query-v3', batchSize: 1,
    });
    const second = await runLegacyLibraryDiscovery(store, 'owner-1', {
      jobId: 'query-v3', batchSize: 1,
    });

    expect(first).toMatchObject({ migrated: 0, scanned: 1, complete: false });
    expect(second).toMatchObject({ migrated: 0, scanned: 1, complete: false, phase: 'discovered' });
    expect(store.groups).toEqual([
      expect.objectContaining({ normalizedWord: 'same', sources: expect.arrayContaining([
        expect.objectContaining({ id: 'a' }),
        expect.objectContaining({ id: 'b' }),
      ]) }),
    ]);
  });

  it('blocks a page with an invalid identity without committing its cursor', async () => {
    const store = createStore([
      page([{ id: 'bad', data: { translation: 'missing word' } }], 'bad', true),
    ]);

    const result = await runLegacyLibraryDiscovery(store, 'owner-1', {
      jobId: 'query-v3', batchSize: 100,
    });

    expect(result).toMatchObject({ complete: false, phase: 'blocked', invalid: 1, migrated: 0 });
    expect(store.jobs?.phase).toBe('blocked');
    expect(store.jobs?.cursor).toBeNull();
    expect(store.groups).toEqual([]);
  });

  it('allows migrated=0 discovery progress and never calls a live mutation', async () => {
    const store = createStore([
      page([{ id: 'a', data: { word: 'same' } }], 'a', false),
    ]);

    const result = await runLegacyLibraryDiscovery(store, 'owner-1', {
      jobId: 'query-v3', batchSize: 100,
    });

    expect(result).toMatchObject({ migrated: 0, scanned: 1, complete: false });
    expect(store.commits).toBe(1);
  });

  it('seeds the first source revision when a new job has an empty revision', async () => {
    const firstPage = page([{ id: 'a', data: { word: 'same' } }], 'a', true);
    const store = createStore([firstPage]);

    await runLegacyLibraryDiscovery(store, 'owner-1', {
      jobId: 'query-v3', batchSize: 100,
    });

    const digest = digestLegacyLibraryDiscoveryPage(
      firstPage,
      null,
      [createLegacyLibrarySourceDescriptor(firstPage.documents[0])],
    );
    const initial = createLegacyLibraryInitialRevision(store.jobs?.scanId ?? '', firstPage.libraryEpoch);
    expect(store.jobs?.sourceRevision).toBe(nextLegacyLibrarySourceRevision(initial, digest));
  });

  it('blocks a page over 8 MiB without advancing its cursor or manifest', async () => {
    const store = createStore([
      page([{
        id: 'large',
        data: { word: 'large', payload: 'x'.repeat(MAX_DISCOVERY_PAGE_BYTES) },
      }], 'large', true),
    ]);

    const result = await runLegacyLibraryDiscovery(store, 'owner-1', {
      jobId: 'query-v3', batchSize: 100,
    });

    expect(result).toMatchObject({ complete: false, phase: 'blocked', invalid: 1, migrated: 0 });
    expect(store.jobs?.phase).toBe('blocked');
    expect(store.jobs?.cursor).toBeNull();
    expect(store.groups).toEqual([]);
  });

  it('blocks the 101st source in one identity group without partial page commit', async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => ({
      id: `source-${String(index).padStart(3, '0')}`,
      data: { word: 'same', translation: String(index) },
    }));
    const store = createStore([
      page(firstPage, firstPage.at(-1)?.id ?? null, false),
      page([{ id: 'source-100', data: { word: 'same', translation: '100' } }], 'source-100', true),
    ]);

    await runLegacyLibraryDiscovery(store, 'owner-1', { jobId: 'query-v3', batchSize: 100 });
    const result = await runLegacyLibraryDiscovery(store, 'owner-1', { jobId: 'query-v3', batchSize: 100 });

    expect(result).toMatchObject({ complete: false, phase: 'blocked', invalid: 1, migrated: 0 });
    expect(store.jobs?.phase).toBe('blocked');
    expect(store.jobs?.cursor).toBe('source-099');
    expect(store.groups[0]?.sources).toHaveLength(100);
  });

  it('canonicalizes timestamps with a collision-safe wrapper and rejects non-finite numbers', () => {
    expect(new TextDecoder().decode(canonicalLegacyLibraryUtf8Bytes({
      createdAt: { _seconds: 12, _nanoseconds: 34 },
    }))).toBe('["map",[["createdAt",["map",[["_nanoseconds",["number",34]],["_seconds",["number",12]]]]]]]');
    expect(() => canonicalLegacyLibraryUtf8Bytes({ value: Number.NaN })).toThrow();
  });

  it('distinguishes genuine timestamps from lookalike maps and counts payload bytes', () => {
    const lookalike = { _seconds: 12, _nanoseconds: 34, payload: 'a' };
    const changedLookalike = { ...lookalike, payload: 'ab' };
    const timestamp = Timestamp.fromMillis(12_000);
    expect(digestLegacyLibraryValue(lookalike)).not.toBe(digestLegacyLibraryValue(changedLookalike));
    expect(canonicalLegacyLibraryUtf8Bytes(timestamp)).not.toEqual(canonicalLegacyLibraryUtf8Bytes({
      _seconds: 12,
      _nanoseconds: 0,
    }));
    const short = createLegacyLibrarySourceDescriptor({
      id: 'short', data: { word: 'same', createdAt: { _seconds: 12, _nanoseconds: 34, payload: 'a' } },
    });
    const long = createLegacyLibrarySourceDescriptor({
      id: 'long', data: { word: 'same', createdAt: { _seconds: 12, _nanoseconds: 34, payload: 'a'.repeat(100) } },
    });
    expect(long.sourceBytes).toBeGreaterThan(short.sourceBytes);
  });
});
