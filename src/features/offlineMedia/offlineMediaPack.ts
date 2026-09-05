import {
  CATALOG_PIPELINE_LIMITS,
  type CatalogMediaClipV1,
  type CatalogSourceAssetRegistryV1,
} from '../catalogPipeline/catalogContracts';
import {
  CATALOG_TRUSTED_ARTIFACT_USE,
  evaluateCatalogAssetRights,
  indexCatalogSourceAssetRights,
} from '../catalogPipeline/catalogEditorial';
import {
  assertCatalogContentReferences,
  CatalogValidationError,
  parseCatalogMediaClipV1,
  parseCatalogSourceAssetRegistryV1,
} from '../catalogPipeline/catalogValidation';

export const OFFLINE_MEDIA_PACK_CACHE_NAMESPACE = 'sonflash-offline-media-packs-v1';
export const OFFLINE_MEDIA_PACK_LIMITS = Object.freeze({
  maximumAssets: 50,
  maximumTotalBytes: CATALOG_PIPELINE_LIMITS.maximumReleaseBytes,
  maximumTitleLength: 256,
  maximumManifestBytes: 128 * 1024,
  maximumMetadataReserveBytes: 2 * 128 * 1024,
  maximumStreamReads: 1_024,
  maximumEvictionSuggestions: 5,
  fetchTimeoutMs: 10_000,
} as const);

export interface OfflineMediaPackAssetV1 {
  readonly clip: CatalogMediaClipV1;
  readonly sha256: string;
  readonly attribution: string | null;
}

export interface OfflineMediaPackManifestV1 {
  readonly manifestVersion: 1;
  readonly id: string;
  readonly catalogId: string;
  readonly releaseId: string;
  readonly title: string;
  readonly createdAt: string;
  readonly assets: readonly OfflineMediaPackAssetV1[];
  readonly totalBytes: number;
}

export interface OfflineMediaPackPublicationContext {
  readonly status: string;
  readonly review: string;
  readonly catalogId: string;
  readonly releaseId: string;
  /** SHA-256 of the canonical JSON serialization of the parsed pack manifest. */
  readonly manifestSha256: string;
}

export interface OfflineMediaPackInstallOptions {
  /** Supplied by the trusted published-release path, never by pack JSON. */
  readonly publication?: OfflineMediaPackPublicationContext;
  readonly signal?: AbortSignal;
}

export interface OfflineMediaPackRemovalContext {
  readonly catalogId: string;
  readonly releaseId: string;
  readonly id: string;
}

export interface OfflineMediaPackResolutionContext {
  readonly catalogId: string;
  readonly releaseId: string;
  /** Expected SHA-256 of the published derivative for the current lesson clip. */
  readonly sha256: string;
}

export interface OfflineMediaPackCache {
  put(request: RequestInfo | URL, response: Response): Promise<void>;
  match(request: RequestInfo | URL): Promise<Response | undefined>;
  keys(): Promise<readonly Request[]>;
  delete(request: RequestInfo | URL): Promise<boolean>;
}

export interface OfflineMediaPackCacheStorage {
  open(cacheName: string): Promise<OfflineMediaPackCache>;
  keys(): Promise<readonly string[]>;
  delete(cacheName: string): Promise<boolean>;
}

export interface OfflineMediaPackStorageEstimate {
  readonly usage?: number;
  readonly quota?: number;
}

export type OfflineMediaPackFetcher = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export interface OfflineMediaPackManagerOptions {
  readonly cacheStorage?: OfflineMediaPackCacheStorage;
  readonly lock?: OfflineMediaPackLock;
  readonly fetcher?: OfflineMediaPackFetcher;
  readonly estimateStorage?: () => Promise<OfflineMediaPackStorageEstimate>;
  readonly digest?: (algorithm: AlgorithmIdentifier, data: BufferSource) => Promise<ArrayBuffer>;
  readonly origin?: string;
  readonly nonce?: () => string;
  /** Trusted clock seam; install derives rights-decision time internally. */
  readonly now?: () => Date;
  readonly fetchTimeoutMs?: number;
}

export interface OfflineMediaPackLock {
  request<T>(name: string, callback: () => Promise<T>): Promise<T>;
}

export class OfflineMediaPackError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'OfflineMediaPackError';
  }
}

export class OfflineMediaPackRightsError extends OfflineMediaPackError {
  constructor(code: string, message = code) {
    super(code, message);
    this.name = 'OfflineMediaPackRightsError';
  }
}

export class OfflineMediaPackIntegrityError extends OfflineMediaPackError {
  constructor(message: string) {
    super('offline-pack-integrity-mismatch', message);
    this.name = 'OfflineMediaPackIntegrityError';
  }
}

export interface OfflineMediaPackEvictionSuggestion {
  readonly catalogId: string;
  readonly releaseId: string;
  readonly id: string;
  readonly title: string;
  readonly createdAt: string;
  readonly totalBytes: number;
}

