import {
  MAX_PENDING_XP_OPERATIONS,
  addXpToGamification,
  applyPendingXpOperations,
  createStructuredXpOperationId,
  finiteNonNegativeGamificationValue,
  isAppliedXpOperation,
  normalizeAppliedXpOperationIds,
  normalizeAppliedXpSequenceByClient,
  normalizeGamificationHistory,
  normalizePendingXpOperations,
  rebaseGamificationSnapshots,
  type GamificationSnapshotWithHistory,
  type PendingXpOperation,
} from './gamificationModel';

export interface GamificationStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface StoredGamificationSnapshot extends GamificationSnapshotWithHistory {}

export class PendingXpQueueFullError extends Error {
  readonly code = 'GAMIFICATION_PENDING_XP_QUEUE_FULL';

  constructor() {
    super(`Cannot award XP while ${MAX_PENDING_XP_OPERATIONS} operations are waiting to sync.`);
    this.name = 'PendingXpQueueFullError';
  }
}

const scopeSegment = (userId: string | null) => userId ? `user:${userId}` : 'anonymous';

export const gamificationStorageKeys = (userId: string | null) => {
  const prefix = `lingoflash_gamification:${scopeSegment(userId)}`;
  return {
    snapshot: `${prefix}:snapshot`,
    streak: `${prefix}:streak`,
    xp: `${prefix}:xp`,
    lastActive: `${prefix}:last_active`,
    history: `${prefix}:xp_history`,
    pendingOperations: `${prefix}:pending_xp_operations`,
    operationClientId: `${prefix}:xp_operation_client_id`,
    operationSequence: `${prefix}:xp_operation_sequence`,
  };
};

const readValue = (storage: GamificationStorage, key: string): string | null => {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
};

const writeValue = (storage: GamificationStorage, key: string, value: string) => {
  try {
    storage.setItem(key, value);
  } catch {
    // State remains available in React memory when browser storage is denied or full.
  }
};

const STORED_GAMIFICATION_VERSION = 1;

const readNumber = (storage: GamificationStorage, key: string): number => {
  const value = Number(readValue(storage, key) ?? 0);
  return finiteNonNegativeGamificationValue(value);
};

const readHistory = (storage: GamificationStorage, key: string): Record<string, number> => {
  try {
    return normalizeGamificationHistory(JSON.parse(readValue(storage, key) ?? '{}'));
  } catch {
    return {};
  }
};

const readPendingOperations = (
  storage: GamificationStorage,
  key: string,
): PendingXpOperation[] => {
  try {
    return normalizePendingXpOperations(JSON.parse(readValue(storage, key) ?? '[]'));
  } catch {
    return [];
  }
};

const readLastActive = (storage: GamificationStorage, key: string): string | null => {
  const value = readValue(storage, key);
  return value && value.length <= 64 && Number.isFinite(Date.parse(value)) ? value : null;
};

const normalizeStoredGamificationSnapshot = (value: unknown): StoredGamificationSnapshot | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const envelope = value as Record<string, unknown>;
  if (
    envelope.version !== STORED_GAMIFICATION_VERSION
    || !envelope.snapshot
    || typeof envelope.snapshot !== 'object'
    || Array.isArray(envelope.snapshot)
  ) return null;
  const source = envelope.snapshot as Record<string, unknown>;
  const lastActive = typeof source.lastActive === 'string'
    && source.lastActive.length <= 64
    && Number.isFinite(Date.parse(source.lastActive))
    ? source.lastActive
    : null;
  const pendingOperations = normalizePendingXpOperations(source.pendingOperations);
  return {
    streak: finiteNonNegativeGamificationValue(source.streak),
    xp: finiteNonNegativeGamificationValue(source.xp),
    lastActive,
    history: normalizeGamificationHistory(source.history),
    ...(pendingOperations.length > 0 ? { pendingOperations } : {}),
  };
};

const readStoredGamificationSnapshot = (
  storage: GamificationStorage,
  key: string,
): StoredGamificationSnapshot | null => {
  const serialized = readValue(storage, key);
  if (serialized === null) return null;
  try {
    return normalizeStoredGamificationSnapshot(JSON.parse(serialized));
  } catch {
    return null;
  }
};

const serializeGamificationSnapshot = (snapshot: StoredGamificationSnapshot): string => {
  const pendingOperations = normalizePendingXpOperations(snapshot.pendingOperations);
  return JSON.stringify({
    version: STORED_GAMIFICATION_VERSION,
    snapshot: {
      streak: finiteNonNegativeGamificationValue(snapshot.streak),
      xp: finiteNonNegativeGamificationValue(snapshot.xp),
      lastActive: snapshot.lastActive ?? null,
      history: normalizeGamificationHistory(snapshot.history),
      ...(pendingOperations.length > 0 ? { pendingOperations } : {}),
    },
  });
};

