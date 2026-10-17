import { createHash } from 'node:crypto';
import type { Firestore } from 'firebase-admin/firestore';
import type { PilotConfig } from './pilotConfig.js';
import type { PilotTarget } from './pilotTarget.js';
import {
  analyticsPseudonym, emitAnalyticsBestEffort, purchaseIntentOfferId, purchaseIntentOfferVersion,
} from './analyticsEvents.js';
import { dayKey } from './aiCostLedger.js';
import { resolvePlan } from './aiQuota.js';

export class EntitlementConflictError extends Error {}

// Matches the retention already used for the AI cost ledger: operator actions here
// (Pro grants and revokes, deletion resumes) are the closest comparable audit trail.
export const OPERATOR_AUDIT_TTL_MS = 400 * 24 * 60 * 60 * 1_000;
export type PaymentSettlementProvider = string;

export interface OperatorAuditContext {
  pidKey: string;
  target: PilotTarget;
  operator: string;
  reason: string;
}

export interface PaymentSettlementInput {
  uid: string;
  provider: PaymentSettlementProvider;
  providerTransactionId: string;
  amountVnd: number;
  offerVersion: string | null;
  pidKey: string;
  target: PilotTarget;
}

// A payment that cannot open a Pro window on its own is still recorded, so money that
// arrived is never lost and the operator can grant, refund or credit it by hand.
export type PaymentReviewReason = 'price-unset' | 'amount-below-price' | 'offer-changed' | 'already-pro';

export type PaymentSettlementResult =
  | { status: 'settled' | 'already-settled'; entitlementId: string; expiresAt: Date }
  | { status: 'needs-review'; settlementId: string; reviewReason: PaymentReviewReason };

// Payment records back the books, so they outlive both the account and the operator audit:
// Vietnamese accounting rules keep such documents for ten years. They carry only the pid.
export const PAYMENT_RECORD_RETENTION_MS = 3_653 * 24 * 60 * 60 * 1_000;

const VALID_PROVIDER_ID = /^[a-z0-9][a-z0-9_-]{0,31}$/;
const VALID_PROVIDER_TX_ID = /^[A-Za-z0-9._:-]{1,128}$/;
const VALID_OFFER_VERSION = /^[a-f0-9]{64}$/;

export function paymentSettlementId(
  provider: PaymentSettlementProvider,
  providerTransactionId: string,
): string {
  const normalizedProvider = provider.trim();
  if (!VALID_PROVIDER_ID.test(normalizedProvider)) {
    throw new Error('Payment provider must be 1–32 lowercase ASCII letters, digits, underscores, or hyphens.');
  }
  const normalizedTxId = providerTransactionId.trim();
  if (!VALID_PROVIDER_TX_ID.test(normalizedTxId)) {
    throw new Error('Payment providerTransactionId must be 1–128 safe ASCII characters.');
  }
  const digest = createHash('sha256')
    .update(`${normalizedProvider}:${normalizedTxId}`)
    .digest('hex')
    .slice(0, 32);
  return `pay_${digest}`;
}

