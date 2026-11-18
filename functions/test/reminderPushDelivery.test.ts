import { createHash } from 'node:crypto';
import { Timestamp, type DocumentData, type DocumentReference, type Firestore, type Query, type Transaction } from 'firebase-admin/firestore';
import { describe, expect, it, vi } from 'vitest';
import { claimDuePushReminder, currentPushTokensForClaim, sweepDuePushReminders } from '../src/reminderPushDelivery.js';

const now = new Date('2026-09-30T08:00:00Z');
const statePath = 'users/owner/reminderState/current';
const statsPath = 'users/owner/profile/stats';
const receiptPath = 'users/owner/reminderReceipts/2026-09-30_push';
const token = 'a'.repeat(64);

const harness = (
  lastReviewAt: Date | null = new Date('2026-09-29T08:00:00Z'),
  dueCount = 3,
  candidateCount = 1,
) => {
  const docs = new Map<string, DocumentData>([[statePath, {
    days: [3], sendAtLocal: '08:00', timezone: 'UTC', locale: 'en', quietHours: null,
    onlyIfNotStudiedToday: true, channels: { push: true, emailDigest: false },
    nextEligibleSendAt: Timestamp.fromDate(now), nextEligibleLocalDay: '2026-09-30',
    consecutiveIgnored: 0, lastPushReceiptId: null, lastEvaluatedSentAt: null,
    backoffSkipNext: false,
  }]]);
  docs.set(`pushTokenOwners/${createHash('sha256').update(token).digest('hex')}`, { ownerId: 'owner', bindingId: 'binding-1' });
  if (lastReviewAt) docs.set(statsPath, { lastVerifiedReviewAt: Timestamp.fromDate(lastReviewAt) });
  const writes: Array<{ operation: string; path: string }> = [];
  const reads = { candidateQueries: 0, dueCountAggregates: 0, stats: 0 };
  const tokenQuery = {} as Query;
  const ref = (path: string): DocumentReference => ({
    path,
    update: vi.fn(async (patch: DocumentData) => {
      writes.push({ operation: 'update', path });
      docs.set(path, { ...docs.get(path), ...patch });
    }),
  }) as unknown as DocumentReference;
  const stateRef = ref(statePath);
  const candidateRefs = Array.from({ length: candidateCount }, (_, index) => {
    if (index === 0) return stateRef;
    const ownerId = `owner-${index}`;
    const path = `users/${ownerId}/reminderState/current`;
    docs.set(path, { ...docs.get(statePath) });
    if (lastReviewAt) {
      docs.set(`users/${ownerId}/profile/stats`, { lastVerifiedReviewAt: Timestamp.fromDate(lastReviewAt) });
    }
    return ref(path);
  });
  let offset = 0;
  const collectionGroupQuery = {
    where: () => collectionGroupQuery, orderBy: () => collectionGroupQuery,
    startAfter: (cursor: { index: number }) => { offset = cursor.index + 1; return collectionGroupQuery; },
    limit: () => collectionGroupQuery,
    get: async () => {
      reads.candidateQueries++;
      return { docs: candidateRefs.map((ref, index) => ({ ref, index }))
        .slice(offset, offset + 100) };
    },
  };
  const collection = (path: string) => ({
    doc: (id: string) => path === 'users/owner/reminderState' && id === 'current' ? stateRef : ref(`${path}/${id}`),
    limit: () => tokenQuery,
    where: () => ({ count: () => ({ get: async () => {
      reads.dueCountAggregates++;
      return { data: () => ({ count: dueCount }) };
    } }) }),
  });
  const database = {
    collection: (name: string) => name === 'pushTokenOwners'
      ? { doc: (id: string) => ref(`${name}/${id}`) }
      : { doc: (ownerId: string) => ({ collection: (child: string) => collection(`users/${ownerId}/${child}`) }) },
    getAll: async (...refs: DocumentReference[]) => refs.map(value => ({ data: () => docs.get(value.path) })),
    collectionGroup: () => collectionGroupQuery,
    runTransaction: vi.fn(async (fn: (tx: Transaction) => Promise<unknown>) => fn({
      get: async (value: DocumentReference | Query) => {
        if (value === tokenQuery) return { docs: [{ id: 'token-1', data: () => ({ token }) }] };
        const path = (value as DocumentReference).path;
        if (/^users\/[^/]+\/profile\/stats$/.test(path)) reads.stats++;
        return { exists: docs.has(path), data: () => docs.get(path) };
      },
      update: (value: DocumentReference, patch: DocumentData) => {
        writes.push({ operation: 'update', path: value.path });
        docs.set(value.path, { ...docs.get(value.path), ...patch });
      },
      create: (value: DocumentReference, data: DocumentData) => {
        if (docs.has(value.path)) throw new Error('ALREADY_EXISTS');
        writes.push({ operation: 'create', path: value.path });
        docs.set(value.path, data);
      },
    } as unknown as Transaction)),
  } as unknown as Firestore;
  return { database, stateRef, docs, reads, writes, collectionGroupQuery };
};