export class OfflineMediaPackQuotaError extends OfflineMediaPackError {
  constructor(
    code: 'offline-pack-quota-unavailable' | 'offline-pack-quota-insufficient',
    readonly suggestedEvictions: readonly OfflineMediaPackEvictionSuggestion[],
  ) {
    super(code, code);
    this.name = 'OfflineMediaPackQuotaError';
  }
}

const fail = (path: string, message: string): never => {
  throw new CatalogValidationError(`${path}: ${message}`);
};

const recordAt = (
  value: unknown,
  path: string,
  keys: readonly string[],
): Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail(path, 'expected object');
  }
  const record = value as Record<string, unknown>;
  const unknown = Object.keys(record).find(key => !keys.includes(key));
  if (unknown) fail(`${path}.${unknown}`, 'unknown field');
  return record;
};

const stringAt = (value: unknown, path: string, maximum: number): string => {
  if (typeof value !== 'string' || value.length === 0 || value.length > maximum) {
    fail(path, `expected 1-${maximum} characters`);
  }
  const parsed = value as string;
  if (parsed !== parsed.normalize('NFKC').trim()) fail(path, 'must be canonical and trimmed');
  return parsed;
};

const canonicalIdAt = (value: unknown, path: string): string => {
  const parsed = stringAt(value, path, CATALOG_PIPELINE_LIMITS.maximumIdentifierLength);
  if (!/^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/.test(parsed)) {
    fail(path, 'expected lowercase Firestore-safe identifier');
  }
  return parsed;
};

const isoAt = (value: unknown, path: string): string => {
  const parsed = stringAt(value, path, 32);
  const timestamp = Date.parse(parsed);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== parsed) {
    fail(path, 'expected canonical ISO-8601 UTC timestamp');
  }
  return parsed;
};

const digestAt = (value: unknown, path: string): string => {
  const parsed = stringAt(value, path, 64);
  if (!/^[a-f0-9]{64}$/.test(parsed)) fail(path, 'expected lowercase SHA-256 digest');
  return parsed;
};

const integerAt = (value: unknown, path: string, maximum: number, minimum = 0): number => {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    fail(path, `expected safe integer between ${minimum} and ${maximum}`);
  }
  return Number(value);
};

const nullableTextAt = (value: unknown, path: string, maximum: number): string | null => (
  value === null ? null : stringAt(value, path, maximum)
);

const assetAt = (value: unknown, path: string): OfflineMediaPackAssetV1 => {
  const record = recordAt(value, path, ['clip', 'sha256', 'attribution']);
  const clip = parseCatalogMediaClipV1(record.clip);
  if (clip.mediaKind !== 'audio') fail(`${path}.clip.mediaKind`, 'offline packs only accept audio');
  return {
    clip,
    sha256: digestAt(record.sha256, `${path}.sha256`),
    attribution: nullableTextAt(
      record.attribution,
      `${path}.attribution`,
      CATALOG_PIPELINE_LIMITS.maximumAttributionLength,
    ),
  };
};

export function parseOfflineMediaPackManifestV1(value: unknown): OfflineMediaPackManifestV1 {
  const record = recordAt(value, 'offlineMediaPackManifest', [
    'manifestVersion', 'id', 'catalogId', 'releaseId', 'title', 'createdAt', 'assets', 'totalBytes',
  ]);
  if (!Array.isArray(record.assets)) fail('offlineMediaPackManifest.assets', 'expected array');
  const rawAssets = record.assets as unknown[];
  if (rawAssets.length < 1 || rawAssets.length > OFFLINE_MEDIA_PACK_LIMITS.maximumAssets) {
    fail(
      'offlineMediaPackManifest.assets',
      `expected 1-${OFFLINE_MEDIA_PACK_LIMITS.maximumAssets} items`,
    );
  }
  for (let index = 0; index < rawAssets.length; index += 1) {
    if (!Object.prototype.hasOwnProperty.call(rawAssets, index)) {
      fail(`offlineMediaPackManifest.assets[${index}]`, 'expected a dense array');
    }
  }
  const assets = rawAssets.map((asset, index) => assetAt(
    asset,
    `offlineMediaPackManifest.assets[${index}]`,
  ));
  if (new Set(assets.map(asset => asset.clip.id)).size !== assets.length) {
    fail('offlineMediaPackManifest.assets', 'contains duplicate clip ids');
  }
  if (new Set(assets.map(asset => asset.clip.path)).size !== assets.length) {
    fail('offlineMediaPackManifest.assets', 'contains duplicate clip paths');
  }
  const totalBytes = integerAt(
    record.totalBytes,
    'offlineMediaPackManifest.totalBytes',
    OFFLINE_MEDIA_PACK_LIMITS.maximumTotalBytes,
    1,
  );
  const summedBytes = assets.reduce((sum, asset) => sum + asset.clip.byteLength, 0);
  if (totalBytes !== summedBytes) {
    fail('offlineMediaPackManifest.totalBytes', 'does not equal the sum of clip byte lengths');
  }
  const parsed: OfflineMediaPackManifestV1 = {
    manifestVersion: record.manifestVersion === 1
      ? 1
      : fail('offlineMediaPackManifest.manifestVersion', 'expected version 1'),
    id: canonicalIdAt(record.id, 'offlineMediaPackManifest.id'),
    catalogId: canonicalIdAt(record.catalogId, 'offlineMediaPackManifest.catalogId'),
    releaseId: canonicalIdAt(record.releaseId, 'offlineMediaPackManifest.releaseId'),
    title: stringAt(record.title, 'offlineMediaPackManifest.title', OFFLINE_MEDIA_PACK_LIMITS.maximumTitleLength),
    createdAt: isoAt(record.createdAt, 'offlineMediaPackManifest.createdAt'),
    assets,
    totalBytes,
  };
  try {
    const serialized = JSON.stringify(parsed);
    if (serialized === undefined) fail('offlineMediaPackManifest', 'must be serializable JSON');
    if (new TextEncoder().encode(serialized).byteLength > OFFLINE_MEDIA_PACK_LIMITS.maximumManifestBytes) {
      fail(
        'offlineMediaPackManifest',
        `exceeds ${OFFLINE_MEDIA_PACK_LIMITS.maximumManifestBytes} bytes`,
      );
    }
  } catch (error) {
    if (error instanceof CatalogValidationError && error.message.startsWith('offlineMediaPackManifest')) throw error;
    fail('offlineMediaPackManifest', 'must be serializable JSON');
  }
  return parsed;
}

