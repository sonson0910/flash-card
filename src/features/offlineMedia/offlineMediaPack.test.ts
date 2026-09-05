import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type {
  CatalogMediaClipV1,
  CatalogSourceAssetRegistryV1,
} from '../catalogPipeline/catalogContracts';
import {
  OfflineMediaPackIntegrityError,
  OfflineMediaPackRightsError,
  OFFLINE_MEDIA_PACK_LIMITS,
  assertOfflineMediaPackInstallable,
  createOfflineMediaPackManager,
  parseOfflineMediaPackManifestV1,
} from './offlineMediaPack';
import type {
  OfflineMediaPackCache,
  OfflineMediaPackCacheStorage,
  OfflineMediaPackLock,
  OfflineMediaPackManifestV1,
} from './offlineMediaPack';

const ORIGIN = 'https://app.test';
const bytes = new Uint8Array([1, 2, 3, 4]);
const sourceAssetSha256 = 'a'.repeat(64);

const registry = (): CatalogSourceAssetRegistryV1 => ({
  registryVersion: 1,
  assets: [{
    sourceRef: 'trusted-audio',
    sourceUrl: 'https://example.test/audio',
    licenseId: 'CC0-1.0',
    rightsEvidenceId: 'rights:audio-1',
    basis: 'open-license',
    commercialUse: 'allowed',
    derivatives: 'allowed',
    rehosting: 'allowed',
    attribution: { required: false, text: null },
    thirdPartyFragments: 'none',
    territory: 'worldwide',
    expiresAt: null,
    sourceRevision: 'revision-1',
    sourceAssetSha256,
    revokedAt: null,
  }],
});

const clip = (overrides: Partial<CatalogMediaClipV1> = {}): CatalogMediaClipV1 => ({
  schemaVersion: 1,
  id: 'clip-one',
  language: 'en',
  mediaKind: 'audio',
  path: 'media/clip-one.wav',
  mimeType: 'audio/wav',
  byteLength: bytes.byteLength,
  durationMs: 1_000,
  contentRights: {
    schemaVersion: 1,
    registryVersion: 1,
    sourceRef: 'trusted-audio',
    sourceAssetSha256,
  },
  transcriptCues: [{
    schemaVersion: 1,
    id: 'cue-one',
    clipId: 'clip-one',
    language: 'en',
    startMs: 0,
    endMs: 1_000,
    text: 'One short sentence.',
  }],
  ...overrides,
});

const digest = async (value: Uint8Array): Promise<string> => {
  const result = await crypto.subtle.digest('SHA-256', value);
  return [...new Uint8Array(result)].map(byte => byte.toString(16).padStart(2, '0')).join('');
};

const manifest = async (overrides: Partial<OfflineMediaPackManifestV1> = {}): Promise<OfflineMediaPackManifestV1> => ({
  manifestVersion: 1,
  id: 'pack-one',
  catalogId: 'catalog-one',
  releaseId: 'release-one',
  title: 'Offline pack one',
  createdAt: '2026-09-05T00:00:00.000Z',
  assets: [{
    clip: clip(),
    sha256: await digest(bytes),
    attribution: null,
  }],
  totalBytes: bytes.byteLength,
  ...overrides,
});

const manifestSha256 = async (value: OfflineMediaPackManifestV1): Promise<string> => (
  digest(new TextEncoder().encode(JSON.stringify(parseOfflineMediaPackManifestV1(value))))
);

const trustedInstall = async (value?: OfflineMediaPackManifestV1) => {
  const manifestValue = value ?? await manifest();
  return {
    publication: {
      status: 'published' as const,
      review: 'reviewed' as const,
      catalogId: manifestValue.catalogId,
      releaseId: manifestValue.releaseId,
      manifestSha256: await manifestSha256(manifestValue),
    },
  };
};

const keyFor = (input: RequestInfo | URL): string => {
  if (typeof input === 'string') return new URL(input, ORIGIN).href;
  if (input instanceof URL) return input.href;
  return input.url;
};

class MemoryCache implements OfflineMediaPackCache {
  readonly entries = new Map<string, Response>();

  async put(request: RequestInfo | URL, response: Response): Promise<void> {
    this.entries.set(keyFor(request), response.clone());
  }

  async match(request: RequestInfo | URL): Promise<Response | undefined> {
    const response = this.entries.get(keyFor(request));
    return response?.clone();
  }

  async keys(): Promise<readonly Request[]> {
    return [...this.entries.keys()].map(key => new Request(key));
  }

