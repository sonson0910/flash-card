import fs from 'node:fs';
import vm from 'node:vm';
import { createHash, webcrypto } from 'node:crypto';
import { describe, expect, it } from 'vitest';

type WorkerApi = {
  createServiceWorkerHandlers(options: Record<string, unknown>): {
    install(): Promise<void>;
    activate(): Promise<void>;
    handleFetch(request: unknown): Promise<Response | undefined>;
    shouldHandleFetch(request: unknown): boolean;
  };
  shellCacheName(fingerprint: string): string;
  registerServiceWorker(
    scope: Record<string, unknown>,
    descriptor: unknown,
    options?: Record<string, unknown>,
  ): unknown;
};

type StoredResponse = { body: string; headers: Record<string, string>; status: number };

const requestKey = (request: RequestInfo | URL): string => new URL(
  typeof request === 'string' ? request : request instanceof URL ? request.href : request.url,
  'https://app.test',
).href;

class MemoryCache {
  readonly entries = new Map<string, StoredResponse>();

  constructor(private readonly failPuts = false) {}

  async put(request: RequestInfo | URL, response: Response): Promise<void> {
    if (this.failPuts) throw new Error('quota exceeded');
    const body = await response.clone().text();
    this.entries.set(requestKey(request), {
      body,
      headers: Object.fromEntries(response.headers.entries()),
      status: response.status,
    });
  }

  async match(request: RequestInfo | URL): Promise<Response | undefined> {
    const stored = this.entries.get(requestKey(request));
    return stored === undefined
      ? undefined
      : new Response(stored.body, { status: stored.status, headers: stored.headers });
  }
}

class MemoryCacheStorage {
  readonly caches = new Map<string, MemoryCache>();

  constructor(private readonly failPutNames = new Set<string>()) {}

  async open(name: string): Promise<MemoryCache> {
    const cache = this.caches.get(name) ?? new MemoryCache(this.failPutNames.has(name));
    this.caches.set(name, cache);
    return cache;
  }

  async keys(): Promise<string[]> {
    return [...this.caches.keys()];
  }

  async delete(name: string): Promise<boolean> {
    return this.caches.delete(name);
  }
}

const loadWorkerApi = (): WorkerApi => {
  const source = fs.readFileSync(new URL('./service-worker.js', import.meta.url), 'utf8');
  const context = {
    AbortController,
    Headers,
    Promise,
    Request,
    Response,
    URL,
    TextEncoder,
    clearTimeout,
    console,
    crypto: webcrypto,
    setTimeout,
  } as Record<string, unknown>;
  context.globalThis = context;
  vm.runInNewContext(source, context, { filename: 'service-worker.js' });
  return context.__SONFLASH_SERVICE_WORKER__ as WorkerApi;
};

const descriptor = {
  revision: 'revision-a',
  fingerprint: 'a'.repeat(64),
  assets: [
    {
      url: '/index.html',
      sha256: '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
      bytes: 5,
    },
  ],
};

const digest = (value: string): string => createHash('sha256').update(value).digest('hex');
const appDescriptor = {
  revision: 'revision-a',
  fingerprint: 'b'.repeat(64),
  assets: [
    { url: '/index.html', sha256: digest('shell'), bytes: 5 },
    { url: '/assets/app.js', sha256: digest('app'), bytes: 3 },
  ],
};

