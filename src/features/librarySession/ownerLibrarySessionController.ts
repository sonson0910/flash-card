import { normalizeCustomDeckCollection } from '../library/customDecks';
import { planCardsForSignedInSession } from '../../lib/sessionCards';
import type { CardData } from '../../types/card';

export interface OwnerLibraryCache {
  readCards(): { ownerId: string | null; cards: CardData[] };
  writeCards(ownerId: string, cards: CardData[]): void;
  discardCards(): void;
  readDecks(): { ownerId: string | null; decks: string[] };
  writeDecks(ownerId: string, decks: string[]): void;
  discardDecks(): void;
  hasCompletedLegacyMigration(ownerId: string): boolean;
  markLegacyMigrationComplete(ownerId: string): void;
}

export interface OwnerLibrarySessionAdapter {
  readonly available: boolean;
  queueCardMigration(ownerId: string, cards: CardData[], libraryEpoch: number): Promise<void>;
  seedDeckProfile(ownerId: string, decks: string[]): Promise<void>;
  subscribeDeckProfile(
    ownerId: string,
    onDecks: (decks: unknown[] | null) => void,
    onError: (error: unknown) => void,
  ): () => void;
  countPageableCards(ownerId: string): Promise<number>;
  migrateLegacyCards(ownerId: string, batchSize: number): Promise<{ migrated: number; complete: boolean }>;
}

export interface OwnerLibrarySessionSnapshot {
  ownerId: string | null;
  cards: CardData[];
  decks: string[];
  legacyPending: number;
  isMigratingLegacy: boolean;
  status: 'idle' | 'adopting' | 'ready' | 'error';
  error: string | null;
}

export interface OwnerLibraryActivation {
  ownerId: string | null;
  libraryEpoch: number | null;
  cloudTotal: number;
}

export type LegacyMigrationActionResult =
  | { status: 'completed'; migrated: number; complete: boolean }
  | { status: 'busy' | 'unavailable' }
  | { status: 'failed'; error: unknown };

const EMPTY_SNAPSHOT: OwnerLibrarySessionSnapshot = {
  ownerId: null,
  cards: [],
  decks: [],
  legacyPending: 0,
  isMigratingLegacy: false,
  status: 'idle',
  error: null,
};

