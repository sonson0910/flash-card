import {
  MAX_PENDING_XP_OPERATIONS,
  addXpToGamification,
  applyPendingXpOperations,
  createKeyedXpOperationId,
  createStructuredXpOperationId,
  finiteNonNegativeGamificationValue,
  isAppliedXpOperation,
  isKeyedXpOperation,
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
  removeItem?(key: string): void;
  key?(index: number): string | null;
  readonly length?: number;
}

export interface StoredGamificationSnapshot extends GamificationSnapshotWithHistory {}

export const GAMIFICATION_PENDING_CAPACITY_RELEASED_EVENT =
  'sonflash:gamification-pending-capacity-released';

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
    pendingOperationJournalPrefix: `${prefix}:pending_xp_operation:`,
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

const writeValue = (storage: GamificationStorage, key: string, value: string): boolean => {
  try {
    storage.setItem(key, value);
    return true;
  } catch {
    // State remains available in React memory when browser storage is denied or full.
    return false;
  }
};

const removeValue = (storage: GamificationStorage, key: string): boolean => {
  if (!storage.removeItem) return false;
  try {
    storage.removeItem(key);
    return true;
  } catch {
    return false;
  }
};

const keyedOperationJournalKey = (
  userId: string | null,
  operationId: string,
): string => `${gamificationStorageKeys(userId).pendingOperationJournalPrefix}${operationId}`;

const writeKeyedOperationJournal = (
  storage: GamificationStorage,
  userId: string | null,
  operation: PendingXpOperation,
): boolean => {
  if (!isKeyedXpOperation(operation) || !storage.key || !storage.removeItem) return false;
  try {
    if (!Number.isSafeInteger(storage.length) || (storage.length ?? -1) < 0) return false;
  } catch {
    return false;
  }
  const key = keyedOperationJournalKey(userId, operation.id);
  const existing = readValue(storage, key);
  if (existing !== null) {
    try {
      const [persisted] = normalizePendingXpOperations([JSON.parse(existing)], 1);
      if (
        persisted?.id === operation.id
        && persisted.delta === operation.delta
        && persisted.day === operation.day
      ) return true;
    } catch {
      // Replace malformed journal data with the validated operation below.
    }
  }
  return writeValue(storage, key, JSON.stringify(operation));
};

const readKeyedOperationJournal = (
  storage: GamificationStorage,
  userId: string | null,
): PendingXpOperation[] => {
  if (!storage.key) return [];
  let storageLength: number;
  try {
    storageLength = storage.length ?? 0;
  } catch {
    return [];
  }
  if (!Number.isSafeInteger(storageLength) || storageLength <= 0) return [];
  const prefix = gamificationStorageKeys(userId).pendingOperationJournalPrefix;
  const journalKeys: string[] = [];
  try {
    for (let index = 0; index < storageLength; index += 1) {
      const key = storage.key(index);
      if (key?.startsWith(prefix)) journalKeys.push(key);
      if (journalKeys.length >= MAX_PENDING_XP_OPERATIONS) break;
    }
  } catch {
    return [];
  }
  const operations: PendingXpOperation[] = [];
  for (const key of journalKeys) {
    try {
      const [operation] = normalizePendingXpOperations([
        JSON.parse(readValue(storage, key) ?? 'null'),
      ], 1);
      if (
        operation
        && isKeyedXpOperation(operation)
        && key === `${prefix}${operation.id}`
      ) operations.push(operation);
    } catch {
      // Ignore malformed or unavailable entries without dropping valid journal records.
    }
    if (operations.length >= MAX_PENDING_XP_OPERATIONS) break;
  }
  return operations;
};

