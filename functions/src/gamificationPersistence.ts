import type {
  DocumentData,
  DocumentReference,
  Firestore,
  Transaction,
} from 'firebase-admin/firestore';
import { InputValidationError } from './inputValidation.js';

export const MAX_XP_VALUE = Number.MAX_SAFE_INTEGER;
export const MAX_XP_OPERATION_DELTA = 1_000_000;
export const MAX_XP_OPERATIONS_PER_SAVE = 128;
export const MAX_PENDING_XP_OPERATIONS = 2_048;
export const MAX_GAMIFICATION_HISTORY_ENTRIES = 730;
export const MAX_APPLIED_XP_OPERATION_IDS = 2_048;
export const MAX_LEGACY_XP_CLIENT_STREAMS = 64;
export const MAX_XP_STREAM_WATERMARKS = 128;
export const XP_STREAM_SCHEMA_VERSION = 2;

const MAX_OPERATION_ID_LENGTH = 128;
const MAX_CLIENT_ID_LENGTH = 64;
const MAX_DAY_LENGTH = 64;
const OPERATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9:_-]*$/;
const CLIENT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const RESERVED_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export interface GamificationSaveSnapshot {
  streak: number;
  xp: number;
  lastActive: string | null;
  history: Record<string, number>;
  pendingOperations?: GamificationOperation[];
}

export interface GamificationOperation {
  id: string;
  delta: number;
  day: string;
  clientId?: string;
  sequence?: number;
  legacyId?: string;
}

export interface GamificationSaveRequest {
  snapshot: GamificationSaveSnapshot;
  operations: GamificationOperation[];
}

export interface GamificationSaveCommit {
  snapshot: GamificationSaveSnapshot & {
    appliedOperationIds: string[];
    appliedOperationSequenceByClient?: Record<string, number>;
  };
  appliedOperationIds: string[];
}

export class GamificationMigrationRequiredError extends Error {
  readonly reason = 'xp-stream-migration-required';

  constructor() {
    super('Stored XP stream metadata is invalid and requires protected migration.');
    this.name = 'GamificationMigrationRequiredError';
  }
}

export class GamificationSequenceGapError extends Error {
  readonly reason = 'xp-sequence-gap';

  constructor(
    readonly clientId: string,
    readonly expectedSequence: number,
    readonly receivedSequence: number,
  ) {
    super(`Cannot bootstrap XP client ${clientId}: expected sequence ${expectedSequence}, received ${receivedSequence}.`);
    this.name = 'GamificationSequenceGapError';
  }
}

export class GamificationStreamLimitError extends Error {
  constructor() {
    super('Gamification stream limit reached.');
    this.name = 'GamificationStreamLimitError';
  }
}

const asRecord = (value: unknown, message: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new InputValidationError(message);
  }
  return value as Record<string, unknown>;
};

const exactKeys = (value: Record<string, unknown>, expected: readonly string[], message: string) => {
  const actual = Object.keys(value);
  if (actual.length !== expected.length || actual.some(key => !expected.includes(key))) {
    throw new InputValidationError(message);
  }
};

const safeCounter = (value: unknown, message: string): number => {
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > MAX_XP_VALUE) {
    throw new InputValidationError(message);
  }
  return Number(value);
};

const validStoredCounter = (value: unknown): number =>
  Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= MAX_XP_VALUE
    ? Number(value)
    : 0;

const validLastActive = (value: unknown): string | null =>
  typeof value === 'string'
  && value.length <= MAX_DAY_LENGTH
  && Number.isFinite(Date.parse(value))
    ? value
    : null;

const validOperationId = (value: unknown): value is string =>
  typeof value === 'string'
  && value.length > 0
  && value.length <= MAX_OPERATION_ID_LENGTH
  && OPERATION_ID_PATTERN.test(value);

const validClientId = (value: unknown): value is string =>
  typeof value === 'string'
  && value.length > 0
  && value.length <= MAX_CLIENT_ID_LENGTH
  && !RESERVED_KEYS.has(value)
  && CLIENT_ID_PATTERN.test(value);

