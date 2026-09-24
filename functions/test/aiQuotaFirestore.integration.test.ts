import { randomUUID } from 'node:crypto';
import { deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  freePeriod, refundNonCardAction, reserveNonCardAction, reserveWordOperation,
  settleWordOperation, sweepExpiredWordOperations,
} from '../src/aiQuota.js';
import { PILOT_CONFIG_DEFAULTS } from '../src/pilotConfig.js';

const describeWithEmulator = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;
const config = { ...PILOT_CONFIG_DEFAULTS };
const now = new Date('2026-09-24T00:00:00.000Z');

describeWithEmulator('Firestore account AI quota', () => {
  let app: App;
  let database: Firestore;

  beforeAll(() => {
    app = initializeApp({ projectId: 'demo-lingoflash' }, 'ai-quota-integration');
    database = getFirestore(app, 'ai-studio-945b4052-4462-4668-8936-277f09f07a37');
  });

  afterAll(async () => { await database.terminate(); await deleteApp(app); });

  it('counts 30 completed cards once and refuses the next distinct operation', async () => {
    const uid = `quota-${randomUUID()}`;
    for (let index = 0; index < 30; index += 1) {
      const operationId = randomUUID();
      const reservation = await reserveWordOperation(database, uid, operationId, `hash-${index}`, now, config);
      expect(reservation.kind).toBe('reserved');
      if (reservation.kind !== 'reserved') continue;
      expect(await settleWordOperation(database, uid, operationId, reservation.attemptId, { translation: 'xin chào' }, now)).toBe(true);
      const replay = await reserveWordOperation(database, uid, operationId, `hash-${index}`, now, config);
      expect(replay).toEqual({ kind: 'completed', result: { translation: 'xin chào' } });
    }
    await expect(reserveWordOperation(database, uid, randomUUID(), 'new', now, config))
      .rejects.toMatchObject({ reason: 'ai-card-quota', details: { used: 30, limit: 30 } });
    const usage = await database.collection('users').doc(uid).collection('ai_usage').doc(freePeriod(now, config).periodKey).get();
    expect(usage.data()?.used).toBe(30);
  }, 30_000);

  it('allows one concurrent reservation, takes over stale work, and ignores the old attempt', async () => {
    const uid = `concurrent-${randomUUID()}`;
    const operationId = randomUUID();
    const [first, second] = await Promise.allSettled([
      reserveWordOperation(database, uid, operationId, 'same', now, config),
      reserveWordOperation(database, uid, operationId, 'same', now, config),
    ]);
    const accepted = [first, second].filter(result => result.status === 'fulfilled');
    const refused = [first, second].filter(result => result.status === 'rejected');
    expect(accepted).toHaveLength(1);
    expect(refused).toHaveLength(1);
    const original = (accepted[0] as PromiseFulfilledResult<Awaited<ReturnType<typeof reserveWordOperation>>>).value;
    expect(original.kind).toBe('reserved');
    if (original.kind !== 'reserved') return;
    await expect(reserveWordOperation(database, uid, operationId, 'same', new Date(now.getTime() + 89_000), config))
      .rejects.toMatchObject({ reason: 'operation-in-flight' });
    const replacement = await reserveWordOperation(database, uid, operationId, 'same', new Date(now.getTime() + 91_000), config);
    expect(replacement.kind).toBe('reserved');
    if (replacement.kind !== 'reserved') return;
    expect(await settleWordOperation(database, uid, operationId, original.attemptId, null, now)).toBe(false);
    expect(await settleWordOperation(database, uid, operationId, replacement.attemptId, null, now)).toBe(true);
    expect(await settleWordOperation(database, uid, operationId, replacement.attemptId, null, now)).toBe(false);
    const usage = await database.collection('users').doc(uid).collection('ai_usage').doc(original.periodKey).get();
    expect(usage.data()?.used).toBe(0);
  }, 15_000);

  it('admits only one of two distinct concurrent requests at the last card slot', async () => {
    const uid = `last-slot-${randomUUID()}`;
    const singleSlot = { ...config, freeMonthlyAiCards: 1 };
    const [first, second] = await Promise.allSettled([
      reserveWordOperation(database, uid, randomUUID(), 'first', now, singleSlot),
      reserveWordOperation(database, uid, randomUUID(), 'second', now, singleSlot),
    ]);
    expect([first, second].filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect([first, second].filter(result => result.status === 'rejected')).toHaveLength(1);
    const usage = await database.collection('users').doc(uid).collection('ai_usage').doc(freePeriod(now, singleSlot).periodKey).get();
    expect(usage.data()?.used).toBe(1);
  }, 15_000);

  it('refunds an abandoned reservation through the sweeper once', async () => {
    const uid = `sweeper-${randomUUID()}`;
    const operationId = randomUUID();
    await reserveWordOperation(database, uid, operationId, 'same', now, config);
    const later = new Date(now.getTime() + 11 * 60_000);
    expect(await sweepExpiredWordOperations(database, later)).toBeGreaterThanOrEqual(1);
    expect(await sweepExpiredWordOperations(database, later)).toBe(0);
    const usage = await database.collection('users').doc(uid).collection('ai_usage').doc(freePeriod(now, config).periodKey).get();
    expect(usage.data()?.used).toBe(0);
  }, 15_000);

  it('limits non-card actions daily without touching the card quota and refunds failure', async () => {
    const uid = `allowance-${randomUUID()}`;
    for (let index = 0; index < 20; index += 1) await reserveNonCardAction(database, uid, now, config);
    await expect(reserveNonCardAction(database, uid, now, config))
      .rejects.toMatchObject({ reason: 'ai-daily-allowance', details: { used: 20, limit: 20 } });
    await refundNonCardAction(database, uid, '2026-09-24');
    await reserveNonCardAction(database, uid, now, config);
    const usage = await database.collection('users').doc(uid).collection('ai_usage').doc(freePeriod(now, config).periodKey).get();
    expect(usage.exists).toBe(false);
  }, 20_000);

  it('uses the active Pro daily allowance without extending its entitlement', async () => {
    const uid = `pro-allowance-${randomUUID()}`;
    const owner = database.collection('users').doc(uid);
    await owner.collection('profile').doc('plan').set({
      tier: 'pro', entitlementId: 'fixed-window',
      startsAt: new Date('2026-09-01T00:00:00.000Z'), expiresAt: new Date('2026-10-01T00:00:00.000Z'),
    });
    await owner.collection('ai_daily').doc('2026-09-24').set({ nonCardActions: 199 });
    await reserveNonCardAction(database, uid, now, config);
    await expect(reserveNonCardAction(database, uid, now, config))
      .rejects.toMatchObject({ reason: 'ai-daily-allowance', details: { used: 200, limit: 200 } });
  });
});
