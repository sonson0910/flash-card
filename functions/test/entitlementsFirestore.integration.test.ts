import { randomUUID } from 'node:crypto';
import { deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { grantPro, readProStatus, revokePro } from '../src/entitlements.js';
import { analyticsPseudonym } from '../src/analyticsEvents.js';
import { reserveWordOperation } from '../src/aiQuota.js';
import { PILOT_CONFIG_DEFAULTS } from '../src/pilotConfig.js';

const describeWithEmulator = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;
const now = new Date('2026-09-24T00:00:00.000Z');
const config = { ...PILOT_CONFIG_DEFAULTS };
const audit = { pidKey: 'x'.repeat(32), target: 'staging' as const, operator: 'tester', reason: 'Pilot access' };

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
});
