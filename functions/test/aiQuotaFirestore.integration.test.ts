import { randomUUID } from 'node:crypto';
import { deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  cancelWordOperation, freePeriod, markWordOperationDelivered, refundNonCardAction, reserveNonCardAction,
  reserveWordOperation, settleWordOperation, sweepExpiredWordOperations, WORD_OPERATION_MAX_ATTEMPTS,
} from '../src/aiQuota.js';
import { grantPro } from '../src/entitlements.js';
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

  it('charges the Pro unit right after a grant stamped by an operator clock a few minutes ahead', async () => {
    const uid = `u-${randomUUID()}`;
    const serverNow = new Date();
    const free = freePeriod(serverNow, config);
    await database.collection('users').doc(uid).collection('ai_usage').doc(free.periodKey)
      .set({ periodKey: free.periodKey, tier: 'free', used: 30, limit: 30 });
    const grant = await grantPro(database, uid, config,
      { pidKey: 'x'.repeat(32), target: 'staging', operator: 'tester', reason: 'Pilot access' },
      new Date(serverNow.getTime() + 3 * 60_000));
    await expect(reserveWordOperation(database, uid, randomUUID(), 'hash', serverNow, config))
      .resolves.toMatchObject({ kind: 'reserved', periodKey: `pro-${grant.entitlementId}` });
  });

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

  it('cancels one reserved generation and refunds its card quota once', async () => {
    const uid = `cancel-${randomUUID()}`;
    const operationId = randomUUID();
    const reservation = await reserveWordOperation(database, uid, operationId, 'same', now, config);
    expect(reservation.kind).toBe('reserved');
    expect(await cancelWordOperation(database, uid, operationId, now)).toEqual({ cancelled: true, counted: false });
    expect(await cancelWordOperation(database, uid, operationId, now)).toEqual({ cancelled: false, counted: false });
    expect(await cancelWordOperation(database, uid, randomUUID(), now)).toEqual({ cancelled: false, counted: false });
    const owner = database.collection('users').doc(uid);
    expect((await owner.collection('ai_operations').doc(operationId).get()).data()?.status).toBe('failed');
    expect((await owner.collection('ai_usage').doc(freePeriod(now, config).periodKey).get()).data()?.used).toBe(0);
  });

  it('keeps the card unit once content was delivered, through cancel, failure, and sweep', async () => {
    const uid = `delivered-${randomUUID()}`;
    const owner = database.collection('users').doc(uid);
    const usedCards = async () => (await owner.collection('ai_usage').doc(freePeriod(now, config).periodKey).get()).data()?.used;
    const operationId = randomUUID();
    const reservation = await reserveWordOperation(database, uid, operationId, 'same', now, config);
    if (reservation.kind !== 'reserved') throw new Error('expected a reservation');
    expect(await markWordOperationDelivered(database, uid, operationId, 'another-attempt', now)).toBe(false);
    expect(await markWordOperationDelivered(database, uid, operationId, reservation.attemptId, now)).toBe(true);
    expect(await cancelWordOperation(database, uid, operationId, now)).toEqual({ cancelled: false, counted: true });
    expect((await owner.collection('ai_operations').doc(operationId).get()).data()?.status).toBe('reserved');
    expect(await settleWordOperation(database, uid, operationId, reservation.attemptId, null, now)).toBe(true);
    expect((await owner.collection('ai_operations').doc(operationId).get()).data()?.status).toBe('failed');
    expect(await usedCards()).toBe(1);
    expect(await cancelWordOperation(database, uid, operationId, now)).toEqual({ cancelled: false, counted: true });

    const abandoned = randomUUID();
    const stale = await reserveWordOperation(database, uid, abandoned, 'other', now, config);
    if (stale.kind !== 'reserved') throw new Error('expected a reservation');
    expect(await markWordOperationDelivered(database, uid, abandoned, stale.attemptId, now)).toBe(true);
    expect(await sweepExpiredWordOperations(database, new Date(now.getTime() + 11 * 60_000))).toBeGreaterThanOrEqual(1);
    expect((await owner.collection('ai_operations').doc(abandoned).get()).data()?.status).toBe('failed');
    expect(await usedCards()).toBe(2);
  }, 15_000);

  it('lets a retry of the same request after a delivered failure inherit the charged unit, at most three attempts', async () => {
    const uid = `inherit-${randomUUID()}`;
    const owner = database.collection('users').doc(uid);
    const usedCards = async () => (await owner.collection('ai_usage').doc(freePeriod(now, config).periodKey).get()).data()?.used;
    const operation = async (id: string) => (await owner.collection('ai_operations').doc(id).get()).data();
    const operationId = randomUUID();
    const first = await reserveWordOperation(database, uid, operationId, 'same', now, config);
    if (first.kind !== 'reserved') throw new Error('expected a reservation');
    expect(WORD_OPERATION_MAX_ATTEMPTS).toBe(3);
    expect((await operation(operationId))?.attempts).toBe(1);
    expect(await markWordOperationDelivered(database, uid, operationId, first.attemptId, now)).toBe(true);
    expect(await settleWordOperation(database, uid, operationId, first.attemptId, null, now)).toBe(true);
    expect(await usedCards()).toBe(1);

    // The second attempt runs on the unit the delivered failure kept; failing again refunds nothing.
    const second = await reserveWordOperation(database, uid, operationId, 'same', now, config);
    if (second.kind !== 'reserved') throw new Error('expected a reservation');
    expect(second.periodKey).toBe(first.periodKey);
    expect(second.attemptId).not.toBe(first.attemptId);
    expect(await usedCards()).toBe(1);
    expect(await operation(operationId)).toMatchObject({ status: 'reserved', attempts: 2 });
    expect((await operation(operationId))?.deliveredAt).toBeTruthy();
    expect(await cancelWordOperation(database, uid, operationId, now)).toEqual({ cancelled: false, counted: true });
    expect(await settleWordOperation(database, uid, operationId, second.attemptId, null, now)).toBe(true);
    expect(await usedCards()).toBe(1);

    // The third attempt is the last on this unit; it completes and its replay stays free.
    const third = await reserveWordOperation(database, uid, operationId, 'same', now, config);
    if (third.kind !== 'reserved') throw new Error('expected a reservation');
    expect(await usedCards()).toBe(1);
    expect(await settleWordOperation(database, uid, operationId, third.attemptId, { translation: 'kiên cường' }, now)).toBe(true);
    expect(await reserveWordOperation(database, uid, operationId, 'same', now, config))
      .toEqual({ kind: 'completed', result: { translation: 'kiên cường' } });
    expect(await usedCards()).toBe(1);
    expect(await cancelWordOperation(database, uid, operationId, now)).toEqual({ cancelled: false, counted: true });
  }, 20_000);

  it('refuses a fourth attempt on one unit, so retrying never avoids the charge for a new request', async () => {
    const uid = `exhausted-${randomUUID()}`;
    const owner = database.collection('users').doc(uid);
    const usedCards = async () => (await owner.collection('ai_usage').doc(freePeriod(now, config).periodKey).get()).data()?.used;
    const operationId = randomUUID();
    for (let attempt = 1; attempt <= WORD_OPERATION_MAX_ATTEMPTS; attempt += 1) {
      const reservation = await reserveWordOperation(database, uid, operationId, 'same', now, config);
      if (reservation.kind !== 'reserved') throw new Error('expected a reservation');
      expect(await markWordOperationDelivered(database, uid, operationId, reservation.attemptId, now)).toBe(true);
      expect(await settleWordOperation(database, uid, operationId, reservation.attemptId, null, now)).toBe(true);
    }
    expect(await usedCards()).toBe(1);
    await expect(reserveWordOperation(database, uid, operationId, 'same', now, config)).rejects.toMatchObject({
      reason: 'operation-attempts-exhausted', details: { attempts: 3, maxAttempts: 3 },
    });
    expect((await owner.collection('ai_operations').doc(operationId).get()).data()).toMatchObject({ status: 'failed', attempts: 3 });
    expect(await usedCards()).toBe(1);
    // The learner's next generation is a new operation, charged like any other.
    const next = await reserveWordOperation(database, uid, randomUUID(), 'same', now, config);
    expect(next.kind).toBe('reserved');
    expect(await usedCards()).toBe(2);
  }, 20_000);

  it('charges a new unit when a delivered failure is retried for a different request', async () => {
    const uid = `inherit-other-${randomUUID()}`;
    const owner = database.collection('users').doc(uid);
    const usedCards = async () => (await owner.collection('ai_usage').doc(freePeriod(now, config).periodKey).get()).data()?.used;
    const operationId = randomUUID();
    const first = await reserveWordOperation(database, uid, operationId, 'hash-a', now, config);
    if (first.kind !== 'reserved') throw new Error('expected a reservation');
    expect(await markWordOperationDelivered(database, uid, operationId, first.attemptId, now)).toBe(true);
    expect(await settleWordOperation(database, uid, operationId, first.attemptId, null, now)).toBe(true);
    const other = await reserveWordOperation(database, uid, operationId, 'hash-b', now, config);
    if (other.kind !== 'reserved') throw new Error('expected a reservation');
    expect(await usedCards()).toBe(2);
    expect((await owner.collection('ai_operations').doc(operationId).get()).data())
      .toMatchObject({ status: 'reserved', attempts: 1, deliveredAt: null });
    // Nothing of the new request was delivered, so its failure refunds its own unit only.
    expect(await settleWordOperation(database, uid, operationId, other.attemptId, null, now)).toBe(true);
    expect(await usedCards()).toBe(1);
  }, 15_000);

  it('charges again for a retry after a failure that delivered nothing, which had been refunded', async () => {
    const uid = `refunded-retry-${randomUUID()}`;
    const owner = database.collection('users').doc(uid);
    const usedCards = async () => (await owner.collection('ai_usage').doc(freePeriod(now, config).periodKey).get()).data()?.used;
    const operationId = randomUUID();
    const first = await reserveWordOperation(database, uid, operationId, 'same', now, config);
    if (first.kind !== 'reserved') throw new Error('expected a reservation');
    expect(await settleWordOperation(database, uid, operationId, first.attemptId, null, now)).toBe(true);
    expect(await usedCards()).toBe(0);
    const retried = await reserveWordOperation(database, uid, operationId, 'same', now, config);
    expect(retried.kind).toBe('reserved');
    expect(await usedCards()).toBe(1);
  }, 15_000);

  it('counts a takeover of stale work as an attempt and keeps an inherited unit through the sweeper', async () => {
    const uid = `takeover-attempts-${randomUUID()}`;
    const owner = database.collection('users').doc(uid);
    const usedCards = async () => (await owner.collection('ai_usage').doc(freePeriod(now, config).periodKey).get()).data()?.used;
    const operationId = randomUUID();
    const first = await reserveWordOperation(database, uid, operationId, 'same', now, config);
    if (first.kind !== 'reserved') throw new Error('expected a reservation');
    expect(await markWordOperationDelivered(database, uid, operationId, first.attemptId, now)).toBe(true);
    expect(await settleWordOperation(database, uid, operationId, first.attemptId, null, now)).toBe(true);
    const resumed = await reserveWordOperation(database, uid, operationId, 'same', now, config);
    if (resumed.kind !== 'reserved') throw new Error('expected a reservation');
    const takenOver = await reserveWordOperation(database, uid, operationId, 'same', new Date(now.getTime() + 91_000), config);
    if (takenOver.kind !== 'reserved') throw new Error('expected a reservation');
    expect((await owner.collection('ai_operations').doc(operationId).get()).data()).toMatchObject({ attempts: 3 });
    await expect(reserveWordOperation(database, uid, operationId, 'same', new Date(now.getTime() + 182_000), config))
      .rejects.toMatchObject({ reason: 'operation-attempts-exhausted' });
    expect(await sweepExpiredWordOperations(database, new Date(now.getTime() + 20 * 60_000))).toBeGreaterThanOrEqual(1);
    expect((await owner.collection('ai_operations').doc(operationId).get()).data()?.status).toBe('failed');
    expect(await usedCards()).toBe(1);
  }, 20_000);

  it('treats an operation recorded before attempts were counted as one attempt', async () => {
    const uid = `legacy-attempts-${randomUUID()}`;
    const owner = database.collection('users').doc(uid);
    const operationId = randomUUID();
    await owner.collection('ai_operations').doc(operationId).set({
      status: 'failed', attemptId: 'legacy', periodKey: freePeriod(now, config).periodKey, requestHash: 'same',
      reservedAt: now, deliveredAt: now, result: null,
    });
    await owner.collection('ai_usage').doc(freePeriod(now, config).periodKey).set({ used: 1 });
    const resumed = await reserveWordOperation(database, uid, operationId, 'same', now, config);
    expect(resumed.kind).toBe('reserved');
    expect((await owner.collection('ai_operations').doc(operationId).get()).data()?.attempts).toBe(2);
    expect((await owner.collection('ai_usage').doc(freePeriod(now, config).periodKey).get()).data()?.used).toBe(1);
  }, 15_000);

  it('refuses to mark delivery after a cancel has refunded the reservation', async () => {
    const uid = `cancel-first-${randomUUID()}`;
    const operationId = randomUUID();
    const reservation = await reserveWordOperation(database, uid, operationId, 'same', now, config);
    if (reservation.kind !== 'reserved') throw new Error('expected a reservation');
    expect(await cancelWordOperation(database, uid, operationId, now)).toEqual({ cancelled: true, counted: false });
    expect(await markWordOperationDelivered(database, uid, operationId, reservation.attemptId, now)).toBe(false);
    const usage = await database.collection('users').doc(uid).collection('ai_usage').doc(freePeriod(now, config).periodKey).get();
    expect(usage.data()?.used).toBe(0);
  });

  it('rejects a hash conflict on a live operation but allows a different hash once it failed', async () => {
    const uid = `hash-${randomUUID()}`;
    const operationId = randomUUID();
    const first = await reserveWordOperation(database, uid, operationId, 'hash-a', now, config);
    expect(first.kind).toBe('reserved');
    if (first.kind !== 'reserved') return;
    await expect(reserveWordOperation(database, uid, operationId, 'hash-b', now, config))
      .rejects.toMatchObject({ reason: 'operation-request-mismatch' });
    expect(await settleWordOperation(database, uid, operationId, first.attemptId, null, now)).toBe(true);
    const retried = await reserveWordOperation(database, uid, operationId, 'hash-b', now, config);
    expect(retried.kind).toBe('reserved');
    if (retried.kind !== 'reserved') return;
    expect(await settleWordOperation(database, uid, operationId, retried.attemptId, { translation: 'ok' }, now)).toBe(true);
    await expect(reserveWordOperation(database, uid, operationId, 'hash-c', now, config))
      .rejects.toMatchObject({ reason: 'operation-request-mismatch' });
    const replay = await reserveWordOperation(database, uid, operationId, 'hash-b', now, config);
    expect(replay).toEqual({ kind: 'completed', result: { translation: 'ok' } });
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