export async function settlePaymentProEntitlement(
  database: Firestore,
  input: PaymentSettlementInput,
  config: PilotConfig,
  now = new Date(),
): Promise<PaymentSettlementResult> {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(input.uid)) {
    throw new Error('Payment settlement uid is invalid.');
  }
  if (!Number.isSafeInteger(input.amountVnd) || input.amountVnd <= 0 || input.amountVnd > 1_000_000_000) {
    throw new Error('Payment settlement amountVnd must be a positive safe integer.');
  }
  if (input.offerVersion !== null && !VALID_OFFER_VERSION.test(input.offerVersion)) {
    throw new Error('Payment settlement offerVersion must be a 64-char SHA-256 hex string or null.');
  }
  const normalizedProvider = input.provider.trim();
  const settlementId = paymentSettlementId(normalizedProvider, input.providerTransactionId);
  const normalizedTxId = input.providerTransactionId.trim();
  const pid = analyticsPseudonym(input.uid, input.pidKey);
  const owner = database.collection('users').doc(input.uid);
  const planRef = owner.collection('profile').doc('plan');
  const entitlementRef = owner.collection('entitlements').doc(settlementId);
  const receiptRef = owner.collection('payment_receipts').doc(settlementId);
  const settlementRef = database.collection('payment_settlements').doc(settlementId);
  const usageRef = owner.collection('ai_usage').doc(`pro-${settlementId}`);
  const auditRef = database.collection('operator_audit').doc();
  const expiresAt = new Date(now.getTime() + config.proDurationDays * 86_400_000);
  const payment = {
    provider: normalizedProvider,
    providerTransactionId: normalizedTxId,
    amountVnd: input.amountVnd,
    currency: 'VND',
    offerId: purchaseIntentOfferId,
    offerVersion: input.offerVersion,
  };

  const result = await database.runTransaction(async (transaction): Promise<PaymentSettlementResult> => {
    const [existingSettlement, planSnapshot, entitlements] = await Promise.all([
      transaction.get(settlementRef),
      transaction.get(planRef),
      transaction.get(owner.collection('entitlements')),
    ]);
    if (existingSettlement.exists) {
      const existing = existingSettlement.data();
      const sameTerms = existing?.pid === pid
        && existing?.provider === normalizedProvider
        && existing?.providerTransactionId === normalizedTxId
        && existing?.amountVnd === input.amountVnd
        && existing?.offerVersion === input.offerVersion;
      if (!sameTerms) {
        throw new EntitlementConflictError('Payment transaction is already bound to different settlement terms.');
      }
      if (existing?.status === 'needs-review') {
        return { status: 'needs-review', settlementId, reviewReason: existing.reviewReason };
      }
      const existingExpires = existing?.entitlementExpiresAt?.toDate?.() ?? existing?.entitlementExpiresAt;
      if (!(existingExpires instanceof Date)) {
        throw new EntitlementConflictError('Payment settlement record is malformed.');
      }
      return { status: 'already-settled', entitlementId: settlementId, expiresAt: existingExpires };
    }

    const activeEntitlement = entitlements.docs.some(snapshot => {
      const data = snapshot.data();
      const expires = data.expiresAt?.toDate?.() ?? data.expiresAt;
      return data.status === 'active' && expires instanceof Date && expires > now;
    });
    const reviewReason: PaymentReviewReason | null = config.displayPriceVnd === null ? 'price-unset'
      : input.amountVnd < config.displayPriceVnd ? 'amount-below-price'
        : input.offerVersion !== null && input.offerVersion !== purchaseIntentOfferVersion(config) ? 'offer-changed'
          : resolvePlan(planSnapshot.data(), now, config).tier === 'pro' || activeEntitlement ? 'already-pro'
            : null;

    if (reviewReason !== null) {
      transaction.create(receiptRef, {
        ...payment, status: 'needs-review', reviewReason, entitlementId: null, settledAt: now,
      });
      transaction.create(settlementRef, {
        pid, ...payment, status: 'needs-review', reviewReason, entitlementId: null, settledAt: now,
        entitlementExpiresAt: null, expiresAt: new Date(now.getTime() + PAYMENT_RECORD_RETENTION_MS),
      });
      transaction.create(auditRef, {
        mode: 'payment-review',
        pid,
        reason: `payment:${normalizedProvider}:${normalizedTxId}`,
        target: input.target,
        operator: `webhook:${normalizedProvider}`,
        at: now,
        result: { settlementId, reviewReason, amountVnd: input.amountVnd },
        expiresAt: new Date(now.getTime() + OPERATOR_AUDIT_TTL_MS),
      });
      return { status: 'needs-review', settlementId, reviewReason };
    }

    transaction.create(entitlementRef, {
      tier: 'pro',
      source: 'payment',
      ...payment,
      startsAt: now,
      expiresAt,
      status: 'active',
      reason: `payment:${normalizedProvider}:${normalizedTxId}`,
      createdAt: now,
      revokedAt: null,
    });
    transaction.create(receiptRef, {
      ...payment, status: 'settled', entitlementId: settlementId, settledAt: now, expiresAt,
    });
    transaction.create(settlementRef, {
      pid, ...payment, status: 'settled', entitlementId: settlementId, settledAt: now,
      entitlementExpiresAt: expiresAt, expiresAt: new Date(now.getTime() + PAYMENT_RECORD_RETENTION_MS),
    });
    transaction.set(planRef, { tier: 'pro', entitlementId: settlementId, startsAt: now, expiresAt });
    transaction.create(usageRef, {
      periodKey: `pro-${settlementId}`,
      tier: 'pro',
      used: 0,
      limit: config.proMonthlyAiCards,
      periodStartsAt: now,
      periodEndsAt: expiresAt,
      updatedAt: now,
    });
    transaction.create(auditRef, {
      mode: 'payment-grant',
      pid,
      reason: `payment:${normalizedProvider}:${normalizedTxId}`,
      target: input.target,
      operator: `webhook:${normalizedProvider}`,
      at: now,
      result: { entitlementId: settlementId, expiresAt, amountVnd: input.amountVnd },
      expiresAt: new Date(now.getTime() + OPERATOR_AUDIT_TTL_MS),
    });
    return { status: 'settled', entitlementId: settlementId, expiresAt };
  });
  if (result.status === 'settled') {
    await emitAnalyticsBestEffort(database, input.uid, input.pidKey, config.analyticsEnabled,
      'pro_granted', { source: 'payment' }, now);
  }
  return result;
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
      expiresAt: new Date(now.getTime() + OPERATOR_AUDIT_TTL_MS),
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
      expiresAt: new Date(now.getTime() + OPERATOR_AUDIT_TTL_MS),
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
