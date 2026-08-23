import type { DocumentData, DocumentReference, DocumentSnapshot, Firestore, Transaction } from 'firebase-admin/firestore';
import { describe, expect, it } from 'vitest';
import { RateLimitExceededError } from '../src/rateLimiter.js';
import { consumeServiceBudget, withServiceBudget } from '../src/serviceBudget.js';

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
  it('shares one service budget across different users', async () => {
    const database = createDatabase();
    const consumeForUser = (_userId: string) => consumeServiceBudget(database, 'gemini', 2, 1_000);

    await consumeForUser('user-a');
    await consumeForUser('user-b');
    await expect(consumeForUser('user-c')).rejects.toBeInstanceOf(RateLimitExceededError);
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
});
