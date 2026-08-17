import { useEffect, useRef } from 'react';
import { clearMirroredCards } from '../../lib/cardMirror';
import { isCardDue } from '../../lib/srs';
import {
  acknowledgePendingMutationSettlements,
  acquireDevicePendingFlush,
  clearDevicePending,
  loadPendingMutationSettlements,
  MAX_PENDING_MUTATION_SETTLEMENTS_PER_DRAIN,
  releaseDevicePendingFlush,
  saveDeviceCards,
  subscribeToPendingMutationSettlements,
  type DeviceMutationAccounting,
  type DevicePendingOperation,
  type PendingMutationDisposition,
} from '../../lib/deviceSync';
import { deleteAllCards, incrementLibraryEpoch } from '../../lib/cardRepository';
import { db, isFirebaseConfigured } from '../../lib/firebase';
import {
  GAMIFICATION_PENDING_CAPACITY_RELEASED_EVENT,
  PendingXpQueueFullError,
} from '../gamification/gamificationStorage';
import {
  cloudFacetsCacheKey,
  cloudPageCacheKey,
  cloudStatsCacheKey,
  removeLocalValue,
} from '../library/libraryStorage';
import { planClearFailureRecovery, runEpochProtectedLibraryClear } from '../library/libraryMutationRecovery';
import type {
  LearningStateMutation,
  LearningStateMutationResult,
  LearningStatePublication,
} from './learningStateController';
import type { LearningPersistenceOptions } from './learningPersistencePort';
import type { LearningStatePersistencePort } from './useLearningState';
import { doc, setDoc } from 'firebase/firestore';

const resultFor = (
  mutation: LearningStateMutation,
  publication: LearningStatePublication = mutation.publication,
): LearningStateMutationResult => ({
  ownerKey: mutation.ownerKey,
  operationId: mutation.operationId,
  publication,
});

const MAX_RETAINED_REVIEW_RETRIES = 32;
const REVIEW_XP_DELTA = 2;
const REVIEW_ACCOUNTING: DeviceMutationAccounting = {
  version: 1,
  xp: { delta: REVIEW_XP_DELTA },
};

function emptyPublicationFor(mutation: Extract<LearningStateMutation, { cardId: string }>): LearningStatePublication {
  return { kind: 'patch', cardId: mutation.cardId, fields: {} };
}

function clearCloudCaches(ownerId: string): void {
  removeLocalValue(cloudPageCacheKey(ownerId));
  removeLocalValue(cloudStatsCacheKey(ownerId));
  removeLocalValue(cloudFacetsCacheKey(ownerId));
}

