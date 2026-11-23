import { useRef } from 'react';
import { applyCardPatchWithConflictRecovery, deleteCardWithConflictRecovery } from '../../lib/cardConflictRecovery';
import {
  applyReviewViaCallable,
  applyReviewWithConflictRecovery,
  stableReviewCommand,
  type AuthoritativeGamification,
  type ReviewApplyResult,
  type ReviewCommand,
} from '../../lib/cardReviewRepository';
import { applySuccessfulPatchMetadata } from '../../lib/cardCreation';
import { selectMutableCardPatch } from '../../lib/cardMutationProtocol';
import { isCardDue } from '../../lib/srs';
import {
  applyCardPatchIfCurrent,
  bulkPatchCards,
  clearLibraryFacets,
  CardMutationPreconditionError,
  createCardIfAbsent,
  deriveLibraryFacetOperationId,
  deleteAllCards,
  deleteCardWithTombstone,
  findCardById,
  getLibraryEpoch,
  getLibraryState,
  incrementLibraryEpoch,
  settleLibraryClear,
} from '../../lib/cardRepository';
import { db, handleFirestoreError, isFirebaseConfigured, OperationType } from '../../lib/firebase';
import { ProtectedFunctionError } from '../../lib/protectedFunctionsCapability';
import {
  cloudBackoffCacheKey,
  cloudFacetsCacheKey,
  cloudPageCacheKey,
  removeCloudStatsCaches,
  isQuotaError,
  isRetryableSyncError,
  removeLocalValue,
  writeLocalValue,
} from '../library/libraryStorage';
import { planClearFailureRecovery, runEpochProtectedLibraryClear } from '../library/libraryMutationRecovery';
import { reviewConflictMessage } from './learningStateController';
import { trackCardPhotoSave, withoutTakenOffPhoto } from '../files/cardPhotoSaves';
import type {
  LearningRestoreConflictReason,
  LearningStateMutation,
  LearningStateMutationResult,
  LearningStatePublication,
} from './learningStateController';
import type {
  BulkCardFieldPatchOutcome,
  BulkCardFieldPatchRequest,
  LearningPersistenceOptions,
} from './learningPersistencePort';
import type { LearningStatePersistencePort } from './useLearningState';
import type { CardData } from '../../types/card';
import type { ReviewRating } from '../../lib/reviewScheduler';

const BULK_PATCHABLE_FIELDS = ['customDeck', 'bookmarked'] as const;

const resultFor = (
  mutation: LearningStateMutation,
  publication: LearningStatePublication = mutation.publication,
  reviewFinality?: LearningStateMutationResult['reviewFinality'],
  extras: Pick<LearningStateMutationResult, 'deleteReceipt' | 'restoreFinality' | 'restoreConflictReason' | 'reviewConflictTerminal' | 'reviewConflictReason' | 'xpAwarded' | 'studyTimeMs' | 'reviewRating' | 'reviewedAt'> = {},
): LearningStateMutationResult => ({
  ownerKey: mutation.ownerKey,
  operationId: mutation.operationId,
  publication,
  ...(reviewFinality ? { reviewFinality } : {}),
  ...extras,
});

const MAX_RETAINED_RESTORE_STATS_OPERATIONS = 500;
const UNFINISHED_CLEAR_DELETE_MESSAGE =
  'An earlier clear of your library has not finished, so this card is still stored. Reload the app to finish the clear, or clear the library again.';
const MAX_RETAINED_REVIEW_COMMANDS = 500;

function cacheCloudBackoff(ownerId: string): void {
  writeLocalValue(cloudBackoffCacheKey(ownerId), String(Date.now() + 5 * 60 * 1000));
}

