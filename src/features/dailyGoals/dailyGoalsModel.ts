import { MATCH_WIN_XP, REVIEW_CARD_XP } from '../../../functions/src/xp-rules';
import type { DailyGoalCounts, DailyGoalDayCounts } from '../gamification/verifiedGamificationClient';
import { shiftStudyDay, studyDayCountdown, studyDayInZone, type StudyDayCountdown } from './studyDayCountdown';

/** The server-owned facts the goals are built from; every field comes from the verified stats. */
export interface DailyGoalsSource {
  readonly xpHistory: Readonly<Record<string, number>>;
  readonly streak: number;
  readonly lastStudyDay?: string;
  readonly dailyGoals?: DailyGoalCounts;
}

export interface DailyGoalsInput extends DailyGoalsSource {
  readonly now: Date;
  /** Already resolved: the reward time zone, or the device zone until the server pins one. */
  readonly timeZone: string;
  /** Cards per day from the daily pace setting. */
  readonly dailyPace: number;
  /** Whether today's plan has a Word Match stage. */
  readonly planHasMatch: boolean;
}

export type DailyGoalProgress =
  | { readonly state: 'counted'; readonly done: number; readonly target: number; readonly percent: number }
  /** The server has no count for this part of the day yet (the counters started after XP was earned). */
  | { readonly state: 'unknown'; readonly target: number };

export type DailyGoal =
  | { readonly id: 'study-cards'; readonly cards: number; readonly xp: number; readonly progress: DailyGoalProgress }
  | { readonly id: 'win-match'; readonly xp: number; readonly progress: DailyGoalProgress }
  /** `streakDays` is 0 when there is no open streak to keep. Keeping a streak earns no XP. */
  | { readonly id: 'keep-streak'; readonly streakDays: number; readonly progress: DailyGoalProgress };

export interface DailyGoalsModel {
  readonly studyDay: string;
  readonly resetsIn: StudyDayCountdown;
  readonly goals: readonly DailyGoal[];
}

const counted = (done: number, target: number): DailyGoalProgress => {
  const shown = Math.min(Math.max(0, done), target);
  return { state: 'counted', done: shown, target, percent: Math.round((100 * shown) / target) };
};

/**
 * Today's counts, or null when they cannot be trusted: before the counters existed, XP earned
 * earlier that day was never counted, so a partial count would understate progress.
 */
const countsForDay = (
  studyDay: string,
  dailyGoals: DailyGoalCounts | undefined,
  earnedToday: number,
): DailyGoalDayCounts | null => {
  const zero: DailyGoalDayCounts = { studiedCards: 0, matchWins: 0 };
  if (!dailyGoals) return earnedToday > 0 ? null : zero;
  if (studyDay < dailyGoals.coverageStartedOn) return null;
  const counts = dailyGoals.days[studyDay] ?? zero;
  if (studyDay > dailyGoals.coverageStartedOn) return counts;
  const countedXp = counts.studiedCards * REVIEW_CARD_XP + counts.matchWins * MATCH_WIN_XP;
  return earnedToday > countedXp ? null : counts;
};

export const buildDailyGoals = (input: DailyGoalsInput): DailyGoalsModel => {
  const studyDay = studyDayInZone(input.now, input.timeZone);
  const earnedToday = input.xpHistory[studyDay] ?? 0;
  const counts = countsForDay(studyDay, input.dailyGoals, earnedToday);
  const cards = Math.max(1, Math.floor(input.dailyPace));
  const goals: DailyGoal[] = [{
    id: 'study-cards',
    cards,
    xp: cards * REVIEW_CARD_XP,
    progress: counts ? counted(counts.studiedCards, cards) : { state: 'unknown', target: cards },
  }];
  if (input.planHasMatch || (counts?.matchWins ?? 0) > 0) {
    goals.push({
      id: 'win-match',
      xp: MATCH_WIN_XP,
      progress: counts ? counted(counts.matchWins, 1) : { state: 'unknown', target: 1 },
    });
  }
  const studiedToday = input.lastStudyDay === studyDay;
  const streakOpen = studiedToday || input.lastStudyDay === shiftStudyDay(studyDay, -1);
  goals.push({
    id: 'keep-streak',
    streakDays: streakOpen ? Math.max(0, Math.floor(input.streak)) : 0,
    progress: counted(studiedToday ? 1 : 0, 1),
  });
  return { studyDay, resetsIn: studyDayCountdown(input.now, input.timeZone), goals };
};
