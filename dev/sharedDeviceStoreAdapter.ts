import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { Plugin } from 'vite';
import {
  compareStoredCardVersions,
  mergeCardsById,
  reconcileCardsByAuthoritativeWord,
} from './sharedDeviceStore';
import {
  deviceBackupHasStoredData,
  resolveDeviceBackupOwnership,
} from '../src/lib/deviceBackupOwnership';

type LocalRequestLike = {
  headers?: Record<string, string | string[] | undefined>;
  method?: string;
};

type UnknownRecord = Record<string, unknown>;

type LocalPendingOperation = UnknownRecord & {
  type?: unknown;
  cardId?: unknown;
  card?: unknown;
  fields?: unknown;
  fieldMask?: unknown;
  updatedAt?: unknown;
  ownerUserId?: unknown;
  opId?: unknown;
  libraryEpoch?: unknown;
  baseRevision?: unknown;
};

type LocalStoredCard = UnknownRecord & { id: string };

export type DeviceIdentityVerifier = (idToken: string) => Promise<string | null>;

export const createFirebaseIdTokenVerifier = (apiKey: string): DeviceIdentityVerifier => async idToken => {
  if (!apiKey || !idToken) return null;
  try {
    const response = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
      },
    );
    if (!response.ok) return null;
    const body = await response.json() as { users?: Array<{ localId?: unknown }> };
    const userId = body.users?.[0]?.localId;
    return typeof userId === 'string' && userId.length > 0 && userId.length <= 256 ? userId : null;
  } catch {
    return null;
  }
};

const isRecord = (value: unknown): value is UnknownRecord => Boolean(
  value && typeof value === 'object' && !Array.isArray(value),
);

const asRecord = (value: unknown): UnknownRecord => isRecord(value) ? value : {};

const isPendingOperation = (value: unknown): value is LocalPendingOperation => isRecord(value);

const pendingOperations = (value: unknown): LocalPendingOperation[] => (
  Array.isArray(value) ? value.filter(isPendingOperation) : []
);

const isStoredCard = (value: unknown): value is LocalStoredCard => (
  isRecord(value) && typeof value.id === 'string' && value.id.length > 0
);

const finiteNumber = (value: unknown): value is number => (
  typeof value === 'number' && Number.isFinite(value)
);

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

export const getPendingOperationCardId = (operation: LocalPendingOperation): string | null => {
  const card = asRecord(operation.card);
  const value = operation?.type === 'delete' || operation?.type === 'patch'
    ? operation?.cardId
    : card.id;
  return typeof value === 'string' && value ? value : null;
};

const pendingPatchFieldMask = (operation: LocalPendingOperation): string[] => {
  if (Array.isArray(operation?.fieldMask)) {
    return operation.fieldMask.filter((field: unknown): field is string => (
      typeof field === 'string' && field.length > 0
    ));
  }
  return operation?.fields && typeof operation.fields === 'object' && !Array.isArray(operation.fields)
    ? Object.keys(operation.fields)
    : [];
};