describe('push reminder delivery', () => {
  it('claims once before sending and advances beyond the processed local day', async () => {
    const test = harness();
    const first = await claimDuePushReminder(test.database, test.stateRef, now);
    expect(first).toMatchObject({ ownerId: 'owner', scheduledDay: '2026-09-30', dueCount: 3,
      tokens: [{ id: 'token-1', token, registryId: createHash('sha256').update(token).digest('hex'), bindingId: 'binding-1' }] });
    expect(test.docs.get(receiptPath)).toMatchObject({ channel: 'push', claimedAt: expect.any(Timestamp) });
    expect(test.docs.get(statePath)?.nextEligibleLocalDay).toBe('2026-10-07');
    await expect(claimDuePushReminder(test.database, test.stateRef, now)).resolves.toBeNull();
    expect(test.writes.filter(write => write.operation === 'create' && write.path === receiptPath)).toHaveLength(1);
  });

  it('suppresses a missing verified timestamp or a review on the delivery day', async () => {
    for (const studied of [null, new Date('2026-09-30T01:00:00Z')]) {
      const test = harness(studied);
      await expect(claimDuePushReminder(test.database, test.stateRef, now)).resolves.toBeNull();
      expect(test.docs.has(receiptPath)).toBe(false);
      expect(test.docs.get(statePath)?.nextEligibleLocalDay).toBe('2026-10-07');
    }
  });

  it('does not claim or send a push when no cards are due', async () => {
    const test = harness(new Date('2026-09-29T08:00:00Z'), 0);
    const send = vi.fn(async () => 1);
    await expect(sweepDuePushReminders(test.database, send, now))
      .resolves.toEqual({ claimed: 0, sent: 0 });
    expect(send).not.toHaveBeenCalled();
    expect(test.docs.has(receiptPath)).toBe(false);
    expect(test.docs.get(statePath)?.nextEligibleLocalDay).toBe('2026-10-07');
  });

  it('defers a late candidate to quiet-hours end without changing its receipt day', async () => {
    const test = harness();
    test.docs.set(statePath, { ...test.docs.get(statePath),
      quietHours: { startLocal: '08:10', endLocal: '09:00' } });
    await expect(claimDuePushReminder(test.database, test.stateRef, new Date('2026-09-30T08:15:00Z')))
      .resolves.toBeNull();
    expect(test.docs.get(statePath)?.nextEligibleSendAt.toDate()).toEqual(new Date('2026-09-30T09:00:00Z'));
    expect(test.docs.get(statePath)?.nextEligibleLocalDay).toBe('2026-09-30');
    expect(test.docs.has(receiptPath)).toBe(false);

    const claim = await claimDuePushReminder(test.database, test.stateRef, new Date('2026-09-30T09:00:00Z'));
    expect(claim).toMatchObject({ scheduledDay: '2026-09-30' });
    expect(test.docs.has(receiptPath)).toBe(true);
  });

  it('does not revive a stale push merely because its next sweep falls in quiet hours', async () => {
    const test = harness();
    test.docs.set(statePath, { ...test.docs.get(statePath),
      quietHours: { startLocal: '08:10', endLocal: '09:00' },
      nextEligibleSendAt: Timestamp.fromDate(new Date('2026-09-23T08:00:00Z')),
      nextEligibleLocalDay: '2026-09-23',
    });
    await expect(claimDuePushReminder(test.database, test.stateRef, new Date('2026-09-30T08:15:00Z')))
      .resolves.toBeNull();
    expect(test.docs.get(statePath)?.nextEligibleLocalDay).toBe('2026-10-07');
    expect(test.docs.get(statePath)?.nextEligibleSendAt.toDate()).not.toEqual(new Date('2026-09-30T09:00:00Z'));
  });

  it('fails closed when a local token has no matching registry owner', async () => {
    for (const ownerId of [undefined, 'another-owner']) {
      const test = harness();
      const ownerRef = `pushTokenOwners/${createHash('sha256').update(token).digest('hex')}`;
      if (ownerId === undefined) test.docs.delete(ownerRef);
      else test.docs.set(ownerRef, { ownerId });
      await expect(claimDuePushReminder(test.database, test.stateRef, now)).resolves.toBeNull();
      expect(test.docs.has(receiptPath)).toBe(false);
      expect(test.docs.get(statePath)?.nextEligibleLocalDay).toBe('2026-10-07');
    }
  });

  it('filters a claimed token after ownership transfers before sending', async () => {
    const test = harness();
    const claim = await claimDuePushReminder(test.database, test.stateRef, now);
    expect(claim).not.toBeNull();
    test.docs.set(`pushTokenOwners/${createHash('sha256').update(token).digest('hex')}`, { ownerId: 'owner-b', bindingId: 'binding-2' });
    await expect(currentPushTokensForClaim(test.database, claim!)).resolves.toEqual([]);
  });

  it('records sentAt only after a successful send and evaluates only that result for backoff', async () => {
    const test = harness();
    const send = vi.fn(async () => {
      expect(test.docs.get(receiptPath)?.claimedAt).toBeInstanceOf(Timestamp);
      expect(test.docs.get(receiptPath)?.sentAt).toBeUndefined();
      return 1;
    });
    await expect(sweepDuePushReminders(test.database, send, now)).resolves.toEqual({ claimed: 1, sent: 1 });
    expect(send).toHaveBeenCalledOnce();
    expect(test.docs.get(receiptPath)?.sentAt).toBeInstanceOf(Timestamp);
    expect(test.writes.filter(write => write.operation === 'update' && write.path === receiptPath)).toHaveLength(1);
  });

  it('does not retry a claimed reminder when sending throws', async () => {
    const test = harness();
    const send = vi.fn(async () => { throw new Error('FCM unavailable'); });
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      await expect(sweepDuePushReminders(test.database, send, now)).resolves.toEqual({ claimed: 1, sent: 0 });
      await expect(sweepDuePushReminders(test.database, send, now)).resolves.toEqual({ claimed: 0, sent: 0 });
    } finally {
      error.mockRestore();
    }
    expect(send).toHaveBeenCalledOnce();
    expect(test.docs.get(receiptPath)?.sentAt).toBeUndefined();
    expect(test.writes.filter(write => write.operation === 'create' && write.path === receiptPath)).toHaveLength(1);
  });

  it('does not count a claimed but unsent push as ignored', async () => {
    const test = harness();
    await expect(sweepDuePushReminders(test.database, async () => 0, now))
      .resolves.toEqual({ claimed: 1, sent: 0 });
    expect(test.docs.get(receiptPath)?.sentAt).toBeUndefined();

    await claimDuePushReminder(test.database, test.stateRef, new Date('2026-10-07T08:00:00Z'));
    expect(test.docs.get(statePath)?.consecutiveIgnored).toBe(0);
  });

  it('backs off ignored sends through seven and resumes daily after study', async () => {
    const test = harness();
    const days = [
      '2026-09-30', '2026-10-07', '2026-10-14', '2026-10-21', '2026-10-28',
      '2026-11-04', '2026-11-11', '2026-11-18', '2026-11-25', '2026-12-02', '2026-12-09',
    ];
    const claimed = [] as boolean[];
    for (const day of days) {
      const at = new Date(`${day}T08:00:00Z`);
      const claim = await claimDuePushReminder(test.database, test.stateRef, at);
      claimed.push(claim !== null);
      if (claim) test.docs.set(claim.receiptRef.path, { ...test.docs.get(claim.receiptRef.path), sentAt: Timestamp.fromDate(at) });
    }
    expect(claimed).toEqual([true, true, true, true, false, true, false, true, false, true, false]);
    expect(test.docs.get(statePath)).toMatchObject({ consecutiveIgnored: 7, backoffSkipNext: false });

    test.docs.set(statsPath, { lastVerifiedReviewAt: Timestamp.fromDate(new Date('2026-12-10T08:00:00Z')) });
    await expect(claimDuePushReminder(test.database, test.stateRef, new Date('2026-12-16T08:00:00Z')))
      .resolves.not.toBeNull();
    expect(test.docs.get(statePath)).toMatchObject({ consecutiveIgnored: 0, backoffSkipNext: false });
  });

  it('reads stats and due counts once per candidate', async () => {
    const test = harness(new Date('2026-09-29T08:00:00Z'), 3, 2);
    await sweepDuePushReminders(test.database, async () => 1, now);
    expect(test.reads).toEqual({ candidateQueries: 1, dueCountAggregates: 2, stats: 2 });
  });

  it('reaches candidates after the first page of due states', async () => {
    const test = harness(new Date('2026-09-29T08:00:00Z'), 3, 101);
    const pageRead = vi.spyOn(test.collectionGroupQuery, 'get');
    await sweepDuePushReminders(test.database, async () => 1, now);
    expect(pageRead).toHaveBeenCalledTimes(2);
  });

  it('evaluates the tail of a due cohort larger than ten pages', async () => {
    const test = harness(new Date('2026-09-29T08:00:00Z'), 3, 1_001);
    await sweepDuePushReminders(test.database, async () => 1, now);
    expect(test.reads.candidateQueries).toBe(11);
    expect(test.docs.get('users/owner-1000/reminderState/current')?.nextEligibleLocalDay).toBe('2026-10-07');
  });

  it('leaves unstarted candidates due when the sweep time budget is reached', async () => {
    const test = harness(new Date('2026-09-29T08:00:00Z'), 3, 10);
    let elapsed = 0;
    const clock = vi.spyOn(performance, 'now').mockImplementation(() => elapsed);
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      await sweepDuePushReminders(test.database, async () => { elapsed = 240_001; return 1; }, now);
      expect(test.docs.get('users/owner-4/reminderState/current')?.nextEligibleLocalDay).toBe('2026-10-07');
      expect(test.docs.get('users/owner-5/reminderState/current')?.nextEligibleLocalDay).toBe('2026-09-30');
      expect(warning).toHaveBeenCalledWith('Push reminder sweep reached its time budget.', { processed: 5, failed: 0 });
      elapsed = 0;
      await sweepDuePushReminders(test.database, async () => 1, now);
      expect(test.docs.get('users/owner-9/reminderState/current')?.nextEligibleLocalDay).toBe('2026-10-07');
    } finally {
      clock.mockRestore();
      warning.mockRestore();
    }
  });
});
