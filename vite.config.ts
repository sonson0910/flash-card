import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {defineConfig, loadEnv, type Plugin} from 'vite';
import {
  compareStoredCardVersions,
  mergeCardsById,
  reconcileCardsByAuthoritativeWord,
} from './src/lib/deviceStore';
import {
  deviceBackupHasStoredData,
  resolveDeviceBackupOwnership,
} from './src/lib/deviceBackupOwnership';

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

const pendingPatchFieldMask = (operation: any): string[] => {
  if (Array.isArray(operation?.fieldMask)) {
    return operation.fieldMask.filter((field: unknown): field is string => (
      typeof field === 'string' && field.length > 0
    ));
  }
  return operation?.fields && typeof operation.fields === 'object' && !Array.isArray(operation.fields)
    ? Object.keys(operation.fields)
    : [];
};

export const mergeLocalPendingOperations = (existingPending: any[], incomingPending: any[]) => {
  const commandsByCard = new Map<string, any[]>();
  [...existingPending, ...incomingPending]
    .map((operation, index) => ({ operation, index }))
    .filter(({ operation }) => getPendingOperationCardId(operation) !== null)
    .sort((left, right) => (
      String(left.operation?.updatedAt ?? '').localeCompare(String(right.operation?.updatedAt ?? ''))
      || left.index - right.index
    ))
    .forEach(({ operation }) => {
      const cardId = getPendingOperationCardId(operation)!;
      const key = `${typeof operation?.ownerUserId === 'string' ? operation.ownerUserId : ''}:${cardId}`;
      const commands = commandsByCard.get(key) ?? [];
      const previous = commands.at(-1);
      if (!previous) {
        commandsByCard.set(key, [operation]);
        return;
      }
      if (previous.type === 'delete') {
        if (operation.type === 'upsert') commandsByCard.set(key, [operation]);
        return;
      }
      if (operation.type === 'delete') {
        commandsByCard.set(key, [operation]);
        return;
      }
      if (previous.type === 'upsert' && operation.type === 'patch') {
        commandsByCard.set(key, [...commands, operation]);
        return;
      }
      if (previous.type === 'patch' && operation.type === 'patch') {
        const fieldMask = [...new Set([
          ...pendingPatchFieldMask(previous),
          ...pendingPatchFieldMask(operation),
        ])];
        commandsByCard.set(key, [...commands.slice(0, -1), {
          ...operation,
          fields: { ...previous.fields, ...operation.fields },
          ...(fieldMask.length > 0 ? { fieldMask } : {}),
        }]);
        return;
      }
      commandsByCard.set(key, [operation]);
    });
  return [...commandsByCard.values()]
    .flat()
    .map((operation, index) => ({ operation, index }))
    .sort((left, right) => (
      String(left.operation?.updatedAt ?? '').localeCompare(String(right.operation?.updatedAt ?? ''))
      || left.index - right.index
    ))
    .map(({ operation }) => operation);
};

export const grantPendingFlushLease = (
  leases: Map<string, number>,
  userId: string,
  now: number,
  force: boolean,
): boolean => {
  if (!force && (leases.get(userId) ?? 0) > now) return false;
  leases.set(userId, now + 2 * 60 * 1000);
  return true;
};

const operationBoundary = (operation: any) => ({
  libraryEpoch: operation?.libraryEpoch,
  revision: operation?.baseRevision,
});

