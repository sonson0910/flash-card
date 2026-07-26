import type { CardData } from '../types/card';
import { withTimeout } from './async';
import {
  updateStoredPendingOperations,
} from './pendingOperationStore';

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

function fetchDeviceEndpoint(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  return withTimeout(
    fetch(input, { ...init, signal: controller.signal }),
    DEVICE_REQUEST_TIMEOUT_MS,
    'The shared device store did not respond in time.',
    () => controller.abort(),
  );
}

export type DevicePendingOperation =
  | { type: 'upsert'; card: CardData; updatedAt: string; ownerUserId?: string }
  | { type: 'patch'; cardId: string; fields: Partial<CardData>; updatedAt: string; ownerUserId?: string }
  | { type: 'delete'; cardId: string; updatedAt: string; ownerUserId?: string };

export interface DeviceCardPatch {
  card: CardData;
  fields: Partial<CardData>;
}

export function resolveDeviceBackupOwner(
  explicitOwnerUserId: string | null | undefined,
  cloudSyncUserId: string | null,
  pending: DevicePendingOperation[],
): string | null | undefined {
  if (explicitOwnerUserId !== undefined) return explicitOwnerUserId;
  if (cloudSyncUserId) return cloudSyncUserId;
  const pendingOwners = new Set(
    pending.map(operation => operation.ownerUserId).filter((value): value is string => Boolean(value)),
  );
  return pendingOwners.size === 1 ? [...pendingOwners][0] : undefined;
}

const browserPendingKey = (userId: string) => `lingoflash_pending_writes_${encodeURIComponent(userId)}`;
const browserFlushLeaseKey = (userId: string) => `lingoflash_pending_lease_${encodeURIComponent(userId)}`;

export function loadBrowserPending(userId: string): DevicePendingOperation[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const value = JSON.parse(localStorage.getItem(browserPendingKey(userId)) ?? '[]') as unknown;
    return Array.isArray(value) ? value.filter(isPendingOperation) : [];
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

export function mergePendingOperations(operations: DevicePendingOperation[]): DevicePendingOperation[] {
  const latestByCard = new Map<string, DevicePendingOperation>();
  operations
    .map((operation, index) => ({ operation, index }))
    .sort((left, right) => left.operation.updatedAt.localeCompare(right.operation.updatedAt) || left.index - right.index)
    .forEach(({ operation }) => {
    const key = `${operation.ownerUserId ?? ''}:${operationTarget(operation)}`;
    const existing = latestByCard.get(key);
    if (!existing) {
      latestByCard.set(key, operation);
      return;
    }
    if (existing.type === 'delete') {
      if (operation.type === 'upsert' && operation.updatedAt > existing.updatedAt) {
        latestByCard.set(key, operation);
      }
      return;
    }
    if (operation.type === 'delete') {
      latestByCard.set(key, operation);
      return;
    }
    if (existing.type === 'upsert' && operation.type === 'patch') {
      latestByCard.set(key, {
        ...existing,
        card: { ...existing.card, ...operation.fields, id: existing.card.id },
        updatedAt: operation.updatedAt,
      });
      return;
    }
    if (existing.type === 'patch' && operation.type === 'patch') {
      latestByCard.set(key, {
        ...operation,
        fields: { ...existing.fields, ...operation.fields },
      });
      return;
    }
    latestByCard.set(key, operation);
  });
  return [...latestByCard.values()];
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
        if (!isPendingOperation(operation)) return [];
        const scoped = scopePendingOperation(operation, userId);
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
  return persistDevicePending(userId, legacy);
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
    const pending = Array.isArray(data?.pending) ? data.pending.filter(isPendingOperation) : [];
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

export async function saveDeviceCards(
  cards: CardData[],
  total = cards.length,
  pending?: DevicePendingOperation[],
  mode: 'replace' | 'merge' = 'replace',
  ownerUserId?: string | null,
): Promise<void> {
  if (!DEVICE_SYNC_AVAILABLE) return;
  try {
    await fetchDeviceEndpoint(DEVICE_CARDS_ENDPOINT, {
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

export async function queueDeviceUpserts(cards: CardData[], total = cards.length, userId?: string): Promise<DevicePendingOperation[]> {
  if (cards.length === 0) return [];
  const pending = cards.map(card => ({
    type: 'upsert' as const,
    card,
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
): Promise<DevicePendingOperation[]> {
  if (changes.length === 0) return [];
  const updatedAt = new Date().toISOString();
  const pending = changes.map(({ card, fields }) => ({
    type: 'patch' as const,
    cardId: card.id,
    fields,
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

export async function queueDeviceDeletes(cardIds: string[], userId?: string): Promise<DevicePendingOperation[]> {
  if (cardIds.length === 0) return [];
  const pending = cardIds.map(cardId => ({
    type: 'delete' as const,
    cardId,
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
  await Promise.all([...operationsByOwner].map(async ([userId, acknowledged]) => {
    const acknowledgedAt = new Map<string, string>();
    acknowledged.forEach(operation => {
      const target = operationTarget(operation);
      const previous = acknowledgedAt.get(target);
      if (!previous || previous < operation.updatedAt) acknowledgedAt.set(target, operation.updatedAt);
    });
    const remaining = await updateStoredPendingOperations<DevicePendingOperation>(userId, current =>
      mergePendingOperations(current.filter(isPendingOperation)).filter(operation => {
        const flushedAt = acknowledgedAt.get(operationTarget(operation));
        return !flushedAt || operation.updatedAt > flushedAt;
      }));
    replaceBrowserPending(userId, remaining);
  }));
  if (!DEVICE_SYNC_AVAILABLE) return;
  try {
    await fetchDeviceEndpoint(`${DEVICE_CARDS_ENDPOINT}/ack`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ operations }),
    });
  } catch {
    // The next flush safely retries idempotent Firebase writes.
  }
}

export async function acquireDevicePendingFlush(userId: string): Promise<boolean> {
  if (!DEVICE_SYNC_AVAILABLE) {
    if (typeof localStorage === 'undefined') return true;
    const now = Date.now();
    const leaseKey = browserFlushLeaseKey(userId);
    const existing = Number(localStorage.getItem(leaseKey) ?? 0);
    if (Number.isFinite(existing) && existing > now) return false;
    localStorage.setItem(leaseKey, String(now + 30_000));
    return true;
  }
  try {
    const response = await fetchDeviceEndpoint(DEVICE_CARDS_FLUSH_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId }),
    });
    if (!response.ok) return false;
    const data = await response.json();
    return data?.granted === true;
  } catch {
    return false;
  }
}

export async function releaseDevicePendingFlush(userId: string): Promise<void> {
  if (!DEVICE_SYNC_AVAILABLE) {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(browserFlushLeaseKey(userId));
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

function isPendingOperation(value: unknown): value is DevicePendingOperation {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const source = value as Record<string, unknown>;
  if (source.type === 'delete') return typeof source.cardId === 'string';
  if (source.type === 'patch') {
    return typeof source.cardId === 'string'
      && Boolean(source.fields && typeof source.fields === 'object' && !Array.isArray(source.fields));
  }
  if (source.type === 'upsert') return Boolean(source.card && typeof source.card === 'object' && !Array.isArray(source.card));
  return false;
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
