import type { CardData } from '../types/card';
import { withTimeout } from './async';
import {
  acquireStoredPendingFlushLease,
  assertStoredPendingFlushLease,
  releaseStoredPendingFlushLease,
  renewStoredPendingFlushLease,
  updateStoredPendingOperations,
} from './pendingOperationStore';
import {
  selectMutableCardPatch,
  type CardMutationKind,
} from './cardMutationProtocol';
import { resolveDeviceBackupOwnership } from './deviceBackupOwnership';

export interface DeviceCardBackup {
  cards: CardData[];
  total: number;
  updatedAt: string | null;
  pending: DevicePendingOperation[];
  cloudSync: DeviceCloudSyncState | null;
  ownerUserId?: string | null;
}

export interface DeviceCloudSyncState {
  userId: string;
  status: 'syncing' | 'complete' | 'paused';
  expectedTotal: number;
  loaded: number;
  attemptedAt: string;
}

const DEVICE_CARDS_ENDPOINT = '/api/device-cards';
const DEVICE_CARDS_EVENTS_ENDPOINT = '/api/device-cards/events';
const DEVICE_CARDS_FLUSH_ENDPOINT = '/api/device-cards/flush';
const DEVICE_SYNC_AVAILABLE = import.meta.env.DEV;
const DEVICE_REQUEST_TIMEOUT_MS = 3_000;

export class DeviceBackupOwnerConflictError extends Error {
  constructor() {
    super('The shared device backup belongs to another account.');
    this.name = 'DeviceBackupOwnerConflictError';
  }
}

function fetchDeviceEndpoint(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  return withTimeout(
    fetch(input, { ...init, signal: controller.signal }),
    DEVICE_REQUEST_TIMEOUT_MS,
    'The shared device store did not respond in time.',
    () => controller.abort(),
  );
}

interface DeviceOperationMetadata {
  /** Stable idempotency key. Optional only for persisted v1 operations. */
  opId?: string;
  /** Canonical v2 operation. `type: upsert` remains as a v1 compatibility alias for create. */
  operation?: CardMutationKind;
  baseRevision?: number;
  fieldMask?: (keyof CardData)[];
  libraryEpoch?: number;
  updatedAt: string;
  ownerUserId?: string;
  /** Persisted, idempotent reward for a review which commits after a restart. */
  reviewEffect?: DeviceReviewEffect;
}

export interface DeviceReviewEffect {
  xp: 2;
}

export type DevicePendingOperation =
  | (DeviceOperationMetadata & { type: 'upsert'; card: CardData })
  | (DeviceOperationMetadata & { type: 'patch'; cardId: string; fields: Partial<CardData> })
  | (DeviceOperationMetadata & { type: 'delete'; cardId: string });

export interface DeviceCardPatch {
  card: CardData;
  fields: Partial<CardData>;
  operation?: Extract<CardMutationKind, 'patch' | 'review'>;
  reviewEffect?: DeviceReviewEffect;
}

export function resolveDeviceBackupOwner(
  explicitOwnerUserId: string | null | undefined,
  cloudSyncUserId: string | null,
  pending: DevicePendingOperation[],
): string | null | undefined {
  const ownership = resolveDeviceBackupOwnership({
    ...(explicitOwnerUserId !== undefined ? { ownerUserId: explicitOwnerUserId } : {}),
    ...(cloudSyncUserId !== null ? { cloudSync: { userId: cloudSyncUserId } } : {}),
    pending,
  });
  return ownership.conflicted ? undefined : ownership.ownerUserId;
}

const browserPendingKey = (userId: string) => `lingoflash_pending_writes_${encodeURIComponent(userId)}`;
const PENDING_FLUSH_LEASE_MS = 30_000;

export function loadBrowserPending(userId: string): DevicePendingOperation[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const value = JSON.parse(localStorage.getItem(browserPendingKey(userId)) ?? '[]') as unknown;
    return Array.isArray(value)
      ? value.flatMap(operation => {
          const normalized = normalizePendingOperation(operation);
          return normalized ? [normalized] : [];
        })
      : [];
  } catch {
    try {
      localStorage.removeItem(browserPendingKey(userId));
    } catch {
      // IndexedDB remains available even when browser compatibility storage is blocked.
    }
    return [];
  }
}