export const normalizeLocalDeviceBackup = (
  value: any,
  authoritativeCards: readonly unknown[] = [],
) => {
  const cards = Array.isArray(value?.cards)
    ? value.cards
    : Array.isArray(value?.items)
      ? value.items
      : [];
  const pending = Array.isArray(value?.pending) ? value.pending : [];
  const merged = new Map<string, any>();
  cards.forEach((card: any) => {
    if (card && typeof card.id === 'string') merged.set(card.id, card);
  });
  pending.forEach((operation: any) => {
    if (operation?.type === 'delete' && typeof operation.cardId === 'string') {
      const existingCard = merged.get(operation.cardId);
      if (existingCard && compareStoredCardVersions(existingCard, operationBoundary(operation)) <= 0) {
        merged.delete(operation.cardId);
      }
    } else if (operation?.type === 'upsert' && operation.card && typeof operation.card.id === 'string') {
      const existingCard = merged.get(operation.card.id);
      if (!existingCard || compareStoredCardVersions(existingCard, operation.card) <= 0) {
        merged.set(operation.card.id, operation.card);
      }
    } else if (operation?.type === 'patch' && typeof operation.cardId === 'string' && operation.fields && typeof operation.fields === 'object') {
      const existingCard = merged.get(operation.cardId);
      if (existingCard && compareStoredCardVersions(existingCard, operationBoundary(operation)) <= 0) {
        merged.set(operation.cardId, {
          ...existingCard,
          ...operation.fields,
          id: operation.cardId,
          libraryEpoch: existingCard.libraryEpoch,
          revision: existingCard.revision,
        });
      }
    }
  });
  const materialized = Array.from(merged.values());
  return {
    cards: authoritativeCards.length > 0
      ? reconcileCardsByAuthoritativeWord(materialized, authoritativeCards)
      : mergeCardsById([], materialized),
    pending,
  };
};

export const hasDeviceWriteOwnerConflict = (
  existingOwner: string | null | undefined,
  incomingOwnerKnown: boolean,
  incomingOwner: string | null | undefined,
): boolean => typeof existingOwner === 'string'
  && (!incomingOwnerKnown || existingOwner !== incomingOwner);

export const hasDeviceAckOwnerConflict = (
  existingOwner: string | null | undefined,
  incomingOwner: string,
): boolean => typeof existingOwner === 'string' && existingOwner !== incomingOwner;

export const filterAcknowledgedLocalPending = (
  current: readonly any[],
  acknowledged: readonly any[],
): any[] => {
  const acknowledgedOperationKeys = new Set(
    acknowledged.flatMap(operation => {
      const cardId = getPendingOperationCardId(operation);
      return typeof operation?.opId === 'string' && operation.opId && cardId
        ? [`${operation.opId}:${cardId}`]
        : [];
    }),
  );
  const acknowledgedAt = new Map<string, string>();
  acknowledged.forEach(operation => {
    const cardId = getPendingOperationCardId(operation);
    if (!cardId || typeof operation?.updatedAt !== 'string') return;
    const previous = acknowledgedAt.get(cardId);
    if (!previous || previous < operation.updatedAt) {
      acknowledgedAt.set(cardId, operation.updatedAt);
    }
  });

  return current.filter(operation => {
    const cardId = getPendingOperationCardId(operation);
    if (typeof operation?.opId === 'string' && operation.opId && cardId) {
      return !acknowledgedOperationKeys.has(`${operation.opId}:${cardId}`);
    }
    const flushedAt = cardId ? acknowledgedAt.get(cardId) : undefined;
    return !flushedAt
      || typeof operation?.updatedAt !== 'string'
      || operation.updatedAt > flushedAt;
  });
};

export const writeJsonFileAtomically = (filePath: string, value: unknown): void => {
  const directory = path.dirname(filePath);
  const temporaryFile = path.join(
    directory,
    `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`,
  );

  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(directory, 0o700);
  } catch {
    // Some mounted development filesystems do not expose POSIX permissions.
  }

  try {
    fs.writeFileSync(temporaryFile, JSON.stringify(value), {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    });
    fs.renameSync(temporaryFile, filePath);
    try {
      fs.chmodSync(filePath, 0o600);
    } catch {
      // The atomic replacement still succeeds on non-POSIX filesystems.
    }
  } catch (error) {
    try {
      fs.unlinkSync(temporaryFile);
    } catch {
      // The temp file may not have been created, or rename already consumed it.
    }
    throw error;
  }
};

type LocalDeviceBackupLockOptions = {
  retryMilliseconds?: number;
  timeoutMilliseconds?: number;
  staleMilliseconds?: number;
};

const lockErrorCode = (error: unknown): string | undefined => (
  error && typeof error === 'object' && 'code' in error
    ? String((error as { code?: unknown }).code)
    : undefined
);

const processIsRunning = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return lockErrorCode(error) !== 'ESRCH';
  }
};

