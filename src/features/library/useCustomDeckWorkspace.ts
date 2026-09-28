import { useEffect, useMemo, useRef, useState } from 'react';
import type { CardData } from '../../types/card';
import {
  defaultCoverPreset,
  customDeckCoverKey,
  normalizeCustomDeckProfile,
  planCustomDeckCreation,
  type CoverPreset,
} from './customDecks';
import { planDeckDeletionFailureRecovery } from './libraryMutationRecovery';
import {
  legacyDeckCacheKey,
  legacyDeckOwnerCacheKey,
  ownerScopedDeckCacheKey,
  parseOwnerScopedDeckCache,
  serializeOwnerScopedDeckCache,
} from './ownerScopedDeckCache';

export interface CustomDeckMutationPort {
  add(ownerId: string, deckName: string, preset: CoverPreset): Promise<void>;
  clearAssignments(ownerId: string, deckName: string): Promise<void>;
  removeProfile(ownerId: string, deckName: string): Promise<void>;
}

export interface CustomDeckCachePort {
  read(): { ownerId: string | null; decks: string[]; coverPresets?: Record<string, CoverPreset> };
  write(ownerId: string | null, decks: readonly string[], coverPresets?: Record<string, CoverPreset>): void;
}

export interface CustomDeckWorkspaceOptions {
  identityReady: boolean;
  owner: { id: string | null; remoteAvailable: boolean };
  remoteDecks: readonly string[] | null;
  remoteCoverPresets?: Record<string, CoverPreset> | null;
  cards: readonly CardData[];
  activeDeck: string;
  knownLibraryTotal: number;
  mutations: CustomDeckMutationPort;
  cache?: CustomDeckCachePort;
  ports: {
    assignCard(cardId: string, deckName: string | null): Promise<void>;
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
  coverPresets: Record<string, CoverPreset>;
  newDeckInput: string;
}

export interface CustomDeckWorkspaceActions {
  changeNewDeckInput(value: string): void;
  createDeck(name: string, preset?: CoverPreset): Promise<void>;
  deleteDeck(name: string): Promise<void>;
  assignDeck(cardId: string, deckName: string | null): Promise<void>;
}

type DeckOwnerScope = string | null | undefined;

interface ScopedDeckState {
  ownerScope: DeckOwnerScope;
  decks: string[];
  coverPresets: Record<string, CoverPreset>;
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
        ...normalizeCustomDeckProfile({ decks: JSON.parse(
          globalThis.localStorage?.getItem(legacyDeckCacheKey) ?? '[]',
        ) }),
      };
    } catch {
      return { ownerId: null, decks: [], coverPresets: {} };
    }
  },
  write: (ownerId, decks, coverPresets = {}) => {
    try {
      globalThis.localStorage?.setItem(
        ownerScopedDeckCacheKey,
        serializeOwnerScopedDeckCache(ownerId, decks, coverPresets),
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
  if (remoteDecks) return normalizeCustomDeckProfile({ decks: remoteDecks }).decks;
  const cached = cache.read();
  return cached.ownerId === ownerId
    ? normalizeCustomDeckProfile(cached).decks
    : [];
}

export function readCachedDeckProfileForIdentity(
  cache: CustomDeckCachePort,
  identityReady: boolean,
  ownerId: string | null,
  remoteDecks: readonly string[] | null,
  remoteCoverPresets: Record<string, CoverPreset> | null | undefined,
) {
  if (!identityReady || !ownerId) return normalizeCustomDeckProfile({});
  if (remoteDecks) return normalizeCustomDeckProfile({ decks: remoteDecks, coverPresets: remoteCoverPresets });
  const cached = cache.read();
  return cached.ownerId === ownerId ? normalizeCustomDeckProfile(cached) : normalizeCustomDeckProfile({});
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
    ...readCachedDeckProfileForIdentity(
      cache,
      options.identityReady,
      options.owner.id,
      options.remoteDecks,
      options.remoteCoverPresets,
    ),
  }));
  const deckStateRef = useRef(deckState);
  deckStateRef.current = deckState;
  const decks = deckState.ownerScope === ownerScope
    ? deckState.decks
    : readCachedDecksForIdentity(
      cache,
      options.identityReady,
      options.owner.id,
      options.remoteDecks,
    );
  const coverPresets = deckState.ownerScope === ownerScope
    ? deckState.coverPresets
    : readCachedDeckProfileForIdentity(cache, options.identityReady, options.owner.id, options.remoteDecks, options.remoteCoverPresets).coverPresets;
  const [newDeckInput, setNewDeckInput] = useState('');

  useEffect(() => {
    const next = {
      ownerScope,
      ...readCachedDeckProfileForIdentity(
        cache,
        options.identityReady,
        options.owner.id,
        options.remoteDecks,
        options.remoteCoverPresets,
      ),
    };
    deckStateRef.current = next;
    setDeckState(next);
  }, [cache, options.identityReady, options.owner.id, options.remoteDecks, options.remoteCoverPresets, ownerScope]);

  useEffect(() => {
    const ownerId = options.owner.id;
    if (
      !ownerId
      || options.remoteDecks === null
      || ownerScope !== ownerId
      || deckState.ownerScope !== ownerScope
    ) return;
    cache.write(ownerId, deckState.decks, deckState.coverPresets);
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
    createDeck: async (name, preset = defaultCoverPreset) => {
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
          await current.mutations.add(current.owner.id, plan.name, preset);
        } catch (cause) {
          if (!isCurrentOwner() || !latestRef.current.owner.remoteAvailable) return;
          current.ports.warn('Custom deck profile could not be updated.', cause);
          current.ports.reportError(deckCreationFailureMessage);
          throw new Error(deckCreationFailureMessage);
        }
        if (!isCurrentOwner() || !latestRef.current.owner.remoteAvailable) return;
      }
      if (!isCurrentOwner()) return;
      const previous = deckStateRef.current;
      if (previous.ownerScope !== ownerScope) return;
      const next = {
        ownerScope,
        ...normalizeCustomDeckProfile({
          decks: [...previous.decks, plan.name],
          coverPresets: { ...previous.coverPresets, [customDeckCoverKey(plan.name)]: preset },
        }),
      };
      deckStateRef.current = next;
      setDeckState(next);
      cacheRef.current.write(current.owner.id, next.decks, next.coverPresets);
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
      const remoteOwnerId = current.owner.id;
      const remoteAccessAvailable = () => Boolean(
        remoteOwnerId
        && isCurrentOwner()
        && latestRef.current.owner.id === remoteOwnerId
        && latestRef.current.owner.remoteAvailable,
      );
      const applyLocalResult = () => {
        if (!isCurrentOwner()) return;
        const nextCoverPresets = normalizeCustomDeckProfile({ decks: updated, coverPresets }).coverPresets;
        const next = { ownerScope, decks: updated, coverPresets: nextCoverPresets };
        deckStateRef.current = next;
        setDeckState(next);
        cacheRef.current.write(current.owner.id, updated, nextCoverPresets);
        current.ports.publishCards(changedIds, { customDeck: null });
        current.ports.publishPractice(changedIds, { customDeck: null });
        if (current.activeDeck === deckName) current.ports.chooseAllDecks();
      };

      let assignmentsCleared = false;
      let deckProfileRemoved = false;
      if (remoteOwnerId && current.owner.remoteAvailable) {
        try {
          if (!remoteAccessAvailable()) return;
          await current.mutations.clearAssignments(remoteOwnerId, deckName);
          assignmentsCleared = true;
          if (!remoteAccessAvailable()) return;
          await current.mutations.removeProfile(remoteOwnerId, deckName);
          deckProfileRemoved = true;
          if (!isCurrentOwner() || !remoteAccessAvailable()) return;
        } catch (cause) {
          if (!isCurrentOwner() || !remoteAccessAvailable()) return;
          current.ports.warn('Deck deletion could not complete atomically.', cause);
          const recovery = planDeckDeletionFailureRecovery(assignmentsCleared, deckProfileRemoved);
          current.ports.recoverCloud(remoteOwnerId, recovery.message);
          if (recovery.applyLocalResult) {
            applyLocalResult();
            return;
          }
          current.ports.reportError(deckDeletionFailureMessage);
          throw new Error(deckDeletionFailureMessage);
        }
      }
      if (!isCurrentOwner()) return;
      if (remoteOwnerId && current.owner.remoteAvailable && !remoteAccessAvailable()) return;
      applyLocalResult();
    },
  }), [coverPresets, decks, ownerScope, ownerVersion]);

  return { model: { decks, coverPresets, newDeckInput }, actions };
}
