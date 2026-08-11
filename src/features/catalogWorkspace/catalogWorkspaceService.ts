import {
  getActiveCatalogRelease,
  hydrateCatalogEntries,
  type CatalogCacheEntry,
  type CatalogReleaseDescriptor,
  type HydratedCatalogEntry,
} from '../catalogCache/catalogCache';
import {
  installCatalogRelease,
  type CatalogChunkFetchPort,
  type CatalogReleaseInstallResult,
} from '../catalogCache/catalogDelivery';
import {
  queryCatalogCache,
  type CatalogCacheQuery,
  type CatalogCacheQueryResult,
} from '../catalogCache/catalogIndex';
import {
  summarizeActiveCatalog,
  type CatalogLearningStatus as CatalogCacheLearningStatus,
  type CatalogWorkspaceSummary,
} from '../catalogCache/catalogSummary';
import type { CatalogReleaseManifestV1 } from '../catalogPipeline/catalogContracts';
import { parseCatalogReleaseManifestV1 } from '../catalogPipeline/catalogValidation';
import type { LearningStateV3 } from '../multilingual/schemaV3';
import {
  CATALOG_PROGRESS_MEMBERSHIP_LIMIT,
  classifyCatalogLearningState,
} from './catalogProgress';

// Covers the worst-case bounded 100-chunk descriptor set (including track IDs)
// while remaining far below the 50 MiB release-content ceiling.
const MAXIMUM_MANIFEST_BYTES = 1024 * 1024;
const MAXIMUM_CHUNK_BYTES = 512 * 1024;
const MAXIMUM_STREAM_READS = 1_024;
const DEFAULT_TIMEOUT_MILLISECONDS = 15_000;
const MAXIMUM_TIMEOUT_MILLISECONDS = 60_000;
const MAXIMUM_PAGE_SIZE = 100;

export type CatalogWorkspaceRequestChannel = 'inspect' | 'summary' | 'download' | 'query' | 'hydrate';

export interface CatalogWorkspaceRequestToken {
  readonly channel: CatalogWorkspaceRequestChannel;
  readonly generation: number;
  readonly epoch: number;
}

export interface CatalogWorkspaceRequestGuard {
  begin(channel: CatalogWorkspaceRequestChannel): CatalogWorkspaceRequestToken;
  isCurrent(token: CatalogWorkspaceRequestToken): boolean;
  invalidate(): void;
}

export type CatalogWorkspaceResult<T> =
  | { readonly status: 'current'; readonly value: T }
  | { readonly status: 'stale' };

export interface CatalogDownloadProgress {
  readonly phase: 'manifest' | 'chunks' | 'complete';
  readonly receivedBytes: number;
  readonly totalBytes: number | null;
  readonly progressPercent: number;
}

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface CatalogManifestFetchOptions {
  readonly manifestUrl: string;
  readonly origin: string;
  readonly fetcher?: Fetcher;
  readonly maximumBytes?: number;
  readonly timeoutMilliseconds?: number;
}

export interface CatalogWorkspaceRuntimePort {
  inspect(catalogId: string): Promise<CatalogReleaseDescriptor | null>;
  summarize(
    catalogId: string,
    statuses: ReadonlyMap<string, CatalogCacheLearningStatus>,
  ): Promise<CatalogWorkspaceSummary | null>;
  install(
    manifest: unknown,
    baseUrl: string,
    reportProgress?: (progress: CatalogDownloadProgress) => void,
  ): Promise<CatalogReleaseInstallResult>;
  query(input: CatalogCacheQuery): Promise<CatalogCacheQueryResult>;
  hydrate(
    catalogId: string,
    entries: readonly CatalogCacheEntry[],
  ): Promise<readonly HydratedCatalogEntry[]>;
}

export interface CatalogWorkspaceServiceOptions {
  readonly origin: string;
  readonly fetcher?: Fetcher;
  readonly ports?: CatalogWorkspaceRuntimePort;
  readonly manifestMaximumBytes?: number;
  readonly timeoutMilliseconds?: number;
}