function operationTarget(operation: DevicePendingOperation): string {
  return operation.type === 'upsert' ? operation.card.id : operation.cardId;
}

let fallbackOperationSequence = 0;

function createOperationId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  fallbackOperationSequence += 1;
  return `op-${Date.now().toString(36)}-${fallbackOperationSequence.toString(36)}`;
}

function operationFieldMask(fields: Partial<CardData>): (keyof CardData)[] {
  const candidates = Object.keys(fields) as (keyof CardData)[];
  return Object.keys(selectMutableCardPatch(fields, candidates)) as (keyof CardData)[];
}

export function mergePendingOperations(operations: DevicePendingOperation[]): DevicePendingOperation[] {
  const commandsByCard = new Map<string, DevicePendingOperation[]>();
  operations
    .map((operation, index) => ({ operation, index }))
    .sort((left, right) => left.operation.updatedAt.localeCompare(right.operation.updatedAt) || left.index - right.index)
    .forEach(({ operation }) => {
    const key = `${operation.ownerUserId ?? ''}:${operationTarget(operation)}`;
    const commands = commandsByCard.get(key) ?? [];
    const existing = commands.at(-1);
    if (!existing) {
      commandsByCard.set(key, [operation]);
      return;
    }
    if (existing.type === 'delete') {
      if (operation.type === 'upsert' && operation.updatedAt >= existing.updatedAt) {
        commandsByCard.set(key, [operation]);
      }
      return;
    }
    if (operation.type === 'delete') {
      commandsByCard.set(key, [operation]);
      return;
    }
    if (existing.type === 'upsert' && operation.type === 'patch') {
      // Keep create and patch as separate commands. Folding the patch into the
      // full card would turn a safe field update into an unsafe full-card retry.
      commandsByCard.set(key, [...commands, operation]);
      return;
    }
    if (existing.type === 'patch' && operation.type === 'patch') {
      // Reviews carry an append-only history and server receipt. Never fold
      // them into another review or a normal patch: each operation must reach
      // the protected callable in order.
      if (existing.operation === 'review' || operation.operation === 'review') {
        commandsByCard.set(key, [...commands, operation]);
        return;
      }
      const fieldMask = existing.fieldMask || operation.fieldMask
        ? [...new Set([
            ...(existing.fieldMask ?? operationFieldMask(existing.fields)),
            ...(operation.fieldMask ?? operationFieldMask(operation.fields)),
          ])]
        : undefined;
      commandsByCard.set(key, [...commands.slice(0, -1), {
        ...operation,
        fields: { ...existing.fields, ...operation.fields },
        ...(fieldMask ? { fieldMask } : {}),
      }]);
      return;
    }
    commandsByCard.set(key, [operation]);
  });
  return [...commandsByCard.values()]
    .flat()
    .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt));
}

function replaceBrowserPending(userId: string, operations: DevicePendingOperation[]): void {
  if (typeof localStorage === 'undefined') return;
  try {
    if (operations.length > 0) localStorage.setItem(browserPendingKey(userId), JSON.stringify(operations));
    else localStorage.removeItem(browserPendingKey(userId));
  } catch {
    // IndexedDB is the durable source of truth; this is a secondary compatibility mirror.
  }
}

function scopePendingOperation(
  operation: DevicePendingOperation,
  userId: string,
): DevicePendingOperation | null {
  if (operation.ownerUserId && operation.ownerUserId !== userId) return null;
  return { ...operation, ownerUserId: userId };
}

function readCompatibilityPending(userId: string): DevicePendingOperation[] {
  // Denied/corrupt storage must not be acknowledged as an empty legacy queue.
  try {
    const raw: unknown = JSON.parse(globalThis.localStorage?.getItem(browserPendingKey(userId)) ?? '[]');
    if (!Array.isArray(raw)) throw new Error();
    return raw.flatMap(value => {
      const operation = normalizePendingOperation(value);
      if (!operation) throw new Error();
      const scoped = scopePendingOperation(operation, userId);
      return scoped ? [scoped] : [];
    });
  } catch {
    throw new Error('Local sync storage could not be read. Allow site storage and retry; pending changes were retained.');
  }
}

