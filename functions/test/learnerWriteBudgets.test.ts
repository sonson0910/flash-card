import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The hourly budgets run through the real rate-limit decision code against an in-memory
// document store, so owner and shared counters behave as they do in Firestore. Only the
// persistence behind each callable is replaced; no Firestore or emulator is needed.
const budgetDocuments = vi.hoisted(() => new Map<string, Record<string, unknown>>());

vi.mock('../src/rateLimiter.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/rateLimiter.js')>();
  const store = { collection: (name: string) => ({ doc: (id: string) => ({ path: `${name}/${id}` }) }) };
  const consumeMany = async (
    _database: unknown,
    budgets: readonly { userId: string; scope: string; maximum: number }[],
    now = Date.now(),
  ) => {
    const transaction = {
      get: async (document: { path: string }) => ({
        exists: budgetDocuments.has(document.path), data: () => budgetDocuments.get(document.path),
      }),
      set: (document: { path: string }, data: Record<string, unknown>) => { budgetDocuments.set(document.path, data); },
    };
    await actual.consumePersistentRateLimitsInTransaction(transaction as never, store as never, budgets, now);
  };
  return {
    ...actual,
    consumePersistentRateLimits: consumeMany,
    consumePersistentRateLimit: (database: unknown, userId: string, scope: string, maximum: number, now?: number) =>
      consumeMany(database, [{ userId, scope, maximum }], now),
  };
});
vi.mock('../src/accountData.js', async importOriginal => ({
  ...await importOriginal<typeof import('../src/accountData.js')>(),
  isAccountDeleting: vi.fn(async () => false),
  readAccountAccess: vi.fn(async () => ({ deleting: false, profiled: true })),
}));
vi.mock('../src/pilotConfig.js', async importOriginal => ({
  ...await importOriginal<typeof import('../src/pilotConfig.js')>(),
  loadPilotConfig: vi.fn(async () => ({ analyticsEnabled: false })),
}));
vi.mock('../src/reviewPersistence.js', async importOriginal => ({
  ...await importOriginal<typeof import('../src/reviewPersistence.js')>(),
  applyReviewForOwner: vi.fn(async () => ({ applied: true, duplicate: true, card: {} })),
}));
vi.mock('../src/cardPersistence.js', async importOriginal => ({
  ...await importOriginal<typeof import('../src/cardPersistence.js')>(),
  createCardForOwner: vi.fn(async () => ({ created: false, card: {} })),
  createCardV2ForOwner: vi.fn(async () => ({ created: false, card: {} })),
}));
vi.mock('../src/gamificationPersistence.js', async importOriginal => ({
  ...await importOriginal<typeof import('../src/gamificationPersistence.js')>(),
  parseGamificationSaveRequest: vi.fn(() => ({})),
  applyGamificationForOwner: vi.fn(async () => ({ saved: true })),
}));
vi.mock('../src/libraryFacetPersistence.js', async importOriginal => ({
  ...await importOriginal<typeof import('../src/libraryFacetPersistence.js')>(),
  parseLibraryFacetMutationRequest: vi.fn((value: { ownerId: string }) => ({ ownerId: value.ownerId })),
  findLibraryFacetReceipt: vi.fn(async () => null),
  applyLibraryFacetMutation: vi.fn(async () => ({ applied: true })),
}));
vi.mock('../src/sharedDeckPersistence.js', async importOriginal => ({
  ...await importOriginal<typeof import('../src/sharedDeckPersistence.js')>(),
  revokeSharedDeckAtomically: vi.fn(async () => false),
}));
vi.mock('../src/legacyLibraryMigration.js', async importOriginal => ({
  ...await importOriginal<typeof import('../src/legacyLibraryMigration.js')>(),
  runLegacyLibraryDiscovery: vi.fn(async () => ({ status: 'complete' })),
}));

type CallableModule = typeof import('../src/index.js');
type Callable = { run: (request: never) => Promise<unknown> };

const reviewData = (owner: string) => ({
  expectedOwnerId: owner,
  opId: 'device-a:review-1',
  cardId: 'word-focus',
  baseRevision: 3,
  libraryEpoch: 2,
  rating: 'good',
  reviewedAt: '2026-08-24T00:00:00.000Z',
  fields: {
    difficulty: 'good', nextReviewDate: '2026-08-24T00:10:00.000Z', reviews: 1, interval: 0,
    easeFactor: 2.788189603, fsrs: {}, reviewHistory: [], correctStreak: 1,
  },
  fieldMask: ['difficulty', 'nextReviewDate', 'reviews', 'interval', 'easeFactor', 'fsrs', 'reviewHistory', 'correctStreak'],
});
const createData = (owner: string, withTimeZone: boolean) => ({
  opId: 'owner-create-1', operationCreatedAt: '2026-10-15T00:00:00.000Z', expectedOwnerId: owner,
  ...(withTimeZone ? { timeZone: 'UTC' } : {}),
  card: { id: 'hello', word: 'hello', translation: 'xin chào', explanation: 'greeting', phonetic: '',
    category: 'Basics', emoji: '', audioUrl: null, imageUrl: null },
});

// Each row: the callable, its hourly allowance per account, and the request one account sends.
const learnerWrites: readonly [string, number, (module: CallableModule) => Callable, (owner: string) => unknown][] = [
  ['reviewCard', 600, module => module.reviewCard, reviewData],
  ['reviewCardV2', 600, module => module.reviewCardV2, reviewData],
  ['createCard', 120, module => module.createCard, owner => createData(owner, false)],
  ['createCardV2', 120, module => module.createCardV2, owner => createData(owner, true)],
  ['saveGamification', 120, module => module.saveGamification, () => ({})],
  ['updateLibraryFacets', 120, module => module.updateLibraryFacets, owner => ({ ownerId: owner })],
  ['revokeSharedDeck', 120, module => module.revokeSharedDeck, () => ({ shareId: 'missing-share' })],
  ['migrateLegacyLibrary', 30, module => module.migrateLegacyLibrary, () => ({})],
];

describe('Firestore-only learner writes', () => {
  beforeEach(() => {
    budgetDocuments.clear();
    vi.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 10, 23, 3));
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each(learnerWrites)('%s stays available to a learner after other accounts use their whole hourly allowance',
    async (_name, perAccountAllowance, pick, data) => {
      const callable = pick(await import('../src/index.js'));
      const send = (owner: string) => callable.run({ auth: { uid: owner }, data: data(owner) } as never);
      for (let account = 0; account < 20; account += 1) {
        for (let call = 0; call < perAccountAllowance; call += 1) await send(`busy-${account}`);
      }

      await expect(send('busy-0')).rejects.toMatchObject({ code: 'resource-exhausted' });
      await expect(send('quiet-learner')).resolves.toBeDefined();
    }, 60_000);
});
