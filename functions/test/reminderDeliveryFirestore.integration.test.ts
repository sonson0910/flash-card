import { createHash, randomUUID } from 'node:crypto';
import { deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { getFirestore, Query, Timestamp, Transaction, type Firestore } from 'firebase-admin/firestore';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { sweepDueWeeklyDigests } from '../src/reminderEmailDigest.js';
import { sweepDuePushReminders } from '../src/reminderPushDelivery.js';
import { endPushSessionForOwner, revokePushTokenForOwner, updateReminderSettingsForOwner } from '../src/reminderSettingsPersistence.js';

const describeWithEmulator = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;

describeWithEmulator('reminder delivery in Firestore', () => {
  let app: App;
  let database: Firestore;
  beforeAll(() => {
    app = initializeApp({ projectId: 'demo-lingoflash' }, `reminder-delivery-${randomUUID()}`);
    database = getFirestore(app, 'ai-studio-945b4052-4462-4668-8936-277f09f07a37');
  });
  afterAll(async () => { await database.terminate(); await deleteApp(app); });

  it('queues one push and one Sunday email for a due owner, then advances both schedules', async () => {
    const uid = `reminder-${randomUUID()}`;
    const owner = database.collection('users').doc(uid);
    const token = 'a'.repeat(64);
    const dueAt = new Date('2026-10-04T08:01:00.000Z');
    const mailRef = database.collection('mail').doc(`${uid}_2026-10-04_emailDigest`);
    try {
      await owner.collection('profile').doc('stats').set({
        lastVerifiedReviewAt: new Date('2026-10-03T08:00:00.000Z'), verifiedStreak: 4,
      });
      await owner.collection('cards').doc('card-1').set({ nextReviewDate: '2026-10-03T00:00:00.000Z' });
      await updateReminderSettingsForOwner(database, uid, {
        days: [0], sendAtLocal: '08:00', timezone: 'UTC', locale: 'en', quietHours: null,
        onlyIfNotStudiedToday: true, channels: { push: true, emailDigest: true }, pushToken: token,
      }, new Date('2026-10-03T08:00:00.000Z'));

      const send = vi.fn(async claim => {
        expect(claim).toMatchObject({ ownerId: uid, dueCount: 1, scheduledDay: '2026-10-04' });
        return 1;
      });
      expect(await sweepDuePushReminders(database, send, dueAt)).toEqual({ claimed: 1, sent: 1 });
      expect(send).toHaveBeenCalledOnce();
      expect((await owner.collection('reminderReceipts').doc('2026-10-04_push').get()).data()?.sentAt).toBeDefined();
      expect(await sweepDuePushReminders(database, send, dueAt)).toEqual({ claimed: 0, sent: 0 });

      const email = vi.fn(async () => 'learner@example.test');
      expect(await sweepDueWeeklyDigests(database, email, 'demo-lingoflash', dueAt)).toBe(1);
      expect((await mailRef.get()).data()).toMatchObject({
        ownerId: uid, to: ['learner@example.test'],
        message: { text: expect.stringContaining('1 card ready for review') },
      });
      const mailExpiresAt = (await mailRef.get()).data()?.expiresAt.toMillis();
      expect(mailExpiresAt - dueAt.getTime() - 30 * 86_400_000).toBeGreaterThanOrEqual(0);
      expect(mailExpiresAt - dueAt.getTime() - 30 * 86_400_000).toBeLessThan(60_000);
      expect(await sweepDueWeeklyDigests(database, email, 'demo-lingoflash', dueAt)).toBe(0);
      const state = (await owner.collection('reminderState').doc('current').get()).data();
      expect(state).toMatchObject({ nextEligibleLocalDay: '2026-10-11', nextWeeklyDigestLocalDay: '2026-10-11' });
    } finally {
      await database.recursiveDelete(owner);
      await mailRef.delete();
    }
  });

  it('advances a weekly digest without queuing mail when no cards are due', async () => {
    const uid = `reminder-empty-${randomUUID()}`;
    const owner = database.collection('users').doc(uid);
    const dueAt = new Date('2026-10-04T08:01:00.000Z');
    const mailRef = database.collection('mail').doc(`${uid}_2026-10-04_emailDigest`);
    try {
      await owner.collection('profile').doc('stats').set({
        lastVerifiedReviewAt: new Date('2026-10-03T08:00:00.000Z'), verifiedStreak: 4,
      });
      await updateReminderSettingsForOwner(database, uid, {
        days: [0], sendAtLocal: '08:00', timezone: 'UTC', locale: 'en', quietHours: null,
        onlyIfNotStudiedToday: true, channels: { push: false, emailDigest: true },
      }, new Date('2026-10-03T08:00:00.000Z'));

      const email = vi.fn(async () => 'learner@example.test');
      expect(await sweepDueWeeklyDigests(database, email, 'demo-lingoflash', dueAt)).toBe(0);
      expect(email).not.toHaveBeenCalled();
      expect((await owner.collection('reminderReceipts').doc('2026-10-04_emailDigest').get()).exists).toBe(false);
      expect((await mailRef.get()).exists).toBe(false);
      expect((await owner.collection('reminderState').doc('current').get()).data()?.nextWeeklyDigestLocalDay)
        .toBe('2026-10-11');
    } finally {
      await database.recursiveDelete(owner);
      await mailRef.delete();
    }
  });

  it('does not queue a weekly digest after a verified review on the delivery day', async () => {
    const uid = `reminder-studied-${randomUUID()}`;
    const owner = database.collection('users').doc(uid);
    const dueAt = new Date('2026-10-04T08:01:00.000Z');
    const mailRef = database.collection('mail').doc(`${uid}_2026-10-04_emailDigest`);
    try {
      await owner.collection('profile').doc('stats').set({
        lastVerifiedReviewAt: new Date('2026-10-04T07:00:00.000Z'), verifiedStreak: 4,
      });
      await owner.collection('cards').doc('card-1').set({ nextReviewDate: '2026-10-03T00:00:00.000Z' });
      await updateReminderSettingsForOwner(database, uid, {
        days: [0], sendAtLocal: '08:00', timezone: 'UTC', locale: 'en', quietHours: null,
        onlyIfNotStudiedToday: true, channels: { push: false, emailDigest: true },
      }, new Date('2026-10-03T08:00:00.000Z'));

      expect(await sweepDueWeeklyDigests(database, async () => 'learner@example.test', 'demo-lingoflash', dueAt)).toBe(0);
      expect((await owner.collection('reminderReceipts').doc('2026-10-04_emailDigest').get()).exists).toBe(false);
      expect((await mailRef.get()).exists).toBe(false);
      expect((await owner.collection('reminderState').doc('current').get()).data()?.nextWeeklyDigestLocalDay)
        .toBe('2026-10-11');
    } finally {
      await database.recursiveDelete(owner);
      await mailRef.delete();
    }
  });

  it('reads stats and due counts only for scheduled push candidates', async () => {
    const prefix = `reminder-scale-${randomUUID()}`;
    const now = new Date('2026-10-04T08:01:00.000Z');
    const owners = Array.from({ length: 22 }, (_, index) => database.collection('users').doc(`${prefix}-${index}`));
    const batch = database.batch();
    for (const [index, owner] of owners.entries()) {
      batch.set(owner.collection('reminderState').doc('current'), {
        days: [0], sendAtLocal: '08:00', timezone: 'UTC', locale: 'en', quietHours: null,
        onlyIfNotStudiedToday: true, channels: { push: true, emailDigest: false },
        nextEligibleSendAt: Timestamp.fromDate(new Date(index < 2
          ? '2026-10-04T08:00:00.000Z' : '2026-10-11T08:00:00.000Z')),
        nextEligibleLocalDay: index < 2 ? '2026-10-04' : '2026-10-11',
        consecutiveIgnored: 0, lastPushReceiptId: null, lastEvaluatedSentAt: null,
        backoffSkipNext: false,
      });
      if (index < 2) {
        batch.set(owner.collection('profile').doc('stats'), {
          lastVerifiedReviewAt: new Date('2026-10-03T08:00:00.000Z'),
        });
        batch.set(owner.collection('cards').doc('card-1'), {
          nextReviewDate: '2026-10-03T00:00:00.000Z',
        });
      }
    }
    await batch.commit();
    const transactionGet = vi.spyOn(Transaction.prototype, 'get');
    const candidateGet = vi.spyOn(Query.prototype, 'get');
    const aggregate = owners[0].collection('cards').where('nextReviewDate', '<=', now.toISOString()).count();
    const aggregateGet = vi.spyOn(Object.getPrototypeOf(aggregate), 'get');
    try {
      expect(await sweepDuePushReminders(database, async () => 1, now)).toEqual({ claimed: 0, sent: 0 });
      expect(candidateGet).toHaveBeenCalledTimes(1);
      expect(transactionGet.mock.calls.filter(([reference]) => {
        const path = (reference as { path?: unknown }).path;
        return typeof path === 'string' && path.endsWith('/profile/stats');
      })).toHaveLength(2);
      expect(aggregateGet).toHaveBeenCalledTimes(2);
    } finally {
      aggregateGet.mockRestore();
      candidateGet.mockRestore();
      transactionGet.mockRestore();
      await Promise.all(owners.map(owner => database.recursiveDelete(owner)));
    }
  });

  it('advances every equal-time push candidate across a Firestore page boundary', async () => {
    const prefix = `reminder-page-${randomUUID()}`;
    const dueAt = new Date('2026-10-04T08:01:00.000Z');
    const owners = Array.from({ length: 101 }, (_, index) => database.collection('users').doc(`${prefix}-${index}`));
    const batch = database.batch();
    for (const owner of owners) {
      batch.set(owner.collection('reminderState').doc('current'), {
        days: [0], sendAtLocal: '08:00', timezone: 'UTC', locale: 'en', quietHours: null,
        onlyIfNotStudiedToday: true, channels: { push: true, emailDigest: false },
        nextEligibleSendAt: Timestamp.fromDate(new Date('2026-10-04T08:00:00.000Z')),
        nextEligibleLocalDay: '2026-10-04', consecutiveIgnored: 0,
        lastPushReceiptId: null, lastEvaluatedSentAt: null, backoffSkipNext: false,
      });
    }
    await batch.commit();
    try {
      expect(await sweepDuePushReminders(database, async () => 1, dueAt)).toEqual({ claimed: 0, sent: 0 });
      expect(await sweepDuePushReminders(database, async () => 1, dueAt)).toEqual({ claimed: 0, sent: 0 });
      const final = await Promise.all(owners.map(async owner =>
        (await owner.collection('reminderState').doc('current').get()).data()?.nextEligibleLocalDay));
      expect(final).toEqual(Array(101).fill('2026-10-11'));
    } finally {
      await Promise.all(owners.map(owner => database.recursiveDelete(owner)));
    }
  }, 60_000);

  it('transfers a token atomically and keeps stale owner revocation from deleting its registry', async () => {
    const ownerAId = `reminder-a-${randomUUID()}`;
    const ownerBId = `reminder-b-${randomUUID()}`;
    const ownerCId = `reminder-c-${randomUUID()}`;
    const ownerA = database.collection('users').doc(ownerAId);
    const ownerB = database.collection('users').doc(ownerBId);
    const ownerC = database.collection('users').doc(ownerCId);
    const token = 'b'.repeat(64);
    const tokenId = createHash('sha256').update(token).digest('hex');
    const ownerRef = database.collection('pushTokenOwners').doc(tokenId);
    try {
      await updateReminderSettingsForOwner(database, ownerAId, {
        days: [0], sendAtLocal: '08:00', timezone: 'UTC', locale: 'en', quietHours: null,
        onlyIfNotStudiedToday: true, channels: { push: true, emailDigest: false }, pushToken: token,
      }, new Date('2026-10-03T08:00:00.000Z'));
      await Promise.all([ownerB, ownerC].flatMap(owner => [
        owner.collection('profile').doc('stats').set({ lastVerifiedReviewAt: new Date('2026-10-03T08:00:00.000Z') }),
        owner.collection('cards').doc('card-1').set({ nextReviewDate: '2026-10-03T00:00:00.000Z' }),
      ]));
      const input = {
        days: [0], sendAtLocal: '08:00', timezone: 'UTC' as const, locale: 'en' as const, quietHours: null,
        onlyIfNotStudiedToday: true, channels: { push: true, emailDigest: false }, pushToken: token,
      };
      await Promise.all([
        updateReminderSettingsForOwner(database, ownerBId, input, new Date('2026-10-03T08:00:00.000Z')),
        updateReminderSettingsForOwner(database, ownerCId, input, new Date('2026-10-03T08:00:00.000Z')),
      ]);

      expect((await ownerA.collection('pushTokens').doc(tokenId).get()).exists).toBe(false);
      expect((await ownerA.collection('reminderState').doc('current').get()).data()?.channels.push).toBe(false);
      const finalOwnerId = (await ownerRef.get()).data()?.ownerId;
      expect([ownerBId, ownerCId]).toContain(finalOwnerId);
      const finalOwner = finalOwnerId === ownerBId ? ownerB : ownerC;
      const displacedOwner = finalOwnerId === ownerBId ? ownerC : ownerB;
      expect((await finalOwner.collection('pushTokens').doc(tokenId).get()).exists).toBe(true);
      expect((await displacedOwner.collection('pushTokens').doc(tokenId).get()).exists).toBe(false);
      await expect(revokePushTokenForOwner(database, ownerAId, token)).resolves.toBe(false);
      expect((await ownerRef.get()).data()?.ownerId).toBe(finalOwnerId);
      const send = vi.fn(async claim => {
        expect(claim.ownerId).toBe(finalOwnerId);
        return 1;
      });
      expect(await sweepDuePushReminders(database, send, new Date('2026-10-04T08:01:00.000Z')))
        .toEqual({ claimed: 1, sent: 1 });
    } finally {
      await database.recursiveDelete(ownerA);
      await database.recursiveDelete(ownerB);
      await database.recursiveDelete(ownerC);
      await ownerRef.delete();
    }
  });

  it('does not claim a reminder when its local token is no longer registered', async () => {
    const uid = `reminder-unregistered-${randomUUID()}`;
    const owner = database.collection('users').doc(uid);
    const token = 'c'.repeat(64);
    const registryRef = database.collection('pushTokenOwners').doc(createHash('sha256').update(token).digest('hex'));
    try {
      await owner.collection('profile').doc('stats').set({ lastVerifiedReviewAt: new Date('2026-10-03T08:00:00.000Z') });
      await owner.collection('cards').doc('card-1').set({ nextReviewDate: '2026-10-03T00:00:00.000Z' });
      await updateReminderSettingsForOwner(database, uid, {
        days: [0], sendAtLocal: '08:00', timezone: 'UTC', locale: 'en', quietHours: null,
        onlyIfNotStudiedToday: true, channels: { push: true, emailDigest: false }, pushToken: token,
      }, new Date('2026-10-03T08:00:00.000Z'));
      await registryRef.delete();
      const send = vi.fn(async () => 1);
      expect(await sweepDuePushReminders(database, send, new Date('2026-10-04T08:01:00.000Z')))
        .toEqual({ claimed: 0, sent: 0 });
      expect(send).not.toHaveBeenCalled();
      expect((await owner.collection('reminderReceipts').doc('2026-10-04_push').get()).exists).toBe(false);
    } finally {
      await database.recursiveDelete(owner);
      await registryRef.delete();
    }
  });

  it('ends every registered push token after the browser loses its local token', async () => {
    const uid = `reminder-end-session-${randomUUID()}`;
    const owner = database.collection('users').doc(uid);
    const token = 'd'.repeat(64);
    const tokenId = createHash('sha256').update(token).digest('hex');
    const registryRef = database.collection('pushTokenOwners').doc(tokenId);
    try {
      await updateReminderSettingsForOwner(database, uid, {
        days: [0], sendAtLocal: '08:00', timezone: 'UTC', locale: 'en', quietHours: null,
        onlyIfNotStudiedToday: true, channels: { push: true, emailDigest: false }, pushToken: token,
      }, new Date('2026-10-03T08:00:00.000Z'), 100);

      await endPushSessionForOwner(database, uid, 100, new Date('2026-10-03T09:00:00.000Z'));
      expect((await owner.collection('pushTokens').doc(tokenId).get()).exists).toBe(false);
      expect((await registryRef.get()).exists).toBe(false);
      expect((await owner.collection('pushTokenSessionCutoffs').doc(tokenId).get()).data())
        .toMatchObject({ authTimeSeconds: 100 });
      expect((await owner.collection('pushTokenSessionCutoffs').doc('session').get()).data())
        .toMatchObject({ authTimeSeconds: 100 });
      expect((await owner.collection('reminderState').doc('current').get()).data())
        .toMatchObject({ channels: { push: false }, nextEligibleSendAt: null });
      await expect(updateReminderSettingsForOwner(database, uid, {
        days: [0], sendAtLocal: '08:00', timezone: 'UTC', locale: 'en', quietHours: null,
        onlyIfNotStudiedToday: true, channels: { push: true, emailDigest: false }, pushToken: token,
      }, new Date('2026-10-03T10:00:00.000Z'), 100)).rejects.toThrow('Push token session has ended.');
      await expect(endPushSessionForOwner(database, uid, 100, new Date('2026-10-03T10:00:00.000Z'))).resolves.toBeUndefined();
      const unseenToken = 'e'.repeat(64);
      await expect(updateReminderSettingsForOwner(database, uid, {
        days: [0], sendAtLocal: '08:00', timezone: 'UTC', locale: 'en', quietHours: null,
        onlyIfNotStudiedToday: true, channels: { push: true, emailDigest: false }, pushToken: unseenToken,
      }, new Date('2026-10-03T10:00:00.000Z'), 100)).rejects.toThrow('Push token session has ended.');
      await expect(updateReminderSettingsForOwner(database, uid, {
        days: [0], sendAtLocal: '08:00', timezone: 'UTC', locale: 'en', quietHours: null,
        onlyIfNotStudiedToday: true, channels: { push: true, emailDigest: false }, pushToken: unseenToken,
      }, new Date('2026-10-03T10:00:00.000Z'), 101)).resolves.toMatchObject({ channels: { push: true } });
    } finally {
      await database.recursiveDelete(owner);
      await registryRef.delete();
    }
  });
});