async function updateDevicePending(
  userId: string,
  update: (current: DevicePendingOperation[]) => DevicePendingOperation[],
): Promise<DevicePendingOperation[]> {
  const next = await updateStoredPendingOperations(userId, update, () => readCompatibilityPending(userId));
  replaceBrowserPending(userId, next);
  return next;
}

async function persistDevicePending(
  userId: string,
  operations: DevicePendingOperation[],
): Promise<DevicePendingOperation[]> {
  return updateDevicePending(userId, current =>
    mergePendingOperations([
      ...current.flatMap(operation => {
        const normalized = normalizePendingOperation(operation);
        if (!normalized) return [];
        const scoped = scopePendingOperation(normalized, userId);
        return scoped ? [scoped] : [];
      }),
      ...operations,
    ]));
}

export async function loadDevicePending(userId: string): Promise<DevicePendingOperation[]> {
  const deviceBackup = await loadDeviceCards();
  const shared = deviceBackup?.ownerUserId === userId
    ? deviceBackup.pending.flatMap(operation => {
        const scoped = scopePendingOperation(operation, userId);
        return scoped ? [scoped] : [];
      })
    : [];
  // The dev server is already durable. Its read snapshot must never be copied
  // back into the browser's queue: ACK may have completed while the read waited.
  return mergePendingOperations([...(await persistDevicePending(userId, [])), ...shared]);
}

export async function clearDevicePending(userId: string): Promise<void> {
  await updateDevicePending(userId, () => []);
}

export async function loadDeviceCards(): Promise<DeviceCardBackup | null> {
  if (!DEVICE_SYNC_AVAILABLE) return null;
  try {
    const response = await fetchDeviceEndpoint(DEVICE_CARDS_ENDPOINT, { cache: 'no-store' });
    if (!response.ok) return null;
    const data = await response.json();
    const cards = Array.isArray(data?.cards) ? data.cards : Array.isArray(data?.items) ? data.items : [];
    const pending = Array.isArray(data?.pending)
      ? data.pending.flatMap((operation: unknown) => {
          const normalized = normalizePendingOperation(operation);
          return normalized ? [normalized] : [];
        })
      : [];
    const hasExplicitOwner = Object.prototype.hasOwnProperty.call(data ?? {}, 'ownerUserId');
    const explicitOwner = hasExplicitOwner
      ? typeof data.ownerUserId === 'string'
        ? data.ownerUserId
        : data.ownerUserId === null
          ? null
          : undefined
      : undefined;
    const cloudSync = isCloudSyncState(data?.cloudSync) ? data.cloudSync : null;
    return {
      cards,
      total: Number.isFinite(data?.total) ? Math.max(cards.length, Math.floor(data.total)) : cards.length,
      updatedAt: typeof data?.updatedAt === 'string' ? data.updatedAt : null,
      pending,
      cloudSync,
      ownerUserId: resolveDeviceBackupOwner(explicitOwner, cloudSync?.userId ?? null, pending),
    };
  } catch {
    return null;
  }
}

async function requestDeviceCardSave(
  cards: CardData[],
  total = cards.length,
  pending?: DevicePendingOperation[],
  mode: 'replace' | 'merge' | 'reconcile' = 'replace',
  ownerUserId?: string | null,
  lease?: DevicePendingFlushLease,
): Promise<Response | null> {
  if (!DEVICE_SYNC_AVAILABLE) return null;
  await lease?.assertOwnership();
  return fetchDeviceEndpoint(DEVICE_CARDS_ENDPOINT, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      cards,
      total: Math.max(cards.length, total),
      pending,
      mode,
      ...(ownerUserId !== undefined ? { ownerUserId } : {}),
      ...(lease ? { token: lease.token } : {}),
    }),
  });
}

export async function saveDeviceCards(
  cards: CardData[],
  total = cards.length,
  pending?: DevicePendingOperation[],
  mode: 'replace' | 'merge' = 'replace',
  ownerUserId?: string | null,
  lease?: DevicePendingFlushLease,
): Promise<void> {
  try {
    await requestDeviceCardSave(cards, total, pending, mode, ownerUserId, lease);
  } catch (error) {
    if (lease) throw error;
    // This endpoint only exists in local dev. Production/cloud builds should keep working without it.
  }
}

