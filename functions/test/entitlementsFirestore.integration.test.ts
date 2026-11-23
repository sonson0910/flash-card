import { randomUUID } from 'node:crypto';
import { deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  grantPro,
  paymentSettlementId,
  readProStatus,
  revokePro,
  settlePaymentProEntitlement,
} from '../src/entitlements.js';
import { analyticsPseudonym, purchaseIntentOfferVersion } from '../src/analyticsEvents.js';
import { reserveWordOperation } from '../src/aiQuota.js';
import { PILOT_CONFIG_DEFAULTS, type PilotConfig } from '../src/pilotConfig.js';

const describeWithEmulator = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;
const now = new Date('2026-09-24T00:00:00.000Z');
const config: PilotConfig = { ...PILOT_CONFIG_DEFAULTS };
const audit = { pidKey: 'x'.repeat(32), target: 'staging' as const, operator: 'tester', reason: 'Pilot access' };

describe('paymentSettlementId', () => {
  it('derives deterministic settlement IDs for any valid lowercase gateway slug and rejects invalid inputs', () => {
    const idA = paymentSettlementId('vn-gateway', 'TX-1001');
    const idB = paymentSettlementId(' vn-gateway ', ' TX-1001 ');
    const idOtherProvider = paymentSettlementId('payos', 'TX-1001');
    expect(idA).toMatch(/^pay_[a-f0-9]{32}$/);
    expect(idB).toBe(idA);
    expect(idOtherProvider).not.toBe(idA);
    expect(() => paymentSettlementId('Invalid Upper', 'TX-1001')).toThrow(/Payment provider/);
    expect(() => paymentSettlementId('', 'TX-1001')).toThrow(/Payment provider/);
    expect(() => paymentSettlementId('vn-gateway', 'bad tx id')).toThrow(/providerTransactionId/);
  });
});

