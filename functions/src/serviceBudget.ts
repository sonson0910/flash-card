import type { Firestore } from 'firebase-admin/firestore';
import { consumePersistentRateLimit, consumePersistentRateLimits } from './rateLimiter.js';

const SERVICE_BUDGET_OWNER_ID = '__service__';

export const consumeServiceBudget = async (
  database: Firestore,
  scope: string,
  maximum: number,
  now = Date.now(),
): Promise<void> => {
  await consumePersistentRateLimit(database, SERVICE_BUDGET_OWNER_ID, scope, maximum, now);
};

export const consumeOwnerAndServiceBudget = async (
  database: Firestore,
  ownerId: string,
  ownerScope: string,
  ownerMaximum: number,
  serviceScope: string,
  serviceMaximum: number,
  now = Date.now(),
): Promise<void> => {
  await consumePersistentRateLimits(database, [
    { userId: ownerId, scope: ownerScope, maximum: ownerMaximum },
    { userId: SERVICE_BUDGET_OWNER_ID, scope: serviceScope, maximum: serviceMaximum },
  ], now);
};

export const withServiceBudget = async <T>(
  consumeBudget: () => Promise<unknown>,
  operation: () => Promise<T>,
): Promise<T> => {
  await consumeBudget();
  return operation();
};