export async function mergeDeviceCards(
  cards: CardData[],
  total = cards.length,
  ownerUserId?: string | null,
  lease?: DevicePendingFlushLease,
): Promise<void> {
  if (cards.length === 0) return;
  await saveDeviceCards(cards, total, undefined, 'merge', ownerUserId, lease);
}

export async function mergeDeviceCardsStrict(
  cards: CardData[],
  total = cards.length,
  ownerUserId?: string | null,
  lease?: DevicePendingFlushLease,
): Promise<void> {
  if (cards.length === 0) return;
  const response = await requestDeviceCardSave(cards, total, undefined, 'reconcile', ownerUserId, lease);
  if (response?.status === 409) throw new DeviceBackupOwnerConflictError();
  if (response && !response.ok) throw new Error(`Device card merge failed (${response.status}).`);
}

export async function queueDeviceUpserts(
  cards: CardData[],
  total = cards.length,
  userId?: string,
  requiresEpochBinding = false,
): Promise<DevicePendingOperation[]> {
  if (cards.length === 0) return [];
  const pending = cards.map(card => ({
    type: 'upsert' as const,
    operation: 'create' as const,
    opId: createOperationId(),
    card,
    baseRevision: card.revision ?? 0,
    fieldMask: [] as (keyof CardData)[],
    libraryEpoch: requiresEpochBinding ? -1 : card.libraryEpoch ?? 0,
    updatedAt: new Date().toISOString(),
    ...(userId ? { ownerUserId: userId } : {}),
  }));
  if (userId) await persistDevicePending(userId, pending);
  await saveDeviceCards(cards, Math.max(cards.length, total), pending, 'merge', userId ?? null);
  return pending;
}

export async function queueDevicePatches(
  changes: readonly DeviceCardPatch[],
  total = changes.length,
  userId?: string,
  operationId?: string,
  requiresEpochBinding = false,
  operationKind: Extract<CardMutationKind, 'patch' | 'review'> = 'patch',
): Promise<DevicePendingOperation[]> {
  if (changes.length === 0) return [];
  const updatedAt = new Date().toISOString();
  const pending = changes.map(({ card, fields, operation, reviewEffect }, index) => ({
    type: 'patch' as const,
    operation: operation ?? operationKind,
    opId: operationId ? `${operationId}${changes.length > 1 ? `-${index}` : ''}` : createOperationId(),
    cardId: card.id,
    fields,
    baseRevision: card.revision ?? 0,
    fieldMask: operationFieldMask(fields),
    libraryEpoch: requiresEpochBinding ? -1 : card.libraryEpoch ?? 0,
    updatedAt,
    ...(reviewEffect ? { reviewEffect } : {}),
    ...(userId ? { ownerUserId: userId } : {}),
  }));
  if (userId) await persistDevicePending(userId, pending);
  await saveDeviceCards(
    changes.map(change => change.card),
    Math.max(changes.length, total),
    pending,
    'merge',
    userId ?? null,
  );
  return pending;
}

export interface DeviceDeleteContext {
  libraryEpoch?: number;
  baseRevisions?: Readonly<Record<string, number>>;
}

export async function deleteDeviceCardBackupIfNotNewerThan(
  userId: string,
  cardId: string,
  maximum: { libraryEpoch: number; revision: number },
  lease?: DevicePendingFlushLease,
): Promise<boolean> {
  if (!DEVICE_SYNC_AVAILABLE) return false;
  await lease?.assertOwnership();
  const response = await fetchDeviceEndpoint(`${DEVICE_CARDS_ENDPOINT}/cleanup`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, cardId, maximum, ...(lease ? { token: lease.token } : {}) }),
  });
  if (response.status === 409) return false;
  if (!response.ok) throw new Error(`Device card cleanup failed (${response.status}).`);
  const result = await response.json() as { deleted?: unknown };
  return result.deleted === true;
}

