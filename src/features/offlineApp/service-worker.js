const EMBEDDED_DESCRIPTOR = /* SONFLASH_OFFLINE_SHELL_DESCRIPTOR */ null;

const SHELL_CACHE_PREFIX = 'sonflash-app-shell-v1-';
const MAX_SHELL_BYTES = 4 * 1024 * 1024;
const MAX_SHELL_GENERATIONS = 2;
const FETCH_TIMEOUT_MS = 10_000;
const SHELL_ASSET_PATTERN = /\.(?:css|eot|html?|js|otf|ttf|woff2?)$/i;
const PRIVACY_ASSET_PATTERN = /(?:^|\/)(?:browser-extension-)?privacy(?:[-/.]|$)/i;
const PROTECTED_SHELL_PATH_PATTERN = /^(?:\/(?:api|auth|catalog|private|media|audio-pack|__sonflash_offline_media_pack__)(?:[/.]|$)|\/__\/|\/(?:health|manifest)(?:[/.]|$))/i;

const fail = (code, message) => {
  const error = new Error(`Offline shell ${code}: ${message}`);
  error.code = code;
  return error;
};

const canonicalUrl = value => {
  if (typeof value !== 'string' || !value.startsWith('/')
    || value.includes('?') || value.includes('#') || value.includes('\\')
    || value.includes('%')) {
    throw fail('invalid-url', String(value));
  }
  const segments = value.slice(1).split('/');
  if (segments.length === 0 || segments.some(segment => segment.length === 0 || segment === '.' || segment === '..')) {
    throw fail('invalid-url', value);
  }
  return value;
};

const assertDescriptor = descriptor => {
  if (typeof descriptor !== 'object' || descriptor === null || Array.isArray(descriptor)) {
    throw fail('invalid-descriptor', 'expected object');
  }
  if (typeof descriptor.revision !== 'string' || descriptor.revision.length === 0) {
    throw fail('invalid-descriptor', 'revision is required');
  }
  if (!/^[a-f0-9]{64}$/.test(descriptor.fingerprint)) {
    throw fail('invalid-descriptor', 'fingerprint must be SHA-256');
  }
  if (!Array.isArray(descriptor.assets) || descriptor.assets.length === 0) {
    throw fail('invalid-descriptor', 'assets are required');
  }
  const urls = new Set();
  let totalBytes = 0;
  for (const asset of descriptor.assets) {
    if (typeof asset !== 'object' || asset === null || Array.isArray(asset)) {
      throw fail('invalid-descriptor', 'asset must be an object');
    }
    const url = canonicalUrl(asset.url);
    if (!SHELL_ASSET_PATTERN.test(url) || url === '/sw.js'
      || PRIVACY_ASSET_PATTERN.test(url) || PROTECTED_SHELL_PATH_PATTERN.test(url)) {
      throw fail('invalid-descriptor', `asset is outside the shell allowlist: ${url}`);
    }
    if (urls.has(url)) throw fail('invalid-descriptor', `duplicate asset: ${url}`);
    urls.add(url);
    if (!/^[a-f0-9]{64}$/.test(asset.sha256)) {
      throw fail('invalid-descriptor', `invalid digest: ${url}`);
    }
    if (!Number.isSafeInteger(asset.bytes) || asset.bytes < 0) {
      throw fail('invalid-descriptor', `invalid byte count: ${url}`);
    }
    totalBytes += asset.bytes;
  }
  if (!urls.has('/index.html')) throw fail('invalid-descriptor', 'index.html is required');
  if (totalBytes > MAX_SHELL_BYTES) throw fail('invalid-descriptor', 'shell exceeds 4 MiB');
  return descriptor;
};

const digestHex = async bytes => {
  if (!globalThis.crypto?.subtle) throw fail('crypto-unavailable', 'Web Crypto is unavailable');
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
};

