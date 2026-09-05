import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import {
  assertOfflineShellDescriptor,
  createOfflineShellDescriptor,
  renderOfflineServiceWorker,
} from '../scripts/offline-shell.mjs';

export type OfflineRelease = 'A' | 'B';

export interface OfflineReleaseFixture {
  readonly origin: string;
  readonly assetRequestCount: () => number;
  readonly mainEntryPath: string;
  readonly releaseFingerprint: (release: OfflineRelease) => string;
  readonly requestCount: (pathname: string) => number;
  readonly setRelease: (release: OfflineRelease) => void;
  readonly close: () => Promise<void>;
}

const DIST_DIRECTORY = path.resolve(process.cwd(), 'dist');
const SERVICE_WORKER_TEMPLATE_PATH = path.resolve(
  process.cwd(),
  'src/features/offlineApp/service-worker.js',
);
const MAIN_ENTRY_PATTERN = /<script[^>]+src="(\/assets\/[^\"]+\.js)"/;
const NO_STORE = 'no-cache,no-store,must-revalidate';
const PROTECTED_PATH_PATTERN = /^(?:\/(?:api|auth|catalog|media|audio-pack|private)(?:\/|$)|\/__\/auth(?:\/|$)|\/__sonflash_offline_media_pack__(?:\/|$))/i;

const sha256Hex = (value: string | Buffer) => crypto.createHash('sha256').update(value).digest('hex');

interface ReleaseVariant {
  readonly descriptor: ReturnType<typeof createOfflineShellDescriptor>;
  readonly bodies: ReadonlyMap<string, Buffer>;
}

const releaseVariant = (
  descriptor: ReturnType<typeof createOfflineShellDescriptor>,
  mainEntryPath: string,
  indexBody: Buffer,
  mainEntryBody: Buffer,
  release: OfflineRelease,
): ReleaseVariant => {
  const bodies = new Map<string, Buffer>([
    ['/index.html', Buffer.concat([indexBody, Buffer.from(`\n<!-- SonFlash release ${release} -->\n`)]),],
    [mainEntryPath, Buffer.concat([
      mainEntryBody,
      Buffer.from(`\nglobalThis.__SONFLASH_RELEASE_MARKER__ = ${JSON.stringify(release)};\n`),
    ])],
  ]);
  const assets = descriptor.assets.map(asset => {
    const body = bodies.get(asset.url);
    return body
      ? { ...asset, sha256: sha256Hex(body), bytes: body.byteLength }
      : asset;
  });
  const variantDescriptor = {
    revision: `${descriptor.revision}-${release}`,
    fingerprint: sha256Hex(JSON.stringify(assets)),
    assets,
  };
  assertOfflineShellDescriptor(variantDescriptor);
  return { descriptor: variantDescriptor, bodies };
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
  const indexBody = fs.readFileSync(path.join(DIST_DIRECTORY, 'index.html'));
  const indexHtml = indexBody.toString('utf8');
  const mainEntryPath = indexHtml.match(MAIN_ENTRY_PATTERN)?.[1];
  if (!mainEntryPath) throw new Error('dist/index.html does not contain a main JavaScript entry.');
  const mainEntryBody = fs.readFileSync(path.join(DIST_DIRECTORY, mainEntryPath.slice(1)));
  const baseDescriptor = createOfflineShellDescriptor({ distDirectory: DIST_DIRECTORY });
  if (!baseDescriptor.assets.some(asset => asset.url === mainEntryPath)) {
    throw new Error(`offline shell descriptor does not include ${mainEntryPath}.`);
  }
  const variants = {
    A: releaseVariant(baseDescriptor, mainEntryPath, indexBody, mainEntryBody, 'A'),
    B: releaseVariant(baseDescriptor, mainEntryPath, indexBody, mainEntryBody, 'B'),
  } as const;
  const workerTemplate = fs.readFileSync(SERVICE_WORKER_TEMPLATE_PATH, 'utf8');
  const requests = new Map<string, number>();
  let release: OfflineRelease = 'A';
  let closed = false;

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
      writeResponse(response, 200, renderOfflineServiceWorker(workerTemplate, variants[release].descriptor), {
        'Content-Type': 'application/javascript; charset=utf-8',
        'Cache-Control': NO_STORE,
      });
      return;
    }

    if (PROTECTED_PATH_PATTERN.test(pathname)) {
      writeResponse(response, 503, JSON.stringify({ error: 'offline-fixture-protected-path' }), {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': NO_STORE,
      });
      return;
    }

    const requestedPath = pathname === '/' ? '/index.html' : pathname;
    const filePath = safeFilePath(requestedPath);
    if (filePath && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const body = variants[release].bodies.get(requestedPath) ?? fs.readFileSync(filePath);
      writeResponse(response, 200, body, {
        'Content-Type': contentTypeFor(requestedPath),
        'Cache-Control': cacheControlFor(pathname),
      });
      return;
    }

    if ((request.headers.accept ?? '').includes('text/html')) {
      const body = variants[release].bodies.get('/index.html') ?? indexBody;
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
    mainEntryPath,
    releaseFingerprint: currentRelease => variants[currentRelease].descriptor.fingerprint,
    requestCount: pathname => requests.get(pathname) ?? 0,
    setRelease: nextRelease => { release = nextRelease; },
    close: () => {
      if (closed) return Promise.resolve();
      closed = true;
      return new Promise<void>((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve());
      });
    },
  };
};
