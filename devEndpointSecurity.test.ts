import { readFileSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEVICE_CAPABILITY_COOKIE_NAME,
  DEVICE_COLLECTION_MAX_SIZE,
  DEVICE_EVENT_CLIENT_MAX,
  DEVICE_EVENT_CLIENT_MAX_LIFETIME_MS,
  DEVICE_REQUEST_MAX_BODY_BYTES,
  DEVICE_RECORD_MAX_SERIALIZED_BYTES,
  clampDeviceCount,
  isDeviceCapabilityCookieValid,
  isTrustedLocalHtmlBootstrapRequest,
  grantPendingFlushLease,
  getPendingOperationCardId,
  isTrustedLocalDeviceRequest,
  mergeLocalPendingOperations,
  serializeLocalDeviceBackup,
  sharedDeviceStorePlugin,
} from './dev/sharedDeviceStoreAdapter';

const require = createRequire(import.meta.url);
type ConnectApp = {
  use: (...args: unknown[]) => ConnectApp;
  handle: (request: http.IncomingMessage, response: http.ServerResponse) => void;
};
const connect = require('connect') as () => ConnectApp;

type MiddlewareRequest = {
  headers: Record<string, string>;
  method: string;
  url: string;
  socket: { remoteAddress: string };
};

type MiddlewareResponse = {
  statusCode: number;
  headers: Record<string, string | string[]>;
  setHeader: (name: string, value: string | string[]) => void;
  end: (body?: string) => void;
};

type Middleware = (
  request: MiddlewareRequest,
  response: MiddlewareResponse,
  next: () => void,
) => void;

const createMiddlewareResponse = (): MiddlewareResponse => {
  const response: MiddlewareResponse = {
    statusCode: 0,
    headers: {},
    setHeader(name, value) { response.headers[name.toLowerCase()] = value; },
    end() {},
  };
  return response;
};

const createMiddlewareRequest = (
  headers: Record<string, string>,
  url = '/',
  method = 'GET',
): MiddlewareRequest => ({
  headers,
  method,
  url,
  socket: { remoteAddress: '127.0.0.1' },
});

const configureBoundaryMiddlewares = (): { bootstrap: Middleware; guard: Middleware } => {
  let bootstrap: Middleware | undefined;
  let guard: Middleware | undefined;
  const plugin = sharedDeviceStorePlugin();
  if (typeof plugin.configureServer !== 'function') throw new Error('Shared Device Store server hook is unavailable.');
  plugin.configureServer({
    middlewares: {
      use(...args: unknown[]) {
        if (args.length === 1 && typeof args[0] === 'function') bootstrap = args[0] as Middleware;
        if (!guard && args[0] === '/api/device-cards' && typeof args[1] === 'function') guard = args[1] as Middleware;
      },
    },
  } as never);
  if (!bootstrap || !guard) throw new Error('Device boundary middleware is unavailable.');
  return { bootstrap, guard };
};

