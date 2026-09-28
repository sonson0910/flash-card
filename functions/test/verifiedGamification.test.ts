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
  targetLanguage: 'en',
  rating: 'good' as const,
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

  it('does not bootstrap review activity from a client timezone hint', async () => {
    const test = harness();
    const prepared = await prepareVerifiedGamification(test.database, test.transaction, 'owner', action());
    expect(prepared.statsPatch).toMatchObject({ rewardTimeZone: expect.any(String) });
    expect(prepared.statsPatch).not.toHaveProperty('reviewActivityV1');
    expect(prepared.outcome).not.toHaveProperty('reviewActivity');
    expect(test.reads).toEqual(['users/owner/profile/stats']);
  });

  it('keeps the immutable stored timezone and only reviews advance the streak', async () => {
    const test = harness({ 'users/owner/profile/stats': {
      verifiedXp: 4, verifiedStreak: 5, lastVerifiedStudyDay: '2026-03-07', rewardTimeZone: 'America/New_York',
    } });
    const prepared = await prepareVerifiedGamification(test.database, test.transaction, 'owner', action({ kind: 'create', timeZone: 'Pacific/Auckland' }));
    expect(prepared.outcome).toMatchObject({ xp: 14, streak: 5, studyDay: '2026-03-08' });
    expect(prepared.statsPatch).not.toHaveProperty('rewardTimeZone');
  });

  it('records the server-receipt local day, preserves languages, and trims review activity to 182 days', async () => {
    const days = Object.fromEntries(Array.from({ length: 182 }, (_, index) => {
      const day = new Date(Date.UTC(2025, 8, 7 + index)).toISOString().slice(0, 10);
      return [day, { reviewed: 1, again: 0, hard: 0, good: 1, easy: 0 }];
    }));
    const test = harness({ 'users/owner/profile/stats': {
      verifiedXp: 4, verifiedStreak: 5, lastVerifiedStudyDay: '2026-03-07', rewardTimeZone: 'America/New_York',
      reviewActivityV1: {
        coverageStartedOnByLanguage: { en: '2025-09-07', ko: '2026-03-07' },
        daysByLanguage: {
          en: days,
          ko: { '2026-03-07': { reviewed: 1, again: 0, hard: 0, good: 0, easy: 1 } },
        },
      },
    } });
    const prepared = await prepareVerifiedGamification(test.database, test.transaction, 'owner', action({
      receivedAt: new Date('2026-03-08T05:30:00.000Z'), targetLanguage: 'en', rating: 'hard',
    }));
    const activity = prepared.statsPatch.reviewActivityV1 as {
      coverageStartedOnByLanguage: Record<string, string>;
      daysByLanguage: Record<string, Record<string, { reviewed: number; hard: number }>>;
    };
    expect(Object.keys(activity.daysByLanguage.en)).toHaveLength(182);
    expect(activity.daysByLanguage.en['2025-09-07']).toBeUndefined();
    expect(activity.daysByLanguage.en['2025-09-08']).toMatchObject({ reviewed: 1 });
    expect(activity.daysByLanguage.en['2026-03-08']).toMatchObject({ reviewed: 1, hard: 1 });
    expect(activity.coverageStartedOnByLanguage).toEqual({ en: '2025-09-07', ko: '2026-03-07' });
    expect(activity.daysByLanguage.ko).toMatchObject({ '2026-03-07': { reviewed: 1 } });
  });

  it('drops sparse activity outside the calendar window while retaining both boundaries', async () => {
    const test = harness({ 'users/owner/profile/stats': {
      verifiedXp: 4, verifiedStreak: 5, lastVerifiedStudyDay: '2026-03-07', rewardTimeZone: 'UTC',
      reviewActivityV1: {
        coverageStartedOnByLanguage: { en: '2025-01-01' },
        daysByLanguage: { en: {
          '2025-01-01': { reviewed: 1, again: 1, hard: 0, good: 0, easy: 0 },
          '2025-09-08': { reviewed: 1, again: 0, hard: 1, good: 0, easy: 0 },
          '2026-03-07': { reviewed: 1, again: 0, hard: 0, good: 1, easy: 0 },
        } },
      },
    } });
    const prepared = await prepareVerifiedGamification(test.database, test.transaction, 'owner', action({
      receivedAt: new Date('2026-03-08T12:00:00.000Z'), targetLanguage: 'en', rating: 'easy', timeZone: 'UTC',
    }));
    const days = (prepared.statsPatch.reviewActivityV1 as { daysByLanguage: Record<string, Record<string, unknown>> }).daysByLanguage.en;
    expect(Object.keys(days)).toEqual(['2025-09-08', '2026-03-07', '2026-03-08']);
  });

  it('retains a newer activity day when a transaction retry records an older receipt day', async () => {
    const test = harness({ 'users/owner/profile/stats': {
      rewardTimeZone: 'UTC',
      reviewActivityV1: {
        coverageStartedOnByLanguage: { en: '2026-03-08' },
        daysByLanguage: { en: {
          '2026-03-08': { reviewed: 1, again: 0, hard: 0, good: 1, easy: 0 },
        } },
      },
    } });
    const prepared = await prepareVerifiedGamification(test.database, test.transaction, 'owner', action({
      receivedAt: new Date('2026-03-07T23:59:59.000Z'), timeZone: 'UTC', rating: 'easy',
    }));
    const days = (prepared.statsPatch.reviewActivityV1 as { daysByLanguage: Record<string, Record<string, unknown>> }).daysByLanguage.en;
    expect(days).toHaveProperty('2026-03-07');
    expect(days).toHaveProperty('2026-03-08');
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