const validDay = (value: unknown): value is string =>
  typeof value === 'string'
  && value.length > 0
  && value.length <= MAX_DAY_LENGTH
  && !RESERVED_KEYS.has(value);

const validDelta = (value: unknown): value is number =>
  Number.isSafeInteger(value)
  && Number(value) !== 0
  && Math.abs(Number(value)) <= MAX_XP_OPERATION_DELTA;

const validSequence = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) > 0 && Number(value) <= MAX_XP_VALUE;

const parseHistory = (value: unknown, message: string): Record<string, number> => {
  const source = asRecord(value, message);
  const entries = Object.entries(source);
  if (entries.length > MAX_GAMIFICATION_HISTORY_ENTRIES) {
    throw new InputValidationError(message);
  }
  const history: Record<string, number> = {};
  for (const [day, amount] of entries) {
    if (!validDay(day)) throw new InputValidationError(message);
    history[day] = safeCounter(amount, message);
  }
  return history;
};

const parseOperation = (value: unknown): GamificationOperation => {
  const source = asRecord(value, 'Gamification operation must be an object.');
  const hasStructured = Object.prototype.hasOwnProperty.call(source, 'clientId')
    || Object.prototype.hasOwnProperty.call(source, 'sequence');
  const keys = hasStructured
    ? ['id', 'clientId', 'sequence', 'delta', 'day', ...(Object.prototype.hasOwnProperty.call(source, 'legacyId') ? ['legacyId'] : [])]
    : ['id', 'delta', 'day', ...(Object.prototype.hasOwnProperty.call(source, 'legacyId') ? ['legacyId'] : [])];
  exactKeys(source, keys, 'Gamification operation contains an unsupported field.');
  if (!validOperationId(source.id)) throw new InputValidationError('Gamification operation ID is invalid.');
  if (!validDelta(source.delta)) throw new InputValidationError('Gamification operation delta is invalid.');
  if (!validDay(source.day)) throw new InputValidationError('Gamification operation day is invalid.');
  if (hasStructured) {
    if (!validClientId(source.clientId) || !validSequence(source.sequence)) {
      throw new InputValidationError('Gamification operation stream metadata is invalid.');
    }
    if (source.id !== `xp2:${source.clientId}:${source.sequence}`) {
      throw new InputValidationError('Gamification operation ID does not match its stream metadata.');
    }
  }
  if (Object.prototype.hasOwnProperty.call(source, 'legacyId')) {
    if (!validOperationId(source.legacyId) || source.legacyId === source.id) {
      throw new InputValidationError('Gamification legacy operation ID is invalid.');
    }
  }
  return {
    id: source.id,
    delta: source.delta as number,
    day: source.day,
    ...(hasStructured ? { clientId: source.clientId as string, sequence: source.sequence as number } : {}),
    ...(Object.prototype.hasOwnProperty.call(source, 'legacyId') ? { legacyId: source.legacyId as string } : {}),
  };
};

