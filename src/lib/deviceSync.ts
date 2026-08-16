import type { CardData } from '../types/card';
import { withTimeout } from './async';
import {
  mergePendingCardAliases,
  normalizePendingCardAlias,
  retargetCardOperationWithAliases,
  type PendingCardAlias,
} from './cardAliasProtocol';
import {
  loadStoredPendingState,
  updateStoredPendingOperations,
  updateStoredPendingState,
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
  aliases: PendingCardAlias[];
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

export const MAX_PENDING_MUTATION_SETTLEMENTS = 2_048;
export const MAX_PENDING_MUTATION_SETTLEMENTS_PER_DRAIN = 128;

export class PendingMutationSettlementCapacityError extends Error {
  readonly code = 'PENDING_MUTATION_SETTLEMENT_CAPACITY_FULL';

  constructor() {
    super(`Cannot sync another mutation while ${MAX_PENDING_MUTATION_SETTLEMENTS} learning settlements are waiting for local accounting.`);
    this.name = 'PendingMutationSettlementCapacityError';
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

export interface DeviceMutationAccounting {
  version: 1;
  xp?: { delta: number };
}

export interface DeviceLogicalOperation {
  id: string;
  kind: 'patch' | 'delete';
  accounting?: DeviceMutationAccounting;
}

interface DeviceOperationMetadata {
  /** Stable idempotency key. Optional only for persisted v1 operations. */
  opId?: string;
  /** Marks commands created by the transaction-receipt protocol. */
  receiptProtocol?: 1;
  /** A claimed command is a merge barrier until terminal settlement. */
  inFlight?: true;
  /** Canonical v2 operation. `type: upsert` remains as a v1 compatibility alias for create. */
  operation?: CardMutationKind;
  /** Original user operations retained when durable commands are coalesced or superseded. */
  logicalOperations?: DeviceLogicalOperation[];
  baseRevision?: number;
  fieldMask?: (keyof CardData)[];
  libraryEpoch?: number;
  updatedAt: string;
  ownerUserId?: string;
}

export type DevicePendingOperation =
  | (DeviceOperationMetadata & { type: 'upsert'; card: CardData })
  | (DeviceOperationMetadata & {
      type: 'patch';
      cardId: string;
      fields: Partial<CardData>;
      baseFields?: Partial<CardData>;
    })
  | (DeviceOperationMetadata & { type: 'delete'; cardId: string });

export type PendingCreateSettlementOutcome = 'created' | 'replayed' | 'duplicate';

export interface PendingCreateSettlement {
  operation: Extract<DevicePendingOperation, { type: 'upsert' }>;
  authoritativeCard: CardData;
  outcome: PendingCreateSettlementOutcome;
}

export type PendingMutationSettlementOutcome =
  | 'applied'
  | 'discarded-stale-library-epoch'
  | 'discarded-missing'
  | 'discarded-superseded';

export interface PendingMutationSettlement {
  ownerUserId: string;
  logicalOperationId: string;
  kind: DeviceLogicalOperation['kind'];
  cardId: string;
  outcome: PendingMutationSettlementOutcome;
  settledAt: string;
  accounting?: DeviceMutationAccounting;
}

export type PendingMutationDisposition = PendingMutationSettlementOutcome | 'deferred';

type PendingCreateSettlementListener = (
  settlement: PendingCreateSettlement,
) => void | Promise<void>;

const PENDING_CREATE_SETTLEMENT_CHANNEL = 'lingoflash-pending-create-settlements-v1';
const pendingCreateSettlementListeners = new Set<PendingCreateSettlementListener>();
let pendingCreateSettlementChannel: BroadcastChannel | null = null;

function getPendingCreateSettlementChannel(): BroadcastChannel | null {
  if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') return null;
  if (pendingCreateSettlementChannel) return pendingCreateSettlementChannel;
  try {
    pendingCreateSettlementChannel = new BroadcastChannel(PENDING_CREATE_SETTLEMENT_CHANNEL);
    pendingCreateSettlementChannel.addEventListener('message', event => {
      const settlement = normalizePendingCreateSettlement(event.data);
      if (!settlement) return;
      pendingCreateSettlementListeners.forEach(listener => {
        try {
          void Promise.resolve(listener(settlement)).catch(() => undefined);
        } catch {
          // Cross-tab settlement is best effort; the durable queue remains authoritative.
        }
      });
    });
    return pendingCreateSettlementChannel;
  } catch {
    return null;
  }
}

export function publishPendingCreateSettlement(settlement: PendingCreateSettlement): void {
  try {
    getPendingCreateSettlementChannel()?.postMessage(settlement);
  } catch {
    // The originating tab has already settled locally; other tabs can refresh later.
  }
}

export function subscribeToPendingCreateSettlements(
  listener: PendingCreateSettlementListener,
): () => void {
  if (!getPendingCreateSettlementChannel()) return () => undefined;
  pendingCreateSettlementListeners.add(listener);
  return () => pendingCreateSettlementListeners.delete(listener);
}

type PendingMutationSettlementListener = (
  settlement: PendingMutationSettlement,
) => void | Promise<void>;

const PENDING_MUTATION_SETTLEMENT_CHANNEL = 'lingoflash-pending-mutation-settlements-v1';
const pendingMutationSettlementListeners = new Set<PendingMutationSettlementListener>();
let pendingMutationSettlementChannel: BroadcastChannel | null = null;

function notifyPendingMutationSettlementListeners(
  settlement: PendingMutationSettlement,
): void {
  pendingMutationSettlementListeners.forEach(listener => {
    try {
      void Promise.resolve(listener(settlement)).catch(() => undefined);
    } catch {
      // Settlement delivery is best effort; cloud and the durable queue remain authoritative.
    }
  });
}

function getPendingMutationSettlementChannel(): BroadcastChannel | null {
  if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') return null;
  if (pendingMutationSettlementChannel) return pendingMutationSettlementChannel;
  try {
    pendingMutationSettlementChannel = new BroadcastChannel(PENDING_MUTATION_SETTLEMENT_CHANNEL);
    pendingMutationSettlementChannel.addEventListener('message', event => {
      const settlement = normalizePendingMutationSettlement(event.data);
      if (settlement) notifyPendingMutationSettlementListeners(settlement);
    });
    return pendingMutationSettlementChannel;
  } catch {
    return null;
  }
}

export function publishPendingMutationSettlement(
  settlement: PendingMutationSettlement,
): void {
  notifyPendingMutationSettlementListeners(settlement);
  try {
    getPendingMutationSettlementChannel()?.postMessage(settlement);
  } catch {
    // The local tab has already observed the settlement; another tab can reconcile later.
  }
}

export function subscribeToPendingMutationSettlements(
  listener: PendingMutationSettlementListener,
): () => void {
  pendingMutationSettlementListeners.add(listener);
  getPendingMutationSettlementChannel();
  return () => pendingMutationSettlementListeners.delete(listener);
}

export interface DeviceCardPatch {
  card: CardData;
  fields: Partial<CardData>;
  baseFields?: Partial<CardData>;
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

type DevicePendingPatch = Extract<DevicePendingOperation, { type: 'patch' }>;

function mergeLogicalOperations(
  ...groups: Array<readonly DeviceLogicalOperation[] | undefined>
): DeviceLogicalOperation[] | undefined {
  const merged = new Map<string, DeviceLogicalOperation>();
  groups.flatMap(group => group ?? []).forEach(operation => {
    const existing = merged.get(operation.id);
    if (!existing || (!existing.accounting && operation.accounting)) {
      merged.set(operation.id, operation);
    }
  });
  return merged.size > 0 ? [...merged.values()] : undefined;
}

function withLogicalOperations<T extends DevicePendingOperation>(
  operation: T,
  ...groups: Array<readonly DeviceLogicalOperation[] | undefined>
): T {
  const logicalOperations = mergeLogicalOperations(...groups);
  return logicalOperations ? { ...operation, logicalOperations } : operation;
}

export function mergePendingOperations(operations: DevicePendingOperation[]): DevicePendingOperation[] {
  const commandsByCard = new Map<string, DevicePendingOperation[]>();
  operations
    .map((operation, index) => ({ operation, index }))
    .sort((left, right) => left.operation.updatedAt.localeCompare(right.operation.updatedAt) || left.index - right.index)
    .forEach(({ operation }) => {
    const libraryEpoch = Number.isSafeInteger(operation.libraryEpoch)
      ? Number(operation.libraryEpoch)
      : 0;
    const key = `${operation.ownerUserId ?? ''}:${libraryEpoch}:${operationTarget(operation)}`;
    const commands = commandsByCard.get(key) ?? [];
    const existing = commands.at(-1);
    if (!existing) {
      commandsByCard.set(key, [operation]);
      return;
    }
    if (existing.inFlight && existing.opId !== operation.opId) {
      commandsByCard.set(key, [...commands, operation]);
      return;
    }
    if (existing.type === 'delete') {
      if (operation.type === 'upsert' && operation.updatedAt >= existing.updatedAt) {
        commandsByCard.set(key, [withLogicalOperations(
          operation,
          existing.logicalOperations,
          operation.logicalOperations,
        )]);
      } else {
        commandsByCard.set(key, [withLogicalOperations(
          existing,
          existing.logicalOperations,
          operation.logicalOperations,
        )]);
      }
      return;
    }
    if (operation.type === 'delete') {
      commandsByCard.set(key, [withLogicalOperations(
        operation,
        ...commands.map(command => command.logicalOperations),
        operation.logicalOperations,
      )]);
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
      const baseFields = existing.baseFields || operation.baseFields
        ? { ...operation.baseFields, ...existing.baseFields }
        : undefined;
      commandsByCard.set(key, [...commands.slice(0, -1), withLogicalOperations({
        ...operation,
        fields: { ...existing.fields, ...operation.fields },
        ...(baseFields ? { baseFields } : {}),
        ...(fieldMask ? { fieldMask } : {}),
      }, existing.logicalOperations, operation.logicalOperations)]);
      return;
    }
    commandsByCard.set(key, [withLogicalOperations(
      operation,
      ...commands.map(command => command.logicalOperations),
      operation.logicalOperations,
    )]);
  });
  return [...commandsByCard.values()]
    .flat()
    .map((operation, index) => ({ operation, index }))
    .sort((left, right) => left.operation.updatedAt.localeCompare(right.operation.updatedAt) || left.index - right.index)
    .map(({ operation }) => operation);
}

const retargetPendingCardPatch = (
  operation: DevicePendingPatch,
  fromCardId: string,
  authoritativeCard: CardData,
  expectedBaseRevision: number,
): DevicePendingPatch => {
  if (
    operation.cardId !== fromCardId
    || (operation.baseRevision ?? 0) !== expectedBaseRevision
  ) return operation;
  const revision = Number.isSafeInteger(authoritativeCard.revision)
    && Number(authoritativeCard.revision) >= 0
    ? Number(authoritativeCard.revision)
    : 0;
  const libraryEpoch = Number.isSafeInteger(authoritativeCard.libraryEpoch)
    && Number(authoritativeCard.libraryEpoch) >= 0
    ? Number(authoritativeCard.libraryEpoch)
    : 0;
  return {
    ...operation,
    cardId: authoritativeCard.id,
    baseRevision: revision,
    libraryEpoch,
  };
};

export function retargetPendingCardPatches(
  operations: readonly DevicePendingPatch[],
  fromCardId: string,
  authoritativeCard: CardData,
  expectedBaseRevision: number,
): DevicePendingPatch[] {
  return operations.map(operation => retargetPendingCardPatch(
    operation,
    fromCardId,
    authoritativeCard,
    expectedBaseRevision,
  ));
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

interface PersistedPendingBatch {
  operations: DevicePendingOperation[];
  incoming: DevicePendingOperation[];
}

async function persistDevicePending(
  userId: string,
  operations: DevicePendingOperation[],
  storedOperationIdsWin = false,
  incomingAliases: readonly PendingCardAlias[] = [],
): Promise<PersistedPendingBatch> {
  let resolvedIncoming = operations;
  const state = await updateStoredPendingState<DevicePendingOperation>(userId, current => {
    const aliases = mergePendingCardAliases([...current.aliases, ...incomingAliases]);
    const stored = current.operations.flatMap(operation => {
      const normalized = normalizePendingOperation(operation);
      if (!normalized) return [];
      const scoped = scopePendingOperation(normalized, userId);
      return scoped ? [retargetCardOperationWithAliases(scoped, aliases)] : [];
    });
    resolvedIncoming = operations.map(operation =>
      retargetCardOperationWithAliases(operation, aliases));
    const storedOperationIds = storedOperationIdsWin
      ? new Set(stored.flatMap(operation => operation.opId ? [operation.opId] : []))
      : null;
    const incoming = storedOperationIds
      ? resolvedIncoming.filter(operation => !operation.opId || !storedOperationIds.has(operation.opId))
      : resolvedIncoming;
    return {
      ...current,
      aliases,
      operations: mergePendingOperations([...stored, ...incoming]),
    };
  });
  replaceBrowserPending(userId, state.operations);
  return {
    operations: state.operations,
    incoming: resolvedIncoming,
  };
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
  return (await persistDevicePending(
    userId,
    [...legacy, ...shared],
    true,
    deviceBackup?.ownerUserId === userId ? deviceBackup.aliases : [],
  )).operations;
}

export async function claimDevicePendingForFlush(
  userId: string,
): Promise<DevicePendingOperation[]> {
  let claimed: DevicePendingOperation[] = [];
  let settlementCapacityBlocked = false;
  const state = await updateStoredPendingState<
    DevicePendingOperation,
    PendingMutationSettlement
  >(userId, current => {
    const merged = mergePendingOperations(current.operations.flatMap(operation => {
      const normalized = normalizePendingOperation(operation);
      if (!normalized) return [];
      const scoped = scopePendingOperation(normalized, userId);
      return scoped ? [scoped] : [];
    }));
    const storedSettlementIds = new Set(
      current.settlements.map(settlement => settlement.logicalOperationId),
    );
    const newSettlementIds = new Set<string>();
    merged.forEach(operation => {
      operation.logicalOperations?.forEach(logicalOperation => {
        if (!storedSettlementIds.has(logicalOperation.id)) {
          newSettlementIds.add(logicalOperation.id);
        }
      });
    });
    const availableSettlementSlots = Math.max(
      0,
      MAX_PENDING_MUTATION_SETTLEMENTS - current.settlements.length,
    );
    if (newSettlementIds.size > availableSettlementSlots) {
      settlementCapacityBlocked = true;
      return { ...current, operations: merged };
    }
    const operations = merged.map(operation => ({ ...operation, inFlight: true as const }));
    claimed = operations;
    return { ...current, operations };
  });
  replaceBrowserPending(userId, state.operations);
  if (settlementCapacityBlocked) throw new PendingMutationSettlementCapacityError();
  return claimed;
}

export async function clearDevicePending(userId: string): Promise<void> {
  await updateStoredPendingOperations<DevicePendingOperation>(userId, () => []);
  replaceBrowserPending(userId, []);
}

export async function recordDeviceCardAlias(
  userId: string,
  fromCardId: string,
  authoritativeCard: CardData,
  sourceBaseRevision: number,
  sourceLibraryEpoch: number,
): Promise<DevicePendingOperation[]> {
  if (fromCardId === authoritativeCard.id) return loadDevicePending(userId);
  const targetRevision = Number.isSafeInteger(authoritativeCard.revision)
    && Number(authoritativeCard.revision) >= 0
    ? Number(authoritativeCard.revision)
    : 0;
  const targetLibraryEpoch = Number.isSafeInteger(authoritativeCard.libraryEpoch)
    && Number(authoritativeCard.libraryEpoch) >= 0
    ? Number(authoritativeCard.libraryEpoch)
    : 0;
  const incomingAlias: PendingCardAlias = {
    fromCardId,
    toCardId: authoritativeCard.id,
    sourceBaseRevision,
    sourceLibraryEpoch,
    targetRevision,
    targetLibraryEpoch,
    createdAt: new Date().toISOString(),
  };
  const state = await updateStoredPendingState<DevicePendingOperation>(userId, current => {
    const aliases = mergePendingCardAliases([...current.aliases, incomingAlias]);
    const operations = current.operations.flatMap(operation => {
      const normalized = normalizePendingOperation(operation);
      if (!normalized) return [];
      const scoped = scopePendingOperation(normalized, userId);
      return scoped ? [retargetCardOperationWithAliases(scoped, aliases)] : [];
    });
    return {
      ...current,
      aliases,
      operations: mergePendingOperations(operations),
    };
  });
  replaceBrowserPending(userId, state.operations);
  const response = await requestDeviceCardSave(
    [authoritativeCard],
    1,
    state.operations,
    'reconcile',
    userId,
    state.aliases,
  );
  if (response && response.status !== 409 && !response.ok) {
    throw new Error(`Device card alias reconciliation failed (${response.status}).`);
  }
  return state.operations;
}

export async function loadDeviceCards(): Promise<DeviceCardBackup | null> {
  if (!DEVICE_SYNC_AVAILABLE) return null;
  try {
    const response = await fetchDeviceEndpoint(DEVICE_CARDS_ENDPOINT, { cache: 'no-store' });
    if (!response.ok) return null;
    const data = await response.json();
    const ownership = resolveDeviceBackupOwnership(data);
    const cards = Array.isArray(data?.cards) ? data.cards : Array.isArray(data?.items) ? data.items : [];
    const pending = Array.isArray(data?.pending)
      ? data.pending.flatMap((operation: unknown) => {
          const normalized = normalizePendingOperation(operation);
          return normalized ? [normalized] : [];
        })
      : [];
    const aliases = Array.isArray(data?.aliases)
      ? data.aliases.flatMap((value: unknown) => {
          const alias = normalizePendingCardAlias(value);
          return alias ? [alias] : [];
        })
      : [];
    const cloudSync = isCloudSyncState(data?.cloudSync) ? data.cloudSync : null;
    return {
      cards,
      total: Number.isFinite(data?.total) ? Math.max(cards.length, Math.floor(data.total)) : cards.length,
      updatedAt: typeof data?.updatedAt === 'string' ? data.updatedAt : null,
      pending,
      aliases,
      cloudSync,
      ownerUserId: ownership.conflicted ? undefined : ownership.ownerUserId,
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
  aliases?: readonly PendingCardAlias[],
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
      ...(aliases !== undefined ? { aliases } : {}),
      ...(ownerUserId !== undefined ? { ownerUserId } : {}),
    }),
  });
}

export async function saveDeviceCards(
  cards: CardData[],
  total = cards.length,
  pending?: DevicePendingOperation[],
  mode: 'replace' | 'merge' | 'reconcile' = 'replace',
  ownerUserId?: string | null,
  aliases?: readonly PendingCardAlias[],
): Promise<void> {
  try {
    await requestDeviceCardSave(cards, total, pending, mode, ownerUserId, aliases);
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
    receiptProtocol: 1 as const,
    card,
    baseRevision: card.revision ?? 0,
    fieldMask: [] as (keyof CardData)[],
    libraryEpoch: requiresEpochBinding ? -1 : card.libraryEpoch ?? 0,
    updatedAt: new Date().toISOString(),
    ...(userId ? { ownerUserId: userId } : {}),
  }));
  const queued = userId
    ? (await persistDevicePending(userId, pending)).incoming
    : pending;
  await saveDeviceCards(cards, Math.max(cards.length, total), queued, 'merge', userId ?? null);
  return queued;
}

export async function queueDevicePatches(
  changes: readonly DeviceCardPatch[],
  total = changes.length,
  userId?: string,
  operationId?: string,
  requiresEpochBinding = false,
  accounting?: DeviceMutationAccounting,
): Promise<DevicePendingOperation[]> {
  if (changes.length === 0) return [];
  const updatedAt = new Date().toISOString();
  const pending = changes.map(({ card, fields, baseFields }, index) => ({
    type: 'patch' as const,
    operation: 'patch' as const,
    opId: operationId ? `${operationId}${changes.length > 1 ? `-${index}` : ''}` : createOperationId(),
    receiptProtocol: 1 as const,
    ...(operationId ? {
      logicalOperations: [{
        id: operationId,
        kind: 'patch' as const,
        ...(accounting ? { accounting } : {}),
      }],
    } : {}),
    cardId: card.id,
    fields,
    ...(baseFields ? { baseFields } : {}),
    baseRevision: card.revision ?? 0,
    fieldMask: operationFieldMask(fields),
    libraryEpoch: requiresEpochBinding ? -1 : card.libraryEpoch ?? 0,
    updatedAt,
    ...(userId ? { ownerUserId: userId } : {}),
  }));
  const queued = userId
    ? (await persistDevicePending(userId, pending)).incoming
    : pending;
  const backupCards = changes.map((change, index) => {
    const operation = queued[index];
    if (!operation || operation.type !== 'patch' || operation.cardId === change.card.id) {
      return change.card;
    }
    return {
      ...change.card,
      id: operation.cardId,
      revision: operation.baseRevision,
      libraryEpoch: operation.libraryEpoch,
    };
  });
  await saveDeviceCards(
    backupCards,
    Math.max(changes.length, total),
    queued,
    'merge',
    userId ?? null,
  );
  return queued;
}

export interface DeviceDeleteContext {
  libraryEpoch?: number;
  baseRevisions?: Readonly<Record<string, number>>;
  logicalOperationId?: string;
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
    receiptProtocol: 1 as const,
    ...(context.logicalOperationId ? {
      logicalOperations: [{ id: context.logicalOperationId, kind: 'delete' as const }],
    } : {}),
    cardId,
    baseRevision: context.baseRevisions?.[cardId] ?? 0,
    fieldMask: [] as (keyof CardData)[],
    libraryEpoch: context.libraryEpoch ?? 0,
    updatedAt: new Date().toISOString(),
    ...(userId ? { ownerUserId: userId } : {}),
  }));
  const queued = userId
    ? (await persistDevicePending(userId, pending)).incoming
    : pending;
  await saveDeviceCards([], 0, queued, 'merge', userId ?? null);
  return queued;
}