export function createOwnerLibrarySessionController({
  adapter,
  cache,
}: {
  adapter: OwnerLibrarySessionAdapter;
  cache: OwnerLibraryCache;
}) {
  let snapshot = EMPTY_SNAPSHOT;
  let generation = 0;
  let unsubscribeDecks: (() => void) | null = null;
  let activeMigration: symbol | null = null;
  let pendingAdoptedCards: { ownerId: string; cards: CardData[] } | null = null;
  const listeners = new Set<(snapshot: OwnerLibrarySessionSnapshot) => void>();

  const publish = (patch: Partial<OwnerLibrarySessionSnapshot>) => {
    snapshot = { ...snapshot, ...patch };
    listeners.forEach(listener => listener(snapshot));
  };

  const active = (ownerId: string, activationGeneration: number) =>
    generation === activationGeneration && snapshot.ownerId === ownerId;

  const stop = () => {
    generation += 1;
    activeMigration = null;
    unsubscribeDecks?.();
    unsubscribeDecks = null;
    snapshot = EMPTY_SNAPSHOT;
    listeners.forEach(listener => listener(snapshot));
  };

  const activate = ({ ownerId, libraryEpoch, cloudTotal }: OwnerLibraryActivation) => {
    stop();
    if (!ownerId) return stop;

    const activationGeneration = generation;
    let cachedCards: { ownerId: string | null; cards: CardData[] } = { ownerId: null, cards: [] };
    let cachedDecks: { ownerId: string | null; decks: string[] } = { ownerId: null, decks: [] };
    try {
      cachedCards = cache.readCards();
      cachedDecks = cache.readDecks();
    } catch {
      // Storage denial is treated as an empty cache; cloud state remains usable.
    }

    const cardPlan = planCardsForSignedInSession(cachedCards.cards, cachedCards.ownerId, ownerId);
    const normalizedDecks = normalizeCustomDeckCollection(cachedDecks.decks);
    const deckPlan = planCardsForSignedInSession(normalizedDecks, cachedDecks.ownerId, ownerId);

    try {
      if (cardPlan.discardLocalCache) cache.discardCards();
      cache.writeCards(ownerId, cardPlan.visibleCards);
      if (deckPlan.discardLocalCache) cache.discardDecks();
      cache.writeDecks(ownerId, deckPlan.visibleCards);
    } catch {
      // The in-memory owner boundary is authoritative when browser storage is denied.
    }

    publish({
      ownerId,
      cards: cardPlan.visibleCards,
      decks: deckPlan.visibleCards,
      legacyPending: 0,
      isMigratingLegacy: false,
      status: 'adopting',
      error: null,
    });

    if (cardPlan.cardsToMigrate.length > 0) {
      pendingAdoptedCards = { ownerId, cards: cardPlan.cardsToMigrate };
    } else if (pendingAdoptedCards?.ownerId !== ownerId) {
      pendingAdoptedCards = null;
    }

    if (!adapter.available) {
      publish({ status: 'ready' });
      return stop;
    }

    let deckSeedRequested = false;
    const seedDecks = (decks: string[]) => {
      if (deckSeedRequested || decks.length === 0) return Promise.resolve();
      deckSeedRequested = true;
      return adapter.seedDeckProfile(ownerId, decks).catch(() => {
        if (active(ownerId, activationGeneration)) {
          publish({ status: 'error', error: 'Could not migrate the local deck profile.' });
        }
      });
    };

    unsubscribeDecks = adapter.subscribeDeckProfile(ownerId, decks => {
      if (!active(ownerId, activationGeneration)) return;
      if (decks === null) {
        void seedDecks(snapshot.decks);
        return;
      }
      const normalized = normalizeCustomDeckCollection(decks);
      try { cache.writeDecks(ownerId, normalized); } catch { /* keep in-memory cloud value */ }
      publish({ decks: normalized });
    }, () => {
      if (active(ownerId, activationGeneration)) {
        publish({ status: 'error', error: 'Could not subscribe to the deck profile.' });
      }
    });

    const adoptedCards = pendingAdoptedCards?.ownerId === ownerId && libraryEpoch !== null
      ? pendingAdoptedCards.cards
      : [];
    const cardMigration = adoptedCards.length > 0
      ? adapter.queueCardMigration(ownerId, adoptedCards, libraryEpoch as number).then(() => {
          if (pendingAdoptedCards?.ownerId === ownerId) pendingAdoptedCards = null;
        }).catch(() => {
          if (active(ownerId, activationGeneration)) {
            publish({ status: 'error', error: 'Could not queue the local cards for migration.' });
          }
        })
      : Promise.resolve();
    const deckMigration = deckPlan.cardsToMigrate.length > 0
      ? seedDecks(deckPlan.cardsToMigrate)
      : Promise.resolve();

    const countLegacy = async () => {
      if (cache.hasCompletedLegacyMigration(ownerId)) return 0;
      const pageable = await adapter.countPageableCards(ownerId);
      const pending = Math.max(0, Math.max(0, cloudTotal) - Math.max(0, pageable));
      if (pending === 0) {
        try { cache.markLegacyMigrationComplete(ownerId); } catch { /* cache is optional */ }
      }
      return pending;
    };

    void Promise.all([cardMigration, deckMigration, countLegacy()]).then(([, , legacyPending]) => {
      if (!active(ownerId, activationGeneration)) return;
      publish({ legacyPending, status: snapshot.status === 'error' ? 'error' : 'ready' });
    }).catch(() => {
      if (!active(ownerId, activationGeneration)) return;
      publish({ status: 'error', error: 'Could not load the legacy card status.' });
    });

    return () => {
      if (active(ownerId, activationGeneration)) stop();
    };
  };

  const migrateLegacy = async (batchSize = 100): Promise<LegacyMigrationActionResult> => {
    const ownerId = snapshot.ownerId;
    if (!ownerId || !adapter.available) return { status: 'unavailable' };
    if (activeMigration) return { status: 'busy' };
    const migrationGeneration = generation;
    const migrationToken = Symbol(ownerId);
    activeMigration = migrationToken;
    publish({ isMigratingLegacy: true, error: null });
    try {
      const result = await adapter.migrateLegacyCards(ownerId, batchSize);
      if (active(ownerId, migrationGeneration)) {
        const legacyPending = result.complete ? 0 : Math.max(0, snapshot.legacyPending - result.migrated);
        if (result.complete) {
          try { cache.markLegacyMigrationComplete(ownerId); } catch { /* cache is optional */ }
        }
        publish({ legacyPending, status: 'ready' });
      }
      return { status: 'completed', ...result };
    } catch (error) {
      if (active(ownerId, migrationGeneration)) {
        publish({ status: 'error', error: 'Could not optimise this legacy card batch.' });
      }
      return { status: 'failed', error };
    } finally {
      if (active(ownerId, migrationGeneration)) publish({ isMigratingLegacy: false });
      if (activeMigration === migrationToken) activeMigration = null;
    }
  };

  return {
    activate,
    stop,
    migrateLegacy,
    getSnapshot: () => snapshot,
    subscribe: (listener: (snapshot: OwnerLibrarySessionSnapshot) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
