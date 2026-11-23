/**
 * Stored stats, XP history and rewards documents in the exact shape the verified-action
 * transaction writes them, for tests of the streak, achievement, study time and weekly word
 * surfaces. Test support only: product code must never import this file.
 *
 * All fixtures use Ho Chi Minh City (UTC+7, no daylight saving); "now" is given in UTC.
 */
import { verifiedGamificationFromDocuments, type VerifiedGamificationState } from '../verifiedGamificationClient';

export interface VerifiedStatsFixture {
  readonly now: Date;
  readonly stats: Record<string, unknown>;
  readonly history?: Record<string, unknown>;
  readonly rewards?: Record<string, unknown>;
}

export const FIXTURE_TIME_ZONE = 'Asia/Ho_Chi_Minh';

const verifiedStats = (fields: Record<string, unknown>): Record<string, unknown> => ({
  streak: 0, xp: 0, lastActive: null, verifiedSchemaVersion: 1, rewardTimeZone: FIXTURE_TIME_ZONE, ...fields,
});

const studiedDays = (from: string, to: string): Record<string, 'studied'> => {
  const days: Record<string, 'studied'> = {};
  for (let day = from; day <= to; day = new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)) {
    days[day] = 'studied';
  }
  return days;
};

export const streakFixtures = {
  /** The server has not written the streak record yet; the legacy reward freeze still counts. */
  legacyOpen: {
    now: new Date('2026-11-19T01:00:00.000Z'),
    stats: verifiedStats({ verifiedXp: 240, verifiedStreak: 6, lastVerifiedStudyDay: '2026-11-18' }),
    rewards: { streakFreezes: 1 },
  },
  /** Run of 11 last studied Tuesday, one freeze held, Thursday morning: Wednesday is frozen. */
  frozenOneDay: {
    now: new Date('2026-11-19T00:30:00.000Z'),
    stats: verifiedStats({
      verifiedXp: 1_204, verifiedStreak: 11, lastVerifiedStudyDay: '2026-11-17',
      streakV1: {
        coverageStartedOn: '2026-11-10', freezes: 1, refilledWeek: '2026-11-16', best: 11, bestCountedFrom: '2026-09-28',
        days: studiedDays('2026-11-10', '2026-11-17'), milestones: { 7: '2026-11-13' }, repair: null, lastRepairedOn: null,
      },
    }),
  },
  /** Run of 23 last studied Monday, no freeze, back Wednesday at noon: the repair is open until Thursday ends. */
  repairAvailable: {
    now: new Date('2026-11-18T05:00:00.000Z'),
    stats: verifiedStats({
      verifiedXp: 2_480, verifiedStreak: 23, lastVerifiedStudyDay: '2026-11-16',
      streakV1: {
        coverageStartedOn: '2026-11-02', freezes: 0, refilledWeek: '2026-11-16', best: 23, bestCountedFrom: '2026-10-25',
        days: studiedDays('2026-11-03', '2026-11-16'), milestones: { 7: null, 14: '2026-11-07' }, repair: null, lastRepairedOn: null,
      },
    }),
  },
  /** The same break after the first review back: 8 of 20 cards done, the new run is 1. */
  repairInProgress: {
    now: new Date('2026-11-18T13:00:00.000Z'),
    stats: verifiedStats({
      verifiedXp: 2_496, verifiedStreak: 1, lastVerifiedStudyDay: '2026-11-18',
      streakV1: {
        coverageStartedOn: '2026-11-02', freezes: 0, refilledWeek: '2026-11-16', best: 23, bestCountedFrom: '2026-10-25',
        days: { ...studiedDays('2026-11-05', '2026-11-16'), '2026-11-18': 'studied' },
        milestones: { 7: null, 14: '2026-11-07' },
        repair: {
          runLength: 23, lastStudiedOn: '2026-11-16', endedOn: '2026-11-17', deadline: '2026-11-19', cardsDone: 8, cardsNeeded: 20,
        },
        lastRepairedOn: null,
      },
    }),
  },
  /** Back on Friday: past the repair window, the 23-day run has ended for good. */
  endedNoRepair: {
    now: new Date('2026-11-20T02:00:00.000Z'),
    stats: verifiedStats({
      verifiedXp: 2_480, verifiedStreak: 23, lastVerifiedStudyDay: '2026-11-16',
      streakV1: {
        coverageStartedOn: '2026-11-02', freezes: 0, refilledWeek: '2026-11-16', best: 23, bestCountedFrom: '2026-10-25',
        days: studiedDays('2026-11-03', '2026-11-16'), milestones: { 7: null, 14: '2026-11-07' }, repair: null, lastRepairedOn: null,
      },
    }),
  },
  /** Studied today and reached 30 days: the milestone, its freeze and two freezes held. */
  safeAtMilestone: {
    now: new Date('2026-11-19T12:00:00.000Z'),
    stats: verifiedStats({
      verifiedXp: 3_310, verifiedStreak: 30, lastVerifiedStudyDay: '2026-11-19',
      streakV1: {
        coverageStartedOn: '2026-10-21', freezes: 2, refilledWeek: '2026-11-16', best: 30, bestCountedFrom: '2026-10-21',
        days: studiedDays('2026-11-06', '2026-11-19'),
        milestones: { 7: '2026-10-27', 14: '2026-11-03', 30: '2026-11-19' }, repair: null, lastRepairedOn: null,
      },
    }),
    rewards: { unlockedBadgeIds: ['web-wanderer'], receipts: { 'streak-30-v1': true } },
  },
} satisfies Record<string, VerifiedStatsFixture>;