const mimeTypes = url => {
  if (/\.html?$/i.test(url)) return ['text/html'];
  if (/\.js$/i.test(url)) return ['application/javascript', 'text/javascript', 'application/ecmascript'];
  if (/\.css$/i.test(url)) return ['text/css'];
  if (/\.woff2?$/i.test(url)) return ['font/woff', 'font/woff2', 'application/font-woff', 'application/font-woff2', 'application/octet-stream'];
  if (/\.ttf$/i.test(url)) return ['font/ttf', 'application/x-font-ttf', 'application/octet-stream'];
  if (/\.otf$/i.test(url)) return ['font/otf', 'application/x-font-opentype', 'application/octet-stream'];
  if (/\.eot$/i.test(url)) return ['application/vnd.ms-fontobject', 'application/octet-stream'];
  return [];
};

const withTimeout = (operation, timeoutMs, onTimeout) => {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = globalThis.setTimeout(() => {
      onTimeout?.();
      reject(fail('fetch-timeout', `${timeoutMs} ms`));
    }, timeoutMs);
  });
  return Promise.race([Promise.resolve().then(operation), timeout]).finally(() => {
    globalThis.clearTimeout(timer);
  });
};

const assertResponseUrl = (response, requestUrl, origin) => {
  if (!response.url) return;
  const url = new URL(response.url);
  const request = new URL(requestUrl);
  if (url.origin !== origin || url.pathname !== request.pathname || url.search || url.hash) {
    throw fail('redirected', requestUrl);
  }
};

