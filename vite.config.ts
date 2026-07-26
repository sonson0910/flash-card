import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {defineConfig, loadEnv, type Plugin} from 'vite';
import {mergeCardsById} from './src/lib/deviceStore';

type LocalRequestLike = {
  headers?: Record<string, string | string[] | undefined>;
  method?: string;
};

const headerValue = (request: LocalRequestLike, name: string) => {
  const value = request.headers?.[name];
  return Array.isArray(value) ? value[0] : value;
};

export const isTrustedLocalDeviceRequest = (request: LocalRequestLike): boolean => {
  const host = headerValue(request, 'host');
  const origin = headerValue(request, 'origin');
  const fetchSite = headerValue(request, 'sec-fetch-site');
  if (!host || fetchSite !== 'same-origin') return false;
  let parsedHost: URL;
  try {
    parsedHost = new URL(`http://${host}`);
  } catch {
    return false;
  }
  if (!['localhost', '127.0.0.1', '[::1]'].includes(parsedHost.hostname)) return false;
  if (origin) {
    try {
      const parsedOrigin = new URL(origin);
      if (!['http:', 'https:'].includes(parsedOrigin.protocol) || parsedOrigin.host !== host) return false;
    } catch {
      return false;
    }
  }
  const method = String(request.method || 'GET').toUpperCase();
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) return true;
  return headerValue(request, 'content-type')?.toLocaleLowerCase('en-US').startsWith('application/json') === true;
};

export const getPendingOperationCardId = (operation: any): string | null => {
  const value = operation?.type === 'delete' || operation?.type === 'patch'
    ? operation?.cardId
    : operation?.card?.id;
  return typeof value === 'string' && value ? value : null;
};

export const mergeLocalPendingOperations = (existingPending: any[], incomingPending: any[]) => {
  const byCardId = new Map<string, any>();
  [...existingPending, ...incomingPending].forEach(operation => {
    const cardId = getPendingOperationCardId(operation);
    if (cardId) byCardId.set(cardId, operation);
  });
  return Array.from(byCardId.values());
};

