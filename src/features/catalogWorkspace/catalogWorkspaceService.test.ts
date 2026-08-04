import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

import {
  activateCatalogInstall,
  beginCatalogInstall,
  closeCatalogCacheForTests,
  getActiveCatalogRelease,
  stageCatalogChunk,
  type CatalogCacheEntry,
  type CatalogReleaseDescriptor,
  type HydratedCatalogEntry,
} from '../catalogCache/catalogCache';
import type { CatalogCacheQuery, CatalogCacheQueryResult } from '../catalogCache/catalogIndex';
import type { CatalogWorkspaceSummary } from '../catalogCache/catalogSummary';
import type { CatalogReleaseManifestV1 } from '../catalogPipeline/catalogContracts';
import {
  createCatalogWorkspaceRequestGuard,
  createCatalogWorkspaceService,
  fetchCatalogReleaseManifest,
  type CatalogWorkspaceRuntimePort,
} from './catalogWorkspaceService';

const manifest: CatalogReleaseManifestV1 = {
  manifestVersion: 1,
  catalogId: 'english-core',
  releaseId: 'release-1',
  sequence: 1,
  contentLanguage: 'en',
  supportLanguages: ['vi'],
  createdAt: '2026-08-04T00:00:00.000Z',
  previousReleaseId: null,
  counts: { lexemes: 1, memberships: 1, chunks: 1, encodedBytes: 100 },
  chunks: [{
    id: 'chunk-1', ordinal: 0, path: 'english-core/release-1/chunk-1.json',
    sha256: 'a'.repeat(64), byteLength: 100, lexemeCount: 1, membershipCount: 1,
    trackIds: ['ielts'],
  }],
};

const jsonResponse = (value: unknown, headers: HeadersInit = {}): Response => new Response(
  JSON.stringify(value),
  { status: 200, headers: { 'content-type': 'application/json', ...headers } },
);

const runtime = (overrides: Partial<CatalogWorkspaceRuntimePort> = {}): CatalogWorkspaceRuntimePort => ({
  inspect: vi.fn(async () => null),
  summarize: vi.fn(async () => null),
  install: vi.fn(async value => ({
    catalogId: (value as CatalogReleaseManifestV1).catalogId,
    releaseId: (value as CatalogReleaseManifestV1).releaseId,
    installedMemberships: (value as CatalogReleaseManifestV1).counts.memberships,
  })),
  query: vi.fn(async () => ({ items: [], scanned: 0, hasMore: false, nextCursor: null })),
  hydrate: vi.fn(async () => []),
  ...overrides,
});

describe('catalog manifest fetch', () => {
  it('fetches and strictly parses a bounded same-origin manifest', async () => {
    const fetcher = vi.fn(async () => jsonResponse(manifest));

    await expect(fetchCatalogReleaseManifest({
      manifestUrl: '/catalog/english-core/release-1/release-manifest.json',
      origin: 'https://learn.example.test/app',
      fetcher,
    })).resolves.toEqual(manifest);
    expect(fetcher).toHaveBeenCalledWith(
      'https://learn.example.test/catalog/english-core/release-1/release-manifest.json',
      expect.objectContaining({
        cache: 'no-store', credentials: 'same-origin', redirect: 'error', signal: expect.any(AbortSignal),
      }),
    );
  });

  it.each([
    'https://evil.example/release-manifest.json',
    '//evil.example/release-manifest.json',
    'https://user:secret@learn.example.test/release-manifest.json',
    '/catalog/release-manifest.json?token=secret',
    '/catalog/release-manifest.json#fragment',
  ])('rejects unsafe manifest URL %s before network I/O', async manifestUrl => {
    const fetcher = vi.fn();
    await expect(fetchCatalogReleaseManifest({
      manifestUrl,
      origin: 'https://learn.example.test/',
      fetcher,
    })).rejects.toThrow(/same-origin|credentials|query|fragment/i);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('rejects oversized, non-JSON and structurally invalid responses', async () => {
    await expect(fetchCatalogReleaseManifest({
      manifestUrl: '/manifest.json', origin: 'https://learn.example.test/', maximumBytes: 16,
      fetcher: vi.fn(async () => jsonResponse(manifest, { 'content-length': '17' })),
    })).rejects.toThrow(/maximum/i);

    await expect(fetchCatalogReleaseManifest({
      manifestUrl: '/manifest.json', origin: 'https://learn.example.test/',
      fetcher: vi.fn(async () => new Response('{}', { headers: { 'content-type': 'text/plain' } })),
    })).rejects.toThrow(/JSON/i);

    await expect(fetchCatalogReleaseManifest({
      manifestUrl: '/manifest.json', origin: 'https://learn.example.test/',
      fetcher: vi.fn(async () => jsonResponse({ ...manifest, injected: true })),
    })).rejects.toThrow(/unknown field/i);
  });

  it('aborts a stalled manifest request at the configured timeout', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>(
      (_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal?.reason)),
    ));
    const pending = fetchCatalogReleaseManifest({
      manifestUrl: '/manifest.json', origin: 'https://learn.example.test/', fetcher, timeoutMilliseconds: 25,
    });
    const assertion = expect(pending).rejects.toThrow(/timed out/i);
    await vi.advanceTimersByTimeAsync(25);
    await assertion;
    vi.useRealTimers();
  });
});

