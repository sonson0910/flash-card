import { useRef } from 'react';
import { applyCardPatchWithConflictRecovery, deleteCardWithConflictRecovery } from '../../lib/cardConflictRecovery';
import {
  applyReviewViaCallable,
  applyReviewWithConflictRecovery,
  type ReviewApplyResult,
} from '../../lib/cardReviewRepository';
import { applySuccessfulPatchMetadata } from '../../lib/cardCreation';
import {
  clearMirroredCards,
  deleteMirroredCardIfNotNewerThan,
  deleteMirroredCardIfOlderThan,
  patchMirroredCardBatch,
} from '../../lib/cardMirror';
import { selectMutableCardPatch } from '../../lib/cardMutationProtocol';
import { isCardDue } from '../../lib/srs';
import {
  clearDevicePending,
  deleteDeviceCardBackupIfNotNewerThan,
  saveDeviceCards,
  withDevicePendingFlush,
  type DevicePendingOperation,
  type DevicePendingFlushLeaseContext,
} from '../../lib/deviceSync';
import {
  applyCardPatchIfCurrent,
  clearLibraryFacets,
  deriveLibraryFacetOperationId,
  deleteAllCards,
  deleteCardWithTombstone,
  getLibraryEpoch,
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
import type { CardData } from '../../types/card';

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

const REVIEW_FIELDS = [
  'difficulty', 'nextReviewDate', 'reviews', 'interval', 'easeFactor',
  'fsrs', 'reviewHistory', 'correctStreak',
] as const;

const isValidReviewEntry = (value: unknown): value is NonNullable<CardData['reviewHistory']>[number] => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const entry = value as Record<string, unknown>;
  const keys = Object.keys(entry).sort();
  return keys.length === 4
    && keys.join(',') === 'elapsedDays,rating,reviewedAt,scheduledDays'
    && typeof entry.rating === 'string'
    && ['again', 'hard', 'good', 'easy'].includes(entry.rating)
    && typeof entry.reviewedAt === 'string'
    && Number.isFinite(Date.parse(entry.reviewedAt))
    && typeof entry.scheduledDays === 'number'
    && Number.isFinite(entry.scheduledDays)
    && entry.scheduledDays >= 0
    && typeof entry.elapsedDays === 'number'
    && Number.isFinite(entry.elapsedDays)
    && entry.elapsedDays >= 0;
};