async function acknowledgeSharedDevicePending(
  userId: string,
  operations: readonly DevicePendingOperation[],
): Promise<void> {
  if (!DEVICE_SYNC_AVAILABLE || operations.length === 0) return;
  const response = await fetchDeviceEndpoint(`${DEVICE_CARDS_ENDPOINT}/ack`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, operations }),
  });
  // A different account's immutable backup cannot contain this owner's
  // operations. Cloud has already accepted them, so only the owner-scoped
  // browser queue still needs acknowledgement.
  if (response.status === 409) return;
  if (!response.ok) throw new Error(`Device pending acknowledgement failed (${response.status}).`);
}

function logicalOperationTargetKey(cardId: string, logicalOperationId: string): string {
  return JSON.stringify([cardId, logicalOperationId]);
}

function partitionAcknowledgedPendingOperations(
  current: readonly DevicePendingOperation[],
  acknowledged: readonly DevicePendingOperation[],
): {
  operations: DevicePendingOperation[];
  logicalOperationKeys: Set<string>;
} {
  const acknowledgedOperationKeys = new Set(
    acknowledged.flatMap(operation => operation.opId
      ? [`${operation.opId}:${operationTarget(operation)}`]
      : []),
  );
  const acknowledgedAt = new Map<string, string>();
  const acknowledgedLogicalOperationKeys = new Set<string>();
  acknowledged.forEach(operation => {
    const target = operationTarget(operation);
    const previous = acknowledgedAt.get(target);
    if (!previous || previous < operation.updatedAt) acknowledgedAt.set(target, operation.updatedAt);
    operation.logicalOperations?.forEach(logicalOperation => {
      acknowledgedLogicalOperationKeys.add(logicalOperationTargetKey(target, logicalOperation.id));
    });
  });
  const logicalOperationKeys = new Set<string>();
  const operations = mergePendingOperations(current.flatMap(operation => {
    const normalized = normalizePendingOperation(operation);
    return normalized ? [normalized] : [];
  })).filter(operation => {
    const target = operationTarget(operation);
    const flushedAt = acknowledgedAt.get(target);
    const matched = operation.opId
      ? acknowledgedOperationKeys.has(`${operation.opId}:${target}`)
      : Boolean(flushedAt && operation.updatedAt <= flushedAt);
    operation.logicalOperations?.forEach(logicalOperation => {
      const key = logicalOperationTargetKey(target, logicalOperation.id);
      // A claimed command may be folded into a successor while its cloud write is
      // in flight. The carried logical ID remains eligible, but a drained stale
      // claimant cannot recreate it after the ID disappears from durable state.
      if (acknowledgedLogicalOperationKeys.has(key)) logicalOperationKeys.add(key);
    });
    return !matched;
  });
  return { operations, logicalOperationKeys };
}