export async function queueDeviceDeletes(
  cardIds: string[],
  userId?: string,
  context: DeviceDeleteContext = {},
): Promise<DevicePendingOperation[]> {
  if (cardIds.length === 0) return [];
  const pending = cardIds.map(cardId => ({
    type: 'delete' as const,
    operation: 'delete' as const,
    opId: createOperationId(),
    cardId,
    baseRevision: context.baseRevisions?.[cardId] ?? 0,
    fieldMask: [] as (keyof CardData)[],
    libraryEpoch: context.libraryEpoch ?? 0,
    updatedAt: new Date().toISOString(),
    ...(userId ? { ownerUserId: userId } : {}),
  }));
  if (userId) await persistDevicePending(userId, pending);
  await saveDeviceCards([], 0, pending, 'merge', userId ?? null);
  return pending;
}

export async function acknowledgeDevicePending(operations: DevicePendingOperation[], lease?: DevicePendingFlushLease): Promise<void> {
  if (operations.length === 0) return;
  const operationsByOwner = new Map<string, DevicePendingOperation[]>();
  operations.forEach(operation => {
    if (!operation.ownerUserId) return;
    operationsByOwner.set(operation.ownerUserId, [...(operationsByOwner.get(operation.ownerUserId) ?? []), operation]);
  });
  const ownerBatches = [...operationsByOwner];
  if (DEVICE_SYNC_AVAILABLE) {
    await Promise.all(ownerBatches.map(async ([userId, acknowledged]) => {
      await lease?.assertOwnership();
      const response = await fetchDeviceEndpoint(`${DEVICE_CARDS_ENDPOINT}/ack`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, operations: acknowledged, ...(lease ? { token: lease.token } : {}) }),
      });
      // A different account's immutable backup cannot contain this owner's
      // operations. Cloud has already accepted them, so only the owner-scoped
      // browser queue still needs acknowledgement.
      if (response.status === 409) {
        const body = await response.json().catch(() => null) as { error?: unknown } | null;
        if (body?.error === 'Device backup belongs to another account') return;
        throw new Error('The pending flush lease was lost.');
      }
      if (!response.ok) throw new Error(`Device pending acknowledgement failed (${response.status}).`);
    }));
  }
  await Promise.all(ownerBatches.map(async ([userId, acknowledged]) => {
    const acknowledgedOperationKeys = new Set(
      acknowledged.flatMap(operation => operation.opId
        ? [`${operation.opId}:${operationTarget(operation)}`]
        : []),
    );
    const acknowledgedAt = new Map<string, string>();
    acknowledged.forEach(operation => {
      const target = operationTarget(operation);
      const previous = acknowledgedAt.get(target);
      if (!previous || previous < operation.updatedAt) acknowledgedAt.set(target, operation.updatedAt);
    });
    await updateDevicePending(userId, current =>
      mergePendingOperations(current.flatMap(operation => {
        const normalized = normalizePendingOperation(operation);
        return normalized ? [normalized] : [];
      })).filter(operation => {
        if (operation.opId) {
          return !acknowledgedOperationKeys.has(
            `${operation.opId}:${operationTarget(operation)}`,
          );
        }
        const flushedAt = acknowledgedAt.get(operationTarget(operation));
        return !flushedAt || operation.updatedAt > flushedAt;
      }));
  }));
}

export interface DevicePendingFlushLease {
  token: string;
  expiresAt: number;
  assertOwnership(): Promise<void>;
}

function flushToken(): string { return createOperationId(); }

async function deviceLeaseRequest(
  method: 'POST' | 'PUT' | 'DELETE', userId: string, token?: string, force?: boolean,
): Promise<{ granted?: boolean; token?: string; expiresAt?: number }> {
  const response = await fetchDeviceEndpoint(DEVICE_CARDS_FLUSH_ENDPOINT, {
    method, headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, ...(token ? { token } : {}), ...(force ? { force: true } : {}) }),
  });
  if (!response.ok) throw new Error(`Device sync coordinator rejected the lease request (${response.status}).`);
  return response.json();
}