const reviewFieldsFromCard = (card: Extract<ReviewApplyResult, { applied: true }>['card']) =>
  Object.fromEntries(REVIEW_FIELDS.map(field => [field, card[field]]));

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
        const queued = mutation.operation === 'review'
          ? await current.patchDeviceCards(
            [{ card: { ...source, ...mutation.fields }, fields: mutation.fields }],
            current.knownLibraryTotal,
            mutation.operationId,
            'review',
          )
          : await current.patchDeviceCards(
            [{ card: { ...source, ...mutation.fields }, fields: mutation.fields }],
            current.knownLibraryTotal,
            mutation.operationId,
          );
        let publication: LearningStatePublication = mutation.publication;
        let applyOptimisticEffects = mutation.operation !== 'review'
          || isValidReviewEntry(mutation.fields.reviewHistory?.at(-1));
        if (ownerId && current.verifiedEpoch !== null && db && isFirebaseConfigured) {
          const database = db;
          const pendingPatch = queued.find(operation => operation.type === 'patch');
          if (!pendingPatch) throw new Error('The patch command could not be queued safely.');
          try {
            const fieldMask = pendingPatch.fieldMask ?? mutation.fieldMask;
            const lastReviewCandidate = mutation.operation === 'review'
              ? pendingPatch.fields.reviewHistory?.at(-1)
              : undefined;
            const lastReview = isValidReviewEntry(lastReviewCandidate) ? lastReviewCandidate : undefined;
            let result;
            if (mutation.operation === 'review') {
              if (!lastReview) {
                current.reportError('Review update stayed queued because its history entry is invalid.');
                applyOptimisticEffects = false;
              } else {
                result = await applyReviewWithConflictRecovery({
                  cardId: mutation.cardId,
                  opId: pendingPatch.opId ?? mutation.operationId,
                  baseRevision: pendingPatch.baseRevision ?? mutation.baseRevision,
                  libraryEpoch: pendingPatch.libraryEpoch ?? mutation.libraryEpoch,
                  rating: lastReview.rating,
                  reviewedAt: lastReview.reviewedAt,
                  fields: pendingPatch.fields,
                  fieldMask,
                }, command => applyReviewViaCallable(database, ownerId, command));
              }
            } else {
              result = await applyCardPatchWithConflictRecovery({
                cardId: mutation.cardId,
                fields: pendingPatch.fields,
                fieldMask,
                baseRevision: pendingPatch.baseRevision ?? mutation.baseRevision,
                libraryEpoch: pendingPatch.libraryEpoch ?? mutation.libraryEpoch,
              }, command => applyCardPatchIfCurrent(database, ownerId, command));
            }
            if (result?.applied) {
              const reviewResult = 'card' in result ? result : null;
              const patchResult = 'revision' in result ? result : null;
              if (mutation.operation === 'review' && lastReview && !reviewResult) {
                throw new Error('The protected review service returned a non-authoritative result.');
              }
              const authoritativeFields = reviewResult
                ? reviewFieldsFromCard(reviewResult.card)
                : selectMutableCardPatch(pendingPatch.fields, fieldMask);
              const metadata = {
                revision: reviewResult?.card.revision ?? patchResult?.revision ?? 0,
                libraryEpoch: pendingPatch.libraryEpoch ?? mutation.libraryEpoch,
                updatedAt: reviewResult?.card.updatedAt ?? new Date().toISOString(),
              };
              const advanced = reviewResult
                ? { ...source, ...authoritativeFields, ...metadata, schemaVersion: 2 as const, id: source.id }
                : applySuccessfulPatchMetadata(source, pendingPatch.fields, metadata, fieldMask);
              await patchMirroredCardBatch(ownerId, [{
                cardId: mutation.cardId,
                fields: { ...authoritativeFields, ...metadata, schemaVersion: 2,
                  ...(reviewResult
                    ? { appliedReviewOperationIds: reviewResult.card.appliedReviewOperationIds }
                    : {}) },
              }]);
              await current.acknowledgeDevicePending([pendingPatch]);
              publication = {
                kind: 'patch',
                cardId: mutation.cardId,
                fields: {
                  ...authoritativeFields,
                  ...(reviewResult
                    ? { appliedReviewOperationIds: reviewResult.card.appliedReviewOperationIds }
                    : {}),
                  schemaVersion: advanced.schemaVersion,
                  revision: advanced.revision,
                  libraryEpoch: advanced.libraryEpoch,
                  updatedAt: advanced.updatedAt,
                },
              };
              if (reviewResult?.duplicate) applyOptimisticEffects = false;
            } else if (result?.reason === 'stale-library-epoch') {
              applyOptimisticEffects = false;
              publication = { kind: 'delete', cardId: mutation.cardId };
              const activeEpoch = await getLibraryEpoch(database, ownerId);
              await deleteDeviceCardBackupIfNotNewerThan(ownerId, mutation.cardId, {
                libraryEpoch: Math.max(0, activeEpoch - 1),
                revision: Number.MAX_SAFE_INTEGER,
              });
              await deleteMirroredCardIfOlderThan(ownerId, mutation.cardId, activeEpoch);
              current.acceptVerifiedEpoch(ownerId, activeEpoch);
              await current.acknowledgeDevicePending([pendingPatch]);
            } else if (result?.reason === 'missing') {
              applyOptimisticEffects = false;
              publication = { kind: 'delete', cardId: mutation.cardId };
              const maximum = {
                libraryEpoch: pendingPatch.libraryEpoch ?? mutation.libraryEpoch,
                revision: pendingPatch.baseRevision ?? mutation.baseRevision,
              };
              await deleteDeviceCardBackupIfNotNewerThan(ownerId, mutation.cardId, maximum);
              await deleteMirroredCardIfNotNewerThan(ownerId, mutation.cardId, maximum);
              await current.acknowledgeDevicePending([pendingPatch]);
              } else if (result) {
                current.reportError(result?.reason === 'future-library-epoch'
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
        if (!applyOptimisticEffects) {
          retryReviewMutationsRef.current.delete(mutation.operationId);
          return resultFor(mutation, publication);
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
        let queued: DevicePendingOperation[];
        try {
          queued = await current.removeDeviceCard(mutation.cardId, {
            libraryEpoch: mutation.libraryEpoch,
            baseRevisions: { [mutation.cardId]: mutation.baseRevision },
          });
        } catch (cause) {
          console.warn('The delete command could not be stored safely.', cause);
          throw new Error('The delete could not be stored safely, so the card was left unchanged. Please try again.');
        }
        if (ownerId && current.verifiedEpoch !== null && db && isFirebaseConfigured) {
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
            const applyDeleteStats = result.deleted;
            try {
              if (result.deleted) {
                const maximum = {
                  libraryEpoch: result.tombstone.libraryEpoch,
                  revision: Math.max(0, result.tombstone.revision - 1),
                };
                await deleteDeviceCardBackupIfNotNewerThan(ownerId, mutation.cardId, maximum);
                await deleteMirroredCardIfNotNewerThan(ownerId, mutation.cardId, maximum);
              } else {
                const activeEpoch = await getLibraryEpoch(database, ownerId);
                await deleteDeviceCardBackupIfNotNewerThan(ownerId, mutation.cardId, {
                  libraryEpoch: Math.max(0, activeEpoch - 1),
                  revision: Number.MAX_SAFE_INTEGER,
                });
                await deleteMirroredCardIfOlderThan(ownerId, mutation.cardId, activeEpoch);
                current.acceptVerifiedEpoch(ownerId, activeEpoch);
              }
            } catch (cause) {
              console.warn('The local mirror will catch up with the cloud delete on the next sync.', cause);
              current.reportError('The cloud delete succeeded, but local cleanup remains queued for retry.');
              return resultFor(mutation);
            }
            await current.acknowledgeDevicePending(queued);
            if (applyDeleteStats && source && latestRef.current.ownerId === ownerId) {
              const difficulty = source.difficulty && source.difficulty !== 'unrated' ? source.difficulty : 'unrated';
              current.updateCloudStats(stats => ({
                ...stats,
                total: Math.max(0, stats.total - 1),
                reviewed: (source.reviews ?? 0) > 0 ? Math.max(0, stats.reviewed - 1) : stats.reviewed,
                [difficulty]: Math.max(0, stats[difficulty] - 1),
                bookmarked: source.bookmarked ? Math.max(0, stats.bookmarked - 1) : stats.bookmarked,
                due: source.nextReviewDate && isCardDue(source) ? Math.max(0, stats.due - 1) : stats.due,
              }));
              void current.updateCategoryFacets(
                { [source.category || 'Other']: -1 },
                deriveLibraryFacetOperationId(pendingDelete.opId ?? mutation.operationId, 'delete'),
              );
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
    let clearResult:
      | { acquired: false }
      | { acquired: true; value: LearningStateMutationResult };
    try {
      clearResult = await withDevicePendingFlush(ownerId, false, async (
        lease: DevicePendingFlushLeaseContext = { assertActive: () => undefined },
      ) => {
        lease.assertActive();
        let cardDeletionCompleted = false;
        try {
          await runEpochProtectedLibraryClear({
            assertActive: lease.assertActive,
            incrementEpoch: () => incrementLibraryEpoch(database, ownerId),
            onEpochAdvanced: epoch => current.acceptVerifiedEpoch(ownerId, epoch),
            clearPending: () => clearDevicePending(ownerId),
            deleteCards: epoch => deleteAllCards(database, ownerId, lease.assertActive, epoch),
          });
          cardDeletionCompleted = true;
          lease.assertActive();
          await clearMirroredCards(ownerId).catch(cause => {
            console.warn('The local mirror will reset on the next sync.', cause);
          });
          lease.assertActive();
          await clearLibraryFacets(database, ownerId, mutation.operationId);
          lease.assertActive();
          if (latestRef.current.ownerId === ownerId) current.resetCloudState(true);
          lease.assertActive();
          await saveDeviceCards([], 0, [], 'replace', ownerId);
          lease.assertActive();
          if (latestRef.current.ownerId === ownerId) current.resetCloudPage();
          return resultFor(mutation);
        } catch (cause) {
          lease.assertActive();
          const recovery = planClearFailureRecovery(cardDeletionCompleted);
          clearCloudCaches(ownerId);
          lease.assertActive();
          if (latestRef.current.ownerId === ownerId) {
            current.resetCloudPage();
            current.refreshCloud();
            current.reportError(recovery.message);
          }
          if (!recovery.clearLocalView) throw new Error(recovery.message, { cause });
          lease.assertActive();
          if (latestRef.current.ownerId === ownerId) current.resetCloudState(false);
          await saveDeviceCards([], 0, [], 'replace', ownerId);
          lease.assertActive();
          return resultFor(mutation);
        } finally {
          current.setMutationPending(false);
        }
      });
    } catch (cause) {
      current.setMutationPending(false);
      throw cause;
    }
    if (!clearResult.acquired) {
      current.setMutationPending(false);
      throw new Error('Cloud sync is finishing another operation. Try clearing the library again in a moment.');
    }
    return clearResult.value;
      }

      return resultFor(mutation);
    },
  };

  return persistenceRef.current;
}