const localDeviceSyncPlugin = (): Plugin => {
  const legacyBackupFile = path.resolve(__dirname, '.lingoflash-device-sync', 'cards.json');
  const backupDir = path.join(os.homedir(), '.lingoflash-device-sync');
  const backupFile = path.join(backupDir, 'lingoflash-2-cards.json');
  const eventClients = new Set<any>();
  const pendingFlushLeases = new Map<string, number>();

  const ensureMigratedBackup = () => {
    if (fs.existsSync(backupFile) || !fs.existsSync(legacyBackupFile)) return;
    fs.mkdirSync(backupDir, { recursive: true });
    fs.copyFileSync(legacyBackupFile, backupFile);
  };

  const sendJson = (res: any, statusCode: number, payload: unknown) => {
    res.statusCode = statusCode;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(payload));
  };

  const broadcastChange = (payload: unknown) => {
    const message = `event: cards-changed\ndata: ${JSON.stringify(payload)}\n\n`;
    eventClients.forEach(client => {
      try {
        client.write(message);
      } catch {
        eventClients.delete(client);
      }
    });
  };

  const readBody = (req: any): Promise<string> => new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk: Buffer) => {
      body += chunk.toString('utf8');
      if (body.length > 25 * 1024 * 1024) {
        reject(new Error('Request body is too large.'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });

  const isLocalRequest = (req: any) => {
    const address = String(req.socket?.remoteAddress || '');
    return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
  };

  const normalizeBackup = (value: any) => {
    const cards = Array.isArray(value?.cards) ? value.cards : Array.isArray(value?.items) ? value.items : [];
    const pending = Array.isArray(value?.pending) ? value.pending : [];
    const merged = new Map<string, any>();
    cards.forEach((card: any) => {
      if (card && typeof card.id === 'string') merged.set(card.id, card);
    });
    pending.forEach((operation: any) => {
      if (operation?.type === 'delete' && typeof operation.cardId === 'string') {
        merged.delete(operation.cardId);
      } else if (operation?.type === 'upsert' && operation.card && typeof operation.card.id === 'string') {
        merged.set(operation.card.id, operation.card);
      } else if (operation?.type === 'patch' && typeof operation.cardId === 'string' && operation.fields && typeof operation.fields === 'object') {
        const existingCard = merged.get(operation.cardId);
        if (existingCard) merged.set(operation.cardId, { ...existingCard, ...operation.fields, id: operation.cardId });
      }
    });
    return {
      cards: Array.from(merged.values()).sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || ''))),
      pending,
    };
  };

  return {
    name: 'lingoflash-local-device-sync',
    configureServer(server) {
      server.middlewares.use('/api/device-cards/events', (req, res) => {
        if (!isLocalRequest(req) || !isTrustedLocalDeviceRequest(req)) {
          sendJson(res, 403, { error: 'Trusted local same-origin access only' });
          return;
        }
        if (req.method !== 'GET') {
          sendJson(res, 405, { error: 'Method not allowed' });
          return;
        }
        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache, no-transform');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders?.();
        res.write('event: ready\ndata: {}\n\n');
        eventClients.add(res);
        const keepAliveId = setInterval(() => res.write(': keep-alive\n\n'), 15000);
        req.on('close', () => {
          clearInterval(keepAliveId);
          eventClients.delete(res);
        });
      });

      server.middlewares.use('/api/device-cards/flush', async (req, res) => {
        try {
          if (!isLocalRequest(req) || !isTrustedLocalDeviceRequest(req)) {
            sendJson(res, 403, { error: 'Trusted local same-origin access only' });
            return;
          }
          if (req.method !== 'POST' && req.method !== 'DELETE') {
            sendJson(res, 405, { error: 'Method not allowed' });
            return;
          }
          const payload = JSON.parse(await readBody(req));
          const userId = typeof payload?.userId === 'string' ? payload.userId.slice(0, 256) : '';
          if (!userId) {
            sendJson(res, 400, { error: 'userId is required' });
            return;
          }
          if (req.method === 'DELETE') {
            pendingFlushLeases.delete(userId);
            sendJson(res, 200, { ok: true });
            return;
          }
          const now = Date.now();
          const leaseExpiresAt = pendingFlushLeases.get(userId) ?? 0;
          if (leaseExpiresAt > now) {
            sendJson(res, 200, { granted: false });
            return;
          }
          pendingFlushLeases.set(userId, now + 2 * 60 * 1000);
          sendJson(res, 200, { granted: true });
        } catch (error) {
          sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
        }
      });

      server.middlewares.use('/api/device-cards/sync', async (req, res) => {
        try {
          if (!isLocalRequest(req) || !isTrustedLocalDeviceRequest(req)) {
            sendJson(res, 403, { error: 'Trusted local same-origin access only' });
            return;
          }
          if (req.method !== 'POST' && req.method !== 'PUT') {
            sendJson(res, 405, { error: 'Method not allowed' });
            return;
          }
          const payload = JSON.parse(await readBody(req));
          const userId = typeof payload?.userId === 'string' ? payload.userId.slice(0, 256) : '';
          const expectedTotal = Number.isFinite(payload?.expectedTotal) ? Math.max(0, Math.min(5000, Math.floor(payload.expectedTotal))) : 0;
          if (!userId || expectedTotal <= 0) {
            sendJson(res, 400, { error: 'userId and expectedTotal are required' });
            return;
          }
          ensureMigratedBackup();
          const existing = fs.existsSync(backupFile) ? JSON.parse(fs.readFileSync(backupFile, 'utf8')) : {};
          const existingCards = normalizeBackup(existing).cards;
          const previousSync = existing?.cloudSync && typeof existing.cloudSync === 'object' ? existing.cloudSync : null;
          const now = new Date();

          if (req.method === 'POST') {
            const previousAttempt = previousSync?.attemptedAt ? Date.parse(previousSync.attemptedAt) : 0;
            const leaseActive = previousSync?.userId === userId
              && previousSync?.expectedTotal === expectedTotal
              && previousSync?.status === 'syncing'
              && Number.isFinite(previousAttempt)
              && Date.now() - previousAttempt < 10 * 60 * 1000;
            const retryCoolingDown = previousSync?.userId === userId
              && previousSync?.expectedTotal === expectedTotal
              && previousSync?.status === 'paused'
              && Number.isFinite(previousAttempt)
              && Date.now() - previousAttempt < 5 * 60 * 1000;
            const alreadyComplete = previousSync?.userId === userId
              && previousSync?.expectedTotal === expectedTotal
              && previousSync?.status === 'complete';
            if (leaseActive || retryCoolingDown || alreadyComplete) {
              sendJson(res, 200, { granted: false, complete: alreadyComplete });
              return;
            }
            const cloudSync = {
              userId,
              status: 'syncing',
              expectedTotal,
              loaded: existingCards.length,
              attemptedAt: now.toISOString(),
            };
            fs.mkdirSync(backupDir, { recursive: true });
            fs.writeFileSync(backupFile, JSON.stringify({ ...existing, ownerUserId: userId, cloudSync }));
            sendJson(res, 200, { granted: true, cloudSync });
            return;
          }

          const status = ['syncing', 'complete', 'paused'].includes(String(payload?.status)) ? payload.status : 'paused';
          const loaded = Number.isFinite(payload?.loaded) ? Math.max(0, Math.floor(payload.loaded)) : existingCards.length;
          const cloudSync = { userId, status, expectedTotal, loaded, attemptedAt: now.toISOString() };
          fs.mkdirSync(backupDir, { recursive: true });
          fs.writeFileSync(backupFile, JSON.stringify({ ...existing, ownerUserId: userId, cloudSync }));
          sendJson(res, 200, { ok: true, cloudSync });
        } catch (error) {
          sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
        }
      });

      server.middlewares.use('/api/device-cards/ack', async (req, res) => {
        try {
          if (!isLocalRequest(req) || !isTrustedLocalDeviceRequest(req)) {
            sendJson(res, 403, { error: 'Trusted local same-origin access only' });
            return;
          }
          if (req.method !== 'PUT') {
            sendJson(res, 405, { error: 'Method not allowed' });
            return;
          }
          const payload = JSON.parse(await readBody(req));
          const acknowledged = Array.isArray(payload?.operations) ? payload.operations : [];
          ensureMigratedBackup();
          const existing = fs.existsSync(backupFile) ? JSON.parse(fs.readFileSync(backupFile, 'utf8')) : {};
          const existingPending = Array.isArray(existing?.pending) ? existing.pending : [];
          const acknowledgedAt = new Map<string, string>();
          acknowledged.forEach((operation: any) => {
            const cardId = getPendingOperationCardId(operation);
            if (typeof cardId === 'string' && typeof operation?.updatedAt === 'string') {
              acknowledgedAt.set(cardId, operation.updatedAt);
            }
          });
          const pending = existingPending.filter((operation: any) => {
            const cardId = getPendingOperationCardId(operation);
            const flushedAt = cardId ? acknowledgedAt.get(cardId) : undefined;
            return !flushedAt || typeof operation?.updatedAt !== 'string' || operation.updatedAt > flushedAt;
          });
          fs.mkdirSync(backupDir, { recursive: true });
          fs.writeFileSync(backupFile, JSON.stringify({
            ...existing,
            pending,
            updatedAt: new Date().toISOString(),
          }));
          broadcastChange({ total: existing?.total ?? 0, saved: Array.isArray(existing?.cards) ? existing.cards.length : 0, pending: pending.length });
          sendJson(res, 200, { ok: true, pending: pending.length });
        } catch (error) {
          sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
        }
      });

      server.middlewares.use('/api/device-cards', async (req, res) => {
        try {
          if (!isLocalRequest(req) || !isTrustedLocalDeviceRequest(req)) {
            sendJson(res, 403, { error: 'Trusted local same-origin access only' });
            return;
          }
          if (req.method === 'GET') {
            ensureMigratedBackup();
            if (!fs.existsSync(backupFile)) {
              sendJson(res, 200, { cards: [], total: 0, updatedAt: null });
              return;
            }
            const existing = JSON.parse(fs.readFileSync(backupFile, 'utf8'));
            const normalized = normalizeBackup(existing);
            sendJson(res, 200, {
              ...existing,
              cards: normalized.cards,
              total: Math.max(Number(existing?.total) || 0, normalized.cards.length),
              pending: normalized.pending,
            });
            return;
          }

          if (req.method === 'PUT') {
            const payload = JSON.parse(await readBody(req));
            const existing = fs.existsSync(backupFile)
              ? JSON.parse(fs.readFileSync(backupFile, 'utf8'))
              : {};
            const incomingCards = (Array.isArray(payload?.cards) ? payload.cards : Array.isArray(payload?.items) ? payload.items : []).slice(0, 5000);
            const incomingOwnerKnown = Object.prototype.hasOwnProperty.call(payload ?? {}, 'ownerUserId')
              && (payload?.ownerUserId === null || typeof payload?.ownerUserId === 'string');
            const incomingOwner = incomingOwnerKnown ? payload.ownerUserId : undefined;
            const existingOwnerKnown = Object.prototype.hasOwnProperty.call(existing ?? {}, 'ownerUserId')
              && (existing?.ownerUserId === null || typeof existing?.ownerUserId === 'string');
            const existingOwner = existingOwnerKnown
              ? existing.ownerUserId
              : typeof existing?.cloudSync?.userId === 'string'
                ? existing.cloudSync.userId
                : undefined;
            const ownerChanged = incomingOwnerKnown && existingOwner !== incomingOwner;
            const existingCards = !ownerChanged && Array.isArray(existing?.cards) ? existing.cards.slice(0, 5000) : [];
            const cards = payload?.mode === 'merge'
              ? mergeCardsById(existingCards, incomingCards).slice(0, 5000)
              : incomingCards;
            const existingPending = !ownerChanged && Array.isArray(existing?.pending) ? existing.pending : [];
            const incomingPending = Array.isArray(payload?.pending) ? payload.pending : [];
            const pending = payload?.mode === 'merge'
              ? mergeLocalPendingOperations(existingPending, incomingPending)
              : Array.isArray(payload?.pending)
                ? incomingPending
                : existingPending;
            const normalized = normalizeBackup({ cards, pending });
            const requestedTotal = Number.isFinite(payload?.total) ? Math.floor(payload.total) : 0;
            const existingTotal = payload?.mode === 'merge' && !ownerChanged && Number.isFinite(existing?.total) ? Math.floor(existing.total) : 0;
            const total = Math.max(normalized.cards.length, requestedTotal, existingTotal);
            fs.mkdirSync(backupDir, { recursive: true });
            fs.writeFileSync(backupFile, JSON.stringify({
              cards: normalized.cards,
              total,
              pending: normalized.pending,
              ...(incomingOwnerKnown || existingOwner !== undefined
                ? { ownerUserId: incomingOwnerKnown ? incomingOwner : existingOwner }
                : {}),
              cloudSync: ownerChanged ? null : existing?.cloudSync ?? null,
              updatedAt: new Date().toISOString(),
            }));
            broadcastChange({ total, saved: normalized.cards.length, pending: normalized.pending.length });
            sendJson(res, 200, { ok: true, total, saved: normalized.cards.length, pending: normalized.pending.length });
            return;
          }

          sendJson(res, 405, { error: 'Method not allowed' });
        } catch (error) {
          sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
        }
      });
    },
  };
};

export default defineConfig(({mode, command}) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [react(), tailwindcss(), localDeviceSyncPlugin()],
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(command === 'serve' ? env.GEMINI_API_KEY || '' : ''),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      host: '127.0.0.1',
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: {
        ignored: ['**/.lingoflash-device-sync/**'],
      },
    },
    build: {
      sourcemap: false,
      chunkSizeWarningLimit: 600,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (
              id.includes('/node_modules/react/')
              || id.includes('/node_modules/react-dom/')
              || id.includes('/node_modules/scheduler/')
            ) return 'react';
            if (id.includes('/node_modules/firebase/functions') || id.includes('/node_modules/@firebase/functions')) {
              return 'firebase-functions';
            }
            if (id.includes('/node_modules/firebase/') || id.includes('/node_modules/@firebase/')) return 'firebase';
            if (id.includes('/node_modules/motion') || id.includes('/node_modules/framer-motion')) return 'motion';
            return undefined;
          },
        },
      },
    },
  };
});
