import { Timestamp } from 'firebase-admin/firestore';

// A stats document as an account that has studied for a while holds it, including the records
// that the verified action transaction keeps in it.
export const steadyStats = () => ({
  verifiedSchemaVersion: 1, verifiedXp: 640, verifiedStreak: 6, lastVerifiedStudyDay: '2026-11-18',
  rewardTimeZone: 'Asia/Saigon', lastVerifiedReviewAt: Timestamp.fromDate(new Date('2026-11-18T13:00:00.000Z')),
  reviewActivityV1: {
    coverageStartedOnByLanguage: { en: '2026-11-02' },
    daysByLanguage: { en: { '2026-11-18': { reviewed: 4, again: 0, hard: 1, good: 3, easy: 0 } } },
  },
  dailyGoalsV1: { coverageStartedOn: '2026-11-02', days: { '2026-11-18': { studiedCards: 4, matchWins: 0 } } },
  streakV1: {
    coverageStartedOn: '2026-11-02', freezes: 1, refilledWeek: '2026-11-16', best: 6, bestCountedFrom: '2026-11-13',
    days: { '2026-11-18': 'studied' }, milestones: {}, repair: null, lastRepairedOn: null,
  },
  achievementsV1: {
    catalogVersion: 1, recordingStartedOn: '2026-11-02',
    counters: {
      activeDays: 6, lastXpDay: '2026-11-18', lastXpDayXp: 8, bestDayXp: 60,
      reviewedCards: 24, masteredWords: 3, lateReviews: 0, spellingCorrect: 0,
    },
    badges: { 'first-review': { on: '2026-11-02', exact: false } },
    titles: {},
  },
  studyTimeV1: {
    coverageStartedOn: '2026-11-02', fromFirstAction: false, lastActionAtMs: Date.parse('2026-11-18T13:00:00.000Z'), totalMs: 90_000,
    days: { '2026-11-18': { activeMs: 90_000, reviewMs: 90_000, timedReviews: 6 } },
  },
  wordWeeksV1: {
    coverageStartedOn: '2026-11-02', fromFirstAction: false,
    daysByLanguage: { en: { '2026-11-18': { started: 2, mastered: 0 } } }, bestWeekByLanguage: {}, wordOfWeekByLanguage: {},
  },
});
