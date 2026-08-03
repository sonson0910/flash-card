import { useMemo, useRef } from 'react';
import type { ReviewRating } from '../../lib/reviewScheduler';
import type { DevicePendingOperation } from '../../lib/deviceSync';
import type { CardData } from '../../types/card';
import { normalizeAssignedDeckName } from '../library/customDecks';
import type { LearningStatePublication } from './learningStateController';
import {
  useLearningState,
  type LearningOperationIdFactory,
} from './useLearningState';
import { useLearningStatePersistence } from './useLearningStatePersistence';

export interface LearningWorkspaceStats {
  total: number;
  easy: number;
  good: number;
  hard: number;
  unrated: number;
  bookmarked: number;
  due: number;
  legacyUnindexed: number;
}

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
  ): Promise<DevicePendingOperation[]>;
  removeDeviceCard(cardId: string): Promise<DevicePendingOperation[]>;
  acknowledgeDevicePending(operations: readonly DevicePendingOperation[]): Promise<void>;
  acceptVerifiedEpoch(ownerId: string, epoch: number): void;
  mutateCloudStats(update: (current: LearningWorkspaceStats) => LearningWorkspaceStats): void;
  publishCategoryFacets(deltas: Record<string, number>): Promise<void>;
  resetCloudState(facetsComplete: boolean): void;
  resetCloudPage(): void;
  refreshCloud(): void;
  cloudAvailabilityChanged(unavailable: boolean): void;
  mutationPendingChanged(pending: boolean): void;
  reportError(message: string): void;
  addXp(amount: number): void;
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
  reviewCard(cardId: string, rating: ReviewRating): Promise<void>;
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

export function useLearningWorkspace(options: LearningWorkspaceOptions): {
  actions: LearningWorkspaceActions;
} {
  const latestRef = useRef(options);
  latestRef.current = options;
  const sourceOverridesRef = useRef(new Map<string, SourceOverride>());

  const persistence = useLearningStatePersistence({
    ownerId: options.owner.id,
    verifiedEpoch: options.owner.verifiedEpoch,
    knownLibraryTotal: options.library.knownTotal,
    findCard: cardId => sourceOverridesRef.current.get(cardId)?.source
      ?? latestRef.current.library.findCard(cardId)
      ?? latestRef.current.practice.findCard(cardId),
    canPublishPatch: cardId => {
      const override = sourceOverridesRef.current.get(cardId);
      return latestRef.current.library.isPatchCurrent(cardId, override?.expectedLifecycle);
    },
    patchDeviceCards: (changes, total) => latestRef.current.ports.patchDeviceCards(changes, total),
    removeDeviceCard: cardId => latestRef.current.ports.removeDeviceCard(cardId),
    acknowledgeDevicePending: operations => latestRef.current.ports.acknowledgeDevicePending(operations),
    acceptVerifiedEpoch: (ownerId, epoch) => latestRef.current.ports.acceptVerifiedEpoch(ownerId, epoch),
    updateCloudStats: update => latestRef.current.ports.mutateCloudStats(update),
    updateCategoryFacets: deltas => latestRef.current.ports.publishCategoryFacets(deltas),
    resetCloudState: facetsComplete => latestRef.current.ports.resetCloudState(facetsComplete),
    resetCloudPage: () => latestRef.current.ports.resetCloudPage(),
    refreshCloud: () => latestRef.current.ports.refreshCloud(),
    setCloudUnavailable: unavailable => latestRef.current.ports.cloudAvailabilityChanged(unavailable),
    setMutationPending: pending => latestRef.current.ports.mutationPendingChanged(pending),
    reportError: message => latestRef.current.ports.reportError(message),
    addXp: amount => latestRef.current.ports.addXp(amount),
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
    reviewCard: async (cardId, rating) => { await commands.reviewCard(cardId, rating); },
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
