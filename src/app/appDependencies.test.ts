import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const readOwnerLibrary = vi.fn();
  const multilingualReader = { readOwnerLibrary };
  return {
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
    readOwnerLibrary,
    multilingualReader,
    createMultilingualReader: vi.fn(() => multilingualReader),
    loadCatalogLearningStates: vi.fn(),
    catalogLearningStateReader: null as null | { read: ReturnType<typeof vi.fn> },
    installCatalog: vi.fn(),
    queryCatalog: vi.fn(),
    hydrateCatalog: vi.fn(),
    useIdentitySession: vi.fn(() => ({ kind: 'identity-session' })),
  };
});

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

vi.mock('../features/multilingual/multilingualFirebaseReader', () => ({
  createMultilingualFirebaseReader: mocks.createMultilingualReader,
}));

vi.mock('../features/multilingual/catalogLearningStateFirebaseReader', () => ({
  createCatalogLearningStateFirebaseReader: vi.fn(() => {
    const reader = { read: mocks.loadCatalogLearningStates };
    mocks.catalogLearningStateReader = reader;
    return reader;
  }),
}));

vi.mock('./catalogRuntime', () => ({
  hydrateInstalledCatalog: mocks.hydrateCatalog,
  installSameOriginCatalog: mocks.installCatalog,
  queryInstalledCatalog: mocks.queryCatalog,
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

  it('binds the validated multilingual reader through the production composition root', async () => {
    const result = { cards: [{ id: 'v3-card' }], rejected: [] };
    mocks.readOwnerLibrary.mockResolvedValue(result);

    await expect(appDependencies.library.loadMultilingualCards('owner-1', 40))
      .resolves.toEqual(result);
    expect(mocks.createMultilingualReader).toHaveBeenCalledWith(mocks.database);
    expect(mocks.readOwnerLibrary).toHaveBeenCalledWith('owner-1', 40);
  });

  it('lazy-loads catalog delivery and indexed queries through the composition root', async () => {
    const manifest = { manifestVersion: 1, releaseId: 'release-1' };
    const query = { catalogId: 'english', language: 'en', trackId: 'ielts' };
    mocks.installCatalog.mockResolvedValue({ releaseId: 'release-1', installedMemberships: 300 });
    mocks.queryCatalog.mockResolvedValue({ items: [{ membershipId: 'membership-1' }] });
    mocks.hydrateCatalog.mockResolvedValue([{ membership: { membershipId: 'membership-1' }, lexeme: { id: 'lexeme-1' } }]);

    await expect(appDependencies.catalog.install(manifest)).resolves.toEqual({
      releaseId: 'release-1',
      installedMemberships: 300,
    });
    await expect(appDependencies.catalog.query(query)).resolves.toEqual({
      items: [{ membershipId: 'membership-1' }],
    });
    await expect(appDependencies.catalog.hydrate('english', [{
      membershipId: 'membership-1', lexemeId: 'lexeme-1', language: 'en', trackId: 'ielts',
      tier: 'foundation', cefrLevel: 'A1', topic: 'education', partOfSpeech: 'noun',
      skills: ['reading'], rank: 1, normalizedLemma: 'word', lemma: 'Word',
    }])).resolves.toEqual([
      { membership: { membershipId: 'membership-1' }, lexeme: { id: 'lexeme-1' } },
    ]);
    expect(mocks.installCatalog).toHaveBeenCalledWith(manifest);
    expect(mocks.queryCatalog).toHaveBeenCalledWith(query);
    expect(mocks.hydrateCatalog).toHaveBeenCalledWith('english', [expect.objectContaining({
      membershipId: 'membership-1', lexemeId: 'lexeme-1',
    })]);
  });

  it('lazy-loads the owner-bound catalog Learning State reader without a catalog join', async () => {
    const states = new Map([['lexeme-1', { lexemeId: 'lexeme-1' }]]);
    mocks.loadCatalogLearningStates.mockResolvedValue({ states, rejected: 0 });

    await expect(appDependencies.catalog.loadLearningStates('owner-1', 500))
      .resolves.toEqual({ states, rejected: 0 });
    expect(mocks.loadCatalogLearningStates).toHaveBeenCalledWith('owner-1', 500);

    await expect(appDependencies.catalog.loadLearningStates(null, 500))
      .resolves.toBeNull();
    expect(mocks.loadCatalogLearningStates).toHaveBeenCalledTimes(1);
  });

  it('keeps catalog cache and pilot code out of eager composition imports', () => {
    const source = readFileSync(new URL('./appDependencies.ts', import.meta.url), 'utf8');

    expect(source).toContain("await import('./catalogRuntime')");
    expect(source).not.toMatch(/^import(?!\s+type).*catalog(?:Cache|Pipeline|Runtime)/m);
    expect(source).not.toContain('pilotCatalog');
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
    await expect(appDependencies.library.loadMultilingualCards(null)).resolves.toBeNull();
    await expect(appDependencies.intake.forOwner(null).loadCards('All')).resolves.toEqual([]);
    expect(mocks.applyCategoryDeltas).not.toHaveBeenCalled();
    expect(mocks.fetchPracticeCards).not.toHaveBeenCalled();
    expect(mocks.fetchAllCardsOnDemand).not.toHaveBeenCalled();
    expect(mocks.fetchCardPage).not.toHaveBeenCalled();
  });
});