const verifyFetchedAsset = async (asset, response, requestUrl, origin, timeoutMs) => {
  if (!response || response.ok !== true || response.status !== 200 || response.type === 'opaque') {
    throw fail('http-response', asset.url);
  }
  assertResponseUrl(response, requestUrl, origin);
  const contentType = response.headers?.get?.('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
  if (!contentType || !mimeTypes(asset.url).includes(contentType)) {
    throw fail('mime-mismatch', `${asset.url}: ${contentType ?? 'missing'}`);
  }
  const storedResponse = response.clone();
  const bytes = await withTimeout(() => response.arrayBuffer(), timeoutMs);
  if (bytes.byteLength !== asset.bytes) throw fail('byte-mismatch', asset.url);
  if (await digestHex(bytes) !== asset.sha256) throw fail('hash-mismatch', asset.url);
  return storedResponse;
};

const requestFor = (url, origin) => new Request(new URL(url, origin).href, {
  method: 'GET',
  credentials: 'same-origin',
  cache: 'no-store',
  redirect: 'error',
});

const protectedPath = pathname => (
  pathname === '/health.json'
  || pathname === '/manifest.webmanifest'
  || pathname === '/browser-extension-privacy.html'
  || pathname.startsWith('/privacy')
  || PROTECTED_SHELL_PATH_PATTERN.test(pathname)
);

const requestUrl = (request, origin) => {
  try {
    return new URL(request.url, origin);
  } catch {
    return null;
  }
};

const createServiceWorkerHandlers = options => {
  const descriptor = assertDescriptor(options?.descriptor ?? EMBEDDED_DESCRIPTOR);
  const cacheStorage = options?.cacheStorage ?? globalThis.caches;
  const fetcher = options?.fetcher ?? globalThis.fetch.bind(globalThis);
  const origin = options?.origin ?? globalThis.location?.origin;
  const timeoutMs = Number.isSafeInteger(options?.fetchTimeoutMs) && options.fetchTimeoutMs > 0
    ? options.fetchTimeoutMs
    : FETCH_TIMEOUT_MS;
  if (!cacheStorage?.open || !cacheStorage?.keys || !cacheStorage?.delete) {
    throw fail('cache-unavailable', 'Cache Storage is unavailable');
  }
  if (typeof origin !== 'string' || origin.length === 0) throw fail('origin-unavailable', 'origin is required');
  if (typeof fetcher !== 'function') throw fail('fetch-unavailable', 'fetch is required');
  const allowedUrls = new Set(descriptor.assets.map(asset => asset.url));
  const currentCacheName = `${SHELL_CACHE_PREFIX}${descriptor.fingerprint}`;

  const install = async () => {
    const existingNames = await cacheStorage.keys();
    const existedBefore = existingNames.includes(currentCacheName);
    let candidate;
    try {
      candidate = await cacheStorage.open(currentCacheName);
      if (existedBefore) {
        for (const asset of descriptor.assets) {
          const request = requestFor(asset.url, origin);
          const cached = await candidate.match(request, { ignoreSearch: false });
          await verifyFetchedAsset(asset, cached, request.url, origin, timeoutMs);
        }
        return;
      }
      for (const asset of descriptor.assets) {
        const request = requestFor(asset.url, origin);
        const controller = typeof AbortController === 'function' ? new AbortController() : undefined;
        const response = await withTimeout(
          () => fetcher(request, { signal: controller?.signal, redirect: 'error' }),
          timeoutMs,
          () => controller?.abort(),
        );
        const verified = await verifyFetchedAsset(asset, response, request.url, origin, timeoutMs);
        await candidate.put(request, verified);
      }
    } catch (error) {
      if (!existedBefore) {
        try {
          await cacheStorage.delete(currentCacheName);
        } catch {
          // Preserve the original install failure; an orphan candidate is cleaned on activate.
        }
      }
      throw error;
    }
  };

  const activate = async () => {
    const shellNames = (await cacheStorage.keys())
      .filter(name => name.startsWith(SHELL_CACHE_PREFIX));
    const keep = new Set([currentCacheName]);
    shellNames
      .filter(name => name !== currentCacheName)
      .sort()
      .slice(-(MAX_SHELL_GENERATIONS - 1))
      .forEach(name => keep.add(name));
    await Promise.all(shellNames
      .filter(name => !keep.has(name))
      .map(name => cacheStorage.delete(name)));
  };

  const shouldHandleFetch = request => {
    if (request?.method !== 'GET') return false;
    const url = requestUrl(request, origin);
    if (!url || url.origin !== origin || protectedPath(url.pathname)) return false;
    if (request.mode === 'navigate') return url.pathname === '/';
    return !url.search && !url.hash && allowedUrls.has(url.pathname);
  };

  const handleFetch = async request => {
    if (!shouldHandleFetch(request)) return undefined;
    const url = requestUrl(request, origin);
    if (!url) return undefined;
    const cache = await cacheStorage.open(currentCacheName);
    const targetUrl = request.mode === 'navigate' ? '/index.html' : url.pathname;
    const cached = await cache.match(requestFor(targetUrl, origin), { ignoreSearch: false });
    if (cached) return cached;
    throw fail('cache-miss', targetUrl);
  };

  return {
    activate,
    fetch: handleFetch,
    handleFetch,
    install,
    shellCacheName: () => currentCacheName,
    shouldHandleFetch,
  };
};

const registerServiceWorker = (scope, descriptor, options = {}) => {
  const handlers = createServiceWorkerHandlers({ ...options, descriptor });
  scope.addEventListener('install', event => event.waitUntil(handlers.install()));
  scope.addEventListener('activate', event => event.waitUntil(handlers.activate()));
  scope.addEventListener('fetch', event => {
    if (handlers.shouldHandleFetch(event.request)) event.respondWith(handlers.handleFetch(event.request));
  });
  return handlers;
};

globalThis.__SONFLASH_SERVICE_WORKER__ = Object.freeze({
  createServiceWorkerHandlers,
  registerServiceWorker,
  shellCacheName: fingerprint => `${SHELL_CACHE_PREFIX}${fingerprint}`,
});

if (typeof self !== 'undefined' && self.addEventListener && EMBEDDED_DESCRIPTOR) {
  registerServiceWorker(self, EMBEDDED_DESCRIPTOR);
}
