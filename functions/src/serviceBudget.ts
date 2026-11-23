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

// Every budget is taken in one transaction, so a rejection by any of them,
// the shared one included, leaves the learner's own counters unspent.
export const consumeOwnerBudgetsAndServiceBudget = async (
  database: Firestore,
  ownerId: string,
  ownerBudgets: readonly { scope: string; maximum: number }[],
  serviceScope: string,
  serviceMaximum: number,
  now = Date.now(),
): Promise<void> => {
  await consumePersistentRateLimits(database, [
    ...ownerBudgets.map(budget => ({ userId: ownerId, scope: budget.scope, maximum: budget.maximum })),
    { userId: SERVICE_BUDGET_OWNER_ID, scope: serviceScope, maximum: serviceMaximum },
  ], now);
};

export const consumeOwnerAndServiceBudget = (
  database: Firestore,
  ownerId: string,
  ownerScope: string,
  ownerMaximum: number,
  serviceScope: string,
  serviceMaximum: number,
  now = Date.now(),
): Promise<void> => consumeOwnerBudgetsAndServiceBudget(
  database, ownerId, [{ scope: ownerScope, maximum: ownerMaximum }], serviceScope, serviceMaximum, now,
);

export const withServiceBudget = async <T>(
  consumeBudget: () => Promise<unknown>,
  operation: () => Promise<T>,
): Promise<T> => {
  await consumeBudget();
  return operation();
};
