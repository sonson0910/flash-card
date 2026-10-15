import { randomUUID } from 'node:crypto';
import type { DocumentReference, Firestore } from 'firebase-admin/firestore';
import type { PilotConfig } from './pilotConfig.js';
import { dayKey } from './aiCostLedger.js';

type Plan = { tier: 'free' | 'pro'; periodKey: string; startsAt: Date; endsAt: Date; limit: number };
export type AiOperationRecord = { status?: string; attemptId?: string; periodKey?: string; reservedAt?: unknown; result?: unknown; requestHash?: string };

export class AiQuotaError extends Error {
  constructor(readonly reason: 'ai-card-quota' | 'ai-daily-allowance' | 'operation-in-flight'
    | 'operation-request-mismatch', readonly details: Record<string, unknown>) {
    super(reason);
    this.name = 'AiQuotaError';
  }
}

export const asAiQuotaDate = (value: unknown): Date | null => {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value : null;
  if (value && typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') {
    const date = value.toDate();
    return date instanceof Date && Number.isFinite(date.getTime()) ? date : null;
  }
  return null;
};

export const asAiQuotaCount = (value: unknown): number => {
  if (value === undefined) return 0;
  if (Number.isSafeInteger(value) && Number(value) >= 0) return Number(value);
  throw new Error('AI quota counter is invalid.');
};

export function freePeriod(now: Date, config: PilotConfig): Plan {
  const month = dayKey(now, config.pilotTimezone).slice(0, 7);
  const [year, number] = month.split('-').map(Number);
  return {
    tier: 'free', periodKey: `free-${month}`, limit: config.freeMonthlyAiCards,
    startsAt: new Date(Date.UTC(year, number - 1, 1, -7)),
    endsAt: new Date(Date.UTC(year, number, 1, -7)),
  };
}

export function resolvePlan(value: unknown, now: Date, config: PilotConfig): Plan {
  const data = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const startsAt = asAiQuotaDate(data.startsAt);
  const endsAt = asAiQuotaDate(data.expiresAt);
  if (data.tier === 'pro' && typeof data.entitlementId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(data.entitlementId)
    && startsAt && endsAt && startsAt <= now && now < endsAt) {
    return { tier: 'pro', periodKey: `pro-${data.entitlementId}`, startsAt, endsAt, limit: config.proMonthlyAiCards };
  }
  return freePeriod(now, config);
}

export type WordReservation = { kind: 'completed'; result: unknown } | { kind: 'reserved'; attemptId: string; periodKey: string };

export async function reserveWordOperation(database: Firestore, uid: string, operationId: string,
  requestHash: string, now: Date, config: PilotConfig): Promise<WordReservation> {
  const owner = database.collection('users').doc(uid);
  const operationRef = owner.collection('ai_operations').doc(operationId);
  const planRef = owner.collection('profile').doc('plan');
  return database.runTransaction(async transaction => {
    const [operationSnapshot, planSnapshot] = await Promise.all([transaction.get(operationRef), transaction.get(planRef)]);
    const operation = operationSnapshot.data() as AiOperationRecord | undefined;
    // Only a live operation (still reserved, or already completed) owns its request shape.
    // A failed or refunded operation may be re-reserved for a different word, context or
    // language without the stale hash blocking it forever.
    if (operation?.requestHash && operation.requestHash !== requestHash
      && (operation.status === 'reserved' || operation.status === 'completed')) {
      throw new AiQuotaError('operation-request-mismatch', { reason: 'operation-request-mismatch' });
    }
    if (operation?.status === 'completed') {
      if (operation.result === undefined) throw new Error('Completed AI operation has no result.');
      return { kind: 'completed', result: operation.result };
    }
    const reservedAt = asAiQuotaDate(operation?.reservedAt);
    if (operation?.status === 'reserved' && reservedAt && now.getTime() - reservedAt.getTime() < 90_000) {
      throw new AiQuotaError('operation-in-flight', { reason: 'operation-in-flight', retryAfterMs: 5_000 });
    }
    const plan = resolvePlan(planSnapshot.data(), now, config);
    const takeover = operation?.status === 'reserved' && typeof operation.periodKey === 'string';
    const periodKey = takeover ? operation.periodKey! : plan.periodKey;
    const usageRef = owner.collection('ai_usage').doc(periodKey);
    const usageSnapshot = await transaction.get(usageRef);
    const used = asAiQuotaCount(usageSnapshot.data()?.used);
    if (!takeover && config.quotaEnforced && used >= plan.limit) {
      throw new AiQuotaError('ai-card-quota', {
        reason: 'ai-card-quota', used, limit: plan.limit, periodEndsAt: plan.endsAt.toISOString(), tier: plan.tier,
      });
    }
    const attemptId = randomUUID();
    if (!takeover) transaction.set(usageRef, {
      periodKey, tier: plan.tier, used: used + 1, limit: plan.limit,
      periodStartsAt: plan.startsAt, periodEndsAt: plan.endsAt, updatedAt: now,
    }, { merge: true });
    transaction.set(operationRef, {
      status: 'reserved', attemptId, periodKey, requestHash, reservedAt: now,
      completedAt: null, result: null, expiresAt: new Date(now.getTime() + 7 * 86_400_000),
    }, { merge: true });
    return { kind: 'reserved', attemptId, periodKey };
  });
}