  async delete(request: RequestInfo | URL): Promise<boolean> {
    return this.entries.delete(keyFor(request));
  }
}

class MemoryCacheStorage implements OfflineMediaPackCacheStorage {
  readonly caches = new Map<string, MemoryCache>();

  async open(name: string): Promise<MemoryCache> {
    const cache = this.caches.get(name) ?? new MemoryCache();
    this.caches.set(name, cache);
    return cache;
  }

  async keys(): Promise<readonly string[]> {
    return [...this.caches.keys()];
  }

  async delete(name: string): Promise<boolean> {
    return this.caches.delete(name);
  }
}

class MemoryLock implements OfflineMediaPackLock {
  private tail = Promise.resolve();
  active = 0;
  maxActive = 0;

  async request<T>(_name: string, callback: () => Promise<T>): Promise<T> {
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>(resolve => {
      release = resolve;
    });
    await previous;
    this.active += 1;
    this.maxActive = Math.max(this.maxActive, this.active);
    try {
      return await callback();
    } finally {
      this.active -= 1;
      release();
    }
  }
}

const managerOptions = (
  cacheStorage: MemoryCacheStorage,
  responseBytes: Uint8Array = bytes,
  estimateStorage: () => Promise<StorageEstimate> = async () => ({ usage: 0, quota: 1_000_000 }),
  lock: OfflineMediaPackLock = new MemoryLock(),
  nonce: () => string = () => 'nonce-one',
) => ({
  cacheStorage,
  origin: ORIGIN,
  nonce,
  lock,
  estimateStorage,
  now: () => new Date('2026-09-05T00:00:00.000Z'),
  fetcher: vi.fn(async () => new Response(responseBytes, {
    status: 200,
    headers: {
      'Content-Type': 'audio/wav',
      'Content-Length': String(responseBytes.byteLength),
    },
  })),
});

describe('OfflineMediaPackManifestV1', () => {
  it('accepts the bounded exact-key audio manifest', async () => {
    const parsed = parseOfflineMediaPackManifestV1(await manifest());

    expect(parsed.assets).toHaveLength(1);
    expect(parsed.totalBytes).toBe(bytes.byteLength);
  });

  it('rejects unknown keys, duplicate normalized ids/paths, and total mismatches', async () => {
    const valid = await manifest();
    expect(() => parseOfflineMediaPackManifestV1({ ...valid, unexpected: true }))
      .toThrow(/unknown field/i);
    expect(() => parseOfflineMediaPackManifestV1({
      ...valid,
      assets: [valid.assets[0], {
        ...valid.assets[0],
        clip: {
          ...valid.assets[0].clip,
          id: 'clip-two',
          transcriptCues: [{ ...valid.assets[0].clip.transcriptCues[0], clipId: 'clip-two' }],
        },
      }],
      totalBytes: bytes.byteLength * 2,
    })).toThrow(/duplicate.*path/i);
    expect(() => parseOfflineMediaPackManifestV1({
      ...valid,
      totalBytes: bytes.byteLength + 1,
    })).toThrow(/totalBytes/i);
  });

  it('requires explicit published and reviewed release authority before install', async () => {
    const storage = new MemoryCacheStorage();
    const manager = createOfflineMediaPackManager(managerOptions(storage));
    const value = await manifest();
    const trusted = await trustedInstall(value);

    await expect(manager.install(value, registry())).rejects.toBeInstanceOf(OfflineMediaPackRightsError);
    await expect(manager.install(value, registry(), {
      ...trusted,
      publication: { ...trusted.publication, status: 'draft', review: 'unreviewed' },
    })).rejects.toMatchObject({ code: 'offline-pack-release-not-published' });
  });

  it('requires trusted catalog identity and the reviewed manifest digest before fetching', async () => {
    const storage = new MemoryCacheStorage();
    const estimateStorage = vi.fn(async () => ({ usage: 0, quota: 1_000_000 }));
    const options = managerOptions(storage, bytes, estimateStorage);
    const manager = createOfflineMediaPackManager(options);
    const value = await manifest();
    const trusted = await trustedInstall(value);

    await expect(manager.install(value, registry(), {
      ...trusted,
      publication: { ...trusted.publication, catalogId: 'other-catalog' },
    })).rejects.toMatchObject({ code: 'offline-pack-publication-identity-mismatch' });
    await expect(manager.install(value, registry(), {
      ...trusted,
      publication: { ...trusted.publication, manifestSha256: '0'.repeat(64) },
    })).rejects.toMatchObject({ code: 'offline-pack-publication-digest-mismatch' });
    expect(estimateStorage).not.toHaveBeenCalled();
    expect(options.fetcher).not.toHaveBeenCalled();
  });

  it('makes the exported installability assertion verify the canonical publication digest', async () => {
    const value = await manifest();
    const trusted = await trustedInstall(value);

    await expect(assertOfflineMediaPackInstallable(value, registry(), trusted))
      .resolves.toBeUndefined();
    await expect(assertOfflineMediaPackInstallable({ ...value, title: 'Changed publication' }, registry(), trusted))
      .rejects.toMatchObject({ code: 'offline-pack-publication-digest-mismatch' });
  });

  it('rejects prohibited rights before fetching media', async () => {
    const storage = new MemoryCacheStorage();
    const options = managerOptions(storage);
    const manager = createOfflineMediaPackManager(options);
    const prohibited = {
      ...registry(),
      assets: [{ ...registry().assets[0], rehosting: 'prohibited' as const }],
    };

    await expect(manager.install(await manifest(), prohibited, await trustedInstall()))
      .rejects.toMatchObject({ code: 'rights-rehosting-not-allowed' });
    expect(options.fetcher).not.toHaveBeenCalled();
  });

  it('retains the exact required attribution for rehosting delivery', async () => {
    const storage = new MemoryCacheStorage();
    const manager = createOfflineMediaPackManager(managerOptions(storage));
    const attributedRegistry = {
      ...registry(),
      assets: [{
        ...registry().assets[0],
        attribution: { required: true, text: 'Trusted audio credit' },
      }],
    };

    const attributedManifest = await manifest({
      assets: [{ ...((await manifest()).assets[0]), attribution: 'Trusted audio credit' }],
    });
    await expect(manager.install(attributedManifest, attributedRegistry, await trustedInstall(attributedManifest)))
      .resolves.toMatchObject({ id: 'pack-one' });
    await expect(manager.install(await manifest(), attributedRegistry, await trustedInstall()))
      .rejects.toMatchObject({ code: 'rights-attribution-mismatch' });
  });
});