const assertOfflineMediaPackInstallableAt = (
  manifest: OfflineMediaPackManifestV1,
  registry: CatalogSourceAssetRegistryV1,
  options: OfflineMediaPackInstallOptions = {},
  decisionAt: string,
): void => {
  if (options.publication?.status !== 'published') {
    throw new OfflineMediaPackRightsError('offline-pack-release-not-published');
  }
  if (options.publication.review !== 'reviewed') {
    throw new OfflineMediaPackRightsError('offline-pack-review-required');
  }
  if (options.publication.catalogId !== manifest.catalogId
    || options.publication.releaseId !== manifest.releaseId) {
    throw new OfflineMediaPackRightsError('offline-pack-publication-identity-mismatch');
  }
  if (!/^[a-f0-9]{64}$/.test(options.publication.manifestSha256)) {
    throw new OfflineMediaPackRightsError('offline-pack-publication-digest-mismatch');
  }
  const parsedRegistry = parseCatalogSourceAssetRegistryV1(registry);
  const rightsIndex = indexCatalogSourceAssetRights(parsedRegistry);
  for (const asset of manifest.assets) {
    assertCatalogContentReferences(asset.clip, parsedRegistry);
    const trusted = rightsIndex.get(asset.clip.contentRights.sourceRef);
    if (trusted === undefined) {
      throw new OfflineMediaPackRightsError('rights-asset-not-found');
    }
    const rights = evaluateCatalogAssetRights({
      source: trusted.sourceRef,
      sourceUrl: trusted.sourceUrl,
      licenseId: trusted.licenseId,
      rightsEvidenceId: trusted.rightsEvidenceId,
      attribution: asset.attribution,
    }, rightsIndex, {
      ...CATALOG_TRUSTED_ARTIFACT_USE,
      attributionDelivery: true,
    }, decisionAt);
    if (rights.status === 'rejected') {
      throw new OfflineMediaPackRightsError(rights.reason);
    }
  }
};

export function assertOfflineMediaPackInstallable(
  manifest: OfflineMediaPackManifestV1,
  registry: CatalogSourceAssetRegistryV1,
  options: OfflineMediaPackInstallOptions = {},
): void {
  assertOfflineMediaPackInstallableAt(manifest, registry, options, new Date().toISOString());
}

interface OfflineMediaPackMarkerV1 {
  readonly markerVersion: 1;
  readonly cacheName: string;
  readonly manifest: OfflineMediaPackManifestV1;
}

interface OfflineMediaPackMetadataV1 {
  readonly metadataVersion: 1;
  readonly manifest: OfflineMediaPackManifestV1;
}

interface ActivePack {
  readonly markerUrl: string;
  readonly cacheName: string;
  readonly manifest: OfflineMediaPackManifestV1;
}

const INDEX_CACHE_NAME = `${OFFLINE_MEDIA_PACK_CACHE_NAMESPACE}:index`;
const LOCK_NAME = `${OFFLINE_MEDIA_PACK_CACHE_NAMESPACE}:lock`;
const INDEX_PATH = '/__sonflash_offline_media_pack__/index/';
const PACK_METADATA_PATH = '/__sonflash_offline_media_pack__/metadata.json';
const CANONICAL_ID_PATTERN = '[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?';
const OWNED_PACK_CACHE_PATTERN = new RegExp(
  `^${OFFLINE_MEDIA_PACK_CACHE_NAMESPACE}:pack:(?:${CANONICAL_ID_PATTERN}:${CANONICAL_ID_PATTERN}:${CANONICAL_ID_PATTERN}|${CANONICAL_ID_PATTERN}):[A-Za-z0-9._-]+$`,
);