export interface CatalogWorkspaceService {
  inspect(catalogId: string): Promise<CatalogWorkspaceResult<CatalogReleaseDescriptor | null>>;
  summarize(
    catalogId: string,
    learningStates: ReadonlyMap<string, LearningStateV3 | null>,
  ): Promise<CatalogWorkspaceResult<CatalogWorkspaceSummary | null>>;
  download(
    manifestUrl: string,
    expectedRelease: { readonly catalogId: string; readonly releaseId: string },
    reportProgress?: (progress: CatalogDownloadProgress) => void,
  ): Promise<CatalogWorkspaceResult<CatalogReleaseInstallResult>>;
  query(input: CatalogCacheQuery): Promise<CatalogWorkspaceResult<CatalogCacheQueryResult>>;
  hydrate(
    catalogId: string,
    entries: readonly CatalogCacheEntry[],
  ): Promise<CatalogWorkspaceResult<readonly HydratedCatalogEntry[]>>;
  invalidate(): void;
}

export function createCatalogWorkspaceRequestGuard(): CatalogWorkspaceRequestGuard {
  const generations = new Map<CatalogWorkspaceRequestChannel, number>();
  let epoch = 0;
  return {
    begin(channel) {
      const generation = (generations.get(channel) ?? 0) + 1;
      generations.set(channel, generation);
      return { channel, generation, epoch };
    },
    isCurrent(token) {
      return token.epoch === epoch && generations.get(token.channel) === token.generation;
    },
    invalidate() {
      epoch += 1;
    },
  };
}

const originUrl = (value: string): URL => {
  const parsed = new URL(value);
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new TypeError('Catalog origin must be HTTP(S) without credentials.');
  }
  return new URL('/', parsed.origin);
};

const requestUrl = (value: string, origin: URL, label: string): URL => {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2_048) {
    throw new TypeError(`${label} must be a bounded URL.`);
  }
  const parsed = new URL(value, origin);
  if (parsed.origin !== origin.origin || parsed.username || parsed.password) {
    throw new TypeError(`${label} must be same-origin and contain no credentials.`);
  }
  if (parsed.search) throw new TypeError(`${label} must not contain a query string.`);
  if (parsed.hash) throw new TypeError(`${label} must not contain a fragment.`);
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new TypeError(`${label} must use HTTP(S).`);
  return parsed;
};

const boundedInteger = (
  value: number | undefined,
  fallback: number,
  maximum: number,
  label: string,
): number => {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result < 1 || result > maximum) {
    throw new TypeError(`${label} must be an integer between 1 and ${maximum}.`);
  }
  return result;
};

const contentLength = (response: Response): number | null => {
  const raw = response.headers.get('content-length');
  if (raw === null) return null;
  if (!/^\d+$/.test(raw)) throw new TypeError('Catalog response Content-Length is invalid.');
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) throw new TypeError('Catalog response Content-Length is invalid.');
  return value;
};

const readBoundedResponse = async (
  response: Response,
  maximumBytes: number,
  signal: AbortSignal,
): Promise<Uint8Array> => {
  const declared = contentLength(response);
  if (declared !== null && declared > maximumBytes) {
    throw new RangeError(`Catalog response exceeds the maximum size of ${maximumBytes} bytes.`);
  }
  if (!response.body) throw new TypeError('Catalog response requires a streaming body.');
  const reader = response.body.getReader();
  const aborted = new Promise<never>((_resolve, reject) => {
    const fail = () => reject(signal.reason ?? new Error('Catalog request was aborted.'));
    if (signal.aborted) fail();
    else signal.addEventListener('abort', fail, { once: true });
  });
  const chunks: Uint8Array[] = [];
  let total = 0;
  let reads = 0;
  try {
    while (true) {
      const item = await Promise.race([reader.read(), aborted]);
      if (item.done) break;
      reads += 1;
      if (reads > MAXIMUM_STREAM_READS || !(item.value instanceof Uint8Array)) {
        throw new TypeError('Catalog response stream is invalid or excessively fragmented.');
      }
      total += item.value.byteLength;
      if (total > maximumBytes) throw new RangeError(`Catalog response exceeds the maximum size of ${maximumBytes} bytes.`);
      chunks.push(item.value.slice());
    }
  } catch (error) {
    try {
      void reader.cancel().catch(() => undefined);
    } catch {
      // Cancellation is advisory; preserve the original bounded-read failure.
    }
    throw error;
  }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
};

