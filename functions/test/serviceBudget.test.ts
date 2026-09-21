import { readFileSync } from 'node:fs';
import type { DocumentData, DocumentReference, DocumentSnapshot, Firestore, Transaction } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { describe, expect, it, vi } from 'vitest';
import { RateLimitExceededError } from '../src/rateLimiter.js';
import { createReviewCardHandler, toRateLimitHttpsError } from '../src/index.js';
import {
  consumeOwnerAndServiceBudget,
  consumeServiceBudget,
  withServiceBudget,
} from '../src/serviceBudget.js';

const createDatabase = () => {
  const documents = new Map<string, DocumentData>();
  const database = {
    collection: (name: string) => ({
      doc: (id: string) => ({ path: `${name}/${id}` }),
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
 it('applies aggregate service ceilings to every resource mutation callable', () => {
 const source = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');
 for (const [callable, scope] of [
 ['saveGamification', 'gamification-save-service'],
 ['updateLibraryFacets', 'library-facets-update-service'],
 ['createCard', 'card-create-service'],
 ['revokeSharedDeck', 'shared-deck-revoke-service'],
 ['migrateLegacyLibrary', 'legacy-library-migration-service'],
 ] as const) {
 const start = source.indexOf(`export const ${callable} =`);
 const end = source.indexOf('\nexport const ', start + 1);
 expect(start).toBeGreaterThan(-1);
 expect(source.slice(start, end === -1 ? source.length : end)).toContain(`'${scope}'`);
 }
 });

 it('applies the aggregate review service ceiling before persistence', async () => {
   const consumeBudget = vi.fn(async () => undefined);
   const applyReviewForOwner = vi.fn(async () => ({ applied: true }));
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
     'card-review-service',
     expect.any(Number),
   );
   expect(consumeBudget.mock.invocationCallOrder[0])
     .toBeLessThan(applyReviewForOwner.mock.invocationCallOrder[0]);
 });

 it('shares each paid-provider budget across different owners', async () => {
  for (const scope of [
    'gemini',
    'image-provider',
    'shared-deck-create-service',
    'gamification-save-service',
    'library-facets-update-service',
    'card-create-service',
    'card-review-service',
    'shared-deck-revoke-service',
    'legacy-library-migration-service',
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
});
