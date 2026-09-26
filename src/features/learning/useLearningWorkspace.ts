import { useMemo, useRef } from 'react';
import type { ReviewRating } from '../../lib/reviewScheduler';
import type { CardData } from '../../types/card';
import { normalizeAssignedDeckName } from '../library/customDecks';
import type {
  LearningDeleteUndoToken,
  LearningRestoreRequest,
  LearningStateOutcome,
  LearningStatePublication,
} from './learningStateController';
import {
  useLearningState,
  type LearningOperationIdFactory,
} from './useLearningState';
import type {
  BulkCardFieldPatchRequest,
  LearningPersistenceHook,
  LearningPersistenceStats,
} from './learningPersistencePort';

export type LearningWorkspaceStats = LearningPersistenceStats;

export interface LearningWorkspaceLibraryPort {
  knownTotal: number;
  findCard(cardId: string): CardData | undefined;
  isPatchCurrent(cardId: string, expectedLifecycle?: string): boolean;
  publication: {
    patch(cardId: string, fields: Partial<CardData>): void;
    remove(cardId: string): void;
    restore(card: CardData): void;
    clear(): void;
  };
}

export interface LearningWorkspacePracticePort {
  findCard(cardId: string): CardData | undefined;
  publication: {
    patch(cardId: string, fields: Partial<CardData>): void;
    remove(cardId: string): void;
    restore(card: CardData): void;
    clear(): void;
  };
}

export interface LearningWorkspaceInfrastructurePorts {
  acceptVerifiedEpoch(ownerId: string, epoch: number): void;
  mutateCloudStats(update: (current: LearningWorkspaceStats) => LearningWorkspaceStats): void;
  publishCategoryFacets(deltas: Record<string, number>, operationId?: string): Promise<void>;
  resetCloudState(facetsComplete: boolean): void;
  resetCloudPage(): void;
  refreshCloud(): void;
  cloudAvailabilityChanged(unavailable: boolean): void;
  mutationPendingChanged(pending: boolean): void;
  reportError(message: string): void;
  addXp(amount: number, operationId?: string): void;
}

export interface LearningWorkspaceOptions {
  owner: {
    id: string | null;
    verifiedEpoch: number | null;
    commandKey?: string;
  };
  library: LearningWorkspaceLibraryPort;
  practice: LearningWorkspacePracticePort;
  ports: LearningWorkspaceInfrastructurePorts;
  createOperationId?: LearningOperationIdFactory;
  now?: () => Date;
}

export interface LearningCardUpdateOptions {
  source?: CardData;
  expectedLifecycle?: string;
}

export interface LearningWorkspaceActions {
  toggleBookmark(cardId: string): Promise<void>;
  assignDeck(cardId: string, deckName: string | null): Promise<void>;
  reviewCard(cardId: string, rating: ReviewRating, operationId?: string, source?: CardData): Promise<LearningStateOutcome>;
  updateCard(
    cardId: string,
    fields: Partial<CardData>,
    options?: LearningCardUpdateOptions,
  ): Promise<LearningStateOutcome>;
  deleteCard(cardId: string): Promise<LearningStateOutcome>;
  restoreCard(token: LearningDeleteUndoToken): Promise<LearningStateOutcome>;
  clearLibrary(): Promise<void>;
  /**
   * Patches many cards (customDeck/bookmarked only, the Library multi-select
   * fields) through one bulk-mutation callable. Throws if any card in the
   * batch failed to apply, so callers can surface a single bulk error.
   */
  bulkPatchCards(patches: readonly BulkCardFieldPatchRequest[]): Promise<void>;
}

type SourceOverride = {
  source: CardData;
  expectedLifecycle?: string;
};

let fallbackRestoreOperationSequence = 0;

export interface LearningWorkspaceDependencies {
  usePersistence: LearningPersistenceHook;
}

