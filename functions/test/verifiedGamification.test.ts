import type { DocumentData, DocumentReference, DocumentSnapshot, Firestore, Transaction } from 'firebase-admin/firestore';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { describe, expect, it, vi } from 'vitest';
import { InputValidationError } from '../src/inputValidation.js';
import { commitVerifiedGamification, equipOwnedFrame, prepareVerifiedGamification, reviewXpAwardId } from '../src/verifiedGamification.js';
import { CREATE_CARD_XP, MATCH_WIN_XP, REVIEW_CARD_XP } from '../src/xp-rules.js';

const snapshot = (exists: boolean, data: DocumentData = {}): DocumentSnapshot => ({ exists, data: () => data } as DocumentSnapshot);

const harness = (documents: Record<string, DocumentData> = {}, counts: Record<string, number> = {}) => {
  const values = new Map(Object.entries(documents));
  const reads: string[] = [];
  const queries: string[] = [];
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
  const collection = (path: string) => ({
    doc: (id: string) => document(`${path}/${id}`),
    where: (field: string, operator: string, value: unknown) => ({
      count: () => ({
        get: async () => {
          const query = `${path} where ${field} ${operator} ${String(value)}`;
          queries.push(query);
          return { data: () => ({ count: counts[query] ?? 0 }) };
        },
      }),
    }),
  });
  const database = {
    collection: (name: string) => collection(name),
    runTransaction: vi.fn(async (callback: (value: Transaction) => Promise<unknown>) => callback(transaction)),
  } as unknown as Firestore;
  return { database, transaction, reads, writes, queries };
};

const awardPath = (cardId: string, studyDay: string) => `users/owner/review_xp_awards/${reviewXpAwardId(cardId, studyDay)}`;

// The streak record of an account that has already had a verified action since streak records began.
const settledStreak = (overrides: Record<string, unknown> = {}) => ({
  coverageStartedOn: '2026-03-01', freezes: 0, refilledWeek: '2026-03-02', best: 5, bestCountedFrom: '2026-02-20',
  days: {}, milestones: {}, repair: null, lastRepairedOn: null, ...overrides,
});

// The achievements record of an account whose first evaluation has already happened.
const settledAchievements = (overrides: Record<string, unknown> = {}) => ({
  catalogVersion: 1,
  recordingStartedOn: '2026-03-01',
  counters: {
    activeDays: 3, lastXpDay: '2026-03-07', lastXpDayXp: 4, bestDayXp: 20,
    reviewedCards: 12, masteredWords: 2, lateReviews: 0, spellingCorrect: 0,
  },
  badges: {
    'first-review': { on: '2026-03-01', exact: false },
    'active-days-3': { on: '2026-03-01', exact: false },
    'reviewed-10': { on: '2026-03-01', exact: false },
  },
  titles: {},
  ...overrides,
});

const reviewedQuery = 'users/owner/cards where reviews > 0';
const masteredQuery = 'users/owner/cards where difficulty == easy';