const lockIdentityMatches = (observed: fs.Stats, current: fs.Stats): boolean => (
  observed.dev === current.dev
  && observed.ino === current.ino
  && observed.mtimeMs === current.mtimeMs
  && observed.size === current.size
);

const removeObservedLock = async (
  lockFile: string,
  observed: fs.Stats,
): Promise<boolean> => {
  let current: fs.Stats;
  try {
    current = await fs.promises.stat(lockFile);
  } catch (error) {
    if (lockErrorCode(error) === 'ENOENT') return true;
    throw error;
  }
  if (!lockIdentityMatches(observed, current)) return false;

  try {
    await fs.promises.unlink(lockFile);
    return true;
  } catch (error) {
    if (lockErrorCode(error) === 'ENOENT') return true;
    if (['EISDIR', 'EPERM'].includes(lockErrorCode(error) ?? '')) {
      try {
        const replacement = await fs.promises.lstat(lockFile);
        if (!lockIdentityMatches(observed, replacement)) return false;
      } catch (replacementError) {
        if (lockErrorCode(replacementError) === 'ENOENT') return true;
      }
    }
    throw error;
  }
};

const removeAbandonedLock = async (
  lockFile: string,
  staleMilliseconds: number,
): Promise<boolean> => {
  let stat: fs.Stats;
  try {
    stat = await fs.promises.stat(lockFile);
  } catch (error) {
    return lockErrorCode(error) === 'ENOENT';
  }

  try {
    const owner = JSON.parse(await fs.promises.readFile(lockFile, 'utf8')) as { pid?: unknown };
    if (Number.isSafeInteger(owner.pid) && Number(owner.pid) > 0) {
      if (processIsRunning(Number(owner.pid))) return false;
      return removeObservedLock(lockFile, stat);
    }
  } catch {
    // A process can be between exclusive create and metadata write. Only an
    // old metadata-less lock is safe to reclaim.
  }

  if (Date.now() - stat.mtimeMs < staleMilliseconds) return false;
  return removeObservedLock(lockFile, stat);
};

type LocalDeviceLockEntry = {
  pid?: unknown;
  token?: unknown;
  createdAt?: unknown;
};

const removeUniqueLockEntry = async (entryPath: string): Promise<void> => {
  try {
    await fs.promises.unlink(entryPath);
  } catch (error) {
    if (lockErrorCode(error) !== 'ENOENT') throw error;
  }
};

const activeLockEntry = async (
  entryPath: string,
  staleMilliseconds: number,
): Promise<boolean> => {
  let stat: fs.Stats;
  try {
    stat = await fs.promises.lstat(entryPath);
  } catch (error) {
    if (lockErrorCode(error) === 'ENOENT') return false;
    throw error;
  }
  if (!stat.isFile()) return true;

  try {
    const owner = JSON.parse(await fs.promises.readFile(entryPath, 'utf8')) as LocalDeviceLockEntry;
    if (
      Number.isSafeInteger(owner.pid)
      && Number(owner.pid) > 0
      && typeof owner.token === 'string'
      && owner.token.length > 0
    ) {
      if (processIsRunning(Number(owner.pid))) return true;
      await removeUniqueLockEntry(entryPath);
      return false;
    }
  } catch {
    // A process can be between exclusive ticket creation and metadata write.
  }

  if (Date.now() - stat.mtimeMs < staleMilliseconds) return true;
  await removeUniqueLockEntry(entryPath);
  return false;
};

const ensureLockDirectory = async (
  lockDirectory: string,
  staleMilliseconds: number,
  retryMilliseconds: number,
  deadline: number,
): Promise<void> => {
  while (true) {
    try {
      await fs.promises.mkdir(lockDirectory, { mode: 0o700 });
      return;
    } catch (error) {
      if (lockErrorCode(error) !== 'EEXIST') throw error;
    }

    let current: fs.Stats;
    try {
      current = await fs.promises.lstat(lockDirectory);
    } catch (error) {
      if (lockErrorCode(error) === 'ENOENT') continue;
      throw error;
    }
    if (current.isDirectory()) return;
    if (await removeAbandonedLock(lockDirectory, staleMilliseconds)) continue;
    if (Date.now() >= deadline) {
      throw new Error(`Timed out waiting for device backup lock: ${lockDirectory}`);
    }
    await new Promise(resolve => setTimeout(resolve, retryMilliseconds));
  }
};

