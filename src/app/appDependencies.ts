import type { CardData } from '../types/card';
import type { LibraryFacets } from '../lib/cardRepository';
import {
  applyCategoryDeltas,
  countCards,
  fetchAllCardsOnDemand,
  fetchCardPage,
  fetchPracticeCards,
} from '../lib/cardRepository';
import { withTimeout } from '../lib/async';
import { app, db, isFirebaseConfigured } from '../lib/firebase';
import {
  createOwnerDeckMutationFirebaseAdapter,
  createOwnerLibrarySessionFirebaseAdapter,
} from '../features/librarySession/ownerLibrarySessionFirebaseAdapter';
import { createLibrarySessionHookDependencies } from '../features/librarySession/useLibrarySession';
import { useIdentitySession } from '../features/session/useIdentitySession';
import { createSharedDeckFirebaseAdapter } from '../features/sharing/sharedDeckFirebaseAdapter';
import type {
  SharedDeckAdapter,
  SharedDeckCardBatch,
} from '../features/sharing/sharedDeckSessionController';
import { firebaseGamificationStore } from '../features/gamification/firebaseGamificationStore';
import { isQuotaError } from '../features/library/libraryStorage';
import { defaultLearningPersistenceHook } from '../features/learning/learningWorkspacePersistenceAdapter';
import { useCardIntakePort } from '../features/intake/useCardIntakePort';

const cloudAvailable = isFirebaseConfigured && db !== null;
const SHARE_CATEGORY_QUERY_TIMEOUT_MS = 20_000;

const libraryHooks = createLibrarySessionHookDependencies(
  () => useIdentitySession({ app, database: db, configured: isFirebaseConfigured }),
);

const ownerLibrary = createOwnerLibrarySessionFirebaseAdapter({
  app,
  database: db,
  configured: isFirebaseConfigured,
});

const ownerDecks = createOwnerDeckMutationFirebaseAdapter(db);

const sharedDeck = createSharedDeckFirebaseAdapter({
  app,
  database: db,
  configured: isFirebaseConfigured,
});

const updateCategoryFacets = async (
  ownerId: string | null,
  deltas: Record<string, number>,
): Promise<LibraryFacets | null> => {
  if (!cloudAvailable || !db || !ownerId || Object.keys(deltas).length === 0) return null;
  return applyCategoryDeltas(db, ownerId, deltas);
};

const practiceDatabase = cloudAvailable ? db : null;
const practicePool = practiceDatabase ? {
  load: async (ownerId: string, maximum: number, options: { includeFuture: boolean }) =>
    fetchPracticeCards(practiceDatabase, ownerId, maximum, { includeFuture: options.includeFuture }),
  classifyFailure: (error: unknown) => isQuotaError(error) ? 'quota' as const : 'unavailable' as const,
} : null;

const loadAllCards = async (ownerId: string | null): Promise<CardData[] | null> => {
  if (!cloudAvailable || !db || !ownerId) return null;
  return fetchAllCardsOnDemand(db, ownerId);
};

const loadCategoryCards = async (
  ownerId: string | null,
  category: string,
): Promise<SharedDeckCardBatch> => {
  if (!cloudAvailable || !db || !ownerId) {
    return { cards: [], total: 0, hasNext: false };
  }
  const filters = {
    category: category === 'All' ? null : category,
    customDeck: null,
    difficulty: null,
    partOfSpeech: null,
    bookmarkedOnly: false,
    createdDate: null,
    wordPrefix: '',
  };
  const page = await withTimeout(fetchCardPage({
    db,
    userId: ownerId,
    filters,
    pageSize: 100,
  }), SHARE_CATEGORY_QUERY_TIMEOUT_MS);
  const total = page.hasNext
    ? await withTimeout(
      countCards(db, ownerId, filters),
      SHARE_CATEGORY_QUERY_TIMEOUT_MS,
    )
    : page.items.length;
  return {
    cards: page.items,
    total: Math.max(total, page.items.length),
    hasNext: page.hasNext,
  };
};

export const appDependencies = {
  configuration: {
    cloudConfigured: isFirebaseConfigured,
    cloudAvailable,
  },
  sessions: {
    libraryHooks,
    learningWorkspace: { usePersistence: defaultLearningPersistenceHook },
    intakeSharing: { useIntakePort: useCardIntakePort },
  },
  adapters: {
    ownerLibrary,
    ownerDecks,
    sharedDeck,
  },
  library: {
    updateCategoryFacets,
    loadAllCards,
    loadMultilingualCards: async (ownerId: string | null, maximum = 100) => {
      if (!cloudAvailable || !db || !ownerId) return null;
      const { createMultilingualFirebaseReader } = await import(
        '../features/multilingual/multilingualFirebaseReader'
      );
      return createMultilingualFirebaseReader(db).readOwnerLibrary(ownerId, maximum);
    },
  },
  catalog: {
    loadLearningStates: async (ownerId: string | null, maximum = 10_000) => {
      if (!cloudAvailable || !db || ownerId === null) {
        return null;
      }
      const { createCatalogLearningStateFirebaseReader } = await import(
        '../features/multilingual/catalogLearningStateFirebaseReader'
      );
      return createCatalogLearningStateFirebaseReader(db).read(ownerId, maximum);
    },
  },
  practice: {
    pool: practicePool,
    gamification: firebaseGamificationStore,
  },
  intake: {
    forOwner: (ownerId: string | null): {
      adapter: SharedDeckAdapter;
      loadCards(category: string): Promise<SharedDeckCardBatch>;
    } => ({
      adapter: sharedDeck,
      loadCards: category => loadCategoryCards(ownerId, category),
    }),
  },
};
