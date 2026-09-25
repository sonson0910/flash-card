import type { DeviceDeleteContext, DevicePendingFlushLease, DevicePendingOperation } from '../../lib/deviceSync';
import type { CardData } from '../../types/card';
import type {
  LearningDeleteUndoToken,
  LearningRestoreConflictReason,
} from './learningStateController';
import type { LearningStatePersistencePort } from './useLearningState';

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

export interface RestoreDeviceCardOptions {
  ownerId: string | null;
  expectedLibraryEpoch: number;
  operationId: string;
  operationCreatedAt: string;
}

export type RestoreDeviceCardResult =
  | { status: 'restored' | 'queued' | 'existing'; card: CardData }
  | { status: 'conflict'; reason: LearningRestoreConflictReason; card?: CardData };

export interface LearningPersistenceOptions {
  ownerId: string | null;
  verifiedEpoch: number | null;
  knownLibraryTotal: number;
  validateRestore(token: LearningDeleteUndoToken): LearningRestoreConflictReason | null;
  restoreDeviceCard(card: CardData, options: RestoreDeviceCardOptions): Promise<RestoreDeviceCardResult>;
  findCard(cardId: string): CardData | undefined;
  canPublishPatch(cardId: string): boolean;
  patchDeviceCards(
    changes: readonly { card: CardData; fields: Partial<CardData> }[],
    nextTotal?: number,
    operationId?: string,
    operation?: 'patch' | 'review',
  ): Promise<DevicePendingOperation[]>;
  removeDeviceCard(cardId: string, context?: DeviceDeleteContext): Promise<DevicePendingOperation[]>;
  acknowledgeDevicePending(operations: readonly DevicePendingOperation[], lease?: DevicePendingFlushLease): Promise<void>;
  acceptVerifiedEpoch(ownerId: string, epoch: number): void;
  updateCloudStats(update: (current: LearningPersistenceStats) => LearningPersistenceStats): void;
  updateCategoryFacets(deltas: Record<string, number>, operationId?: string): Promise<void>;
  resetCloudState(facetsComplete: boolean): void;
  resetCloudPage(): void;
  refreshCloud(): void;
  setCloudUnavailable(unavailable: boolean): void;
  setMutationPending(pending: boolean): void;
  reportError(message: string): void;
  addXp(amount: number, operationId?: string): void;
}

export type LearningPersistenceHook = (
  options: LearningPersistenceOptions,
) => LearningStatePersistencePort;
