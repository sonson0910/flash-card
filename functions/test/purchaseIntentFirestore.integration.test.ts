import { randomUUID } from 'node:crypto';
import { getApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { describe, expect, it } from 'vitest';
import { analyticsPseudonym, purchaseIntentOfferId } from '../src/analyticsEvents.js';
import { PILOT_CONFIG_DEFAULTS } from '../src/pilotConfig.js';
import { clearPilotConfigCacheForTest } from '../src/pilotConfig.js';
import { budgetDocumentId } from '../src/rateLimiter.js';

const describeWithEmulator = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;

describeWithEmulator('purchase intent callables', () => {
  it('rejects an offer captured for another account before writing B\'s event or budget', async () => {
    const key = 'x'.repeat(32);
    process.env.ANALYTICS_PSEUDONYM_KEY = key;
    const { recordPurchaseIntent } = await import('../src/index.js');
    const database = getFirestore(getApp(), 'ai-studio-945b4052-4462-4668-8936-277f09f07a37');
    await database.collection('_serviceConfig').doc('pilot').set(PILOT_CONFIG_DEFAULTS);
    clearPilotConfigCacheForTest();
    const expectedOwnerId = `intent-a-${randomUUID()}`;
    const authenticatedUid = `intent-b-${randomUUID()}`;

    await expect(recordPurchaseIntent.run({ auth: { uid: authenticatedUid }, data: {
      trigger: 'menu', expectedOwnerId,
    } } as never)).rejects.toMatchObject({ code: 'permission-denied' });

    expect((await database.collection('analytics_events')
      .where('pid', '==', analyticsPseudonym(authenticatedUid, key)).get()).empty).toBe(true);
    expect((await database.collection('_functionRateLimitBudgets')
      .doc(budgetDocumentId(authenticatedUid, 'purchase-intent')).get()).exists).toBe(false);
    await database.collection('_serviceConfig').doc('pilot').delete();
    clearPilotConfigCacheForTest();
  }, 20_000);

  it('does not write an event or budget when purchase intent is disabled', async () => {
    const key = 'x'.repeat(32);
    process.env.ANALYTICS_PSEUDONYM_KEY = key;
    const { recordPurchaseIntent } = await import('../src/index.js');
    const database = getFirestore(getApp(), 'ai-studio-945b4052-4462-4668-8936-277f09f07a37');
    await database.collection('_serviceConfig').doc('pilot').set({
      ...PILOT_CONFIG_DEFAULTS, analyticsEnabled: false,
    });
    clearPilotConfigCacheForTest();
    const uid = `intent-disabled-${randomUUID()}`;

    await expect(recordPurchaseIntent.run({ auth: { uid }, data: { trigger: 'menu' } } as never))
      .rejects.toMatchObject({ code: 'failed-precondition', details: { reason: 'intent-unavailable' } });

    expect((await database.collection('analytics_events')
      .where('pid', '==', analyticsPseudonym(uid, key)).get()).empty).toBe(true);
    expect((await database.collection('_functionRateLimitBudgets')
      .doc(budgetDocumentId(uid, 'purchase-intent')).get()).exists).toBe(false);
    await database.collection('_serviceConfig').doc('pilot').delete();
    clearPilotConfigCacheForTest();
  }, 20_000);

  it('rejects a stale offer before spending budget and records current server terms', async () => {
    const key = 'x'.repeat(32);
    process.env.ANALYTICS_PSEUDONYM_KEY = key;
    const { getPilotOffer, recordPurchaseIntent } = await import('../src/index.js');
    const database = getFirestore(getApp(), 'ai-studio-945b4052-4462-4668-8936-277f09f07a37');
    const uid = `intent-version-${randomUUID()}`;
    const request = { auth: { uid }, data: {} } as never;
    const budgetRef = database.collection('_functionRateLimitBudgets')
      .doc(budgetDocumentId(uid, 'purchase-intent'));
    await database.collection('_serviceConfig').doc('pilot').set({
      ...PILOT_CONFIG_DEFAULTS, displayPriceVnd: 85_320,
    });
    clearPilotConfigCacheForTest();
    const staleOffer = await getPilotOffer.run(request);

    await database.collection('_serviceConfig').doc('pilot').set({
      ...PILOT_CONFIG_DEFAULTS, displayPriceVnd: 90_000,
    });
    clearPilotConfigCacheForTest();
    await expect(recordPurchaseIntent.run({ auth: { uid }, data: {
      trigger: 'menu', offerVersion: staleOffer.offerVersion,
    } } as never)).rejects.toMatchObject({
      code: 'failed-precondition', details: { reason: 'offer-changed' },
    });
    expect((await budgetRef.get()).exists).toBe(false);
    expect((await database.collection('analytics_events')
      .where('pid', '==', analyticsPseudonym(uid, key)).get()).empty).toBe(true);

    const freshOffer = await getPilotOffer.run(request);
    await expect(recordPurchaseIntent.run({ auth: { uid }, data: {
      trigger: 'menu', offerVersion: freshOffer.offerVersion,
    } } as never)).resolves.toEqual({ recorded: true });
    const event = (await database.collection('analytics_events')
      .where('pid', '==', analyticsPseudonym(uid, key)).get()).docs[0]?.data();
    expect(event?.props).toMatchObject({
      displayPriceVnd: 90_000, offerVersion: freshOffer.offerVersion,
      proMonthlyAiCards: 1_000, proDurationDays: 30,
    });
    await database.collection('_serviceConfig').doc('pilot').delete();
    clearPilotConfigCacheForTest();
  }, 20_000);

  it('returns a bounded offer and writes one private pseudonymous event', async () => {
    const key = 'x'.repeat(32);
    process.env.ANALYTICS_PSEUDONYM_KEY = key;
    const { getPilotOffer, recordPurchaseIntent } = await import('../src/index.js');
    const database = getFirestore(getApp(), 'ai-studio-945b4052-4462-4668-8936-277f09f07a37');
    await database.collection('_serviceConfig').doc('pilot').set({
      ...PILOT_CONFIG_DEFAULTS, displayPriceVnd: 85_320,
    });
    const uid = `intent-${randomUUID()}`;
    const request = { auth: { uid }, data: {} } as never;
    await expect(getPilotOffer.run({ data: {} } as never)).rejects.toMatchObject({ code: 'unauthenticated' });
    const offer = await getPilotOffer.run(request);
    expect(offer).toMatchObject({
      proMonthlyAiCards: 1_000, displayPriceVnd: 85_320, proDurationDays: 30, intentEligibility: 'eligible',
      offerVersion: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    await expect(recordPurchaseIntent.run({ auth: { uid }, data: { trigger: 'checkout' } } as never))
      .rejects.toMatchObject({ code: 'invalid-argument' });
    await expect(recordPurchaseIntent.run({ auth: { uid }, data: { trigger: 'quota', offerVersion: offer.offerVersion } } as never))
      .resolves.toEqual({ recorded: true });
    const events = await database.collection('analytics_events').where('pid', '==', analyticsPseudonym(uid, key)).get();
    expect(events.size).toBe(1);
    expect(events.docs[0]?.data()).toMatchObject({
      name: 'purchase_intent', props: {
        trigger: 'quota', offerId: purchaseIntentOfferId, displayPriceVnd: 85_320, offerVersion: offer.offerVersion,
        proMonthlyAiCards: 1_000, proDurationDays: 30,
      },
    });
    expect(JSON.stringify(events.docs[0]?.data())).not.toContain(uid);
    for (let count = 1; count < 5; count += 1) {
      await recordPurchaseIntent.run({ auth: { uid }, data: { trigger: 'menu' } } as never);
    }
    await expect(recordPurchaseIntent.run({ auth: { uid }, data: { trigger: 'menu' } } as never))
      .rejects.toMatchObject({ code: 'resource-exhausted' });
    await database.collection('_serviceConfig').doc('pilot').delete();
  }, 20_000);

  it('blocks active Pro at offer and submission, including an orphan entitlement', async () => {
    process.env.ANALYTICS_PSEUDONYM_KEY = 'x'.repeat(32);
    const { getPilotOffer, recordPurchaseIntent } = await import('../src/index.js');
    const database = getFirestore(getApp(), 'ai-studio-945b4052-4462-4668-8936-277f09f07a37');
    await database.collection('_serviceConfig').doc('pilot').set(PILOT_CONFIG_DEFAULTS);
    clearPilotConfigCacheForTest();
    const uid = `intent-pro-${randomUUID()}`;
    const owner = database.collection('users').doc(uid);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 86_400_000);
    const planRef = owner.collection('profile').doc('plan');
    const entitlementRef = owner.collection('entitlements').doc('active-pro');
    const offerRequest = { auth: { uid }, data: {} } as never;
    const intentRequest = { auth: { uid }, data: { trigger: 'menu' } } as never;
    const budgetRef = database.collection('_functionRateLimitBudgets')
      .doc(budgetDocumentId(uid, 'purchase-intent'));
    await planRef.set({ tier: 'pro', entitlementId: entitlementRef.id,
      startsAt: new Date(now.getTime() - 86_400_000), expiresAt });
    expect((await getPilotOffer.run(offerRequest)).intentEligibility).toBe('already-pro');
    await expect(recordPurchaseIntent.run(intentRequest))
      .rejects.toMatchObject({ code: 'failed-precondition', details: { reason: 'already-pro' } });
    expect((await budgetRef.get()).exists).toBe(false);

    await planRef.delete();
    await entitlementRef.set({ status: 'active', expiresAt });
    expect((await getPilotOffer.run(offerRequest)).intentEligibility).toBe('already-pro');
    await expect(recordPurchaseIntent.run(intentRequest))
      .rejects.toMatchObject({ code: 'failed-precondition', details: { reason: 'already-pro' } });
    expect((await budgetRef.get()).exists).toBe(false);

    await entitlementRef.update({ expiresAt: new Date(now.getTime() - 1_000) });
    expect((await getPilotOffer.run(offerRequest)).intentEligibility).toBe('eligible');
    await planRef.set({ tier: 'pro', entitlementId: entitlementRef.id,
      startsAt: new Date(now.getTime() - 86_400_000), expiresAt });
    await expect(recordPurchaseIntent.run(intentRequest))
      .rejects.toMatchObject({ code: 'failed-precondition', details: { reason: 'already-pro' } });
    expect((await budgetRef.get()).exists).toBe(false);
    expect((await database.collection('analytics_events')
      .where('pid', '==', analyticsPseudonym(uid, 'x'.repeat(32))).get()).empty).toBe(true);

    await planRef.delete();
    await database.collection('_serviceConfig').doc('pilot').set(PILOT_CONFIG_DEFAULTS);
    clearPilotConfigCacheForTest();
    expect(await getPilotOffer.run(offerRequest)).toMatchObject({
      intentEligibility: 'eligible', displayPriceVnd: null,
    });
    await expect(recordPurchaseIntent.run(intentRequest)).resolves.toEqual({ recorded: true });
    expect((await budgetRef.get()).data()?.calls).toBe(1);
    const events = await database.collection('analytics_events')
      .where('pid', '==', analyticsPseudonym(uid, 'x'.repeat(32))).get();
    expect(events.size).toBe(1);
    expect(events.docs[0]?.data().props.displayPriceVnd).toBeNull();
    expect(events.docs[0]?.data().props.offerVersion).toBeNull();
    expect(events.docs[0]?.data().props.proMonthlyAiCards).toBeNull();
    expect(events.docs[0]?.data().props.proDurationDays).toBeNull();

    await database.collection('_serviceConfig').doc('pilot').set({ ...PILOT_CONFIG_DEFAULTS, analyticsEnabled: false });
    clearPilotConfigCacheForTest();
    expect((await getPilotOffer.run(offerRequest)).intentEligibility).toBe('unavailable');
    await expect(recordPurchaseIntent.run(intentRequest))
      .rejects.toMatchObject({ code: 'failed-precondition' });
    await database.collection('_serviceConfig').doc('pilot').delete();
    clearPilotConfigCacheForTest();
  }, 20_000);
});
