import { useMemo, useRef } from 'react';
import type { ReviewRating } from '../../lib/reviewScheduler';
import type {
  DeviceDeleteContext,
  DeviceMutationAccounting,
  DevicePendingOperation,
  PendingMutationDisposition,
} from '../../lib/deviceSync';
import type { AddXpOptions } from '../gamification/useGamification';
import type { CardData } from '../../types/card';
import { normalizeAssignedDeckName } from '../library/customDecks';
import type { LearningStatePublication } from './learningStateController';
import {
  useLearningState,
  type LearningOperationIdFactory,
} from './useLearningState';
import type {
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
    clear(): void;
  };
}

export interface LearningWorkspacePracticePort {
  findCard(cardId: string): CardData | undefined;
  publication: {
    patch(cardId: string, fields: Partial<CardData>): void;
    remove(cardId: string): void;
    clear(): void;
  };
}

export interface LearningWorkspaceInfrastructurePorts {
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
  mutateCloudStats(update: (current: LearningWorkspaceStats) => LearningWorkspaceStats): void;
  resetCloudState(facetsComplete: boolean): void;
  resetCloudPage(): void;
  refreshCloud(): void;
  cloudAvailabilityChanged(unavailable: boolean): void;
  mutationPendingChanged(pending: boolean): void;
  reportError(message: string): void;
  addXp(amount: number, options?: AddXpOptions): boolean;
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
  reviewCard(cardId: string, rating: ReviewRating, operationId?: string, source?: CardData): Promise<void>;
  updateCard(
    cardId: string,
    fields: Partial<CardData>,
    options?: LearningCardUpdateOptions,
  ): Promise<void>;
  deleteCard(cardId: string): Promise<void>;
  clearLibrary(): Promise<void>;
}

type SourceOverride = {
  source: CardData;
  expectedLifecycle?: string;
};

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

  const persistence = dependencies.usePersistence({
    ownerId: options.owner.id,
    verifiedEpoch: options.owner.verifiedEpoch,
    knownLibraryTotal: options.library.knownTotal,
    findCard: cardId => sourceOverridesRef.current.get(cardId)?.source
      ?? options.library.findCard(cardId)
      ?? options.practice.findCard(cardId),
    canPublishPatch: cardId => {
      const override = sourceOverridesRef.current.get(cardId);
      return options.library.isPatchCurrent(cardId, override?.expectedLifecycle);
    },
    patchDeviceCards: (changes, total, operationId, accounting) =>
      options.ports.patchDeviceCards(changes, total, operationId, accounting),
    removeDeviceCard: (cardId, context) => options.ports.removeDeviceCard(cardId, context),
    flushDeviceCards: logicalOperationId => options.ports.flushDeviceCards(logicalOperationId),
    acknowledgeDevicePending: operations => options.ports.acknowledgeDevicePending(operations),
    acceptVerifiedEpoch: (ownerId, epoch) => options.ports.acceptVerifiedEpoch(ownerId, epoch),
    updateCloudStats: update => options.ports.mutateCloudStats(update),
    resetCloudState: facetsComplete => options.ports.resetCloudState(facetsComplete),
    resetCloudPage: () => options.ports.resetCloudPage(),
    refreshCloud: () => options.ports.refreshCloud(),
    setCloudUnavailable: unavailable => options.ports.cloudAvailabilityChanged(unavailable),
    setMutationPending: pending => options.ports.mutationPendingChanged(pending),
    reportError: message => options.ports.reportError(message),
    addXp: (amount, addXpOptions) => options.ports.addXp(amount, addXpOptions),
  });

  const publishLibrary = (publication: LearningStatePublication) => {
    const library = latestRef.current.library.publication;
    if (publication.kind === 'patch') library.patch(publication.cardId, publication.fields);
    else if (publication.kind === 'delete') library.remove(publication.cardId);
    else library.clear();
  };
  const publishPractice = (publication: LearningStatePublication) => {
    const practice = latestRef.current.practice.publication;
    if (publication.kind === 'patch') practice.patch(publication.cardId, publication.fields);
    else if (publication.kind === 'delete') practice.remove(publication.cardId);
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
        if (outcome.status !== 'published' && outcome.status !== 'noop') {
          throw new Error(`The review was not saved (${outcome.status}).`);
        }
      } finally {
        if (override && sourceOverridesRef.current.get(cardId) === override) sourceOverridesRef.current.delete(cardId);
      }
    },
    updateCard: async (cardId, fields, updateOptions) => {
      const current = latestRef.current;
      if (!current.library.isPatchCurrent(cardId, updateOptions?.expectedLifecycle)) return;
      const source = updateOptions?.source
        ?? current.library.findCard(cardId)
        ?? current.practice.findCard(cardId);
      if (!source) return;
      const override = { source, expectedLifecycle: updateOptions?.expectedLifecycle };
      sourceOverridesRef.current.set(cardId, override);
      try {
        await commands.patchCard(cardId, fields);
      } finally {
        if (sourceOverridesRef.current.get(cardId) === override) {
          sourceOverridesRef.current.delete(cardId);
        }
      }
    },
    deleteCard: async cardId => { await commands.deleteCard(cardId); },
    clearLibrary: async () => { await commands.clearLibrary(); },
  }), [commands]);

  return { actions };
}
