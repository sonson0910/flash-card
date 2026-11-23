vi.mock('../src/pilotConfig.js', async importOriginal => ({ ...await importOriginal<typeof import('../src/pilotConfig.js')>(), loadPilotConfig: vi.fn(async () => ({ analyticsEnabled: false })) }));
vi.mock('../src/accountData.js', async importOriginal => ({ ...await importOriginal<typeof import('../src/accountData.js')>(), isAccountDeleting: vi.fn(async () => false), readAccountAccess: vi.fn(async () => ({ deleting: false, profiled: true })) }));
import type { DocumentData, DocumentReference, DocumentSnapshot, Firestore, Transaction } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { describe, expect, it, vi } from 'vitest';
import {
  assertPersistentRateLimitAvailable,
  consumePersistentRateLimit,
  consumeRateLimitFailClosed,
  RATE_LIMIT_STORAGE_DEADLINE_MS,
  RateLimitExceededError,
} from '../src/rateLimiter.js';
import { createReviewCardHandler, toRateLimitHttpsError } from '../src/index.js';
import {
  consumeOwnerAndServiceBudget,
  consumeOwnerBudgetsAndServiceBudget,
  consumeServiceBudget,
  withServiceBudget,
} from '../src/serviceBudget.js';

const createDatabase = () => {
  const documents = new Map<string, DocumentData>();
  const database = {
    collection: (name: string) => ({
      doc: (id: string) => ({
        path: `${name}/${id}`,
        get: async () => ({ exists: documents.has(`${name}/${id}`), data: () => documents.get(`${name}/${id}`) }),
      }),
    }),
    runTransaction: async (update: (transaction: Transaction) => Promise<unknown>) => {
      const transaction = {
        get: async (document: DocumentReference) => ({
          exists: documents.has(document.path),
          data: () => documents.get(document.path),
        } as DocumentSnapshot),
        set: (document: DocumentReference, data: DocumentData) => {
          documents.set(document.path, data);
        },
      } as unknown as Transaction;
      return update(transaction);
    },
  } as unknown as Firestore;
  return database;
};

