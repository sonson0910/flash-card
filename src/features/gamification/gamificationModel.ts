export interface GamificationSnapshot {
  streak: number;
  xp: number;
  lastActive: string | null;
}

export interface PendingXpOperation {
  id: string;
  delta: number;
  day: string;
  clientId?: string;
  sequence?: number;
  legacyId?: string;
}

export interface GamificationSnapshotWithHistory extends GamificationSnapshot {
  history: Record<string, number>;
  pendingOperations?: PendingXpOperation[];
  appliedOperationIds?: string[];
  appliedOperationSequenceByClient?: Record<string, number>;
}

export const MAX_XP_OPERATION_DELTA = 1_000_000;
export const MAX_PENDING_XP_OPERATIONS = 2_048;
export const MAX_APPLIED_XP_OPERATION_IDS = MAX_PENDING_XP_OPERATIONS;
export const MAX_XP_OPERATIONS_PER_SAVE = 128;
export const MAX_GAMIFICATION_HISTORY_ENTRIES = 730;
export const MAX_LEGACY_XP_CLIENT_STREAMS = 64;
export const XP_STREAM_SCHEMA_VERSION = 2;

export interface XpStreamWatermark {
  schemaVersion: typeof XP_STREAM_SCHEMA_VERSION;
  clientId: string;
  sequence: number;
  retiredAt: string | null;
}

const MAX_XP_VALUE = Number.MAX_SAFE_INTEGER;
const MAX_OPERATION_ID_LENGTH = 128;
const MAX_CLIENT_ID_LENGTH = 64;
const MAX_HISTORY_DAY_LENGTH = 64;

export const finiteNonNegativeGamificationValue = (value: unknown): number =>
  typeof value === 'number'
  && Number.isSafeInteger(value)
  && value >= 0
  && value <= MAX_XP_VALUE
    ? value
    : 0;

const validOperationId = (value: unknown): value is string => typeof value === 'string'
  && value.length > 0
  && value.length <= MAX_OPERATION_ID_LENGTH
  && /^[A-Za-z0-9][A-Za-z0-9:_-]*$/.test(value);

const validXpClientId = (value: unknown): value is string => typeof value === 'string'
  && value.length > 0
  && value.length <= MAX_CLIENT_ID_LENGTH
  && value !== '__proto__'
  && value !== 'constructor'
  && value !== 'prototype'
  && /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(value);

const validXpOperationSequence = (value: unknown): value is number => typeof value === 'number'
  && Number.isSafeInteger(value)
  && value > 0;

const validXpRetiredAt = (value: unknown): value is string => typeof value === 'string'
  && value.length === 24
  && /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/.test(value)
  && Number.isFinite(Date.parse(value));

export const createStructuredXpOperationId = (clientId: string, sequence: number): string =>
  `xp2:${clientId}:${sequence}`;

const validHistoryDay = (value: unknown): value is string => typeof value === 'string'
  && value.length > 0
  && value.length <= MAX_HISTORY_DAY_LENGTH
  && value !== '__proto__'
  && value !== 'constructor'
  && value !== 'prototype';

const validXpDelta = (value: unknown): value is number => typeof value === 'number'
  && Number.isSafeInteger(value)
  && value !== 0
  && Math.abs(value) <= MAX_XP_OPERATION_DELTA;

export function normalizeGamificationHistory(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .filter(([day, amount]) => validHistoryDay(day)
        && finiteNonNegativeGamificationValue(amount) === amount)
      .slice(-MAX_GAMIFICATION_HISTORY_ENTRIES),
  );
}

