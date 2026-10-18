import { Timestamp, type DocumentData, type DocumentReference, type Firestore, type Transaction } from 'firebase-admin/firestore';
import { describe, expect, it, vi } from 'vitest';
import { enqueueWeeklyDigest, MAIL_RETENTION_MS, sweepDueWeeklyDigests } from '../src/reminderEmailDigest.js';

const now = new Date('2026-10-04T08:00:00Z');
const statePath = 'users/owner/reminderState/current';
const receiptPath = 'users/owner/reminderReceipts/2026-10-04_emailDigest';
const mailPath = 'mail/owner_2026-10-04_emailDigest';

const harness = (dueCount = 7, candidateCount = 1) => {
  const docs = new Map<string, DocumentData>([[statePath, {
    timezone: 'UTC', locale: 'en', sendAtLocal: '08:00', quietHours: null,
    channels: { push: false, emailDigest: true },
    nextWeeklyDigestAt: Timestamp.fromDate(now), nextWeeklyDigestLocalDay: '2026-10-04',
  }], ['users/owner/profile/stats', {
    lastVerifiedReviewAt: Timestamp.fromDate(new Date('2026-10-03T08:00:00Z')),
    verifiedStreak: 4,
  }]]);
  const writes: string[] = [];
  const ref = (path: string): DocumentReference => ({ path }) as DocumentReference;
  const candidateRefs = Array.from({ length: candidateCount }, (_, index) => {
    if (index === 0) return ref(statePath);
    const owner = `owner-${index}`;
    docs.set(`users/${owner}/reminderState/current`, { ...docs.get(statePath) });
    docs.set(`users/${owner}/profile/stats`, { ...docs.get('users/owner/profile/stats') });
    return ref(`users/${owner}/reminderState/current`);
  });
  let offset = 0;
  let candidateQueries = 0;
  const candidateQuery = {
    where: () => candidateQuery, orderBy: () => candidateQuery,
    startAfter: (cursor: { index: number }) => { offset = cursor.index + 1; return candidateQuery; },
    limit: () => candidateQuery,
    get: async () => {
      candidateQueries++;
      return { docs: candidateRefs.map((candidate, index) => ({ ref: candidate, index })).slice(offset, offset + 100) };
    },
  };
  const collection = (path: string) => ({
    doc: (id: string) => ref(`${path}/${id}`),
    where: () => ({ count: () => ({ get: async () => ({ data: () => ({ count: dueCount }) }) }) }),
  });
  const database = {
    collectionGroup: () => candidateQuery,
    collection: (name: string) => name === 'mail' ? collection('mail') : {
      doc: (ownerId: string) => ({ collection: (child: string) => collection(`users/${ownerId}/${child}`) }),
    },
    runTransaction: vi.fn(async (fn: (transaction: Transaction) => Promise<boolean>) => fn({
      get: async (reference: DocumentReference) => ({
        exists: docs.has(reference.path), data: () => docs.get(reference.path),
      }),
      update: (reference: DocumentReference, patch: DocumentData) => {
        writes.push(reference.path);
        docs.set(reference.path, { ...docs.get(reference.path), ...patch });
      },
      create: (reference: DocumentReference, data: DocumentData) => {
        if (docs.has(reference.path)) throw new Error('ALREADY_EXISTS');
        writes.push(reference.path);
        docs.set(reference.path, data);
      },
    } as unknown as Transaction)),
  } as unknown as Firestore;
  return { database, docs, writes, stateRef: ref(statePath), candidateQueries: () => candidateQueries };
};

