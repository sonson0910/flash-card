import { randomUUID } from 'node:crypto';
import { deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseStudyTime } from '../src/study-time-rules.js';
import {
  commitVerifiedGamification,
  prepareVerifiedGamification,
  type VerifiedGamificationAction,
} from '../src/verifiedGamification.js';
import { parseWordWeeks } from '../src/word-week-rules.js';

const describeWithEmulator = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;
const counters = (studiedCards: number, matchWins: number) => ({ studiedCards, matchWins });
const review = (cardId: string): VerifiedGamificationAction => ({
  kind: 'review', receivedAt: new Date('2026-03-08T10:30:00.000Z'), timeZone: 'UTC', targetLanguage: 'en', rating: 'good', cardId,
});

describeWithEmulator('verified gamification daily goal counters in Firestore', () => {
  let app: App;
  let database: Firestore;
  beforeAll(() => {
    app = initializeApp({ projectId: 'demo-lingoflash' }, 'verified-gamification-integration');
    database = getFirestore(app, 'ai-studio-945b4052-4462-4668-8936-277f09f07a37');
  });
  afterAll(async () => { await database.terminate(); await deleteApp(app); });

  const run = (ownerId: string, action: VerifiedGamificationAction) => database.runTransaction(async transaction => (
    commitVerifiedGamification(transaction, await prepareVerifiedGamification(database, transaction, ownerId, action))
  ));
  const seed = async (dailyGoalsV1: unknown) => {
    const ownerId = `daily-goals-${randomUUID()}`;
    const stats = database.doc(`users/${ownerId}/profile/stats`);
    await stats.set({
      streak: 0, xp: 0, lastActive: null, verifiedSchemaVersion: 1, verifiedXp: 0, verifiedStreak: 0,
      lastVerifiedStudyDay: null, rewardTimeZone: 'UTC', dailyGoalsV1,
    });
    return { ownerId, stored: async () => (await stats.get()).data()?.dailyGoalsV1 };
  };

  it('counts reviews and a match win and drops days older than the newest eight', async () => {
    const days = Object.fromEntries(Array.from({ length: 8 }, (_, index) => [
      new Date(Date.UTC(2026, 1, 28 + index)).toISOString().slice(0, 10), counters(index, 0),
    ]));
    const { ownerId, stored } = await seed({ coverageStartedOn: '2026-02-20', days });
    await run(ownerId, review('card-a'));
    await run(ownerId, review('card-a'));
    await run(ownerId, review('card-b'));
    await run(ownerId, { kind: 'match', receivedAt: new Date('2026-03-08T11:00:00.000Z'), timeZone: 'UTC', resultXp: 20 });
    await run(ownerId, { kind: 'quiz', receivedAt: new Date('2026-03-08T11:05:00.000Z'), timeZone: 'UTC', resultXp: 10 });
    const { '2026-02-28': _dropped, ...kept } = days;
    expect(await stored()).toEqual({
      coverageStartedOn: '2026-02-20',
      days: { ...kept, '2026-03-08': counters(2, 1) },
    });
  });

  it.each([
    ['a string', 'corrupt'],
    ['a non-map day list', { coverageStartedOn: '2026-03-01', days: 7 }],
    ['unknown keys at every level', {
      coverageStartedOn: '2026-03-01',
      extra: true,
      days: { yesterday: counters(1, 0), '2026-03-07': counters(4, 0), '2026-03-08': { ...counters(5, 0), bonus: 3 } },
    }],
  ])('replaces a stored map with %s instead of failing the review', async (_label, malformed) => {
    const { ownerId, stored } = await seed(malformed);
    await expect(run(ownerId, review('card-a'))).resolves.toMatchObject({ xpAwarded: 2 });
    expect(await stored()).toEqual({ coverageStartedOn: '2026-03-08', days: { '2026-03-08': counters(1, 0) } });
  });
});

describeWithEmulator('verified study records of an account whose first action creates a card', () => {
  let app: App;
  let database: Firestore;
  beforeAll(() => {
    app = initializeApp({ projectId: 'demo-lingoflash' }, 'verified-first-create-integration');
    database = getFirestore(app, 'ai-studio-945b4052-4462-4668-8936-277f09f07a37');
  });
  afterAll(async () => { await database.terminate(); await deleteApp(app); });

  const run = (ownerId: string, action: VerifiedGamificationAction) => database.runTransaction(async transaction => (
    commitVerifiedGamification(transaction, await prepareVerifiedGamification(database, transaction, ownerId, action))
  ));
  const firstReviewOf = (cardId: string, iso: string): VerifiedGamificationAction => ({
    ...review(cardId), receivedAt: new Date(iso),
    reviewedCard: { firstReview: true, firstEasy: false, started: true, mastered: false, reviewTimesMs: [Date.parse(iso)] },
  });

  it('keeps lifetime study time and the first partial week', async () => {
    const ownerId = `first-create-${randomUUID()}`;
    const stats = database.doc(`users/${ownerId}/profile/stats`);
    await run(ownerId, { kind: 'create', receivedAt: new Date('2026-03-04T10:00:00.000Z'), timeZone: 'UTC' });
    const created = (await stats.get()).data();
    expect(parseStudyTime(created?.studyTimeV1)).toEqual({
      coverageStartedOn: '2026-03-04', fromFirstAction: true, lastActionAtMs: 0, totalMs: 0, days: {},
    });
    expect(parseWordWeeks(created?.wordWeeksV1)).toEqual({
      coverageStartedOn: '2026-03-04', fromFirstAction: true, daysByLanguage: {}, bestWeekByLanguage: {}, wordOfWeekByLanguage: {},
    });

    await run(ownerId, firstReviewOf('card-a', '2026-03-04T10:05:00.000Z'));
    await run(ownerId, firstReviewOf('card-b', '2026-03-09T10:00:00.000Z'));
    const after = (await stats.get()).data();
    expect(parseStudyTime(after?.studyTimeV1)).toMatchObject({ coverageStartedOn: '2026-03-04', fromFirstAction: true });
    expect(parseWordWeeks(after?.wordWeeksV1)).toMatchObject({
      coverageStartedOn: '2026-03-04', fromFirstAction: true, bestWeekByLanguage: { en: { weekStart: '2026-03-02', started: 1 } },
    });
  });
});
