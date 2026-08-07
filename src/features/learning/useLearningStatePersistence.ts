import { useRef } from 'react';
import { applyCardPatchWithConflictRecovery, deleteCardWithConflictRecovery } from '../../lib/cardConflictRecovery';
import { applySuccessfulPatchMetadata } from '../../lib/cardCreation';
import { clearMirroredCards, deleteMirroredCard, patchMirroredCardBatch } from '../../lib/cardMirror';
import { selectMutableCardPatch } from '../../lib/cardMutationProtocol';
import { isCardDue } from '../../lib/srs';
import {
  acquireDevicePendingFlush,
  clearDevicePending,
  releaseDevicePendingFlush,
  saveDeviceCards,
  type DevicePendingOperation,
} from '../../lib/deviceSync';
import {
  applyCardPatchIfCurrent,
  deleteAllCards,
  deleteCardWithTombstone,
  incrementLibraryEpoch,
} from '../../lib/cardRepository';
import { db, handleFirestoreError, isFirebaseConfigured, OperationType } from '../../lib/firebase';
import {
  cloudBackoffCacheKey,
  cloudFacetsCacheKey,
  cloudPageCacheKey,
  cloudStatsCacheKey,
  isQuotaError,
  isRetryableSyncError,
  removeLocalValue,
  writeLocalValue,
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

function cacheCloudBackoff(ownerId: string): void {
  writeLocalValue(cloudBackoffCacheKey(ownerId), String(Date.now() + 5 * 60 * 1000));
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
  if (retryOwnerRef.current !== options.ownerId) {
    retryReviewMutationsRef.current.clear();
    retryOwnerRef.current = options.ownerId;
  }
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
        const queued = await current.patchDeviceCards(
          [{ card: { ...source, ...mutation.fields }, fields: mutation.fields }],
          current.knownLibraryTotal,
          mutation.operationId,
        );
        let publication: LearningStatePublication = mutation.publication;
        if (ownerId && current.verifiedEpoch !== null && db && isFirebaseConfigured) {
          const database = db;
          const pendingPatch = queued.find(operation => operation.type === 'patch');
          if (!pendingPatch) throw new Error('The patch command could not be queued safely.');
          try {
            const fieldMask = pendingPatch.fieldMask ?? mutation.fieldMask;
            const result = await applyCardPatchWithConflictRecovery({
              cardId: mutation.cardId,
              fields: pendingPatch.fields,
              fieldMask,
              baseRevision: pendingPatch.baseRevision ?? mutation.baseRevision,
              libraryEpoch: pendingPatch.libraryEpoch ?? mutation.libraryEpoch,
            }, command => applyCardPatchIfCurrent(database, ownerId, command));
            if (result.applied) {
              const metadata = {
                revision: result.revision,
                libraryEpoch: pendingPatch.libraryEpoch ?? mutation.libraryEpoch,
                updatedAt: new Date().toISOString(),
              };
              const advanced = applySuccessfulPatchMetadata(source, pendingPatch.fields, metadata, fieldMask);
              const fields = selectMutableCardPatch(pendingPatch.fields, fieldMask);
              await patchMirroredCardBatch(ownerId, [{
                cardId: mutation.cardId,
                fields: { ...fields, schemaVersion: 2, ...metadata },
              }]);
              await current.acknowledgeDevicePending([pendingPatch]);
              publication = {
                kind: 'patch',
                cardId: mutation.cardId,
                fields: {
                  ...pendingPatch.fields,
                  schemaVersion: advanced.schemaVersion,
                  revision: advanced.revision,
                  libraryEpoch: advanced.libraryEpoch,
                  updatedAt: advanced.updatedAt,
                },
              };
            } else if (result.reason === 'stale-library-epoch' || result.reason === 'missing') {
              await current.acknowledgeDevicePending([pendingPatch]);
            } else {
              current.reportError(result.reason === 'future-library-epoch'
                ? 'Cloud library generation changed. Your local update is still queued while sync state refreshes.'
                : 'The card changed again during conflict recovery. Your local update remains safely queued.');
            }
          } catch (cause) {
            console.warn('Card update stayed local because cloud sync failed.', cause);
            current.setCloudUnavailable(true);
          }
        }

        if (latestRef.current.ownerId !== ownerId || !latestRef.current.canPublishPatch(mutation.cardId)) {
          retryReviewMutationsRef.current.delete(mutation.operationId);
          return resultFor(mutation, { kind: 'patch', cardId: mutation.cardId, fields: {} });
        }
        if (ownerId && mutation.intent === 'bookmark') {
          current.updateCloudStats(stats => ({
            ...stats,
            bookmarked: Math.max(0, stats.bookmarked + (mutation.fields.bookmarked ? 1 : -1)),
          }));
        }
        if (mutation.intent === 'review') {
          if (ownerId) {
            const previousDifficulty = source.difficulty && source.difficulty !== 'unrated'
              ? source.difficulty
              : 'unrated';
            const difficulty = mutation.fields.difficulty ?? 'hard';
            current.updateCloudStats(stats => previousDifficulty === difficulty
              ? {
                  ...stats,
                  reviewed: (source.reviews ?? 0) > 0 ? stats.reviewed : stats.reviewed + 1,
                  due: source.nextReviewDate && isCardDue(source) ? Math.max(0, stats.due - 1) : stats.due,
                }
              : {
                  ...stats,
                  reviewed: (source.reviews ?? 0) > 0 ? stats.reviewed : stats.reviewed + 1,
                  [previousDifficulty]: Math.max(0, stats[previousDifficulty] - 1),
                  [difficulty]: stats[difficulty] + 1,
                  due: source.nextReviewDate && isCardDue(source) ? Math.max(0, stats.due - 1) : stats.due,
                });
          }
          current.addXp(2);
        }
        retryReviewMutationsRef.current.delete(mutation.operationId);
        return resultFor(mutation, publication);
      }

      if (mutation.operation === 'delete') {
        if (ownerId && current.verifiedEpoch === null) {
          throw new Error('Cloud sync state is not verified yet. Try deleting the card again after synchronization reconnects.');
        }
        let queued: DevicePendingOperation[];
        try {
          queued = await current.removeDeviceCard(mutation.cardId);
        } catch (cause) {
          console.warn('The delete command could not be stored safely.', cause);
          throw new Error('The delete could not be stored safely, so the card was left unchanged. Please try again.');
        }
        if (ownerId && db && isFirebaseConfigured) {
          const database = db;
          const pendingDelete = queued.find(operation => operation.type === 'delete');
          if (!pendingDelete) throw new Error('The delete command could not be queued safely.');
          try {
            const result = await deleteCardWithConflictRecovery({
              cardId: mutation.cardId,
              opId: pendingDelete.opId ?? mutation.operationId,
              libraryEpoch: pendingDelete.libraryEpoch ?? mutation.libraryEpoch,
              baseRevision: pendingDelete.baseRevision ?? mutation.baseRevision,
            }, command => deleteCardWithTombstone(database, ownerId, command));
            if (!result.deleted && result.reason !== 'stale-library-epoch') {
              current.reportError(result.reason === 'future-library-epoch'
                ? 'Cloud library generation changed. The delete is still queued while sync state refreshes.'
                : 'The card changed again during delete recovery. The delete remains safely queued.');
              return resultFor(mutation);
            }
            await deleteMirroredCard(ownerId, mutation.cardId).catch(cause => {
              console.warn('The local mirror will catch up with the cloud delete on the next sync.', cause);
            });
            await current.acknowledgeDevicePending(queued);
            if (source && latestRef.current.ownerId === ownerId) {
              const difficulty = source.difficulty && source.difficulty !== 'unrated' ? source.difficulty : 'unrated';
              current.updateCloudStats(stats => ({
                ...stats,
                total: Math.max(0, stats.total - 1),
                reviewed: (source.reviews ?? 0) > 0 ? Math.max(0, stats.reviewed - 1) : stats.reviewed,
                [difficulty]: Math.max(0, stats[difficulty] - 1),
                bookmarked: source.bookmarked ? Math.max(0, stats.bookmarked - 1) : stats.bookmarked,
                due: source.nextReviewDate && isCardDue(source) ? Math.max(0, stats.due - 1) : stats.due,
              }));
              void current.updateCategoryFacets({ [source.category || 'Other']: -1 });
            }
          } catch (cause) {
            handleFirestoreError(cause, OperationType.DELETE, `users/${ownerId}/cards/${mutation.cardId}`);
            if (isRetryableSyncError(cause)) {
              current.setCloudUnavailable(true);
              if (isQuotaError(cause)) cacheCloudBackoff(ownerId);
              current.reportError('The card was deleted locally and queued. It will sync automatically when Firebase is available.');
            } else {
              await current.acknowledgeDevicePending(queued);
              throw new Error('Firebase rejected the delete. The card has been restored on screen.');
            }
          }
        }
        return resultFor(mutation);
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
            deleteCards: () => deleteAllCards(database, ownerId),
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