export function useLearningWorkspace(
  options: LearningWorkspaceOptions,
  dependencies: LearningWorkspaceDependencies,
): {
  actions: LearningWorkspaceActions;
} {
  const latestRef = useRef(options);
  latestRef.current = options;
  const sourceOverridesRef = useRef(new Map<string, SourceOverride>());
  const deleteTokensRef = useRef(new Map<string, LearningDeleteUndoToken>());
  const restoreRequestsRef = useRef(new Map<string, LearningRestoreRequest>());

  const persistence = dependencies.usePersistence({
    ownerId: options.owner.id,
    verifiedEpoch: options.owner.verifiedEpoch,
    knownLibraryTotal: options.library.knownTotal,
    validateRestore: token => {
      const current = latestRef.current;
      const ownerKey = current.owner.commandKey ?? current.owner.id ?? 'device';
      if (ownerKey !== token.ownerKey || current.owner.id !== token.ownerId) return 'owner-changed';
      if (current.owner.verifiedEpoch !== null && current.owner.verifiedEpoch !== token.expectedLibraryEpoch) {
        return 'epoch-changed';
      }
      if (deleteTokensRef.current.get(token.card.id)?.lifecycleId !== token.lifecycleId) return 'deleted-again';
      if (current.library.findCard(token.card.id) || current.practice.findCard(token.card.id)) return 'unsafe-existing';
      return null;
    },
    findCard: cardId => sourceOverridesRef.current.get(cardId)?.source
      ?? latestRef.current.library.findCard(cardId)
      ?? latestRef.current.practice.findCard(cardId),
    canPublishPatch: cardId => {
      const override = sourceOverridesRef.current.get(cardId);
      return latestRef.current.library.isPatchCurrent(cardId, override?.expectedLifecycle);
    },
    acceptVerifiedEpoch: (ownerId, epoch) => latestRef.current.ports.acceptVerifiedEpoch(ownerId, epoch),
    updateCloudStats: update => latestRef.current.ports.mutateCloudStats(update),
    updateCategoryFacets: (deltas, operationId) => latestRef.current.ports.publishCategoryFacets(deltas, operationId),
    resetCloudState: facetsComplete => latestRef.current.ports.resetCloudState(facetsComplete),
    resetCloudPage: () => latestRef.current.ports.resetCloudPage(),
    refreshCloud: () => latestRef.current.ports.refreshCloud(),
    setCloudUnavailable: unavailable => latestRef.current.ports.cloudAvailabilityChanged(unavailable),
    setMutationPending: pending => latestRef.current.ports.mutationPendingChanged(pending),
    reportError: message => latestRef.current.ports.reportError(message),
    addXp: (amount, operationId) => latestRef.current.ports.addXp(amount, operationId),
  });

  const publishLibrary = (publication: LearningStatePublication) => {
    const library = latestRef.current.library.publication;
    if (publication.kind === 'patch') library.patch(publication.cardId, publication.fields);
    else if (publication.kind === 'delete') library.remove(publication.cardId);
    else if (publication.kind === 'restore') library.restore(publication.card);
    else library.clear();
  };
  const publishPractice = (publication: LearningStatePublication) => {
    const practice = latestRef.current.practice.publication;
    if (publication.kind === 'patch') practice.patch(publication.cardId, publication.fields);
    else if (publication.kind === 'delete') practice.remove(publication.cardId);
    else if (publication.kind === 'restore') practice.restore(publication.card);
    else practice.clear();
  };
  const commands = useLearningState({
    ownerId: options.owner.commandKey ?? options.owner.id ?? 'device',
    persistence,
    publishers: {
      library: { apply: publishLibrary },
      practice: { apply: publishPractice },
    },
    createOperationId: options.createOperationId,
    now: options.now,
  });

  const actions = useMemo<LearningWorkspaceActions>(() => ({
    toggleBookmark: async cardId => { await commands.toggleBookmark(cardId); },
    assignDeck: async (cardId, deckName) => {
      await commands.assignDeck(cardId, normalizeAssignedDeckName(deckName));
    },
    reviewCard: async (cardId, rating, operationId, source) => {
      const override = source ? { source } : null;
      if (override) sourceOverridesRef.current.set(cardId, override);
      try {
        const outcome = await commands.reviewCard(cardId, rating, operationId);
        return outcome;
      } finally {
        if (override && sourceOverridesRef.current.get(cardId) === override) sourceOverridesRef.current.delete(cardId);
      }
    },
    updateCard: async (cardId, fields, updateOptions) => {
      const current = latestRef.current;
      if (!current.library.isPatchCurrent(cardId, updateOptions?.expectedLifecycle)) {
        return { status: 'stale-owner' };
      }
      const source = updateOptions?.source
        ?? current.library.findCard(cardId)
        ?? current.practice.findCard(cardId);
      if (!source) return { status: 'missing-card' };
      const override = { source, expectedLifecycle: updateOptions?.expectedLifecycle };
      sourceOverridesRef.current.set(cardId, override);
      try {
        return await commands.patchCard(cardId, fields);
      } finally {
        if (sourceOverridesRef.current.get(cardId) === override) {
          sourceOverridesRef.current.delete(cardId);
        }
      }
    },
    deleteCard: async cardId => {
      const outcome = await commands.deleteCard(cardId);
      const token = 'result' in outcome ? outcome.result.undoToken : undefined;
      if (token) deleteTokensRef.current.set(cardId, token);
      return outcome;
    },
    restoreCard: async token => {
      let request = restoreRequestsRef.current.get(token.lifecycleId);
      if (!request) {
        const current = latestRef.current;
        const operationId = current.createOperationId?.('restore', token.card.id)
          ?? (globalThis.crypto?.randomUUID?.()
            ?? `restore-${token.card.id}-${Date.now()}-${++fallbackRestoreOperationSequence}`);
        const now = current.now?.() ?? new Date();
        const afterDelete = Date.parse(token.deletedAt) + 1;
        const operationCreatedAt = new Date(Math.max(now.getTime(), afterDelete)).toISOString();
        request = { operationId, operationCreatedAt };
        restoreRequestsRef.current.set(token.lifecycleId, request);
        while (restoreRequestsRef.current.size > 500) {
          const oldestLifecycle = restoreRequestsRef.current.keys().next().value as string | undefined;
          if (!oldestLifecycle) break;
          restoreRequestsRef.current.delete(oldestLifecycle);
        }
      }
      const outcome = await commands.restoreCard(token, request);
      if (outcome.status === 'published' || outcome.status === 'durably-queued' || outcome.status === 'undo-conflict') {
        deleteTokensRef.current.delete(token.card.id);
      }
      return outcome;
    },
    clearLibrary: async () => {
      await commands.clearLibrary();
      deleteTokensRef.current.clear();
    },
    bulkPatchCards: async patches => {
      if (!persistence.persistBulkPatch) {
        throw new Error('Bulk card update is not available.');
      }
      if (patches.length === 0) return;
      const outcomes = await persistence.persistBulkPatch(patches);
      for (const outcome of outcomes) {
        if (!outcome.applied) continue;
        publishLibrary(outcome.publication);
        publishPractice(outcome.publication);
      }
      if (outcomes.some(outcome => !outcome.applied)) {
        throw new Error('Some cards could not be updated.');
      }
    },
  }), [commands, persistence]);

  return { actions };
}
