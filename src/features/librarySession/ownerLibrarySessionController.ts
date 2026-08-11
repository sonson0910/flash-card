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
}

export interface LegacyMigrationProgress {
  scanned: number;
  complete: boolean;
}

export interface LegacyMigrationIssue {
  kind: 'temporary' | 'cloud-access' | 'trusted-migration';
  message: string;
  retryable: boolean;
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
  getLegacyMigrationProgress(ownerId: string): Promise<LegacyMigrationProgress>;
  migrateLegacyCards(
    ownerId: string,
    batchSize: number,
  ): Promise<{ migrated: number; scanned: number; complete: boolean }>;
}

export interface OwnerLibrarySessionSnapshot {
  ownerId: string | null;
  cards: CardData[];
  decks: string[];
  legacyPending: number;
  legacyIssue: LegacyMigrationIssue | null;
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
  | { status: 'completed'; migrated: number; scanned: number; complete: boolean }
  | { status: 'busy' | 'unavailable' }
  | { status: 'failed'; error: unknown };

const EMPTY_SNAPSHOT: OwnerLibrarySessionSnapshot = {
  ownerId: null,
  cards: [],
  decks: [],
  legacyPending: 0,
  legacyIssue: null,
  isMigratingLegacy: false,
  status: 'idle',
  error: null,
};

const errorField = (error: unknown, field: 'code' | 'reason'): string => {
  if (!error || typeof error !== 'object' || !(field in error)) return '';
  const value = (error as Record<string, unknown>)[field];
  return typeof value === 'string' ? value.toLowerCase() : '';
};

export function getLegacyMigrationIssue(error: unknown): LegacyMigrationIssue {
  const reason = errorField(error, 'reason');
  if (reason === 'identity-conflict') {
    return {
      kind: 'trusted-migration',
      retryable: false,
      message: 'Some older cards need a secure one-time migration. Your cards are safe; this repair must run from the administrator migration tool.',
    };
  }

  const code = errorField(error, 'code').replace(/^firestore\//, '');
  if (code === 'unauthenticated') {
    return {
      kind: 'cloud-access',
      retryable: true,
      message: 'Sign in again to continue this library upgrade. Your cards remain safe.',
    };
  }
  if (['permission-denied', 'failed-precondition'].includes(code)) {
    return {
      kind: 'cloud-access',
      retryable: false,
      message: 'Cloud access for this library upgrade was rejected. Your cards are safe; an administrator must update Firebase access before this upgrade can continue.',
    };
  }

  return {
    kind: 'temporary',
    retryable: true,
    message: 'The library upgrade could not finish. Your cards are safe; check your connection and retry.',
  };
}

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
  let currentCloudTotal = 0;
  let legacyRefreshToken: symbol | null = null;
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
    currentCloudTotal = Number.isSafeInteger(cloudTotal) && cloudTotal > 0
      ? Math.floor(cloudTotal)
      : 0;

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
      legacyIssue: null,
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
      const total = currentCloudTotal;
      if (total === 0) return 0;
      const progress = await adapter.getLegacyMigrationProgress(ownerId);
      if (progress.complete) return 0;
      const scanned = Number.isSafeInteger(progress.scanned) && progress.scanned > 0
        ? Math.floor(progress.scanned)
        : 0;
      // An exact-size final batch still needs one empty follow-up scan before
      // the server progress can safely be marked complete.
      return Math.max(1, total - scanned);
    };

    void Promise.all([cardMigration, deckMigration, countLegacy()]).then(([, , legacyPending]) => {
      if (!active(ownerId, activationGeneration)) return;
      publish({ legacyPending, status: snapshot.status === 'error' ? 'error' : 'ready' });
    }).catch(error => {
      if (!active(ownerId, activationGeneration)) return;
      publish({ status: 'ready', error: null, legacyIssue: getLegacyMigrationIssue(error) });
    });

    return () => {
      if (active(ownerId, activationGeneration)) stop();
    };
  };

  const updateContext = async ({ ownerId, cloudTotal }: OwnerLibraryActivation): Promise<void> => {
    if (!ownerId || snapshot.ownerId !== ownerId) return;
    const total = Number.isSafeInteger(cloudTotal) && cloudTotal > 0
      ? Math.floor(cloudTotal)
      : 0;
    if (total === currentCloudTotal) return;
    currentCloudTotal = total;
    const refreshGeneration = generation;
    const refreshToken = Symbol(ownerId);
    legacyRefreshToken = refreshToken;
    if (!adapter.available || total === 0) {
      if (active(ownerId, refreshGeneration)) publish({ legacyPending: 0 });
      return;
    }
    try {
      const progress = await adapter.getLegacyMigrationProgress(ownerId);
      if (
        !active(ownerId, refreshGeneration)
        || legacyRefreshToken !== refreshToken
      ) return;
      const scanned = Number.isSafeInteger(progress.scanned) && progress.scanned > 0
        ? Math.floor(progress.scanned)
        : 0;
      publish({
        legacyPending: progress.complete ? 0 : Math.max(1, total - scanned),
        legacyIssue: null,
      });
    } catch (error) {
      if (
        active(ownerId, refreshGeneration)
        && legacyRefreshToken === refreshToken
      ) publish({ legacyIssue: getLegacyMigrationIssue(error) });
    }
  };

  const migrateLegacy = async (batchSize = 100): Promise<LegacyMigrationActionResult> => {
    const ownerId = snapshot.ownerId;
    if (!ownerId || !adapter.available) return { status: 'unavailable' };
    if (activeMigration) return { status: 'busy' };
    const migrationGeneration = generation;
    const migrationToken = Symbol(ownerId);
    activeMigration = migrationToken;
    legacyRefreshToken = null;
    publish({ isMigratingLegacy: true, legacyIssue: null, error: null });
    try {
      const result = await adapter.migrateLegacyCards(ownerId, batchSize);
      if (active(ownerId, migrationGeneration)) {
        const scanned = Number.isSafeInteger(result.scanned) && result.scanned > 0
          ? Math.floor(result.scanned)
          : 0;
        const legacyPending = result.complete
          ? 0
          : Math.max(1, snapshot.legacyPending - scanned);
        publish({ legacyPending, legacyIssue: null, status: 'ready' });
      }
      return { status: 'completed', ...result };
    } catch (error) {
      if (active(ownerId, migrationGeneration)) {
        publish({ status: 'ready', error: null, legacyIssue: getLegacyMigrationIssue(error) });
      }
      return { status: 'failed', error };
    } finally {
      if (active(ownerId, migrationGeneration)) publish({ isMigratingLegacy: false });
      if (activeMigration === migrationToken) activeMigration = null;
    }
  };

  const discardCards = () => {
    pendingAdoptedCards = null;
    try { cache.discardCards(); } catch { /* cache cleanup is best-effort */ }
    publish({ cards: [] });
  };

  return {
    activate,
    updateContext,
    stop,
    migrateLegacy,
    discardCards,
    getSnapshot: () => snapshot,
    subscribe: (listener: (snapshot: OwnerLibrarySessionSnapshot) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