const fetchBytes = async (
  url: URL,
  fetcher: Fetcher,
  maximumBytes: number,
  timeoutMilliseconds: number,
  requireJson: boolean,
  parentSignal?: AbortSignal,
): Promise<Uint8Array> => {
  const controller = new AbortController();
  const abortFromParent = () => controller.abort(
    parentSignal?.reason ?? new Error('Catalog request was aborted.'),
  );
  if (parentSignal?.aborted) abortFromParent();
  else parentSignal?.addEventListener('abort', abortFromParent, { once: true });
  const timeout = setTimeout(() => controller.abort(new Error('Catalog request timed out.')), timeoutMilliseconds);
  try {
    if (controller.signal.aborted) throw controller.signal.reason;
    const response = await fetcher(url.href, {
      cache: 'no-store',
      credentials: 'same-origin',
      redirect: 'error',
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Catalog request failed with HTTP ${response.status}.`);
    if (requireJson && !/^application\/(?:[a-z0-9.+-]+\+)?json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '')) {
      throw new TypeError('Catalog manifest response must use a JSON content type.');
    }
    return await readBoundedResponse(response, maximumBytes, controller.signal);
  } finally {
    clearTimeout(timeout);
    parentSignal?.removeEventListener('abort', abortFromParent);
  }
};

const decodeJson = (bytes: Uint8Array, label: string): unknown => {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new TypeError(`${label} must be valid UTF-8.`);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new TypeError(`${label} must be valid JSON.`);
  }
};

export async function fetchCatalogReleaseManifest(
  options: CatalogManifestFetchOptions,
): Promise<CatalogReleaseManifestV1> {
  const origin = originUrl(options.origin);
  const url = requestUrl(options.manifestUrl, origin, 'Catalog manifest URL');
  const maximumBytes = boundedInteger(
    options.maximumBytes,
    MAXIMUM_MANIFEST_BYTES,
    MAXIMUM_MANIFEST_BYTES,
    'maximumBytes',
  );
  const timeoutMilliseconds = boundedInteger(
    options.timeoutMilliseconds,
    DEFAULT_TIMEOUT_MILLISECONDS,
    MAXIMUM_TIMEOUT_MILLISECONDS,
    'timeoutMilliseconds',
  );
  const fetcher = options.fetcher ?? globalThis.fetch.bind(globalThis);
  const bytes = await fetchBytes(url, fetcher, maximumBytes, timeoutMilliseconds, true);
  return parseCatalogReleaseManifestV1(decodeJson(bytes, 'Catalog manifest'));
}

const createChunkSource = (
  baseUrl: string,
  fetcher: Fetcher,
  timeoutMilliseconds: number,
  totalBytes: number,
  reportProgress?: (progress: CatalogDownloadProgress) => void,
): CatalogChunkFetchPort => {
  const origin = originUrl(baseUrl);
  let receivedBytes = 0;
  return {
    async fetchChunk(path, signal) {
      const url = requestUrl(path, origin, 'Catalog chunk URL');
      const bytes = await fetchBytes(
        url,
        fetcher,
        MAXIMUM_CHUNK_BYTES,
        timeoutMilliseconds,
        false,
        signal,
      );
      receivedBytes += bytes.byteLength;
      reportProgress?.({
        phase: 'chunks',
        receivedBytes,
        totalBytes,
        progressPercent: Math.min(99, Math.round((receivedBytes / totalBytes) * 100)),
      });
      return bytes;
    },
  };
};

const defaultRuntimePort = (
  fetcher: Fetcher,
  timeoutMilliseconds: number,
): CatalogWorkspaceRuntimePort => ({
  inspect: getActiveCatalogRelease,
  summarize: summarizeActiveCatalog,
  install: (manifestInput, baseUrl, reportProgress) => {
    const manifest = parseCatalogReleaseManifestV1(manifestInput);
    return installCatalogRelease(
      manifest,
      createChunkSource(
        baseUrl,
        fetcher,
        timeoutMilliseconds,
        manifest.counts.encodedBytes,
        reportProgress,
      ),
    );
  },
  query: queryCatalogCache,
  hydrate: hydrateCatalogEntries,
});

const catalogLearningStatuses = (
  learningStates: ReadonlyMap<string, LearningStateV3 | null>,
): ReadonlyMap<string, CatalogCacheLearningStatus> => {
  if (!(learningStates instanceof Map) || learningStates.size > CATALOG_PROGRESS_MEMBERSHIP_LIMIT) {
    throw new TypeError(`Learning State input must be a Map with at most ${CATALOG_PROGRESS_MEMBERSHIP_LIMIT.toLocaleString('en-US')} entries.`);
  }
  const statuses = new Map<string, CatalogCacheLearningStatus>();
  for (const [lexemeId, state] of learningStates) {
    if (typeof lexemeId !== 'string' || lexemeId.length === 0 || lexemeId.length > 128) {
      throw new TypeError('Each Learning State key must be a bounded Lexeme ID.');
    }
    if (state !== null && state.lexemeId !== lexemeId) {
      throw new TypeError(`Learning State key does not match Lexeme ID: ${lexemeId}`);
    }
    const status = classifyCatalogLearningState(state);
    if (status !== 'not-started') statuses.set(lexemeId, status);
  }
  return statuses;
};

export function createCatalogWorkspaceService(
  options: CatalogWorkspaceServiceOptions,
): CatalogWorkspaceService {
  const origin = originUrl(options.origin);
  const fetcher = options.fetcher ?? globalThis.fetch.bind(globalThis);
  const timeoutMilliseconds = boundedInteger(
    options.timeoutMilliseconds,
    DEFAULT_TIMEOUT_MILLISECONDS,
    MAXIMUM_TIMEOUT_MILLISECONDS,
    'timeoutMilliseconds',
  );
  const ports = options.ports ?? defaultRuntimePort(fetcher, timeoutMilliseconds);
  const guard = createCatalogWorkspaceRequestGuard();

  const runLatest = async <T>(
    channel: CatalogWorkspaceRequestChannel,
    operation: () => Promise<T>,
  ): Promise<CatalogWorkspaceResult<T>> => {
    const token = guard.begin(channel);
    try {
      const value = await operation();
      return guard.isCurrent(token) ? { status: 'current', value } : { status: 'stale' };
    } catch (error) {
      if (!guard.isCurrent(token)) return { status: 'stale' };
      throw error;
    }
  };

  return {
    inspect: catalogId => runLatest('inspect', () => ports.inspect(catalogId)),
    summarize: (catalogId, learningStates) => runLatest(
      'summary',
      () => ports.summarize(catalogId, catalogLearningStatuses(learningStates)),
    ),
    async download(manifestUrl, expectedRelease, reportProgress) {
      const token = guard.begin('download');
      const reportIfCurrent = (progress: CatalogDownloadProgress): void => {
        if (guard.isCurrent(token)) reportProgress?.(progress);
      };
      try {
        reportIfCurrent({ phase: 'manifest', receivedBytes: 0, totalBytes: null, progressPercent: 0 });
        const manifest = await fetchCatalogReleaseManifest({
          manifestUrl,
          origin: origin.href,
          fetcher,
          maximumBytes: options.manifestMaximumBytes,
          timeoutMilliseconds,
        });
        if (!guard.isCurrent(token)) return { status: 'stale' };
        if (manifest.catalogId !== expectedRelease.catalogId
          || manifest.releaseId !== expectedRelease.releaseId) {
          throw new TypeError('Catalog manifest does not match the registry-approved release.');
        }
        reportIfCurrent({
          phase: 'chunks', receivedBytes: 0,
          totalBytes: manifest.counts.encodedBytes, progressPercent: 0,
        });
        const value = reportProgress
          ? await ports.install(manifest, origin.href, reportIfCurrent)
          : await ports.install(manifest, origin.href);
        reportIfCurrent({
          phase: 'complete', receivedBytes: manifest.counts.encodedBytes,
          totalBytes: manifest.counts.encodedBytes, progressPercent: 100,
        });
        return guard.isCurrent(token) ? { status: 'current', value } : { status: 'stale' };
      } catch (error) {
        if (!guard.isCurrent(token)) return { status: 'stale' };
        throw error;
      }
    },
    async query(input) {
      if (input.pageSize !== undefined && (
        !Number.isSafeInteger(input.pageSize) || input.pageSize < 1 || input.pageSize > MAXIMUM_PAGE_SIZE
      )) throw new TypeError(`Catalog query pageSize must be between 1 and ${MAXIMUM_PAGE_SIZE}.`);
      return runLatest('query', () => ports.query(input));
    },
    async hydrate(catalogId, entries) {
      if (!Array.isArray(entries) || entries.length > MAXIMUM_PAGE_SIZE) {
        throw new TypeError(`Catalog hydration batches may contain at most ${MAXIMUM_PAGE_SIZE} memberships.`);
      }
      return runLatest('hydrate', () => ports.hydrate(catalogId, entries));
    },
    invalidate: () => guard.invalidate(),
  };
}