export const readGamificationSnapshot = (
  storage: GamificationStorage,
  userId: string | null,
): StoredGamificationSnapshot => {
  const keys = gamificationStorageKeys(userId);
  const storedSnapshot = readStoredGamificationSnapshot(storage, keys.snapshot);
  const legacySnapshot = storedSnapshot ?? {
    streak: readNumber(storage, keys.streak),
    xp: readNumber(storage, keys.xp),
    lastActive: readLastActive(storage, keys.lastActive),
    history: readHistory(storage, keys.history),
    pendingOperations: readPendingOperations(storage, keys.pendingOperations),
  };
  const storedPendingOperations = normalizePendingXpOperations(legacySnapshot.pendingOperations);
  const pendingOperations = upgradeLegacyPendingXpOperations(
    storage,
    userId,
    storedPendingOperations,
  );
  const snapshot = {
    streak: legacySnapshot.streak,
    xp: legacySnapshot.xp,
    lastActive: legacySnapshot.lastActive,
    history: legacySnapshot.history,
    ...(pendingOperations.length > 0 ? { pendingOperations } : {}),
  };
  if (
    storedSnapshot === null
    || pendingOperations.some((operation, index) => operation.id !== storedPendingOperations[index]?.id)
  ) {
    writeGamificationSnapshot(storage, userId, snapshot);
  }
  return snapshot;
};

export const writeGamificationSnapshot = (
  storage: GamificationStorage,
  userId: string | null,
  snapshot: StoredGamificationSnapshot,
) => {
  const keys = gamificationStorageKeys(userId);
  writeValue(storage, keys.snapshot, serializeGamificationSnapshot(snapshot));
};

let fallbackClientSequence = 0;
const inMemoryOperationStreams = new Map<string, { clientId: string; sequence: number }>();
const initializedOperationStreams = new Set<string>();

const createXpClientId = (): string => {
  try {
    const uuid = globalThis.crypto?.randomUUID?.();
    if (uuid) return uuid;
  } catch {
    // Fall back to a process-local entropy source when Web Crypto is unavailable.
  }
  fallbackClientSequence = fallbackClientSequence === Number.MAX_SAFE_INTEGER
    ? 1
    : fallbackClientSequence + 1;
  return [
    'client',
    Date.now().toString(36),
    fallbackClientSequence.toString(36),
    Math.random().toString(36).slice(2, 12),
  ].join('-');
};

const operationStreamStorage = (fallback: GamificationStorage): GamificationStorage => {
  try {
    return globalThis.sessionStorage ?? fallback;
  } catch {
    return fallback;
  }
};

const shouldForkClonedOperationStream = (): boolean => {
  try {
    const [navigationEntry] = globalThis.window?.performance?.getEntriesByType('navigation') ?? [];
    const navigationType = (navigationEntry as Partial<PerformanceNavigationTiming> | undefined)
      ?.type;
    if (navigationType) return navigationType === 'navigate';
    // sessionStorage is copied only when a new browsing context keeps an opener. When
    // Navigation Timing is unavailable, fork conservatively in that copied context.
    return Boolean(globalThis.window?.opener);
  } catch {
    return true;
  }
};

const createPendingXpOperation = (
  storage: GamificationStorage,
  userId: string | null,
  delta: number,
  day: string,
): PendingXpOperation => {
  const keys = gamificationStorageKeys(userId);
  const streamStorage = operationStreamStorage(storage);
  const memoryStream = inMemoryOperationStreams.get(keys.operationClientId);
  let clientId = readValue(streamStorage, keys.operationClientId);
  let previousSequence = Number(readValue(streamStorage, keys.operationSequence) ?? 0);
  const firstOperationInDocument = !initializedOperationStreams.has(keys.operationClientId);
  initializedOperationStreams.add(keys.operationClientId);
  if (
    memoryStream
    && (!clientId || clientId === memoryStream.clientId)
    && memoryStream.sequence >= previousSequence
  ) {
    clientId = memoryStream.clientId;
    previousSequence = memoryStream.sequence;
  }
  if (firstOperationInDocument && clientId && shouldForkClonedOperationStream()) {
    clientId = null;
    previousSequence = 0;
  }
  if (
    !clientId
    || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(clientId)
    || !Number.isSafeInteger(previousSequence)
    || previousSequence < 0
    || previousSequence >= Number.MAX_SAFE_INTEGER
  ) {
    clientId = createXpClientId();
    previousSequence = 0;
    writeValue(streamStorage, keys.operationClientId, clientId);
  }
  const sequence = previousSequence + 1;
  inMemoryOperationStreams.set(keys.operationClientId, { clientId, sequence });
  writeValue(streamStorage, keys.operationSequence, String(sequence));
  return {
    id: createStructuredXpOperationId(clientId, sequence),
    clientId,
    sequence,
    delta,
    day,
  };
};