const activeLockEntryNames = async (
  lockDirectory: string,
  staleMilliseconds: number,
): Promise<string[]> => {
  let names: string[];
  try {
    names = await fs.promises.readdir(lockDirectory);
  } catch (error) {
    if (lockErrorCode(error) === 'ENOENT') return [];
    throw error;
  }
  const active: string[] = [];
  for (const name of names) {
    if (await activeLockEntry(path.join(lockDirectory, name), staleMilliseconds)) {
      active.push(name);
    }
  }
  return active;
};

const lockTicketSequence = (name: string): number | null => {
  const match = /^(\d{16})-[0-9a-f-]+\.json$/i.exec(name);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isSafeInteger(value) ? value : null;
};

export async function withLocalDeviceBackupLock<T>(
  filePath: string,
  action: () => T | Promise<T>,
  options: LocalDeviceBackupLockOptions = {},
): Promise<T> {
  const retryMilliseconds = Math.max(1, options.retryMilliseconds ?? 10);
  const timeoutMilliseconds = Math.max(retryMilliseconds, options.timeoutMilliseconds ?? 10_000);
  const staleMilliseconds = Math.max(retryMilliseconds, options.staleMilliseconds ?? 30_000);
  const directory = path.dirname(filePath);
  const lockDirectory = `${filePath}.lock`;
  const token = randomUUID();
  const deadline = Date.now() + timeoutMilliseconds;
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });

  let pendingPath = '';
  let ticketPath = '';
  let ticketName = '';
  while (!pendingPath) {
    await ensureLockDirectory(
      lockDirectory,
      staleMilliseconds,
      retryMilliseconds,
      deadline,
    );
    const pendingName = `.pending-${token}.json`;
    const candidatePath = path.join(lockDirectory, pendingName);
    let handle: Awaited<ReturnType<typeof fs.promises.open>> | null = null;
    try {
      handle = await fs.promises.open(candidatePath, 'wx', 0o600);
    } catch (error) {
      if (['ENOENT', 'EINVAL'].includes(lockErrorCode(error) ?? '')) {
        if (Date.now() >= deadline) {
          throw new Error(`Timed out waiting for device backup lock: ${lockDirectory}`);
        }
        await new Promise(resolve => setTimeout(resolve, retryMilliseconds));
        continue;
      }
      throw error;
    }
    try {
      await handle.writeFile(
        JSON.stringify({ pid: process.pid, token, createdAt: Date.now() }),
        'utf8',
      );
      pendingPath = candidatePath;
    } catch (error) {
      await removeUniqueLockEntry(candidatePath);
      throw error;
    } finally {
      await handle.close().catch(() => undefined);
    }
  }

  try {
    const entriesBeforeTicket = await activeLockEntryNames(lockDirectory, staleMilliseconds);
    const highestSequence = entriesBeforeTicket.reduce((highest, name) => (
      Math.max(highest, lockTicketSequence(name) ?? 0)
    ), 0);
    ticketName = `${String(highestSequence + 1).padStart(16, '0')}-${token}.json`;
    ticketPath = path.join(lockDirectory, ticketName);
    await fs.promises.rename(pendingPath, ticketPath);
    pendingPath = '';

    while (true) {
      const activeNames = await activeLockEntryNames(lockDirectory, staleMilliseconds);
      const pendingExists = activeNames.some(name => name.startsWith('.pending-'));
      const ticketNames = activeNames
        .filter(name => lockTicketSequence(name) !== null)
        .sort();
      const unknownEntryExists = activeNames.some(name => (
        !name.startsWith('.pending-') && lockTicketSequence(name) === null
      ));
      if (!pendingExists && !unknownEntryExists && ticketNames[0] === ticketName) break;
      if (Date.now() >= deadline) {
        throw new Error(`Timed out waiting for device backup lock: ${lockDirectory}`);
      }
      await new Promise(resolve => setTimeout(resolve, retryMilliseconds));
    }

    return await action();
  } finally {
    if (pendingPath) await removeUniqueLockEntry(pendingPath);
    if (ticketPath) await removeUniqueLockEntry(ticketPath);
    try {
      await fs.promises.rmdir(lockDirectory);
    } catch (error) {
      if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(lockErrorCode(error) ?? '')) throw error;
    }
  }
}

