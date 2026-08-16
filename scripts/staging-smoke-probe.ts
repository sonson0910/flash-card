import { parseCatalogReleaseManifestV1 } from '../src/features/catalogPipeline/catalogValidation';
import type { StagingSmokeEvidence } from '../src/features/releaseReadiness/operationalReadiness';

export const MAX_HEALTH_METADATA_BYTES = 16_384;
export const MAX_RELEASE_MANIFEST_BYTES = 1_048_576;

export interface StagingHealthMetadata {
  readonly status: 'ok';
  readonly service: 'lingoflash';
  readonly version: string;
  readonly revision: string;
  readonly builtAt: string;
}

const mediaType = (response: Response): string => (
  response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() ?? ''
);

const cancelResponseBody = async (response: Response): Promise<void> => {
  try {
    await response.body?.cancel();
  } catch {
    // The caller's AbortController remains the final transport cleanup boundary.
  }
};

const declaredByteLength = (response: Response, maximumBytes: number): number | null | false => {
  const raw = response.headers.get('content-length');
  if (raw === null) return null;
  const normalized = raw.trim();
  if (!/^(?:0|[1-9][0-9]*)$/.test(normalized)) return false;
  const parsed = Number(normalized);
  return Number.isSafeInteger(parsed) && parsed <= maximumBytes ? parsed : false;
};

const readBoundedJson = async (
  response: Response,
  maximumBytes: number,
): Promise<unknown | null> => {
  const encoding = response.headers.get('content-encoding')?.trim().toLowerCase();
  const declaredLength = declaredByteLength(response, maximumBytes);
  if (
    !response.ok
    || mediaType(response) !== 'application/json'
    || (encoding !== undefined && encoding !== 'identity')
    || declaredLength === false
    || !response.body
  ) {
    await cancelResponseBody(response);
    return null;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > maximumBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } catch {
    try {
      await reader.cancel();
    } catch {
      // The request-level AbortController also closes interrupted transports.
    }
    return null;
  }

  if (declaredLength !== null && byteLength !== declaredLength) return null;
  try {
    return JSON.parse(Buffer.concat(chunks.map(chunk => Buffer.from(chunk))).toString('utf8'));
  } catch {
    return null;
  }
};

export const canonicalizeStagingOrigin = (value: string): string => {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new TypeError('STAGING_ORIGIN must be a canonical HTTPS origin.');
  }
  if (
    parsed.protocol !== 'https:'
    || parsed.username
    || parsed.password
    || parsed.pathname !== '/'
    || parsed.search
    || parsed.hash
  ) throw new TypeError('STAGING_ORIGIN must be a canonical HTTPS origin.');
  return parsed.origin;
};

export const validateApplicationDocument = async (response: Response): Promise<boolean> => {
  const valid = response.ok && mediaType(response) === 'text/html' && response.body !== null;
  await cancelResponseBody(response);
  return valid;
};

export const readStagingHealthMetadata = async (
  response: Response,
): Promise<StagingHealthMetadata | null> => {
  const value = await readBoundedJson(response, MAX_HEALTH_METADATA_BYTES);
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (keys.join(',') !== 'builtAt,revision,service,status,version') return null;
  if (
    record.status !== 'ok'
    || record.service !== 'lingoflash'
    || typeof record.version !== 'string'
    || !/^[0-9A-Za-z.+-]{1,64}$/.test(record.version)
    || typeof record.revision !== 'string'
    || !/^[0-9A-Za-z._-]{1,128}$/.test(record.revision)
    || typeof record.builtAt !== 'string'
    || record.builtAt.length > 32
  ) return null;
  const builtAt = new Date(record.builtAt);
  if (!Number.isFinite(builtAt.getTime()) || builtAt.toISOString() !== record.builtAt) return null;
  return record as unknown as StagingHealthMetadata;
};

export const validateCatalogReleaseManifest = async (response: Response): Promise<boolean> => {
  const value = await readBoundedJson(response, MAX_RELEASE_MANIFEST_BYTES);
  if (value === null) return false;
  try {
    parseCatalogReleaseManifestV1(value);
    return true;
  } catch {
    return false;
  }
};
export type StagingFetch = (input: string | URL, init: RequestInit) => Promise<Response>;
export interface StagingSmokeProbeOptions {
  readonly origin: string;
  readonly expectedRevision: string;
  readonly releaseManifestPath: string;
  readonly fetchImpl?: StagingFetch;
  readonly timeoutMs?: number;
}
export const probeStagingSmoke = async (options: StagingSmokeProbeOptions): Promise<StagingSmokeEvidence> => {
  const origin = canonicalizeStagingOrigin(options.origin);
  if (!options.expectedRevision) throw new Error('EXPECTED_REVISION is required.');
  if (!options.releaseManifestPath.startsWith('/') || options.releaseManifestPath.startsWith('//')) {
    throw new Error('CATALOG_MANIFEST_PATH must be a same-origin absolute path.');
  }
  const releaseManifestUrl = new URL(options.releaseManifestPath, origin);
  if (releaseManifestUrl.origin !== origin) {
    throw new Error('Release manifest smoke probe must stay on the staging origin.');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 10_000);
  const request = {
    redirect: 'error' as const,
    signal: controller.signal,
    headers: { 'accept-encoding': 'identity' },
  };
  try {
    const fetchImpl = options.fetchImpl ?? fetch;
    const [page, health, releaseManifest] = await Promise.all([
      fetchImpl(origin, request),
      fetchImpl(new URL('/health.json', origin), request),
      fetchImpl(releaseManifestUrl, request),
    ]);
    const releaseManifestCacheControl = releaseManifest.headers.get('cache-control') ?? '';
    const [applicationValid, metadata, releaseManifestValid] = await Promise.all([
      validateApplicationDocument(page),
      readStagingHealthMetadata(health),
      validateCatalogReleaseManifest(releaseManifest),
    ]);
    return {
      origin,
      expectedRevision: options.expectedRevision,
      actualRevision: metadata?.revision ?? '',
      appStatus: page.status,
      healthStatus: health.status,
      headers: Object.fromEntries(page.headers.entries()),
      releaseManifestCacheControl,
      probes: [
        { name: 'application-document', passed: applicationValid },
        { name: 'health-metadata', passed: metadata !== null },
        { name: 'catalog-manifest', passed: releaseManifestValid },
      ],
    };
  } finally {
    controller.abort();
    clearTimeout(timer);
  }
};