describe('offline service worker', () => {
  it('installs verified assets into a versioned candidate cache', async () => {
    const api = loadWorkerApi();
    const storage = new MemoryCacheStorage();
    const active = await storage.open('sonflash-app-shell-v1-old');
    await active.put('https://app.test/index.html', new Response('old', {
      headers: { 'content-type': 'text/html' },
    }));
    const handler = api.createServiceWorkerHandlers({
      descriptor,
      cacheStorage: storage,
      origin: 'https://app.test',
      fetcher: async () => new Response('hello', {
        headers: { 'content-type': 'text/html' },
      }),
    });

    await handler.install();

    expect(await storage.keys()).toEqual([
      'sonflash-app-shell-v1-old',
      api.shellCacheName(descriptor.fingerprint),
    ]);
    expect((await active.match('https://app.test/index.html'))?.status).toBe(200);
    const cached = await (await storage.open(api.shellCacheName(descriptor.fingerprint))).match(
      'https://app.test/index.html',
    );
    expect(cached).toBeDefined();
    expect(await cached?.text()).toBe('hello');
  });

  it('rejects a hash mismatch without replacing the active generation', async () => {
    const api = loadWorkerApi();
    const storage = new MemoryCacheStorage();
    const active = await storage.open('sonflash-app-shell-v1-old');
    await active.put('https://app.test/index.html', new Response('old', {
      headers: { 'content-type': 'text/html' },
    }));
    const handler = api.createServiceWorkerHandlers({
      descriptor,
      cacheStorage: storage,
      origin: 'https://app.test',
      fetcher: async () => new Response('xxxxx', {
        headers: { 'content-type': 'text/html' },
      }),
    });

    await expect(handler.install()).rejects.toMatchObject({ code: 'hash-mismatch' });

    expect(await storage.keys()).toEqual(['sonflash-app-shell-v1-old']);
    expect(await (await active.match('https://app.test/index.html'))?.text()).toBe('old');
  });

  it('rejects a byte-count mismatch before writing the candidate', async () => {
    const api = loadWorkerApi();
    const storage = new MemoryCacheStorage();
    const handler = api.createServiceWorkerHandlers({
      descriptor,
      cacheStorage: storage,
      origin: 'https://app.test',
      fetcher: async () => new Response('hello!', {
        headers: { 'content-type': 'text/html' },
      }),
    });

    await expect(handler.install()).rejects.toMatchObject({ code: 'byte-mismatch' });
    expect(await storage.keys()).toEqual([]);
  });

  it('rolls back a quota failure without deleting the active generation', async () => {
    const api = loadWorkerApi();
    const candidateName = api.shellCacheName(descriptor.fingerprint);
    const storage = new MemoryCacheStorage(new Set([candidateName]));
    const active = await storage.open('sonflash-app-shell-v1-old');
    await active.put('https://app.test/index.html', new Response('old', {
      headers: { 'content-type': 'text/html' },
    }));
    const handler = api.createServiceWorkerHandlers({
      descriptor,
      cacheStorage: storage,
      origin: 'https://app.test',
      fetcher: async () => new Response('hello', {
        headers: { 'content-type': 'text/html' },
      }),
    });

    await expect(handler.install()).rejects.toThrow('quota exceeded');

    expect(await storage.keys()).toEqual(['sonflash-app-shell-v1-old']);
    expect(await (await active.match('https://app.test/index.html'))?.text()).toBe('old');
  });

  it('bounds a hanging asset fetch and removes its candidate cache', async () => {
    const api = loadWorkerApi();
    const storage = new MemoryCacheStorage();
    let aborted = false;
    const handler = api.createServiceWorkerHandlers({
      descriptor,
      cacheStorage: storage,
      origin: 'https://app.test',
      fetchTimeoutMs: 20,
      fetcher: async (_request: RequestInfo | URL, init?: RequestInit) => {
        init?.signal?.addEventListener('abort', () => { aborted = true; });
        return await new Promise<Response>(() => {});
      },
    });

    await expect(handler.install()).rejects.toMatchObject({ code: 'fetch-timeout' });

    expect(aborted).toBe(true);
    expect(await storage.keys()).toEqual([]);
  });

  it('rejects a missing shell response before activation', async () => {
    const api = loadWorkerApi();
    const storage = new MemoryCacheStorage();
    const handler = api.createServiceWorkerHandlers({
      descriptor,
      cacheStorage: storage,
      origin: 'https://app.test',
      fetcher: async () => new Response('missing', {
        status: 404,
        headers: { 'content-type': 'text/html' },
      }),
    });

    await expect(handler.install()).rejects.toMatchObject({ code: 'http-response' });
    expect(await storage.keys()).toEqual([]);
  });

  it('rejects a shell response with the wrong MIME type', async () => {
    const api = loadWorkerApi();
    const storage = new MemoryCacheStorage();
    const handler = api.createServiceWorkerHandlers({
      descriptor,
      cacheStorage: storage,
      origin: 'https://app.test',
      fetcher: async () => new Response('hello', {
        headers: { 'content-type': 'application/octet-stream' },
      }),
    });

    await expect(handler.install()).rejects.toMatchObject({ code: 'mime-mismatch' });
    expect(await storage.keys()).toEqual([]);
  });

  it('does not mutate an already verified generation during reinstall', async () => {
    const api = loadWorkerApi();
    const storage = new MemoryCacheStorage();
    const cacheName = api.shellCacheName(appDescriptor.fingerprint);
    const active = await storage.open(cacheName);
    await active.put('https://app.test/index.html', new Response('shell', {
      headers: { 'content-type': 'text/html' },
    }));
    await active.put('https://app.test/assets/app.js', new Response('app', {
      headers: { 'content-type': 'text/javascript' },
    }));
    let fetchCalls = 0;
    const handler = api.createServiceWorkerHandlers({
      descriptor: appDescriptor,
      cacheStorage: storage,
      origin: 'https://app.test',
      fetcher: async () => {
        fetchCalls += 1;
        throw new Error('reinstall must not replace the active generation');
      },
    });

    await handler.install();

    expect(fetchCalls).toBe(0);
    expect(await (await active.match('https://app.test/index.html'))?.text()).toBe('shell');
    expect(await (await active.match('https://app.test/assets/app.js'))?.text()).toBe('app');
  });

  it('serves only exact shell entries and root navigations from the active generation', async () => {
    const api = loadWorkerApi();
    const storage = new MemoryCacheStorage();
    const cache = await storage.open(api.shellCacheName(appDescriptor.fingerprint));
    await cache.put('https://app.test/index.html', new Response('shell', {
      headers: { 'content-type': 'text/html' },
    }));
    await cache.put('https://app.test/assets/app.js', new Response('app', {
      headers: { 'content-type': 'text/javascript' },
    }));
    const handler = api.createServiceWorkerHandlers({
      descriptor: appDescriptor,
      cacheStorage: storage,
      origin: 'https://app.test',
      fetcher: async () => new Response('network', {
        headers: { 'content-type': 'text/plain' },
      }),
    });

    const staticResponse = await handler.handleFetch({
      method: 'GET',
      url: 'https://app.test/assets/app.js',
    });
    expect(await staticResponse?.text()).toBe('app');
    const navigationResponse = await handler.handleFetch({
      method: 'GET',
      mode: 'navigate',
      url: 'https://app.test/?view=library',
    });
    expect(await navigationResponse?.text()).toBe('shell');

    for (const request of [
      { method: 'GET', url: 'https://app.test/assets/app.js?cache=1' },
      { method: 'POST', url: 'https://app.test/assets/app.js' },
      { method: 'GET', url: 'https://app.test/health.json' },
      { method: 'GET', url: 'https://app.test/__/auth/handler' },
      { method: 'GET', url: 'https://app.test/media/listen-mvp/clip.m4a' },
      { method: 'GET', url: 'https://cdn.example.test/assets/app.js' },
    ]) {
      expect(handler.shouldHandleFetch(request)).toBe(false);
      expect(await handler.handleFetch(request)).toBeUndefined();
    }
  });

  it('rejects private documents from a worker descriptor', () => {
    const api = loadWorkerApi();

    expect(() => api.createServiceWorkerHandlers({
      descriptor: {
        ...appDescriptor,
        assets: [
          ...appDescriptor.assets,
          { url: '/browser-extension-privacy.html', sha256: 'c'.repeat(64), bytes: 1 },
        ],
      },
      cacheStorage: new MemoryCacheStorage(),
      origin: 'https://app.test',
      fetcher: async () => new Response('network'),
    })).toThrow(/allowlist|privacy/i);
  });

  it('keeps the active and one waiting shell generation while preserving media caches', async () => {
    const api = loadWorkerApi();
    const storage = new MemoryCacheStorage();
    await storage.open(api.shellCacheName(appDescriptor.fingerprint));
    await storage.open('sonflash-app-shell-v1-aaa');
    await storage.open('sonflash-app-shell-v1-ccc');
    await storage.open('sonflash-app-shell-v1-ddd');
    await storage.open('sonflash-offline-media-packs-v1:pack:one');
    await storage.open('learner-cache');
    const handler = api.createServiceWorkerHandlers({
      descriptor: appDescriptor,
      cacheStorage: storage,
      origin: 'https://app.test',
      fetcher: async () => new Response('network', {
        headers: { 'content-type': 'text/plain' },
      }),
    });

    await handler.activate();

    expect(await storage.keys()).toEqual([
      api.shellCacheName(appDescriptor.fingerprint),
      'sonflash-app-shell-v1-ddd',
      'sonflash-offline-media-packs-v1:pack:one',
      'learner-cache',
    ]);
  });

  it('can activate a retained previous fingerprint for rollback', async () => {
    const api = loadWorkerApi();
    const storage = new MemoryCacheStorage();
    const previous = api.shellCacheName(descriptor.fingerprint);
    const current = api.shellCacheName(appDescriptor.fingerprint);
    await storage.open(previous);
    await storage.open(current);
    await storage.open('sonflash-offline-media-packs-v1:pack:one');
    const handler = api.createServiceWorkerHandlers({
      descriptor,
      cacheStorage: storage,
      origin: 'https://app.test',
      fetcher: async () => new Response('network'),
    });

    await handler.activate();

    expect(await storage.keys()).toEqual([
      previous,
      current,
      'sonflash-offline-media-packs-v1:pack:one',
    ]);
  });

  it('registers install and activate handlers without forcing a waiting update', () => {
    const api = loadWorkerApi();
    const listeners = new Map<string, unknown>();
    const scope = {
      addEventListener: (name: string, listener: unknown) => listeners.set(name, listener),
    } as Record<string, unknown>;

    api.registerServiceWorker(scope, appDescriptor, {
      cacheStorage: new MemoryCacheStorage(),
      origin: 'https://app.test',
      fetcher: async () => new Response('network'),
    });

    expect([...listeners.keys()]).toEqual(['install', 'activate', 'fetch']);
    expect(scope.skipWaiting).toBeUndefined();
    expect(scope.clients).toBeUndefined();
  });
});
