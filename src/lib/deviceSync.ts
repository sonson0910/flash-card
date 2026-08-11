import type { CardData } from '../types/card';
import { withTimeout } from './async';
import {
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
}

export type DevicePendingOperation =
  | (DeviceOperationMetadata & { type: 'upsert'; card: CardData })
  | (DeviceOperationMetadata & { type: 'patch'; cardId: string; fields: Partial<CardData> })
  | (DeviceOperationMetadata & { type: 'delete'; cardId: string });

export interface DeviceCardPatch {
  card: CardData;
  fields: Partial<CardData>;
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
const browserFlushLeaseKey = (userId: string) => `lingoflash_pending_lease_${encodeURIComponent(userId)}`;

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
    .map((operation, index) => ({ operation, index }))
    .sort((left, right) => left.operation.updatedAt.localeCompare(right.operation.updatedAt) || left.index - right.index)
    .map(({ operation }) => operation);
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

async function persistDevicePending(
  userId: string,
  operations: DevicePendingOperation[],
): Promise<DevicePendingOperation[]> {
  const merged = await updateStoredPendingOperations<DevicePendingOperation>(userId, current =>
    mergePendingOperations([
      ...current.flatMap(operation => {
        const normalized = normalizePendingOperation(operation);
        if (!normalized) return [];
        const scoped = scopePendingOperation(normalized, userId);
        return scoped ? [scoped] : [];
      }),
      ...operations,
    ]));
  replaceBrowserPending(userId, merged);
  return merged;
}

export async function loadDevicePending(userId: string): Promise<DevicePendingOperation[]> {
  const legacy = loadBrowserPending(userId).flatMap(operation => {
    const scoped = scopePendingOperation(operation, userId);
    return scoped ? [scoped] : [];
  });
  const deviceBackup = await loadDeviceCards();
  const shared = deviceBackup?.ownerUserId === userId
    ? deviceBackup.pending.flatMap(operation => {
        const scoped = scopePendingOperation(operation, userId);
        return scoped ? [scoped] : [];
      })
    : [];
  return persistDevicePending(userId, [...legacy, ...shared]);
}

export async function clearDevicePending(userId: string): Promise<void> {
  await updateStoredPendingOperations<DevicePendingOperation>(userId, () => []);
  replaceBrowserPending(userId, []);
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
): Promise<Response | null> {
  if (!DEVICE_SYNC_AVAILABLE) return null;
  return fetchDeviceEndpoint(DEVICE_CARDS_ENDPOINT, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      cards,
      total: Math.max(cards.length, total),
      pending,
      mode,
      ...(ownerUserId !== undefined ? { ownerUserId } : {}),
    }),
  });
}

export async function saveDeviceCards(
  cards: CardData[],
  total = cards.length,
  pending?: DevicePendingOperation[],
  mode: 'replace' | 'merge' = 'replace',
  ownerUserId?: string | null,
): Promise<void> {
  try {
    await requestDeviceCardSave(cards, total, pending, mode, ownerUserId);
  } catch {
    // This endpoint only exists in local dev. Production/cloud builds should keep working without it.
  }
}

export async function mergeDeviceCards(
  cards: CardData[],
  total = cards.length,
  ownerUserId?: string | null,
): Promise<void> {
  if (cards.length === 0) return;
  await saveDeviceCards(cards, total, undefined, 'merge', ownerUserId);
}

export async function mergeDeviceCardsStrict(
  cards: CardData[],
  total = cards.length,
  ownerUserId?: string | null,
): Promise<void> {
  if (cards.length === 0) return;
  const response = await requestDeviceCardSave(cards, total, undefined, 'reconcile', ownerUserId);
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
): Promise<DevicePendingOperation[]> {
  if (changes.length === 0) return [];
  const updatedAt = new Date().toISOString();
  const pending = changes.map(({ card, fields }, index) => ({
    type: 'patch' as const,
    operation: 'patch' as const,
    opId: operationId ? `${operationId}${changes.length > 1 ? `-${index}` : ''}` : createOperationId(),
    cardId: card.id,
    fields,
    baseRevision: card.revision ?? 0,
    fieldMask: operationFieldMask(fields),
    libraryEpoch: requiresEpochBinding ? -1 : card.libraryEpoch ?? 0,
    updatedAt,
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
): Promise<boolean> {
  if (!DEVICE_SYNC_AVAILABLE) return false;
  const response = await fetchDeviceEndpoint(`${DEVICE_CARDS_ENDPOINT}/cleanup`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, cardId, maximum }),
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

export async function acknowledgeDevicePending(operations: DevicePendingOperation[]): Promise<void> {
  if (operations.length === 0) return;
  const operationsByOwner = new Map<string, DevicePendingOperation[]>();
  operations.forEach(operation => {
    if (!operation.ownerUserId) return;
    operationsByOwner.set(operation.ownerUserId, [...(operationsByOwner.get(operation.ownerUserId) ?? []), operation]);
  });
  const ownerBatches = [...operationsByOwner];
  if (DEVICE_SYNC_AVAILABLE) {
    await Promise.all(ownerBatches.map(async ([userId, acknowledged]) => {
      const response = await fetchDeviceEndpoint(`${DEVICE_CARDS_ENDPOINT}/ack`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, operations: acknowledged }),
      });
      // A different account's immutable backup cannot contain this owner's
      // operations. Cloud has already accepted them, so only the owner-scoped
      // browser queue still needs acknowledgement.
      if (response.status === 409) return;
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
    const remaining = await updateStoredPendingOperations<DevicePendingOperation>(userId, current =>
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
    replaceBrowserPending(userId, remaining);
  }));
}

export async function acquireDevicePendingFlush(userId: string, force?: boolean): Promise<boolean> {
  if (!DEVICE_SYNC_AVAILABLE) {
    if (typeof localStorage === 'undefined') return true;
    try {
      const now = Date.now();
      const leaseKey = browserFlushLeaseKey(userId);
      const existing = Number(localStorage.getItem(leaseKey) ?? 0);
      if (!force && existing > now) return false;
      localStorage.setItem(leaseKey, String(now + 30_000));
      return true;
    } catch {
      return true;
    }
  }
  const response = await fetchDeviceEndpoint(DEVICE_CARDS_FLUSH_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, ...(force ? { force: true } : {}) }),
  });
  if (!response.ok) {
    throw new Error(`Device sync coordinator rejected the lease request (${response.status}).`);
  }
  const data = await response.json();
  if (typeof data?.granted !== 'boolean') {
    throw new Error('Device sync coordinator returned an invalid lease response.');
  }
  return data.granted;
}

export async function releaseDevicePendingFlush(userId: string): Promise<void> {
  if (!DEVICE_SYNC_AVAILABLE) {
    try { localStorage?.removeItem(browserFlushLeaseKey(userId)); } catch { /* optional cross-tab lease */ }
    return;
  }
  try {
    await fetchDeviceEndpoint(DEVICE_CARDS_FLUSH_ENDPOINT, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId }),
    });
  } catch {
    // The short server lease expires automatically after a crashed/closed browser.
  }
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
    return {
      ...common,
      type: 'patch',
      operation: source.operation === 'review' ? 'review' : 'patch',
      cardId: source.cardId,
      fields,
      fieldMask,
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
