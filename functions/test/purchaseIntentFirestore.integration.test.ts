import { randomUUID } from 'node:crypto';
import { getApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { describe, expect, it } from 'vitest';
import { analyticsPseudonym, purchaseIntentOfferId } from '../src/analyticsEvents.js';
import { PILOT_CONFIG_DEFAULTS } from '../src/pilotConfig.js';

const describeWithEmulator = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;

describeWithEmulator('purchase intent callables', () => {
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
    expect(await getPilotOffer.run(request)).toEqual({
      proMonthlyAiCards: 1_000, displayPriceVnd: 85_320, proDurationDays: 30,
    });
    await expect(recordPurchaseIntent.run({ auth: { uid }, data: { trigger: 'checkout' } } as never))
      .rejects.toMatchObject({ code: 'invalid-argument' });
    await expect(recordPurchaseIntent.run({ auth: { uid }, data: { trigger: 'quota' } } as never))
      .resolves.toEqual({ recorded: true });
    const events = await database.collection('analytics_events').where('pid', '==', analyticsPseudonym(uid, key)).get();
    expect(events.size).toBe(1);
    expect(events.docs[0]?.data()).toMatchObject({
      name: 'purchase_intent', props: { trigger: 'quota', offerId: purchaseIntentOfferId, displayPriceVnd: 85_320 },
    });
    expect(JSON.stringify(events.docs[0]?.data())).not.toContain(uid);
    for (let count = 1; count < 5; count += 1) {
      await recordPurchaseIntent.run({ auth: { uid }, data: { trigger: 'menu' } } as never);
    }
    await expect(recordPurchaseIntent.run({ auth: { uid }, data: { trigger: 'menu' } } as never))
      .rejects.toMatchObject({ code: 'resource-exhausted' });
    await database.collection('_serviceConfig').doc('pilot').delete();
  }, 20_000);
});
