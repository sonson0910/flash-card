import { doc, runTransaction, type Firestore } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import {
  app,
  auth,
  db,
  isFirebaseConfigured,
  protectedFunctionsCapability,
} from '../../lib/firebase';
import {
  assertProtectedFunctionsAvailable,
  classifyProtectedFunctionError,
  ProtectedFunctionError,
} from '../../lib/protectedFunctionsCapability';
import {
  MAX_XP_OPERATIONS_PER_SAVE,
  MAX_XP_STREAM_WATERMARKS,
  finiteNonNegativeGamificationValue,
  isValidLegacyXpSequenceByClient,
  isStructuredXpOperation,
  normalizeAppliedXpOperationIds,
  normalizeAppliedXpSequenceByClient,
  normalizeGamificationHistory,
  normalizePendingXpOperations,
  normalizeXpStreamWatermark,
} from './gamificationModel';
import type { GamificationStore, GamificationStoreSaveCommit } from './gamificationStore';

export class XpStreamMigrationRequiredError extends Error {
  readonly code = 'GAMIFICATION_XP_STREAM_MIGRATION_REQUIRED';

  constructor() {
    super('The stored XP stream metadata is invalid and requires protected migration.');
    this.name = 'XpStreamMigrationRequiredError';
  }
}

export class XpSequenceGapError extends Error {
  readonly code = 'GAMIFICATION_XP_SEQUENCE_GAP';

  constructor(clientId: string, expectedSequence: number, receivedSequence: number) {
    super(
      `Cannot bootstrap XP client ${clientId}: expected sequence ${expectedSequence}, received ${receivedSequence}.`,
    );
    this.name = 'XpSequenceGapError';
  }
}

const validLastActive = (value: unknown): string | null => typeof value === 'string'
  && value.length <= 64
  && Number.isFinite(Date.parse(value))
  ? value
  : null;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const strictCounter = (value: unknown): number => {
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > Number.MAX_SAFE_INTEGER) {
    throw new Error('Gamification callable returned an invalid counter.');
  }
  return Number(value);
};

const strictOperationId = (value: unknown): value is string => typeof value === 'string'
  && value.length > 0
  && value.length <= 128
  && /^[A-Za-z0-9][A-Za-z0-9:_-]*$/.test(value);

const strictHistory = (value: unknown): Record<string, number> => {
  if (!isRecord(value) || Object.keys(value).length > 730) {
    throw new Error('Gamification callable returned invalid history.');
  }
  const history: Record<string, number> = {};
  for (const [day, amount] of Object.entries(value)) {
    if (!day || day.length > 64 || day === '__proto__' || day === 'constructor' || day === 'prototype') {
      throw new Error('Gamification callable returned invalid history.');
    }
    history[day] = strictCounter(amount);
  }
  return history;
};

