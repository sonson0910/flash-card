import type { DocumentData, DocumentReference, DocumentSnapshot, Firestore, Transaction } from 'firebase-admin/firestore';
import { describe, expect, it, vi } from 'vitest';
import { InputValidationError } from '../src/inputValidation.js';
import { commitVerifiedGamification, equipOwnedFrame, prepareVerifiedGamification } from '../src/verifiedGamification.js';

const snapshot = (exists: boolean, data: DocumentData = {}): DocumentSnapshot => ({ exists, data: () => data } as DocumentSnapshot);

const harness = (documents: Record<string, DocumentData> = {}) => {
  const values = new Map(Object.entries(documents));
  const reads: string[] = [];
  const writes: Array<{ path: string; data: DocumentData }> = [];
  const transaction = {
    get: vi.fn(async (reference: DocumentReference) => {
      reads.push(reference.path);
      const value = values.get(reference.path);
      return snapshot(value !== undefined, value);
    }),
    set: vi.fn((reference: DocumentReference, data: DocumentData) => {
      writes.push({ path: reference.path, data });
      return transaction;
    }),
  } as unknown as Transaction;
  const document = (path: string) => ({ path, collection: (name: string) => collection(`${path}/${name}`) }) as unknown as DocumentReference;
  const collection = (path: string) => ({ doc: (id: string) => document(`${path}/${id}`) });
  const database = {
    collection: (name: string) => collection(name),
    runTransaction: vi.fn(async (callback: (value: Transaction) => Promise<unknown>) => callback(transaction)),
  } as unknown as Firestore;
  return { database, transaction, reads, writes };
};

const action = (overrides = {}) => ({
  kind: 'review' as const,
  receivedAt: new Date('2026-03-08T10:30:00.000Z'),
  timeZone: 'America/New_York',
  ...overrides,
});

describe('verified gamification', () => {
  it('uses the account timezone across DST and reads stats once without reading history', async () => {
    const test = harness();
    const prepared = await prepareVerifiedGamification(test.database, test.transaction, 'owner', action());
    expect(prepared.outcome).toMatchObject({ xp: 2, level: 1, streak: 1, studyDay: '2026-03-08' });
    expect(test.reads).toEqual(['users/owner/profile/stats']);
    commitVerifiedGamification(test.transaction, prepared);
    expect(test.writes.map(write => write.path)).toEqual(['users/owner/profile/stats', 'users/owner/profile/xp_history']);
    expect(test.writes[1].data).toMatchObject({ verifiedByDayV1: { '2026-03-08': expect.anything() } });
  });

  it('keeps the immutable stored timezone and only reviews advance the streak', async () => {
    const test = harness({ 'users/owner/profile/stats': {
      verifiedXp: 4, verifiedStreak: 5, lastVerifiedStudyDay: '2026-03-07', rewardTimeZone: 'America/New_York',
    } });
    const prepared = await prepareVerifiedGamification(test.database, test.transaction, 'owner', action({ kind: 'create', timeZone: 'Pacific/Auckland' }));
    expect(prepared.outcome).toMatchObject({ xp: 14, streak: 5, studyDay: '2026-03-08' });
    expect(prepared.statsPatch).not.toHaveProperty('rewardTimeZone');
  });

  it('grants both threshold rewards in one rewards read and caps inventory', async () => {
    const test = harness({
      'users/owner/profile/stats': { verifiedXp: 14_399, verifiedStreak: 29, lastVerifiedStudyDay: '2026-03-07', rewardTimeZone: 'UTC' },
      'users/owner/profile/rewards': { streakFreezes: 1, hintTokens: 3 },
    });
    const prepared = await prepareVerifiedGamification(test.database, test.transaction, 'owner', action({ timeZone: 'UTC' }));
    expect(prepared.outcome).toMatchObject({ xp: 14_401, level: 13, streak: 30, events: ['streak', 'levelup'] });
    expect(test.reads).toEqual(['users/owner/profile/stats', 'users/owner/profile/rewards']);
    commitVerifiedGamification(test.transaction, prepared);
    expect(test.writes.map(write => write.path)).toEqual(['users/owner/profile/stats', 'users/owner/profile/xp_history', 'users/owner/profile/rewards']);
    expect(test.writes[2].data).toMatchObject({ streakFreezes: 1, hintTokens: 3 });
  });

  it('does not replay a threshold ceremony with its fixed receipt', async () => {
    const test = harness({
      'users/owner/profile/stats': { verifiedXp: 14_399, verifiedStreak: 29, lastVerifiedStudyDay: '2026-03-07', rewardTimeZone: 'UTC' },
      'users/owner/profile/rewards': { receipts: { 'streak-30-v1': true, 'level-13-v1': true } },
    });
    const prepared = await prepareVerifiedGamification(test.database, test.transaction, 'owner', action({ timeZone: 'UTC' }));
    expect(prepared.outcome.events).toEqual([]);
    commitVerifiedGamification(test.transaction, prepared);
    expect(test.writes.map(write => write.path)).toEqual(['users/owner/profile/stats', 'users/owner/profile/xp_history']);
  });

  it('rejects invalid owners and an invalid initial timezone before writing', async () => {
    const test = harness();
    await expect(prepareVerifiedGamification(test.database, test.transaction, '../owner', action())).rejects.toBeInstanceOf(InputValidationError);
    await expect(prepareVerifiedGamification(test.database, test.transaction, 'owner', action({ timeZone: 'Not/AZone' }))).rejects.toBeInstanceOf(InputValidationError);
    expect(test.writes).toEqual([]);
  });

  it('equips only the owned allowed frame with one read and write', async () => {
    const test = harness({ 'users/owner/profile/rewards': { ownedFrameIds: ['crimson-wing'] } });
    await expect(equipOwnedFrame(test.database, 'owner', 'crimson-wing')).resolves.toEqual({ equippedFrameId: 'crimson-wing' });
    expect(test.reads).toEqual(['users/owner/profile/rewards']);
    expect(test.writes).toEqual([{ path: 'users/owner/profile/rewards', data: { equippedFrameId: 'crimson-wing' } }]);
  });
});
