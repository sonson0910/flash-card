import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  database: { kind: 'database' },
  firebaseApp: { kind: 'app' },
  applyCategoryDeltas: vi.fn(),
  fetchAllCardsOnDemand: vi.fn(),
  fetchCardPage: vi.fn(),
  fetchPracticeCards: vi.fn(),
  createLibraryHooks: vi.fn(() => ({ kind: 'library-hooks' })),
  createOwnerLibrary: vi.fn(() => ({ kind: 'owner-library' })),
  createOwnerDecks: vi.fn(() => ({ kind: 'owner-decks' })),
  createSharedDeck: vi.fn(() => ({ kind: 'shared-deck' })),
  useIdentitySession: vi.fn(() => ({ kind: 'identity-session' })),
}));

vi.mock('../lib/firebase', () => ({
  app: mocks.firebaseApp,
  db: mocks.database,
  isFirebaseConfigured: true,
}));

vi.mock('../lib/cardRepository', () => ({
  applyCategoryDeltas: mocks.applyCategoryDeltas,
  fetchAllCardsOnDemand: mocks.fetchAllCardsOnDemand,
  fetchCardPage: mocks.fetchCardPage,
  fetchPracticeCards: mocks.fetchPracticeCards,
}));

vi.mock('../features/librarySession/useLibrarySession', () => ({
  createLibrarySessionHookDependencies: mocks.createLibraryHooks,
}));

vi.mock('../features/librarySession/ownerLibrarySessionFirebaseAdapter', () => ({
  createOwnerLibrarySessionFirebaseAdapter: mocks.createOwnerLibrary,
  createOwnerDeckMutationFirebaseAdapter: mocks.createOwnerDecks,
}));

vi.mock('../features/sharing/sharedDeckFirebaseAdapter', () => ({
  createSharedDeckFirebaseAdapter: mocks.createSharedDeck,
}));

vi.mock('../features/session/useIdentitySession', () => ({
  useIdentitySession: mocks.useIdentitySession,
}));

import { appDependencies } from './appDependencies';

describe('app dependency composition', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exposes configured domain adapters without leaking Firebase handles', () => {
    expect(appDependencies.configuration).toEqual({
      cloudConfigured: true,
      cloudAvailable: true,
    });
    expect(appDependencies.sessions.libraryHooks).toEqual({ kind: 'library-hooks' });
    expect(appDependencies.sessions.learningWorkspace).toHaveProperty('usePersistence');
    expect(appDependencies.sessions.intakeSharing).toHaveProperty('useIntakePort');
    expect(appDependencies.adapters).toEqual({
      ownerLibrary: { kind: 'owner-library' },
      ownerDecks: { kind: 'owner-decks' },
      sharedDeck: { kind: 'shared-deck' },
    });
    expect(appDependencies).not.toHaveProperty('app');
    expect(appDependencies).not.toHaveProperty('db');
  });

  it('keeps infrastructure imports inside the non-presentation composition source', () => {
    const source = readFileSync(new URL('./appDependencies.ts', import.meta.url), 'utf8');

    expect(source).toContain("from '../lib/firebase'");
    expect(source).toContain("from '../lib/cardRepository'");
    expect(source).toContain("from '../features/sharing/sharedDeckFirebaseAdapter'");
    expect(source).not.toMatch(/export\s+\{[^}]*\b(?:app|db)\b[^}]*\}/s);
    expect(source).not.toMatch(/export\s+(?:const|let|var)\s+(?:app|db)\b/);
  });

  it('binds repository operations to the configured database', async () => {
    const facets = { categories: { IELTS: 3 }, complete: true };
    mocks.applyCategoryDeltas.mockResolvedValue(facets);
    mocks.fetchAllCardsOnDemand.mockResolvedValue([{ id: 'export' }]);

    await expect(appDependencies.library.updateCategoryFacets('owner-1', { IELTS: 2 }))
      .resolves.toEqual(facets);
    await expect(appDependencies.library.loadAllCards('owner-1'))
      .resolves.toEqual([{ id: 'export' }]);

    expect(mocks.applyCategoryDeltas).toHaveBeenCalledWith(
      mocks.database,
      'owner-1',
      { IELTS: 2 },
    );
    expect(mocks.fetchAllCardsOnDemand).toHaveBeenCalledWith(mocks.database, 'owner-1');
    expect(appDependencies.library).not.toHaveProperty('loadPracticeCards');
  });

  it('exposes practice loading only through the bounded practice port', async () => {
    mocks.fetchPracticeCards.mockResolvedValue([{ id: 'practice' }]);

    await expect(appDependencies.practice.pool?.load('owner-1', 25, { includeFuture: false }))
      .resolves.toEqual([{ id: 'practice' }]);
    expect(mocks.fetchPracticeCards).toHaveBeenCalledWith(
      mocks.database,
      'owner-1',
      25,
      { includeFuture: false },
    );
  });

  it('creates owner-bound intake sharing dependencies', async () => {
    mocks.fetchCardPage.mockResolvedValue({ items: [{ id: 'shared-card' }] });

    const sharing = appDependencies.intake.forOwner('owner-2');
    await expect(sharing.loadCards('IELTS')).resolves.toEqual([{ id: 'shared-card' }]);
    expect(sharing.adapter).toEqual({ kind: 'shared-deck' });
    expect(mocks.fetchCardPage).toHaveBeenCalledWith({
      db: mocks.database,
      userId: 'owner-2',
      filters: {
        category: 'IELTS',
        customDeck: null,
        difficulty: null,
        partOfSpeech: null,
        bookmarkedOnly: false,
        createdDate: null,
        wordPrefix: '',
      },
      pageSize: 100,
    });
  });

  it('returns safe empty signals when cloud storage or an owner is unavailable', async () => {
    await expect(appDependencies.library.updateCategoryFacets(null, { IELTS: 1 }))
      .resolves.toBeNull();
    await expect(appDependencies.library.loadAllCards(null)).resolves.toBeNull();
    await expect(appDependencies.intake.forOwner(null).loadCards('All')).resolves.toEqual([]);
    expect(mocks.applyCategoryDeltas).not.toHaveBeenCalled();
    expect(mocks.fetchPracticeCards).not.toHaveBeenCalled();
    expect(mocks.fetchAllCardsOnDemand).not.toHaveBeenCalled();
    expect(mocks.fetchCardPage).not.toHaveBeenCalled();
  });
});