const parseCallableResponse = (value: unknown): GamificationStoreSaveCommit => {
  if (!isRecord(value)
    || Object.keys(value).some(key => !['snapshot', 'appliedOperationIds'].includes(key))
    || !Object.prototype.hasOwnProperty.call(value, 'snapshot')
    || !Object.prototype.hasOwnProperty.call(value, 'appliedOperationIds')) {
    throw new Error('Gamification callable returned an invalid response.');
  }
  const source = value.snapshot;
  if (!isRecord(source)) throw new Error('Gamification callable returned an invalid snapshot.');
  const hasSequenceMap = Object.prototype.hasOwnProperty.call(source, 'appliedOperationSequenceByClient');
  const expectedKeys = [
    'streak', 'xp', 'lastActive', 'history', 'appliedOperationIds',
    ...(hasSequenceMap ? ['appliedOperationSequenceByClient'] : []),
  ];
  if (Object.keys(source).length !== expectedKeys.length || Object.keys(source).some(key => !expectedKeys.includes(key))) {
    throw new Error('Gamification callable returned an invalid snapshot shape.');
  }
  if (!(source.lastActive === null || validLastActive(source.lastActive))) {
    throw new Error('Gamification callable returned an invalid last-active date.');
  }
  const lastActive = source.lastActive === null ? null : validLastActive(source.lastActive);
  if (!Array.isArray(value.appliedOperationIds) || value.appliedOperationIds.length > 2048
    || value.appliedOperationIds.some(id => !strictOperationId(id))) {
    throw new Error('Gamification callable returned invalid acknowledgements.');
  }
  if (!Array.isArray(source.appliedOperationIds) || source.appliedOperationIds.length > 2048
    || source.appliedOperationIds.some(id => !strictOperationId(id))) {
    throw new Error('Gamification callable returned invalid receipt metadata.');
  }
  const appliedOperationSequenceByClient: Record<string, number> = {};
  if (hasSequenceMap) {
    if (!isRecord(source.appliedOperationSequenceByClient)
      || Object.keys(source.appliedOperationSequenceByClient).length > MAX_XP_STREAM_WATERMARKS) {
      throw new Error('Gamification callable returned invalid stream metadata.');
    }
    for (const [clientId, sequence] of Object.entries(source.appliedOperationSequenceByClient)) {
      if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(clientId)
        || clientId === '__proto__' || clientId === 'constructor' || clientId === 'prototype') {
        throw new Error('Gamification callable returned invalid stream metadata.');
      }
      appliedOperationSequenceByClient[clientId] = strictCounter(sequence);
      if (appliedOperationSequenceByClient[clientId] < 1) {
        throw new Error('Gamification callable returned invalid stream metadata.');
      }
    }
  }
  return {
    snapshot: {
      streak: strictCounter(source.streak),
      xp: strictCounter(source.xp),
      lastActive,
      history: strictHistory(source.history),
      appliedOperationIds: source.appliedOperationIds,
      ...(hasSequenceMap ? { appliedOperationSequenceByClient } : {}),
    },
    appliedOperationIds: value.appliedOperationIds,
  };
};

