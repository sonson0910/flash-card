import { randomUUID } from 'node:crypto';
import { deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { getFirestore, Timestamp, type DocumentData, type Firestore } from 'firebase-admin/firestore';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  applyReviewForOwner,
  ReviewPersistenceConflictError,
  type ReviewPersistenceResult,
  type ReviewRequest,
} from '../src/reviewPersistence.js';
import { scheduleReviewTransition } from '../src/reviewScheduler.js';
import { weekStartOf } from '../src/study-day-rules.js';
import { parseStudyTime } from '../src/study-time-rules.js';
import {
  commitVerifiedGamification,
  prepareVerifiedGamification,
  type VerifiedGamificationAction,
} from '../src/verifiedGamification.js';
import { parseWordWeeks } from '../src/word-week-rules.js';
import { REVIEW_CARD_XP } from '../src/xp-rules.js';

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

const DAY_MS = 24 * 60 * 60 * 1000;
const utcDay = (time: number) => new Date(time).toISOString().slice(0, 10);
const REVIEW_FIELD_MASK: ReviewRequest['fieldMask'] = [
  'difficulty', 'nextReviewDate', 'reviews', 'interval', 'easeFactor', 'fsrs', 'reviewHistory', 'correctStreak',
];

const newCard = (id: string, word: string) => ({
  id, word, normalizedWord: word, language: 'en', translation: `${word} (vi)`, explanation: `the word ${word}`,
  explanationTranslation: '', phonetic: '', category: 'Study', emoji: '', audioUrl: null, imageUrl: null,
  imageSearchQuery: word, createdAt: '2026-08-01T00:00:00.000Z', bookmarked: false, customDeck: null,
  difficulty: 'unrated', reviews: 0, interval: 0, easeFactor: 2.5, correctStreak: 0, partOfSpeech: 'noun',
  cefrLevel: 'B1', exampleSentence: '', exampleTranslation: '', collocations: [], synonyms: [], antonyms: [],
  register: '', commonMistake: '', reviewHistory: [], appliedReviewOperationIds: [],
  schemaVersion: 2, revision: 1, libraryEpoch: 0,
});

// The stats of an account that studied yesterday and finished a practice session `sinceLastActionMs` ago,
// with every record the verified action transaction keeps.
const studiedYesterday = (now: number, sinceLastActionMs: number) => {
  const yesterday = utcDay(now - DAY_MS);
  const coverage = utcDay(now - 10 * DAY_MS);
  return {
    streak: 0, xp: 0, lastActive: null,
    verifiedSchemaVersion: 1, verifiedXp: 640, verifiedStreak: 6, lastVerifiedStudyDay: yesterday, rewardTimeZone: 'UTC',
    lastVerifiedReviewAt: Timestamp.fromMillis(now - DAY_MS),
    reviewActivityV1: {
      coverageStartedOnByLanguage: { en: coverage },
      daysByLanguage: { en: { [yesterday]: { reviewed: 4, again: 0, hard: 1, good: 3, easy: 0 } } },
    },
    dailyGoalsV1: { coverageStartedOn: coverage, days: { [yesterday]: { studiedCards: 4, matchWins: 0 } } },
    streakV1: {
      coverageStartedOn: coverage, freezes: 1, refilledWeek: weekStartOf(utcDay(now)), best: 6,
      bestCountedFrom: utcDay(now - 6 * DAY_MS), days: { [yesterday]: 'studied' }, milestones: {}, repair: null, lastRepairedOn: null,
    },
    achievementsV1: {
      catalogVersion: 1, recordingStartedOn: coverage,
      counters: {
        activeDays: 6, lastXpDay: yesterday, lastXpDayXp: 8, bestDayXp: 60,
        reviewedCards: 24, masteredWords: 3, lateReviews: 0, spellingCorrect: 0,
      },
      badges: { 'first-review': { on: coverage, exact: false } },
      titles: {},
    },
    studyTimeV1: {
      coverageStartedOn: coverage, fromFirstAction: false, lastActionAtMs: now - sinceLastActionMs, totalMs: 90_000,
      days: { [yesterday]: { activeMs: 90_000, reviewMs: 90_000, timedReviews: 6 } },
    },
    wordWeeksV1: {
      coverageStartedOn: coverage, fromFirstAction: false,
      daysByLanguage: { en: { [yesterday]: { started: 2, mastered: 0 } } }, bestWeekByLanguage: {}, wordOfWeekByLanguage: {},
    },
  };
};

