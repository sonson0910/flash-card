import type { CardData } from '../types/card';
import { mapWithConcurrency } from './asyncPool';
import { CardUniquenessCheckError } from './cardUniqueness';
import {
  mergePendingOperations,
  type DevicePendingOperation,
} from './deviceSync';
import { selectMutableCardPatch } from './cardMutationProtocol';

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

export function applySuccessfulPatchMetadata(
  card: CardData,
  fields: Partial<CardData>,
  metadata: {
    revision: number;
    libraryEpoch: number;
    updatedAt: string;
  },
  fieldMask: readonly (keyof CardData)[] = Object.keys(fields) as Array<keyof CardData>,
): CardData {
  const patch = selectMutableCardPatch(fields, fieldMask);
  return {
    ...card,
    ...patch,
    schemaVersion: 2,
    revision: metadata.revision,
    libraryEpoch: metadata.libraryEpoch,
    updatedAt: metadata.updatedAt,
    id: card.id,
  };
}

export function partitionPendingOperationsForFlush(
  operations: readonly DevicePendingOperation[],
): {
  creates: Extract<DevicePendingOperation, { type: 'upsert' }>[];
  deletes: Extract<DevicePendingOperation, { type: 'delete' }>[];
  patches: Extract<DevicePendingOperation, { type: 'patch' }>[];
} {
  return operations.reduce<{
    creates: Extract<DevicePendingOperation, { type: 'upsert' }>[];
    deletes: Extract<DevicePendingOperation, { type: 'delete' }>[];
    patches: Extract<DevicePendingOperation, { type: 'patch' }>[];
  }>((partitioned, operation) => {
    if (operation.type === 'patch') partitioned.patches.push(operation);
    else if (operation.type === 'delete') partitioned.deletes.push(operation);
    else partitioned.creates.push(operation);
    return partitioned;
  }, { creates: [], deletes: [], patches: [] });
}

export function partitionPendingOperationsByLibraryEpoch(
  operations: readonly DevicePendingOperation[],
  currentLibraryEpoch: number,
): {
  stale: DevicePendingOperation[];
  current: DevicePendingOperation[];
  future: DevicePendingOperation[];
} {
  const safeCurrentEpoch = Number.isSafeInteger(currentLibraryEpoch) && currentLibraryEpoch >= 0
    ? currentLibraryEpoch
    : 0;
  const partitioned = operations.reduce<{
    stale: DevicePendingOperation[];
    current: DevicePendingOperation[];
    future: DevicePendingOperation[];
  }>((result, queuedOperation) => {
    const operation = queuedOperation.libraryEpoch === -1
      ? queuedOperation.type === 'upsert'
        ? { ...queuedOperation, libraryEpoch: safeCurrentEpoch, card: { ...queuedOperation.card, libraryEpoch: safeCurrentEpoch } }
        : { ...queuedOperation, libraryEpoch: safeCurrentEpoch }
      : queuedOperation;
    const operationEpoch = Number.isSafeInteger(operation.libraryEpoch) && Number(operation.libraryEpoch) >= 0
      ? Number(operation.libraryEpoch)
      : 0;
    if (operationEpoch < safeCurrentEpoch) result.stale.push(operation);
    else if (operationEpoch > safeCurrentEpoch) result.future.push(operation);
    else result.current.push(operation);
    return result;
  }, { stale: [], current: [], future: [] });
  return {
    stale: mergePendingOperations(partitioned.stale),
    current: mergePendingOperations(partitioned.current),
    future: mergePendingOperations(partitioned.future),
  };
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

export function beginOptimisticCardPersistence(options: PersistCardOptions): {
  immediate: CardPersistenceResult;
  settled: Promise<CardPersistenceResult>;
} {
  return {
    immediate: { card: options.card, created: true, queued: true },
    settled: persistCardWithMirrorFallback(options),
  };
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
