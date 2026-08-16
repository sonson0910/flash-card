import type {
  DeviceDeleteContext,
  DeviceMutationAccounting,
  DevicePendingOperation,
  PendingMutationDisposition,
} from '../../lib/deviceSync';
import type { AddXpOptions } from '../gamification/useGamification';
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
    accounting?: DeviceMutationAccounting,
  ): Promise<DevicePendingOperation[]>;
  removeDeviceCard(cardId: string, context?: DeviceDeleteContext): Promise<DevicePendingOperation[]>;
  flushDeviceCards(logicalOperationId: string): Promise<PendingMutationDisposition>;
  acknowledgeDevicePending(operations: readonly DevicePendingOperation[]): Promise<void>;
  acceptVerifiedEpoch(ownerId: string, epoch: number): void;
  updateCloudStats(update: (current: LearningPersistenceStats) => LearningPersistenceStats): void;
  resetCloudState(facetsComplete: boolean): void;
  resetCloudPage(): void;
  refreshCloud(): void;
  setCloudUnavailable(unavailable: boolean): void;
  setMutationPending(pending: boolean): void;
  reportError(message: string): void;
  addXp(amount: number, options?: AddXpOptions): boolean;
}

export type LearningPersistenceHook = (
  options: LearningPersistenceOptions,
) => LearningStatePersistencePort;
