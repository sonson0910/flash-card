import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { Plugin } from 'vite';
import {
  compareStoredCardVersions,
  mergeCardsById,
  reconcileCardsByAuthoritativeWord,
} from '../src/lib/deviceStore';
import {
  deviceBackupHasStoredData,
  resolveDeviceBackupOwnership,
} from '../src/lib/deviceBackupOwnership';

type LocalRequestLike = {
  headers?: Record<string, string | string[] | undefined>;
  method?: string;
  url?: string;
};

export const DEVICE_CAPABILITY_COOKIE_NAME = 'lingoflash_device_capability';
export const DEVICE_REQUEST_MAX_BODY_BYTES = 25 * 1024 * 1024;
export const DEVICE_COLLECTION_MAX_SIZE = 5_000;
export const DEVICE_FLUSH_LEASE_MAX_ENTRIES = 64;
export const DEVICE_FLUSH_LEASE_MS = 2 * 60 * 1000;
export const DEVICE_EVENT_CLIENT_MAX = 8;
export const DEVICE_EVENT_CLIENT_MAX_LIFETIME_MS = 10 * 60 * 1000;
export const DEVICE_RECORD_MAX_SERIALIZED_BYTES = 64 * 1024;
export const DEVICE_SERIALIZED_BACKUP_MAX_BYTES = DEVICE_REQUEST_MAX_BODY_BYTES;

class LocalDeviceRequestError extends Error {
  constructor(
    readonly statusCode: 400 | 413 | 500,
    message: string,
  ) {
    super(message);
    this.name = 'LocalDeviceRequestError';
  }
}

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

const validateSerializedRecords = (
  value: unknown,
  key: string,
  tooManyStatus: 400 | 413,
  invalidRecordStatus: 400 | 500,
): void => {
  if (!Array.isArray(value)) return;
  if (value.length > DEVICE_COLLECTION_MAX_SIZE) {
    throw new LocalDeviceRequestError(tooManyStatus, `Too many ${key} records.`);
  }
  value.forEach(record => {
    if (!isRecord(record)) throw new LocalDeviceRequestError(invalidRecordStatus, `Invalid ${key} record.`);
    const serialized = JSON.stringify(record);
    if (typeof serialized !== 'string') throw new LocalDeviceRequestError(invalidRecordStatus, `Invalid ${key} record.`);
    if (Buffer.byteLength(serialized, 'utf8') > DEVICE_RECORD_MAX_SERIALIZED_BYTES) {
      throw new LocalDeviceRequestError(413, `${key} record is too large.`);
    }
  });
};

export const serializeLocalDeviceBackup = (
  value: unknown,
  maxBytes = DEVICE_SERIALIZED_BACKUP_MAX_BYTES,
  tooManyStatus: 400 | 413 = 413,
  invalidRecordStatus: 400 | 500 = 500,
): string => {
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new LocalDeviceRequestError(500, 'Device backup is not serializable.');
  }
  if (typeof serialized !== 'string') throw new LocalDeviceRequestError(500, 'Device backup is not serializable.');
  if (Buffer.byteLength(serialized, 'utf8') > maxBytes) {
    throw new LocalDeviceRequestError(413, 'Serialized device backup is too large.');
  }
  if (isRecord(value)) {
    validateSerializedRecords(value.cards, 'card', tooManyStatus, invalidRecordStatus);
    validateSerializedRecords(value.items, 'item', tooManyStatus, invalidRecordStatus);
    validateSerializedRecords(value.pending, 'pending operation', tooManyStatus, invalidRecordStatus);
    validateSerializedRecords(value.operations, 'acknowledged operation', tooManyStatus, invalidRecordStatus);
  }
  return serialized;
};

export const validateLocalDeviceBackupValue = <T>(
  value: T,
  maxBytes = DEVICE_SERIALIZED_BACKUP_MAX_BYTES,
  tooManyStatus: 400 | 413 = 413,
  invalidRecordStatus: 400 | 500 = 500,
): T => {
  serializeLocalDeviceBackup(value, maxBytes, tooManyStatus, invalidRecordStatus);
  return value;
};

