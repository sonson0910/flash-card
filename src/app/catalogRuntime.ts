import {
  installCatalogRelease,
  type CatalogChunkFetchPort,
  type CatalogReleaseInstallResult,
} from '../features/catalogCache/catalogDelivery';
import {
  queryCatalogCache,
  type CatalogCacheQuery,
  type CatalogCacheQueryResult,
} from '../features/catalogCache/catalogIndex';

const MAXIMUM_CATALOG_CHUNK_BYTES = 512 * 1024;
const MAXIMUM_STREAM_READS = 1_024;

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface SameOriginCatalogChunkSourceOptions {
  readonly baseUrl: string;
  readonly fetcher?: Fetcher;
  /** Test and stricter-call-site override; cannot exceed the catalog contract. */
  readonly maximumBytes?: number;
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

const declaredLength = (headers: Headers): number | null => {
  const value = headers.get('content-length');
  if (value === null) return null;
  if (!/^\d+$/.test(value)) throw new TypeError('Catalog chunk Content-Length is invalid.');
  const length = Number(value);
  if (!Number.isSafeInteger(length)) throw new TypeError('Catalog chunk Content-Length is invalid.');
  return length;
};

const readBoundedBody = async (response: Response, maximumBytes: number): Promise<Uint8Array> => {
  const length = declaredLength(response.headers);
  if (length !== null && length > maximumBytes) {
    throw new RangeError(`Catalog chunk exceeds the maximum size of ${maximumBytes} bytes.`);
  }
  if (!response.body) throw new TypeError('Catalog chunk response requires a streaming body.');

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let reads = 0;
  while (true) {
    const item = await reader.read();
    if (item.done) break;
    reads += 1;
    if (reads > MAXIMUM_STREAM_READS || !(item.value instanceof Uint8Array)) {
      await reader.cancel().catch(() => undefined);
      throw new TypeError('Catalog chunk stream is invalid or excessively fragmented.');
    }
    total += item.value.byteLength;
    if (total > maximumBytes) {
      await reader.cancel().catch(() => undefined);
      throw new RangeError(`Catalog chunk exceeds the maximum size of ${maximumBytes} bytes.`);
    }
    chunks.push(item.value.slice());
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
  const fetcher = options.fetcher ?? globalThis.fetch.bind(globalThis);
  return {
    async fetchChunk(path: string): Promise<Uint8Array> {
      const safePath = relativeCatalogPath(path);
      const url = new URL(safePath, origin);
      if (url.origin !== origin.origin) {
        throw new TypeError('Catalog chunks require a safe same-origin relative catalog path.');
      }
      const response = await fetcher(url.href, {
        cache: 'no-store',
        credentials: 'same-origin',
        redirect: 'error',
      });
      if (!response.ok) throw new Error(`Catalog chunk request failed with HTTP ${response.status}.`);
      return readBoundedBody(response, maximumBytes);
    },
  };
}

export const queryInstalledCatalog = (
  input: CatalogCacheQuery,
): Promise<CatalogCacheQueryResult> => queryCatalogCache(input);

export const installSameOriginCatalog = (
  manifest: unknown,
  baseUrl = globalThis.location?.origin,
): Promise<CatalogReleaseInstallResult> => {
  if (!baseUrl) throw new Error('Catalog installation requires a browser origin.');
  return installCatalogRelease(
    manifest,
    createSameOriginCatalogChunkSource({ baseUrl }),
  );
};