const isOwnedPackCacheName = (value: unknown): value is string => (
  typeof value === 'string' && OWNED_PACK_CACHE_PATTERN.test(value)
);

const packIdentity = (
  catalogId: string,
  releaseId: string,
  packId: string,
): string => `${catalogId}:${releaseId}:${packId}`;

const defaultFetcher: OfflineMediaPackFetcher = (input, init) => globalThis.fetch(input, init);

const defaultLock = (): OfflineMediaPackLock | undefined => (
  globalThis.navigator?.locks as unknown as OfflineMediaPackLock | undefined
);

const defaultEstimate = async (): Promise<OfflineMediaPackStorageEstimate> => {
  if (!globalThis.navigator?.storage?.estimate) {
    throw new OfflineMediaPackError('offline-pack-quota-unavailable', 'storage estimate unavailable');
  }
  return globalThis.navigator.storage.estimate();
};

const defaultDigest = async (
  algorithm: AlgorithmIdentifier,
  data: BufferSource,
): Promise<ArrayBuffer> => {
  if (!globalThis.crypto?.subtle) {
    throw new OfflineMediaPackError('offline-pack-crypto-unavailable', 'WebCrypto unavailable');
  }
  return globalThis.crypto.subtle.digest(algorithm, data);
};

const defaultNonce = (): string => (
  globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`
);

const hexDigest = (value: ArrayBuffer): string => (
  [...new Uint8Array(value)].map(byte => byte.toString(16).padStart(2, '0')).join('')
);

const responseClone = (response: Response): Response => response.clone();

const asJsonResponse = (value: unknown): Response => {
  const text = JSON.stringify(value);
  if (text === undefined) throw new OfflineMediaPackError('offline-pack-serialization-failed', 'metadata is not JSON');
  return new Response(text, {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': String(new TextEncoder().encode(text).byteLength),
    },
  });
};

const textFromResponse = async (response: Response): Promise<string> => responseClone(response).text();

const markerAt = (value: unknown): OfflineMediaPackMarkerV1 => {
  const record = recordAt(value, 'offlineMediaPackMarker', ['markerVersion', 'cacheName', 'manifest']);
  const cacheName = stringAt(record.cacheName, 'offlineMediaPackMarker.cacheName', 512);
  if (!isOwnedPackCacheName(cacheName)) {
    fail('offlineMediaPackMarker.cacheName', 'must belong to the offline pack namespace');
  }
  const manifest = parseOfflineMediaPackManifestV1(record.manifest);
  const cacheParts = cacheName.slice(`${OFFLINE_MEDIA_PACK_CACHE_NAMESPACE}:pack:`.length).split(':');
  const cacheIdentity = cacheParts.length === 4 ? cacheParts.slice(0, 3).join(':') : null;
  if (cacheIdentity !== packIdentity(manifest.catalogId, manifest.releaseId, manifest.id)) {
    fail('offlineMediaPackMarker.cacheName', 'does not match the manifest identity');
  }
  return {
    markerVersion: record.markerVersion === 1
      ? 1
      : fail('offlineMediaPackMarker.markerVersion', 'expected version 1'),
    cacheName,
    manifest,
  };
};

const metadataAt = (value: unknown): OfflineMediaPackMetadataV1 => {
  const record = recordAt(value, 'offlineMediaPackMetadata', ['metadataVersion', 'manifest']);
  return {
    metadataVersion: record.metadataVersion === 1
      ? 1
      : fail('offlineMediaPackMetadata.metadataVersion', 'expected version 1'),
    manifest: parseOfflineMediaPackManifestV1(record.manifest),
  };
};

const sameManifest = (
  left: OfflineMediaPackManifestV1,
  right: OfflineMediaPackManifestV1,
): boolean => JSON.stringify(left) === JSON.stringify(right);

const sameClip = (
  left: CatalogMediaClipV1,
  right: CatalogMediaClipV1,
): boolean => JSON.stringify(left) === JSON.stringify(right);

export class OfflineMediaPackManager {
  private readonly cacheStorage: OfflineMediaPackCacheStorage | undefined;
  private readonly lock: OfflineMediaPackLock | undefined;
  private readonly fetcher: OfflineMediaPackFetcher;
  private readonly estimateStorage: () => Promise<OfflineMediaPackStorageEstimate>;
  private readonly digest: (
    algorithm: AlgorithmIdentifier,
    data: BufferSource,
  ) => Promise<ArrayBuffer>;
  private readonly origin: string;
  private readonly nonce: () => string;
  private readonly now: () => Date;
  private readonly fetchTimeoutMs: number;

  constructor(options: OfflineMediaPackManagerOptions = {}) {
    this.cacheStorage = options.cacheStorage
      ?? (globalThis.caches as unknown as OfflineMediaPackCacheStorage | undefined);
    this.lock = options.lock ?? defaultLock();
    this.fetcher = options.fetcher ?? defaultFetcher;
    this.estimateStorage = options.estimateStorage ?? defaultEstimate;
    this.digest = options.digest ?? defaultDigest;
    this.origin = options.origin ?? globalThis.location?.origin ?? 'http://localhost';
    this.nonce = options.nonce ?? defaultNonce;
    this.now = options.now ?? (() => new Date());
    this.fetchTimeoutMs = options.fetchTimeoutMs ?? OFFLINE_MEDIA_PACK_LIMITS.fetchTimeoutMs;
  }

  async install(
    value: unknown,
    registry: CatalogSourceAssetRegistryV1,
    options: OfflineMediaPackInstallOptions = {},
  ): Promise<OfflineMediaPackManifestV1> {
    return this.withLock(() => this.installUnlocked(value, registry, options));
  }

  private async installUnlocked(
    value: unknown,
    registry: CatalogSourceAssetRegistryV1,
    options: OfflineMediaPackInstallOptions,
  ): Promise<OfflineMediaPackManifestV1> {
    const manifest = parseOfflineMediaPackManifestV1(value);
    let decisionAt: string;
    try {
      const now = this.now();
      if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new TypeError('invalid trusted clock');
      decisionAt = now.toISOString();
    } catch {
      throw new OfflineMediaPackRightsError('offline-pack-decision-time-unavailable');
    }
    assertOfflineMediaPackInstallableAt(manifest, registry, options, decisionAt);
    let actualManifestSha256: string;
    try {
      actualManifestSha256 = hexDigest(await this.digest(
        'SHA-256',
        new TextEncoder().encode(JSON.stringify(manifest)),
      ));
    } catch {
      throw new OfflineMediaPackRightsError('offline-pack-publication-digest-unavailable');
    }
    if (actualManifestSha256 !== options.publication?.manifestSha256) {
      throw new OfflineMediaPackRightsError('offline-pack-publication-digest-mismatch');
    }
    const suggestions = await this.evictionSuggestionsUnlocked();
    let estimate: OfflineMediaPackStorageEstimate;
    try {
      estimate = await this.estimateStorage();
    } catch {
      throw new OfflineMediaPackQuotaError('offline-pack-quota-unavailable', suggestions);
    }
    if (!Number.isFinite(estimate.usage)
      || !Number.isFinite(estimate.quota)
      || (estimate.usage as number) < 0
      || (estimate.quota as number) < (estimate.usage as number)) {
      throw new OfflineMediaPackQuotaError('offline-pack-quota-unavailable', suggestions);
    }
    const requiredBytes = manifest.totalBytes + OFFLINE_MEDIA_PACK_LIMITS.maximumMetadataReserveBytes;
    if ((estimate.quota as number) - (estimate.usage as number) < requiredBytes) {
      throw new OfflineMediaPackQuotaError('offline-pack-quota-insufficient', suggestions);
    }

    const storage = this.requireCacheStorage();
    const active = await this.activePacksUnlocked();
    const old = active.find(pack => (
      pack.manifest.catalogId === manifest.catalogId
      && pack.manifest.releaseId === manifest.releaseId
      && pack.manifest.id === manifest.id
    ));
    const index = await storage.open(INDEX_CACHE_NAME);
    const markerUrl = this.markerUrl(manifest);
    const oldMarker = await index.match(markerUrl);
    const oldMarkerText = oldMarker === undefined ? null : await textFromResponse(oldMarker);
    const candidateName = await this.nextCandidateName(storage, manifest);
    const candidate = await storage.open(candidateName);
    try {
      for (const asset of manifest.assets) {
        const url = this.mediaUrl(asset.clip.path);
        const bytes = await this.fetchVerifiedBytes(url, asset.clip, asset.sha256, options.signal);
        await candidate.put(url, new Response(bytes, {
          status: 200,
          headers: {
            'Content-Type': asset.clip.mimeType,
            'Content-Length': String(bytes.byteLength),
          },
        }));
      }
      const metadata: OfflineMediaPackMetadataV1 = { metadataVersion: 1, manifest };
      await candidate.put(this.metadataUrl(), asJsonResponse(metadata));
      await this.assertMetadata(candidate, manifest);

      const marker: OfflineMediaPackMarkerV1 = {
        markerVersion: 1,
        cacheName: candidateName,
        manifest,
      };
      await index.put(markerUrl, asJsonResponse(marker));
      const publishedMarker = await index.match(markerUrl);
      if (publishedMarker === undefined) throw new OfflineMediaPackError('offline-pack-publish-failed', 'active marker missing');
      const parsedMarker = markerAt(JSON.parse(await textFromResponse(publishedMarker)));
      if (parsedMarker.cacheName !== candidateName || !sameManifest(parsedMarker.manifest, manifest)) {
        throw new OfflineMediaPackError('offline-pack-publish-failed', 'active marker mismatch');
      }
      if (old !== undefined && old.cacheName !== candidateName) {
        try {
          await storage.delete(old.cacheName);
        } catch {
          // The active marker already points at the complete replacement.
        }
      }
      return manifest;
    } catch (error) {
      try {
        await storage.delete(candidateName);
      } catch {
        // Keep the old active marker intact even if cleanup is temporarily unavailable.
      }
      try {
        if (oldMarkerText === null) {
          await index.delete(markerUrl);
        } else {
          await index.put(markerUrl, new Response(oldMarkerText, {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }));
        }
      } catch {
        // Do not replace the original failure with best-effort rollback noise.
      }
      if (error instanceof OfflineMediaPackError) throw error;
      throw new OfflineMediaPackError('offline-pack-install-failed', 'offline media pack installation failed');
    }
  }

  async list(): Promise<readonly OfflineMediaPackManifestV1[]> {
    return this.withLock(async () => this.listUnlocked());
  }

  private async listUnlocked(): Promise<readonly OfflineMediaPackManifestV1[]> {
    return (await this.activePacksUnlocked()).map(pack => pack.manifest);
  }

  async remove(context: OfflineMediaPackRemovalContext): Promise<boolean> {
    return this.withLock(() => this.removeUnlocked(context));
  }

  private async removeUnlocked(context: OfflineMediaPackRemovalContext): Promise<boolean> {
    const catalogId = canonicalIdAt(context.catalogId, 'offlineMediaPack.catalogId');
    const releaseId = canonicalIdAt(context.releaseId, 'offlineMediaPack.releaseId');
    const id = canonicalIdAt(context.id, 'offlineMediaPack.id');
    const storage = this.requireCacheStorage();
    const active = await this.activePacksUnlocked();
    const pack = active.find(candidate => (
      candidate.manifest.catalogId === catalogId
      && candidate.manifest.releaseId === releaseId
      && candidate.manifest.id === id
    ));
    if (pack === undefined) return false;
    await storage.delete(pack.cacheName);
    const index = await storage.open(INDEX_CACHE_NAME);
    await index.delete(pack.markerUrl);
    return true;
  }

  async resolveCachedClip(
    value: CatalogMediaClipV1,
    context: OfflineMediaPackResolutionContext,
  ): Promise<Response | null> {
    return this.withLock(() => this.resolveCachedClipUnlocked(value, context));
  }

  private async resolveCachedClipUnlocked(
    value: CatalogMediaClipV1,
    context: OfflineMediaPackResolutionContext,
  ): Promise<Response | null> {
    let clip: CatalogMediaClipV1;
    let resolution: OfflineMediaPackResolutionContext;
    try {
      clip = parseCatalogMediaClipV1(value);
      resolution = {
        catalogId: canonicalIdAt(context?.catalogId, 'offlineMediaPackResolution.catalogId'),
        releaseId: canonicalIdAt(context?.releaseId, 'offlineMediaPackResolution.releaseId'),
        sha256: digestAt(context?.sha256, 'offlineMediaPackResolution.sha256'),
      };
    } catch {
      return null;
    }
    if (clip.mediaKind !== 'audio') return null;
    try {
      const storage = this.requireCacheStorage();
      const active = await this.activePacksUnlocked();
      for (const pack of active) {
        const asset = pack.manifest.assets.find(candidate => (
          pack.manifest.catalogId === resolution.catalogId
          && pack.manifest.releaseId === resolution.releaseId
          && candidate.sha256 === resolution.sha256
          && sameClip(candidate.clip, clip)
          && candidate.clip.id === clip.id
        ));
        if (asset === undefined) continue;
        const cache = await storage.open(pack.cacheName);
        const response = await cache.match(this.mediaUrl(clip.path));
        if (response === undefined) continue;
        try {
          const bytes = await this.readVerifiedResponse(response, clip, asset.sha256);
          return new Response(bytes, {
            status: 200,
            headers: {
              'Content-Type': clip.mimeType,
              'Content-Length': String(bytes.byteLength),
            },
          });
        } catch {
          await storage.delete(pack.cacheName);
          const index = await storage.open(INDEX_CACHE_NAME);
          await index.delete(pack.markerUrl);
        }
      }
    } catch {
      return null;
    }
    return null;
  }

  private async withLock<T>(operation: () => Promise<T>): Promise<T> {
    if (this.lock === undefined) {
      throw new OfflineMediaPackError(
        'offline-pack-lock-unavailable',
        'Web Locks API unavailable; offline pack operation is disabled',
      );
    }
    let entered = false;
    try {
      return await this.lock.request(LOCK_NAME, async () => {
        entered = true;
        return operation();
      });
    } catch (error) {
      if (entered) throw error;
      if (error instanceof OfflineMediaPackError) throw error;
      throw new OfflineMediaPackError('offline-pack-lock-unavailable', 'offline pack lock failed');
    }
  }

  private requireCacheStorage(): OfflineMediaPackCacheStorage {
    if (this.cacheStorage === undefined) {
      throw new OfflineMediaPackError('offline-pack-cache-unavailable', 'Cache Storage unavailable');
    }
    return this.cacheStorage;
  }

  private markerUrl(manifest: OfflineMediaPackManifestV1): string {
    return new URL(
      `${INDEX_PATH}${manifest.catalogId}/${manifest.releaseId}/${manifest.id}`,
      `${this.origin}/`,
    ).href;
  }

  private async nextCandidateName(
    storage: OfflineMediaPackCacheStorage,
    manifest: OfflineMediaPackManifestV1,
  ): Promise<string> {
    const existing = new Set(await storage.keys());
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const nonce = this.nonce();
      const suffix = attempt === 0 ? nonce : `${nonce}-${attempt}`;
      const candidate = `${OFFLINE_MEDIA_PACK_CACHE_NAMESPACE}:pack:${packIdentity(
        manifest.catalogId,
        manifest.releaseId,
        manifest.id,
      )}:${suffix}`;
      if (!existing.has(candidate)) return candidate;
    }
    throw new OfflineMediaPackError('offline-pack-candidate-collision', 'offline pack candidate name is unavailable');
  }

  private metadataUrl(): string {
    return new URL(PACK_METADATA_PATH, `${this.origin}/`).href;
  }

  private mediaUrl(path: string): string {
    const url = new URL(path, `${this.origin}/`);
    if (url.origin !== this.origin || url.search || url.hash || url.pathname !== `/${path}`) {
      throw new OfflineMediaPackIntegrityError('media path is not a same-origin relative path');
    }
    return url.href;
  }

  private async evictionSuggestionsUnlocked(): Promise<readonly OfflineMediaPackEvictionSuggestion[]> {
    try {
      return [...await this.listUnlocked()]
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))
        .slice(0, OFFLINE_MEDIA_PACK_LIMITS.maximumEvictionSuggestions)
        .map(pack => ({
          catalogId: pack.catalogId,
          releaseId: pack.releaseId,
          id: pack.id,
          title: pack.title,
          createdAt: pack.createdAt,
          totalBytes: pack.totalBytes,
        }));
    } catch {
      return [];
    }
  }

  private async activePacksUnlocked(keepCacheName?: string): Promise<readonly ActivePack[]> {
    const storage = this.requireCacheStorage();
    const cacheNames = await storage.keys();
    const index = cacheNames.includes(INDEX_CACHE_NAME)
      ? await storage.open(INDEX_CACHE_NAME)
      : null;
    if (index === null) {
      await this.deleteUnreferencedPackCaches(storage, cacheNames, new Set(), keepCacheName);
      return [];
    }
    const active: ActivePack[] = [];
    const referenced = new Set<string>();
    for (const request of await index.keys()) {
      const requestUrl = request.url;
      if (!requestUrl.startsWith(`${this.origin}${INDEX_PATH}`)) continue;
      const response = await index.match(request);
      if (response === undefined) continue;
      let marker: OfflineMediaPackMarkerV1;
      try {
        marker = markerAt(JSON.parse(await textFromResponse(response)));
        if (this.markerUrl(marker.manifest) !== requestUrl
          || !cacheNames.includes(marker.cacheName)) throw new TypeError('invalid active marker');
        const packCache = await storage.open(marker.cacheName);
        await this.assertMetadata(packCache, marker.manifest);
      } catch {
        await index.delete(request);
        continue;
      }
      referenced.add(marker.cacheName);
      active.push({ markerUrl: requestUrl, cacheName: marker.cacheName, manifest: marker.manifest });
    }
    await this.deleteUnreferencedPackCaches(storage, cacheNames, referenced, keepCacheName);
    return active.sort((left, right) => left.manifest.id.localeCompare(right.manifest.id));
  }

  private async deleteUnreferencedPackCaches(
    storage: OfflineMediaPackCacheStorage,
    cacheNames: readonly string[],
    referenced: ReadonlySet<string>,
    keepCacheName?: string,
  ): Promise<void> {
    for (const name of cacheNames.filter(candidate => (
      isOwnedPackCacheName(candidate)
      && !referenced.has(candidate)
      && candidate !== keepCacheName
    ))) {
      try {
        await storage.delete(name);
      } catch {
        // Cleanup remains confined to unreferenced offline-pack caches.
      }
    }
  }

  private async assertMetadata(
    cache: OfflineMediaPackCache,
    expected: OfflineMediaPackManifestV1,
  ): Promise<void> {
    const response = await cache.match(this.metadataUrl());
    if (response === undefined) throw new OfflineMediaPackError('offline-pack-metadata-missing', 'pack metadata missing');
    const metadata = metadataAt(JSON.parse(await textFromResponse(response)));
    if (!sameManifest(metadata.manifest, expected)) {
      throw new OfflineMediaPackError('offline-pack-metadata-mismatch', 'pack metadata mismatch');
    }
  }

  private async fetchVerifiedBytes(
    url: string,
    clip: CatalogMediaClipV1,
    expectedSha256: string,
    externalSignal?: AbortSignal,
  ): Promise<Uint8Array> {
    const controller = new AbortController();
    let timedOut = false;
    const abortExternal = () => controller.abort();
    if (externalSignal?.aborted) controller.abort();
    externalSignal?.addEventListener('abort', abortExternal, { once: true });
    const timeout = globalThis.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.fetchTimeoutMs);
    try {
      const response = await this.fetcher(url, {
        credentials: 'same-origin',
        redirect: 'error',
        signal: controller.signal,
      });
      if (response.status !== 200 || !response.ok) {
        throw new OfflineMediaPackIntegrityError('media response was not a successful 200 response');
      }
      if (response.redirected) throw new OfflineMediaPackIntegrityError('media response was redirected');
      if (response.url) {
        const responseUrl = new URL(response.url, `${this.origin}/`);
        if (responseUrl.origin !== this.origin) throw new OfflineMediaPackIntegrityError('media response was cross-origin');
      }
      const contentType = response.headers.get('Content-Type');
      if (contentType?.trim().toLowerCase() !== clip.mimeType.toLowerCase()) {
        throw new OfflineMediaPackIntegrityError('media Content-Type did not match the manifest');
      }
      const contentLength = response.headers.get('Content-Length');
      if (contentLength === null || !/^\d+$/.test(contentLength) || Number(contentLength) !== clip.byteLength) {
        throw new OfflineMediaPackIntegrityError('media Content-Length did not match the manifest');
      }
      return await this.readVerifiedResponse(response, clip, expectedSha256, controller.signal);
    } catch (error) {
      if (error instanceof OfflineMediaPackError) throw error;
      if (timedOut) throw new OfflineMediaPackError('offline-pack-fetch-timeout', 'media fetch timed out');
      if (controller.signal.aborted) throw new OfflineMediaPackError('offline-pack-fetch-aborted', 'media fetch aborted');
      throw new OfflineMediaPackError('offline-pack-fetch-failed', 'media fetch failed');
    } finally {
      globalThis.clearTimeout(timeout);
      externalSignal?.removeEventListener('abort', abortExternal);
    }
  }

  private async readVerifiedResponse(
    response: Response,
    clip: CatalogMediaClipV1,
    expectedSha256: string,
    signal?: AbortSignal,
  ): Promise<Uint8Array> {
    if (response.body === null) throw new OfflineMediaPackIntegrityError('media response body unavailable');
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    let reads = 0;
    let abortRead: (() => void) | undefined;
    const aborted = signal === undefined ? null : new Promise<never>((_resolve, reject) => {
      const fail = () => reject(signal.reason ?? new Error('media read aborted'));
      abortRead = fail;
      if (signal.aborted) fail();
      else signal.addEventListener('abort', fail, { once: true });
    });
    try {
      while (true) {
        const next = aborted === null
          ? await reader.read()
          : await Promise.race([reader.read(), aborted]);
        if (next.done) break;
        reads += 1;
        if (reads > OFFLINE_MEDIA_PACK_LIMITS.maximumStreamReads
          || !(next.value instanceof Uint8Array)) {
          throw new OfflineMediaPackIntegrityError('media response stream was invalid or excessively fragmented');
        }
        const chunk = next.value;
        total += chunk.byteLength;
        if (total > clip.byteLength || total > CATALOG_PIPELINE_LIMITS.maximumMediaClipBytes) {
          throw new OfflineMediaPackIntegrityError('media response exceeded its declared bound');
        }
        chunks.push(chunk.slice());
      }
    } catch (error) {
      try {
        await reader.cancel();
      } catch {
        // Cancellation is advisory; preserve the original bounded-read failure.
      }
      throw error;
    } finally {
      if (signal !== undefined && abortRead !== undefined) signal.removeEventListener('abort', abortRead);
      reader.releaseLock();
    }
    if (total !== clip.byteLength) {
      throw new OfflineMediaPackIntegrityError('media byte count did not match the manifest');
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const actualSha256 = hexDigest(await this.digest('SHA-256', bytes));
    if (actualSha256 !== expectedSha256) {
      throw new OfflineMediaPackIntegrityError('media SHA-256 did not match the manifest');
    }
    return bytes;
  }
}

export const createOfflineMediaPackManager = (
  options: OfflineMediaPackManagerOptions = {},
): OfflineMediaPackManager => new OfflineMediaPackManager(options);
