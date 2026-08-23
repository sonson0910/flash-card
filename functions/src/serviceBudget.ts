import type { Firestore } from 'firebase-admin/firestore';
import { consumePersistentRateLimit } from './rateLimiter.js';

const SERVICE_BUDGET_OWNER_ID = '__service__';

export const consumeServiceBudget = async (
  database: Firestore,
  scope: string,
  maximum: number,
  now = Date.now(),
): Promise<void> => {
  await consumePersistentRateLimit(database, SERVICE_BUDGET_OWNER_ID, scope, maximum, now);
};