describe('weekly email digest', () => {
  it('atomically enqueues one real recap and receipt for a verified address', async () => {
    const test = harness();
    const email = vi.fn(async () => 'learner@example.com');
    await expect(enqueueWeeklyDigest(test.database, test.stateRef, email, 'demo-lingoflash', now)).resolves.toBe(true);
    expect(test.writes).toEqual([statePath, receiptPath, mailPath]);
    expect(test.docs.get(mailPath)).toEqual({
      ownerId: 'owner',
      to: ['learner@example.com'],
      message: { subject: 'Your SonFlash weekly recap',
        text: expect.stringContaining('7 cards ready for review. Current study streak: 4 days') },
      expiresAt: Timestamp.fromDate(new Date(now.getTime() + MAIL_RETENTION_MS)),
    });
    expect(test.docs.get(receiptPath)).toMatchObject({ channel: 'emailDigest' });
    await expect(enqueueWeeklyDigest(test.database, test.stateRef, email, 'demo-lingoflash', now)).resolves.toBe(false);
    expect(test.writes.filter(path => path === mailPath)).toHaveLength(1);
  });

  it('puts the staging origin in queued email links', async () => {
    const test = harness();
    await expect(enqueueWeeklyDigest(test.database, test.stateRef,
      async () => 'learner@example.com', 'sonflash-staging-20260906', now)).resolves.toBe(true);
    expect(test.docs.get(mailPath)?.message?.text).toContain('https://sonflash-staging-20260906.web.app/?view=today');
    expect(test.docs.get(mailPath)?.message?.text).not.toContain('https://sonflash.app');
  });

  it('advances the schedule without enqueuing when consent lacks a verified email or study signal', async () => {
    for (const missing of ['email', 'study'] as const) {
      const test = harness();
      if (missing === 'study') test.docs.delete('users/owner/profile/stats');
      const email = async () => missing === 'email' ? null : 'learner@example.com';
      await expect(enqueueWeeklyDigest(test.database, test.stateRef, email, 'demo-lingoflash', now)).resolves.toBe(false);
      expect(test.docs.has(receiptPath)).toBe(false);
      expect(test.docs.has(mailPath)).toBe(false);
      expect(test.docs.get(statePath)?.nextWeeklyDigestLocalDay).toBe('2026-10-11');
    }
  });

  it('advances the schedule without a receipt or mail when no cards are due', async () => {
    const test = harness(0);
    const getVerifiedEmail = vi.fn(async () => 'learner@example.com');
    await expect(enqueueWeeklyDigest(test.database, test.stateRef, getVerifiedEmail, 'demo-lingoflash', now)).resolves.toBe(false);
    expect(getVerifiedEmail).not.toHaveBeenCalled();
    expect(test.writes).toEqual([statePath]);
    expect(test.docs.has(receiptPath)).toBe(false);
    expect(test.docs.has(mailPath)).toBe(false);
    expect(test.docs.get(statePath)?.nextWeeklyDigestLocalDay).toBe('2026-10-11');
  });

  it('defers a late digest to quiet-hours end without changing its receipt day', async () => {
    const test = harness();
    test.docs.set(statePath, { ...test.docs.get(statePath),
      quietHours: { startLocal: '08:10', endLocal: '09:00' } });
    const email = vi.fn(async () => 'learner@example.com');
    await expect(enqueueWeeklyDigest(test.database, test.stateRef, email, 'demo-lingoflash', new Date('2026-10-04T08:15:00Z')))
      .resolves.toBe(false);
    expect(test.docs.get(statePath)?.nextWeeklyDigestAt.toDate()).toEqual(new Date('2026-10-04T09:00:00Z'));
    expect(test.docs.get(statePath)?.nextWeeklyDigestLocalDay).toBe('2026-10-04');
    expect(test.docs.has(mailPath)).toBe(false);

    await expect(enqueueWeeklyDigest(test.database, test.stateRef, email, 'demo-lingoflash', new Date('2026-10-04T09:00:00Z')))
      .resolves.toBe(true);
    expect(test.docs.has(receiptPath)).toBe(true);
    expect(test.docs.has(mailPath)).toBe(true);
  });

  it('does not revive a stale digest merely because its next sweep falls in quiet hours', async () => {
    const test = harness();
    test.docs.set(statePath, { ...test.docs.get(statePath),
      quietHours: { startLocal: '08:10', endLocal: '09:00' },
      nextWeeklyDigestAt: Timestamp.fromDate(new Date('2026-09-27T08:00:00Z')),
      nextWeeklyDigestLocalDay: '2026-09-27',
    });
    await expect(enqueueWeeklyDigest(test.database, test.stateRef,
      async () => 'learner@example.com', 'demo-lingoflash', new Date('2026-10-04T08:15:00Z')))
      .resolves.toBe(false);
    expect(test.docs.get(statePath)?.nextWeeklyDigestLocalDay).toBe('2026-10-11');
    expect(test.docs.get(statePath)?.nextWeeklyDigestAt.toDate()).not.toEqual(new Date('2026-10-04T09:00:00Z'));
    expect(test.docs.has(mailPath)).toBe(false);
  });

  it('respects the only-if-not-studied-today setting for the weekly digest', async () => {
    for (const onlyIfNotStudiedToday of [true, false]) {
      const test = harness();
      test.docs.set(statePath, { ...test.docs.get(statePath), onlyIfNotStudiedToday });
      test.docs.set('users/owner/profile/stats', {
        lastVerifiedReviewAt: Timestamp.fromDate(new Date('2026-10-04T01:00:00Z')),
        verifiedStreak: 4,
      });
      const queued = await enqueueWeeklyDigest(test.database, test.stateRef,
        async () => 'learner@example.com', 'demo-lingoflash', now);
      expect(queued).toBe(!onlyIfNotStudiedToday);
      expect(test.docs.has(receiptPath)).toBe(!onlyIfNotStudiedToday);
      expect(test.docs.has(mailPath)).toBe(!onlyIfNotStudiedToday);
      expect(test.docs.get(statePath)?.nextWeeklyDigestLocalDay).toBe('2026-10-11');
    }
  });

  it('evaluates the tail of a due cohort larger than ten pages', async () => {
    const test = harness(0, 1_001);
    await expect(sweepDueWeeklyDigests(test.database, async () => null, 'demo-lingoflash', now))
      .resolves.toBe(0);
    expect(test.candidateQueries()).toBe(11);
    expect(test.docs.get('users/owner-1000/reminderState/current')?.nextWeeklyDigestLocalDay).toBe('2026-10-11');
  });

  it('leaves unstarted digests due when the sweep time budget is reached', async () => {
    const test = harness(7, 10);
    let elapsed = 0;
    const clock = vi.spyOn(performance, 'now').mockImplementation(() => elapsed);
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      await sweepDueWeeklyDigests(test.database, async () => { elapsed = 240_001; return 'learner@example.com'; }, 'demo-lingoflash', now);
      expect(test.docs.get('users/owner-4/reminderState/current')?.nextWeeklyDigestLocalDay).toBe('2026-10-11');
      expect(test.docs.get('users/owner-5/reminderState/current')?.nextWeeklyDigestLocalDay).toBe('2026-10-04');
      expect(warning).toHaveBeenCalledWith('Weekly digest sweep reached its time budget.', { processed: 5, failed: 0 });
      elapsed = 0;
      await sweepDueWeeklyDigests(test.database, async () => null, 'demo-lingoflash', now);
      expect(test.docs.get('users/owner-9/reminderState/current')?.nextWeeklyDigestLocalDay).toBe('2026-10-11');
    } finally {
      clock.mockRestore();
      warning.mockRestore();
    }
  });
});