const mapGamificationCallableError = (error: unknown): Error | null => {
  if (!isRecord(error)) return null;
  const code = typeof error.code === 'string'
    ? error.code.toLowerCase().replace(/^firebase\//, '').replace(/^functions\//, '')
    : '';
  const details = isRecord(error.details) ? error.details : error;
  if (code && code !== 'failed-precondition') return null;
  const reason = details.reason;
  if (reason === 'xp-stream-migration-required') return new XpStreamMigrationRequiredError();
  if (reason === 'xp-sequence-gap'
    && typeof details.clientId === 'string'
    && Number.isSafeInteger(details.expectedSequence)
    && Number.isSafeInteger(details.receivedSequence)) {
    return new XpSequenceGapError(
      details.clientId,
      Number(details.expectedSequence),
      Number(details.receivedSequence),
    );
  }
  return null;
};

export const createFirebaseGamificationStore = (database: Firestore): GamificationStore => ({
  async load(ownerId, localFallback) {
    const statsRef = doc(database, 'users', ownerId, 'profile', 'stats');
    const historyRef = doc(database, 'users', ownerId, 'profile', 'xp_history');
    const streamRefs = new Map(
      normalizePendingXpOperations(localFallback.pendingOperations)
        .slice(0, MAX_XP_OPERATIONS_PER_SAVE)
        .filter(isStructuredXpOperation)
        .map(operation => [
          operation.clientId,
          doc(database, 'users', ownerId, 'xp_streams', operation.clientId),
        ]),
    );
    const { statsSnapshot, historySnapshot, streamSnapshots } = await runTransaction(
      database,
      async transaction => {
        const [statsSnapshot, historySnapshot] = await Promise.all([
          transaction.get(statsRef),
          transaction.get(historyRef),
        ]);
        const streamSnapshots = await Promise.all(
          Array.from(streamRefs.values()).map(reference => transaction.get(reference)),
        );
        return { statsSnapshot, historySnapshot, streamSnapshots };
      },
    );
    const source = statsSnapshot.exists() ? statsSnapshot.data() : {};
    const hasLegacySequenceMap = Object.prototype.hasOwnProperty.call(
      source,
      'appliedXpSequenceByClient',
    );
    if (hasLegacySequenceMap && !isValidLegacyXpSequenceByClient(
      source.appliedXpSequenceByClient,
    )) throw new XpStreamMigrationRequiredError();
    const appliedOperationSequenceByClient = normalizeAppliedXpSequenceByClient(
      statsSnapshot.exists()
        ? source.appliedXpSequenceByClient
        : localFallback.appliedOperationSequenceByClient,
    );
    let verifiedStreamWatermark = false;
    Array.from(streamRefs.keys()).forEach((clientId, index) => {
      const streamSnapshot = streamSnapshots[index];
      if (!streamSnapshot?.exists()) return;
      const watermark = normalizeXpStreamWatermark(streamSnapshot.data(), clientId);
      if (!watermark) throw new XpStreamMigrationRequiredError();
      verifiedStreamWatermark = true;
      appliedOperationSequenceByClient[clientId] = Math.max(
        appliedOperationSequenceByClient[clientId] ?? 0,
        watermark.sequence,
      );
    });
    if (!statsSnapshot.exists() && !historySnapshot.exists()) {
      const snapshot = {
        ...localFallback,
        ...(Object.keys(appliedOperationSequenceByClient).length > 0
          ? { appliedOperationSequenceByClient }
          : {}),
      };
      if (verifiedStreamWatermark) {
        return {
          source: 'cloud',
          cloudDocuments: { stats: false, history: false },
          snapshot,
        };
      }
      return {
        source: 'local-fallback',
        snapshot,
      };
    }
    return {
      source: 'cloud',
      ...(!statsSnapshot.exists() || !historySnapshot.exists()
        ? {
            cloudDocuments: {
              stats: statsSnapshot.exists(),
              history: historySnapshot.exists(),
            },
          }
        : {}),
      snapshot: {
        streak: statsSnapshot.exists()
          ? finiteNonNegativeGamificationValue(source.streak)
          : finiteNonNegativeGamificationValue(localFallback.streak),
        xp: statsSnapshot.exists()
          ? finiteNonNegativeGamificationValue(source.xp)
          : finiteNonNegativeGamificationValue(localFallback.xp),
        lastActive: statsSnapshot.exists()
          ? validLastActive(source.lastActive)
          : validLastActive(localFallback.lastActive),
        history: historySnapshot.exists()
          ? normalizeGamificationHistory(historySnapshot.data())
          : normalizeGamificationHistory(localFallback.history),
        appliedOperationIds: normalizeAppliedXpOperationIds(
          statsSnapshot.exists()
            ? source.appliedXpOperationIds
            : localFallback.appliedOperationIds,
        ),
        ...(Object.keys(appliedOperationSequenceByClient).length > 0
          ? { appliedOperationSequenceByClient }
          : {}),
      },
    };
  },

  async save(ownerId, snapshot) {
    assertProtectedFunctionsAvailable(protectedFunctionsCapability, 'Gamification sync');
    const assertCurrentOwner = () => {
      if (auth?.currentUser?.uid !== ownerId) {
        throw new ProtectedFunctionError({
          message: 'Gamification sync stopped because the active account changed. Retry after sign-in settles.',
          kind: 'authentication',
          code: 'owner-mismatch',
          retryable: false,
        });
      }
    };
    const pendingOperations = normalizePendingXpOperations(snapshot.pendingOperations)
      .slice(0, MAX_XP_OPERATIONS_PER_SAVE);
    const request = {
      snapshot: {
        streak: finiteNonNegativeGamificationValue(snapshot.streak),
        xp: finiteNonNegativeGamificationValue(snapshot.xp),
        lastActive: validLastActive(snapshot.lastActive),
        history: normalizeGamificationHistory(snapshot.history),
        pendingOperations: normalizePendingXpOperations(snapshot.pendingOperations),
      },
      operations: pendingOperations,
    };
    assertCurrentOwner();
    try {
      const callable = httpsCallable<typeof request, GamificationStoreSaveCommit>(
        getFunctions(app!, 'asia-southeast1'),
        'saveGamification',
      );
      assertCurrentOwner();
      const response = await callable(request);
      return parseCallableResponse(response.data);
    } catch (error) {
      const mapped = mapGamificationCallableError(error);
      if (mapped) throw mapped;
      throw classifyProtectedFunctionError(error, 'Gamification sync');
    }
  },
});

export const firebaseGamificationStore: GamificationStore | null = isFirebaseConfigured && db
  ? createFirebaseGamificationStore(db)
  : null;