function removeSettledLogicalOperations(
  operations: readonly DevicePendingOperation[],
  settledLogicalOperationIds: ReadonlySet<string>,
): DevicePendingOperation[] {
  return operations.map(operation => {
    const logicalOperations = operation.logicalOperations?.filter(
      logicalOperation => !settledLogicalOperationIds.has(logicalOperation.id),
    );
    if (!operation.logicalOperations || logicalOperations?.length === operation.logicalOperations.length) {
      return operation;
    }
    if (logicalOperations?.length) return { ...operation, logicalOperations };
    const { logicalOperations: _settled, ...physicalOperation } = operation;
    return physicalOperation as DevicePendingOperation;
  });
}

export async function settleDevicePending(
  userId: string,
  operations: readonly DevicePendingOperation[],
  settlements: readonly PendingMutationSettlement[],
): Promise<PendingMutationSettlement[]> {
  if (
    !userId
    || operations.some(operation => operation.ownerUserId !== userId)
    || settlements.some(settlement => settlement.ownerUserId !== userId)
  ) {
    throw new Error('Pending mutation settlement ownership did not match the active account.');
  }
  const normalizedSettlements = settlements.map(settlement => {
    const normalized = normalizePendingMutationSettlement(settlement);
    if (!normalized) throw new Error('Pending mutation settlement was invalid.');
    return normalized;
  });
  await acknowledgeSharedDevicePending(userId, operations);
  const committedSettlements: PendingMutationSettlement[] = [];
  const newlyStoredSettlements: PendingMutationSettlement[] = [];
  let settlementCapacityBlocked = false;
  const state = await updateStoredPendingState<
    DevicePendingOperation,
    PendingMutationSettlement
  >(userId, current => {
    const acknowledged = partitionAcknowledgedPendingOperations(
      current.operations,
      operations,
    );
    const storedSettlements = new Map(
      current.settlements.map(settlement => [settlement.logicalOperationId, settlement]),
    );
    const newSettlementIds = new Set(
      normalizedSettlements.flatMap(settlement => (
        !storedSettlements.has(settlement.logicalOperationId)
        && acknowledged.logicalOperationKeys.has(
          logicalOperationTargetKey(settlement.cardId, settlement.logicalOperationId),
        )
          ? [settlement.logicalOperationId]
          : []
      )),
    );
    const availableSettlementSlots = Math.max(
      0,
      MAX_PENDING_MUTATION_SETTLEMENTS - storedSettlements.size,
    );
    if (newSettlementIds.size > availableSettlementSlots) {
      settlementCapacityBlocked = true;
      return current;
    }
    normalizedSettlements.forEach(settlement => {
      const existingRecord = storedSettlements.get(settlement.logicalOperationId);
      const existing = normalizePendingMutationSettlement(existingRecord?.settlement);
      if (existing) {
        committedSettlements.push(existing);
        return;
      }
      if (!acknowledged.logicalOperationKeys.has(
          logicalOperationTargetKey(settlement.cardId, settlement.logicalOperationId),
        )) return;
      storedSettlements.set(settlement.logicalOperationId, {
        logicalOperationId: settlement.logicalOperationId,
        settledAt: settlement.settledAt,
        settlement,
      });
      committedSettlements.push(settlement);
      newlyStoredSettlements.push(settlement);
    });
    const settledLogicalOperationIds = new Set(storedSettlements.keys());
    return {
      ...current,
      operations: removeSettledLogicalOperations(
        acknowledged.operations,
        settledLogicalOperationIds,
      ),
      settlements: [...storedSettlements.values()],
    };
  });
  replaceBrowserPending(userId, state.operations);
  if (settlementCapacityBlocked) throw new PendingMutationSettlementCapacityError();
  newlyStoredSettlements.forEach(publishPendingMutationSettlement);
  return committedSettlements;
}

