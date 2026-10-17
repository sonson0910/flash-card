import { useRef } from 'react';
import type { ReviewRating } from '../../lib/reviewScheduler';
import type { CardData } from '../../types/card';
import {
  createLearningStateController,
  type LearningStateController,
  type LearningStateMutation,
  type LearningStateMutationResult,
  type LearningDeleteUndoToken,
  type LearningRestoreRequest,
  type LearningStateOutcome,
  type LearningStateSnapshotsPort,
  type BulkCardFieldPatchOutcome,
  type BulkCardFieldPatchRequest,
} from './learningStateController';

export interface LearningStatePersistencePort {
  ownerId?(): string | null;
  findCard(cardId: string): CardData | undefined;
  persist(mutation: LearningStateMutation): Promise<LearningStateMutationResult>;
  /**
   * Optional: patches many cards through one bulk-mutation callable instead
   * of one `persist` call per card. Absent for persistence ports that do not
   * back a Library multi-select action (e.g. test doubles).
   */
  persistBulkPatch?(
    patches: readonly BulkCardFieldPatchRequest[],
  ): Promise<BulkCardFieldPatchOutcome[]>;
}

export type LearningOperationIdFactory = (
  intent: 'bookmark' | 'deck' | 'review' | 'patch' | 'delete' | 'restore' | 'clear',
  cardId?: string,
) => string;

export interface LearningStateCommands {
  toggleBookmark(cardId: string): Promise<LearningStateOutcome>;
  assignDeck(cardId: string, deckName: string | null): Promise<LearningStateOutcome>;
  reviewCard(cardId: string, rating: ReviewRating, operationId?: string): Promise<LearningStateOutcome>;
  patchCard(
    cardId: string,
    fields: Partial<CardData>,
    fieldMask?: readonly (keyof CardData)[],
  ): Promise<LearningStateOutcome>;
  deleteCard(cardId: string): Promise<LearningStateOutcome>;
  restoreCard(token: LearningDeleteUndoToken, request: LearningRestoreRequest): Promise<LearningStateOutcome>;
  clearLibrary(): Promise<LearningStateOutcome>;
}

export interface LearningStateBinding {
  commands: LearningStateCommands;
  updateOwner(ownerId: string | null): void;
}

export interface LearningStateBindingOptions {
  ownerId: string | null;
  persistence: LearningStatePersistencePort;
  publishers: LearningStateSnapshotsPort;
  createOperationId?: LearningOperationIdFactory;
  now?: () => Date;
}

let fallbackOperationSequence = 0;
const defaultOperationId: LearningOperationIdFactory = (intent, cardId = 'library') => {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  fallbackOperationSequence += 1;
  return `${intent}-${cardId}-${Date.now()}-${fallbackOperationSequence}`;
};

const systemNow = () => new Date();

export function createLearningStateBinding({
  ownerId,
  persistence,
  publishers,
  createOperationId = defaultOperationId,
  now = systemNow,
}: LearningStateBindingOptions): LearningStateBinding {
  let activeOwnerId = ownerId;
  const controller: LearningStateController = createLearningStateController({
    port: {
      activeOwner: () => activeOwnerId,
      activeOwnerId: () => persistence.ownerId?.() ?? null,
      findCard: cardId => persistence.findCard(cardId),
      persist: mutation => persistence.persist(mutation),
    },
    snapshots: publishers,
    now,
  });

  const operation = (
    intent: Parameters<LearningOperationIdFactory>[0],
    cardId?: string,
  ) => createOperationId(intent, cardId);

  return {
    commands: {
      toggleBookmark: cardId => controller.toggleBookmark(cardId, operation('bookmark', cardId)),
      assignDeck: (cardId, deckName) => controller.assignDeck(cardId, deckName, operation('deck', cardId)),
      reviewCard: (cardId, rating, operationId) => controller.review(
        cardId,
        rating,
        operationId?.trim() || operation('review', cardId),
      ),
      patchCard: (cardId, fields, fieldMask = Object.keys(fields) as Array<keyof CardData>) =>
        controller.patch(cardId, fields, fieldMask, operation('patch', cardId)),
      deleteCard: cardId => controller.delete(cardId, operation('delete', cardId)),
      restoreCard: (token, request) => controller.restore(token, request),
      clearLibrary: () => controller.clear(operation('clear')),
    },
    updateOwner: nextOwnerId => {
      if (activeOwnerId !== nextOwnerId) controller.invalidateUndoTokens();
      activeOwnerId = nextOwnerId;
    },
  };
}

export type UseLearningStateOptions = LearningStateBindingOptions;

export function useLearningState({
  ownerId,
  persistence,
  publishers,
  createOperationId = defaultOperationId,
  now = systemNow,
}: UseLearningStateOptions): LearningStateCommands {
  const latestRef = useRef({ persistence, publishers, createOperationId, now });
  latestRef.current = { persistence, publishers, createOperationId, now };
  const bindingRef = useRef<LearningStateBinding | null>(null);

  if (!bindingRef.current) {
    bindingRef.current = createLearningStateBinding({
      ownerId,
      persistence: {
        ownerId: () => latestRef.current.persistence.ownerId?.() ?? null,
        findCard: cardId => latestRef.current.persistence.findCard(cardId),
        persist: mutation => latestRef.current.persistence.persist(mutation),
      },
      publishers: {
        library: { apply: publication => latestRef.current.publishers.library.apply(publication) },
        practice: { apply: publication => latestRef.current.publishers.practice.apply(publication) },
      },
      createOperationId: (intent, cardId) => latestRef.current.createOperationId(intent, cardId),
      now: () => latestRef.current.now(),
    });
  }

  bindingRef.current.updateOwner(ownerId);
  return bindingRef.current.commands;
}
