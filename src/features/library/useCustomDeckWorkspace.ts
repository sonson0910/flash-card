import { useEffect, useMemo, useRef, useState } from 'react';
import type { DevicePendingOperation } from '../../lib/deviceSync';
import type { CardData } from '../../types/card';
import { planCustomDeckCreation, normalizeCustomDeckCollection } from './customDecks';
import { planDeckDeletionFailureRecovery } from './libraryMutationRecovery';

export interface CustomDeckMutationPort {
  add(ownerId: string, deckName: string): Promise<void>;
  clearAssignments(ownerId: string, deckName: string): Promise<void>;
  removeProfile(ownerId: string, deckName: string): Promise<void>;
}

export interface CustomDeckCachePort {
  readDecks(): string[];
  writeDecks(decks: readonly string[]): void;
  readOwner(): string | null;
  writeOwner(ownerId: string): void;
  clearOwner(): void;
}

export interface CustomDeckWorkspaceOptions {
  identityReady: boolean;
  owner: { id: string | null; remoteAvailable: boolean };
  remoteDecks: readonly string[] | null;
  cards: readonly CardData[];
  activeDeck: string;
  knownLibraryTotal: number;
  mutations: CustomDeckMutationPort;
  cache?: CustomDeckCachePort;
  ports: {
    assignCard(cardId: string, deckName: string | null): Promise<void>;
    patchDeviceCards(
      changes: readonly { card: CardData; fields: Partial<CardData> }[],
      nextTotal: number,
    ): Promise<DevicePendingOperation[]>;
    acknowledgeDevicePending(operations: readonly DevicePendingOperation[]): Promise<void>;
    publishCards(cardIds: ReadonlySet<string>, fields: Partial<CardData>): void;
    publishPractice(cardIds: ReadonlySet<string>, fields: Partial<CardData>): void;
    chooseAllDecks(): void;
    recoverCloud(ownerId: string, message: string): void;
    reportError(message: string): void;
    warn(message: string, cause: unknown): void;
    confirmDelete(message: string): boolean;
  };
}

export interface CustomDeckWorkspaceModel {
  decks: string[];
  newDeckInput: string;
}

export interface CustomDeckWorkspaceActions {
  changeNewDeckInput(value: string): void;
  createDeck(name: string): Promise<void>;
  deleteDeck(name: string): Promise<void>;
  assignDeck(cardId: string, deckName: string | null): Promise<void>;
}

const browserCache: CustomDeckCachePort = {
  readDecks: () => {
    try {
      return normalizeCustomDeckCollection(JSON.parse(globalThis.localStorage?.getItem('lingoflash_custom_decks') ?? '[]'));
    } catch {
      return [];
    }
  },
  writeDecks: decks => {
    try { globalThis.localStorage?.setItem('lingoflash_custom_decks', JSON.stringify(decks)); } catch { /* optional */ }
  },
  readOwner: () => {
    try { return globalThis.localStorage?.getItem('lingoflash_custom_decks_owner') ?? null; } catch { return null; }
  },
  writeOwner: ownerId => {
    try { globalThis.localStorage?.setItem('lingoflash_custom_decks_owner', ownerId); } catch { /* optional */ }
  },
  clearOwner: () => {
    try { globalThis.localStorage?.removeItem('lingoflash_custom_decks_owner'); } catch { /* optional */ }
  },
};

export function useCustomDeckWorkspace(options: CustomDeckWorkspaceOptions): {
  model: CustomDeckWorkspaceModel;
  actions: CustomDeckWorkspaceActions;
} {
  const latestRef = useRef(options);
  latestRef.current = options;
  const cache = options.cache ?? browserCache;
  const cacheRef = useRef(cache);
  cacheRef.current = cache;
  const [decks, setDecks] = useState(() => cache.readDecks());
  const [newDeckInput, setNewDeckInput] = useState('');

  useEffect(() => {
    if (!options.identityReady) return;
    if (!options.owner.id) {
      setDecks([]);
      return;
    }
    if (options.remoteDecks) setDecks(normalizeCustomDeckCollection(options.remoteDecks));
  }, [options.identityReady, options.owner.id, options.remoteDecks]);

  useEffect(() => {
    const ownerId = options.owner.id;
    if (ownerId && cache.readOwner() === ownerId) cache.writeDecks(decks);
  }, [cache, decks, options.owner.id]);

  const actions = useMemo<CustomDeckWorkspaceActions>(() => ({
    changeNewDeckInput: setNewDeckInput,
    assignDeck: async (cardId, deckName) => {
      await latestRef.current.ports.assignCard(cardId, deckName);
    },
    createDeck: async name => {
      const current = latestRef.current;
      const plan = planCustomDeckCreation(decks, name);
      if (plan.status === 'empty' || plan.status === 'duplicate') return;
      if (plan.status === 'limit') {
        current.ports.reportError('You can create up to 100 custom decks. Delete an existing deck before adding another.');
        return;
      }
      if (current.owner.id) cacheRef.current.writeOwner(current.owner.id);
      else cacheRef.current.clearOwner();
      setDecks(plan.decks);
      cacheRef.current.writeDecks(plan.decks);
      if (current.owner.id && current.owner.remoteAvailable) {
        void current.mutations.add(current.owner.id, plan.name).catch(cause => {
          current.ports.warn('Custom deck profile could not be updated.', cause);
        });
      }
    },
    deleteDeck: async deckName => {
      const current = latestRef.current;
      if (!current.ports.confirmDelete(
        `Are you sure you want to delete the collection "${deckName}"? All cards in this collection will be marked as unassigned.`,
      )) return;

      const updated = decks.filter(deck => deck !== deckName);
      if (current.owner.id) cacheRef.current.writeOwner(current.owner.id);
      const changedCards: CardData[] = current.cards
        .filter(card => card.customDeck === deckName)
        .map(card => ({ ...card, customDeck: null }));
      const changedIds = new Set(changedCards.map(card => card.id));
      const applyLocalResult = () => {
        setDecks(updated);
        cacheRef.current.writeDecks(updated);
        current.ports.publishCards(changedIds, { customDeck: null });
        current.ports.publishPractice(changedIds, { customDeck: null });
        if (current.activeDeck === deckName) current.ports.chooseAllDecks();
      };

      let assignmentsCleared = false;
      let deckProfileRemoved = false;
      if (current.owner.id && current.owner.remoteAvailable) {
        try {
          await current.mutations.clearAssignments(current.owner.id, deckName);
          assignmentsCleared = true;
          await current.mutations.removeProfile(current.owner.id, deckName);
          deckProfileRemoved = true;
          const pending = await current.ports.patchDeviceCards(
            changedCards.map(card => ({ card, fields: { customDeck: null } })),
            current.knownLibraryTotal,
          );
          await current.ports.acknowledgeDevicePending(pending);
        } catch (cause) {
          current.ports.warn('Deck deletion could not complete atomically.', cause);
          const recovery = planDeckDeletionFailureRecovery(assignmentsCleared, deckProfileRemoved);
          current.ports.recoverCloud(current.owner.id, recovery.message);
          if (recovery.applyLocalResult) applyLocalResult();
          return;
        }
      }
      applyLocalResult();
    },
  }), [decks]);

  return { model: { decks, newDeckInput }, actions };
}
