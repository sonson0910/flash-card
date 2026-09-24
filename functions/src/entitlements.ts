import type { Firestore } from 'firebase-admin/firestore';
import type { PilotConfig } from './pilotConfig.js';
import type { PilotTarget } from './pilotTarget.js';
import { analyticsPseudonym } from './analyticsEvents.js';
import { dayKey } from './aiCostLedger.js';
import { resolvePlan } from './aiQuota.js';

export class EntitlementConflictError extends Error {}

export interface OperatorAuditContext {
  pidKey: string;
  target: PilotTarget;
  operator: string;
  reason: string;
}

export async function grantPro(database: Firestore, uid: string, config: PilotConfig,
  audit: OperatorAuditContext, now = new Date()): Promise<{ entitlementId: string; expiresAt: Date }> {
  const owner = database.collection('users').doc(uid);
  const planRef = owner.collection('profile').doc('plan');
  const entitlementRef = owner.collection('entitlements').doc();
  const usageRef = owner.collection('ai_usage').doc(`pro-${entitlementRef.id}`);
  const auditRef = database.collection('operator_audit').doc();
  const expiresAt = new Date(now.getTime() + config.proDurationDays * 86_400_000);
  await database.runTransaction(async transaction => {
    const [planSnapshot, entitlements] = await Promise.all([
      transaction.get(planRef), transaction.get(owner.collection('entitlements')),
    ]);
    const plan = planSnapshot.data();
    const activeEntitlement = entitlements.docs.some(snapshot => {
      const data = snapshot.data();
      const expires = data.expiresAt?.toDate?.() ?? data.expiresAt;
      return data.status === 'active' && expires instanceof Date && expires > now;
    });
    if (resolvePlan(plan, now, config).tier === 'pro' || activeEntitlement) {
      throw new EntitlementConflictError('An active Pro entitlement already exists. Revoke it before granting a new window.');
    }
    transaction.create(entitlementRef, {
      tier: 'pro', source: 'operator', startsAt: now, expiresAt,
      status: 'active', reason: audit.reason, createdAt: now, revokedAt: null,
    });
    transaction.set(planRef, { tier: 'pro', entitlementId: entitlementRef.id, startsAt: now, expiresAt });
    transaction.create(usageRef, {
      periodKey: `pro-${entitlementRef.id}`, tier: 'pro', used: 0,
      limit: config.proMonthlyAiCards, periodStartsAt: now, periodEndsAt: expiresAt, updatedAt: now,
    });
    transaction.create(auditRef, {
      mode: 'grant', pid: analyticsPseudonym(uid, audit.pidKey), reason: audit.reason,
      target: audit.target, operator: audit.operator, at: now,
      result: { entitlementId: entitlementRef.id, expiresAt },
    });
  });
  return { entitlementId: entitlementRef.id, expiresAt };
}

export async function revokePro(database: Firestore, uid: string, config: PilotConfig,
  audit: OperatorAuditContext, now = new Date()): Promise<{ entitlementId: string }> {
  const owner = database.collection('users').doc(uid);
  const planRef = owner.collection('profile').doc('plan');
  const auditRef = database.collection('operator_audit').doc();
  return database.runTransaction(async transaction => {
    const plan = (await transaction.get(planRef)).data();
    if (resolvePlan(plan, now, config).tier !== 'pro' || typeof plan?.entitlementId !== 'string') {
      throw new EntitlementConflictError('No active Pro entitlement exists.');
    }
    const entitlementRef = owner.collection('entitlements').doc(plan.entitlementId);
    const entitlement = (await transaction.get(entitlementRef)).data();
    if (entitlement?.status !== 'active') throw new EntitlementConflictError('The entitlement is already revoked.');
    transaction.update(entitlementRef, { status: 'revoked', revokedAt: now });
    transaction.delete(planRef);
    transaction.create(auditRef, {
      mode: 'revoke', pid: analyticsPseudonym(uid, audit.pidKey), reason: audit.reason,
      target: audit.target, operator: audit.operator, at: now,
      result: { entitlementId: entitlementRef.id },
    });
    return { entitlementId: entitlementRef.id };
  });
}

export async function readProStatus(database: Firestore, uid: string, config: PilotConfig, now = new Date()) {
  const owner = database.collection('users').doc(uid);
  const planSnapshot = await owner.collection('profile').doc('plan').get();
  const plan = resolvePlan(planSnapshot.data(), now, config);
  const [entitlements, usage, allowance] = await Promise.all([
    owner.collection('entitlements').get(),
    owner.collection('ai_usage').doc(plan.periodKey).get(),
    owner.collection('ai_daily').doc(dayKey(now, config.pilotTimezone)).get(),
  ]);
  return {
    plan: { tier: plan.tier, periodKey: plan.periodKey, startsAt: plan.startsAt, expiresAt: plan.endsAt },
    entitlements: entitlements.docs.map(snapshot => ({ id: snapshot.id, ...snapshot.data() })),
    usage: { used: usage.data()?.used ?? 0, limit: plan.limit },
    allowance: {
      used: allowance.data()?.nonCardActions ?? 0,
      limit: plan.tier === 'pro' ? config.proDailyAiActions : config.freeDailyAiActions,
    },
  };
}