export function useLearningStatePersistence(options: LearningPersistenceOptions): LearningStatePersistencePort {
  const latestRef = useRef(options);
  latestRef.current = options;
  const retryReviewMutationsRef = useRef(new Map<string, LearningStateMutation>());
  const retryOwnerRef = useRef(options.ownerId);
  const settlementDrainRef = useRef<Promise<void>>(Promise.resolve());
  if (retryOwnerRef.current !== options.ownerId) {
    retryReviewMutationsRef.current.clear();
    retryOwnerRef.current = options.ownerId;
  }

  const drainPendingSettlements = (ownerId: string): Promise<void> => {
    const drain = async (): Promise<void> => {
      if (latestRef.current.ownerId !== ownerId) return;
      let refreshedCloud = false;
      try {
        while (latestRef.current.ownerId === ownerId) {
          const settlements = await loadPendingMutationSettlements(ownerId);
          if (!settlements.length || latestRef.current.ownerId !== ownerId) return;
          if (!refreshedCloud) {
            latestRef.current.refreshCloud();
            refreshedCloud = true;
          }
          const acknowledgedOperationIds: string[] = [];
          for (const settlement of settlements) {
            if (latestRef.current.ownerId !== ownerId) break;
            const xp = settlement.outcome === 'applied' ? settlement.accounting?.xp : undefined;
            if (xp) {
              let durablyWritten: boolean;
              try {
                durablyWritten = latestRef.current.addXp(xp.delta, {
                  operationId: settlement.logicalOperationId,
                  settledAt: settlement.settledAt,
                });
              } catch (cause) {
                if (acknowledgedOperationIds.length > 0) {
                  await acknowledgePendingMutationSettlements(
                    ownerId,
                    acknowledgedOperationIds,
                  );
                }
                if (cause instanceof PendingXpQueueFullError) {
                  latestRef.current.reportError(
                    'Synced review rewards are waiting for XP sync capacity. They remain safe and will retry after queued XP is stored.',
                  );
                  return;
                }
                throw cause;
              }
              if (!durablyWritten) {
                if (acknowledgedOperationIds.length > 0) {
                  await acknowledgePendingMutationSettlements(
                    ownerId,
                    acknowledgedOperationIds,
                  );
                }
                latestRef.current.reportError(
                  'A synced review reward is waiting for safe browser storage. Free browser storage or reload to retry.',
                );
                return;
              }
            }
            acknowledgedOperationIds.push(settlement.logicalOperationId);
          }
          if (acknowledgedOperationIds.length > 0) {
            await acknowledgePendingMutationSettlements(
              ownerId,
              acknowledgedOperationIds,
            );
          }
          if (settlements.length < MAX_PENDING_MUTATION_SETTLEMENTS_PER_DRAIN) return;
        }
      } catch (cause) {
        console.warn('Queued learning accounting could not be reconciled.', cause);
        if (latestRef.current.ownerId === ownerId) {
          latestRef.current.reportError(
            'Synced learning rewards remain queued safely on this device and will retry.',
          );
        }
      }
    };
    const operation = settlementDrainRef.current.then(drain, drain);
    settlementDrainRef.current = operation.catch(() => undefined);
    return operation;
  };

  useEffect(() => {
    const ownerId = options.ownerId;
    if (!ownerId) return;
    const requestDrain = (): void => {
      void drainPendingSettlements(ownerId);
    };
    const unsubscribe = subscribeToPendingMutationSettlements(settlement => {
      if (settlement.ownerUserId === ownerId) requestDrain();
    });
    const requestCapacityDrain = (event: Event): void => {
      const detail = (event as CustomEvent<{ ownerId?: unknown }>).detail;
      if (detail?.ownerId === ownerId) requestDrain();
    };
    window.addEventListener('focus', requestDrain);
    window.addEventListener(
      GAMIFICATION_PENDING_CAPACITY_RELEASED_EVENT,
      requestCapacityDrain,
    );
    requestDrain();
    return () => {
      unsubscribe();
      window.removeEventListener('focus', requestDrain);
      window.removeEventListener(
        GAMIFICATION_PENDING_CAPACITY_RELEASED_EVENT,
        requestCapacityDrain,
      );
    };
  }, [options.ownerId]);

  const persistenceRef = useRef<LearningStatePersistencePort | null>(null);

  if (!persistenceRef.current) persistenceRef.current = {
    findCard: cardId => latestRef.current.findCard(cardId),
    persist: async mutation => {
      if (mutation.operation === 'review') {
        const retained = retryReviewMutationsRef.current.get(mutation.operationId);
        if (retained) mutation = retained;
        else {
          if (retryReviewMutationsRef.current.size >= MAX_RETAINED_REVIEW_RETRIES) {
            const oldestOperationId = retryReviewMutationsRef.current.keys().next().value;
            if (oldestOperationId) retryReviewMutationsRef.current.delete(oldestOperationId);
          }
          retryReviewMutationsRef.current.set(mutation.operationId, mutation);
        }
      }
      const current = latestRef.current;
      const ownerId = current.ownerId;
      const source = 'cardId' in mutation ? current.findCard(mutation.cardId) : undefined;

      if (mutation.operation === 'patch' || mutation.operation === 'review') {
        if (!source) throw new Error('The card is no longer available for this update.');
        const patchMutation = mutation;
        const queued = await current.patchDeviceCards(
          [{ card: { ...source, ...patchMutation.fields }, fields: patchMutation.fields }],
          current.knownLibraryTotal,
          patchMutation.operationId,
          patchMutation.intent === 'review' ? REVIEW_ACCOUNTING : undefined,
        );
        if (!queued.some(operation => operation.type === 'patch')) {
          throw new Error('The patch command could not be queued safely.');
        }
        let disposition: PendingMutationDisposition = ownerId ? 'deferred' : 'applied';
        if (ownerId && current.verifiedEpoch !== null) {
          disposition = await current.flushDeviceCards(patchMutation.operationId);
        }

        if (ownerId && disposition !== 'deferred') {
          await drainPendingSettlements(ownerId);
        }
        if (
          latestRef.current.ownerId !== ownerId
          || !latestRef.current.canPublishPatch(patchMutation.cardId)
        ) {
          retryReviewMutationsRef.current.delete(patchMutation.operationId);
          return resultFor(patchMutation, emptyPublicationFor(patchMutation));
        }
        if (disposition !== 'applied' && disposition !== 'deferred') {
          retryReviewMutationsRef.current.delete(patchMutation.operationId);
          return resultFor(patchMutation, emptyPublicationFor(patchMutation));
        }

        if (!ownerId) {
          if (patchMutation.intent === 'bookmark') {
            current.updateCloudStats(stats => ({
              ...stats,
              bookmarked: Math.max(
                0,
                stats.bookmarked + (patchMutation.fields.bookmarked ? 1 : -1),
              ),
            }));
          }
          if (patchMutation.intent === 'review') {
            const previousDifficulty = source.difficulty && source.difficulty !== 'unrated'
              ? source.difficulty
              : 'unrated';
            const difficulty = patchMutation.fields.difficulty ?? 'hard';
            current.updateCloudStats(stats => previousDifficulty === difficulty
              ? {
                  ...stats,
                  reviewed: (source.reviews ?? 0) > 0 ? stats.reviewed : stats.reviewed + 1,
                  due: source.nextReviewDate && isCardDue(source)
                    ? Math.max(0, stats.due - 1)
                    : stats.due,
                }
              : {
                  ...stats,
                  reviewed: (source.reviews ?? 0) > 0 ? stats.reviewed : stats.reviewed + 1,
                  [previousDifficulty]: Math.max(0, stats[previousDifficulty] - 1),
                  [difficulty]: stats[difficulty] + 1,
                  due: source.nextReviewDate && isCardDue(source)
                    ? Math.max(0, stats.due - 1)
                    : stats.due,
                });
            if (!current.addXp(REVIEW_XP_DELTA, { operationId: patchMutation.operationId })) {
              current.reportError('The review was saved, but its XP reward could not be stored safely.');
            }
          }
        }
        retryReviewMutationsRef.current.delete(patchMutation.operationId);
        return resultFor(patchMutation);
      }

      if (mutation.operation === 'delete') {
        const deleteMutation = mutation;
        let queued: DevicePendingOperation[];
        try {
          queued = await current.removeDeviceCard(deleteMutation.cardId, {
            libraryEpoch: deleteMutation.libraryEpoch,
            baseRevisions: { [deleteMutation.cardId]: deleteMutation.baseRevision },
            logicalOperationId: deleteMutation.operationId,
          });
        } catch (cause) {
          console.warn('The delete command could not be stored safely.', cause);
          throw new Error('The delete could not be stored safely, so the card was left unchanged. Please try again.');
        }
        if (!queued.some(operation => operation.type === 'delete')) {
          throw new Error('The delete command could not be queued safely.');
        }
        let disposition: PendingMutationDisposition = ownerId ? 'deferred' : 'applied';
        if (ownerId && current.verifiedEpoch !== null) {
          disposition = await current.flushDeviceCards(deleteMutation.operationId);
        }
        if (ownerId && disposition !== 'deferred') {
          await drainPendingSettlements(ownerId);
        }
        if (disposition !== 'applied' && disposition !== 'deferred') {
          return resultFor(deleteMutation, emptyPublicationFor(deleteMutation));
        }
        if (!ownerId && source) {
          const difficulty = source.difficulty && source.difficulty !== 'unrated'
            ? source.difficulty
            : 'unrated';
          current.updateCloudStats(stats => ({
            ...stats,
            total: Math.max(0, stats.total - 1),
            reviewed: (source.reviews ?? 0) > 0
              ? Math.max(0, stats.reviewed - 1)
              : stats.reviewed,
            [difficulty]: Math.max(0, stats[difficulty] - 1),
            bookmarked: source.bookmarked
              ? Math.max(0, stats.bookmarked - 1)
              : stats.bookmarked,
            due: source.nextReviewDate && isCardDue(source)
              ? Math.max(0, stats.due - 1)
              : stats.due,
          }));
        }
        return resultFor(deleteMutation);
      }

      if (mutation.operation === 'clear') {
        if (!ownerId || !db || !isFirebaseConfigured) {
          await saveDeviceCards([], 0, [], 'replace', null);
          return resultFor(mutation);
        }
        current.setMutationPending(true);
        const database = db;
        const acquired = await acquireDevicePendingFlush(ownerId);
        if (!acquired) {
          current.setMutationPending(false);
          throw new Error('Cloud sync is finishing another operation. Try clearing the library again in a moment.');
        }
        let cardDeletionCompleted = false;
        try {
          await runEpochProtectedLibraryClear({
            incrementEpoch: () => incrementLibraryEpoch(database, ownerId),
            onEpochAdvanced: epoch => current.acceptVerifiedEpoch(ownerId, epoch),
            clearPending: () => clearDevicePending(ownerId),
            deleteCards: clearEpoch => deleteAllCards(database, ownerId, clearEpoch),
          });
          cardDeletionCompleted = true;
          await clearMirroredCards(ownerId).catch(cause => {
            console.warn('The local mirror will reset on the next sync.', cause);
          });
          await setDoc(doc(database, 'users', ownerId, 'profile', 'library_facets'), {
            categories: {}, complete: true, version: 1, updatedAt: new Date().toISOString(),
          });
          if (latestRef.current.ownerId === ownerId) current.resetCloudState(true);
          await saveDeviceCards([], 0, [], 'replace', ownerId);
          if (latestRef.current.ownerId === ownerId) current.resetCloudPage();
          return resultFor(mutation);
        } catch (cause) {
          const recovery = planClearFailureRecovery(cardDeletionCompleted);
          clearCloudCaches(ownerId);
          if (latestRef.current.ownerId === ownerId) {
            current.resetCloudPage();
            current.refreshCloud();
            current.reportError(recovery.message);
          }
          if (!recovery.clearLocalView) throw new Error(recovery.message, { cause });
          if (latestRef.current.ownerId === ownerId) current.resetCloudState(false);
          await saveDeviceCards([], 0, [], 'replace', ownerId);
          return resultFor(mutation);
        } finally {
          await releaseDevicePendingFlush(ownerId);
          current.setMutationPending(false);
        }
      }

      return resultFor(mutation);
    },
  };

  return persistenceRef.current;
}