describeWithEmulator('verified study records when reviews commit at the same time', () => {
  let app: App;
  let database: Firestore;
  beforeAll(() => {
    app = initializeApp({ projectId: 'demo-lingoflash' }, 'verified-concurrent-reviews-integration');
    database = getFirestore(app, 'ai-studio-945b4052-4462-4668-8936-277f09f07a37');
  });
  afterAll(async () => { await database.terminate(); await deleteApp(app); });

  // Runs the given reviews at the same time. Each review's first attempt waits after its reads until
  // every review has read, so the transactions always overlap and all but one must be retried.
  const atTheSameTime = async <T>(reviews: Array<(database: Firestore) => Promise<T>>) => {
    let attempts = 0;
    let arrived = 0;
    let open!: () => void;
    const everyoneRead = new Promise<void>(resolve => { open = resolve; });
    const overlapping = new Proxy(database, {
      get(target, property) {
        if (property === 'runTransaction') {
          return (update: Parameters<Firestore['runTransaction']>[0], options?: Parameters<Firestore['runTransaction']>[1]) => {
            let first = true;
            return target.runTransaction(async transaction => {
              attempts += 1;
              const result = await update(transaction);
              if (first) {
                first = false;
                arrived += 1;
                if (arrived === reviews.length) open();
                await Promise.race([everyoneRead, new Promise(resolve => { setTimeout(resolve, 5_000); })]);
              }
              return result;
            }, options);
          };
        }
        const value = Reflect.get(target, property, target) as unknown;
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    const outcomes = await Promise.allSettled(reviews.map(review => review(overlapping)));
    return { outcomes, retried: attempts > reviews.length };
  };
  const fulfilled = <T>({ outcomes, retried }: { outcomes: PromiseSettledResult<T>[]; retried: boolean }) => ({
    retried,
    results: outcomes.map(outcome => {
      if (outcome.status === 'rejected') throw outcome.reason;
      return outcome.value;
    }),
  });
  const SINCE_LAST_ACTION_MS = 50_000;
  const cards = [newCard('word-focus', 'focus'), newCard('word-lead', 'lead')];
  const seedAccount = async (now: number) => {
    const ownerId = `concurrent-reviews-${randomUUID()}`;
    const batch = database.batch();
    batch.set(database.doc(`users/${ownerId}/profile/library_state`), { schemaVersion: 2, libraryEpoch: 0 });
    batch.set(database.doc(`users/${ownerId}/profile/stats`), studiedYesterday(now, SINCE_LAST_ACTION_MS));
    for (const card of cards) batch.set(database.doc(`users/${ownerId}/cards/${card.id}`), card);
    await batch.commit();
    return ownerId;
  };
  const reviewOf = (ownerId: string, card: ReturnType<typeof newCard>, opId: string): ReviewRequest => {
    const reviewedAt = new Date().toISOString();
    return {
      expectedOwnerId: ownerId, opId, cardId: card.id, baseRevision: card.revision, libraryEpoch: 0, rating: 'good', reviewedAt,
      fields: scheduleReviewTransition(card, 'good', new Date(reviewedAt)) as ReviewRequest['fields'],
      fieldMask: REVIEW_FIELD_MASK, timeZone: 'UTC',
    };
  };
  const storedStats = async (ownerId: string) => (await database.doc(`users/${ownerId}/profile/stats`).get()).data() as DocumentData;
  const storedXpHistory = async (ownerId: string) => (await database.doc(`users/${ownerId}/profile/xp_history`).get()).data();
  // Fields whose value depends on the order or the instant the reviews committed, compared on their own.
  const orderFree = (stats: DocumentData) => {
    const { lastVerifiedReviewAt: _at, studyTimeV1: _time, wordWeeksV1, ...rest } = stats;
    const { wordOfWeekByLanguage: _pick, ...words } = wordWeeksV1 as DocumentData;
    return { ...rest, wordWeeksV1: words };
  };
  // A twin account with the same stored stats that receives the same reviews one after the other.
  const oneAfterAnother = async (now: number, reviews: Array<{ card: ReturnType<typeof newCard>; opId: string }>) => {
    const ownerId = await seedAccount(now);
    for (const { card, opId } of reviews) await applyReviewForOwner(database, ownerId, reviewOf(ownerId, card, opId));
    return { stats: await storedStats(ownerId), xpHistory: await storedXpHistory(ownerId) };
  };
  const creditedTime = (stats: DocumentData) => (stats.studyTimeV1 as { totalMs: number }).totalMs - 90_000;

  it('counts two different cards once each in every record', async () => {
    const now = Date.now();
    const ownerId = await seedAccount(now);
    const { results, retried } = fulfilled(await atTheSameTime(cards.map((card, index) => (overlapping: Firestore) => (
      applyReviewForOwner(overlapping, ownerId, reviewOf(ownerId, card, `device-${index}:review-1`))
    ))));
    const finishedAt = Date.now();
    expect(results.map(result => result.duplicate)).toEqual([false, false]);
    const stats = await storedStats(ownerId);
    const today = results[0].gamification!.studyDay;
    expect(stats).toMatchObject({
      verifiedXp: 640 + 2 * REVIEW_CARD_XP,
      verifiedStreak: 7,
      dailyGoalsV1: { days: { [today]: { studiedCards: 2, matchWins: 0 } } },
      reviewActivityV1: { daysByLanguage: { en: { [today]: { reviewed: 2, good: 2 } } } },
      streakV1: { days: { [today]: 'studied' }, best: 7 },
      achievementsV1: { counters: { activeDays: 7, lastXpDay: today, lastXpDayXp: 2 * REVIEW_CARD_XP, reviewedCards: 26 } },
      wordWeeksV1: { daysByLanguage: { en: { [today]: { started: 2, mastered: 0 } } } },
    });
    expect(await storedXpHistory(ownerId)).toMatchObject({ verifiedByDayV1: { [today]: 2 * REVIEW_CARD_XP } });
    // Study time is one chain: the receipts add up to what the record gained, and the record never gains
    // more than the server time that passed since the last action, which crediting both would exceed.
    const credited = creditedTime(stats);
    expect(results.reduce((sum, result) => sum + (result.gamification?.studyTimeMs ?? 0), 0)).toBe(credited);
    expect(credited).toBeGreaterThanOrEqual(SINCE_LAST_ACTION_MS);
    expect(credited).toBeLessThanOrEqual(finishedAt - (now - SINCE_LAST_ACTION_MS));
    expect(parseStudyTime(stats.studyTimeV1)?.days[today]).toMatchObject({ activeMs: credited, reviewMs: credited });

    const twin = await oneAfterAnother(now, cards.map((card, index) => ({ card, opId: `device-${index}:review-1` })));
    expect(orderFree(stats)).toEqual(orderFree(twin.stats));
    expect(retried).toBe(true);
  });

  it('counts a review once when its retry arrives while the first attempt is still running', async () => {
    const now = Date.now();
    const ownerId = await seedAccount(now);
    const request = reviewOf(ownerId, cards[0], 'device-a:review-1');
    const { results, retried } = fulfilled(await atTheSameTime([request, request].map(sent => (overlapping: Firestore) => (
      applyReviewForOwner(overlapping, ownerId, sent)
    ))));
    expect(results.map(result => result.duplicate).sort()).toEqual([false, true]);
    const applied = results.find(result => !result.duplicate) as ReviewPersistenceResult;
    const stats = await storedStats(ownerId);
    const today = applied.gamification!.studyDay;
    expect(stats).toMatchObject({
      verifiedXp: 640 + REVIEW_CARD_XP,
      dailyGoalsV1: { days: { [today]: { studiedCards: 1 } } },
      reviewActivityV1: { daysByLanguage: { en: { [today]: { reviewed: 1 } } } },
      achievementsV1: { counters: { activeDays: 7, reviewedCards: 25 } },
      wordWeeksV1: { daysByLanguage: { en: { [today]: { started: 1, mastered: 0 } } } },
    });
    expect(creditedTime(stats)).toBe(applied.gamification?.studyTimeMs);
    const card = (await database.doc(`users/${ownerId}/cards/${cards[0].id}`).get()).data();
    expect(card).toMatchObject({ reviews: 1, revision: 2, appliedReviewOperationIds: ['device-a:review-1'] });

    const twin = await oneAfterAnother(now, [{ card: cards[0], opId: 'device-a:review-1' }]);
    expect(orderFree(stats)).toEqual(orderFree(twin.stats));
    expect(retried).toBe(true);
  });

  it('counts one of two reviews of the same card from two devices and refuses the other', async () => {
    const now = Date.now();
    const ownerId = await seedAccount(now);
    const { outcomes, retried } = await atTheSameTime(['device-a:review-1', 'device-b:review-1'].map(opId => (overlapping: Firestore) => (
      applyReviewForOwner(overlapping, ownerId, reviewOf(ownerId, cards[0], opId))
    )));
    const applied = outcomes.flatMap(outcome => (outcome.status === 'fulfilled' ? [outcome.value] : []));
    const refused = outcomes.flatMap(outcome => (outcome.status === 'rejected' ? [outcome.reason] : []));
    expect(applied).toHaveLength(1);
    expect(refused).toHaveLength(1);
    expect(refused[0]).toBeInstanceOf(ReviewPersistenceConflictError);
    expect((refused[0] as ReviewPersistenceConflictError).reason).toBe('revision-conflict');
    const stats = await storedStats(ownerId);
    const today = applied[0].gamification!.studyDay;
    expect(stats).toMatchObject({
      verifiedXp: 640 + REVIEW_CARD_XP,
      dailyGoalsV1: { days: { [today]: { studiedCards: 1 } } },
      achievementsV1: { counters: { reviewedCards: 25 } },
      wordWeeksV1: { daysByLanguage: { en: { [today]: { started: 1, mastered: 0 } } } },
    });
    expect(creditedTime(stats)).toBe(applied[0].gamification?.studyTimeMs);
    expect(retried).toBe(true);
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