export async function loadPendingMutationSettlements(
  userId: string,
  maximum = MAX_PENDING_MUTATION_SETTLEMENTS_PER_DRAIN,
): Promise<PendingMutationSettlement[]> {
  const boundedMaximum = Number.isSafeInteger(maximum) && maximum > 0
    ? Math.min(maximum, MAX_PENDING_MUTATION_SETTLEMENTS_PER_DRAIN)
    : MAX_PENDING_MUTATION_SETTLEMENTS_PER_DRAIN;
  const state = await loadStoredPendingState<
    DevicePendingOperation,
    PendingMutationSettlement
  >(userId);
  const settlements: PendingMutationSettlement[] = [];
  for (const record of state.settlements) {
    const settlement = normalizePendingMutationSettlement(record.settlement);
    if (settlement?.ownerUserId !== userId) continue;
    settlements.push(settlement);
    if (settlements.length >= boundedMaximum) break;
  }
  return settlements;
}

export async function acknowledgePendingMutationSettlements(
  userId: string,
  logicalOperationIds: readonly string[],
): Promise<void> {
  if (!userId || logicalOperationIds.length === 0) return;
  const acknowledged = new Set(
    logicalOperationIds.filter(logicalOperationId => logicalOperationId.length > 0),
  );
  if (acknowledged.size === 0) return;
  await updateStoredPendingState<DevicePendingOperation, PendingMutationSettlement>(
    userId,
    current => ({
      ...current,
      settlements: current.settlements.filter(
        settlement => !acknowledged.has(settlement.logicalOperationId),
      ),
    }),
  );
}