export const mergeLocalPendingOperations = (
  existingPending: readonly LocalPendingOperation[],
  incomingPending: readonly LocalPendingOperation[],
): LocalPendingOperation[] => {
  const commandsByCard = new Map<string, LocalPendingOperation[]>();
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
          fields: { ...asRecord(previous.fields), ...asRecord(operation.fields) },
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

const operationBoundary = (operation: LocalPendingOperation) => ({
  libraryEpoch: operation?.libraryEpoch,
  revision: operation?.baseRevision,
});

export const normalizeLocalDeviceBackup = (
  value: unknown,
  authoritativeCards: readonly unknown[] = [],
) => {
  const backup = asRecord(value);
  const cards = Array.isArray(backup.cards)
    ? backup.cards
    : Array.isArray(backup.items)
      ? backup.items
      : [];
  const pending = pendingOperations(backup.pending);
  const merged = new Map<string, LocalStoredCard>();
  cards.forEach((card: unknown) => {
    if (isStoredCard(card)) merged.set(card.id, card);
  });
  pending.forEach(operation => {
    const operationCard = asRecord(operation.card);
    const operationFields = asRecord(operation.fields);
    if (operation?.type === 'delete' && typeof operation.cardId === 'string') {
      const existingCard = merged.get(operation.cardId);
      if (existingCard && compareStoredCardVersions(existingCard, operationBoundary(operation)) <= 0) {
        merged.delete(operation.cardId);
      }
    } else if (operation?.type === 'upsert' && isStoredCard(operationCard)) {
      const existingCard = merged.get(operationCard.id);
      if (!existingCard || compareStoredCardVersions(existingCard, operationCard) <= 0) {
        merged.set(operationCard.id, operationCard);
      }
    } else if (operation?.type === 'patch' && typeof operation.cardId === 'string' && isRecord(operation.fields)) {
      const existingCard = merged.get(operation.cardId);
      if (existingCard && compareStoredCardVersions(existingCard, operationBoundary(operation)) <= 0) {
        merged.set(operation.cardId, {
          ...existingCard,
          ...operationFields,
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
  current: readonly LocalPendingOperation[],
  acknowledged: readonly LocalPendingOperation[],
): LocalPendingOperation[] => {
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
): unknown => {
  if (!fs.existsSync(filePath) && fs.existsSync(legacyFilePath)) {
    writeJsonFileAtomically(
      filePath,
      JSON.parse(fs.readFileSync(legacyFilePath, 'utf8')),
    );
  }
  return fs.existsSync(filePath)
    ? JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown
    : {};
};

export const sharedDeviceStorePlugin = (verifyIdentity: DeviceIdentityVerifier): Plugin => {
  const legacyBackupFile = path.resolve(process.cwd(), '.lingoflash-device-sync', 'cards.json');
  const backupDir = path.join(os.homedir(), '.lingoflash-device-sync');
  const backupFile = path.join(backupDir, 'lingoflash-2-cards.json');
  const pendingFlushLeases = new Map<string, number>();

  const sendJson = (res: ServerResponse<IncomingMessage>, statusCode: number, payload: unknown) => {
    res.statusCode = statusCode;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(payload));
  };

  const readBody = (req: IncomingMessage): Promise<string> => new Promise((resolve, reject) => {
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

  const isLocalRequest = (req: IncomingMessage) => {
    const address = String(req.socket?.remoteAddress || '');
    return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
  };

  const requireDeviceUser = async (
    req: IncomingMessage,
    res: ServerResponse<IncomingMessage>,
  ): Promise<string | null> => {
    if (!isLocalRequest(req) || !isTrustedLocalDeviceRequest(req)) {
      sendJson(res, 403, { error: 'Local device access denied' });
      return null;
    }
    const authorization = headerValue(req, 'authorization');
    const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? '';
    const userId = await verifyIdentity(token);
    if (!userId) sendJson(res, 401, { error: 'Firebase authentication is required' });
    return userId;
  };

  return {
    name: 'lingoflash-local-device-sync',
    configureServer(server) {
      server.middlewares.use('/api/device-cards/flush', async (req, res) => {
        try {
          const authenticatedUser = await requireDeviceUser(req, res);
          if (!authenticatedUser) return;
          if (req.method !== 'POST' && req.method !== 'DELETE') {
            sendJson(res, 405, { error: 'Method not allowed' });
            return;
          }
          const payload = asRecord(JSON.parse(await readBody(req)) as unknown);
          const userId = typeof payload?.userId === 'string' ? payload.userId.slice(0, 256) : '';
          if (!userId || userId !== authenticatedUser) {
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
          const authenticatedUser = await requireDeviceUser(req, res);
          if (!authenticatedUser) return;
          if (req.method !== 'POST' && req.method !== 'PUT') {
            sendJson(res, 405, { error: 'Method not allowed' });
            return;
          }
          const payload = asRecord(JSON.parse(await readBody(req)) as unknown);
          const userId = typeof payload?.userId === 'string' ? payload.userId.slice(0, 256) : '';
          const expectedTotal = finiteNumber(payload.expectedTotal) ? Math.max(0, Math.min(5000, Math.floor(payload.expectedTotal))) : 0;
          if (!userId || userId !== authenticatedUser || expectedTotal <= 0) {
            sendJson(res, 400, { error: 'userId and expectedTotal are required' });
            return;
          }
          const result = await withLocalDeviceBackupLock(backupFile, () => {
            const stored = readJsonFileWithMigration(backupFile, legacyBackupFile);
            const existing = asRecord(stored);
            const ownership = resolveDeviceBackupOwnership(stored);
            if (
              ownership.conflicted
              || (ownership.ownerUserId === undefined && deviceBackupHasStoredData(stored))
              || hasDeviceAckOwnerConflict(ownership.ownerUserId, userId)
            ) {
              return { status: 'owner-conflict' as const };
            }
            const existingCards = normalizeLocalDeviceBackup(existing).cards;
            const previousSync = isRecord(existing.cloudSync) ? existing.cloudSync : null;
            const now = new Date();

            if (req.method === 'POST') {
              const previousAttempt = typeof previousSync?.attemptedAt === 'string'
                ? Date.parse(previousSync.attemptedAt)
                : 0;
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
            const loaded = finiteNumber(payload.loaded) ? Math.max(0, Math.floor(payload.loaded)) : existingCards.length;
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
          const authenticatedUser = await requireDeviceUser(req, res);
          if (!authenticatedUser) return;
          if (req.method !== 'PUT') {
            sendJson(res, 405, { error: 'Method not allowed' });
            return;
          }
          const payload = asRecord(JSON.parse(await readBody(req)) as unknown);
          const userId = typeof payload?.userId === 'string' ? payload.userId.slice(0, 256) : '';
          const cardId = typeof payload?.cardId === 'string' ? payload.cardId.slice(0, 512) : '';
          const maximum = asRecord(payload.maximum);
          const maximumEpoch = Number.isSafeInteger(maximum.libraryEpoch)
            && Number(maximum.libraryEpoch) >= 0
            ? Number(maximum.libraryEpoch)
            : 0;
          const maximumRevision = Number.isSafeInteger(maximum.revision)
            && Number(maximum.revision) >= 0
            ? Number(maximum.revision)
            : 0;
          if (!userId || userId !== authenticatedUser || !cardId) {
            sendJson(res, 400, { error: 'userId and cardId are required' });
            return;
          }
          const result = await withLocalDeviceBackupLock(backupFile, () => {
            const stored = readJsonFileWithMigration(backupFile, legacyBackupFile);
            const existing = asRecord(stored);
            const ownership = resolveDeviceBackupOwnership(stored);
            if (
              ownership.conflicted
              || (ownership.ownerUserId === undefined && deviceBackupHasStoredData(stored))
              || hasDeviceAckOwnerConflict(ownership.ownerUserId, userId)
            ) {
              return { status: 'owner-conflict' as const };
            }
            const cards = Array.isArray(existing.cards) ? existing.cards : [];
            const target = cards.find(card => isStoredCard(card) && card.id === cardId);
            const targetEpoch = isRecord(target) && Number.isSafeInteger(target.libraryEpoch) && Number(target.libraryEpoch) >= 0
              ? Number(target.libraryEpoch)
              : 0;
            const targetRevision = isRecord(target) && Number.isSafeInteger(target.revision) && Number(target.revision) >= 0
              ? Number(target.revision)
              : 0;
            const deleted = Boolean(target) && (
              targetEpoch < maximumEpoch
              || (targetEpoch === maximumEpoch && targetRevision <= maximumRevision)
            );
            if (!deleted) return { status: 'ok' as const, deleted: false };

            const remainingCards = cards.filter(card => !isStoredCard(card) || card.id !== cardId);
            const previousTotal = finiteNumber(existing.total)
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
          sendJson(res, 200, { ok: true, deleted: result.deleted });
        } catch (error) {
          sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
        }
      });

      server.middlewares.use('/api/device-cards/ack', async (req, res) => {
        try {
          const authenticatedUser = await requireDeviceUser(req, res);
          if (!authenticatedUser) return;
          if (req.method !== 'PUT') {
            sendJson(res, 405, { error: 'Method not allowed' });
            return;
          }
          const payload = asRecord(JSON.parse(await readBody(req)) as unknown);
          const userId = typeof payload?.userId === 'string'
            ? payload.userId.slice(0, 256)
            : '';
          if (!userId || userId !== authenticatedUser) {
            sendJson(res, 400, { error: 'userId required' });
            return;
          }
          const acknowledged = pendingOperations(payload.operations);
          if (acknowledged.some(operation => (
            typeof operation?.ownerUserId === 'string'
            && operation.ownerUserId !== userId
          ))) {
            sendJson(res, 400, { error: 'Operation owner mismatch' });
            return;
          }
          const result = await withLocalDeviceBackupLock(backupFile, () => {
            const stored = readJsonFileWithMigration(backupFile, legacyBackupFile);
            const existing = asRecord(stored);
            const existingPending = pendingOperations(existing.pending);
            const ownership = resolveDeviceBackupOwnership(stored);
            if (
              ownership.conflicted
              || (ownership.ownerUserId === undefined && deviceBackupHasStoredData(stored))
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
          sendJson(res, 200, { ok: true, pending: result.pending });
        } catch (error) {
          sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
        }
      });

      server.middlewares.use('/api/device-cards', async (req, res) => {
        try {
          const authenticatedUser = await requireDeviceUser(req, res);
          if (!authenticatedUser) return;
          if (req.method === 'GET') {
            const snapshot = await withLocalDeviceBackupLock(backupFile, () => ({
              exists: fs.existsSync(backupFile) || fs.existsSync(legacyBackupFile),
              existing: readJsonFileWithMigration(backupFile, legacyBackupFile),
            }));
            if (!snapshot.exists) {
              sendJson(res, 200, { cards: [], total: 0, updatedAt: null });
              return;
            }
            const existing = asRecord(snapshot.existing);
            const ownership = resolveDeviceBackupOwnership(snapshot.existing);
            if (ownership.conflicted || ownership.ownerUserId !== authenticatedUser) {
              sendJson(res, 409, { error: 'Device backup belongs to another account' });
              return;
            }
            const normalized = normalizeLocalDeviceBackup(snapshot.existing);
            sendJson(res, 200, {
              ...existing,
              cards: normalized.cards,
              total: Math.max(Number(existing?.total) || 0, normalized.cards.length),
              pending: normalized.pending,
            });
            return;
          }

          if (req.method === 'PUT') {
            const payload = asRecord(JSON.parse(await readBody(req)) as unknown);
            const incomingCards = (Array.isArray(payload?.cards) ? payload.cards : Array.isArray(payload?.items) ? payload.items : []).slice(0, 5000);
            const incomingOwnership = resolveDeviceBackupOwnership(payload);
            const incomingOwnerKnown = incomingOwnership.ownerUserId !== undefined;
            const incomingOwner = incomingOwnership.ownerUserId;
            if (!incomingOwnerKnown || incomingOwner !== authenticatedUser) {
              sendJson(res, 403, { error: 'Device backup owner must match the authenticated user' });
              return;
            }
            const result = await withLocalDeviceBackupLock(backupFile, () => {
              const stored = readJsonFileWithMigration(backupFile, legacyBackupFile);
              const existing = asRecord(stored);
              const existingOwnership = resolveDeviceBackupOwnership(stored);
              const claimsUnknownStoredData = incomingOwnerKnown
                && existingOwnership.ownerUserId === undefined
                && deviceBackupHasStoredData(stored);
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
              const existingPending = !ownerChanged ? pendingOperations(existing.pending) : [];
              const incomingPending = pendingOperations(payload.pending);
              const pending = isMerge
                ? mergeLocalPendingOperations(existingPending, incomingPending)
                : Array.isArray(payload?.pending)
                  ? incomingPending
                  : existingPending;
              const normalized = normalizeLocalDeviceBackup(
                { cards, pending },
                isReconcile ? incomingCards : [],
              );
              const requestedTotal = finiteNumber(payload.total) ? Math.floor(payload.total) : 0;
              const existingTotal = isMerge && !ownerChanged && finiteNumber(existing.total) ? Math.floor(existing.total) : 0;
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
