import type { CatalogChunkFetchPort } from '../features/catalogCache/catalogDelivery';
import type {
  CatalogDownloadProgress,
  CatalogLearningStateLoadResult,
  CatalogWorkspaceRuntimePort,
} from '../features/catalogWorkspace/catalogWorkspaceService';

const MAXIMUM_CATALOG_CHUNK_BYTES = 512 * 1024;
const MAXIMUM_STREAM_READS = 1_024;
const DEFAULT_TIMEOUT_MILLISECONDS = 15_000;
const MAXIMUM_TIMEOUT_MILLISECONDS = 60_000;

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface CatalogWorkspaceRuntimeOptions {
  readonly loadLearningStates: (
    ownerId: string | null,
    maximum: number,
  ) => Promise<CatalogLearningStateLoadResult | null>;
  readonly fetcher?: Fetcher;
  readonly timeoutMilliseconds?: number;
}

export interface SameOriginCatalogChunkSourceOptions {
  readonly baseUrl: string;
  readonly fetcher?: Fetcher;
  /** Test and stricter-call-site override; cannot exceed the catalog contract. */
  readonly maximumBytes?: number;
  readonly timeoutMilliseconds?: number;
}

const relativeCatalogPath = (value: string): string => {
  const segments = value.split('/');
  if (
    value.length === 0
    || value.length > 512
    || value.startsWith('/')
    || value.includes('\\')
    || value.includes('?')
    || value.includes('#')
    || value.includes('%')
    || /^[a-z][a-z0-9+.-]*:/i.test(value)
    || segments.some(segment => !segment || segment === '.' || segment === '..')
  ) {
    throw new TypeError('Catalog chunks require a safe same-origin relative catalog path.');
  }
  return value;
};

const byteLimit = (value: number | undefined): number => {
  const limit = value ?? MAXIMUM_CATALOG_CHUNK_BYTES;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAXIMUM_CATALOG_CHUNK_BYTES) {
    throw new TypeError(`maximumBytes must be between 1 and ${MAXIMUM_CATALOG_CHUNK_BYTES}.`);
  }
  return limit;
};

const catalogOrigin = (value: string): URL => {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new TypeError('Catalog baseUrl must be an HTTP(S) origin without credentials.');
  }
  return new URL('/', url.origin);
};

const requestTimeout = (value: number | undefined): number => {
  const timeout = value ?? DEFAULT_TIMEOUT_MILLISECONDS;
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > MAXIMUM_TIMEOUT_MILLISECONDS) {
    throw new TypeError(`timeoutMilliseconds must be between 1 and ${MAXIMUM_TIMEOUT_MILLISECONDS}.`);
  }
  return timeout;
};

const declaredLength = (headers: Headers): number | null => {
  const value = headers.get('content-length');
  if (value === null) return null;
  if (!/^\d+$/.test(value)) throw new TypeError('Catalog chunk Content-Length is invalid.');
  const length = Number(value);
  if (!Number.isSafeInteger(length)) throw new TypeError('Catalog chunk Content-Length is invalid.');
  return length;
};