const removeKeyedOperationJournalEntries = (
  storage: GamificationStorage,
  userId: string | null,
  operationIds: Iterable<string>,
): void => {
  for (const operationId of operationIds) {
    removeValue(storage, keyedOperationJournalKey(userId, operationId));
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
  const appliedOperationIds = normalizeAppliedXpOperationIds(source.appliedOperationIds);
  const appliedOperationSequenceByClient = normalizeAppliedXpSequenceByClient(
    source.appliedOperationSequenceByClient,
  );
  return {
    streak: finiteNonNegativeGamificationValue(source.streak),
    xp: finiteNonNegativeGamificationValue(source.xp),
    lastActive,
    history: normalizeGamificationHistory(source.history),
    ...(pendingOperations.length > 0 ? { pendingOperations } : {}),
    ...(appliedOperationIds.length > 0 ? { appliedOperationIds } : {}),
    ...(Object.keys(appliedOperationSequenceByClient).length > 0
      ? { appliedOperationSequenceByClient }
      : {}),
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
  const appliedOperationIds = normalizeAppliedXpOperationIds(snapshot.appliedOperationIds);
  const appliedOperationSequenceByClient = normalizeAppliedXpSequenceByClient(
    snapshot.appliedOperationSequenceByClient,
  );
  return JSON.stringify({
    version: STORED_GAMIFICATION_VERSION,
    snapshot: {
      streak: finiteNonNegativeGamificationValue(snapshot.streak),
      xp: finiteNonNegativeGamificationValue(snapshot.xp),
      lastActive: snapshot.lastActive ?? null,
      history: normalizeGamificationHistory(snapshot.history),
      ...(pendingOperations.length > 0 ? { pendingOperations } : {}),
      ...(appliedOperationIds.length > 0 ? { appliedOperationIds } : {}),
      ...(Object.keys(appliedOperationSequenceByClient).length > 0
        ? { appliedOperationSequenceByClient }
        : {}),
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
  const upgradedPendingOperations = upgradeLegacyPendingXpOperations(
    storage,
    userId,
    storedPendingOperations,
  );
  const appliedOperationIds = normalizeAppliedXpOperationIds(legacySnapshot.appliedOperationIds);
  const appliedOperationIdSet = new Set(appliedOperationIds);
  const appliedOperationSequenceByClient = normalizeAppliedXpSequenceByClient(
    legacySnapshot.appliedOperationSequenceByClient,
  );
  const journalOperations = readKeyedOperationJournal(storage, userId);
  const pendingOperations = mergePendingXpOperations(
    [upgradedPendingOperations, journalOperations],
    appliedOperationIdSet,
    false,
    true,
  );
  const upgradedPendingIds = new Set(upgradedPendingOperations.map(operation => operation.id));
  const journalOperationsToApply = pendingOperations
    .filter(operation => !upgradedPendingIds.has(operation.id)
      && !(isKeyedXpOperation(operation) && appliedOperationIdSet.has(operation.id)));
  const snapshot = {
    ...applyPendingXpOperations({
      streak: legacySnapshot.streak,
      xp: legacySnapshot.xp,
      lastActive: legacySnapshot.lastActive,
      history: legacySnapshot.history,
      ...(appliedOperationIds.length > 0 ? { appliedOperationIds } : {}),
      ...(Object.keys(appliedOperationSequenceByClient).length > 0
        ? { appliedOperationSequenceByClient }
        : {}),
    }, journalOperationsToApply),
    ...(pendingOperations.length > 0 ? { pendingOperations } : {}),
  };
  const requiresWrite = storedSnapshot === null
    || journalOperationsToApply.length > 0
    || upgradedPendingOperations.some(
      (operation, index) => operation.id !== storedPendingOperations[index]?.id,
    );
  const snapshotWasWritten = !requiresWrite
    || writeGamificationSnapshot(storage, userId, snapshot);
  if ((storedSnapshot !== null || snapshotWasWritten) && appliedOperationIds.length > 0) {
    removeKeyedOperationJournalEntries(storage, userId, appliedOperationIds);
  }
  return snapshot;
};

export const writeGamificationSnapshot = (
  storage: GamificationStorage,
  userId: string | null,
  snapshot: StoredGamificationSnapshot,
): boolean => {
  const keys = gamificationStorageKeys(userId);
  return writeValue(storage, keys.snapshot, serializeGamificationSnapshot(snapshot));
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
    if (isKeyedXpOperation(operation) || (operation.clientId && operation.sequence)) {
      return operation;
    }
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
  retainAppliedKeyedOperations = false,
): PendingXpOperation[] => {
  const merged: PendingXpOperation[] = [];
  const seen = new Set<string>();
  for (const source of sources) {
    for (const operation of normalizePendingXpOperations(source)) {
      const excluded = excludedOperationIds.has(operation.id)
        || (operation.legacyId !== undefined && excludedOperationIds.has(operation.legacyId));
      if (
        seen.has(operation.id)
        || (excluded && !(retainAppliedKeyedOperations && isKeyedXpOperation(operation)))
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

export interface StoredGamificationMutationResult {
  snapshot: StoredGamificationSnapshot;
  /** True when either the complete snapshot or keyed recovery journal is durable. */
  durablyWritten: boolean;
}

export const addXpToStoredGamificationResult = (
  storage: GamificationStorage,
  userId: string | null,
  snapshot: StoredGamificationSnapshot,
  amount: number,
  now: Date,
  operationId?: string,
): StoredGamificationMutationResult => {
  if (!Number.isFinite(now.getTime())) return { snapshot, durablyWritten: false };
  const day = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const [validatedCandidate] = normalizePendingXpOperations([{
    id: operationId ?? 'xp-candidate',
    delta: amount,
    day,
  }], 1);
  if (!validatedCandidate) return { snapshot, durablyWritten: false };
  let operation = operationId ? validatedCandidate : undefined;
  const persisted = readGamificationSnapshot(storage, userId);
  const persistedSnapshotWasDurable = readStoredGamificationSnapshot(
    storage,
    gamificationStorageKeys(userId).snapshot,
  ) !== null;
  const persistedAppliedOperationIds = normalizeAppliedXpOperationIds(
    persisted.appliedOperationIds,
  );
  const persistedAppliedOperationIdSet = new Set(persistedAppliedOperationIds);
  const persistedAppliedOperationSequenceByClient = normalizeAppliedXpSequenceByClient(
    persisted.appliedOperationSequenceByClient,
  );
  const appliedOperationIds = normalizeAppliedXpOperationIds([
    ...normalizeAppliedXpOperationIds(snapshot.appliedOperationIds),
    ...persistedAppliedOperationIds,
  ]);
  const appliedOperationIdSet = new Set(appliedOperationIds);
  const appliedOperationSequenceByClient = normalizeAppliedXpSequenceByClient(
    snapshot.appliedOperationSequenceByClient,
  );
  for (const [clientId, sequence] of Object.entries(
    persistedAppliedOperationSequenceByClient,
  )) {
    appliedOperationSequenceByClient[clientId] = Math.max(
      appliedOperationSequenceByClient[clientId] ?? 0,
      sequence,
    );
  }
  const migratedSnapshotOperations = upgradeLegacyPendingXpOperations(
    storage,
    userId,
    normalizePendingXpOperations(snapshot.pendingOperations),
    persisted.pendingOperations,
  );
  const snapshotOperations = mergePendingXpOperations(
    [migratedSnapshotOperations],
    appliedOperationIdSet,
    false,
    true,
  );
  const snapshotOperationIds = new Set(snapshotOperations.map(candidate => candidate.id));
  const pendingOperations = mergePendingXpOperations(
    [snapshotOperations, persisted.pendingOperations],
    appliedOperationIdSet,
    false,
    true,
  );
  const persistedOperationsToApply = pendingOperations
    .filter(candidate => !snapshotOperationIds.has(candidate.id)
      && !(isKeyedXpOperation(candidate) && appliedOperationIdSet.has(candidate.id)));
  const synchronizedBase = {
    ...snapshot,
    ...(appliedOperationIds.length > 0 ? { appliedOperationIds } : {}),
    ...(Object.keys(appliedOperationSequenceByClient).length > 0
      ? { appliedOperationSequenceByClient }
      : {}),
  };
  const synchronized = {
    ...applyPendingXpOperations(synchronizedBase, persistedOperationsToApply),
    ...(pendingOperations.length > 0 ? { pendingOperations } : { pendingOperations: undefined }),
  };
  if (operation) {
    const existingOperation = operation;
    const pendingOperation = pendingOperations
      .find(candidate => candidate.id === existingOperation.id);
    const isPending = pendingOperation !== undefined;
    const isApplied = isAppliedXpOperation(
      existingOperation,
      appliedOperationIdSet,
      appliedOperationSequenceByClient,
    );
    if (isPending || isApplied) {
      let deduplicated = synchronized;
      if (
        isApplied
        && persistedSnapshotWasDurable
        && isAppliedXpOperation(
          existingOperation,
          persistedAppliedOperationIdSet,
          persistedAppliedOperationSequenceByClient,
        )
      ) {
        const persistedPendingIds = new Set(
          normalizePendingXpOperations(persisted.pendingOperations)
            .map(candidate => candidate.id),
        );
        const currentOnlyOperations = snapshotOperations
          .filter(candidate => !persistedPendingIds.has(candidate.id));
        const authoritative = rebaseGamificationSnapshots({
          ...snapshot,
          pendingOperations: currentOnlyOperations,
        }, {
          ...persisted,
          appliedOperationIds,
          ...(Object.keys(appliedOperationSequenceByClient).length > 0
            ? { appliedOperationSequenceByClient }
            : {}),
        });
        deduplicated = {
          ...authoritative,
          ...(pendingOperations.length > 0
            ? { pendingOperations }
            : { pendingOperations: undefined }),
        };
      }
      const journalWasWritten = pendingOperation
        ? writeKeyedOperationJournal(storage, userId, pendingOperation)
        : false;
      return {
        snapshot: deduplicated,
        durablyWritten: writeGamificationSnapshot(storage, userId, deduplicated)
          || journalWasWritten,
      };
    }
  }
  if (pendingOperations.length >= MAX_PENDING_XP_OPERATIONS) {
    throw new PendingXpQueueFullError();
  }
  if (!operation) {
    [operation] = normalizePendingXpOperations([
      createPendingXpOperation(storage, userId, amount, day),
    ], 1);
    if (!operation) return { snapshot: synchronized, durablyWritten: false };
  }
  const next = {
    ...addXpToGamification(synchronized, operation.delta, now),
    pendingOperations: [...pendingOperations, operation],
  };
  const journalWasWritten = writeKeyedOperationJournal(storage, userId, operation);
  return {
    snapshot: next,
    durablyWritten: writeGamificationSnapshot(storage, userId, next)
      || journalWasWritten,
  };
};

export const addXpToStoredGamification = (
  storage: GamificationStorage,
  userId: string | null,
  snapshot: StoredGamificationSnapshot,
  amount: number,
  now: Date,
  operationId?: string,
): StoredGamificationSnapshot => addXpToStoredGamificationResult(
  storage,
  userId,
  snapshot,
  amount,
  now,
  operationId,
).snapshot;

export const addKeyedXpToStoredGamification = (
  storage: GamificationStorage,
  userId: string | null,
  snapshot: StoredGamificationSnapshot,
  amount: number,
  now: Date,
  logicalOperationId: string,
): StoredGamificationMutationResult => {
  const operationId = createKeyedXpOperationId(logicalOperationId);
  if (!operationId) return { snapshot, durablyWritten: false };
  return addXpToStoredGamificationResult(storage, userId, snapshot, amount, now, operationId);
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
  if (writeGamificationSnapshot(storage, userId, rebased)) {
    removeKeyedOperationJournalEntries(storage, userId, acknowledgedOperationIds);
  }
  return rebased;
};