export const readJsonFileWithMigration = (
  filePath: string,
  legacyFilePath: string,
): any => {
  if (!fs.existsSync(filePath) && fs.existsSync(legacyFilePath)) {
    writeJsonFileAtomically(
      filePath,
      JSON.parse(fs.readFileSync(legacyFilePath, 'utf8')),
    );
  }
  return fs.existsSync(filePath)
    ? JSON.parse(fs.readFileSync(filePath, 'utf8'))
    : {};
};

const localDeviceSyncPlugin = (): Plugin => {
  const legacyBackupFile = path.resolve(__dirname, '.lingoflash-device-sync', 'cards.json');
  const backupDir = path.join(os.homedir(), '.lingoflash-device-sync');
  const backupFile = path.join(backupDir, 'lingoflash-2-cards.json');
  const eventClients = new Set<any>();
  const pendingFlushLeases = new Map<string, number>();

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
          sendJson(res, 200, {
            granted: grantPendingFlushLease(
              pendingFlushLeases,
              userId,
              Date.now(),
              payload?.force === true,
            ),
          });
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
          const result = await withLocalDeviceBackupLock(backupFile, () => {
            const existing = readJsonFileWithMigration(backupFile, legacyBackupFile);
            const ownership = resolveDeviceBackupOwnership(existing);
            if (
              ownership.conflicted
              || (ownership.ownerUserId === undefined && deviceBackupHasStoredData(existing))
              || hasDeviceAckOwnerConflict(ownership.ownerUserId, userId)
            ) {
              return { status: 'owner-conflict' as const };
            }
            const existingCards = normalizeLocalDeviceBackup(existing).cards;
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
                return { status: 'not-granted' as const, complete: alreadyComplete };
              }
              const cloudSync = {
                userId,
                status: 'syncing',
                expectedTotal,
                loaded: existingCards.length,
                attemptedAt: now.toISOString(),
              };
              writeJsonFileAtomically(backupFile, { ...existing, ownerUserId: userId, cloudSync });
              return { status: 'granted' as const, cloudSync };
            }

            const status = ['syncing', 'complete', 'paused'].includes(String(payload?.status)) ? payload.status : 'paused';
            const loaded = Number.isFinite(payload?.loaded) ? Math.max(0, Math.floor(payload.loaded)) : existingCards.length;
            const cloudSync = { userId, status, expectedTotal, loaded, attemptedAt: now.toISOString() };
            writeJsonFileAtomically(backupFile, { ...existing, ownerUserId: userId, cloudSync });
            return { status: 'updated' as const, cloudSync };
          });
          if (result.status === 'owner-conflict') {
            sendJson(res, 409, { error: 'Device backup belongs to another account' });
          } else if (result.status === 'not-granted') {
            sendJson(res, 200, { granted: false, complete: result.complete });
          } else if (result.status === 'granted') {
            sendJson(res, 200, { granted: true, cloudSync: result.cloudSync });
          } else {
            sendJson(res, 200, { ok: true, cloudSync: result.cloudSync });
          }
        } catch (error) {
          sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
        }
      });

      server.middlewares.use('/api/device-cards/cleanup', async (req, res) => {
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
          const userId = typeof payload?.userId === 'string' ? payload.userId.slice(0, 256) : '';
          const cardId = typeof payload?.cardId === 'string' ? payload.cardId.slice(0, 512) : '';
          const maximumEpoch = Number.isSafeInteger(payload?.maximum?.libraryEpoch)
            && payload.maximum.libraryEpoch >= 0
            ? payload.maximum.libraryEpoch
            : 0;
          const maximumRevision = Number.isSafeInteger(payload?.maximum?.revision)
            && payload.maximum.revision >= 0
            ? payload.maximum.revision
            : 0;
          if (!userId || !cardId) {
            sendJson(res, 400, { error: 'userId and cardId are required' });
            return;
          }
          const result = await withLocalDeviceBackupLock(backupFile, () => {
            const existing = readJsonFileWithMigration(backupFile, legacyBackupFile);
            const ownership = resolveDeviceBackupOwnership(existing);
            if (
              ownership.conflicted
              || (ownership.ownerUserId === undefined && deviceBackupHasStoredData(existing))
              || hasDeviceAckOwnerConflict(ownership.ownerUserId, userId)
            ) {
              return { status: 'owner-conflict' as const };
            }
            const cards = Array.isArray(existing?.cards) ? existing.cards : [];
            const target = cards.find((card: any) => card?.id === cardId);
            const targetEpoch = Number.isSafeInteger(target?.libraryEpoch) && target.libraryEpoch >= 0
              ? target.libraryEpoch
              : 0;
            const targetRevision = Number.isSafeInteger(target?.revision) && target.revision >= 0
              ? target.revision
              : 0;
            const deleted = Boolean(target) && (
              targetEpoch < maximumEpoch
              || (targetEpoch === maximumEpoch && targetRevision <= maximumRevision)
            );
            if (!deleted) return { status: 'ok' as const, deleted: false };

            const remainingCards = cards.filter((card: any) => card?.id !== cardId);
            const previousTotal = Number.isFinite(existing?.total)
              ? Math.max(cards.length, Math.floor(existing.total))
              : cards.length;
            const total = Math.max(remainingCards.length, previousTotal - 1);
            const pending = Array.isArray(existing?.pending) ? existing.pending.length : 0;
            writeJsonFileAtomically(backupFile, {
              ...existing,
              cards: remainingCards,
              total,
              updatedAt: new Date().toISOString(),
            });
            return {
              status: 'ok' as const,
              deleted: true,
              change: { total, saved: remainingCards.length, pending },
            };
          });
          if (result.status === 'owner-conflict') {
            sendJson(res, 409, { error: 'Device backup belongs to another account' });
            return;
          }
          if (result.deleted) broadcastChange(result.change);
          sendJson(res, 200, { ok: true, deleted: result.deleted });
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
          const userId = typeof payload?.userId === 'string'
            ? payload.userId.slice(0, 256)
            : '';
          if (!userId) {
            sendJson(res, 400, { error: 'userId required' });
            return;
          }
          const acknowledged = Array.isArray(payload?.operations) ? payload.operations : [];
          if (acknowledged.some((operation: any) => (
            typeof operation?.ownerUserId === 'string'
            && operation.ownerUserId !== userId
          ))) {
            sendJson(res, 400, { error: 'Operation owner mismatch' });
            return;
          }
          const result = await withLocalDeviceBackupLock(backupFile, () => {
            const existing = readJsonFileWithMigration(backupFile, legacyBackupFile);
            const existingPending = Array.isArray(existing?.pending) ? existing.pending : [];
            const ownership = resolveDeviceBackupOwnership(existing);
            if (
              ownership.conflicted
              || (ownership.ownerUserId === undefined && deviceBackupHasStoredData(existing))
              || hasDeviceAckOwnerConflict(ownership.ownerUserId, userId)
            ) {
              return { status: 'owner-conflict' as const };
            }
            const pending = filterAcknowledgedLocalPending(existingPending, acknowledged);
            writeJsonFileAtomically(backupFile, {
              ...existing,
              pending,
              ...(ownership.ownerUserId !== undefined
                ? { ownerUserId: ownership.ownerUserId }
                : {}),
              updatedAt: new Date().toISOString(),
            });
            return {
              status: 'acknowledged' as const,
              pending: pending.length,
              total: existing?.total ?? 0,
              saved: Array.isArray(existing?.cards) ? existing.cards.length : 0,
            };
          });
          if (result.status === 'owner-conflict') {
            sendJson(res, 409, { error: 'Device backup belongs to another account' });
            return;
          }
          broadcastChange({ total: result.total, saved: result.saved, pending: result.pending });
          sendJson(res, 200, { ok: true, pending: result.pending });
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
            const snapshot = await withLocalDeviceBackupLock(backupFile, () => ({
              exists: fs.existsSync(backupFile) || fs.existsSync(legacyBackupFile),
              existing: readJsonFileWithMigration(backupFile, legacyBackupFile),
            }));
            if (!snapshot.exists) {
              sendJson(res, 200, { cards: [], total: 0, updatedAt: null });
              return;
            }
            const existing = snapshot.existing;
            const normalized = normalizeLocalDeviceBackup(existing);
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
            const incomingCards = (Array.isArray(payload?.cards) ? payload.cards : Array.isArray(payload?.items) ? payload.items : []).slice(0, 5000);
            const incomingOwnership = resolveDeviceBackupOwnership(payload);
            const incomingOwnerKnown = incomingOwnership.ownerUserId !== undefined;
            const incomingOwner = incomingOwnership.ownerUserId;
            const result = await withLocalDeviceBackupLock(backupFile, () => {
              const existing = readJsonFileWithMigration(backupFile, legacyBackupFile);
              const existingOwnership = resolveDeviceBackupOwnership(existing);
              const claimsUnknownStoredData = incomingOwnerKnown
                && existingOwnership.ownerUserId === undefined
                && deviceBackupHasStoredData(existing);
              if (
                incomingOwnership.conflicted
                || existingOwnership.conflicted
                || claimsUnknownStoredData
                || hasDeviceWriteOwnerConflict(
                  existingOwnership.ownerUserId,
                  incomingOwnerKnown,
                  incomingOwner,
                )
              ) return { status: 'owner-conflict' as const };

              const existingOwner = existingOwnership.ownerUserId;
              const ownerChanged = incomingOwnerKnown && existingOwner !== incomingOwner;
              const existingCards = !ownerChanged && Array.isArray(existing?.cards) ? existing.cards.slice(0, 5000) : [];
              const isReconcile = payload?.mode === 'reconcile';
              const isMerge = payload?.mode === 'merge' || isReconcile;
              const cards = isReconcile
                ? reconcileCardsByAuthoritativeWord(existingCards, incomingCards).slice(0, 5000)
                : isMerge
                  ? mergeCardsById(existingCards, incomingCards).slice(0, 5000)
                  : incomingCards;
              const existingPending = !ownerChanged && Array.isArray(existing?.pending) ? existing.pending : [];
              const incomingPending = Array.isArray(payload?.pending) ? payload.pending : [];
              const pending = isMerge
                ? mergeLocalPendingOperations(existingPending, incomingPending)
                : Array.isArray(payload?.pending)
                  ? incomingPending
                  : existingPending;
              const normalized = normalizeLocalDeviceBackup(
                { cards, pending },
                isReconcile ? incomingCards : [],
              );
              const requestedTotal = Number.isFinite(payload?.total) ? Math.floor(payload.total) : 0;
              const existingTotal = isMerge && !ownerChanged && Number.isFinite(existing?.total) ? Math.floor(existing.total) : 0;
              const total = Math.max(normalized.cards.length, requestedTotal, existingTotal);
              writeJsonFileAtomically(backupFile, {
                cards: normalized.cards,
                total,
                pending: normalized.pending,
                ...(incomingOwnerKnown || existingOwner !== undefined
                  ? { ownerUserId: incomingOwnerKnown ? incomingOwner : existingOwner }
                  : {}),
                cloudSync: ownerChanged ? null : existing?.cloudSync ?? null,
                updatedAt: new Date().toISOString(),
              });
              return {
                status: 'saved' as const,
                total,
                saved: normalized.cards.length,
                pending: normalized.pending.length,
              };
            });
            if (result.status === 'owner-conflict') {
              sendJson(res, 409, { error: 'Device backup belongs to another account' });
              return;
            }
            broadcastChange({ total: result.total, saved: result.saved, pending: result.pending });
            sendJson(res, 200, { ok: true, total: result.total, saved: result.saved, pending: result.pending });
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
    esbuild: {
      legalComments: 'eof',
    },
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
      target: 'es2020',
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