/** First verified action after achievements shipped (Friday 27 Nov 2026), an Easy review at 22:40. */
export const achievementsFixture = {
  now: new Date('2026-11-27T15:45:00.000Z'),
  stats: verifiedStats({
    verifiedXp: 622, verifiedStreak: 4, lastVerifiedStudyDay: '2026-11-27',
    achievementsV1: {
      catalogVersion: 1,
      recordingStartedOn: '2026-11-27',
      counters: {
        activeDays: 10, lastXpDay: '2026-11-27', lastXpDayXp: 2, bestDayXp: 130,
        reviewedCards: 37, masteredWords: 13, lateReviews: 1, spellingCorrect: 0,
      },
      badges: {
        'first-review': { on: '2026-11-27', exact: false },
        'active-days-3': { on: '2026-11-27', exact: false },
        'active-days-5': { on: '2026-11-27', exact: false },
        'reviewed-10': { on: '2026-11-27', exact: false },
        'day-xp-100': { on: '2026-11-27', exact: false },
        'xp-500': { on: '2026-11-27', exact: false },
      },
      titles: {},
    },
  }),
  rewards: { ownedTitleIds: [] },
} satisfies VerifiedStatsFixture;

/** Thursday 19 Nov 2026 at 20:05, after the session in which 135 s were credited. */
export const studyTimeFixture = {
  now: new Date('2026-11-19T13:05:00.000Z'),
  stats: verifiedStats({
    verifiedXp: 900, verifiedStreak: 5, lastVerifiedStudyDay: '2026-11-19',
    studyTimeV1: {
      coverageStartedOn: '2026-11-12',
      fromFirstAction: false,
      lastActionAtMs: Date.parse('2026-11-19T13:04:05.000Z'),
      totalMs: 1_515_000,
      days: {
        '2026-11-12': { activeMs: 240_000, reviewMs: 240_000, timedReviews: 12 },
        '2026-11-14': { activeMs: 420_000, reviewMs: 300_000, timedReviews: 14 },
        '2026-11-17': { activeMs: 360_000, reviewMs: 360_000, timedReviews: 16 },
        '2026-11-18': { activeMs: 360_000, reviewMs: 300_000, timedReviews: 15 },
        '2026-11-19': { activeMs: 135_000, reviewMs: 90_000, timedReviews: 4 },
      },
    },
  }),
} satisfies VerifiedStatsFixture;

/** Thursday 19 Nov 2026: 146 words started this week against a best week of 108 last week. */
export const wordWeeksFixture = {
  now: new Date('2026-11-19T13:05:00.000Z'),
  stats: verifiedStats({
    verifiedXp: 4_200, verifiedStreak: 12, lastVerifiedStudyDay: '2026-11-19',
    reviewActivityV1: {
      coverageStartedOnByLanguage: { en: '2026-09-28' },
      daysByLanguage: {
        en: {
          '2026-11-16': { reviewed: 60, again: 6, hard: 9, good: 41, easy: 4 },
          '2026-11-17': { reviewed: 40, again: 4, hard: 6, good: 28, easy: 2 },
          '2026-11-19': { reviewed: 30, again: 2, hard: 5, good: 21, easy: 2 },
        },
      },
    },
    wordWeeksV1: {
      coverageStartedOn: '2026-11-02',
      fromFirstAction: false,
      daysByLanguage: {
        en: {
          '2026-11-09': { started: 30, mastered: 2 },
          '2026-11-11': { started: 40, mastered: 1 },
          '2026-11-13': { started: 38, mastered: 4 },
          '2026-11-16': { started: 61, mastered: 3 },
          '2026-11-17': { started: 45, mastered: 2 },
          '2026-11-19': { started: 40, mastered: 5 },
        },
      },
      bestWeekByLanguage: { en: { weekStart: '2026-11-09', started: 108 } },
      wordOfWeekByLanguage: {
        en: {
          '2026-11-09': { cardId: 'word-instant', reviews: 5 },
          '2026-11-16': { cardId: 'word-immediate', reviews: 4 },
        },
      },
    },
  }),
} satisfies VerifiedStatsFixture;

/** The client state the subscriptions would build from a fixture's documents. */
export const stateFromFixture = (fixture: VerifiedStatsFixture): VerifiedGamificationState =>
  verifiedGamificationFromDocuments(fixture.stats, fixture.history ?? {}, fixture.rewards ?? {});
