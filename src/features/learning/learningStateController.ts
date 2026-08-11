import {
  cardAlreadyHasPatch,
  normalizeCardOperationId,
  selectMutableCardPatch,
  type CardMutableField,
  type CardMutationKind,
} from '../../lib/cardMutationProtocol';
import type { ReviewRating } from '../../lib/reviewScheduler';
import type { CardData } from '../../types/card';

export type LearningStateIntent = 'bookmark' | 'deck' | 'review' | 'patch' | 'delete' | 'clear';

export type LearningStatePublication =
  | { kind: 'patch'; cardId: string; fields: Partial<CardData> }
  | { kind: 'delete'; cardId: string }
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
      baseRevision: number;
      libraryEpoch: number;
    }
  | LearningStateMutationBase & {
      operation: 'clear';
    };

export interface LearningStateMutationResult {
  ownerKey: string;
  operationId: string;
  publication: LearningStatePublication;
}

export interface LearningStatePort {
  activeOwner(): string | null;
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
  | { status: 'noop' }
  | { status: 'missing-card' }
  | { status: 'no-active-owner' }
  | { status: 'stale-owner' };

type TerminalOutcome = Exclude<LearningStateOutcome, { status: 'published' } | { status: 'stale-owner' }>;
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
  clear(operationId: string): Promise<LearningStateOutcome>;
}

export function createLearningStateController({
  port,
  snapshots,
  now = () => new Date(),
  completedOperationLimit = 500,
}: LearningStateControllerOptions): LearningStateController {
  const inFlight = new Map<string, Promise<LearningStateOutcome>>();
  const completed = new Map<string, LearningStateOutcome>();

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

      const result = await port.persist(plan);
      if (result.ownerKey !== ownerKey || result.operationId !== normalizedOperationId) {
        throw new Error('Learning state persistence returned a result for a different owner or operation.');
      }
      if (port.activeOwner() !== ownerKey) return { status: 'stale-owner' };

      snapshots.library.apply(result.publication);
      snapshots.practice.apply(result.publication);
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
        baseRevision: source.revision ?? 0,
        libraryEpoch: source.libraryEpoch ?? 0,
        publication: { kind: 'delete', cardId },
      };
    }),

    clear: operationId => execute(operationId, (ownerKey, normalizedOperationId) => ({
      ownerKey,
      operationId: normalizedOperationId,
      operation: 'clear',
      intent: 'clear',
      publication: { kind: 'clear' },
    })),
  };
}