const isDeleteSentinel = (value: unknown) => value instanceof FieldValue && value.isEqual(FieldValue.delete());

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
      lastVerifiedReviewAt: newer, streakV1: settledStreak(), achievementsV1: settledAchievements(),
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

  it('grants both threshold rewards in one rewards read, caps inventory and holds the 30-day freeze in the streak record', async () => {
    const test = harness({
      'users/owner/profile/stats': { verifiedXp: 14_399, verifiedStreak: 29, lastVerifiedStudyDay: '2026-03-07', rewardTimeZone: 'UTC' },
      'users/owner/profile/rewards': { streakFreezes: 1, hintTokens: 3 },
    });
    const prepared = await prepareVerifiedGamification(test.database, test.transaction, 'owner', action({ timeZone: 'UTC' }));
    // The card earns 2 XP and the first 30-day milestone adds 100 once.
    expect(prepared.outcome).toMatchObject({
      xp: 14_501, level: 13, streak: 30, xpAwarded: 2, events: ['streak', 'levelup'],
      streakChange: { freezesUsed: 0, freezesEarned: 1, milestone: 30, milestoneXp: 100 },
    });
    // The legacy freeze fold, the achievements baseline and both thresholds share one rewards read.
    expect(test.reads).toEqual([
      'users/owner/profile/stats', awardPath('word-focus', '2026-03-08'), 'users/owner/profile/rewards', 'users/owner/profile/xp_history',
    ]);
    expect(test.queries).toEqual([reviewedQuery, masteredQuery]);
    commitVerifiedGamification(test.transaction, prepared);
    expect(test.writes.map(write => write.path)).toEqual(['users/owner/profile/stats', 'users/owner/profile/xp_history', awardPath('word-focus', '2026-03-08'), 'users/owner/profile/rewards']);
    expect(test.writes[1].data.verifiedByDayV1['2026-03-08'].isEqual(FieldValue.increment(102))).toBe(true);
    expect(test.writes[3].data).toMatchObject({
      hintTokens: 3, unlockedBadgeIds: ['web-wanderer'], receipts: { 'streak-30-v1': true, 'level-13-v1': true },
    });
    expect(isDeleteSentinel(test.writes[3].data.streakFreezes)).toBe(true);
    expect(test.writes[0].data.streakV1).toMatchObject({
      freezes: 2, best: 30, milestones: { 7: null, 14: null, 30: '2026-03-08' }, days: { '2026-03-08': 'studied' },
    });
    // Met only by this review: the 30-day badge and level 13 are exact; 7 days and level 5 were met before.
    expect(test.writes[0].data.achievementsV1).toMatchObject({
      recordingStartedOn: '2026-03-08',
      badges: {
        'streak-7': { on: '2026-03-08', exact: false },
        'web-wanderer': { on: '2026-03-08', exact: true },
        'xp-500': { on: '2026-03-08', exact: false },
      },
      titles: { 'word-keeper': { on: '2026-03-08', exact: false }, 'word-collector': { on: '2026-03-08', exact: true } },
    });
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

  describe('streak record', () => {
    const statsPath = 'users/owner/profile/stats';
    const rewardsPath = 'users/owner/profile/rewards';
    const utc = (iso: string) => action({ timeZone: 'UTC', receivedAt: new Date(iso) });
    const run = async (documents: Record<string, DocumentData>, verifiedAction = utc('2026-03-08T10:30:00.000Z')) => {
      const test = harness(documents);
      const prepared = await prepareVerifiedGamification(test.database, test.transaction, 'owner', verifiedAction);
      commitVerifiedGamification(test.transaction, prepared);
      return { ...test, prepared, streakV1: test.writes[0].data.streakV1 as Record<string, unknown> };
    };

    it('starts a new account record on its first review without another read', async () => {
      const result = await run({});
      expect(result.reads).toEqual([statsPath, awardPath('word-focus', '2026-03-08')]);
      expect(result.streakV1).toEqual({
        coverageStartedOn: '2026-03-08', freezes: 2, refilledWeek: '2026-03-02', best: 1, bestCountedFrom: '2026-03-08',
        days: { '2026-03-08': 'studied' }, milestones: {}, repair: null, lastRepairedOn: null,
      });
      expect(result.prepared.outcome.streakChange).toEqual({ freezesUsed: 0, freezesEarned: 0, freezesRefilled: 2 });
    });

    it('folds the legacy freeze and the best streak evidence in once, with one rewards read and one field delete', async () => {
      const result = await run({
        [statsPath]: {
          verifiedXp: 40, verifiedStreak: 3, lastVerifiedStudyDay: '2026-03-07', rewardTimeZone: 'UTC',
          achievementsV1: settledAchievements(),
          reviewActivityV1: {
            coverageStartedOnByLanguage: { en: '2026-03-01', ko: '2026-03-04' },
            daysByLanguage: {
              en: { '2026-03-01': { reviewed: 2, again: 0, hard: 0, good: 2, easy: 0 }, '2026-03-02': { reviewed: 1, again: 0, hard: 0, good: 1, easy: 0 }, '2026-03-03': { reviewed: 1, again: 1, hard: 0, good: 0, easy: 0 } },
              ko: { '2026-03-04': { reviewed: 1, again: 0, hard: 0, good: 0, easy: 1 } },
            },
          },
        },
        [rewardsPath]: { streakFreezes: 1, hintTokens: 2, receipts: { 'streak-30-v1': true } },
      }, action({ kind: 'create', timeZone: 'UTC' }));
      expect(result.reads).toEqual([statsPath, rewardsPath]);
      expect(result.writes.map(write => write.path)).toEqual([statsPath, 'users/owner/profile/xp_history', rewardsPath]);
      expect(Object.keys(result.writes[2].data)).toEqual(['streakFreezes']);
      expect(isDeleteSentinel(result.writes[2].data.streakFreezes)).toBe(true);
      // Reviews on 1-4 March in two languages join the stored 3-day run of 5-7 March: best 7.
      expect(result.streakV1).toEqual({
        coverageStartedOn: '2026-03-08', freezes: 1, refilledWeek: null, best: 7, bestCountedFrom: '2026-03-01',
        days: {}, milestones: { 7: null, 30: null }, repair: null, lastRepairedOn: null,
      });
      expect(result.prepared.outcome).toMatchObject({ streak: 3 });
      expect(result.prepared.outcome).not.toHaveProperty('streakChange');
    });

    it('does not write the rewards document when the folded account has no legacy freeze', async () => {
      const result = await run({
        [statsPath]: {
          verifiedXp: 40, verifiedStreak: 1, lastVerifiedStudyDay: '2026-03-07', rewardTimeZone: 'UTC', achievementsV1: settledAchievements(),
        },
        [rewardsPath]: { hintTokens: 1 },
      });
      expect(result.reads).toEqual([statsPath, awardPath('word-focus', '2026-03-08'), rewardsPath]);
      expect(result.writes.map(write => write.path)).toEqual([statsPath, 'users/owner/profile/xp_history', awardPath('word-focus', '2026-03-08')]);
    });

    it('adds no read or write to a review once the record exists', async () => {
      const result = await run({ [statsPath]: {
        verifiedXp: 40, verifiedStreak: 5, lastVerifiedStudyDay: '2026-03-07', rewardTimeZone: 'UTC', streakV1: settledStreak(), achievementsV1: settledAchievements(),
      } });
      expect(result.reads).toEqual([statsPath, awardPath('word-focus', '2026-03-08')]);
      expect(result.writes.map(write => write.path)).toEqual([statsPath, 'users/owner/profile/xp_history', awardPath('word-focus', '2026-03-08')]);
      expect(result.prepared.outcome).toMatchObject({ streak: 6 });
      expect(result.prepared.outcome).not.toHaveProperty('streakChange');
    });

    it('starts an unusable stored record over without reading rewards or failing the review', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      try {
        const result = await run({ [statsPath]: {
          verifiedXp: 40, verifiedStreak: 5, lastVerifiedStudyDay: '2026-03-07', rewardTimeZone: 'UTC', streakV1: 'corrupt',
          achievementsV1: settledAchievements(),
        }, [rewardsPath]: { streakFreezes: 1 } });
        expect(result.reads).toEqual([statsPath, awardPath('word-focus', '2026-03-08')]);
        expect(result.prepared.outcome).toMatchObject({ streak: 6 });
        expect(result.streakV1).toMatchObject({ coverageStartedOn: '2026-03-08', best: 6, days: { '2026-03-08': 'studied' } });
        expect(warn).toHaveBeenCalledWith('Stored streak record was unusable and starts over.');
      } finally {
        warn.mockRestore();
      }
    });

    it('spends one held freeze per missed day and keeps the run', async () => {
      const result = await run({ [statsPath]: {
        verifiedXp: 40, verifiedStreak: 9, lastVerifiedStudyDay: '2026-03-05', rewardTimeZone: 'UTC',
        streakV1: settledStreak({ freezes: 2, best: 9, days: { '2026-03-05': 'studied' } }), achievementsV1: settledAchievements(),
      } });
      expect(result.prepared.outcome).toMatchObject({ streak: 10, streakChange: { freezesUsed: 2, freezesEarned: 0 } });
      expect(result.streakV1).toMatchObject({
        freezes: 0, best: 10, days: { '2026-03-05': 'studied', '2026-03-06': 'frozen', '2026-03-07': 'frozen', '2026-03-08': 'studied' },
      });
    });

    it('ends a run the freezes cannot bridge and opens a repair that the returning review starts', async () => {
      const result = await run({ [statsPath]: {
        verifiedXp: 40, verifiedStreak: 23, lastVerifiedStudyDay: '2026-03-04', rewardTimeZone: 'UTC',
        streakV1: settledStreak({ freezes: 1, best: 23 }), achievementsV1: settledAchievements(),
      } });
      expect(result.prepared.outcome).toMatchObject({ streak: 1, streakChange: { freezesUsed: 1, freezesEarned: 0, repairOffered: true } });
      // The freeze covered 5 March; the run ended on 6 March, so the repair can finish until 8 March ends.
      expect(result.streakV1).toMatchObject({
        freezes: 0, best: 23, days: { '2026-03-05': 'frozen', '2026-03-08': 'studied' },
        repair: { runLength: 23, lastStudiedOn: '2026-03-04', endedOn: '2026-03-06', deadline: '2026-03-08', cardsDone: 1, cardsNeeded: 20 },
      });
    });

    it('completes a repair on the twentieth XP review, restores the run and earns a crossed freeze', async () => {
      const result = await run({ [statsPath]: {
        verifiedXp: 40, verifiedStreak: 1, lastVerifiedStudyDay: '2026-03-07', rewardTimeZone: 'UTC',
        streakV1: settledStreak({
          best: 26, days: { '2026-03-04': 'studied', '2026-03-07': 'studied' },
          repair: { runLength: 26, lastStudiedOn: '2026-03-04', endedOn: '2026-03-05', deadline: '2026-03-07', cardsDone: 19, cardsNeeded: 20 },
        }), achievementsV1: settledAchievements(),
      } }, utc('2026-03-07T20:00:00.000Z'));
      // Back on the deadline day: finishing on 7 March repairs 5 and 6 March and restores 26 + 1.
      expect(result.prepared.outcome).toMatchObject({ streak: 27, streakChange: { freezesUsed: 0, freezesEarned: 0, repaired: true } });
      expect(result.streakV1).toMatchObject({
        repair: null, lastRepairedOn: '2026-03-07', best: 27,
        days: { '2026-03-04': 'studied', '2026-03-05': 'repaired', '2026-03-06': 'repaired', '2026-03-07': 'studied' },
      });

      const crossing = await run({ [statsPath]: {
        verifiedXp: 40, verifiedStreak: 1, lastVerifiedStudyDay: '2026-03-07', rewardTimeZone: 'UTC',
        streakV1: settledStreak({
          best: 26, days: { '2026-03-07': 'studied' },
          repair: { runLength: 26, lastStudiedOn: '2026-03-05', endedOn: '2026-03-06', deadline: '2026-03-08', cardsDone: 19, cardsNeeded: 20 },
        }), achievementsV1: settledAchievements(),
      } });
      // The run continues to 2 on 8 March, then the repair restores 26 + 2 = 28 and earns the freeze at 28.
      expect(crossing.prepared.outcome).toMatchObject({ streak: 28, streakChange: { freezesUsed: 0, freezesEarned: 1, repaired: true } });
      expect(crossing.streakV1).toMatchObject({ freezes: 1, days: { '2026-03-06': 'repaired', '2026-03-07': 'studied', '2026-03-08': 'studied' } });
    });

    it('counts only XP-earning reviews toward a repair', async () => {
      const repair = { runLength: 26, lastStudiedOn: '2026-03-05', endedOn: '2026-03-06', deadline: '2026-03-08', cardsDone: 19, cardsNeeded: 20 };
      const result = await run({
        [statsPath]: {
          verifiedXp: 40, verifiedStreak: 2, lastVerifiedStudyDay: '2026-03-08', rewardTimeZone: 'UTC',
          streakV1: settledStreak({ repair, days: { '2026-03-07': 'studied', '2026-03-08': 'studied' } }), achievementsV1: settledAchievements(),
        },
        [awardPath('word-focus', '2026-03-08')]: {
          schemaVersion: 1, ownerId: 'owner', cardId: 'word-focus', studyDay: '2026-03-08', xpAwarded: 2, expiresAt: new Date('2026-03-15T00:00:00.000Z'),
        },
      });
      expect(result.prepared.outcome).toMatchObject({ streak: 2, xpAwarded: 0 });
      expect(result.streakV1).toMatchObject({ repair });
      expect(result.prepared.outcome).not.toHaveProperty('streakChange');
    });

    it('tops freezes up on the first review of a week, once', async () => {
      const stats = {
        verifiedXp: 40, verifiedStreak: 3, lastVerifiedStudyDay: '2026-03-08', rewardTimeZone: 'UTC',
        streakV1: settledStreak({ freezes: 0, refilledWeek: '2026-03-02' }), achievementsV1: settledAchievements(),
      };
      const monday = await run({ [statsPath]: stats }, utc('2026-03-09T08:00:00.000Z'));
      expect(monday.prepared.outcome).toMatchObject({ streak: 4, streakChange: { freezesUsed: 0, freezesEarned: 0, freezesRefilled: 2 } });
      expect(monday.streakV1).toMatchObject({ freezes: 2, refilledWeek: '2026-03-09' });
      const again = await run({ [statsPath]: { ...stats, lastVerifiedStudyDay: '2026-03-09', streakV1: settledStreak({ freezes: 1, refilledWeek: '2026-03-09' }), achievementsV1: settledAchievements() } }, action({
        timeZone: 'UTC', cardId: 'another-card', receivedAt: new Date('2026-03-09T09:00:00.000Z'),
      }));
      expect(again.streakV1).toMatchObject({ freezes: 1, refilledWeek: '2026-03-09' });
      expect(again.prepared.outcome).not.toHaveProperty('streakChange');
    });

    it('expires a closed repair window on any action without moving the run', async () => {
      const result = await run({ [statsPath]: {
        verifiedXp: 40, verifiedStreak: 1, lastVerifiedStudyDay: '2026-03-06', rewardTimeZone: 'UTC',
        streakV1: settledStreak({
          repair: { runLength: 9, lastStudiedOn: '2026-03-03', endedOn: '2026-03-05', deadline: '2026-03-07', cardsDone: 4, cardsNeeded: 20 },
        }), achievementsV1: settledAchievements(),
      } }, action({ kind: 'create', timeZone: 'UTC' }));
      expect(result.prepared.outcome).toMatchObject({ streak: 1 });
      expect(result.streakV1).toMatchObject({ repair: null });
    });

    it('never grants milestone XP without granting the 30-day receipt', async () => {
      const result = await run({
        [statsPath]: {
          verifiedXp: 900, verifiedStreak: 29, lastVerifiedStudyDay: '2026-03-07', rewardTimeZone: 'UTC',
          streakV1: settledStreak({ best: 29, milestones: { 7: null, 14: null } }), achievementsV1: settledAchievements(),
        },
        [rewardsPath]: { receipts: { 'streak-30-v1': true } },
      });
      expect(result.prepared.outcome).toMatchObject({ xp: 902, streak: 30, events: [], streakChange: { milestone: 30 } });
      expect(result.prepared.outcome.streakChange).not.toHaveProperty('milestoneXp');
      expect(result.reads).toEqual([statsPath, awardPath('word-focus', '2026-03-08'), rewardsPath]);
    });

    it('keeps the newest 14 day marks and deletes older stored marks under the merge write', async () => {
      const days = Object.fromEntries(Array.from({ length: 14 }, (_, index) => [
        new Date(Date.UTC(2026, 1, 22 + index)).toISOString().slice(0, 10), 'studied',
      ]));
      const result = await run({ [statsPath]: {
        verifiedXp: 40, verifiedStreak: 14, lastVerifiedStudyDay: '2026-03-07', rewardTimeZone: 'UTC',
        streakV1: settledStreak({ best: 14, days, milestones: { 7: '2026-02-28', 14: '2026-03-07' } }), achievementsV1: settledAchievements(),
      } });
      const marks = result.streakV1.days as Record<string, unknown>;
      expect(isDeleteSentinel(marks['2026-02-22'])).toBe(true);
      expect(Object.keys(marks).filter(day => !isDeleteSentinel(marks[day]))).toHaveLength(14);
      expect(marks['2026-03-08']).toBe('studied');
    });
  });

  describe('daily goal counters', () => {
    const isDelete = (value: unknown) => value instanceof FieldValue && value.isEqual(FieldValue.delete());
    const withoutDeletes = (value: unknown): unknown => typeof value === 'object' && value !== null && !(value instanceof FieldValue)
      ? Object.fromEntries(Object.entries(value).filter(([, child]) => !isDelete(child)).map(([key, child]) => [key, withoutDeletes(child)]))
      : value;
    const counters = (studiedCards: number, matchWins: number) => ({ studiedCards, matchWins });
    const stored = (dailyGoalsV1: unknown) => ({ 'users/owner/profile/stats': {
      verifiedXp: 40, verifiedStreak: 1, lastVerifiedStudyDay: '2026-03-07', rewardTimeZone: 'UTC', dailyGoalsV1,
      streakV1: settledStreak(), achievementsV1: settledAchievements(),
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

describe('achievements record', () => {
  const statsPath = 'users/owner/profile/stats';
  const rewardsPath = 'users/owner/profile/rewards';
  const historyPath = 'users/owner/profile/xp_history';
  const award = awardPath('word-focus', '2026-03-08');
  const run = async (
    documents: Record<string, DocumentData>,
    verifiedAction: Parameters<typeof prepareVerifiedGamification>[3] = action({ timeZone: 'UTC' }),
    counts: Record<string, number> = {},
  ) => {
    const test = harness(documents, counts);
    const prepared = await prepareVerifiedGamification(test.database, test.transaction, 'owner', verifiedAction);
    return { ...test, prepared, achievementsV1: prepared.statsPatch.achievementsV1 as Record<string, unknown> | undefined };
  };
  const settled = (overrides: Record<string, unknown> = {}) => ({
    verifiedXp: 40, verifiedStreak: 5, lastVerifiedStudyDay: '2026-03-07', rewardTimeZone: 'UTC',
    streakV1: settledStreak(), achievementsV1: settledAchievements(), ...overrides,
  });

  it('starts a new account from the two card counts without reading history or rewards', async () => {
    const result = await run({}, action({ reviewedCard: { firstReview: true, firstEasy: false } }));
    expect(result.reads).toEqual([statsPath, award]);
    expect(result.queries).toEqual([reviewedQuery, masteredQuery]);
    expect(result.achievementsV1).toEqual({
      catalogVersion: 1,
      recordingStartedOn: '2026-03-08',
      counters: {
        activeDays: 1, lastXpDay: '2026-03-08', lastXpDayXp: 2, bestDayXp: 2,
        reviewedCards: 1, masteredWords: 0, lateReviews: 0, spellingCorrect: 0,
      },
      badges: { 'first-review': { on: '2026-03-08', exact: true } },
    });
  });

  it('reads the baseline of an existing account once and then never again', async () => {
    const first = await run({
      [statsPath]: settled({ verifiedXp: 620, verifiedStreak: 3, achievementsV1: undefined }),
      [historyPath]: { verifiedByDayV1: { '2026-03-01': 130, '2026-03-05': 40, '2026-03-07': 20 } },
      // A 30-day badge from before the receipt existed.
      [rewardsPath]: { unlockedBadgeIds: ['web-wanderer'] },
    }, undefined, { [reviewedQuery]: 37, [masteredQuery]: 12 });
    expect(first.reads).toEqual([statsPath, award, historyPath, rewardsPath]);
    expect(first.queries).toEqual([reviewedQuery, masteredQuery]);
    const byFirstDay = { on: '2026-03-08', exact: false };
    expect(first.achievementsV1).toEqual({
      catalogVersion: 1,
      recordingStartedOn: '2026-03-08',
      counters: {
        activeDays: 4, lastXpDay: '2026-03-08', lastXpDayXp: 2, bestDayXp: 130,
        reviewedCards: 37, masteredWords: 12, lateReviews: 0, spellingCorrect: 0,
      },
      badges: Object.fromEntries(['first-review', 'active-days-3', 'reviewed-10', 'day-xp-100', 'streak-7', 'xp-500', 'web-wanderer']
        .map(id => [id, byFirstDay])),
    });
    commitVerifiedGamification(first.transaction, first.prepared);
    // The rewards document is read but never written.
    expect(first.writes.map(write => write.path)).toEqual([statsPath, historyPath, award]);

    const next = await run({ [statsPath]: settled({ verifiedXp: 622, achievementsV1: first.achievementsV1 }) },
      action({ timeZone: 'UTC', cardId: 'word-next' }));
    expect(next.reads).toEqual([statsPath, awardPath('word-next', '2026-03-08')]);
    expect(next.queries).toEqual([]);
    expect(next.achievementsV1).toEqual({ counters: { lastXpDayXp: 4 } });
  });

  it('adds no read or query once the record exists and writes only the changed leaves', async () => {
    const result = await run({ [statsPath]: settled() });
    expect(result.reads).toEqual([statsPath, award]);
    expect(result.queries).toEqual([]);
    expect(result.achievementsV1).toEqual({ counters: { activeDays: 4, lastXpDay: '2026-03-08', lastXpDayXp: 2 } });
  });

  it('counts a late review only when it earns XP', async () => {
    const late = action({ timeZone: 'UTC', receivedAt: new Date('2026-03-08T23:30:00.000Z') });
    expect((await run({ [statsPath]: settled() }, late)).achievementsV1)
      .toMatchObject({ counters: { lateReviews: 1 } });
    // The card already earned its XP today.
    const noXp = await run({ [statsPath]: settled(), [award]: {
      schemaVersion: 1, ownerId: 'owner', cardId: 'word-focus', studyDay: '2026-03-08', xpAwarded: 2, expiresAt: new Date('2026-03-15T00:00:00.000Z'),
    } }, late);
    expect(noXp.prepared.outcome.xpAwarded).toBe(0);
    expect(noXp.achievementsV1).toBeUndefined();
  });

  it('counts first reviews and first Easy ratings from the review path', async () => {
    const result = await run({ [statsPath]: settled() }, action({
      timeZone: 'UTC', rating: 'easy', reviewedCard: { firstReview: true, firstEasy: true },
    }));
    expect(result.achievementsV1).toMatchObject({ counters: { reviewedCards: 13, masteredWords: 3 } });
  });

  it('counts correct answers from spelling but not from a quiz', async () => {
    const practice = (kind: 'spelling' | 'quiz') => ({
      kind, receivedAt: new Date('2026-03-08T10:30:00.000Z'), timeZone: 'UTC', resultXp: 6, correctAnswers: 3,
    });
    expect((await run({ [statsPath]: settled() }, practice('spelling'))).achievementsV1)
      .toMatchObject({ counters: { spellingCorrect: 3 } });
    expect((await run({ [statsPath]: settled() }, practice('quiz'))).achievementsV1?.counters)
      .not.toHaveProperty('spellingCorrect');
  });

  it('rebuilds an unusable record from the baseline and keeps its valid badge and title records', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const result = await run({
        [statsPath]: settled({
          achievementsV1: {
            catalogVersion: 2, recordingStartedOn: 'soon', counters: 'lost',
            badges: {
              'xp-500': { on: '2026-02-01', exact: true },
              'from-a-newer-catalog': { on: '2026-02-03', exact: true },
              'mastered-50': { on: 'never', exact: true },
            },
            titles: { 'word-keeper': { on: '2026-02-02', exact: false } },
          },
        }),
      }, undefined, { [reviewedQuery]: 2 });
      expect(result.reads).toEqual([statsPath, award, historyPath, rewardsPath]);
      expect(result.achievementsV1).toEqual({
        catalogVersion: 2,
        recordingStartedOn: '2026-03-08',
        counters: {
          activeDays: 1, lastXpDay: '2026-03-08', lastXpDayXp: 2, bestDayXp: 2,
          reviewedCards: 2, masteredWords: 0, lateReviews: 0, spellingCorrect: 0,
        },
        badges: {
          'xp-500': { on: '2026-02-01', exact: true },
          'from-a-newer-catalog': { on: '2026-02-03', exact: true },
          'first-review': { on: '2026-03-08', exact: false },
        },
        titles: { 'word-keeper': { on: '2026-02-02', exact: false } },
      });
      expect(warn).toHaveBeenCalledWith('Stored achievements record was unusable and is rebuilt.');
    } finally {
      warn.mockRestore();
    }
  });

  it('skips the record without failing the action when the card counts are unavailable', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const result = await run({}, undefined, { [masteredQuery]: -1 });
      expect(result.prepared.outcome).toMatchObject({ xp: 2, streak: 1 });
      expect(result.achievementsV1).toBeUndefined();
      expect(result.prepared.statsPatch).not.toHaveProperty('achievementsV1');
      expect(warn).toHaveBeenCalledWith('Achievement baseline counts are unavailable; recording starts on a later action.');
    } finally {
      warn.mockRestore();
    }
  });
});
