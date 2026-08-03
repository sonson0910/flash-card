import { useRef } from 'react';
import type { ReviewRating } from '../../lib/reviewScheduler';
import type { CardData } from '../../types/card';
import {
  createLearningStateController,
  type LearningStateController,
  type LearningStateMutation,
  type LearningStateMutationResult,
  type LearningStateOutcome,
  type LearningStateSnapshotsPort,
} from './learningStateController';

export interface LearningStatePersistencePort {
  findCard(cardId: string): CardData | undefined;
  persist(mutation: LearningStateMutation): Promise<LearningStateMutationResult>;
}

export type LearningOperationIdFactory = (
  intent: 'bookmark' | 'deck' | 'review' | 'patch' | 'delete' | 'clear',
  cardId?: string,
) => string;

export interface LearningStateCommands {
  toggleBookmark(cardId: string): Promise<LearningStateOutcome>;
  assignDeck(cardId: string, deckName: string | null): Promise<LearningStateOutcome>;
  reviewCard(cardId: string, rating: ReviewRating): Promise<LearningStateOutcome>;
  patchCard(
    cardId: string,
    fields: Partial<CardData>,
    fieldMask?: readonly (keyof CardData)[],
  ): Promise<LearningStateOutcome>;
  deleteCard(cardId: string): Promise<LearningStateOutcome>;
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
      reviewCard: (cardId, rating) => controller.review(cardId, rating, operation('review', cardId)),
      patchCard: (cardId, fields, fieldMask = Object.keys(fields) as Array<keyof CardData>) =>
        controller.patch(cardId, fields, fieldMask, operation('patch', cardId)),
      deleteCard: cardId => controller.delete(cardId, operation('delete', cardId)),
      clearLibrary: () => controller.clear(operation('clear')),
    },
    updateOwner: nextOwnerId => { activeOwnerId = nextOwnerId; },
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
