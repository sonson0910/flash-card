import type { DocumentData, DocumentReference, DocumentSnapshot, Firestore, Transaction } from 'firebase-admin/firestore';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { describe, expect, it, vi } from 'vitest';
import { InputValidationError } from '../src/inputValidation.js';
import { commitVerifiedGamification, equipOwnedFrame, prepareVerifiedGamification, reviewXpAwardId } from '../src/verifiedGamification.js';
import { CREATE_CARD_XP, MATCH_WIN_XP, REVIEW_CARD_XP } from '../src/xp-rules.js';

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
    create: vi.fn((reference: DocumentReference, data: DocumentData) => {
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

const awardPath = (cardId: string, studyDay: string) => `users/owner/review_xp_awards/${reviewXpAwardId(cardId, studyDay)}`;

const action = (overrides = {}) => ({
  kind: 'review' as const,
  receivedAt: new Date('2026-03-08T10:30:00.000Z'),
  timeZone: 'America/New_York',
  targetLanguage: 'en',
  rating: 'good' as const,
  cardId: 'word-focus',
  ...overrides,
});

describe('verified gamification', () => {
  it('uses the account timezone across DST and reads stats once without reading history', async () => {
    const test = harness();
    const prepared = await prepareVerifiedGamification(test.database, test.transaction, 'owner', action());
    expect(prepared.outcome).toMatchObject({ xp: 2, level: 1, streak: 1, studyDay: '2026-03-08' });
    expect(test.reads).toEqual(['users/owner/profile/stats', awardPath('word-focus', '2026-03-08')]);
    commitVerifiedGamification(test.transaction, prepared);
    expect(test.writes.map(write => write.path)).toEqual(['users/owner/profile/stats', 'users/owner/profile/xp_history', awardPath('word-focus', '2026-03-08')]);
    expect((test.writes[0].data.lastVerifiedReviewAt as Timestamp).toDate()).toEqual(action().receivedAt);
    expect(test.writes[1].data).toMatchObject({ verifiedByDayV1: { '2026-03-08': expect.anything() } });
  });

  it('does not bootstrap review activity from a client timezone hint', async () => {
    const test = harness();
    const prepared = await prepareVerifiedGamification(test.database, test.transaction, 'owner', action());
    expect(prepared.statsPatch).toMatchObject({ rewardTimeZone: expect.any(String) });
    expect(prepared.statsPatch).not.toHaveProperty('reviewActivityV1');
    expect(prepared.outcome).not.toHaveProperty('reviewActivity');
    expect(test.reads).toEqual(['users/owner/profile/stats', awardPath('word-focus', '2026-03-08')]);
  });

  it('keeps the immutable stored timezone and only reviews advance the streak', async () => {
    const test = harness({ 'users/owner/profile/stats': {
      verifiedXp: 4, verifiedStreak: 5, lastVerifiedStudyDay: '2026-03-07', rewardTimeZone: 'America/New_York',
    } });
    const prepared = await prepareVerifiedGamification(test.database, test.transaction, 'owner', action({ kind: 'create', timeZone: 'Pacific/Auckland' }));
    expect(prepared.outcome).toMatchObject({ xp: 14, streak: 5, studyDay: '2026-03-08' });
    expect(prepared.statsPatch).not.toHaveProperty('rewardTimeZone');
    expect(prepared.statsPatch).not.toHaveProperty('lastVerifiedReviewAt');
  });

  it('does not move the verified review timestamp backwards when transactions finish out of order', async () => {
    const newer = Timestamp.fromDate(new Date('2026-03-08T11:00:00.000Z'));
    const test = harness({ 'users/owner/profile/stats': {
      verifiedXp: 4, verifiedStreak: 1, lastVerifiedStudyDay: '2026-03-08', rewardTimeZone: 'UTC',
      lastVerifiedReviewAt: newer,
    } });
    const prepared = await prepareVerifiedGamification(test.database, test.transaction, 'owner', action({ timeZone: 'UTC' }));
    expect(prepared.statsPatch).not.toHaveProperty('lastVerifiedReviewAt');
    commitVerifiedGamification(test.transaction, prepared);
    expect(test.reads).toEqual(['users/owner/profile/stats', awardPath('word-focus', '2026-03-08')]);
    expect(test.writes.map(write => write.path)).toEqual(['users/owner/profile/stats', 'users/owner/profile/xp_history', awardPath('word-focus', '2026-03-08')]);
  });

  it.each(['again', 'good'] as const)('awards %s the same two XP on a new local day', async rating => {
    const test = harness({ 'users/owner/profile/stats': {
      verifiedXp: 10, verifiedStreak: 1, lastVerifiedStudyDay: '2026-03-07', rewardTimeZone: 'UTC',
    } });
    const prepared = await prepareVerifiedGamification(test.database, test.transaction, 'owner', action({
      timeZone: 'UTC', rating,
    }));
    expect(prepared.outcome).toMatchObject({ xp: 12, studyDay: '2026-03-08', events: [] });
    expect(prepared.hasXpAward).toBe(true);
    commitVerifiedGamification(test.transaction, prepared);
    expect(test.writes.map(write => write.path)).toEqual(['users/owner/profile/stats', 'users/owner/profile/xp_history', awardPath('word-focus', '2026-03-08')]);
  });

  it('keeps a duplicate card-day award out of XP history while updating the verified review timestamp', async () => {
    const test = harness({ 'users/owner/profile/stats': {
      verifiedXp: 10, verifiedStreak: 1, lastVerifiedStudyDay: '2026-03-08', rewardTimeZone: 'UTC',
    }, [awardPath('word-focus', '2026-03-08')]: {
      schemaVersion: 1, ownerId: 'owner', cardId: 'word-focus', studyDay: '2026-03-08', xpAwarded: 2, expiresAt: new Date('2026-03-15T00:00:00.000Z'),
    } });
    const prepared = await prepareVerifiedGamification(test.database, test.transaction, 'owner', action({ timeZone: 'UTC' }));
    expect(prepared.outcome).toMatchObject({ xp: 10, studyDay: '2026-03-08', events: [] });
    expect(prepared.hasXpAward).toBe(false);
    commitVerifiedGamification(test.transaction, prepared);
    expect(test.writes.map(write => write.path)).toEqual(['users/owner/profile/stats']);
    expect((test.writes[0].data.lastVerifiedReviewAt as Timestamp).toDate()).toEqual(action().receivedAt);
  });

  it('awards an earlier committed server day after a later day', async () => {
    const test = harness({ 'users/owner/profile/stats': {
      verifiedXp: 10, verifiedStreak: 1, lastVerifiedStudyDay: '2026-03-09', rewardTimeZone: 'UTC',
    } });
    const prepared = await prepareVerifiedGamification(test.database, test.transaction, 'owner', action({ timeZone: 'UTC' }));
    expect(prepared.outcome).toMatchObject({ xp: 12, studyDay: '2026-03-08', xpAwarded: 2, events: [] });
    expect(prepared.hasXpAward).toBe(true);
    commitVerifiedGamification(test.transaction, prepared);
    expect(test.writes.map(write => write.path)).toEqual(['users/owner/profile/stats', 'users/owner/profile/xp_history', awardPath('word-focus', '2026-03-08')]);
  });

  it('awards distinct cards on one day and the same card on the following day', async () => {
    const sameDay = harness({
      'users/owner/profile/stats': { verifiedXp: 10, rewardTimeZone: 'UTC' },
      [awardPath('word-focus', '2026-03-08')]: {
        schemaVersion: 1, ownerId: 'owner', cardId: 'word-focus', studyDay: '2026-03-08', xpAwarded: 2, expiresAt: new Date('2026-03-15T00:00:00.000Z'),
      },
    });
    const otherCard = await prepareVerifiedGamification(sameDay.database, sameDay.transaction, 'owner', action({ timeZone: 'UTC', cardId: 'another-card' }));
    expect(otherCard.outcome).toMatchObject({ xp: 12, xpAwarded: 2, studyDay: '2026-03-08' });

    const nextDay = harness({
      'users/owner/profile/stats': { verifiedXp: 10, rewardTimeZone: 'UTC' },
      [awardPath('word-focus', '2026-03-08')]: {
        schemaVersion: 1, ownerId: 'owner', cardId: 'word-focus', studyDay: '2026-03-08', xpAwarded: 2, expiresAt: new Date('2026-03-15T00:00:00.000Z'),
      },
    });
    const repeatedTomorrow = await prepareVerifiedGamification(nextDay.database, nextDay.transaction, 'owner', action({
      timeZone: 'UTC', receivedAt: new Date('2026-03-09T10:30:00.000Z'),
    }));
    expect(repeatedTomorrow.outcome).toMatchObject({ xp: 12, xpAwarded: 2, studyDay: '2026-03-09' });
  });

  it('fails closed on a corrupt review XP award receipt', async () => {
    const test = harness({
      'users/owner/profile/stats': { rewardTimeZone: 'UTC' },
      [awardPath('word-focus', '2026-03-08')]: { schemaVersion: 1, ownerId: 'owner', cardId: 'another-card', studyDay: '2026-03-08', xpAwarded: 2, expiresAt: new Date('2026-03-15T00:00:00.000Z') },
    });
    await expect(prepareVerifiedGamification(test.database, test.transaction, 'owner', action({ timeZone: 'UTC' }))).rejects.toBeInstanceOf(InputValidationError);
    expect(test.writes).toEqual([]);
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
    expect(test.reads).toEqual(['users/owner/profile/stats', awardPath('word-focus', '2026-03-08'), 'users/owner/profile/rewards']);
    commitVerifiedGamification(test.transaction, prepared);
    expect(test.writes.map(write => write.path)).toEqual(['users/owner/profile/stats', 'users/owner/profile/xp_history', awardPath('word-focus', '2026-03-08'), 'users/owner/profile/rewards']);
    expect(test.writes[3].data).toMatchObject({ streakFreezes: 1, hintTokens: 3 });
  });

  it('does not replay a threshold ceremony with its fixed receipt', async () => {
    const test = harness({
      'users/owner/profile/stats': { verifiedXp: 14_399, verifiedStreak: 29, lastVerifiedStudyDay: '2026-03-07', rewardTimeZone: 'UTC' },
      'users/owner/profile/rewards': { receipts: { 'streak-30-v1': true, 'level-13-v1': true } },
    });
    const prepared = await prepareVerifiedGamification(test.database, test.transaction, 'owner', action({ timeZone: 'UTC' }));
    expect(prepared.outcome.events).toEqual([]);
    commitVerifiedGamification(test.transaction, prepared);
    expect(test.writes.map(write => write.path)).toEqual(['users/owner/profile/stats', 'users/owner/profile/xp_history', awardPath('word-focus', '2026-03-08')]);
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

  describe('daily goal counters', () => {
    const isDelete = (value: unknown) => value instanceof FieldValue && value.isEqual(FieldValue.delete());
    const withoutDeletes = (value: unknown): unknown => typeof value === 'object' && value !== null && !(value instanceof FieldValue)
      ? Object.fromEntries(Object.entries(value).filter(([, child]) => !isDelete(child)).map(([key, child]) => [key, withoutDeletes(child)]))
      : value;
    const counters = (studiedCards: number, matchWins: number) => ({ studiedCards, matchWins });
    const stored = (dailyGoalsV1: unknown) => ({ 'users/owner/profile/stats': {
      verifiedXp: 40, verifiedStreak: 1, lastVerifiedStudyDay: '2026-03-07', rewardTimeZone: 'UTC', dailyGoalsV1,
    } });

    it('grants the XP amounts from the shared rules', async () => {
      const review = await prepareVerifiedGamification(harness().database, harness().transaction, 'owner', action());
      expect(review.outcome.xpAwarded).toBe(REVIEW_CARD_XP);
      const create = await prepareVerifiedGamification(harness().database, harness().transaction, 'owner', action({ kind: 'create' }));
      expect(create.outcome.xp).toBe(CREATE_CARD_XP);
    });

    it('starts coverage on the first verified action without another read or write', async () => {
      const test = harness();
      const prepared = await prepareVerifiedGamification(test.database, test.transaction, 'owner', action());
      expect(prepared.statsPatch.dailyGoalsV1).toEqual({ coverageStartedOn: '2026-03-08', days: { '2026-03-08': counters(1, 0) } });
      commitVerifiedGamification(test.transaction, prepared);
      expect(test.reads).toEqual(['users/owner/profile/stats', awardPath('word-focus', '2026-03-08')]);
      expect(test.writes.map(write => write.path)).toEqual(['users/owner/profile/stats', 'users/owner/profile/xp_history', awardPath('word-focus', '2026-03-08')]);
    });

    it('counts a studied card only when the review earns XP', async () => {
      const test = harness({
        ...stored({ coverageStartedOn: '2026-03-01', days: { '2026-03-08': counters(3, 1) } }),
        [awardPath('word-focus', '2026-03-08')]: {
          schemaVersion: 1, ownerId: 'owner', cardId: 'word-focus', studyDay: '2026-03-08', xpAwarded: 2, expiresAt: new Date('2026-03-15T00:00:00.000Z'),
        },
      });
      const repeat = await prepareVerifiedGamification(test.database, test.transaction, 'owner', action({ timeZone: 'UTC' }));
      expect(repeat.hasXpAward).toBe(false);
      expect(repeat.statsPatch.dailyGoalsV1).toEqual({ coverageStartedOn: '2026-03-01', days: { '2026-03-08': counters(3, 1) } });
      const other = harness(stored({ coverageStartedOn: '2026-03-01', days: { '2026-03-08': counters(3, 1) } }));
      const fresh = await prepareVerifiedGamification(other.database, other.transaction, 'owner', action({ timeZone: 'UTC', cardId: 'another-card' }));
      expect(fresh.statsPatch.dailyGoalsV1).toMatchObject({ days: { '2026-03-08': counters(4, 1) } });
    });

    it('counts a completed Word Match but not quiz, spelling or card creation', async () => {
      const results = await Promise.all((['match', 'quiz', 'spelling', 'create'] as const).map(async kind => {
        const test = harness(stored({ coverageStartedOn: '2026-03-07', days: { '2026-03-07': counters(2, 0) } }));
        const prepared = await prepareVerifiedGamification(test.database, test.transaction, 'owner', action({
          kind, timeZone: 'UTC', resultXp: kind === 'match' ? MATCH_WIN_XP : 5,
        }));
        expect(test.reads).toEqual(['users/owner/profile/stats']);
        return (prepared.statsPatch.dailyGoalsV1 as { days: Record<string, unknown> }).days['2026-03-08'];
      }));
      expect(results).toEqual([counters(0, 1), counters(0, 0), counters(0, 0), counters(0, 0)]);
    });

    it('keeps the newest eight study days and deletes older stored days under the merge write', async () => {
      const days = Object.fromEntries(Array.from({ length: 8 }, (_, index) => [
        new Date(Date.UTC(2026, 1, 28 + index)).toISOString().slice(0, 10), counters(index, 0),
      ]));
      const test = harness(stored({ coverageStartedOn: '2026-02-20', days }));
      const prepared = await prepareVerifiedGamification(test.database, test.transaction, 'owner', action({ timeZone: 'UTC' }));
      const patch = prepared.statsPatch.dailyGoalsV1 as { coverageStartedOn: string; days: Record<string, unknown> };
      expect(patch.coverageStartedOn).toBe('2026-02-20');
      expect(isDelete(patch.days['2026-02-28'])).toBe(true);
      expect(Object.keys(patch.days).filter(day => !isDelete(patch.days[day])).sort()).toEqual([
        '2026-03-01', '2026-03-02', '2026-03-03', '2026-03-04', '2026-03-05', '2026-03-06', '2026-03-07', '2026-03-08',
      ]);
      expect(patch.days['2026-03-07']).toEqual(counters(7, 0));
      expect(patch.days['2026-03-08']).toEqual(counters(1, 0));
    });

    it('keeps a newer stored day when a retried transaction records an older day', async () => {
      const test = harness(stored({ coverageStartedOn: '2026-03-08', days: { '2026-03-08': counters(1, 0) } }));
      const prepared = await prepareVerifiedGamification(test.database, test.transaction, 'owner', action({
        timeZone: 'UTC', receivedAt: new Date('2026-03-07T23:59:59.000Z'),
      }));
      expect(prepared.statsPatch.dailyGoalsV1).toEqual({
        coverageStartedOn: '2026-03-08', days: { '2026-03-07': counters(1, 0), '2026-03-08': counters(1, 0) },
      });
    });

    it.each([
      ['a string', 'corrupt'],
      ['an unknown key', { coverageStartedOn: '2026-03-01', days: {}, extra: true }],
      ['a bad coverage day', { coverageStartedOn: '2026-02-30', days: {} }],
      ['a negative counter', { coverageStartedOn: '2026-03-01', days: { '2026-03-07': counters(-1, 0) } }],
      ['a fractional counter', { coverageStartedOn: '2026-03-01', days: { '2026-03-07': counters(1.5, 0) } }],
      ['a bad day key', { coverageStartedOn: '2026-03-01', days: { yesterday: counters(1, 0) } }],
      ['a counter with an extra field', { coverageStartedOn: '2026-03-01', days: { '2026-03-08': { ...counters(1, 0), bonus: 3 } } }],
    ])('resets a stored map with %s instead of failing the action', async (_label, value) => {
      const test = harness(stored(value));
      const prepared = await prepareVerifiedGamification(test.database, test.transaction, 'owner', action({ timeZone: 'UTC' }));
      const patch = prepared.statsPatch.dailyGoalsV1 as Record<string, unknown>;
      expect(withoutDeletes(patch)).toEqual({ coverageStartedOn: '2026-03-08', days: { '2026-03-08': counters(1, 0) } });
      // Every stored key the reset value lacks is deleted, so the merge write cannot keep it.
      const storedKeys = (source: unknown, prefix = ''): string[] => typeof source === 'object' && source !== null
        ? Object.entries(source).flatMap(([key, child]) => [`${prefix}${key}`, ...storedKeys(child, `${prefix}${key}.`)])
        : [];
      const kept = new Set(storedKeys(withoutDeletes(patch)));
      const parentKept = (path: string) => !path.includes('.') || kept.has(path.slice(0, path.lastIndexOf('.')));
      for (const path of storedKeys(value).filter(candidate => !kept.has(candidate) && parentKept(candidate))) {
        expect(isDelete(path.split('.').reduce<unknown>((node, key) => (node as Record<string, unknown>)[key], patch))).toBe(true);
      }
    });
  });
});