export async function settleWordOperation(database: Firestore, uid: string, operationId: string,
  attemptId: string, result: unknown | null, now: Date): Promise<boolean> {
  const owner = database.collection('users').doc(uid);
  const operationRef = owner.collection('ai_operations').doc(operationId);
  return database.runTransaction(async transaction => {
    const operation = (await transaction.get(operationRef)).data() as AiOperationRecord | undefined;
    if (operation?.status !== 'reserved' || operation.attemptId !== attemptId || !operation.periodKey) return false;
    const usageRef = owner.collection('ai_usage').doc(operation.periodKey);
    const usage = await transaction.get(usageRef);
    if (result === null) {
      transaction.set(usageRef, { used: Math.max(0, asAiQuotaCount(usage.data()?.used) - 1), updatedAt: now }, { merge: true });
      transaction.set(operationRef, { status: 'failed', completedAt: now, result: null }, { merge: true });
    } else {
      transaction.set(operationRef, { status: 'completed', completedAt: now, result }, { merge: true });
    }
    return true;
  });
}

export async function cancelWordOperation(database: Firestore, uid: string, operationId: string, now: Date): Promise<boolean> {
  const operation = (await database.collection('users').doc(uid).collection('ai_operations').doc(operationId).get())
    .data() as AiOperationRecord | undefined;
  if (operation?.status !== 'reserved' || typeof operation.attemptId !== 'string') return false;
  return settleWordOperation(database, uid, operationId, operation.attemptId, null, now);
}

export async function reserveNonCardAction(database: Firestore, uid: string, now: Date, config: PilotConfig): Promise<string> {
  const day = dayKey(now, config.pilotTimezone);
  const owner = database.collection('users').doc(uid);
  const dailyRef = owner.collection('ai_daily').doc(day);
  const planRef = owner.collection('profile').doc('plan');
  await database.runTransaction(async transaction => {
    const [dailySnapshot, planSnapshot] = await Promise.all([transaction.get(dailyRef), transaction.get(planRef)]);
    const plan = resolvePlan(planSnapshot.data(), now, config);
    const limit = plan.tier === 'pro' ? config.proDailyAiActions : config.freeDailyAiActions;
    const used = asAiQuotaCount(dailySnapshot.data()?.nonCardActions);
    if (used >= limit) throw new AiQuotaError('ai-daily-allowance', {
      reason: 'ai-daily-allowance', used, limit,
      resetsAt: new Date(Date.parse(`${day}T00:00:00Z`) + 17 * 3_600_000).toISOString(),
    });
    transaction.set(dailyRef, { day, nonCardActions: used + 1 }, { merge: true });
  });
  return day;
}

export async function refundNonCardAction(database: Firestore, uid: string, day: string): Promise<void> {
  const reference = database.collection('users').doc(uid).collection('ai_daily').doc(day);
  await database.runTransaction(async transaction => {
    const snapshot = await transaction.get(reference);
    transaction.set(reference, { nonCardActions: Math.max(0, asAiQuotaCount(snapshot.data()?.nonCardActions) - 1) }, { merge: true });
  });
}

export async function sweepExpiredWordOperations(database: Firestore, now: Date): Promise<number> {
  const stale = await database.collectionGroup('ai_operations').where('status', '==', 'reserved')
    .where('reservedAt', '<=', new Date(now.getTime() - 10 * 60_000)).get();
  let refunded = 0;
  for (const snapshot of stale.docs) {
    const operation = snapshot.data() as AiOperationRecord;
    const ownerRef = snapshot.ref.parent.parent as DocumentReference | null;
    if (ownerRef && operation.attemptId
      && await settleWordOperation(database, ownerRef.id, snapshot.id, operation.attemptId, null, now)) refunded += 1;
  }
  return refunded;
}
