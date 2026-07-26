import type { CardData } from '../types/card';
import { mapWithConcurrency } from './asyncPool';
import { CardUniquenessCheckError } from './cardUniqueness';
import type { DevicePendingOperation } from './deviceSync';

interface MirrorCompletionState {
  complete: boolean;
}

interface CloudCreationResult {
  card: CardData;
  created: boolean;
}

interface PersistCardOptions {
  card: CardData;
  uniquenessVerified: boolean;
  createInCloud: () => Promise<CloudCreationResult>;
}

export interface CardPersistenceResult extends CloudCreationResult {
  queued: boolean;
}

export interface VerifiedPendingCardOperations {
  operationsToWrite: DevicePendingOperation[];
  operationsAlreadyExisting: DevicePendingOperation[];
  existingCards: CardData[];
}

export function partitionPendingOperationsForFlush(
  operations: readonly DevicePendingOperation[],
): {
  batchOperations: Exclude<DevicePendingOperation, { type: 'patch' }>[];
  patches: Extract<DevicePendingOperation, { type: 'patch' }>[];
} {
  return operations.reduce<{
    batchOperations: Exclude<DevicePendingOperation, { type: 'patch' }>[];
    patches: Extract<DevicePendingOperation, { type: 'patch' }>[];
  }>((partitioned, operation) => {
    if (operation.type === 'patch') partitioned.patches.push(operation);
    else partitioned.batchOperations.push(operation);
    return partitioned;
  }, { batchOperations: [], patches: [] });
}

export function shouldRequireRemoteUniquenessCheck(
  mirrorStatus: MirrorCompletionState | null,
): boolean {
  return mirrorStatus?.complete !== true;
}

export function shouldAttemptRemoteUniquenessCheck({
  mirrorStatus,
  cloudAvailable,
  verifierAvailable,
}: {
  mirrorStatus: MirrorCompletionState | null;
  cloudAvailable: boolean;
  verifierAvailable: boolean;
}): boolean {
  return shouldRequireRemoteUniquenessCheck(mirrorStatus)
    && cloudAvailable
    && verifierAvailable;
}

export function canDeferRemoteUniquenessFailure(
  error: unknown,
): boolean {
  return error instanceof CardUniquenessCheckError;
}

export async function persistCardWithMirrorFallback({
  card,
  uniquenessVerified,
  createInCloud,
}: PersistCardOptions): Promise<CardPersistenceResult> {
  if (!uniquenessVerified) return { card, created: true, queued: true };
  try {
    return { ...await createInCloud(), queued: false };
  } catch {
    return { card, created: true, queued: true };
  }
}

export async function verifyPendingCardOperations(
  operations: readonly DevicePendingOperation[],
  findExisting: (card: CardData) => Promise<CardData | null>,
  concurrency = 6,
): Promise<VerifiedPendingCardOperations> {
  const checked = await mapWithConcurrency(operations, concurrency, async operation => {
    if (operation.type !== 'upsert') return { operation, existingCard: null };
    return { operation, existingCard: await findExisting(operation.card) };
  });

  return checked.reduce<VerifiedPendingCardOperations>((plan, result) => {
    if (
      result.existingCard
      && result.operation.type === 'upsert'
      && result.existingCard.id !== result.operation.card.id
    ) {
      plan.operationsAlreadyExisting.push(result.operation);
      plan.existingCards.push(result.existingCard);
    } else {
      plan.operationsToWrite.push(result.operation);
    }
    return plan;
  }, {
    operationsToWrite: [],
    operationsAlreadyExisting: [],
    existingCards: [],
  });
}