describe('service budgets', () => {
 it('applies the per-account review budget, with no shared service ceiling, before persistence', async () => {
   const consumeBudget = vi.fn(async () => undefined);
   const applyReviewForOwner = vi.fn(async () => ({ applied: true as const, duplicate: false, xpAwarded: 0, card: {} }));
   const handler = createReviewCardHandler(false, { consumeBudget, applyReviewForOwner });

   await handler({
     auth: { uid: 'owner-1' },
     data: {
       expectedOwnerId: 'owner-1',
       opId: 'device-a:review-1',
       cardId: 'word-focus',
       baseRevision: 3,
       libraryEpoch: 2,
       rating: 'good',
       reviewedAt: '2026-08-24T00:00:00.000Z',
       fields: {
         difficulty: 'good',
         nextReviewDate: '2026-08-24T00:10:00.000Z',
         reviews: 1,
         interval: 0,
         easeFactor: 2.788189603,
         fsrs: {},
         reviewHistory: [],
         correctStreak: 1,
       },
       fieldMask: [
         'difficulty', 'nextReviewDate', 'reviews', 'interval', 'easeFactor',
         'fsrs', 'reviewHistory', 'correctStreak',
       ],
     },
   } as never);

   expect(consumeBudget).toHaveBeenCalledWith(
     'owner-1',
     'card-review',
     expect.any(Number),
     expect.any(String),
   );
   expect(consumeBudget.mock.invocationCallOrder[0])
     .toBeLessThan(applyReviewForOwner.mock.invocationCallOrder[0]);
 });

 it('shares each paid-provider budget across different owners', async () => {
  for (const scope of [
    'gemini',
    'image-provider',
    'shared-deck-create-service',
    'pronunciation-assessment-service',
  ]) {
      const database = createDatabase();
      const consumeForUser = (userId: string) => consumeOwnerAndServiceBudget(
        database,
        userId,
        `${scope}-owner`,
        10,
        scope,
        2,
        1_000,
      );

      await consumeForUser('user-a');
      await consumeForUser('user-b');
      await expect(consumeForUser('user-c')).rejects.toBeInstanceOf(RateLimitExceededError);
    }
  });

  it('shares one service budget across different users', async () => {
    const database = createDatabase();
    const consumeForUser = (_userId: string) => consumeServiceBudget(database, 'gemini', 2, 1_000);

    await consumeForUser('user-a');
    await consumeForUser('user-b');
    await expect(consumeForUser('user-c')).rejects.toBeInstanceOf(RateLimitExceededError);
  });

  it('reserves aggregate capacity when one owner reaches its fair share', async () => {
    const database = createDatabase();
    const consume = (ownerId: string) => consumeOwnerAndServiceBudget(
      database, ownerId, 'gemini-owner', 1, 'gemini', 2, 1_000,
    );

    await consume('user-a');
    await expect(consume('user-a')).rejects.toBeInstanceOf(RateLimitExceededError);
    await expect(consume('user-b')).resolves.toBeUndefined();
    await expect(consume('user-c')).rejects.toBeInstanceOf(RateLimitExceededError);
  });

  it('spends none of the learner budgets when the shared budget refuses', async () => {
    const database = createDatabase();
    const ownerBudgets = [{ scope: 'ai-card', maximum: 1 }, { scope: 'gemini-owner', maximum: 1 }];
    await consumeServiceBudget(database, 'gemini', 1, 1_000);

    await expect(consumeOwnerBudgetsAndServiceBudget(database, 'user-a', ownerBudgets, 'gemini', 1, 1_000))
      .rejects.toBeInstanceOf(RateLimitExceededError);

    // A spent counter would refuse this second attempt for the learner's own limit.
    await expect(consumeOwnerBudgetsAndServiceBudget(database, 'user-a', ownerBudgets, 'gemini-other', 1, 1_000))
      .resolves.toBeUndefined();
  });

  it('reads a learner budget without spending it', async () => {
    const database = createDatabase();
    await consumePersistentRateLimit(database, 'user-a', 'ai-tutor', 2, 1_000);

    // Reading never counts: the budget stays at one spent call however often it is read.
    await assertPersistentRateLimitAvailable(database, 'user-a', 'ai-tutor', 2, 1_000);
    await assertPersistentRateLimitAvailable(database, 'user-a', 'ai-tutor', 2, 1_000);
    await consumePersistentRateLimit(database, 'user-a', 'ai-tutor', 2, 1_000);
    await expect(assertPersistentRateLimitAvailable(database, 'user-a', 'ai-tutor', 2, 1_000))
      .rejects.toBeInstanceOf(RateLimitExceededError);
    await expect(assertPersistentRateLimitAvailable(database, 'user-b', 'ai-tutor', 2, 1_000))
      .resolves.toBeUndefined();
  });

  it('requires another aggregate allowance before Unsplash after no usable Pexels results', async () => {
    const database = createDatabase();
    const providers: string[] = [];
    const requestProvider = (provider: string, result: string | null) => withServiceBudget(
      () => consumeServiceBudget(database, 'image-provider', 2, 1_000),
      async () => {
        providers.push(provider);
        return result;
      },
    );

    await expect(requestProvider('pexels', null)).resolves.toBeNull();
    await expect(requestProvider('unsplash', 'https://images.unsplash.com/result'))
      .resolves.toBe('https://images.unsplash.com/result');
    await expect(requestProvider('unsplash', 'https://images.unsplash.com/third'))
      .rejects.toBeInstanceOf(RateLimitExceededError);
    expect(providers).toEqual(['pexels', 'unsplash']);
  });

  it('maps provider aggregate exhaustion to a bounded resource-exhausted callable error', () => {
    const mapped = toRateLimitHttpsError(
      new RateLimitExceededError(Number.MAX_SAFE_INTEGER),
      'Image request limit reached. Try again later.',
    );

    expect(mapped).toBeInstanceOf(HttpsError);
    expect(mapped?.code).toBe('resource-exhausted');
    expect(mapped?.details).toEqual({ retryAfterSeconds: 3_600 });
  });

  it('maps a rate-limit storage timeout to a retryable unavailable error instead of an internal one', async () => {
    vi.useFakeTimers();
    try {
      const pending = consumeRateLimitFailClosed(() => new Promise<void>(() => undefined))
        .catch((error: unknown) => error);
      await vi.advanceTimersByTimeAsync(RATE_LIMIT_STORAGE_DEADLINE_MS + 1);
      const timeout = await pending;

      const mapped = toRateLimitHttpsError(timeout, 'Card review limit reached. Try again later.');

      expect(mapped).toBeInstanceOf(HttpsError);
      expect(mapped?.code).toBe('unavailable');
      expect(mapped?.message).not.toMatch(/limit reached/);
    } finally {
      vi.useRealTimers();
    }
  });
});