function clearCloudCaches(ownerId: string): void {
  removeLocalValue(cloudPageCacheKey(ownerId));
  removeCloudStatsCaches(ownerId);
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

/**
 * How a saved patch moves the Starred count: +1 or -1 when it changes the
 * card's star, whichever control sent it (the star button or the editor).
 */
export const starredCountDelta = (
  source: Pick<CardData, 'bookmarked'> | undefined,
  fields: Partial<Pick<CardData, 'bookmarked'>>,
): number => {
  if (!Object.prototype.hasOwnProperty.call(fields, 'bookmarked') || typeof fields.bookmarked !== 'boolean') return 0;
  if (fields.bookmarked === Boolean(source?.bookmarked)) return 0;
  return fields.bookmarked ? 1 : -1;
};

const cardReviewCount = (card: CardData): number => Math.max(
  card.reviews ?? 0,
  card.reviewHistory?.length ?? 0,
);

const cardLastReviewAt = (card: CardData): string | undefined => {
  const historyReview = card.reviewHistory?.at(-1)?.reviewedAt;
  const fsrsReview = card.fsrs?.lastReview;
  if (!historyReview) return fsrsReview;
  if (!fsrsReview) return historyReview;
  return Date.parse(fsrsReview) > Date.parse(historyReview) ? fsrsReview : historyReview;
};

const duplicateReceiptIsOlderThanSource = (
  source: CardData | undefined,
  receiptCard: CardData,
): boolean => {
  if (!source) return false;
  if (source.libraryEpoch !== undefined && receiptCard.libraryEpoch !== undefined
    && source.libraryEpoch !== receiptCard.libraryEpoch) return source.libraryEpoch > receiptCard.libraryEpoch;
  if (source.revision !== undefined && receiptCard.revision !== undefined
    && source.libraryEpoch === receiptCard.libraryEpoch
    && source.revision > receiptCard.revision) return true;
  if (cardReviewCount(source) > cardReviewCount(receiptCard)) return true;
  const sourceReviewAt = cardLastReviewAt(source);
  const receiptReviewAt = cardLastReviewAt(receiptCard);
  if (!sourceReviewAt || !receiptReviewAt) return false;
  const sourceTime = Date.parse(sourceReviewAt);
  const receiptTime = Date.parse(receiptReviewAt);
  return Number.isFinite(sourceTime) && Number.isFinite(receiptTime) && sourceTime > receiptTime;
};

// A replayed receipt repeats an operation the server applied earlier. When this client already received that
// operation's outcome, only the authoritative totals are applied again: its credited study time, streak change
// and ceremonies were delivered the first time. When the first response never arrived, they are delivered now.
const withoutReplayedChanges = ({
  streakChange: _streakChange,
  studyTimeMs: _studyTimeMs,
  ...totals
}: AuthoritativeGamification): AuthoritativeGamification => totals;

const restoreConflictReasonFor = (reason: CardMutationPreconditionError['reason']): LearningRestoreConflictReason => {
  if (reason === 'deleted') return 'deleted-again';
  if (reason === 'identity-conflict') return 'unsafe-existing';
  return 'epoch-changed';
};

export function useLearningStatePersistence(options: LearningPersistenceOptions): LearningStatePersistencePort {
  const latestRef = useRef(options);
  latestRef.current = options;
  const restoreStatsOperationsRef = useRef(new Set<string>());
  const reviewCommandsRef = useRef(new Map<string, ReviewCommand>());
  const deliveredReviewOutcomesRef = useRef(new Set<string>());
  const unresolvedReviewCommandKeysRef = useRef(new Set<string>());
  const reviewCommandOwnerRef = useRef(options.ownerId);
  if (reviewCommandOwnerRef.current !== options.ownerId) {
    reviewCommandsRef.current.clear();
    deliveredReviewOutcomesRef.current.clear();
    unresolvedReviewCommandKeysRef.current.clear();
    reviewCommandOwnerRef.current = options.ownerId;
  }
  const persistenceRef = useRef<LearningStatePersistencePort | null>(null);

  const rememberReviewCommand = (key: string, command: ReviewCommand): ReviewCommand => {
    const stored = stableReviewCommand(command);
    if (!reviewCommandsRef.current.has(key) && reviewCommandsRef.current.size >= MAX_RETAINED_REVIEW_COMMANDS) {
      const evictableKey = [...reviewCommandsRef.current.keys()]
        .find(candidate => !unresolvedReviewCommandKeysRef.current.has(candidate));
      if (!evictableKey) {
        throw new Error('Review retry capacity is full. Try again after an existing review settles.');
      }
      reviewCommandsRef.current.delete(evictableKey);
    }
    reviewCommandsRef.current.set(key, stored);
    unresolvedReviewCommandKeysRef.current.add(key);
    return stored;
  };

  if (!persistenceRef.current) persistenceRef.current = {
    ownerId: () => latestRef.current.ownerId,
    findCard: cardId => latestRef.current.findCard(cardId),
    persist: async mutation => {
      const current = latestRef.current;
      const ownerId = current.ownerId;
      const source = 'cardId' in mutation ? current.findCard(mutation.cardId) : undefined;

      if (mutation.operation === 'patch' || mutation.operation === 'review') {
        if (mutation.operation === 'patch' && !source) {
          throw new Error('The card is no longer available for this update.');
        }
        if (!ownerId || current.verifiedEpoch === null || !db || !isFirebaseConfigured) {
          throw new Error('Cloud library storage is not ready yet. Try again in a moment.');
        }
        const database = db;
        let publication: LearningStatePublication = mutation.publication;
        let reviewFinality: LearningStateMutationResult['reviewFinality'];
        let xpAwarded: number | undefined;
        let studyTimeMs: number | undefined;
        let reviewRating: ReviewRating | undefined;
        let reviewedAt: string | undefined;
        let requestedReviewRating: ReviewRating | undefined;
        let reviewCommandKey: string | undefined;
        let reviewConflictTerminal = false;
        let reviewConflictReason: string | undefined;
        let staleDuplicatePublication = false;

        try {
          let result: ReviewApplyResult | Awaited<ReturnType<typeof applyCardPatchIfCurrent>>;
          if (mutation.operation === 'review') {
            const lastReviewCandidate = mutation.fields.reviewHistory?.at(-1);
            const lastReview = isValidReviewEntry(lastReviewCandidate) ? lastReviewCandidate : undefined;
            if (!lastReview) {
              current.reportError('The review could not be saved because its history entry was invalid.');
              return resultFor(mutation, { kind: 'patch', cardId: mutation.cardId, fields: {} }, 'conflict', {
                reviewConflictTerminal: true,
              });
            }
            const commandKey = `${ownerId}\u0000${mutation.operationId}`;
            reviewCommandKey = commandKey;
            const initialCommand: ReviewCommand = {
              cardId: mutation.cardId,
              opId: mutation.operationId,
              baseRevision: mutation.baseRevision,
              libraryEpoch: mutation.libraryEpoch,
              rating: lastReview.rating,
              reviewedAt: lastReview.reviewedAt,
              fields: mutation.fields,
              fieldMask: mutation.fieldMask,
            };
            const command = reviewCommandsRef.current.get(commandKey)
              ?? rememberReviewCommand(commandKey, initialCommand);
            requestedReviewRating = command.rating;
            reviewedAt = command.reviewedAt;
            unresolvedReviewCommandKeysRef.current.add(commandKey);
            result = await applyReviewWithConflictRecovery(command, nextCommand => applyReviewViaCallable(
              database,
              ownerId,
              rememberReviewCommand(commandKey, nextCommand),
            ));
          } else {
            result = await trackCardPhotoSave(mutation.fields.imageUrl, applyCardPatchWithConflictRecovery({
              cardId: mutation.cardId,
              fields: mutation.fields,
              fieldMask: mutation.fieldMask,
              baseRevision: mutation.baseRevision,
              libraryEpoch: mutation.libraryEpoch,
            }, command => applyCardPatchIfCurrent(database, ownerId, command)));
          }

          if (result.applied) {
            const reviewResult = 'card' in result ? result : null;
            const patchResult = 'revision' in result ? result : null;
            const publicationSource = latestRef.current.findCard(mutation.cardId) ?? source;
            const staleDuplicate = Boolean(
              reviewResult?.duplicate
              && duplicateReceiptIsOlderThanSource(publicationSource, reviewResult.card),
            );
            staleDuplicatePublication = staleDuplicate;
            const publicationCard = staleDuplicate ? publicationSource : reviewResult?.card;
            const authoritativeFields = reviewResult
              ? reviewFieldsFromCard(publicationCard ?? reviewResult.card)
              : selectMutableCardPatch(mutation.fields, mutation.fieldMask);
            const metadata = {
              revision: publicationCard?.revision ?? patchResult?.revision ?? 0,
              libraryEpoch: publicationCard?.libraryEpoch ?? mutation.libraryEpoch,
              updatedAt: publicationCard?.updatedAt ?? new Date().toISOString(),
            };
            const advanced = reviewResult
              ? {
                  ...(publicationSource ?? reviewResult.card),
                  ...authoritativeFields,
                  ...metadata,
                  schemaVersion: 2 as const,
                  id: mutation.cardId,
                }
              : applySuccessfulPatchMetadata(source!, mutation.fields, metadata, mutation.fieldMask);
            // A replay of an operation whose outcome this client already received must not add its study
            // time again or show its streak change and ceremonies a second time.
            const deliveredKey = `${ownerId}\u0000${mutation.operationId}`;
            const alreadyDelivered = reviewResult?.replayed === true
              && deliveredReviewOutcomesRef.current.has(deliveredKey);
            const outcomeGamification = reviewResult?.gamification && alreadyDelivered
              ? withoutReplayedChanges(reviewResult.gamification)
              : reviewResult?.gamification;
            const outcomeCeremonies = alreadyDelivered ? undefined : reviewResult?.ceremonyEvents;
            if (mutation.operation === 'review' && reviewResult && !alreadyDelivered) {
              const delivered = deliveredReviewOutcomesRef.current;
              if (delivered.size >= MAX_RETAINED_REVIEW_COMMANDS) delivered.delete(delivered.values().next().value as string);
              delivered.add(deliveredKey);
            }
            if (mutation.operation === 'review' && reviewResult
              && (outcomeGamification || outcomeCeremonies)
              && latestRef.current.ownerId === ownerId) {
              current.onReviewOutcome?.({
                ...(outcomeGamification ? { gamification: outcomeGamification } : {}),
                ...(outcomeCeremonies ? { ceremonyEvents: outcomeCeremonies } : {}),
              }, mutation.operationId, source ?? reviewResult.card);
            }
            publication = {
              kind: 'patch',
              cardId: mutation.cardId,
              fields: {
                ...authoritativeFields,
                ...(publicationCard?.appliedReviewOperationIds === undefined
                  ? {}
                  : { appliedReviewOperationIds: publicationCard.appliedReviewOperationIds }),
                schemaVersion: advanced.schemaVersion,
                revision: advanced.revision,
                libraryEpoch: advanced.libraryEpoch,
                updatedAt: advanced.updatedAt,
              },
            };
            if (mutation.operation === 'review') {
              // A duplicate is the same operation's committed server receipt.
              reviewFinality = 'committed';
              if (reviewResult) {
                xpAwarded = reviewResult.xpAwarded;
                studyTimeMs = outcomeGamification?.studyTimeMs;
                // A duplicate receipt may return the card after later reviews.
                // The command rating is the receipt's immutable operation intent.
                reviewRating = requestedReviewRating;
              }
            }
          } else if (result.reason === 'stale-library-epoch' || result.reason === 'missing') {
            publication = { kind: 'delete', cardId: mutation.cardId };
            if (mutation.operation === 'review') {
              reviewFinality = 'conflict';
              reviewConflictTerminal = true;
            }
            if (result.reason === 'stale-library-epoch') {
              const activeEpoch = await getLibraryEpoch(database, ownerId);
              current.acceptVerifiedEpoch(ownerId, activeEpoch);
            }
            current.reportError('This card is no longer available in your library.');
          } else {
            const message = reviewConflictMessage(result.reason) ?? (result.reason === 'future-library-epoch'
              ? 'Cloud library generation changed. Try again in a moment.'
              : 'The card changed again just now. Try again.');
            if (mutation.operation === 'review' && result.reason !== 'revision-conflict') {
              // The server gave a final answer about this review, so the cloud is healthy: say what happened
              // and let the retry be a new review instead of reporting an outage.
              reviewFinality = 'conflict';
              reviewConflictTerminal = true;
              reviewConflictReason = result.reason;
              // The server holds no receipt for a review it refused, so a retry of this question is a new review at the new time.
              if (reviewCommandKey) reviewCommandsRef.current.delete(reviewCommandKey);
              current.reportError(message);
            } else {
              current.reportError(message);
              throw new Error(`Card mutation rejected: ${result.reason}.`);
            }
          }
        } catch (cause) {
          if (mutation.operation === 'review' && reviewConflictTerminal) {
            if (reviewCommandKey) {
              unresolvedReviewCommandKeysRef.current.delete(reviewCommandKey);
              // The server holds no receipt for a review it refused, so a retry of this question is a new review at the new time.
              reviewCommandsRef.current.delete(reviewCommandKey);
            }
            if (cause && typeof cause === 'object') {
              (cause as Error & { reviewConflictTerminal?: boolean }).reviewConflictTerminal = true;
            }
          }
          if (mutation.operation === 'review' && cause instanceof ProtectedFunctionError && !cause.retryable) {
            if (reviewCommandKey) unresolvedReviewCommandKeysRef.current.delete(reviewCommandKey);
            (cause as ProtectedFunctionError & { reviewConflictTerminal?: boolean }).reviewConflictTerminal = true;
            current.reportError('This review could not be saved. Refreshing from the cloud.');
            current.refreshCloud();
            throw cause;
          }
          console.warn('Card update could not be saved.', cause);
          current.setCloudUnavailable(true);
          if (isRetryableSyncError(cause)) {
            if (isQuotaError(cause) && ownerId) cacheCloudBackoff(ownerId);
            current.reportError('Cloud is temporarily unavailable. Try again in a moment.');
          } else {
            current.reportError('The update could not be saved. Please try again.');
          }
          throw cause;
        }

        const starredDelta = starredCountDelta(source, mutation.fields);
        if (starredDelta !== 0) {
          current.updateCloudStats(stats => ({
            ...stats,
            bookmarked: Math.max(0, stats.bookmarked + starredDelta),
          }));
        }
        if (mutation.intent === 'review' && (reviewFinality === 'committed' || reviewConflictTerminal)) {
          if (reviewCommandKey) unresolvedReviewCommandKeysRef.current.delete(reviewCommandKey);
          if (reviewFinality === 'committed' && !staleDuplicatePublication && source) {
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
        }
        return resultFor(mutation, publication, reviewFinality, {
          ...(reviewConflictTerminal ? { reviewConflictTerminal: true } : {}),
          ...(reviewConflictReason ? { reviewConflictReason } : {}),
          ...(xpAwarded === undefined ? {} : { xpAwarded }),
          ...(studyTimeMs === undefined ? {} : { studyTimeMs }),
          ...(reviewRating === undefined ? {} : { reviewRating }),
          ...(reviewFinality === 'committed' && reviewedAt ? { reviewedAt } : {}),
        });
      }

      if (mutation.operation === 'delete') {
        if (!ownerId || current.verifiedEpoch === null || !db || !isFirebaseConfigured) {
          throw new Error('Cloud library storage is not ready yet. Try again in a moment.');
        }
        const database = db;
        let stableSource = source ?? mutation.card;
        let deleteReceipt: LearningStateMutationResult['deleteReceipt'];
        let clearUnfinished = false;
        try {
          const result = await deleteCardWithConflictRecovery({
            cardId: mutation.cardId,
            opId: mutation.operationId,
            libraryEpoch: mutation.libraryEpoch,
            baseRevision: mutation.baseRevision,
          }, command => deleteCardWithTombstone(database, ownerId, command));
          if (!result.deleted && result.reason !== 'stale-library-epoch') {
            current.reportError(result.reason === 'future-library-epoch'
              ? 'Cloud library generation changed. Try deleting again.'
              : 'The card changed again just now. Try deleting again.');
            throw new Error(`Delete rejected: ${result.reason}.`);
          }
          if (result.deleted) {
            deleteReceipt = {
              finality: 'committed',
              ownerId,
              operationId: result.tombstone.opId,
              libraryEpoch: result.tombstone.libraryEpoch,
              deletedAt: result.tombstone.deletedAt,
              ...(result.deletedCard ? { card: result.deletedCard } : {}),
            };
            if (result.deletedCard) stableSource = result.deletedCard;
          } else {
            const state = await getLibraryState(database, ownerId);
            current.acceptVerifiedEpoch(ownerId, state.libraryEpoch);
            // While a clear of the current generation is unfinished, an older card may still be stored.
            clearUnfinished = state.clearPendingEpoch === state.libraryEpoch;
          }
          if (result.deleted && stableSource && latestRef.current.ownerId === ownerId) {
            const difficulty = stableSource.difficulty && stableSource.difficulty !== 'unrated' ? stableSource.difficulty : 'unrated';
            current.updateCloudStats(stats => ({
              ...stats,
              total: Math.max(0, stats.total - 1),
              reviewed: (stableSource.reviews ?? 0) > 0 ? Math.max(0, stats.reviewed - 1) : stats.reviewed,
              [difficulty]: Math.max(0, stats[difficulty] - 1),
              bookmarked: stableSource.bookmarked ? Math.max(0, stats.bookmarked - 1) : stats.bookmarked,
              due: stableSource.nextReviewDate && isCardDue(stableSource) ? Math.max(0, stats.due - 1) : stats.due,
            }));
            // Keyed on the operation that deleted the card, so devices and retries that find it
            // already deleted share one facet receipt and the category counts it down once.
            void current.updateCategoryFacets(
              { [stableSource.category || 'Other']: -1 },
              deriveLibraryFacetOperationId(result.tombstone.opId, 'delete'),
            );
          }
        } catch (cause) {
          handleFirestoreError(cause, OperationType.DELETE, `users/${ownerId}/cards/${mutation.cardId}`);
          console.warn('The delete could not be saved.', cause);
          current.setCloudUnavailable(true);
          if (isRetryableSyncError(cause)) {
            if (isQuotaError(cause)) cacheCloudBackoff(ownerId);
            current.reportError('Cloud is temporarily unavailable. Try deleting again in a moment.');
          } else {
            current.reportError('Firebase rejected the delete. The card has been restored on screen.');
          }
          throw cause;
        }
        if (clearUnfinished) {
          current.reportError(UNFINISHED_CLEAR_DELETE_MESSAGE);
          throw new Error('Delete rejected: an earlier library clear has not finished.');
        }
        return resultFor(mutation, mutation.publication, undefined, { ...(deleteReceipt ? { deleteReceipt } : {}) });
      }

      if (mutation.operation === 'restore') {
        const conflict = current.validateRestore(mutation.undoToken);
        if (conflict) {
          return resultFor(mutation, mutation.publication, undefined, {
            restoreFinality: 'conflict',
            restoreConflictReason: conflict,
          });
        }
        if (current.ownerId !== mutation.undoToken.ownerId) {
          return resultFor(mutation, mutation.publication, undefined, {
            restoreFinality: 'conflict',
            restoreConflictReason: 'owner-changed',
          });
        }
        if (current.verifiedEpoch !== null && current.verifiedEpoch !== mutation.expectedLibraryEpoch) {
          return resultFor(mutation, mutation.publication, undefined, {
            restoreFinality: 'conflict',
            restoreConflictReason: 'epoch-changed',
          });
        }
        if (!ownerId || !db || !isFirebaseConfigured) {
          throw new Error('Cloud library storage is not ready yet. Try again in a moment.');
        }
        const database = db;
        let created;
        // The photo file can have been deleted since the card was; the card comes back without it then.
        const restoredCard = withoutTakenOffPhoto(mutation.card);
        try {
          created = await trackCardPhotoSave(restoredCard.imageUrl, createCardIfAbsent(database, ownerId, restoredCard, {
            libraryEpoch: mutation.expectedLibraryEpoch,
            baseRevision: mutation.card.revision ?? 0,
            opId: mutation.operationId,
            operationCreatedAt: mutation.operationCreatedAt,
            restore: true,
          }));
        } catch (cause) {
          if (cause instanceof CardMutationPreconditionError) {
            return resultFor(mutation, mutation.publication, undefined, {
              restoreFinality: 'conflict',
              restoreConflictReason: restoreConflictReasonFor(cause.reason),
            });
          }
          // The response may have been lost after the server committed the restore. Read the card once: if it
          // is back in this epoch past its deleted revision, the restore happened and is reported as such.
          const outcomeUnknown = isRetryableSyncError(cause) || (cause instanceof ProtectedFunctionError && cause.retryable);
          const restoredCard = outcomeUnknown
            ? await findCardById(database, ownerId, mutation.card.id).catch(() => null)
            : null;
          if (!restoredCard || restoredCard.libraryEpoch !== mutation.expectedLibraryEpoch
            || (restoredCard.revision ?? 0) <= (mutation.card.revision ?? 0)) throw cause;
          created = { card: restoredCard, created: true };
        }
        const latest = latestRef.current;
        if (latest.ownerId !== ownerId) {
          return resultFor(mutation, mutation.publication, undefined, {
            restoreFinality: 'conflict',
            restoreConflictReason: 'owner-changed',
          });
        }
        if (latest.verifiedEpoch !== null && latest.verifiedEpoch !== mutation.expectedLibraryEpoch) {
          return resultFor(mutation, mutation.publication, undefined, {
            restoreFinality: 'conflict',
            restoreConflictReason: 'epoch-changed',
          });
        }
        if (!created.created || created.card.id !== mutation.card.id) {
          return resultFor(mutation, mutation.publication, undefined, {
            restoreFinality: 'conflict',
            restoreConflictReason: 'unsafe-existing',
          });
        }
        const publication: LearningStatePublication = { kind: 'restore', card: created.card };
        const statsOperationKey = `${ownerId}:${mutation.operationId}`;
        if (!restoreStatsOperationsRef.current.has(statsOperationKey)) {
          const stableCard = created.card;
          const difficulty = stableCard.difficulty && stableCard.difficulty !== 'unrated'
            ? stableCard.difficulty
            : 'unrated';
          current.updateCloudStats(stats => ({
            ...stats,
            total: stats.total + 1,
            reviewed: (stableCard.reviews ?? 0) > 0 ? stats.reviewed + 1 : stats.reviewed,
            [difficulty]: stats[difficulty] + 1,
            bookmarked: stableCard.bookmarked ? stats.bookmarked + 1 : stats.bookmarked,
            due: stableCard.nextReviewDate && isCardDue(stableCard) ? stats.due + 1 : stats.due,
          }));
          restoreStatsOperationsRef.current.add(statsOperationKey);
          while (restoreStatsOperationsRef.current.size > MAX_RETAINED_RESTORE_STATS_OPERATIONS) {
            const oldestOperationKey = restoreStatsOperationsRef.current.values().next().value as string | undefined;
            if (!oldestOperationKey) break;
            restoreStatsOperationsRef.current.delete(oldestOperationKey);
          }
        }
        return resultFor(mutation, publication, undefined, { restoreFinality: 'restored' });
      }

      if (mutation.operation === 'clear') {
        if (!ownerId || !db || !isFirebaseConfigured) return resultFor(mutation);
        current.setMutationPending(true);
        const database = db;
        let cardDeletionCompleted = false;
        let epochAdvanced = false;
        try {
          const clearedEpoch = await runEpochProtectedLibraryClear({
            incrementEpoch: () => incrementLibraryEpoch(database, ownerId),
            onEpochAdvanced: epoch => {
              epochAdvanced = true;
              current.acceptVerifiedEpoch(ownerId, epoch);
            },
            deleteCards: async epoch => { await deleteAllCards(database, ownerId, epoch); },
          });
          cardDeletionCompleted = true;
          await clearLibraryFacets(database, ownerId, mutation.operationId);
          // A marker left behind only makes the next load run one more empty clear pass.
          await settleLibraryClear(database, ownerId, clearedEpoch)
            .catch(error => console.warn('The finished library clear could not be recorded.', error));
          if (latestRef.current.ownerId === ownerId) current.resetCloudState(true);
          if (latestRef.current.ownerId === ownerId) current.resetCloudPage();
          return resultFor(mutation);
        } catch (cause) {
          const recovery = planClearFailureRecovery(cardDeletionCompleted, epochAdvanced);
          clearCloudCaches(ownerId);
          if (latestRef.current.ownerId === ownerId) {
            current.resetCloudPage();
            current.refreshCloud();
          }
          if (recovery.clearLocalView && latestRef.current.ownerId === ownerId) current.resetCloudState(false);
          throw new Error(recovery.message, { cause });
        } finally {
          current.setMutationPending(false);
        }
      }

      return resultFor(mutation);
    },
    persistBulkPatch: async patches => {
      const current = latestRef.current;
      const ownerId = current.ownerId;
      if (!ownerId || current.verifiedEpoch === null || !db || !isFirebaseConfigured) {
        throw new Error('Cloud library storage is not ready yet. Try again in a moment.');
      }
      const database = db;

      const sources = new Map<string, CardData>();
      const commands: Array<{
        cardId: string;
        baseRevision: number;
        fields: BulkCardFieldPatchRequest['fields'];
        fieldMask: readonly (typeof BULK_PATCHABLE_FIELDS)[number][];
      }> = [];
      for (const patch of patches) {
        const source = current.findCard(patch.cardId);
        if (!source) continue;
        const fieldMask = BULK_PATCHABLE_FIELDS.filter(
          field => Object.prototype.hasOwnProperty.call(patch.fields, field),
        );
        if (fieldMask.length === 0) continue;
        sources.set(patch.cardId, source);
        commands.push({ cardId: patch.cardId, baseRevision: source.revision ?? 0, fields: patch.fields, fieldMask });
      }
      if (commands.length === 0) {
        return patches.map(patch => ({ cardId: patch.cardId, applied: false }));
      }

      let batch: Awaited<ReturnType<typeof bulkPatchCards>>;
      try {
        batch = await bulkPatchCards(database, ownerId, commands, current.verifiedEpoch);
      } catch (cause) {
        console.warn('Bulk card update could not be saved.', cause);
        current.setCloudUnavailable(true);
        if (isRetryableSyncError(cause)) {
          if (isQuotaError(cause)) cacheCloudBackoff(ownerId);
          current.reportError('Cloud is temporarily unavailable. Try again in a moment.');
        } else if (cause instanceof CardMutationPreconditionError && cause.reason === 'future-library-epoch') {
          current.reportError('Cloud library generation changed. Try again in a moment.');
        } else if (cause instanceof CardMutationPreconditionError && cause.reason === 'stale-library-epoch') {
          current.acceptVerifiedEpoch(ownerId, await getLibraryEpoch(database, ownerId));
          // The cards held in this view predate the new generation; reload them so a retry does not
          // reuse their old revisions against cards recreated under the same ids.
          if (latestRef.current.ownerId === ownerId) {
            current.resetCloudPage();
            current.refreshCloud();
          }
          current.reportError('Cloud library generation changed. Try again in a moment.');
        } else {
          current.reportError('The update could not be saved. Please try again.');
        }
        throw cause;
      }

      if (batch.libraryEpoch !== current.verifiedEpoch) {
        current.acceptVerifiedEpoch(ownerId, batch.libraryEpoch);
      }

      const commandsById = new Map(commands.map(command => [command.cardId, command]));
      const resultsById = new Map(batch.outcomes.map(outcome => [outcome.cardId, outcome]));
      let bookmarkDelta = 0;
      const outcomes: BulkCardFieldPatchOutcome[] = patches.map(patch => {
        const command = commandsById.get(patch.cardId);
        const source = sources.get(patch.cardId);
        const result = resultsById.get(patch.cardId);
        if (!command || !source || !result || !result.applied) return { cardId: patch.cardId, applied: false };
        const metadata = {
          revision: result.revision,
          libraryEpoch: batch.libraryEpoch,
          updatedAt: new Date().toISOString(),
        };
        const advanced = applySuccessfulPatchMetadata(source, command.fields, metadata, command.fieldMask);
        if (Object.prototype.hasOwnProperty.call(command.fields, 'bookmarked')) {
          bookmarkDelta += command.fields.bookmarked ? 1 : -1;
        }
        return {
          cardId: patch.cardId,
          applied: true,
          publication: {
            kind: 'patch',
            cardId: patch.cardId,
            fields: {
              ...selectMutableCardPatch(command.fields, command.fieldMask),
              schemaVersion: advanced.schemaVersion,
              revision: advanced.revision,
              libraryEpoch: advanced.libraryEpoch,
              updatedAt: advanced.updatedAt,
            },
          },
        };
      });

      if (bookmarkDelta !== 0) {
        current.updateCloudStats(stats => ({
          ...stats,
          bookmarked: Math.max(0, stats.bookmarked + bookmarkDelta),
        }));
      }
      if (outcomes.some(outcome => !outcome.applied)) {
        current.reportError('Some cards could not be updated. Try again.');
      }
      return outcomes;
    },
  };

  return persistenceRef.current;
}
