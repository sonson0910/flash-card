import type { DeviceDeleteContext, DevicePendingOperation } from '../../lib/deviceSync';
import type { CardData } from '../../types/card';
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

export interface LearningPersistenceOptions {
  ownerId: string | null;
  verifiedEpoch: number | null;
  knownLibraryTotal: number;
  findCard(cardId: string): CardData | undefined;
  canPublishPatch(cardId: string): boolean;
  patchDeviceCards(
    changes: readonly { card: CardData; fields: Partial<CardData> }[],
    nextTotal?: number,
    operationId?: string,
  ): Promise<DevicePendingOperation[]>;
  removeDeviceCard(cardId: string, context?: DeviceDeleteContext): Promise<DevicePendingOperation[]>;
  acknowledgeDevicePending(operations: readonly DevicePendingOperation[]): Promise<void>;
  acceptVerifiedEpoch(ownerId: string, epoch: number): void;
  updateCloudStats(update: (current: LearningPersistenceStats) => LearningPersistenceStats): void;
  updateCategoryFacets(deltas: Record<string, number>): Promise<void>;
  resetCloudState(facetsComplete: boolean): void;
  resetCloudPage(): void;
  refreshCloud(): void;
  setCloudUnavailable(unavailable: boolean): void;
  setMutationPending(pending: boolean): void;
  reportError(message: string): void;
  addXp(amount: number): void;
}

export type LearningPersistenceHook = (
  options: LearningPersistenceOptions,
) => LearningStatePersistencePort;