const readBoundedBody = async (
  response: Response,
  maximumBytes: number,
  signal: AbortSignal,
): Promise<Uint8Array> => {
  const length = declaredLength(response.headers);
  if (length !== null && length > maximumBytes) {
    throw new RangeError(`Catalog chunk exceeds the maximum size of ${maximumBytes} bytes.`);
  }
  if (!response.body) throw new TypeError('Catalog chunk response requires a streaming body.');

  const reader = response.body.getReader();
  const aborted = new Promise<never>((_resolve, reject) => {
    const fail = () => reject(signal.reason ?? new Error('Catalog chunk request was aborted.'));
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
        throw new TypeError('Catalog chunk stream is invalid or excessively fragmented.');
      }
      total += item.value.byteLength;
      if (total > maximumBytes) {
        throw new RangeError(`Catalog chunk exceeds the maximum size of ${maximumBytes} bytes.`);
      }
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
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
};

export function createSameOriginCatalogChunkSource(
  options: SameOriginCatalogChunkSourceOptions,
): CatalogChunkFetchPort {
  const origin = catalogOrigin(options.baseUrl);
  const maximumBytes = byteLimit(options.maximumBytes);
  const timeoutMilliseconds = requestTimeout(options.timeoutMilliseconds);
  const fetcher = options.fetcher ?? globalThis.fetch.bind(globalThis);
  return {
    async fetchChunk(path: string, signal?: AbortSignal): Promise<Uint8Array> {
      const safePath = relativeCatalogPath(path);
      const url = new URL(safePath, origin);
      if (url.origin !== origin.origin) {
        throw new TypeError('Catalog chunks require a safe same-origin relative catalog path.');
      }
      const controller = new AbortController();
      const abortFromCaller = () => {
        controller.abort(signal?.reason ?? new Error('Catalog chunk request was aborted.'));
      };
      if (signal?.aborted) abortFromCaller();
      else signal?.addEventListener('abort', abortFromCaller, { once: true });
      const timeout = setTimeout(() => {
        controller.abort(new Error('Catalog chunk request timed out.'));
      }, timeoutMilliseconds);
      try {
        if (controller.signal.aborted) throw controller.signal.reason;
        const aborted = new Promise<never>((_resolve, reject) => {
          const fail = () => reject(
            controller.signal.reason ?? new Error('Catalog chunk request was aborted.'),
          );
          if (controller.signal.aborted) fail();
          else controller.signal.addEventListener('abort', fail, { once: true });
        });
        const response = await Promise.race([
          fetcher(url.href, {
            cache: 'no-store',
            credentials: 'same-origin',
            redirect: 'error',
            signal: controller.signal,
          }),
          aborted,
        ]);
        if (!response.ok) throw new Error(`Catalog chunk request failed with HTTP ${response.status}.`);
        return await readBoundedBody(response, maximumBytes, controller.signal);
      } finally {
        clearTimeout(timeout);
        signal?.removeEventListener('abort', abortFromCaller);
      }
    },
  };
}

export function createCatalogWorkspaceRuntime(
  options: CatalogWorkspaceRuntimeOptions,
): CatalogWorkspaceRuntimePort {
  const fetcher = options.fetcher ?? globalThis.fetch.bind(globalThis);
  const timeoutMilliseconds = requestTimeout(options.timeoutMilliseconds);
  return {
    inspect: async catalogId => {
      const { getActiveCatalogRelease } = await import('../features/catalogCache/catalogCache');
      return getActiveCatalogRelease(catalogId);
    },
    summarize: async (catalogId, statuses) => {
      const { summarizeActiveCatalog } = await import('../features/catalogCache/catalogSummary');
      return summarizeActiveCatalog(catalogId, statuses);
    },
    async install(manifestInput, baseUrl, reportProgress) {
      const [{ installCatalogRelease }, { parseCatalogReleaseManifestV1 }] = await Promise.all([
        import('../features/catalogCache/catalogDelivery'),
        import('../features/catalogPipeline/catalogValidation'),
      ]);
      const manifest = parseCatalogReleaseManifestV1(manifestInput);
      const chunkSource = createSameOriginCatalogChunkSource({
        baseUrl,
        fetcher,
        timeoutMilliseconds,
      });
      let receivedBytes = 0;
      const progressSource: CatalogChunkFetchPort = {
        async fetchChunk(path, signal) {
          const bytes = await chunkSource.fetchChunk(path, signal);
          receivedBytes += bytes.byteLength;
          reportProgress?.({
            phase: 'chunks',
            receivedBytes,
            totalBytes: manifest.counts.encodedBytes,
            progressPercent: Math.min(
              99,
              Math.round((receivedBytes / manifest.counts.encodedBytes) * 100),
            ),
          } satisfies CatalogDownloadProgress);
          return bytes;
        },
      };
      return installCatalogRelease(manifest, progressSource);
    },
    readPage: async input => {
      const { readCatalogCachePage } = await import('../features/catalogCache/catalogIndex');
      return readCatalogCachePage(input);
    },
    loadLearningStates: options.loadLearningStates,
  };
}