export const clampDeviceCount = (value: unknown, fallback = 0): number => (
  finiteNumber(value)
    ? Math.min(DEVICE_COLLECTION_MAX_SIZE, Math.max(0, Math.floor(value)))
    : fallback
);

const clampCloudSyncCounts = (value: unknown): unknown => {
  if (!isRecord(value)) return value;
  return {
    ...value,
    ...(Object.prototype.hasOwnProperty.call(value, 'expectedTotal')
      ? { expectedTotal: clampDeviceCount(value.expectedTotal) }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(value, 'loaded')
      ? { loaded: clampDeviceCount(value.loaded) }
      : {}),
  };
};

const headerValue = (request: LocalRequestLike, name: string) => {
  const value = request.headers?.[name];
  return Array.isArray(value) ? value[0] : value;
};

const isAllowedLocalHost = (host: string | undefined): boolean => {
  if (!host) return false;
  try {
    const parsed = new URL(`http://${host}`);
    return !parsed.username
      && !parsed.password
      && parsed.host === host
      && ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
  } catch {
    return false;
  }
};

const hasMatchingOrigin = (request: LocalRequestLike, host: string | undefined): boolean => {
  const origin = headerValue(request, 'origin');
  if (!origin || !host) return true;
  try {
    const parsedOrigin = new URL(origin);
    return ['http:', 'https:'].includes(parsedOrigin.protocol) && parsedOrigin.host === host;
  } catch {
    return false;
  }
};

export const isTrustedLocalDeviceRequest = (request: LocalRequestLike): boolean => {
  const host = headerValue(request, 'host');
  const fetchSite = headerValue(request, 'sec-fetch-site');
  if (!host || fetchSite !== 'same-origin') return false;
  if (!isAllowedLocalHost(host) || !hasMatchingOrigin(request, host)) return false;
  const method = String(request.method || 'GET').toUpperCase();
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) return true;
  return headerValue(request, 'content-type')?.toLocaleLowerCase('en-US').startsWith('application/json') === true;
};

export const isTrustedLocalHtmlBootstrapRequest = (request: LocalRequestLike): boolean => {
  const host = headerValue(request, 'host');
  const fetchSite = headerValue(request, 'sec-fetch-site');
  return String(request.method || 'GET').toUpperCase() === 'GET'
    && isAllowedLocalHost(host)
    && hasMatchingOrigin(request, host)
    && (fetchSite === 'same-origin' || fetchSite === 'none')
    && headerValue(request, 'sec-fetch-mode') === 'navigate'
    && headerValue(request, 'sec-fetch-dest') === 'document'
    && headerValue(request, 'accept')?.toLocaleLowerCase('en-US').includes('text/html') === true;
};

export const createDeviceCapabilityCookie = (token: string): string => (
  `${DEVICE_CAPABILITY_COOKIE_NAME}=${token}; Path=/api/device-cards; HttpOnly; SameSite=Strict`
);