const requestViaConnect = async (app: ConnectApp, url: string): Promise<number> => {
  const server = http.createServer((request, response) => app.handle(request, response));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Test server did not expose a port.');
  try {
    return await new Promise<number>((resolve, reject) => {
      const request = http.request({
        hostname: '127.0.0.1',
        port: address.port,
        path: url,
        method: 'GET',
        headers: { 'sec-fetch-site': 'same-origin' },
      }, response => {
        response.resume();
        response.once('end', () => resolve(response.statusCode ?? 0));
      });
      request.once('error', reject);
      request.end();
    });
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
};

type RouteHandler = (request: Record<string, unknown>, response: Record<string, unknown>) => Promise<void> | void;

const configureRouteHandlers = (): Map<string, RouteHandler> => {
  const routes = new Map<string, RouteHandler>();
  const plugin = sharedDeviceStorePlugin();
  if (typeof plugin.configureServer !== 'function') throw new Error('Shared Device Store server hook is unavailable.');
  plugin.configureServer({
    middlewares: {
      use(route: unknown, handler: unknown) {
        if (typeof route === 'string' && typeof handler === 'function') {
          routes.set(route, handler as RouteHandler);
        }
      },
    },
  } as never);
  return routes;
};

const invokeJsonRoute = async (
  route: string,
  method: string,
  body: string,
  extraHeaders: Record<string, string> = {},
  homeDirectory?: string,
) => {
  const homedirSpy = homeDirectory ? vi.spyOn(os, 'homedir').mockReturnValue(homeDirectory) : null;
  try {
    const routes = configureRouteHandlers();
    const request = Readable.from([body]) as unknown as Record<string, unknown>;
    request.method = method;
    request.headers = {
      host: '127.0.0.1:3000',
      origin: 'http://127.0.0.1:3000',
      'sec-fetch-site': 'same-origin',
      'content-type': 'application/json',
      ...extraHeaders,
    };
    request.socket = { remoteAddress: '127.0.0.1' };
    let responseBody = '';
    const response: Record<string, unknown> = {
      statusCode: 0,
      setHeader: () => undefined,
      end: (value?: string) => { responseBody = value ?? ''; },
    };
    await routes.get(route)!(request, response);
    return { statusCode: response.statusCode as number, body: JSON.parse(responseBody) as Record<string, unknown> };
  } finally {
    homedirSpy?.mockRestore();
  }
};

const backupPath = (homeDirectory: string) => path.join(
  homeDirectory,
  '.lingoflash-device-sync',
  'lingoflash-2-cards.json',
);

const makeCard = (id: string, extra: Record<string, unknown> = {}) => ({ id, word: id, ...extra });
const makePending = (cardId: string) => ({ type: 'delete', cardId, updatedAt: '2026-08-25T00:00:00.000Z' });

const createEventRouteRequest = () => {
  const request = new EventEmitter() as EventEmitter & Record<string, unknown>;
  request.method = 'GET';
  request.headers = {
    host: '127.0.0.1:3000',
    'sec-fetch-site': 'same-origin',
  };
  request.socket = { remoteAddress: '127.0.0.1' };
  return request;
};

const createEventRouteResponse = () => {
  const response = new EventEmitter() as EventEmitter & Record<string, unknown>;
  response.statusCode = 0;
  response.headers = {};
  response.setHeader = (name: string, value: string) => { (response.headers as Record<string, string>)[name] = value; };
  response.flushHeaders = () => undefined;
  response.write = () => true;
  response.ended = false;
  response.end = () => { response.ended = true; };
  return response;
};

afterEach(() => {
  vi.useRealTimers();
});

describe('local pending flush lease', () => {
  it('only lets an explicit retry reclaim an unexpired lease', () => {
    const leases = new Map([['owner', 10_000]]);

    expect(grantPendingFlushLease(leases, 'owner', 1_000, false)).toBe(false);
    expect(grantPendingFlushLease(leases, 'owner', 1_000, true)).toBe(true);
    expect(leases.get('owner')).toBe(121_000);
  });

  it('sweeps expired leases and refuses new entries at the cap even with force', () => {
    const leases = new Map(Array.from({ length: 64 }, (_, index) => [`owner-${index}`, 10_000]));
    expect(grantPendingFlushLease(leases, 'new-owner', 1_000, true)).toBe(false);
    expect(grantPendingFlushLease(leases, 'owner-0', 20_000, false)).toBe(true);
    expect(leases.size).toBe(1);
    expect(leases.has('owner-1')).toBe(false);
    expect(leases.has('owner-0')).toBe(true);
  });
});

describe('local device endpoint request boundary', () => {
  const request = (headers: Record<string, string>, method = 'POST') => ({ headers, method });

  it('accepts same-origin JSON mutations', () => {
    expect(isTrustedLocalDeviceRequest(request({
      host: '127.0.0.1:3000',
      origin: 'http://127.0.0.1:3000',
      'sec-fetch-site': 'same-origin',
      'content-type': 'application/json; charset=utf-8',
    }))).toBe(true);
  });

  it('rejects cross-site, mismatched-origin and non-JSON mutations', () => {
    expect(isTrustedLocalDeviceRequest(request({
      host: '127.0.0.1:3000',
      origin: 'https://attacker.example',
      'sec-fetch-site': 'cross-site',
      'content-type': 'application/json',
    }))).toBe(false);
    expect(isTrustedLocalDeviceRequest(request({
      host: '127.0.0.1:3000',
      origin: 'http://127.0.0.1:3000',
      'sec-fetch-site': 'same-origin',
      'content-type': 'text/plain',
    }))).toBe(false);
    expect(isTrustedLocalDeviceRequest(request({
      host: 'attacker.example:3000',
      origin: 'http://attacker.example:3000',
      'sec-fetch-site': 'same-origin',
      'content-type': 'application/json',
    }))).toBe(false);
  });

  it('requires browser provenance even for read and event-stream requests', () => {
    expect(isTrustedLocalDeviceRequest(request({
      host: '127.0.0.1:3000',
      'sec-fetch-site': 'same-origin',
    }, 'GET'))).toBe(true);
    expect(isTrustedLocalDeviceRequest(request({ host: '127.0.0.1:3000' }, 'GET'))).toBe(false);
  });
});

describe('local device capability bootstrap', () => {
  const bootstrapHeaders = {
    host: '127.0.0.1:3000',
    accept: 'text/html,application/xhtml+xml',
    'sec-fetch-mode': 'navigate',
    'sec-fetch-dest': 'document',
    'sec-fetch-site': 'same-origin',
  };

  it('accepts only trusted top-level HTML bootstrap requests', () => {
    expect(isTrustedLocalHtmlBootstrapRequest(createMiddlewareRequest(bootstrapHeaders))).toBe(true);
    expect(isTrustedLocalHtmlBootstrapRequest(createMiddlewareRequest({
      ...bootstrapHeaders,
      'sec-fetch-site': 'none',
    }))).toBe(true);
    expect(isTrustedLocalHtmlBootstrapRequest(createMiddlewareRequest({
      ...bootstrapHeaders,
      'sec-fetch-site': 'cross-site',
    }))).toBe(false);
    expect(isTrustedLocalHtmlBootstrapRequest(createMiddlewareRequest({
      ...bootstrapHeaders,
      'sec-fetch-dest': 'empty',
    }))).toBe(false);
    expect(isTrustedLocalHtmlBootstrapRequest(createMiddlewareRequest({
      ...bootstrapHeaders,
      accept: 'application/json',
    }))).toBe(false);
    expect(isTrustedLocalHtmlBootstrapRequest(createMiddlewareRequest({
      ...bootstrapHeaders,
      host: 'user@127.0.0.1:3000',
    }))).toBe(false);
  });

  it('issues an HttpOnly host-only strict session cookie and reuses it for API auth', () => {
    const { bootstrap, guard } = configureBoundaryMiddlewares();
    const bootstrapResponse = createMiddlewareResponse();
    let bootstrapNextCalls = 0;
    bootstrap(createMiddlewareRequest(bootstrapHeaders), bootstrapResponse, () => { bootstrapNextCalls += 1; });

    expect(bootstrapNextCalls).toBe(1);
    const setCookie = String(bootstrapResponse.headers['set-cookie']);
    expect(setCookie).toMatch(new RegExp(`^${DEVICE_CAPABILITY_COOKIE_NAME}=[A-Za-z0-9_-]{43};`));
    expect(setCookie).toContain('Path=/api/device-cards');
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Strict');
    expect(setCookie).not.toMatch(/Domain=/i);
    expect(setCookie).not.toMatch(/Max-Age=|Expires=/i);

    const cookie = setCookie.split(';', 1)[0];
    const apiHeaders = {
      host: '127.0.0.1:3000',
      origin: 'http://127.0.0.1:3000',
      'sec-fetch-site': 'same-origin',
      'content-type': 'application/json',
      cookie,
    };
    const missingTokenResponse = createMiddlewareResponse();
    let missingTokenNextCalls = 0;
    guard(
      createMiddlewareRequest({ ...apiHeaders, cookie: '' }, '/api/device-cards'),
      missingTokenResponse,
      () => { missingTokenNextCalls += 1; },
    );
    expect(missingTokenResponse.statusCode).toBe(401);
    expect(missingTokenNextCalls).toBe(0);

    const wrongTokenResponse = createMiddlewareResponse();
    let wrongTokenNextCalls = 0;
    guard(
      createMiddlewareRequest({ ...apiHeaders, cookie: `${DEVICE_CAPABILITY_COOKIE_NAME}=${'A'.repeat(43)}` }, '/api/device-cards'),
      wrongTokenResponse,
      () => { wrongTokenNextCalls += 1; },
    );
    expect(wrongTokenResponse.statusCode).toBe(401);
    expect(wrongTokenNextCalls).toBe(0);

    const validTokenResponse = createMiddlewareResponse();
    let validTokenNextCalls = 0;
    guard(
      createMiddlewareRequest(apiHeaders, '/api/device-cards/ack', 'PUT'),
      validTokenResponse,
      () => { validTokenNextCalls += 1; },
    );
    expect(validTokenNextCalls).toBe(1);
    expect(isDeviceCapabilityCookieValid(cookie, setCookie.split('=', 2)[1].split(';', 1)[0])).toBe(true);
  });

  it('returns provenance failure before checking or reading an API body', () => {
    const { guard } = configureBoundaryMiddlewares();
    const response = createMiddlewareResponse();
    let nextCalls = 0;
    guard(
      createMiddlewareRequest({
        ...bootstrapHeaders,
        'sec-fetch-site': 'cross-site',
        'content-type': 'application/json',
      }, '/api/device-cards', 'PUT'),
      response,
      () => { nextCalls += 1; },
    );
    expect(response.statusCode).toBe(403);
    expect(nextCalls).toBe(0);
  });

  it('guards case-insensitive and dot-boundary API mounts using Connect matching', async () => {
    const plugin = sharedDeviceStorePlugin();
    if (typeof plugin.configureServer !== 'function') throw new Error('Shared Device Store server hook is unavailable.');
    const app = connect();
    plugin.configureServer({ middlewares: app } as never);

    await expect(requestViaConnect(app, '/API/DEVICE-CARDS')).resolves.toBe(401);
    await expect(requestViaConnect(app, '/api/device-cards.anything')).resolves.toBe(401);
  });
});

describe('local device route resource boundaries', () => {
  it('clamps numeric device counts to the domain maximum', () => {
    expect(clampDeviceCount(9_999)).toBe(DEVICE_COLLECTION_MAX_SIZE);
    expect(clampDeviceCount(-1)).toBe(0);
    expect(clampDeviceCount('invalid', 7)).toBe(7);
  });

  it('rejects malformed JSON and oversized bodies with client errors', async () => {
    await expect(invokeJsonRoute('/api/device-cards/ack', 'PUT', '{')).resolves.toMatchObject({ statusCode: 400 });
    await expect(invokeJsonRoute(
      '/api/device-cards/ack',
      'PUT',
      '{}',
      { 'content-length': String(DEVICE_REQUEST_MAX_BODY_BYTES + 1) },
    )).resolves.toMatchObject({ statusCode: 413 });
    await expect(invokeJsonRoute(
      '/api/device-cards/ack',
      'PUT',
      'x'.repeat(DEVICE_REQUEST_MAX_BODY_BYTES + 1),
      {},
    )).resolves.toMatchObject({ statusCode: 413 });
  });

  it('rejects oversized pending and acknowledgement arrays before writing', async () => {
    const pending = Array.from({ length: DEVICE_COLLECTION_MAX_SIZE + 1 }, (_, index) => ({
      type: 'delete',
      cardId: `card-${index}`,
      updatedAt: '2026-08-25T00:00:00.000Z',
    }));
    await expect(invokeJsonRoute(
      '/api/device-cards',
      'PUT',
      JSON.stringify({ cards: [], pending, mode: 'merge' }),
    )).resolves.toMatchObject({ statusCode: 400 });
    const acknowledgements = Array.from({ length: DEVICE_COLLECTION_MAX_SIZE + 1 }, (_, index) => ({
      type: 'delete',
      cardId: `card-${index}`,
      updatedAt: '2026-08-25T00:00:00.000Z',
    }));
    await expect(invokeJsonRoute(
      '/api/device-cards/ack',
      'PUT',
      JSON.stringify({ userId: 'user-a', operations: acknowledgements }),
    )).resolves.toMatchObject({ statusCode: 400 });
  });

  it('rejects raw oversized cards and oversized card records atomically', async () => {
    const homeDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'lingoflash-device-raw-card-limit-'));
    const filePath = backupPath(homeDirectory);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const originalBackup = { ownerUserId: 'user-a', cards: [makeCard('original')], pending: [], total: 1 };
    fs.writeFileSync(filePath, JSON.stringify(originalBackup));
    const originalBytes = fs.readFileSync(filePath);
    try {
      const oversizedCards = Array.from({ length: DEVICE_COLLECTION_MAX_SIZE + 1 }, (_, index) => makeCard(`card-${index}`));
      await expect(invokeJsonRoute(
        '/api/device-cards',
        'PUT',
        JSON.stringify({ ownerUserId: 'user-a', cards: oversizedCards, mode: 'replace' }),
        {},
        homeDirectory,
      )).resolves.toMatchObject({ statusCode: 400 });
      expect(fs.readFileSync(filePath).equals(originalBytes)).toBe(true);

      await expect(invokeJsonRoute(
        '/api/device-cards',
        'PUT',
        JSON.stringify({ ownerUserId: 'user-a', cards: [makeCard('large', { blob: 'x'.repeat(DEVICE_RECORD_MAX_SERIALIZED_BYTES) })] }),
        {},
        homeDirectory,
      )).resolves.toMatchObject({ statusCode: 413 });
      expect(fs.readFileSync(filePath).equals(originalBytes)).toBe(true);

      await expect(invokeJsonRoute(
        '/api/device-cards',
        'PUT',
        JSON.stringify({ ownerUserId: 'user-a', cards: [], pending: [{ ...makePending('large-pending'), blob: 'x'.repeat(DEVICE_RECORD_MAX_SERIALIZED_BYTES) }] }),
        {},
        homeDirectory,
      )).resolves.toMatchObject({ statusCode: 413 });
      expect(fs.readFileSync(filePath).equals(originalBytes)).toBe(true);
    } finally {
      fs.rmSync(homeDirectory, { recursive: true, force: true });
    }
  });

  it('rejects malformed request records as client errors without mutation', async () => {
    const homeDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'lingoflash-device-record-shape-limit-'));
    const filePath = backupPath(homeDirectory);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const originalBackup = { ownerUserId: 'user-a', cards: [makeCard('original')], pending: [], total: 1 };
    fs.writeFileSync(filePath, JSON.stringify(originalBackup));
    const originalBytes = fs.readFileSync(filePath);
    try {
      await expect(invokeJsonRoute(
        '/api/device-cards',
        'PUT',
        JSON.stringify({ ownerUserId: 'user-a', cards: [null] }),
        {},
        homeDirectory,
      )).resolves.toMatchObject({ statusCode: 400 });
      expect(fs.readFileSync(filePath).equals(originalBytes)).toBe(true);

      await expect(invokeJsonRoute(
        '/api/device-cards/ack',
        'PUT',
        JSON.stringify({ userId: 'user-a', operations: [null] }),
        {},
        homeDirectory,
      )).resolves.toMatchObject({ statusCode: 400 });
      expect(fs.readFileSync(filePath).equals(originalBytes)).toBe(true);
    } finally {
      fs.rmSync(homeDirectory, { recursive: true, force: true });
    }
  });

  it('rejects oversized existing, merged, and normalized card state without mutation', async () => {
    const homeDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'lingoflash-device-card-state-limit-'));
    const filePath = backupPath(homeDirectory);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    try {
      const oversizedExisting = { ownerUserId: 'user-a', cards: Array.from({ length: DEVICE_COLLECTION_MAX_SIZE + 1 }, (_, index) => makeCard(`old-${index}`)), pending: [] };
      fs.writeFileSync(filePath, JSON.stringify(oversizedExisting));
      const originalBytes = fs.readFileSync(filePath);
      await expect(invokeJsonRoute(
        '/api/device-cards',
        'PUT',
        JSON.stringify({ ownerUserId: 'user-a', cards: [makeCard('replacement')] }),
        {},
        homeDirectory,
      )).resolves.toMatchObject({ statusCode: 413 });
      expect(fs.readFileSync(filePath).equals(originalBytes)).toBe(true);

      const mergeBase = { ownerUserId: 'user-a', cards: Array.from({ length: 3_000 }, (_, index) => makeCard(`base-${index}`)), pending: [] };
      fs.writeFileSync(filePath, JSON.stringify(mergeBase));
      const mergeBytes = fs.readFileSync(filePath);
      await expect(invokeJsonRoute(
        '/api/device-cards',
        'PUT',
        JSON.stringify({ ownerUserId: 'user-a', cards: Array.from({ length: 3_000 }, (_, index) => makeCard(`incoming-${index}`)), mode: 'merge' }),
        {},
        homeDirectory,
      )).resolves.toMatchObject({ statusCode: 413 });
      expect(fs.readFileSync(filePath).equals(mergeBytes)).toBe(true);
    } finally {
      fs.rmSync(homeDirectory, { recursive: true, force: true });
    }
  });

  it('rejects pending growth after merge and preserves the pending-upsert file', async () => {
    const homeDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'lingoflash-device-pending-state-limit-'));
    const filePath = backupPath(homeDirectory);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const existing = {
      ownerUserId: 'user-a',
      cards: [],
      pending: Array.from({ length: 3_000 }, (_, index) => makePending(`base-${index}`)),
    };
    fs.writeFileSync(filePath, JSON.stringify(existing));
    const originalBytes = fs.readFileSync(filePath);
    try {
      await expect(invokeJsonRoute(
        '/api/device-cards',
        'PUT',
        JSON.stringify({
          ownerUserId: 'user-a',
          cards: [],
          pending: Array.from({ length: 3_000 }, (_, index) => makePending(`incoming-${index}`)),
          mode: 'merge',
        }),
        {},
        homeDirectory,
      )).resolves.toMatchObject({ statusCode: 413 });
      expect(fs.readFileSync(filePath).equals(originalBytes)).toBe(true);
    } finally {
      fs.rmSync(homeDirectory, { recursive: true, force: true });
    }
  });

  it('rejects oversized stored and legacy files before parse or migration', async () => {
    const homeDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'lingoflash-device-file-limit-'));
    const filePath = backupPath(homeDirectory);
    const legacyPath = path.resolve(process.cwd(), '.lingoflash-device-sync', 'cards.json');
    const legacyDirectory = path.dirname(legacyPath);
    const previousLegacy = fs.existsSync(legacyPath) ? fs.readFileSync(legacyPath) : null;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    try {
      fs.writeFileSync(filePath, '{}');
      fs.truncateSync(filePath, DEVICE_REQUEST_MAX_BODY_BYTES + 1);
      const oversizedBytes = fs.statSync(filePath).size;
      await expect(invokeJsonRoute('/api/device-cards', 'GET', '{}', {}, homeDirectory))
        .resolves.toMatchObject({ statusCode: 413 });
      expect(fs.statSync(filePath).size).toBe(oversizedBytes);

      fs.unlinkSync(filePath);
      fs.mkdirSync(legacyDirectory, { recursive: true });
      fs.writeFileSync(legacyPath, JSON.stringify({ cards: [makeCard('legacy-large', { blob: 'x'.repeat(DEVICE_RECORD_MAX_SERIALIZED_BYTES) })] }));
      const invalidLegacyBytes = fs.readFileSync(legacyPath);
      await expect(invokeJsonRoute('/api/device-cards', 'GET', '{}', {}, homeDirectory))
        .resolves.toMatchObject({ statusCode: 413 });
      expect(fs.readFileSync(legacyPath).equals(invalidLegacyBytes)).toBe(true);
      expect(fs.existsSync(filePath)).toBe(false);

      fs.writeFileSync(legacyPath, '{}');
      fs.truncateSync(legacyPath, DEVICE_REQUEST_MAX_BODY_BYTES + 1);
      const oversizedLegacyBytes = fs.statSync(legacyPath).size;
      await expect(invokeJsonRoute('/api/device-cards', 'GET', '{}', {}, homeDirectory))
        .resolves.toMatchObject({ statusCode: 413 });
      expect(fs.statSync(legacyPath).size).toBe(oversizedLegacyBytes);
      expect(fs.existsSync(filePath)).toBe(false);
    } finally {
      fs.rmSync(homeDirectory, { recursive: true, force: true });
      if (previousLegacy) fs.writeFileSync(legacyPath, previousLegacy);
      else if (fs.existsSync(legacyPath)) fs.unlinkSync(legacyPath);
    }
  });

  it('supports a lower validation ceiling for cumulative output tests', () => {
    expect(() => serializeLocalDeviceBackup({ cards: [makeCard('large', { blob: 'x'.repeat(100) })] }, 128)).toThrow();
  });
});