export function normalizePendingXpOperations(
  value: unknown,
  maximum = MAX_PENDING_XP_OPERATIONS,
): PendingXpOperation[] {
  if (!Array.isArray(value)) return [];
  const boundedMaximum = Number.isSafeInteger(maximum) && maximum > 0
    ? Math.min(maximum, MAX_PENDING_XP_OPERATIONS)
    : MAX_PENDING_XP_OPERATIONS;
  const operations: PendingXpOperation[] = [];
  const seen = new Set<string>();
  for (const candidate of value) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue;
    const source = candidate as Record<string, unknown>;
    const hasProtocolMetadata = Object.prototype.hasOwnProperty.call(source, 'clientId')
      || Object.prototype.hasOwnProperty.call(source, 'sequence');
    const hasLegacyId = Object.prototype.hasOwnProperty.call(source, 'legacyId');
    if (
      !validOperationId(source.id)
      || !validXpDelta(source.delta)
      || !validHistoryDay(source.day)
      || (hasProtocolMetadata && (
        !validXpClientId(source.clientId)
        || !validXpOperationSequence(source.sequence)
        || source.id !== createStructuredXpOperationId(source.clientId, source.sequence)
      ))
      || (hasLegacyId && (
        !validOperationId(source.legacyId)
        || source.legacyId === source.id
      ))
      || seen.has(source.id)
    ) continue;
    seen.add(source.id);
    operations.push({
      id: source.id,
      delta: source.delta,
      day: source.day,
      ...(hasProtocolMetadata
        ? { clientId: source.clientId as string, sequence: source.sequence as number }
        : {}),
      ...(hasLegacyId ? { legacyId: source.legacyId as string } : {}),
    });
    if (operations.length >= boundedMaximum) break;
  }
  return operations;
}

export function normalizeAppliedXpOperationIds(
  value: unknown,
  maximum = MAX_APPLIED_XP_OPERATION_IDS,
): string[] {
  if (!Array.isArray(value)) return [];
  const boundedMaximum = Number.isSafeInteger(maximum) && maximum > 0
    ? Math.min(maximum, MAX_APPLIED_XP_OPERATION_IDS)
    : MAX_APPLIED_XP_OPERATION_IDS;
  const ids: string[] = [];
  const seen = new Set<string>();
  for (let index = value.length - 1; index >= 0 && ids.length < boundedMaximum; index -= 1) {
    const id = value[index];
    if (!validOperationId(id) || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids.reverse();
}

export function normalizeAppliedXpSequenceByClient(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .filter(([clientId, sequence]) => validXpClientId(clientId)
        && validXpOperationSequence(sequence)),
  );
}

export function isValidLegacyXpSequenceByClient(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const entries = Object.entries(value);
  return entries.length <= MAX_LEGACY_XP_CLIENT_STREAMS
    && entries.every(([clientId, sequence]) => validXpClientId(clientId)
      && validXpOperationSequence(sequence));
}

export function normalizeXpStreamWatermark(
  value: unknown,
  expectedClientId?: string,
): XpStreamWatermark | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const clientId = source.clientId;
  const retiredAt = source.retiredAt;
  if (
    Object.keys(source).length !== 4
    || !Object.prototype.hasOwnProperty.call(source, 'schemaVersion')
    || !Object.prototype.hasOwnProperty.call(source, 'clientId')
    || !Object.prototype.hasOwnProperty.call(source, 'sequence')
    || !Object.prototype.hasOwnProperty.call(source, 'retiredAt')
    || source.schemaVersion !== XP_STREAM_SCHEMA_VERSION
    || !validXpClientId(clientId)
    || (expectedClientId !== undefined && clientId !== expectedClientId)
    || !validXpOperationSequence(source.sequence)
    || !(retiredAt === null || validXpRetiredAt(retiredAt))
  ) return null;
  return {
    schemaVersion: XP_STREAM_SCHEMA_VERSION,
    clientId,
    sequence: source.sequence,
    retiredAt,
  };
}

export const isStructuredXpOperation = (
  operation: PendingXpOperation,
): operation is PendingXpOperation & { clientId: string; sequence: number } =>
  validXpClientId(operation.clientId)
  && validXpOperationSequence(operation.sequence)
  && operation.id === createStructuredXpOperationId(operation.clientId, operation.sequence);

export const isAppliedXpOperation = (
  operation: PendingXpOperation,
  appliedOperationIds: ReadonlySet<string>,
  appliedSequenceByClient: Readonly<Record<string, number>>,
): boolean => appliedOperationIds.has(operation.id)
  || (
    isStructuredXpOperation(operation)
    && operation.sequence <= (appliedSequenceByClient[operation.clientId] ?? 0)
  );