export async function withDevicePendingFlush<T>(
  userId: string,
  force: boolean,
  operation: (lease: DevicePendingFlushLease) => Promise<T>,
): Promise<{ acquired: false } | { acquired: true; value: T }> {
  const run = async (): Promise<{ acquired: false } | { acquired: true; value: T }> => {
    const token = flushToken();
    const leaseStartedAt = Date.now();
    let expiry = leaseStartedAt + PENDING_FLUSH_LEASE_MS;
    if (DEVICE_SYNC_AVAILABLE) {
      const acquired = await deviceLeaseRequest('POST', userId, token, force);
      if (!acquired.granted) return { acquired: false };
      if (typeof acquired.token !== 'string' || !Number.isFinite(acquired.expiresAt)) throw new Error('Device sync coordinator returned an invalid lease response.');
      expiry = acquired.expiresAt!;
    } else {
      // A forced cloud retry may recover an expired server lease, but it must
      // never evict an active lease held by another browser tab.
      const acquired = await acquireStoredPendingFlushLease(userId, token, leaseStartedAt, PENDING_FLUSH_LEASE_MS, false);
      if (!acquired) return { acquired: false };
      expiry = acquired.expiresAt;
    }
    if (Date.now() >= expiry) {
      if (DEVICE_SYNC_AVAILABLE) await deviceLeaseRequest('DELETE', userId, token).catch(() => undefined);
      else await releaseStoredPendingFlushLease(userId, token).catch(() => undefined);
      throw new Error('The pending flush lease was lost.');
    }
    let released = false;
    let lost = false;
    const heartbeatId = setInterval(() => {
      if (lost || released) return;
      const now = Date.now();
      const renew = DEVICE_SYNC_AVAILABLE
        ? deviceLeaseRequest('PUT', userId, token).then(result => {
            if (result.granted !== true || !Number.isFinite(result.expiresAt)) lost = true;
            else expiry = result.expiresAt!;
          })
        : renewStoredPendingFlushLease(userId, token, now, PENDING_FLUSH_LEASE_MS).then(result => {
            if (!result) lost = true; else expiry = result.expiresAt;
          });
      void renew.catch(() => { lost = true; });
    }, Math.max(1_000, Math.floor(PENDING_FLUSH_LEASE_MS / 3)));
    const assertOwnership = async () => {
      if (lost) throw new Error('The pending flush lease was lost.');
      try {
        const now = Date.now();
        if (now + PENDING_FLUSH_LEASE_MS / 3 >= expiry) {
          if (DEVICE_SYNC_AVAILABLE) {
            const renewed = await deviceLeaseRequest('PUT', userId, token);
            if (renewed.granted !== true || !Number.isFinite(renewed.expiresAt)) throw new Error('renewal rejected');
            expiry = renewed.expiresAt!;
          } else {
            const renewed = await renewStoredPendingFlushLease(userId, token, now, PENDING_FLUSH_LEASE_MS);
            if (!renewed) throw new Error('renewal rejected');
            expiry = renewed.expiresAt;
          }
        }
        const owned = DEVICE_SYNC_AVAILABLE
          ? (await deviceLeaseRequest('PUT', userId, token)).granted === true
          : await assertStoredPendingFlushLease(userId, token, Date.now());
        if (!owned) throw new Error('ownership rejected');
      } catch {
        lost = true;
        throw new Error('The pending flush lease was lost.');
      }
    };
    try {
      const value = await operation({ token, expiresAt: expiry, assertOwnership });
      await assertOwnership();
      return { acquired: true, value };
    } finally {
      clearInterval(heartbeatId);
      if (!released) {
        released = true;
        try {
          if (DEVICE_SYNC_AVAILABLE) await deviceLeaseRequest('DELETE', userId, token);
          else await releaseStoredPendingFlushLease(userId, token);
        } catch { /* expiry is the crash-safe release path */ }
      }
    }
  };
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  if (locks?.request) {
    let result: { acquired: false } | { acquired: true; value: T } = { acquired: false };
    await locks.request(`sonflash-pending-flush:${userId}`, { ifAvailable: true }, async lock => {
      if (lock) result = await run();
    });
    return result;
  }
  return run();
}

export function subscribeToDeviceCards(onChange: () => void): () => void {
  if (!DEVICE_SYNC_AVAILABLE) return () => undefined;
  if (typeof EventSource === 'undefined') {
    const intervalId = setInterval(onChange, 2000);
    return () => clearInterval(intervalId);
  }

  const source = new EventSource(DEVICE_CARDS_EVENTS_ENDPOINT);
  source.addEventListener('cards-changed', onChange);
  return () => source.close();
}

