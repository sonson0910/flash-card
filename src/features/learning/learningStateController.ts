import {
  cardAlreadyHasPatch,
  normalizeCardOperationId,
  selectMutableCardPatch,
  type CardMutableField,
  type CardMutationKind,
} from '../../lib/cardMutationProtocol';
import type { ReviewRating } from '../../lib/reviewScheduler';
import type { CardData } from '../../types/card';

export type LearningStateIntent = 'bookmark' | 'deck' | 'review' | 'patch' | 'delete' | 'restore' | 'clear';

export interface LearningDeleteUndoToken {
  ownerKey: string;
  ownerId: string | null;
  card: CardData;
  expectedLibraryEpoch: number;
  deleteOperationId: string;
  deletedAt: string;
  lifecycleId: string;
  clearGeneration: number;
}

export interface LearningRestoreRequest {
  operationId: string;
  operationCreatedAt: string;
}

export type LearningRestoreConflictReason =
  | 'owner-changed'
  | 'epoch-changed'
  | 'deleted-again'
  | 'unsafe-existing';

export type LearningStatePublication =
  | { kind: 'patch'; cardId: string; fields: Partial<CardData> }
  | { kind: 'delete'; cardId: string }
  | { kind: 'restore'; card: CardData }
  | { kind: 'clear' };

interface LearningStateMutationBase {
  ownerKey: string;
  operationId: string;
  intent: LearningStateIntent;
  publication: LearningStatePublication;
}

export type LearningStateMutation =
  | LearningStateMutationBase & {
      operation: Extract<CardMutationKind, 'patch' | 'review'>;
      cardId: string;
      fields: Partial<Pick<CardData, CardMutableField>>;
      fieldMask: readonly CardMutableField[];
      baseRevision: number;
      libraryEpoch: number;
    }
  | LearningStateMutationBase & {
      operation: Extract<CardMutationKind, 'delete'>;
      cardId: string;
      card: CardData;
      baseRevision: number;
      libraryEpoch: number;
    }
  | LearningStateMutationBase & {
      operation: 'restore';
      undoToken: LearningDeleteUndoToken;
      card: CardData;
      expectedLibraryEpoch: number;
      operationCreatedAt: string;
    }
  | LearningStateMutationBase & {
      operation: 'clear';
    };

export interface LearningStateMutationResult {
  ownerKey: string;
  operationId: string;
  publication: LearningStatePublication;
  /** A queued review is visible locally but is not a final learning result. */
  reviewFinality?: 'committed' | 'durably-queued' | 'conflict';
  deleteReceipt?: {
    finality: 'committed' | 'durably-queued';
    ownerId: string | null;
    operationId: string;
    libraryEpoch: number;
    deletedAt: string;
  };
  undoToken?: LearningDeleteUndoToken;
  restoreFinality?: 'restored' | 'durably-queued' | 'conflict';
  restoreConflictReason?: LearningRestoreConflictReason;
}

export interface LearningStatePort {
  activeOwner(): string | null;
  activeOwnerId?(): string | null;
  findCard(cardId: string): CardData | undefined;
  /** Persist first and return the authoritative publication for the same owner and operation. */
  persist(mutation: LearningStateMutation): Promise<LearningStateMutationResult>;
}

export interface LearningSnapshotPublicationPort {
  /** Apply is synchronous and idempotent; patch publications replace fields rather than append them. */
  apply(publication: LearningStatePublication): void;
}

export interface LearningStateSnapshotsPort {
  library: LearningSnapshotPublicationPort;
  practice: LearningSnapshotPublicationPort;
}

export type LearningStateOutcome =
  | { status: 'published'; result: LearningStateMutationResult }
  | { status: 'durably-queued'; result: LearningStateMutationResult }
  | { status: 'review-conflict'; result: LearningStateMutationResult }
  | { status: 'undo-conflict'; result: LearningStateMutationResult }
  | { status: 'noop' }
  | { status: 'missing-card' }
  | { status: 'no-active-owner' }
  | { status: 'stale-owner' };

type TerminalOutcome = Exclude<LearningStateOutcome, { status: 'published' }>;
type MutationPlan = LearningStateMutation | TerminalOutcome;

interface LearningStateControllerOptions {
  port: LearningStatePort;
  snapshots: LearningStateSnapshotsPort;
  now?: () => Date;
  completedOperationLimit?: number;
}