export const parseGamificationSaveRequest = (value: unknown): GamificationSaveRequest => {
  const source = asRecord(value, 'Gamification request must be an object.');
  exactKeys(source, ['snapshot', 'operations'], 'Gamification request contains an unsupported field.');
  const snapshot = asRecord(source.snapshot, 'Gamification snapshot must be an object.');
  const snapshotKeys = Object.keys(snapshot);
  if (snapshotKeys.some(key => !['streak', 'xp', 'lastActive', 'history', 'pendingOperations'].includes(key))
    || snapshotKeys.length < 4 || snapshotKeys.length > 5) {
    throw new InputValidationError('Gamification snapshot shape is invalid.');
  }
  const streak = safeCounter(snapshot.streak, 'Gamification streak is invalid.');
  const xp = safeCounter(snapshot.xp, 'Gamification XP is invalid.');
  const lastActive = snapshot.lastActive === null
    ? null
    : validLastActive(snapshot.lastActive);
  if (snapshot.lastActive !== null && lastActive === null) {
    throw new InputValidationError('Gamification last-active date is invalid.');
  }
  const history = parseHistory(snapshot.history, 'Gamification history is invalid.');
  const pendingOperations = Object.prototype.hasOwnProperty.call(snapshot, 'pendingOperations')
    ? (() => {
        if (!Array.isArray(snapshot.pendingOperations) || snapshot.pendingOperations.length > MAX_PENDING_XP_OPERATIONS) {
          throw new InputValidationError('Gamification pending operation count is invalid.');
        }
        const parsed = Array.from(snapshot.pendingOperations, parseOperation);
        const seen = new Set<string>();
        for (const operation of parsed) {
          if (seen.has(operation.id)) throw new InputValidationError('Gamification pending operations contain a duplicate ID.');
          seen.add(operation.id);
        }
        return parsed;
      })()
    : undefined;
  if (!Array.isArray(source.operations) || source.operations.length > MAX_XP_OPERATIONS_PER_SAVE) {
    throw new InputValidationError('Gamification operation count is invalid.');
  }
  const seen = new Set<string>();
  const operations = Array.from(source.operations, parseOperation);
  for (const operation of operations) {
    if (seen.has(operation.id)) throw new InputValidationError('Gamification operations contain a duplicate ID.');
    seen.add(operation.id);
  }
  return {
    snapshot: {
      streak,
      xp,
      lastActive,
      history,
      ...(pendingOperations ? { pendingOperations } : {}),
    },
    operations,
  };
};

const operationIdList = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  const result: string[] = [];
  const seen = new Set<string>();
  for (let index = value.length - 1; index >= 0 && result.length < MAX_APPLIED_XP_OPERATION_IDS; index -= 1) {
    const id = value[index];
    if (!validOperationId(id) || seen.has(id)) continue;
    seen.add(id);
    result.push(id);
  }
  return result.reverse();
};

const legacySequenceMap = (value: unknown): Record<string, number> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new GamificationMigrationRequiredError();
  }
  const entries = Object.entries(value);
  if (entries.length > MAX_LEGACY_XP_CLIENT_STREAMS
    || entries.some(([clientId, sequence]) => !validClientId(clientId) || !validSequence(sequence))) {
    throw new GamificationMigrationRequiredError();
  }
  return Object.fromEntries(entries.map(([clientId, sequence]) => [clientId, Number(sequence)]));
};

const historyFromStored = (value: unknown): Record<string, number> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value)
    .filter(([day, amount]) => validDay(day) && Number.isSafeInteger(amount) && Number(amount) >= 0 && Number(amount) <= MAX_XP_VALUE)
    .slice(-MAX_GAMIFICATION_HISTORY_ENTRIES));
};

interface StoredGamificationStats {
  streak: number;
  xp: number;
  lastActive: string | null;
  appliedOperationIds: string[];
  hasLegacySequenceMap: boolean;
  legacySequenceByClient: Record<string, number>;
}

const parseStoredOperationIds = (value: unknown): string[] => {
  if (!Array.isArray(value)
    || value.length > MAX_APPLIED_XP_OPERATION_IDS
    || value.some(operationId => !validOperationId(operationId))) {
    throw new GamificationMigrationRequiredError();
  }
  return operationIdList(value);
};

const parseStoredCounter = (value: unknown): number => {
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > MAX_XP_VALUE) {
    throw new GamificationMigrationRequiredError();
  }
  return Number(value);
};

const parseStoredHistory = (value: unknown): Record<string, number> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new GamificationMigrationRequiredError();
  }
  const entries = Object.entries(value);
  if (entries.length > MAX_GAMIFICATION_HISTORY_ENTRIES
    || entries.some(([day, amount]) => !validDay(day)
      || !Number.isSafeInteger(amount)
      || Number(amount) < 0
      || Number(amount) > MAX_XP_VALUE)) {
    throw new GamificationMigrationRequiredError();
  }
  return Object.fromEntries(entries.map(([day, amount]) => [day, Number(amount)]));
};

