import { describe, expect, it } from 'vitest';
import { Timestamp } from 'firebase-admin/firestore';
import {
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
} from '../src/legacyLibraryMigration.js';

describe('legacy library discovery', () => {
  it('does not expose the removed query-v2 mutator surface', async () => {
    const migration = await import('../src/legacyLibraryMigration.js');
    const firestore = await import('../src/legacyLibraryMigrationFirestore.js');
    expect('runLegacyLibraryMigration' in migration).toBe(false);
    expect('runLegacyLibraryMigrationToCompletion' in migration).toBe(false);
    expect('createFirestoreLegacyLibraryMigrationStore' in firestore).toBe(false);
    expect('runLegacyLibraryMigrationApply' in firestore).toBe(false);
  });

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
