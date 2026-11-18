import type { CardData } from '../../types/card';
import type {
  LearningDeleteUndoToken,
  LearningRestoreConflictReason,
} from './learningStateController';
import type { LearningStatePersistencePort } from './useLearningState';
import type { ReviewOutcome } from '../../lib/cardReviewRepository';

export type { BulkCardFieldPatchOutcome, BulkCardFieldPatchRequest } from './learningStateController';
export type { ReviewOutcome } from '../../lib/cardReviewRepository';

export interface LearningPersistenceStats {
  total: number;
  reviewed: number;
  easy: number;
  good: number;
  hard: number;
  unrated: number;
  bookmarked: number;
  due: number;
  legacyUnindexed: number;
}

export interface LearningPersistenceOptions {
  ownerId: string | null;
  verifiedEpoch: number | null;
  knownLibraryTotal: number;
  validateRestore(token: LearningDeleteUndoToken): LearningRestoreConflictReason | null;
  findCard(cardId: string): CardData | undefined;
  canPublishPatch(cardId: string): boolean;
  acceptVerifiedEpoch(ownerId: string, epoch: number): void;
  updateCloudStats(update: (current: LearningPersistenceStats) => LearningPersistenceStats): void;
  updateCategoryFacets(deltas: Record<string, number>, operationId?: string): Promise<void>;
  resetCloudState(facetsComplete: boolean): void;
  resetCloudPage(): void;
  refreshCloud(): void;
  setCloudUnavailable(unavailable: boolean): void;
  setMutationPending(pending: boolean): void;
  reportError(message: string): void;
  onReviewOutcome?(outcome: ReviewOutcome, operationId: string, card: CardData): void;
}

export type LearningPersistenceHook = (
  options: LearningPersistenceOptions,
) => LearningStatePersistencePort;