describe('OfflineMediaPackManager', () => {
  it('ships a truthful installable web manifest linked from the document', () => {
    const webManifest = JSON.parse(readFileSync(
      new URL('../../../public/manifest.webmanifest', import.meta.url),
      'utf8',
    )) as Record<string, unknown>;
    const html = readFileSync(new URL('../../../index.html', import.meta.url), 'utf8');

    expect(webManifest).toMatchObject({
      id: '/',
      start_url: '/',
      scope: '/',
      display: 'standalone',
      theme_color: '#0e7490',
      background_color: '#081115',
    });
    expect(webManifest.icons).toEqual(expect.arrayContaining([
      expect.objectContaining({ src: '/favicon.svg', sizes: 'any', type: 'image/svg+xml' }),
      expect.objectContaining({ src: '/brand/sonflash-logo-192.png', sizes: '192x192', type: 'image/png' }),
    ]));
    expect(html).toContain('<link rel="manifest" href="/manifest.webmanifest" />');
  });

  it('fails closed on quota and suggests oldest packs without evicting them', async () => {
    const storage = new MemoryCacheStorage();
    const firstManager = createOfflineMediaPackManager(managerOptions(storage));
    const oldManifest = await manifest({
      id: 'old-pack',
      createdAt: '2026-09-01T00:00:00.000Z',
    });
    await firstManager.install(oldManifest, registry(), await trustedInstall(oldManifest));
    const secondManager = createOfflineMediaPackManager(managerOptions(
      storage,
      bytes,
      async () => ({ usage: 100, quota: 100 }),
    ));

    const newManifest = await manifest({ id: 'new-pack' });
    await expect(secondManager.install(newManifest, registry(), await trustedInstall(newManifest)))
      .rejects.toMatchObject({
        code: 'offline-pack-quota-insufficient',
        suggestedEvictions: [{ id: 'old-pack' }],
      });
    await expect(secondManager.list()).resolves.toEqual([
      expect.objectContaining({ id: 'old-pack' }),
    ]);
  });

  it('fails closed when the browser cannot provide a complete quota estimate', async () => {
    const storage = new MemoryCacheStorage();
    const manager = createOfflineMediaPackManager(managerOptions(
      storage,
      bytes,
      async () => ({ usage: 0 }),
    ));

    await expect(manager.install(await manifest(), registry(), await trustedInstall()))
      .rejects.toMatchObject({ code: 'offline-pack-quota-unavailable', suggestedEvictions: [] });
  });

  it('fails closed when cross-tab Web Locks are unavailable', async () => {
    const storage = new MemoryCacheStorage();
    const manager = createOfflineMediaPackManager({
      ...managerOptions(storage),
      lock: undefined,
    });

    await expect(manager.list()).rejects.toMatchObject({ code: 'offline-pack-lock-unavailable' });
  });

  it('installs atomically, lists, resolves exact cached media, and removes explicitly', async () => {
    const storage = new MemoryCacheStorage();
    const options = managerOptions(storage);
    const manager = createOfflineMediaPackManager(options);
    const installed = await manager.install(await manifest(), registry(), await trustedInstall());

    expect(installed.id).toBe('pack-one');
    expect(options.fetcher).toHaveBeenCalledWith(`${ORIGIN}/media/clip-one.wav`, expect.objectContaining({
      credentials: 'same-origin',
      redirect: 'error',
      signal: expect.any(AbortSignal),
    }));
    expect(await manager.list()).toEqual([installed]);
    expect(await manager.resolveCachedClip(installed.assets[0].clip, {
      catalogId: installed.catalogId,
      releaseId: installed.releaseId,
      sha256: installed.assets[0].sha256,
    })).not.toBeNull();
    expect(await storage.keys()).toEqual(expect.arrayContaining([
      'sonflash-offline-media-packs-v1:index',
    ]));
    expect((await storage.keys()).some(name => name.includes(':staging:'))).toBe(false);

    await expect(manager.remove({
      catalogId: installed.catalogId,
      releaseId: installed.releaseId,
      id: installed.id,
    })).resolves.toBe(true);
    await expect(manager.list()).resolves.toEqual([]);
    await expect(manager.resolveCachedClip(installed.assets[0].clip, {
      catalogId: installed.catalogId,
      releaseId: installed.releaseId,
      sha256: installed.assets[0].sha256,
    })).resolves.toBeNull();
  });

  it('fails closed when the current release, derivative, or immutable clip identity differs', async () => {
    const storage = new MemoryCacheStorage();
    const manager = createOfflineMediaPackManager(managerOptions(storage));
    const installed = await manager.install(await manifest(), registry(), await trustedInstall());
    const identity = {
      catalogId: installed.catalogId,
      releaseId: installed.releaseId,
      sha256: installed.assets[0].sha256,
    };

    await expect(manager.resolveCachedClip(installed.assets[0].clip, {
      ...identity,
      releaseId: 'release-two',
    })).resolves.toBeNull();
    await expect(manager.resolveCachedClip(installed.assets[0].clip, {
      ...identity,
      sha256: 'f'.repeat(64),
    })).resolves.toBeNull();
    await expect(manager.resolveCachedClip({
      ...installed.assets[0].clip,
      transcriptCues: [{
        ...installed.assets[0].clip.transcriptCues[0],
        text: 'Changed immutable cue',
      }],
    }, identity)).resolves.toBeNull();
  });

  it('keeps same-named packs from different catalogs and releases independent', async () => {
    const storage = new MemoryCacheStorage();
    const manager = createOfflineMediaPackManager(managerOptions(storage));
    const firstManifest = await manifest({ catalogId: 'catalog-one', releaseId: 'release-one' });
    const secondManifest = await manifest({ catalogId: 'catalog-two', releaseId: 'release-two' });
    const first = await manager.install(firstManifest, registry(), await trustedInstall(firstManifest));
    const second = await manager.install(secondManifest, registry(), await trustedInstall(secondManifest));

    await expect(manager.list()).resolves.toEqual([first, second]);
    await expect(manager.remove({
      catalogId: first.catalogId,
      releaseId: first.releaseId,
      id: first.id,
    })).resolves.toBe(true);
    await expect(manager.list()).resolves.toEqual([second]);
    await expect(manager.resolveCachedClip(second.assets[0].clip, {
      catalogId: second.catalogId,
      releaseId: second.releaseId,
      sha256: second.assets[0].sha256,
    })).resolves.not.toBeNull();
  });

  it('keeps an existing installed pack when a replacement fails integrity', async () => {
    const storage = new MemoryCacheStorage();
    const goodManager = createOfflineMediaPackManager(managerOptions(storage));
    const oldManifest = await manifest();
    const oldPack = await goodManager.install(oldManifest, registry(), await trustedInstall(oldManifest));
    const badManager = createOfflineMediaPackManager(managerOptions(storage, new Uint8Array([9, 9, 9, 9])));

    const replacement = await manifest({ title: 'Replacement' });
    await expect(badManager.install(replacement, registry(), await trustedInstall(replacement)))
      .rejects.toBeInstanceOf(OfflineMediaPackIntegrityError);
    await expect(badManager.list()).resolves.toEqual([oldPack]);
    await expect(badManager.resolveCachedClip(oldPack.assets[0].clip, {
      catalogId: oldPack.catalogId,
      releaseId: oldPack.releaseId,
      sha256: oldPack.assets[0].sha256,
    })).resolves.not.toBeNull();
    expect((await storage.keys()).some(name => name.includes(':staging:'))).toBe(false);
  });

  it('serializes concurrent installs and never deletes a live candidate', async () => {
    const storage = new MemoryCacheStorage();
    const lock = new MemoryLock();
    const first = createOfflineMediaPackManager(managerOptions(storage, bytes, undefined, lock, () => 'nonce-a'));
    const second = createOfflineMediaPackManager(managerOptions(storage, bytes, undefined, lock, () => 'nonce-b'));
    const firstManifest = await manifest({ id: 'shared-pack', title: 'First' });
    const secondManifest = await manifest({ id: 'shared-pack', title: 'Second' });
    const firstTrusted = await trustedInstall(firstManifest);
    const secondTrusted = await trustedInstall(secondManifest);

    await Promise.all([
      first.install(firstManifest, registry(), firstTrusted),
      second.install(secondManifest, registry(), secondTrusted),
    ]);

    expect(lock.maxActive).toBe(1);
    await expect(first.list()).resolves.toEqual([
      expect.objectContaining({ id: 'shared-pack', title: 'Second' }),
    ]);
    expect((await storage.keys()).filter(name => name.includes(':pack:'))).toHaveLength(1);
  });

  it('rejects a response whose declared content length is not exact', async () => {
    const storage = new MemoryCacheStorage();
    const options = managerOptions(storage);
    options.fetcher.mockImplementation(async () => new Response(bytes, {
      status: 200,
      headers: { 'Content-Type': 'audio/wav', 'Content-Length': '3' },
    }));
    const manager = createOfflineMediaPackManager(options);

    await expect(manager.install(await manifest(), registry(), await trustedInstall()))
      .rejects.toBeInstanceOf(OfflineMediaPackIntegrityError);
    expect((await storage.keys()).some(name => name.includes(':staging:'))).toBe(false);
  });

  it('rejects an excessively fragmented streaming response', async () => {
    const storage = new MemoryCacheStorage();
    const cancel = vi.fn(async () => undefined);
    const releaseLock = vi.fn();
    const read = vi.fn(async () => ({ done: false, value: new Uint8Array() }));
    const options = managerOptions(storage);
    options.fetcher.mockImplementation(async () => ({
      status: 200,
      ok: true,
      redirected: false,
      url: `${ORIGIN}/media/clip-one.wav`,
      headers: new Headers({
        'Content-Type': 'audio/wav',
        'Content-Length': String(bytes.byteLength),
      }),
      body: { getReader: () => ({ read, cancel, releaseLock }) },
    } as unknown as Response));
    const manager = createOfflineMediaPackManager(options);

    await expect(manager.install(await manifest(), registry(), await trustedInstall()))
      .rejects.toBeInstanceOf(OfflineMediaPackIntegrityError);
    expect(read).toHaveBeenCalledTimes(1_025);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect((await storage.keys()).some(name => name.includes(':pack:'))).toBe(false);
  });

  it('cleans incomplete candidate caches and ignores corrupt markers in its namespace', async () => {
    const storage = new MemoryCacheStorage();
    const candidate = await storage.open('sonflash-offline-media-packs-v1:pack:orphan:nonce');
    await candidate.put(`${ORIGIN}/orphan`, new Response('partial'));
    const index = await storage.open('sonflash-offline-media-packs-v1:index');
    await index.put(`${ORIGIN}/__sonflash_offline_media_pack__/broken`, new Response('{"broken":true}'));
    const manager = createOfflineMediaPackManager(managerOptions(storage));

    await expect(manager.list()).resolves.toEqual([]);
    expect(await storage.keys()).toEqual(['sonflash-offline-media-packs-v1:index']);
  });

  it('does not let an invalid alias marker delete a cache referenced by a valid marker', async () => {
    const storage = new MemoryCacheStorage();
    const manager = createOfflineMediaPackManager(managerOptions(storage));
    const installed = await manager.install(await manifest(), registry(), await trustedInstall());
    const index = await storage.open('sonflash-offline-media-packs-v1:index');
    const liveCacheName = (await storage.keys()).find(name => (
      name.includes(':pack:catalog-one:release-one:pack-one:')
    ));
    expect(liveCacheName).toBeDefined();
    await index.put(`${ORIGIN}/__sonflash_offline_media_pack__/alias`, new Response(JSON.stringify({
      markerVersion: 1,
      cacheName: liveCacheName,
      manifest: { ...(await manifest()), id: 'pack-two' },
    }), { headers: { 'Content-Type': 'application/json' } }));

    await expect(manager.list()).resolves.toEqual([installed]);
    await expect(manager.resolveCachedClip(installed.assets[0].clip, {
      catalogId: installed.catalogId,
      releaseId: installed.releaseId,
      sha256: installed.assets[0].sha256,
    })).resolves.not.toBeNull();
  });

  it('rejects an oversized marker before text allocation and keeps valid packs', async () => {
    const storage = new MemoryCacheStorage();
    const manager = createOfflineMediaPackManager(managerOptions(storage));
    const installed = await manager.install(await manifest(), registry(), await trustedInstall());
    const oversizedManifest = await manifest({
      catalogId: 'catalog-two',
      releaseId: 'release-two',
      id: 'pack-two',
    });
    const markerValue = {
      markerVersion: 1,
      cacheName: 'sonflash-offline-media-packs-v1:pack:catalog-two:release-two:pack-two:nonce-two',
      manifest: oversizedManifest,
    };
    const markerJson = JSON.stringify(markerValue);
    const oversizedMarkerJson = `${markerJson}${' '.repeat(OFFLINE_MEDIA_PACK_LIMITS.maximumManifestBytes + 2_048)}`;
    const markerText = vi.fn(async () => {
      throw new Error('unbounded marker text read');
    });
    const markerResponse = new Response(oversizedMarkerJson, {
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': String(new TextEncoder().encode(oversizedMarkerJson).byteLength),
      },
    });
    Object.defineProperty(markerResponse, 'text', { value: markerText });
    Object.defineProperty(markerResponse, 'clone', { value: () => markerResponse });
    const index = await storage.open('sonflash-offline-media-packs-v1:index');
    await index.put(`${ORIGIN}/__sonflash_offline_media_pack__/index/oversized-marker`, markerResponse);

    await expect(manager.list()).resolves.toEqual([installed]);
    expect(markerText).not.toHaveBeenCalled();
  });

  it('rejects oversized metadata before text allocation without deleting unrelated valid packs', async () => {
    const storage = new MemoryCacheStorage();
    const manager = createOfflineMediaPackManager(managerOptions(storage));
    const installed = await manager.install(await manifest(), registry(), await trustedInstall());
    const metadataManifest = await manifest({
      catalogId: 'catalog-two',
      releaseId: 'release-two',
      id: 'pack-two',
    });
    const cacheName = 'sonflash-offline-media-packs-v1:pack:catalog-two:release-two:pack-two:nonce-two';
    const metadataValue = { metadataVersion: 1, manifest: metadataManifest };
    const metadataJson = JSON.stringify(metadataValue);
    const oversizedMetadataJson = `${metadataJson}${' '.repeat(OFFLINE_MEDIA_PACK_LIMITS.maximumManifestBytes + 2_048)}`;
    const metadataText = vi.fn(async () => {
      throw new Error('unbounded metadata text read');
    });
    const metadataResponse = new Response(oversizedMetadataJson, {
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': String(new TextEncoder().encode(oversizedMetadataJson).byteLength),
      },
    });
    Object.defineProperty(metadataResponse, 'text', { value: metadataText });
    Object.defineProperty(metadataResponse, 'clone', { value: () => metadataResponse });
    const metadataCache = await storage.open(cacheName);
    await metadataCache.put('https://app.test/__sonflash_offline_media_pack__/metadata.json', metadataResponse);
    const index = await storage.open('sonflash-offline-media-packs-v1:index');
    await index.put('https://app.test/__sonflash_offline_media_pack__/index/catalog-two/release-two/pack-two', new Response(JSON.stringify({
      markerVersion: 1,
      cacheName,
      manifest: metadataManifest,
    }), { headers: { 'Content-Type': 'application/json' } }));

    await expect(manager.list()).resolves.toEqual([installed]);
    expect(metadataText).not.toHaveBeenCalled();
    expect(await storage.keys()).not.toContain(cacheName);
  });
});