export async function acknowledgePendingMutationSettlement(
  userId: string,
  logicalOperationId: string,
): Promise<void> {
  await acknowledgePendingMutationSettlements(userId, [logicalOperationId]);
}

export async function acknowledgeDevicePending(operations: DevicePendingOperation[]): Promise<void> {
  if (operations.length === 0) return;
  const operationsByOwner = new Map<string, DevicePendingOperation[]>();
  operations.forEach(operation => {
    if (!operation.ownerUserId) return;
    operationsByOwner.set(operation.ownerUserId, [...(operationsByOwner.get(operation.ownerUserId) ?? []), operation]);
  });
  await Promise.all([...operationsByOwner].map(([userId, acknowledged]) =>
    settleDevicePending(userId, acknowledged, [])));
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

function normalizeMutationAccounting(value: unknown): DeviceMutationAccounting | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const source = value as Record<string, unknown>;
  if (source.version !== 1) return undefined;
  const xp = source.xp;
  if (xp === undefined) return { version: 1 };
  if (!xp || typeof xp !== 'object' || Array.isArray(xp)) return undefined;
  const delta = (xp as Record<string, unknown>).delta;
  if (!Number.isSafeInteger(delta) || Number(delta) < 1 || Number(delta) > 1_000) {
    return undefined;
  }
  return { version: 1, xp: { delta: Number(delta) } };
}