export const isDeviceCapabilityCookieValid = (
  cookieHeader: string | undefined,
  expectedToken: string,
): boolean => {
  const expected = Buffer.from(expectedToken, 'utf8');
  if (expected.length === 0) return false;
  return String(cookieHeader || '').split(';').some(cookie => {
    const separator = cookie.indexOf('=');
    if (separator < 0 || cookie.slice(0, separator).trim() !== DEVICE_CAPABILITY_COOKIE_NAME) return false;
    const candidate = Buffer.from(cookie.slice(separator + 1).trim(), 'utf8');
    return candidate.length === expected.length && timingSafeEqual(candidate, expected);
  });
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

export interface PendingFlushLease {
  ownerToken: string;
  expiresAt: number;
}

const createPendingFlushLeaseToken = (): string => randomBytes(32).toString('base64url');

export const grantPendingFlushLease = (
  leases: Map<string, PendingFlushLease>,
  userId: string,
  now: number,
  _force: boolean,
): string | false => {
  leases.forEach((lease, key) => {
    if (!(lease && Number.isFinite(lease.expiresAt) && lease.expiresAt > now)) leases.delete(key);
  });
  if (leases.has(userId)) return false;
  if (leases.size >= DEVICE_FLUSH_LEASE_MAX_ENTRIES) return false;
  const leaseToken = createPendingFlushLeaseToken();
  leases.set(userId, { ownerToken: leaseToken, expiresAt: now + DEVICE_FLUSH_LEASE_MS });
  return leaseToken;
};

export const renewPendingFlushLease = (
  leases: Map<string, PendingFlushLease>,
  userId: string,
  leaseToken: string,
  now: number,
): boolean => {
  const lease = leases.get(userId);
  if (!lease || lease.ownerToken !== leaseToken) return false;
  if (!Number.isFinite(lease.expiresAt) || lease.expiresAt <= now) return false;
  leases.set(userId, { ...lease, expiresAt: now + DEVICE_FLUSH_LEASE_MS });
  return true;
};

export const releasePendingFlushLease = (
  leases: Map<string, PendingFlushLease>,
  userId: string,
  leaseToken: string,
): boolean => {
  const lease = leases.get(userId);
  if (!lease || lease.ownerToken !== leaseToken) return false;
  leases.delete(userId);
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
  const serialized = serializeLocalDeviceBackup(value);
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
    fs.writeFileSync(temporaryFile, serialized, {
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
  const readBoundedJsonFile = (candidatePath: string): unknown => {
    const stat = fs.statSync(candidatePath);
    if (stat.size > DEVICE_SERIALIZED_BACKUP_MAX_BYTES) {
      throw new LocalDeviceRequestError(413, 'Stored device backup is too large.');
    }
    const parsed = JSON.parse(fs.readFileSync(candidatePath, 'utf8')) as unknown;
    return validateLocalDeviceBackupValue(parsed);
  };
  if (!fs.existsSync(filePath) && fs.existsSync(legacyFilePath)) {
    const legacy = readBoundedJsonFile(legacyFilePath);
    writeJsonFileAtomically(filePath, legacy);
    return legacy;
  }
  return fs.existsSync(filePath) ? readBoundedJsonFile(filePath) : {};
};

export const sharedDeviceStorePlugin = (): Plugin => {
  const legacyBackupFile = path.resolve(process.cwd(), '.lingoflash-device-sync', 'cards.json');
  const backupDir = path.join(os.homedir(), '.lingoflash-device-sync');
  const backupFile = path.join(backupDir, 'lingoflash-2-cards.json');
  const eventClients = new Set<ServerResponse<IncomingMessage>>();
  const eventClientCleanup = new Map<ServerResponse<IncomingMessage>, () => void>();
  const pendingFlushLeases = new Map<string, PendingFlushLease>();

  const sendJson = (res: ServerResponse<IncomingMessage>, statusCode: number, payload: unknown) => {
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
        eventClientCleanup.get(client)?.();
      }
    });
  };

  const readBody = (req: IncomingMessage): Promise<string> => new Promise((resolve, reject) => {
    const contentLength = headerValue(req, 'content-length');
    if (contentLength !== undefined) {
      if (!/^\d+$/.test(contentLength)) {
        req.resume();
        reject(new LocalDeviceRequestError(400, 'Invalid Content-Length.'));
        return;
      }
      const declaredLength = Number(contentLength);
      if (!Number.isSafeInteger(declaredLength) || declaredLength > DEVICE_REQUEST_MAX_BODY_BYTES) {
        req.resume();
        reject(new LocalDeviceRequestError(413, 'Request body is too large.'));
        return;
      }
    }

    const chunks: Buffer[] = [];
    let byteLength = 0;
    let settled = false;
    const rejectOnce = (error: Error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    req.on('data', (chunk: Buffer | string) => {
      if (settled) return;
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      byteLength += bytes.byteLength;
      if (byteLength > DEVICE_REQUEST_MAX_BODY_BYTES) {
        rejectOnce(new LocalDeviceRequestError(413, 'Request body is too large.'));
        req.resume();
        return;
      }
      chunks.push(bytes);
    });
    req.on('end', () => {
      if (!settled) {
        settled = true;
        resolve(Buffer.concat(chunks).toString('utf8'));
      }
    });
    req.on('error', error => rejectOnce(error));
  });

  const readJsonBody = async (req: IncomingMessage): Promise<unknown> => {
    const body = await readBody(req);
    try {
      return JSON.parse(body) as unknown;
    } catch {
      throw new LocalDeviceRequestError(400, 'Malformed JSON.');
    }
  };

  const requestErrorStatus = (error: unknown): number => (
    error instanceof LocalDeviceRequestError ? error.statusCode : 500
  );

  const isLocalRequest = (req: IncomingMessage) => {
    const address = String(req.socket?.remoteAddress || '');
    return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
  };

  return {
    name: 'lingoflash-local-device-sync',
    configureServer(server) {
      // This browser capability prevents cross-site web requests; privileged
      // local processes still require OS-level trust and are out of scope.
      const capabilityToken = randomBytes(32).toString('base64url');
      server.middlewares.use((req, res, next) => {
        if (isLocalRequest(req) && isTrustedLocalHtmlBootstrapRequest(req)) {
          res.setHeader('Set-Cookie', createDeviceCapabilityCookie(capabilityToken));
        }
        next();
      });

      server.middlewares.use('/api/device-cards', (req, res, next) => {
        if (!isLocalRequest(req) || !isTrustedLocalDeviceRequest(req)) {
          sendJson(res, 403, { error: 'Trusted local same-origin access only' });
          return;
        }
        if (!isDeviceCapabilityCookieValid(headerValue(req, 'cookie'), capabilityToken)) {
          sendJson(res, 401, { error: 'Device capability is required' });
          return;
        }
        next();
      });

      server.middlewares.use('/api/device-cards/events', (req, res) => {
        if (!isLocalRequest(req) || !isTrustedLocalDeviceRequest(req)) {
          sendJson(res, 403, { error: 'Trusted local same-origin access only' });
          return;
        }
        if (req.method !== 'GET') {
          sendJson(res, 405, { error: 'Method not allowed' });
          return;
        }
        if (eventClients.size >= DEVICE_EVENT_CLIENT_MAX) {
          sendJson(res, 429, { error: 'Too many device event clients' });
          return;
        }
        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache, no-transform');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders?.();
        res.write('event: ready\ndata: {}\n\n');
        eventClients.add(res);
        const keepAliveId = setInterval(() => {
          try {
            res.write(': keep-alive\n\n');
          } catch {
            eventClientCleanup.get(res)?.();
          }
        }, 15000);
        const lifetimeId = setTimeout(() => {
          eventClientCleanup.get(res)?.();
          res.end();
        }, DEVICE_EVENT_CLIENT_MAX_LIFETIME_MS);
        const cleanup = () => {
          clearInterval(keepAliveId);
          clearTimeout(lifetimeId);
          eventClients.delete(res);
          eventClientCleanup.delete(res);
        };
        eventClientCleanup.set(res, cleanup);
        req.on('close', cleanup);
        res.on('close', cleanup);
      });

      server.middlewares.use('/api/device-cards/flush', async (req, res) => {
        try {
          if (!isLocalRequest(req) || !isTrustedLocalDeviceRequest(req)) {
            sendJson(res, 403, { error: 'Trusted local same-origin access only' });
            return;
          }
    if (req.method !== 'POST' && req.method !== 'PUT' && req.method !== 'DELETE') {
            sendJson(res, 405, { error: 'Method not allowed' });
            return;
          }
          const payload = validateLocalDeviceBackupValue(
            asRecord(await readJsonBody(req)),
            DEVICE_SERIALIZED_BACKUP_MAX_BYTES,
            400,
            400,
          );
          const userId = typeof payload?.userId === 'string' ? payload.userId.slice(0, 256) : '';
          if (!userId) {
            sendJson(res, 400, { error: 'userId is required' });
            return;
          }
    if (req.method === 'DELETE') {
      const leaseToken = typeof payload?.leaseToken === 'string' ? payload.leaseToken : '';
      if (!leaseToken) {
        sendJson(res, 400, { error: 'leaseToken required' });
        return;
      }
      if (!releasePendingFlushLease(pendingFlushLeases, userId, leaseToken)) {
        sendJson(res, 409, { error: 'Lease owner mismatch', ok: false });
        return;
      }
      sendJson(res, 200, { ok: true });
      return;
    }
    if (req.method === 'PUT') {
      const leaseToken = typeof payload?.leaseToken === 'string' ? payload.leaseToken : '';
      if (!leaseToken) {
        sendJson(res, 400, { error: 'leaseToken required' });
        return;
      }
      if (!renewPendingFlushLease(pendingFlushLeases, userId, leaseToken, Date.now())) {
        sendJson(res, 409, { error: 'Lease owner mismatch', ok: false });
        return;
      }
      sendJson(res, 200, { ok: true });
      return;
    }
    const leaseToken = grantPendingFlushLease(
      pendingFlushLeases,
      userId,
      Date.now(),
      payload?.force === true,
    );
    sendJson(res, 200, {
      granted: leaseToken !== false,
      ...(leaseToken !== false ? { leaseToken } : {}),
    });
        } catch (error) {
          sendJson(res, requestErrorStatus(error), { error: error instanceof Error ? error.message : String(error) });
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
          const payload = validateLocalDeviceBackupValue(
            asRecord(await readJsonBody(req)),
            DEVICE_SERIALIZED_BACKUP_MAX_BYTES,
            400,
            400,
          );
          const userId = typeof payload?.userId === 'string' ? payload.userId.slice(0, 256) : '';
          const expectedTotal = clampDeviceCount(payload.expectedTotal);
          if (!userId || expectedTotal <= 0) {
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
            validateLocalDeviceBackupValue({ cards: existingCards });
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
                loaded: clampDeviceCount(existingCards.length),
                attemptedAt: now.toISOString(),
              };
              writeJsonFileAtomically(backupFile, { ...existing, ownerUserId: userId, cloudSync });
              return { status: 'granted' as const, cloudSync };
            }

            const status = ['syncing', 'complete', 'paused'].includes(String(payload?.status)) ? payload.status : 'paused';
            const loaded = clampDeviceCount(payload.loaded, clampDeviceCount(existingCards.length));
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
          sendJson(res, requestErrorStatus(error), { error: error instanceof Error ? error.message : String(error) });
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
          const payload = validateLocalDeviceBackupValue(
            asRecord(await readJsonBody(req)),
            DEVICE_SERIALIZED_BACKUP_MAX_BYTES,
            400,
            400,
          );
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
          if (!userId || !cardId) {
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
            const previousTotal = clampDeviceCount(existing.total, clampDeviceCount(cards.length));
            const total = clampDeviceCount(Math.max(remainingCards.length, previousTotal - 1));
            const pending = clampDeviceCount(Array.isArray(existing?.pending) ? existing.pending.length : 0);
            writeJsonFileAtomically(backupFile, {
              ...existing,
              cards: remainingCards,
              total,
              updatedAt: new Date().toISOString(),
            });
            return {
              status: 'ok' as const,
              deleted: true,
              change: { total, saved: clampDeviceCount(remainingCards.length), pending },
            };
          });
          if (result.status === 'owner-conflict') {
            sendJson(res, 409, { error: 'Device backup belongs to another account' });
            return;
          }
          if (result.deleted) broadcastChange(result.change);
          sendJson(res, 200, { ok: true, deleted: result.deleted });
        } catch (error) {
          sendJson(res, requestErrorStatus(error), { error: error instanceof Error ? error.message : String(error) });
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
          const payload = validateLocalDeviceBackupValue(
            asRecord(await readJsonBody(req)),
            DEVICE_SERIALIZED_BACKUP_MAX_BYTES,
            400,
            400,
          );
          const userId = typeof payload?.userId === 'string'
            ? payload.userId.slice(0, 256)
            : '';
          if (!userId) {
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
              pending: clampDeviceCount(pending.length),
              total: clampDeviceCount(existing?.total),
              saved: clampDeviceCount(Array.isArray(existing?.cards) ? existing.cards.length : 0),
            };
          });
          if (result.status === 'owner-conflict') {
            sendJson(res, 409, { error: 'Device backup belongs to another account' });
            return;
          }
          broadcastChange({ total: result.total, saved: result.saved, pending: result.pending });
          sendJson(res, 200, { ok: true, pending: result.pending });
        } catch (error) {
          sendJson(res, requestErrorStatus(error), { error: error instanceof Error ? error.message : String(error) });
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
            const existing = asRecord(snapshot.existing);
            const normalized = normalizeLocalDeviceBackup(snapshot.existing);
            validateLocalDeviceBackupValue({ cards: normalized.cards, pending: normalized.pending });
            sendJson(res, 200, {
              ...existing,
              cards: normalized.cards,
              total: clampDeviceCount(Math.max(Number(existing?.total) || 0, normalized.cards.length)),
              pending: normalized.pending,
              cloudSync: clampCloudSyncCounts(existing.cloudSync),
            });
            return;
          }

          if (req.method === 'PUT') {
            const payload = validateLocalDeviceBackupValue(
              asRecord(await readJsonBody(req)),
              DEVICE_SERIALIZED_BACKUP_MAX_BYTES,
              400,
              400,
            );
            const incomingCards = Array.isArray(payload?.cards)
              ? payload.cards
              : Array.isArray(payload?.items)
                ? payload.items
                : [];
            const incomingOwnership = resolveDeviceBackupOwnership(payload);
            const incomingOwnerKnown = incomingOwnership.ownerUserId !== undefined;
            const incomingOwner = incomingOwnership.ownerUserId;
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
              const existingCards = !ownerChanged && Array.isArray(existing?.cards) ? existing.cards : [];
              const isReconcile = payload?.mode === 'reconcile';
              const isMerge = payload?.mode === 'merge' || isReconcile;
              const cards = isReconcile
                ? reconcileCardsByAuthoritativeWord(existingCards, incomingCards)
                : isMerge
                  ? mergeCardsById(existingCards, incomingCards)
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
              validateLocalDeviceBackupValue({ cards: normalized.cards, pending: normalized.pending });
              const requestedTotal = clampDeviceCount(payload.total);
              const existingTotal = isMerge && !ownerChanged ? clampDeviceCount(existing.total) : 0;
              const total = clampDeviceCount(Math.max(normalized.cards.length, requestedTotal, existingTotal));
              writeJsonFileAtomically(backupFile, {
                cards: normalized.cards,
                total,
                pending: normalized.pending,
                ...(incomingOwnerKnown || existingOwner !== undefined
                  ? { ownerUserId: incomingOwnerKnown ? incomingOwner : existingOwner }
                  : {}),
                cloudSync: ownerChanged ? null : clampCloudSyncCounts(existing?.cloudSync ?? null),
                updatedAt: new Date().toISOString(),
              });
              return {
                status: 'saved' as const,
                total,
                saved: clampDeviceCount(normalized.cards.length),
                pending: clampDeviceCount(normalized.pending.length),
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
          sendJson(res, requestErrorStatus(error), { error: error instanceof Error ? error.message : String(error) });
        }
      });
    },
  };
};