export function calculateLocalGamification(
  snapshot: GamificationSnapshot,
  now = new Date(),
): GamificationSnapshot {
  const today = now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const lastActive = snapshot.lastActive ? new Date(snapshot.lastActive) : null;
  const safeStreak = finiteNonNegativeGamificationValue(snapshot.streak);
  const streak = lastActive?.toDateString() === today
    ? Math.max(1, safeStreak)
    : lastActive?.toDateString() === yesterday.toDateString()
      ? Math.max(1, safeStreak + 1)
      : 1;
  return {
    streak,
    xp: finiteNonNegativeGamificationValue(snapshot.xp),
    lastActive: today,
  };
}

export function addXpToHistory(
  history: Record<string, number>,
  day: string,
  amount: number,
): Record<string, number> {
  const safeHistory = normalizeGamificationHistory(history);
  if (!validHistoryDay(day) || !validXpDelta(amount)) return safeHistory;
  return normalizeGamificationHistory({
    ...safeHistory,
    [day]: Math.min(
      MAX_XP_VALUE,
      Math.max(0, finiteNonNegativeGamificationValue(safeHistory[day] ?? 0) + amount),
    ),
  });
}

export function applyPendingXpOperations(
  snapshot: GamificationSnapshotWithHistory,
  operations: readonly PendingXpOperation[],
): GamificationSnapshotWithHistory {
  let xp = finiteNonNegativeGamificationValue(snapshot.xp);
  let history = normalizeGamificationHistory(snapshot.history);
  for (const operation of normalizePendingXpOperations(operations)) {
    xp = Math.min(MAX_XP_VALUE, Math.max(0, xp + operation.delta));
    history = addXpToHistory(history, operation.day, operation.delta);
  }
  return { ...snapshot, xp, history };
}

const activityTime = (value: string | null): number => {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
};

const validLastActive = (value: unknown): string | null => typeof value === 'string'
  && value.length <= MAX_HISTORY_DAY_LENGTH
  && Number.isFinite(Date.parse(value))
  ? value
  : null;

export function rebaseGamificationSnapshots(
  local: GamificationSnapshotWithHistory,
  cloud: GamificationSnapshotWithHistory,
): GamificationSnapshotWithHistory {
  const appliedOperationIds = normalizeAppliedXpOperationIds(cloud.appliedOperationIds);
  const applied = new Set(appliedOperationIds);
  const appliedOperationSequenceByClient = normalizeAppliedXpSequenceByClient(
    cloud.appliedOperationSequenceByClient,
  );
  const pendingOperations = normalizePendingXpOperations(local.pendingOperations)
    .filter(operation => !isAppliedXpOperation(
      operation,
      applied,
      appliedOperationSequenceByClient,
    ));
  const cloudLastActive = validLastActive(cloud.lastActive);
  const localLastActive = validLastActive(local.lastActive);
  const cloudActivity = activityTime(cloudLastActive);
  const localActivity = activityTime(localLastActive);
  let streak = finiteNonNegativeGamificationValue(cloud.streak);
  let lastActive = cloudLastActive;
  if (pendingOperations.length > 0 && localActivity >= cloudActivity) {
    streak = localActivity === cloudActivity
      ? Math.max(streak, finiteNonNegativeGamificationValue(local.streak))
      : finiteNonNegativeGamificationValue(local.streak);
    lastActive = localLastActive ?? cloudLastActive;
  }
  const rebased = applyPendingXpOperations({
    streak,
    xp: finiteNonNegativeGamificationValue(cloud.xp),
    lastActive,
    history: normalizeGamificationHistory(cloud.history),
    appliedOperationIds,
    ...(Object.keys(appliedOperationSequenceByClient).length > 0
      ? { appliedOperationSequenceByClient }
      : {}),
  }, pendingOperations);
  return pendingOperations.length > 0
    ? { ...rebased, pendingOperations }
    : rebased;
}

export function addXpToGamification(
  snapshot: GamificationSnapshotWithHistory,
  amount: number,
  now: Date,
): GamificationSnapshotWithHistory {
  if (!validXpDelta(amount)) return snapshot;
  const day = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  return {
    ...snapshot,
    xp: Math.min(
      MAX_XP_VALUE,
      Math.max(0, finiteNonNegativeGamificationValue(snapshot.xp) + amount),
    ),
    lastActive: now.toDateString(),
    history: addXpToHistory(snapshot.history, day, amount),
  };
}