const parseStoredStats = (value: DocumentData | undefined): StoredGamificationStats => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new GamificationMigrationRequiredError();
  }
  const source = value as Record<string, unknown>;
  const baseKeys = [
    'streak',
    'xp',
    'lastActive',
    'appliedXpOperationIds',
  ];
  const hasLegacySequenceMap = Object.prototype.hasOwnProperty.call(source, 'appliedXpSequenceByClient');
  const hasSchemaVersion = Object.prototype.hasOwnProperty.call(source, 'xpStreamSchemaVersion');
  if (hasLegacySequenceMap && hasSchemaVersion) {
    throw new GamificationMigrationRequiredError();
  }
  const expectedKeys = [
    ...baseKeys,
    // Receipt-only stats are the pre-stream legacy form; the two protocol
    // extensions are mutually exclusive and each has its exact key set.
    ...(hasLegacySequenceMap
      ? ['appliedXpSequenceByClient']
      : hasSchemaVersion ? ['xpStreamSchemaVersion'] : []),
  ];
  if (Object.keys(source).length !== expectedKeys.length
    || Object.keys(source).some(key => !expectedKeys.includes(key))) {
    throw new GamificationMigrationRequiredError();
  }
  if (hasSchemaVersion
    && source.xpStreamSchemaVersion !== XP_STREAM_SCHEMA_VERSION) {
    throw new GamificationMigrationRequiredError();
  }
  const lastActive = source.lastActive === null ? null : validLastActive(source.lastActive);
  if (source.lastActive !== null && lastActive === null) {
    throw new GamificationMigrationRequiredError();
  }
  return {
    streak: parseStoredCounter(source.streak),
    xp: parseStoredCounter(source.xp),
    lastActive,
    appliedOperationIds: parseStoredOperationIds(source.appliedXpOperationIds),
    hasLegacySequenceMap,
    legacySequenceByClient: hasLegacySequenceMap
      ? legacySequenceMap(source.appliedXpSequenceByClient)
      : {},
  };
};

const addDelta = (value: number, delta: number): number => {
  if (delta > 0) return value > MAX_XP_VALUE - delta ? MAX_XP_VALUE : value + delta;
  return value < -delta ? 0 : value + delta;
};

const applyOperations = (
  snapshot: GamificationSaveSnapshot,
  operations: readonly GamificationOperation[],
): GamificationSaveSnapshot => {
  let xp = validStoredCounter(snapshot.xp);
  const history = { ...historyFromStored(snapshot.history) };
  for (const operation of operations) {
    xp = addDelta(xp, operation.delta);
    history[operation.day] = addDelta(history[operation.day] ?? 0, operation.delta);
  }
  return { ...snapshot, xp, history: historyFromStored(history) };
};

const activityTime = (value: string | null): number => {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
};

const mergeActivity = (
  cloud: GamificationSaveSnapshot,
  candidate: GamificationSaveSnapshot,
): Pick<GamificationSaveSnapshot, 'streak' | 'lastActive'> => {
  const cloudLastActive = validLastActive(cloud.lastActive);
  const candidateLastActive = validLastActive(candidate.lastActive);
  const cloudActivity = activityTime(cloudLastActive);
  const candidateActivity = activityTime(candidateLastActive);
  if (candidateActivity > cloudActivity) {
    return { streak: validStoredCounter(candidate.streak), lastActive: candidateLastActive };
  }
  return {
    streak: candidateActivity === cloudActivity
      ? Math.max(validStoredCounter(cloud.streak), validStoredCounter(candidate.streak))
      : validStoredCounter(cloud.streak),
    lastActive: cloudLastActive ?? candidateLastActive,
  };
};

const statsReference = (database: Firestore, ownerId: string): DocumentReference =>
  database.collection('users').doc(ownerId).collection('profile').doc('stats');

const historyReference = (database: Firestore, ownerId: string): DocumentReference =>
  database.collection('users').doc(ownerId).collection('profile').doc('xp_history');

const streamReference = (database: Firestore, ownerId: string, clientId: string): DocumentReference =>
  database.collection('users').doc(ownerId).collection('xp_streams').doc(clientId);

