import type { CardData } from '../types/card';
import type { LibraryFacets } from '../lib/cardRepository';
import {
  applyCategoryDeltas,
  fetchAllCardsOnDemand,
  fetchCardPage,
  fetchPracticeCards,
} from '../lib/cardRepository';
import { app, db, isFirebaseConfigured } from '../lib/firebase';
import {
  createOwnerDeckMutationFirebaseAdapter,
  createOwnerLibrarySessionFirebaseAdapter,
} from '../features/librarySession/ownerLibrarySessionFirebaseAdapter';
import { createLibrarySessionHookDependencies } from '../features/librarySession/useLibrarySession';
import { useIdentitySession } from '../features/session/useIdentitySession';
import { createSharedDeckFirebaseAdapter } from '../features/sharing/sharedDeckFirebaseAdapter';
import type { SharedDeckAdapter } from '../features/sharing/sharedDeckSessionController';

const cloudAvailable = isFirebaseConfigured && db !== null;

const libraryHooks = createLibrarySessionHookDependencies(
  () => useIdentitySession({ app, configured: isFirebaseConfigured }),
);

const ownerLibrary = createOwnerLibrarySessionFirebaseAdapter({
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

const loadPracticeCards = async (
  ownerId: string | null,
  maximum: number,
  includeFuture: boolean,
): Promise<CardData[] | null> => {
  if (!cloudAvailable || !db || !ownerId) return null;
  return fetchPracticeCards(db, ownerId, maximum, { includeFuture });
};

const loadAllCards = async (ownerId: string | null): Promise<CardData[] | null> => {
  if (!cloudAvailable || !db || !ownerId) return null;
  return fetchAllCardsOnDemand(db, ownerId);
};

const loadCategoryCards = async (
  ownerId: string | null,
  category: string,
): Promise<readonly CardData[]> => {
  if (!cloudAvailable || !db || !ownerId) return [];
  const page = await fetchCardPage({
    db,
    userId: ownerId,
    filters: {
      category: category === 'All' ? null : category,
      customDeck: null,
      difficulty: null,
      partOfSpeech: null,
      bookmarkedOnly: false,
      createdDate: null,
      wordPrefix: '',
    },
    pageSize: 100,
  });
  return page.items;
};

export const appDependencies = {
  configuration: {
    cloudConfigured: isFirebaseConfigured,
    cloudAvailable,
  },
  sessions: {
    libraryHooks,
  },
  adapters: {
    ownerLibrary,
    ownerDecks,
    sharedDeck,
  },
  library: {
    updateCategoryFacets,
    loadPracticeCards,
    loadAllCards,
  },
  intake: {
    forOwner: (ownerId: string | null): {
      adapter: SharedDeckAdapter;
      loadCards(category: string): Promise<readonly CardData[]>;
    } => ({
      adapter: sharedDeck,
      loadCards: category => loadCategoryCards(ownerId, category),
    }),
  },
};
