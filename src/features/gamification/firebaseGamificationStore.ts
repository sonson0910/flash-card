import { doc, runTransaction, type Firestore } from 'firebase/firestore';
import { db, isFirebaseConfigured } from '../../lib/firebase';
import {
  MAX_XP_CLIENT_STREAMS,
  MAX_XP_OPERATIONS_PER_SAVE,
  applyPendingXpOperations,
  finiteNonNegativeGamificationValue,
  isStructuredXpOperation,
  normalizeAppliedXpOperationIds,
  normalizeAppliedXpSequenceByClient,
  normalizeGamificationHistory,
  normalizePendingXpOperations,
  type GamificationSnapshotWithHistory,
  type PendingXpOperation,
} from './gamificationModel';
import type { GamificationStore } from './gamificationStore';

export class XpClientStreamLimitError extends Error {
  readonly code = 'GAMIFICATION_XP_CLIENT_STREAM_LIMIT';

  constructor() {
    super(`Cannot register more than ${MAX_XP_CLIENT_STREAMS} XP client streams.`);
    this.name = 'XpClientStreamLimitError';
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

const activityTime = (value: string | null): number => {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
};

const mergeActivity = (
  cloud: GamificationSnapshotWithHistory,
  candidate: GamificationSnapshotWithHistory,
): Pick<GamificationSnapshotWithHistory, 'streak' | 'lastActive'> => {
  const cloudLastActive = validLastActive(cloud.lastActive);
  const candidateLastActive = validLastActive(candidate.lastActive);
  const cloudActivity = activityTime(cloudLastActive);
  const candidateActivity = activityTime(candidateLastActive);
  if (candidateActivity > cloudActivity) {
    return {
      streak: finiteNonNegativeGamificationValue(candidate.streak),
      lastActive: candidateLastActive,
    };
  }
  return {
    streak: candidateActivity === cloudActivity
      ? Math.max(
        finiteNonNegativeGamificationValue(cloud.streak),
        finiteNonNegativeGamificationValue(candidate.streak),
      )
      : finiteNonNegativeGamificationValue(cloud.streak),
    lastActive: cloudLastActive ?? candidateLastActive,
  };
};

export const createFirebaseGamificationStore = (database: Firestore): GamificationStore => ({
  async load(ownerId, localFallback) {
    const statsRef = doc(database, 'users', ownerId, 'profile', 'stats');
    const historyRef = doc(database, 'users', ownerId, 'profile', 'xp_history');
    const [statsSnapshot, historySnapshot] = await runTransaction(
      database,
      transaction => Promise.all([
        transaction.get(statsRef),
        transaction.get(historyRef),
      ]),
    );
    if (!statsSnapshot.exists() && !historySnapshot.exists()) {
      return { source: 'local-fallback', snapshot: localFallback };
    }

    const source = statsSnapshot.exists() ? statsSnapshot.data() : {};
    const appliedOperationSequenceByClient = normalizeAppliedXpSequenceByClient(
      source.appliedXpSequenceByClient,
    );
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
        appliedOperationIds: normalizeAppliedXpOperationIds(source.appliedXpOperationIds),
        ...(Object.prototype.hasOwnProperty.call(source, 'appliedXpSequenceByClient')
          ? { appliedOperationSequenceByClient }
          : {}),
      },
    };
  },

  async save(ownerId, snapshot) {
    const statsRef = doc(database, 'users', ownerId, 'profile', 'stats');
    const historyRef = doc(database, 'users', ownerId, 'profile', 'xp_history');
    const pendingOperations = normalizePendingXpOperations(snapshot.pendingOperations);
    const requestedOperations = pendingOperations
      .slice(0, MAX_XP_OPERATIONS_PER_SAVE);

    return runTransaction(database, async transaction => {
      const [statsSnapshot, historySnapshot] = await Promise.all([
        transaction.get(statsRef),
        transaction.get(historyRef),
      ]);
      const statsSource = statsSnapshot.exists() ? statsSnapshot.data() : {};
      const existingAppliedOperationIds = normalizeAppliedXpOperationIds(
        statsSource.appliedXpOperationIds,
      );
      const hadSequenceProtocol = Object.prototype.hasOwnProperty.call(
        statsSource,
        'appliedXpSequenceByClient',
      );
      const appliedOperationSequenceByClient = normalizeAppliedXpSequenceByClient(
        statsSource.appliedXpSequenceByClient,
      );
      const alreadyApplied = new Set(existingAppliedOperationIds);
      const acknowledgedOperationIds: string[] = [];
      const newOperations: PendingXpOperation[] = [];

      const registerStructuredOperation = (
        operation: (typeof pendingOperations)[number] & { clientId: string; sequence: number },
        applyOperation: boolean,
      ) => {
        const previousSequence = appliedOperationSequenceByClient[operation.clientId] ?? 0;
        if (operation.sequence <= previousSequence) {
          acknowledgedOperationIds.push(operation.id);
          return;
        }
        if (operation.sequence !== previousSequence + 1) return;
        if (
          previousSequence === 0
          && !Object.prototype.hasOwnProperty.call(
            appliedOperationSequenceByClient,
            operation.clientId,
          )
          && Object.keys(appliedOperationSequenceByClient).length >= MAX_XP_CLIENT_STREAMS
        ) {
          throw new XpClientStreamLimitError();
        }
        if (applyOperation) newOperations.push(operation);
        acknowledgedOperationIds.push(operation.id);
        appliedOperationSequenceByClient[operation.clientId] = operation.sequence;
      };

      const operationsToClassify = statsSnapshot.exists()
        ? requestedOperations
        : [
            ...pendingOperations
              .filter(isStructuredXpOperation)
              .sort((left, right) => left.clientId === right.clientId
                ? left.sequence - right.sequence
                : left.clientId < right.clientId ? -1 : 1),
            ...pendingOperations.filter(operation => !isStructuredXpOperation(operation)),
          ];
      for (const operation of operationsToClassify) {
        const isInRecentLedger = alreadyApplied.has(operation.id)
          || (operation.legacyId ? alreadyApplied.has(operation.legacyId) : false);
        if (isStructuredXpOperation(operation)) {
          if (!statsSnapshot.exists()) {
            const expectedSequence = (appliedOperationSequenceByClient[operation.clientId] ?? 0) + 1;
            if (operation.sequence !== expectedSequence) {
              throw new XpSequenceGapError(
                operation.clientId,
                expectedSequence,
                operation.sequence,
              );
            }
            registerStructuredOperation(operation, false);
          } else {
            registerStructuredOperation(operation, !isInRecentLedger);
          }
        } else if (isInRecentLedger) {
          acknowledgedOperationIds.push(operation.id);
        } else if (!statsSnapshot.exists() || !hadSequenceProtocol) {
          acknowledgedOperationIds.push(operation.id);
          if (statsSnapshot.exists()) newOperations.push(operation);
        }
      }

      let committed: GamificationSnapshotWithHistory;
      if (!statsSnapshot.exists()) {
        const bootstrapHistory = historySnapshot.exists()
          ? applyPendingXpOperations({
              streak: 0,
              xp: 0,
              lastActive: null,
              history: normalizeGamificationHistory(historySnapshot.data()),
            }, pendingOperations).history
          : normalizeGamificationHistory(snapshot.history);
        committed = {
          streak: finiteNonNegativeGamificationValue(snapshot.streak),
          xp: finiteNonNegativeGamificationValue(snapshot.xp),
          lastActive: validLastActive(snapshot.lastActive),
          history: bootstrapHistory,
        };
      } else {
        const cloud = {
          streak: finiteNonNegativeGamificationValue(statsSource.streak),
          xp: finiteNonNegativeGamificationValue(statsSource.xp),
          lastActive: validLastActive(statsSource.lastActive),
          history: historySnapshot.exists()
            ? normalizeGamificationHistory(historySnapshot.data())
            : {},
        };
        const activity = mergeActivity(cloud, snapshot);
        const withOperations = applyPendingXpOperations({ ...cloud, ...activity }, newOperations);
        committed = historySnapshot.exists()
          ? withOperations
          : { ...withOperations, history: normalizeGamificationHistory(snapshot.history) };
      }

      const appliedOperationIds = normalizeAppliedXpOperationIds([
        ...existingAppliedOperationIds,
        ...acknowledgedOperationIds,
      ]);
      const authoritativeSnapshot = {
        ...committed,
        appliedOperationIds,
        appliedOperationSequenceByClient,
      };
      transaction.set(statsRef, {
        streak: authoritativeSnapshot.streak,
        lastActive: authoritativeSnapshot.lastActive,
        xp: authoritativeSnapshot.xp,
        appliedXpOperationIds: appliedOperationIds,
        appliedXpSequenceByClient: appliedOperationSequenceByClient,
      });
      transaction.set(historyRef, authoritativeSnapshot.history);
      return {
        snapshot: authoritativeSnapshot,
        appliedOperationIds: acknowledgedOperationIds,
      };
    });
  },
});

export const firebaseGamificationStore: GamificationStore | null = isFirebaseConfigured && db
  ? createFirebaseGamificationStore(db)
  : null;