describe('local device event stream limits', () => {
  it('caps clients, cleans up on close, and expires clients after the maximum lifetime', async () => {
    vi.useFakeTimers();
    const routes = configureRouteHandlers();
    const requests = Array.from({ length: DEVICE_EVENT_CLIENT_MAX }, createEventRouteRequest);
    const responses = requests.map(() => createEventRouteResponse());
    for (let index = 0; index < requests.length; index += 1) {
      await routes.get('/api/device-cards/events')!(requests[index], responses[index]);
      expect(responses[index].statusCode).toBe(200);
    }
    const cappedRequest = createEventRouteRequest();
    const cappedResponse = createEventRouteResponse();
    await routes.get('/api/device-cards/events')!(cappedRequest, cappedResponse);
    expect(cappedResponse.statusCode).toBe(429);

    requests[0].emit('close');
    const reopenedRequest = createEventRouteRequest();
    const reopenedResponse = createEventRouteResponse();
    await routes.get('/api/device-cards/events')!(reopenedRequest, reopenedResponse);
    expect(reopenedResponse.statusCode).toBe(200);

    vi.advanceTimersByTime(DEVICE_EVENT_CLIENT_MAX_LIFETIME_MS);
    expect(reopenedResponse.ended).toBe(true);
    const finalRequest = createEventRouteRequest();
    const finalResponse = createEventRouteResponse();
    await routes.get('/api/device-cards/events')!(finalRequest, finalResponse);
    expect(finalResponse.statusCode).toBe(200);
  });
});

