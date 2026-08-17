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
export const MAX_XP_CLIENT_STREAMS = 64;
export const MAX_LOGICAL_XP_OPERATION_ID_LENGTH = 512;
export const MAX_XP_OPERATION_ID_LENGTH = 128;

const MAX_XP_VALUE = Number.MAX_SAFE_INTEGER;
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
  && value.length <= MAX_XP_OPERATION_ID_LENGTH
  && /^[A-Za-z0-9][A-Za-z0-9:_-]*$/.test(value);

const KEYED_XP_OPERATION_ID_PATTERN = /^xp1:[0-9a-f]{32}$/;
const FNV_1A_128_OFFSET = 0x6c62272e07bb014262b821756295c58dn;
const FNV_1A_128_PRIME = 0x0000000001000000000000000000013bn;
const UINT_128_MASK = (1n << 128n) - 1n;

const deterministicOperationDigest = (value: string): string => {
  let hash = FNV_1A_128_OFFSET;
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    hash ^= BigInt(codeUnit & 0xff);
    hash = (hash * FNV_1A_128_PRIME) & UINT_128_MASK;
    hash ^= BigInt(codeUnit >>> 8);
    hash = (hash * FNV_1A_128_PRIME) & UINT_128_MASK;
  }
  return hash.toString(16).padStart(32, '0');
};

export const isKeyedXpOperationId = (value: unknown): value is string =>
  validOperationId(value) && KEYED_XP_OPERATION_ID_PATTERN.test(value);

export const keyedXpOperationReceiptId = (operationId: unknown): string | null =>
  isKeyedXpOperationId(operationId) ? operationId.slice('xp1:'.length) : null;

export const createKeyedXpOperationId = (logicalOperationId: unknown): string | null => {
  if (typeof logicalOperationId !== 'string') return null;
  const normalized = logicalOperationId.trim();
  if (
    normalized.length === 0
    || normalized.length > MAX_LOGICAL_XP_OPERATION_ID_LENGTH
  ) return null;
  if (isKeyedXpOperationId(normalized)) return normalized;
  return `xp1:${deterministicOperationDigest(normalized)}`;
};

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
        && validXpOperationSequence(sequence))
      .slice(0, MAX_XP_CLIENT_STREAMS),
  );
}

export const isStructuredXpOperation = (
  operation: PendingXpOperation,
): operation is PendingXpOperation & { clientId: string; sequence: number } =>
  validXpClientId(operation.clientId)
  && validXpOperationSequence(operation.sequence)
  && operation.id === createStructuredXpOperationId(operation.clientId, operation.sequence);

export const isKeyedXpOperation = (operation: PendingXpOperation): boolean =>
  isKeyedXpOperationId(operation.id);

export const isAppliedXpOperation = (
  operation: PendingXpOperation,
  appliedOperationIds: ReadonlySet<string>,
  appliedSequenceByClient: Readonly<Record<string, number>>,
): boolean => appliedOperationIds.has(operation.id)
  || (operation.legacyId !== undefined && appliedOperationIds.has(operation.legacyId))
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
  const normalizedPendingOperations = normalizePendingXpOperations(local.pendingOperations);
  const materializedKeyedOperationIds = new Set(
    normalizedPendingOperations
      .filter(operation => isKeyedXpOperation(operation)
        && isAppliedXpOperation(
          operation,
          applied,
          appliedOperationSequenceByClient,
        ))
      .map(operation => operation.id),
  );
  const pendingOperations = normalizedPendingOperations
    .filter(operation => materializedKeyedOperationIds.has(operation.id)
      || !isAppliedXpOperation(
        operation,
        applied,
        appliedOperationSequenceByClient,
      ));
  const operationsToApply = pendingOperations.filter(
    operation => !materializedKeyedOperationIds.has(operation.id),
  );
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
  }, operationsToApply);
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