function normalizeLogicalOperations(value: unknown): DeviceLogicalOperation[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const operations = new Map<string, DeviceLogicalOperation>();
  value.forEach(candidate => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return;
    const source = candidate as Record<string, unknown>;
    if (
      typeof source.id !== 'string'
      || source.id.length < 1
      || source.id.length > 512
      || !['patch', 'delete'].includes(String(source.kind))
    ) return;
    const accounting = normalizeMutationAccounting(source.accounting);
    const existing = operations.get(source.id);
    if (!existing || (!existing.accounting && accounting)) {
      operations.set(source.id, {
        id: source.id,
        kind: source.kind as DeviceLogicalOperation['kind'],
        ...(accounting ? { accounting } : {}),
      });
    }
  });
  return operations.size > 0 ? [...operations.values()] : undefined;
}

function normalizePendingOperation(value: unknown): DevicePendingOperation | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const updatedAt = typeof source.updatedAt === 'string'
    && !Number.isNaN(new Date(source.updatedAt).getTime())
    ? new Date(source.updatedAt).toISOString()
    : new Date(0).toISOString();
  const logicalOperations = normalizeLogicalOperations(source.logicalOperations);
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
    ...(source.receiptProtocol === 1 ? { receiptProtocol: 1 as const } : {}),
    ...(source.inFlight === true || source.receiptProtocol !== 1 ? { inFlight: true as const } : {}),
    ...(typeof source.ownerUserId === 'string' && source.ownerUserId.length > 0 && source.ownerUserId.length <= 256
      ? { ownerUserId: source.ownerUserId }
      : {}),
    ...(logicalOperations ? { logicalOperations } : {}),
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
    const sourceBaseFields = source.baseFields
      && typeof source.baseFields === 'object'
      && !Array.isArray(source.baseFields)
      ? source.baseFields as Partial<CardData>
      : undefined;
    const baseFields = sourceBaseFields
      ? selectMutableCardPatch(sourceBaseFields, fieldMask)
      : undefined;
    const hasCompleteBaseFields = baseFields
      && fieldMask.every(field => Object.prototype.hasOwnProperty.call(baseFields, field));
    return {
      ...common,
      type: 'patch',
      operation: source.operation === 'review' ? 'review' : 'patch',
      cardId: source.cardId,
      fields,
      ...(hasCompleteBaseFields ? { baseFields } : {}),
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

function normalizePendingCreateSettlement(value: unknown): PendingCreateSettlement | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const operation = normalizePendingOperation(source.operation);
  const authoritativeCard = source.authoritativeCard;
  if (
    operation?.type !== 'upsert'
    || !operation.ownerUserId
    || !authoritativeCard
    || typeof authoritativeCard !== 'object'
    || Array.isArray(authoritativeCard)
    || typeof (authoritativeCard as Record<string, unknown>).id !== 'string'
    || !(authoritativeCard as Record<string, unknown>).id
    || !['created', 'replayed', 'duplicate'].includes(String(source.outcome))
  ) return null;
  return {
    operation,
    authoritativeCard: authoritativeCard as CardData,
    outcome: source.outcome as PendingCreateSettlementOutcome,
  };
}

function normalizePendingMutationSettlement(
  value: unknown,
): PendingMutationSettlement | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  if (
    typeof source.ownerUserId !== 'string'
    || source.ownerUserId.length < 1
    || source.ownerUserId.length > 256
    || typeof source.logicalOperationId !== 'string'
    || source.logicalOperationId.length < 1
    || source.logicalOperationId.length > 512
    || !['patch', 'delete'].includes(String(source.kind))
    || typeof source.cardId !== 'string'
    || source.cardId.length < 1
    || source.cardId.length > 1500
    || typeof source.settledAt !== 'string'
    || Number.isNaN(new Date(source.settledAt).getTime())
    || ![
      'applied',
      'discarded-stale-library-epoch',
      'discarded-missing',
      'discarded-superseded',
    ].includes(String(source.outcome))
  ) return null;
  const accounting = normalizeMutationAccounting(source.accounting);
  return {
    ownerUserId: source.ownerUserId,
    logicalOperationId: source.logicalOperationId,
    kind: source.kind as DeviceLogicalOperation['kind'],
    cardId: source.cardId,
    outcome: source.outcome as PendingMutationSettlementOutcome,
    settledAt: new Date(source.settledAt).toISOString(),
    ...(accounting ? { accounting } : {}),
  };
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