describe('local pending operation helpers', () => {
  it('targets patches by cardId and retains every distinct pending operation', () => {
    const patch = { type: 'patch', cardId: 'card-1', fields: { bookmarked: true }, updatedAt: '2' };
    expect(getPendingOperationCardId(patch)).toBe('card-1');

    const operations = Array.from({ length: 5_100 }, (_, index) => ({
      type: 'delete',
      cardId: `card-${index}`,
      updatedAt: String(index),
    }));
    expect(mergeLocalPendingOperations([], operations)).toHaveLength(5_100);
  });
});

describe('Shared Device Store adapter boundary', () => {
  it('keeps Vite declarative and the development adapter explicitly typed', () => {
    const configSource = readFileSync(fileURLToPath(new URL('./vite.config.ts', import.meta.url)), 'utf8');
    const adapterSource = readFileSync(fileURLToPath(new URL('./dev/sharedDeviceStoreAdapter.ts', import.meta.url)), 'utf8');

    expect(configSource.split('\n').length).toBeLessThan(120);
    expect(configSource).toContain('sharedDeviceStorePlugin()');
    expect(configSource).not.toMatch(/configureServer|readBody|writeJsonFileAtomically|device-cards\/events/);
    expect(adapterSource).toContain('configureServer(server)');
    expect(adapterSource).not.toMatch(/\bany\b/);
    expect(configSource).not.toMatch(/\bany\b/);
  });
});