const upgradeLegacyPendingXpOperations = (
  storage: GamificationStorage,
  userId: string | null,
  operations: readonly PendingXpOperation[],
  knownOperations: readonly PendingXpOperation[] = [],
): PendingXpOperation[] => {
  const knownMigrationByLegacyId = new Map(
    knownOperations
      .filter(operation => operation.legacyId)
      .map(operation => [operation.legacyId as string, operation]),
  );
  return operations.map(operation => {
  if (operation.clientId && operation.sequence) return operation;
  const knownMigration = knownMigrationByLegacyId.get(operation.id);
  if (knownMigration) return knownMigration;
  return {
    ...createPendingXpOperation(storage, userId, operation.delta, operation.day),
    legacyId: operation.id,
  };
  });
};

const mergePendingXpOperations = (
  sources: readonly unknown[],
  excludedOperationIds: ReadonlySet<string> = new Set(),
  rejectOverflow = false,
): PendingXpOperation[] => {
  const merged: PendingXpOperation[] = [];
  const seen = new Set<string>();
  for (const source of sources) {
    for (const operation of normalizePendingXpOperations(source)) {
      if (
        seen.has(operation.id)
        || excludedOperationIds.has(operation.id)
        || (operation.legacyId !== undefined && excludedOperationIds.has(operation.legacyId))
      ) continue;
      if (merged.length >= MAX_PENDING_XP_OPERATIONS) {
        if (rejectOverflow) throw new PendingXpQueueFullError();
        return merged;
      }
      seen.add(operation.id);
      merged.push(operation);
    }
  }
  return merged;
};

export const addXpToStoredGamification = (
  storage: GamificationStorage,
  userId: string | null,
  snapshot: StoredGamificationSnapshot,
  amount: number,
  now: Date,
  operationId?: string,
): StoredGamificationSnapshot => {
  const day = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const [validatedCandidate] = normalizePendingXpOperations([{
    id: operationId ?? 'xp-candidate',
    delta: amount,
    day,
  }], 1);
  if (!validatedCandidate) return snapshot;
  let operation = operationId ? validatedCandidate : undefined;
  const appliedOperationIds = new Set(normalizeAppliedXpOperationIds(snapshot.appliedOperationIds));
  const appliedOperationSequenceByClient = normalizeAppliedXpSequenceByClient(
    snapshot.appliedOperationSequenceByClient,
  );
  const persisted = readGamificationSnapshot(storage, userId);
  const migratedSnapshotOperations = upgradeLegacyPendingXpOperations(
    storage,
    userId,
    normalizePendingXpOperations(snapshot.pendingOperations),
    persisted.pendingOperations,
  );
  const snapshotOperations = mergePendingXpOperations(
    [migratedSnapshotOperations],
    appliedOperationIds,
  );
  const snapshotOperationIds = new Set(snapshotOperations.map(candidate => candidate.id));
  const pendingOperations = mergePendingXpOperations(
    [snapshotOperations, persisted.pendingOperations],
    appliedOperationIds,
  );
  const persistedOperationsToApply = pendingOperations
    .filter(candidate => !snapshotOperationIds.has(candidate.id));
  const synchronized = {
    ...applyPendingXpOperations(snapshot, persistedOperationsToApply),
    ...(pendingOperations.length > 0 ? { pendingOperations } : { pendingOperations: undefined }),
  };
  if (operation) {
    const existingOperation = operation;
    if (
      pendingOperations.some(candidate => candidate.id === existingOperation.id)
      || isAppliedXpOperation(
        existingOperation,
        appliedOperationIds,
        appliedOperationSequenceByClient,
      )
    ) {
      writeGamificationSnapshot(storage, userId, synchronized);
      return synchronized;
    }
  }
  if (pendingOperations.length >= MAX_PENDING_XP_OPERATIONS) {
    throw new PendingXpQueueFullError();
  }
  if (!operation) {
    [operation] = normalizePendingXpOperations([
      createPendingXpOperation(storage, userId, amount, day),
    ], 1);
    if (!operation) return synchronized;
  }
  const next = {
    ...addXpToGamification(synchronized, operation.delta, now),
    pendingOperations: [...pendingOperations, operation],
  };
  writeGamificationSnapshot(storage, userId, next);
  return next;
};

export const acknowledgeStoredGamificationSave = (
  storage: GamificationStorage,
  userId: string | null,
  current: StoredGamificationSnapshot,
  committed: StoredGamificationSnapshot,
  acknowledgedOperationIds: readonly string[],
): StoredGamificationSnapshot => {
  const acknowledged = new Set(acknowledgedOperationIds);
  const persisted = readGamificationSnapshot(storage, userId);
  const migratedCurrentOperations = upgradeLegacyPendingXpOperations(
    storage,
    userId,
    normalizePendingXpOperations(current.pendingOperations),
    persisted.pendingOperations,
  );
  const remainingOperations = mergePendingXpOperations([
    migratedCurrentOperations,
    persisted.pendingOperations,
  ], acknowledged, true);
  const rebased = rebaseGamificationSnapshots({
    ...current,
    pendingOperations: remainingOperations,
  }, committed);
  writeGamificationSnapshot(storage, userId, rebased);
  return rebased;
};