export interface LearningStateController {
  toggleBookmark(cardId: string, operationId: string): Promise<LearningStateOutcome>;
  assignDeck(cardId: string, deckName: string | null, operationId: string): Promise<LearningStateOutcome>;
  review(cardId: string, rating: ReviewRating, operationId: string): Promise<LearningStateOutcome>;
  patch(
    cardId: string,
    fields: Partial<CardData>,
    fieldMask: readonly (keyof CardData)[],
    operationId: string,
  ): Promise<LearningStateOutcome>;
  delete(cardId: string, operationId: string): Promise<LearningStateOutcome>;
  restore(token: LearningDeleteUndoToken, request: LearningRestoreRequest): Promise<LearningStateOutcome>;
  clear(operationId: string): Promise<LearningStateOutcome>;
  invalidateUndoTokens(): void;
}

export function createLearningStateController({
  port,
  snapshots,
  now = () => new Date(),
  completedOperationLimit = 500,
}: LearningStateControllerOptions): LearningStateController {
  const inFlight = new Map<string, Promise<LearningStateOutcome>>();
  const completed = new Map<string, LearningStateOutcome>();
  const latestDeleteLifecycle = new Map<string, string>();
  let clearGeneration = 0;
  let lifecycleSequence = 0;

  const lifecycleKey = (ownerKey: string, cardId: string) => `${ownerKey}\u0000${cardId}`;

  const rememberDeleteLifecycle = (ownerKey: string, cardId: string, lifecycleId: string) => {
    latestDeleteLifecycle.delete(lifecycleKey(ownerKey, cardId));
    latestDeleteLifecycle.set(lifecycleKey(ownerKey, cardId), lifecycleId);
    while (latestDeleteLifecycle.size > 500) {
      const oldestKey = latestDeleteLifecycle.keys().next().value as string | undefined;
      if (!oldestKey) break;
      latestDeleteLifecycle.delete(oldestKey);
    }
  };

  const restoreConflictReason = (
    ownerKey: string,
    token: LearningDeleteUndoToken,
    checkExisting = true,
  ): LearningRestoreConflictReason | null => {
    if (token.ownerId !== (port.activeOwnerId?.() ?? null)) return 'owner-changed';
    if (token.clearGeneration !== clearGeneration) return 'deleted-again';
    if (latestDeleteLifecycle.get(lifecycleKey(ownerKey, token.card.id)) !== token.lifecycleId) return 'deleted-again';
    if (checkExisting && port.findCard(token.card.id)) return 'unsafe-existing';
    return null;
  };

  const remember = (key: string, outcome: LearningStateOutcome) => {
    completed.set(key, outcome);
    while (completed.size > Math.max(1, completedOperationLimit)) {
      const oldestKey = completed.keys().next().value as string | undefined;
      if (!oldestKey) break;
      completed.delete(oldestKey);
    }
  };

  const execute = (
    operationId: string,
    build: (
      ownerKey: string,
      normalizedOperationId: string,
    ) => MutationPlan | Promise<MutationPlan>,
  ): Promise<LearningStateOutcome> => {
    const ownerKey = port.activeOwner();
    if (!ownerKey) return Promise.resolve({ status: 'no-active-owner' });

    const normalizedOperationId = normalizeCardOperationId(operationId);
    const operationKey = `${ownerKey}:${normalizedOperationId}`;
    const prior = completed.get(operationKey);
    if (prior) return Promise.resolve(prior);
    const pending = inFlight.get(operationKey);
    if (pending) return pending;

    const run = async (): Promise<LearningStateOutcome> => {
      const built = build(ownerKey, normalizedOperationId);
      const plan = built instanceof Promise ? await built : built;
      if (!('operation' in plan)) return plan;
      if (port.activeOwner() !== ownerKey) return { status: 'stale-owner' };

      if (plan.operation === 'restore') {
        const token = plan.undoToken;
        const conflictReason = restoreConflictReason(ownerKey, token);
        if (token.ownerKey !== ownerKey || conflictReason) {
          const result: LearningStateMutationResult = {
            ownerKey,
            operationId: normalizedOperationId,
            publication: plan.publication,
            restoreFinality: 'conflict',
            restoreConflictReason: conflictReason ?? 'owner-changed',
          };
          return { status: 'undo-conflict', result };
        }
        const operationTime = Date.parse(plan.operationCreatedAt);
        const deleteTime = Date.parse(token.deletedAt);
        if (!Number.isFinite(operationTime) || !Number.isFinite(deleteTime) || operationTime <= deleteTime) {
          throw new Error('The restore operation time must be later than its delete receipt.');
        }
      }

      let result = await port.persist(plan);
      if (result.ownerKey !== ownerKey || result.operationId !== normalizedOperationId) {
        throw new Error('Learning state persistence returned a result for a different owner or operation.');
      }
      if (port.activeOwner() !== ownerKey) return { status: 'stale-owner' };
      if (
        plan.operation === 'delete'
        && result.deleteReceipt
        && port.activeOwnerId
        && port.activeOwnerId() !== result.deleteReceipt.ownerId
      ) return { status: 'stale-owner' };
      if (
        plan.operation === 'restore'
        && port.activeOwnerId
        && port.activeOwnerId() !== plan.undoToken.ownerId
      ) return { status: 'stale-owner' };

      if (plan.operation === 'delete' && result.deleteReceipt) {
        if (result.deleteReceipt.libraryEpoch === plan.libraryEpoch && Number.isFinite(Date.parse(result.deleteReceipt.deletedAt))) {
          lifecycleSequence += 1;
          const lifecycleId = `${ownerKey}:${plan.card.id}:${normalizedOperationId}:${lifecycleSequence}`;
          const undoToken: LearningDeleteUndoToken = {
            ownerKey,
            ownerId: result.deleteReceipt.ownerId,
            card: { ...plan.card },
            expectedLibraryEpoch: plan.libraryEpoch,
            deleteOperationId: result.deleteReceipt.operationId,
            deletedAt: result.deleteReceipt.deletedAt,
            lifecycleId,
            clearGeneration,
          };
          rememberDeleteLifecycle(ownerKey, plan.card.id, lifecycleId);
          result = { ...result, undoToken };
        }
      }

      if (plan.operation === 'clear') {
        clearGeneration += 1;
        latestDeleteLifecycle.clear();
      }

      if (result.reviewFinality === 'conflict') return { status: 'review-conflict', result };
      if (result.restoreFinality === 'conflict') {
        if (plan.operation === 'restore') {
          latestDeleteLifecycle.delete(lifecycleKey(ownerKey, plan.undoToken.card.id));
        }
        return { status: 'undo-conflict', result };
      }

      if (plan.operation === 'restore') {
        const token = plan.undoToken;
        const conflictReason = restoreConflictReason(ownerKey, token, false);
        if (conflictReason) {
          return {
            status: 'undo-conflict',
            result: {
              ...result,
              restoreFinality: 'conflict',
              restoreConflictReason: conflictReason,
            },
          };
        }
        if (result.restoreFinality !== 'restored' && result.restoreFinality !== 'durably-queued') {
          throw new Error('Restore persistence did not return a durable restore outcome.');
        }
        latestDeleteLifecycle.delete(lifecycleKey(ownerKey, token.card.id));
      }

      snapshots.library.apply(result.publication);
      snapshots.practice.apply(result.publication);
      if (
        result.reviewFinality === 'durably-queued'
        || result.restoreFinality === 'durably-queued'
        || result.deleteReceipt?.finality === 'durably-queued'
      ) {
        return { status: 'durably-queued', result };
      }
      return { status: 'published', result };
    };

    const promise = run()
      .then(outcome => {
        inFlight.delete(operationKey);
        if (outcome.status !== 'stale-owner') remember(operationKey, outcome);
        return outcome;
      })
      .catch(error => {
        inFlight.delete(operationKey);
        throw error;
      });
    inFlight.set(operationKey, promise);
    return promise;
  };

  const buildPatch = ({
    ownerKey,
    operationId,
    cardId,
    fields,
    fieldMask,
    intent,
    operation = 'patch',
  }: {
    ownerKey: string;
    operationId: string;
    cardId: string;
    fields: Partial<CardData>;
    fieldMask: readonly (keyof CardData)[];
    intent: Extract<LearningStateIntent, 'bookmark' | 'deck' | 'review' | 'patch'>;
    operation?: Extract<CardMutationKind, 'patch' | 'review'>;
  }): MutationPlan => {
    const source = port.findCard(cardId);
    if (!source) return { status: 'missing-card' };
    const selectedFields = selectMutableCardPatch(fields, fieldMask);
    const selectedMask = fieldMask.filter(
      (field): field is CardMutableField => Object.prototype.hasOwnProperty.call(selectedFields, field),
    );
    if (selectedMask.length === 0 || cardAlreadyHasPatch(source, selectedFields, selectedMask)) {
      return { status: 'noop' };
    }

    return {
      ownerKey,
      operationId,
      operation,
      intent,
      cardId,
      fields: selectedFields,
      fieldMask: selectedMask,
      baseRevision: source.revision ?? 0,
      libraryEpoch: source.libraryEpoch ?? 0,
      publication: { kind: 'patch', cardId, fields: selectedFields },
    };
  };

  return {
    toggleBookmark: (cardId, operationId) => execute(operationId, (ownerKey, normalizedOperationId) => {
      const source = port.findCard(cardId);
      if (!source) return { status: 'missing-card' };
      return buildPatch({
        ownerKey,
        operationId: normalizedOperationId,
        cardId,
        fields: { bookmarked: !source.bookmarked },
        fieldMask: ['bookmarked'],
        intent: 'bookmark',
      });
    }),

    assignDeck: (cardId, deckName, operationId) => execute(operationId, (ownerKey, normalizedOperationId) =>
      buildPatch({
        ownerKey,
        operationId: normalizedOperationId,
        cardId,
        fields: { customDeck: deckName },
        fieldMask: ['customDeck'],
        intent: 'deck',
      })),

    review: (cardId, rating, operationId) => execute(operationId, async (ownerKey, normalizedOperationId) => {
      const { scheduleReview } = await import('../../lib/reviewScheduler');
      const source = port.findCard(cardId);
      if (!source) return { status: 'missing-card' };
      const fields = scheduleReview(source, rating, now());
      return buildPatch({
        ownerKey,
        operationId: normalizedOperationId,
        cardId,
        fields,
        fieldMask: Object.keys(fields) as Array<keyof CardData>,
        intent: 'review',
        operation: 'review',
      });
    }),

    patch: (cardId, fields, fieldMask, operationId) => execute(operationId, (ownerKey, normalizedOperationId) =>
      buildPatch({
        ownerKey,
        operationId: normalizedOperationId,
        cardId,
        fields,
        fieldMask,
        intent: 'patch',
      })),

    delete: (cardId, operationId) => execute(operationId, (ownerKey, normalizedOperationId) => {
      const source = port.findCard(cardId);
      if (!source) return { status: 'missing-card' };
      return {
        ownerKey,
        operationId: normalizedOperationId,
        operation: 'delete',
        intent: 'delete',
        cardId,
        card: { ...source },
        baseRevision: source.revision ?? 0,
        libraryEpoch: source.libraryEpoch ?? 0,
        publication: { kind: 'delete', cardId },
      };
    }),

    restore: (token, request) => execute(request.operationId, (ownerKey, normalizedOperationId) => {
      if (token.ownerKey !== ownerKey) return { status: 'stale-owner' };
      return {
        ownerKey,
        operationId: normalizedOperationId,
        operation: 'restore',
        intent: 'restore',
        undoToken: token,
        card: { ...token.card },
        expectedLibraryEpoch: token.expectedLibraryEpoch,
        operationCreatedAt: request.operationCreatedAt,
        publication: { kind: 'restore', card: { ...token.card } },
      };
    }),

    clear: operationId => execute(operationId, (ownerKey, normalizedOperationId) => ({
      ownerKey,
      operationId: normalizedOperationId,
      operation: 'clear',
      intent: 'clear',
      publication: { kind: 'clear' },
    })),
    invalidateUndoTokens: () => {
      clearGeneration += 1;
      latestDeleteLifecycle.clear();
    },
  };
}

/** The only fields a Library multi-select bulk action mutates today. */
export interface BulkCardFieldPatchRequest {
  cardId: string;
  fields: { customDeck?: string | null; bookmarked?: boolean };
}

export type BulkCardFieldPatchOutcome =
  | { cardId: string; applied: true; publication: LearningStatePublication }
  | { cardId: string; applied: false };