export async function updateDeviceCloudSync(
  userId: string,
  status: DeviceCloudSyncState['status'],
  expectedTotal: number,
  loaded: number,
): Promise<void> {
  if (!DEVICE_SYNC_AVAILABLE) return;
  try {
    await fetchDeviceEndpoint(`${DEVICE_CARDS_ENDPOINT}/sync`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, status, expectedTotal, loaded }),
    });
  } catch {
    // Local development endpoint; cloud deployments keep working without it.
  }
}

function normalizePendingOperation(value: unknown): DevicePendingOperation | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const updatedAt = typeof source.updatedAt === 'string'
    && !Number.isNaN(new Date(source.updatedAt).getTime())
    ? new Date(source.updatedAt).toISOString()
    : new Date(0).toISOString();
  const common = {
    updatedAt,
    baseRevision: Number.isSafeInteger(source.baseRevision) && Number(source.baseRevision) >= 0
      ? Number(source.baseRevision)
      : 0,
    libraryEpoch: Number.isSafeInteger(source.libraryEpoch) && Number(source.libraryEpoch) >= -1
      ? Number(source.libraryEpoch)
      : 0,
    ...(typeof source.opId === 'string' && source.opId.length > 0 && source.opId.length <= 512
      ? { opId: source.opId }
      : {}),
    ...(typeof source.ownerUserId === 'string' && source.ownerUserId.length > 0 && source.ownerUserId.length <= 256
      ? { ownerUserId: source.ownerUserId }
      : {}),
  };
  if (source.type === 'delete' && typeof source.cardId === 'string' && source.cardId) {
    return {
      ...common,
      type: 'delete',
      operation: 'delete',
      cardId: source.cardId,
      fieldMask: [],
    };
  }
  if (source.type === 'patch') {
    if (
      typeof source.cardId !== 'string'
      || !source.cardId
      || !source.fields
      || typeof source.fields !== 'object'
      || Array.isArray(source.fields)
    ) return null;
    const fields = source.fields as Partial<CardData>;
    const declaredMask = Array.isArray(source.fieldMask)
      ? source.fieldMask.filter((field): field is keyof CardData => typeof field === 'string')
      : [];
    const candidateMask = declaredMask.length > 0
      ? declaredMask
      : Object.keys(fields) as Array<keyof CardData>;
    const fieldMask = Object.keys(
      selectMutableCardPatch(fields, candidateMask),
    ) as Array<keyof CardData>;
    if (fieldMask.length === 0) return null;
    const operation = source.operation === 'review' ? 'review' : 'patch';
    return {
      ...common,
      type: 'patch',
      operation,
      cardId: source.cardId,
      fields,
      fieldMask,
      ...(operation === 'review' && source.reviewEffect && typeof source.reviewEffect === 'object'
        && (source.reviewEffect as Record<string, unknown>).xp === 2
        ? { reviewEffect: { xp: 2 as const } }
        : {}),
    };
  }
  if (
    source.type === 'upsert'
    && source.card
    && typeof source.card === 'object'
    && !Array.isArray(source.card)
    && typeof (source.card as Record<string, unknown>).id === 'string'
  ) {
    const card = source.card as CardData;
    return {
      ...common,
      type: 'upsert',
      operation: 'create',
      card,
      baseRevision: Number.isSafeInteger(source.baseRevision) && Number(source.baseRevision) >= 0
        ? Number(source.baseRevision)
        : card.revision ?? 0,
      libraryEpoch: Number.isSafeInteger(source.libraryEpoch) && Number(source.libraryEpoch) >= -1
        ? Number(source.libraryEpoch)
        : card.libraryEpoch ?? 0,
      fieldMask: [],
    };
  }
  return null;
}

function isCloudSyncState(value: unknown): value is DeviceCloudSyncState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const source = value as Record<string, unknown>;
  return typeof source.userId === 'string'
    && ['syncing', 'complete', 'paused'].includes(String(source.status))
    && typeof source.expectedTotal === 'number'
    && typeof source.loaded === 'number'
    && typeof source.attemptedAt === 'string';
}