const streamWatermark = (value: DocumentData | undefined, expectedClientId: string) => {
  const retiredAt = value?.retiredAt;
  if (!value || Object.keys(value).length !== 4
    || value.schemaVersion !== XP_STREAM_SCHEMA_VERSION
    || value.clientId !== expectedClientId
    || !validClientId(value.clientId)
    || !validSequence(value.sequence)
    || !(retiredAt === null || (
      typeof retiredAt === 'string'
      && retiredAt.length === 24
      && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(retiredAt)
      && Number.isFinite(Date.parse(retiredAt))
    ))) {
    throw new GamificationMigrationRequiredError();
  }
  return { sequence: Number(value.sequence), retiredAt: retiredAt as string | null };
};

export async function applyGamificationForOwner(
  database: Firestore,
  ownerId: string,
  request: GamificationSaveRequest,
): Promise<GamificationSaveCommit> {
  if (!ownerId || ownerId.includes('/')) throw new InputValidationError('Gamification owner is invalid.');
  const statsRef = statsReference(database, ownerId);
  const historyRef = historyReference(database, ownerId);
  const streams = database.collection('users').doc(ownerId).collection('xp_streams');
  return database.runTransaction(async (transaction: Transaction) => {
    const statsSnapshot = await transaction.get(statsRef);
    const historySnapshot = await transaction.get(historyRef);
    const streamLimitSnapshot = await transaction.get(streams.limit(MAX_XP_STREAM_WATERMARKS + 1));
    const storedStats = statsSnapshot.exists ? parseStoredStats(statsSnapshot.data()) : null;
    const storedHistory = historySnapshot.exists ? parseStoredHistory(historySnapshot.data()) : {};
    const existingAppliedOperationIds = storedStats?.appliedOperationIds ?? [];
    const hasLegacySequenceMap = storedStats?.hasLegacySequenceMap ?? false;
    const legacySequenceByClient = storedStats?.legacySequenceByClient ?? {};
    const bootstrapOperations = request.snapshot.pendingOperations ?? request.operations;
    const streamClientIds = new Set<string>([
      ...Object.keys(legacySequenceByClient),
      ...(statsSnapshot.exists ? request.operations : bootstrapOperations)
        .filter(operation => operation.clientId)
        .map(operation => operation.clientId as string),
    ]);
    if (!statsSnapshot.exists && streamClientIds.size > MAX_XP_STREAM_WATERMARKS) {
      throw new InputValidationError('Gamification bootstrap exceeds the transaction stream budget.');
    }
    const streamSnapshots = await Promise.all(Array.from(streamClientIds).map(clientId =>
      transaction.get(streamReference(database, ownerId, clientId))));
    const appliedSequenceByClient: Record<string, number> = { ...legacySequenceByClient };
    const streamSnapshotByClient = new Map<string, { sequence: number; retiredAt: string | null }>();
    Array.from(streamClientIds).forEach((clientId, index) => {
      const stream = streamSnapshots[index];
      if (!stream.exists) return;
      const watermark = streamWatermark(stream.data(), clientId);
      streamSnapshotByClient.set(clientId, watermark);
      appliedSequenceByClient[clientId] = Math.max(appliedSequenceByClient[clientId] ?? 0, watermark.sequence);
    });

    const alreadyApplied = new Set(existingAppliedOperationIds);
    const acknowledgedOperationIds: string[] = [];
    const newOperations: GamificationOperation[] = [];
    const registerStructuredOperation = (operation: GamificationOperation & { clientId: string; sequence: number }, apply: boolean) => {
      const previousSequence = appliedSequenceByClient[operation.clientId] ?? 0;
      if (operation.sequence <= previousSequence) {
        acknowledgedOperationIds.push(operation.id);
        return;
      }
      if (operation.sequence !== previousSequence + 1) return;
      if (apply) newOperations.push(operation);
      acknowledgedOperationIds.push(operation.id);
      appliedSequenceByClient[operation.clientId] = operation.sequence;
    };

    const operationsToClassify = statsSnapshot.exists
      ? request.operations
      : [
          ...bootstrapOperations.filter(operation => operation.clientId)
            .sort((left, right) => left.clientId === right.clientId
              ? (left.sequence as number) - (right.sequence as number)
              : (left.clientId as string) < (right.clientId as string) ? -1 : 1),
          ...bootstrapOperations.filter(operation => !operation.clientId),
        ];
    for (const operation of operationsToClassify) {
      const isInRecentLedger = alreadyApplied.has(operation.id)
        || (operation.legacyId ? alreadyApplied.has(operation.legacyId) : false);
      if (operation.clientId && operation.sequence) {
        if (!statsSnapshot.exists) {
          const expectedSequence = (appliedSequenceByClient[operation.clientId] ?? 0) + 1;
          if (operation.sequence !== expectedSequence) {
            throw new GamificationSequenceGapError(operation.clientId, expectedSequence, operation.sequence);
          }
          registerStructuredOperation(operation as GamificationOperation & { clientId: string; sequence: number }, false);
        } else {
          registerStructuredOperation(operation as GamificationOperation & { clientId: string; sequence: number }, !isInRecentLedger);
        }
      } else if (isInRecentLedger) {
        acknowledgedOperationIds.push(operation.id);
      } else if (!statsSnapshot.exists || !hasLegacySequenceMap) {
        acknowledgedOperationIds.push(operation.id);
        newOperations.push(operation);
      }
    }

    const newStreamCount = Object.keys(appliedSequenceByClient)
      .filter(clientId => streamClientIds.has(clientId) && !streamSnapshotByClient.has(clientId))
      .length;
    const storedStreamCount = streamLimitSnapshot.size;
    if (!Number.isSafeInteger(storedStreamCount) || storedStreamCount < 0) {
      throw new GamificationMigrationRequiredError();
    }
    if (newStreamCount > 0
      && Number(storedStreamCount) + newStreamCount > MAX_XP_STREAM_WATERMARKS) {
      throw new GamificationStreamLimitError();
    }
    let committed: GamificationSaveSnapshot;
    if (!statsSnapshot.exists) {
      const bootstrapHistory = historySnapshot.exists
        ? applyOperations({ streak: 0, xp: 0, lastActive: null, history: storedHistory }, bootstrapOperations).history
        : historyFromStored(request.snapshot.history);
      committed = {
        streak: request.snapshot.streak,
        xp: request.snapshot.xp,
        lastActive: validLastActive(request.snapshot.lastActive),
        history: bootstrapHistory,
      };
    } else {
      const cloud: GamificationSaveSnapshot = {
        streak: storedStats?.streak ?? 0,
        xp: storedStats?.xp ?? 0,
        lastActive: storedStats?.lastActive ?? null,
        history: historySnapshot.exists ? storedHistory : {},
      };
      const activity = mergeActivity(cloud, request.snapshot);
      const withOperations = applyOperations({ ...cloud, ...activity }, newOperations);
      committed = historySnapshot.exists
        ? withOperations
        : { ...withOperations, history: historyFromStored(request.snapshot.history) };
    }

    const appliedOperationIds = operationIdList([...existingAppliedOperationIds, ...acknowledgedOperationIds]);
    const authoritativeSnapshot = {
      ...committed,
      appliedOperationIds,
      ...(Object.keys(appliedSequenceByClient).length > 0
        ? { appliedOperationSequenceByClient: appliedSequenceByClient }
        : {}),
    };
    transaction.set(statsRef, {
      streak: authoritativeSnapshot.streak,
      lastActive: authoritativeSnapshot.lastActive,
      xp: authoritativeSnapshot.xp,
      appliedXpOperationIds: appliedOperationIds,
      xpStreamSchemaVersion: XP_STREAM_SCHEMA_VERSION,
    });
    transaction.set(historyRef, authoritativeSnapshot.history);
    for (const [clientId, sequence] of Object.entries(appliedSequenceByClient)) {
      if (!streamClientIds.has(clientId) && !hasLegacySequenceMap) continue;
      const existing = streamSnapshotByClient.get(clientId);
      transaction.set(streamReference(database, ownerId, clientId), {
        schemaVersion: XP_STREAM_SCHEMA_VERSION,
        clientId,
        sequence: Math.max(sequence, existing?.sequence ?? 0),
        retiredAt: existing?.retiredAt ?? null,
      });
    }
    return {
      snapshot: authoritativeSnapshot,
      appliedOperationIds: acknowledgedOperationIds,
    };
  });
}