describeWithEmulator('operator Pro entitlements', () => {
  let app: App;
  let database: Firestore;
  beforeAll(() => {
    app = initializeApp({ projectId: 'demo-lingoflash' }, 'pilot-entitlements-integration');
    database = getFirestore(app, 'ai-studio-945b4052-4462-4668-8936-277f09f07a37');
  });
  afterAll(async () => { await database.terminate(); await deleteApp(app); });

  it('grants one fixed window, refuses stacking, audits grant and revoke, then returns to Free', async () => {
    const uid = `pro-${randomUUID()}`;
    const first = await grantPro(database, uid, config, audit, now);
    expect(first.expiresAt.toISOString()).toBe('2026-10-24T00:00:00.000Z');
    await expect(grantPro(database, uid, config, audit, now)).rejects.toThrow('already exists');
    const owner = database.collection('users').doc(uid);
    expect((await readProStatus(database, uid, config, now)).plan.periodKey).toBe(`pro-${first.entitlementId}`);
    const reservation = await reserveWordOperation(database, uid, randomUUID(), 'word-hash', now, config);
    expect(reservation).toMatchObject({ kind: 'reserved', periodKey: `pro-${first.entitlementId}` });

    await revokePro(database, uid, config, audit, new Date(now.getTime() + 60_000));
    expect((await owner.collection('profile').doc('plan').get()).exists).toBe(false);
    expect((await owner.collection('entitlements').doc(first.entitlementId).get()).data())
      .toMatchObject({ tier: 'pro', source: 'operator', status: 'revoked' });
    const free = await readProStatus(database, uid, config, new Date(now.getTime() + 60_000));
    expect(free.plan.tier).toBe('free');
    expect(free.usage.limit).toBe(30);
    expect((await owner.collection('ai_usage').doc(`pro-${first.entitlementId}`).get()).data()?.used).toBe(1);
    const audits = await database.collection('operator_audit').where('pid', '==', analyticsPseudonym(uid, audit.pidKey)).get();
    const ownAudits = audits.docs.filter(doc => doc.data().result.entitlementId === first.entitlementId);
    expect(ownAudits.map(doc => doc.data().mode).sort()).toEqual(['grant', 'revoke']);
    expect(JSON.stringify(ownAudits.map(doc => doc.data()))).not.toContain(uid);

    const second = await grantPro(database, uid, config, audit, new Date(now.getTime() + 120_000));
    expect(second.entitlementId).not.toBe(first.entitlementId);
    expect((await readProStatus(database, uid, config, new Date(now.getTime() + 120_000))).plan.periodKey)
      .toBe(`pro-${second.entitlementId}`);
  });

  it('refuses overlapping grants even when a plan summary is missing', async () => {
    const uid = `missing-plan-${randomUUID()}`;
    await grantPro(database, uid, config, audit, now);
    await database.collection('users').doc(uid).collection('profile').doc('plan').delete();
    await expect(grantPro(database, uid, config, audit, now)).rejects.toThrow('already exists');
  });

  it('settles a paid Pro entitlement idempotently and rejects cross-account transaction replay', async () => {
    const uid = `paid-${randomUUID()}`;
    const otherUid = `paid-other-${randomUUID()}`;
    const txId = `SEPAY-${randomUUID()}`;
    const pricedConfig: PilotConfig = { ...config, displayPriceVnd: 79_000 };
    const offerVersion = purchaseIntentOfferVersion(pricedConfig);
    const expectedEntitlementId = paymentSettlementId('sepay', txId);
    const expectedExpiresAt = new Date('2026-10-24T00:00:00.000Z');

    const first = await settlePaymentProEntitlement(database, {
      uid,
      provider: 'sepay',
      providerTransactionId: txId,
      amountVnd: 79_000,
      offerVersion,
      pidKey: audit.pidKey,
      target: 'staging',
    }, pricedConfig, now);
    expect(first).toEqual({
      status: 'settled',
      entitlementId: expectedEntitlementId,
      expiresAt: expectedExpiresAt,
    });

    // Duplicate webhook delivery with identical terms returns already-settled without error.
    const replay = await settlePaymentProEntitlement(database, {
      uid,
      provider: 'sepay',
      providerTransactionId: txId,
      amountVnd: 79_000,
      offerVersion,
      pidKey: audit.pidKey,
      target: 'staging',
    }, pricedConfig, new Date(now.getTime() + 5_000));
    expect(replay).toEqual({
      status: 'already-settled',
      entitlementId: expectedEntitlementId,
      expiresAt: expectedExpiresAt,
    });

    // Replaying the same providerTransactionId for another user or different amount must fail.
    await expect(settlePaymentProEntitlement(database, {
      uid: otherUid,
      provider: 'sepay',
      providerTransactionId: txId,
      amountVnd: 79_000,
      offerVersion,
      pidKey: audit.pidKey,
      target: 'staging',
    }, pricedConfig, now)).rejects.toThrow('already bound to different settlement terms');

    const status = await readProStatus(database, uid, pricedConfig, now);
    expect(status.plan.tier).toBe('pro');
    expect(status.plan.periodKey).toBe(`pro-${expectedEntitlementId}`);
    const receipt = (await database.collection('users').doc(uid).collection('payment_receipts').doc(expectedEntitlementId).get()).data();
    expect(receipt).toMatchObject({
      provider: 'sepay',
      providerTransactionId: txId,
      amountVnd: 79_000,
      currency: 'VND',
      offerVersion,
      entitlementId: expectedEntitlementId,
    });
    const granted = await database.collection('analytics_events')
      .where('pid', '==', analyticsPseudonym(uid, audit.pidKey)).where('name', '==', 'pro_granted').get();
    expect(granted.docs.map(doc => doc.data().props)).toEqual([{ source: 'payment' }]);
  });

  it('records payments it cannot grant for operator review instead of losing them', async () => {
    const pricedConfig: PilotConfig = { ...config, displayPriceVnd: 79_000 };
    const offerVersion = purchaseIntentOfferVersion(pricedConfig);
    const settle = (uid: string, txId: string, amountVnd: number, terms: PilotConfig = pricedConfig,
      version: string | null = offerVersion) => settlePaymentProEntitlement(database, {
      uid, provider: 'sepay', providerTransactionId: txId, amountVnd, offerVersion: version,
      pidKey: audit.pidKey, target: 'staging',
    }, terms, now);
    const review = (txId: string, reviewReason: string) => ({
      status: 'needs-review', settlementId: paymentSettlementId('sepay', txId), reviewReason,
    });

    const uid = `review-${randomUUID()}`;
    const shortTx = `SEPAY-${randomUUID()}`;
    expect(await settle(uid, shortTx, 1_000)).toEqual(review(shortTx, 'amount-below-price'));
    // A redelivered webhook for the same short payment stays in review and writes nothing new.
    expect(await settle(uid, shortTx, 1_000)).toEqual(review(shortTx, 'amount-below-price'));
    const unpricedTx = `SEPAY-${randomUUID()}`;
    expect(await settle(uid, unpricedTx, 79_000, config)).toEqual(review(unpricedTx, 'price-unset'));
    const staleTx = `SEPAY-${randomUUID()}`;
    expect(await settle(uid, staleTx, 79_000, pricedConfig, 'a'.repeat(64)))
      .toEqual(review(staleTx, 'offer-changed'));
    expect((await readProStatus(database, uid, pricedConfig, now)).plan.tier).toBe('free');
    const receipt = (await database.collection('users').doc(uid).collection('payment_receipts')
      .doc(paymentSettlementId('sepay', shortTx)).get()).data();
    expect(receipt).toMatchObject({ status: 'needs-review', reviewReason: 'amount-below-price', amountVnd: 1_000, entitlementId: null });

    const paidTx = `SEPAY-${randomUUID()}`;
    const paid = await settle(uid, paidTx, 79_000);
    expect(paid.status).toBe('settled');
    const earlyTx = `SEPAY-${randomUUID()}`;
    expect(await settle(uid, earlyTx, 79_000)).toEqual(review(earlyTx, 'already-pro'));
    const plan = (await database.collection('users').doc(uid).collection('profile').doc('plan').get()).data();
    expect(plan?.entitlementId).toBe(paymentSettlementId('sepay', paidTx));
    const settlement = (await database.collection('payment_settlements').doc(paymentSettlementId('sepay', earlyTx)).get()).data();
    expect(settlement).toMatchObject({ status: 'needs-review', reviewReason: 'already-pro', entitlementId: null });
    expect(settlement?.uid).toBeUndefined();
  });
});