describe('catalog workspace service', () => {
  it('keeps production runtime source independent from the draft pilot', () => {
    const source = readFileSync(new URL('./catalogWorkspaceService.ts', import.meta.url), 'utf8');

    expect(source).not.toMatch(/pilotCatalog/);
  });

  it('keeps only the latest result current within each request channel', async () => {
    const guard = createCatalogWorkspaceRequestGuard();
    const first = guard.begin('query');
    const summary = guard.begin('summary');
    const second = guard.begin('query');

    expect(guard.isCurrent(first)).toBe(false);
    expect(guard.isCurrent(summary)).toBe(true);
    expect(guard.isCurrent(second)).toBe(true);
    guard.invalidate();
    expect(guard.isCurrent(summary)).toBe(false);
    expect(guard.isCurrent(second)).toBe(false);
  });

  it('marks a late query stale and enforces query and hydration batches of at most 100', async () => {
    let resolveFirst!: (value: CatalogCacheQueryResult) => void;
    const firstResult = new Promise<CatalogCacheQueryResult>(resolve => { resolveFirst = resolve; });
    const query = vi.fn()
      .mockReturnValueOnce(firstResult)
      .mockResolvedValueOnce({ items: [], scanned: 0, hasMore: false, nextCursor: null });
    const ports = runtime({ query });
    const service = createCatalogWorkspaceService({
      origin: 'https://learn.example.test/', ports,
      fetcher: vi.fn(async () => jsonResponse(manifest)),
    });
    const input: CatalogCacheQuery = { catalogId: 'english-core', language: 'en', trackId: 'ielts' };

    const first = service.query(input);
    await expect(service.query(input)).resolves.toMatchObject({ status: 'current' });
    resolveFirst({ items: [], scanned: 0, hasMore: false, nextCursor: null });
    await expect(first).resolves.toEqual({ status: 'stale' });

    await expect(service.query({ ...input, pageSize: 101 })).rejects.toThrow(/100/);
    await expect(service.hydrate('english-core', Array.from({ length: 101 }, (_, index) => ({
      membershipId: `m-${index}`, lexemeId: `l-${index}`, language: 'en', trackId: 'ielts',
      tier: 'foundation', cefrLevel: 'A1', topic: 'basic', partOfSpeech: 'noun', skills: [],
      rank: index, normalizedLemma: `word-${index}`, lemma: `Word ${index}`,
    })))).rejects.toThrow(/100/);
  });

  it('uses injected cache ports for inspection, summaries, query and hydration', async () => {
    const release: CatalogReleaseDescriptor = {
      catalogId: 'english-core', releaseId: 'release-1', schemaVersion: 1, contentLanguage: 'en',
      chunkCount: 1, lexemeCount: 1, membershipCount: 1, encodedBytes: 100,
    };
    const entry = {
      membershipId: 'm-1', lexemeId: 'l-1', language: 'en', trackId: 'ielts', tier: 'foundation',
      cefrLevel: 'A1', topic: 'basic', partOfSpeech: 'noun', skills: ['reading'], rank: 1,
      normalizedLemma: 'learn', lemma: 'Learn',
    } satisfies CatalogCacheEntry;
    const hydrated = [{ membership: entry, lexeme: { id: 'l-1' } }] as unknown as HydratedCatalogEntry[];
    const summary = { release, scannedMemberships: 1, tracks: [] } satisfies CatalogWorkspaceSummary;
    const ports = runtime({
      inspect: vi.fn(async () => release),
      summarize: vi.fn(async () => summary),
      query: vi.fn(async () => ({ items: [entry], scanned: 1, hasMore: false, nextCursor: null })),
      hydrate: vi.fn(async () => hydrated),
    });
    const service = createCatalogWorkspaceService({
      origin: 'https://learn.example.test/', ports,
      fetcher: vi.fn(async () => jsonResponse(manifest)),
    });

    await expect(service.inspect('english-core')).resolves.toEqual({ status: 'current', value: release });
    await expect(service.summarize('english-core', new Map())).resolves.toEqual({ status: 'current', value: summary });
    await expect(service.query({ catalogId: 'english-core', language: 'en', trackId: 'ielts' }))
      .resolves.toMatchObject({ status: 'current', value: { items: [entry] } });
    await expect(service.hydrate('english-core', [entry])).resolves.toEqual({ status: 'current', value: hydrated });
  });

  it('derives progress only from bounded Learning State evidence before summary aggregation', async () => {
    const summarize = vi.fn(async () => null);
    const service = createCatalogWorkspaceService({
      origin: 'https://learn.example.test/',
      ports: runtime({ summarize }),
      fetcher: vi.fn(async () => jsonResponse(manifest)),
    });
    const state = {
      lexemeId: 'lexeme-1', reviewHistory: [{ rating: 'good' }], mastery: 0.4,
    } as never;

    await expect(service.summarize('english-core', new Map([['lexeme-1', state]])))
      .resolves.toMatchObject({ status: 'current' });
    expect(summarize).toHaveBeenCalledWith('english-core', new Map([['lexeme-1', 'started']]));

    await expect(service.summarize('english-core', new Map([
      ['different-key', state],
    ]))).rejects.toThrow(/does not match/i);
    await expect(service.summarize('english-core', new Map(
      Array.from({ length: 10_001 }, (_, index) => [`lexeme-${index}`, null] as const),
    ))).rejects.toThrow(/10,000/);
  });

  it('fetches then atomically installs, while a failed download leaves the prior active release intact', async () => {
    let activeRelease = 'release-0';
    const install = vi.fn(async () => {
      throw new Error('chunk checksum mismatch');
    });
    const ports = runtime({
      inspect: vi.fn(async () => ({
        catalogId: 'english-core', releaseId: activeRelease, schemaVersion: 1, contentLanguage: 'en',
        chunkCount: 1, membershipCount: 1, encodedBytes: 100,
      })),
      install,
    });
    const service = createCatalogWorkspaceService({
      origin: 'https://learn.example.test/', ports,
      fetcher: vi.fn(async () => jsonResponse(manifest)),
    });

    await expect(service.download('/catalog/release-manifest.json')).rejects.toThrow(/checksum/);
    expect(activeRelease).toBe('release-0');
    expect(install).toHaveBeenCalledWith(manifest, 'https://learn.example.test/');
  });

  it('reports bounded manifest, chunk and completion progress only for the current download', async () => {
    const progress: number[] = [];
    const install = vi.fn(async (
      value: unknown,
      _baseUrl: string,
      report?: Parameters<CatalogWorkspaceRuntimePort['install']>[2],
    ) => {
      report?.({ phase: 'chunks', receivedBytes: 50, totalBytes: 100, progressPercent: 50 });
      return {
        catalogId: (value as CatalogReleaseManifestV1).catalogId,
        releaseId: (value as CatalogReleaseManifestV1).releaseId,
        installedMemberships: 1,
      };
    });
    const service = createCatalogWorkspaceService({
      origin: 'https://learn.example.test/', ports: runtime({ install }),
      fetcher: vi.fn(async () => jsonResponse(manifest)),
    });

    await expect(service.download(
      '/catalog/release-manifest.json',
      value => progress.push(value.progressPercent),
    )).resolves.toMatchObject({ status: 'current' });
    expect(progress).toEqual([0, 0, 50, 100]);
  });

  it('keeps the real IndexedDB active release when verified delivery rejects a corrupt chunk', async () => {
    closeCatalogCacheForTests();
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase('sonflash-catalog-cache');
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
    const previous = await beginCatalogInstall({
      catalogId: 'english-core', releaseId: 'release-0', schemaVersion: 1, contentLanguage: 'en',
      chunkCount: 1, lexemeCount: 0, membershipCount: 1, encodedBytes: 10,
    });
    await stageCatalogChunk(previous, {
      chunkId: 'old', sha256: 'b'.repeat(64), lexemeCount: 0, membershipCount: 1, encodedBytes: 10,
    }, [{
      membershipId: 'old-membership', lexemeId: 'old-lexeme', language: 'en', trackId: 'general',
      tier: 'foundation', cefrLevel: 'A1', topic: 'basic', partOfSpeech: 'noun', skills: ['reading'],
      rank: 1, normalizedLemma: 'old', lemma: 'Old',
    }]);
    await activateCatalogInstall(previous);
    const fetcher = vi.fn(async (input: RequestInfo | URL) => (
      String(input).endsWith('release-manifest.json')
        ? jsonResponse(manifest)
        : new Response(new Uint8Array(100), {
          headers: { 'content-type': 'application/json', 'content-length': '100' },
        })
    ));
    const service = createCatalogWorkspaceService({ origin: 'https://learn.example.test/', fetcher });

    await expect(service.download('/catalog/release-manifest.json')).rejects.toThrow(/SHA-256/);
    await expect(getActiveCatalogRelease('english-core')).resolves.toMatchObject({ releaseId: 'release-0' });

    closeCatalogCacheForTests();
  });
});
