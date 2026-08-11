import { useEffect, useMemo, useRef, useState } from 'react';
import type { DevicePendingOperation } from '../../lib/deviceSync';
import type { CardData } from '../../types/card';
import { planCustomDeckCreation, normalizeCustomDeckCollection } from './customDecks';
import { planDeckDeletionFailureRecovery } from './libraryMutationRecovery';
import {
  legacyDeckCacheKey,
  legacyDeckOwnerCacheKey,
  ownerScopedDeckCacheKey,
  parseOwnerScopedDeckCache,
  serializeOwnerScopedDeckCache,
} from './ownerScopedDeckCache';

export interface CustomDeckMutationPort {
  add(ownerId: string, deckName: string): Promise<void>;
  clearAssignments(ownerId: string, deckName: string): Promise<void>;
  removeProfile(ownerId: string, deckName: string): Promise<void>;
}

export interface CustomDeckCachePort {
  read(): { ownerId: string | null; decks: string[] };
  write(ownerId: string | null, decks: readonly string[]): void;
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

type DeckOwnerScope = string | null | undefined;

interface ScopedDeckState {
  ownerScope: DeckOwnerScope;
  decks: string[];
}

const deckCreationFailureMessage = 'The deck could not be created. Check your connection and try again.';
const deckDeletionFailureMessage = 'The deck could not be deleted. Check your connection and try again.';

const browserCache: CustomDeckCachePort = {
  read: () => {
    try {
      const scoped = parseOwnerScopedDeckCache(
        globalThis.localStorage?.getItem(ownerScopedDeckCacheKey) ?? null,
      );
      if (scoped) return scoped;
      return {
        ownerId: globalThis.localStorage?.getItem(legacyDeckOwnerCacheKey) ?? null,
        decks: normalizeCustomDeckCollection(JSON.parse(
          globalThis.localStorage?.getItem(legacyDeckCacheKey) ?? '[]',
        )),
      };
    } catch {
      return { ownerId: null, decks: [] };
    }
  },
  write: (ownerId, decks) => {
    try {
      globalThis.localStorage?.setItem(
        ownerScopedDeckCacheKey,
        serializeOwnerScopedDeckCache(ownerId, decks),
      );
    } catch { /* optional */ }
  },
};

export function readCachedDecksForIdentity(
  cache: CustomDeckCachePort,
  identityReady: boolean,
  ownerId: string | null,
  remoteDecks: readonly string[] | null,
): string[] {
  if (!identityReady || !ownerId) return [];
  if (remoteDecks) return normalizeCustomDeckCollection(remoteDecks);
  const cached = cache.read();
  return cached.ownerId === ownerId
    ? normalizeCustomDeckCollection(cached.decks)
    : [];
}

export function useCustomDeckWorkspace(options: CustomDeckWorkspaceOptions): {
  model: CustomDeckWorkspaceModel;
  actions: CustomDeckWorkspaceActions;
} {
  const latestRef = useRef(options);
  latestRef.current = options;
  const cache = options.cache ?? browserCache;
  const cacheRef = useRef(cache);
  cacheRef.current = cache;
  const ownerScope: DeckOwnerScope = options.identityReady ? options.owner.id : undefined;
  const ownerLifecycleRef = useRef({ ownerScope, version: 0 });
  if (ownerLifecycleRef.current.ownerScope !== ownerScope) {
    ownerLifecycleRef.current = {
      ownerScope,
      version: ownerLifecycleRef.current.version + 1,
    };
  }
  const ownerVersion = ownerLifecycleRef.current.version;
  const [deckState, setDeckState] = useState<ScopedDeckState>(() => ({
    ownerScope,
    decks: readCachedDecksForIdentity(
      cache,
      options.identityReady,
      options.owner.id,
      options.remoteDecks,
    ),
  }));
  const decks = deckState.ownerScope === ownerScope
    ? deckState.decks
    : readCachedDecksForIdentity(
      cache,
      options.identityReady,
      options.owner.id,
      options.remoteDecks,
    );
  const [newDeckInput, setNewDeckInput] = useState('');

  useEffect(() => {
    setDeckState({
      ownerScope,
      decks: readCachedDecksForIdentity(
        cache,
        options.identityReady,
        options.owner.id,
        options.remoteDecks,
      ),
    });
  }, [cache, options.identityReady, options.owner.id, options.remoteDecks, ownerScope]);

  useEffect(() => {
    const ownerId = options.owner.id;
    if (
      !ownerId
      || options.remoteDecks === null
      || ownerScope !== ownerId
      || deckState.ownerScope !== ownerScope
    ) return;
    cache.write(ownerId, deckState.decks);
  }, [cache, deckState, options.owner.id, options.remoteDecks, ownerScope]);

  const actions = useMemo<CustomDeckWorkspaceActions>(() => ({
    changeNewDeckInput: setNewDeckInput,
    assignDeck: async (cardId, deckName) => {
      if (
        ownerLifecycleRef.current.version !== ownerVersion
        || ownerLifecycleRef.current.ownerScope !== ownerScope
      ) return;
      const current = latestRef.current;
      await current.ports.assignCard(cardId, deckName);
    },
    createDeck: async name => {
      const creationOwnerVersion = ownerVersion;
      const isCurrentOwner = () => (
        ownerLifecycleRef.current.version === creationOwnerVersion
        && ownerLifecycleRef.current.ownerScope === ownerScope
      );
      if (!isCurrentOwner()) return;
      const current = latestRef.current;
      const plan = planCustomDeckCreation(decks, name);
      if (plan.status === 'empty' || plan.status === 'duplicate') return;
      if (plan.status === 'limit') {
        current.ports.reportError('You can create up to 100 custom decks. Delete an existing deck before adding another.');
        return;
      }
      if (current.owner.id && current.owner.remoteAvailable) {
        try {
          await current.mutations.add(current.owner.id, plan.name);
        } catch (cause) {
          if (!isCurrentOwner()) return;
          current.ports.warn('Custom deck profile could not be updated.', cause);
          current.ports.reportError(deckCreationFailureMessage);
          throw new Error(deckCreationFailureMessage);
        }
      }
      if (!isCurrentOwner()) return;
      setDeckState({ ownerScope, decks: plan.decks });
      cacheRef.current.write(current.owner.id, plan.decks);
    },
    deleteDeck: async deckName => {
      const current = latestRef.current;
      const deletionOwnerVersion = ownerVersion;
      const isCurrentOwner = () => (
        ownerLifecycleRef.current.version === deletionOwnerVersion
        && ownerLifecycleRef.current.ownerScope === ownerScope
      );
      if (!isCurrentOwner()) return;
      const updated = decks.filter(deck => deck !== deckName);
      const changedCards: CardData[] = current.cards
        .filter(card => card.customDeck === deckName)
        .map(card => ({ ...card, customDeck: null }));
      const changedIds = new Set(changedCards.map(card => card.id));
      const applyLocalResult = () => {
        if (!isCurrentOwner()) return;
        setDeckState({ ownerScope, decks: updated });
        cacheRef.current.write(current.owner.id, updated);
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
          if (!isCurrentOwner()) return;
          current.ports.warn('Deck deletion could not complete atomically.', cause);
          const recovery = planDeckDeletionFailureRecovery(assignmentsCleared, deckProfileRemoved);
          current.ports.recoverCloud(current.owner.id, recovery.message);
          if (recovery.applyLocalResult) {
            applyLocalResult();
            return;
          }
          current.ports.reportError(deckDeletionFailureMessage);
          throw new Error(deckDeletionFailureMessage);
        }
      }
      if (!isCurrentOwner()) return;
      applyLocalResult();
    },
  }), [decks, ownerScope, ownerVersion]);

  return { model: { decks, newDeckInput }, actions };
}
