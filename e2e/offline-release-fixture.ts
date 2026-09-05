import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import type { AddressInfo } from 'node:net';

export type OfflineRelease = 'A' | 'B';

export interface OfflineReleaseFixture {
  readonly origin: string;
  readonly assetRequestCount: () => number;
  readonly releaseFingerprint: (release: OfflineRelease) => string;
  readonly requestCount: (pathname: string) => number;
  readonly setRelease: (release: OfflineRelease) => void;
  readonly close: () => Promise<void>;
}

const DIST_DIRECTORY = path.resolve(process.cwd(), 'dist');
const SERVICE_WORKER_PATH = path.join(DIST_DIRECTORY, 'sw.js');
const SERVICE_WORKER_FINGERPRINT = /("fingerprint":")([a-f0-9]{64})(")/;
const RELEASE_B_FINGERPRINT = 'b'.repeat(64);
const NO_STORE = 'no-cache,no-store,must-revalidate';

const readServiceWorker = () => fs.readFileSync(SERVICE_WORKER_PATH, 'utf8');

const serviceWorkerFingerprint = (source: string) => {
  const match = source.match(SERVICE_WORKER_FINGERPRINT);
  if (!match?.[2]) throw new Error('dist/sw.js does not contain an embedded fingerprint.');
  return match[2];
};

const serviceWorkerForRelease = (source: string, release: OfflineRelease) => {
  if (release === 'A') return source;
  const replaced = source.replace(SERVICE_WORKER_FINGERPRINT, `$1${RELEASE_B_FINGERPRINT}$3`);
  if (replaced === source) throw new Error('dist/sw.js release B fingerprint replacement failed.');
  return replaced;
};

const contentTypeFor = (pathname: string) => {
  if (/\.html?$/i.test(pathname)) return 'text/html; charset=utf-8';
  if (/\.js$/i.test(pathname)) return 'application/javascript; charset=utf-8';
  if (/\.css$/i.test(pathname)) return 'text/css; charset=utf-8';
  if (/\.json$/i.test(pathname)) return 'application/json; charset=utf-8';
  if (/\.woff2?$/i.test(pathname)) return 'font/woff2';
  if (/\.ttf$/i.test(pathname)) return 'font/ttf';
  if (/\.otf$/i.test(pathname)) return 'font/otf';
  if (/\.png$/i.test(pathname)) return 'image/png';
  if (/\.webp$/i.test(pathname)) return 'image/webp';
  if (/\.svg$/i.test(pathname)) return 'image/svg+xml';
  if (/\.mp4$/i.test(pathname)) return 'video/mp4';
  if (/\.m4a$/i.test(pathname)) return 'audio/mp4';
  return 'application/octet-stream';
};

const cacheControlFor = (pathname: string) => {
  if (pathname === '/sw.js' || pathname === '/' || pathname === '/index.html'
    || pathname === '/health.json' || pathname.endsWith('/release-manifest.json')) {
    return NO_STORE;
  }
  if (pathname.startsWith('/assets/')) return 'public,max-age=31536000,immutable';
  return 'public,max-age=300';
};

const safeFilePath = (pathname: string) => {
  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (decodedPath.includes('\0') || decodedPath.includes('\\')) return null;
  const absolute = path.resolve(DIST_DIRECTORY, `.${decodedPath}`);
  const relative = path.relative(DIST_DIRECTORY, absolute);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return null;
  return absolute;
};

const writeResponse = (
  response: http.ServerResponse,
  status: number,
  body: string | Buffer,
  headers: Record<string, string>,
) => {
  response.writeHead(status, {
    'Content-Length': Buffer.byteLength(body),
    ...headers,
  });
  response.end(body);
};

export const startOfflineReleaseFixture = async (): Promise<OfflineReleaseFixture> => {
  const source = readServiceWorker();
  const fingerprints = {
    A: serviceWorkerFingerprint(source),
    B: RELEASE_B_FINGERPRINT,
  } as const;
  const requests = new Map<string, number>();
  let release: OfflineRelease = 'A';

  const server = http.createServer((request, response) => {
    const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1');
    const pathname = requestUrl.pathname;
    requests.set(pathname, (requests.get(pathname) ?? 0) + 1);

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      writeResponse(response, 405, 'Method Not Allowed', {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': NO_STORE,
      });
      return;
    }

    if (pathname === '/sw.js') {
      writeResponse(response, 200, serviceWorkerForRelease(source, release), {
        'Content-Type': 'application/javascript; charset=utf-8',
        'Cache-Control': NO_STORE,
      });
      return;
    }

    if (pathname === '/api/device-cards' || pathname.startsWith('/api/')) {
      writeResponse(response, 503, JSON.stringify({ error: 'offline-fixture-api-unavailable' }), {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': NO_STORE,
      });
      return;
    }

    const requestedPath = pathname === '/' ? '/index.html' : pathname;
    const filePath = safeFilePath(requestedPath);
    if (filePath && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const body = fs.readFileSync(filePath);
      writeResponse(response, 200, body, {
        'Content-Type': contentTypeFor(requestedPath),
        'Cache-Control': cacheControlFor(pathname),
      });
      return;
    }

    if ((request.headers.accept ?? '').includes('text/html')) {
      const body = fs.readFileSync(path.join(DIST_DIRECTORY, 'index.html'));
      writeResponse(response, 200, body, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': NO_STORE,
      });
      return;
    }

    writeResponse(response, 404, 'Not Found', {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': NO_STORE,
    });
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(0, '127.0.0.1');
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    await new Promise<void>(resolve => server.close(() => resolve()));
    throw new Error('Offline release fixture did not expose a TCP address.');
  }
  const { port } = address as AddressInfo;

  return {
    origin: `http://127.0.0.1:${port}`,
    assetRequestCount: () => [...requests.entries()]
      .filter(([pathname]) => pathname.startsWith('/assets/'))
      .reduce((total, [, count]) => total + count, 0),
    releaseFingerprint: currentRelease => fingerprints[currentRelease],
    requestCount: pathname => requests.get(pathname) ?? 0,
    setRelease: nextRelease => { release = nextRelease; },
    close: () => new Promise<void>((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
    }),
  };
};
