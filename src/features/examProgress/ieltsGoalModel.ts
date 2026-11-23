import { IELTS_GOAL_KIND, parseIeltsBand, type CourseGoal } from '../../../functions/src/course-profile-contract';

/**
 * Real counts for the reviewed SonFlash IELTS word path. Nothing here estimates an exam band:
 * the band pair is the learner's own latest score and target, both entered by the learner.
 */
export interface IeltsPathCounts {
  /** Distinct lexemes on the IELTS path of the active catalog release. */
  readonly total: number;
  /** Path lexemes with a valid progress projection (active or mastered). */
  readonly started: number;
  /** Path lexemes whose projection is mastered. */
  readonly mastered: number;
  /** Path lexemes mastered in the last 7 days; null when the read reached its limit. */
  readonly masteredLast7: number | null;
}

export interface IeltsGoalFacts {
  readonly kind: string;
  /** The goal's stored level. Free text that is not a band counts as no target. */
  readonly level: string | null;
  readonly targetDate: string | null;
}

export interface IeltsGoalModelInput {
  readonly counts: IeltsPathCounts;
  readonly goal: IeltsGoalFacts;
  /** The learner's latest reported IELTS score, canonical ("6.5"), or null. */
  readonly latestScore: string | null;
  /** Today's study day ("2026-11-19"). */
  readonly today: string;
}

export type IeltsGoalState = 'not-started' | 'started' | 'in-progress' | 'complete';

export interface IeltsGoalModel {
  readonly state: IeltsGoalState;
  readonly total: number;
  readonly started: number;
  readonly mastered: number;
  /** round(100 · mastered / total); the ring and the sentence both read `mastered` and `total`. */
  readonly percent: number;
  /** Shown only when above zero. */
  readonly masteredThisWeek: number | null;
  readonly targetBand: string | null;
  /** Shown only beside a target band. */
  readonly latestScore: string | null;
  /** The goal's exam date when it is still ahead. */
  readonly examDate: string | null;
  readonly daysToExam: number | null;
  /** True when the exam falls in the current study year, so its date can leave the year out. */
  readonly examThisYear: boolean;
}

/**
 * The goal the IELTS panel reads: the course's active IELTS goal, the one whose band the goal
 * editor and onboarding write. Goal kinds are unique within a course, so a course that also has
 * other goals, in any order, still shows its IELTS target.
 */
export const activeIeltsGoal = (course: { readonly goals: readonly CourseGoal[] } | null | undefined): CourseGoal | null =>
  course?.goals.find(goal => goal.kind === IELTS_GOAL_KIND && goal.status === 'active') ?? null;

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

const dayNumber = (day: string): number | null => {
  if (!DAY_PATTERN.test(day)) return null;
  const [year, month, date] = day.split('-').map(Number);
  const value = Date.UTC(year, month - 1, date);
  return Number.isNaN(value) ? null : value / DAY_MS;
};

/** Whole calendar days from `from` to `to`; null when either is not a calendar day. */
export const daysBetween = (from: string, to: string): number | null => {
  const start = dayNumber(from);
  const end = dayNumber(to);
  return start === null || end === null ? null : end - start;
};

const safeCount = (value: number): number => (Number.isSafeInteger(value) && value > 0 ? value : 0);

/** Null when the goal is not an IELTS goal or the path has no words, so the panel is omitted. */
export const buildIeltsGoalModel = (input: IeltsGoalModelInput): IeltsGoalModel | null => {
  if (input.goal.kind !== IELTS_GOAL_KIND) return null;
  const total = safeCount(input.counts.total);
  if (total === 0) return null;
  const mastered = Math.min(safeCount(input.counts.mastered), total);
  const started = Math.min(Math.max(safeCount(input.counts.started), mastered), total);
  const state: IeltsGoalState = started === 0 ? 'not-started'
    : mastered === 0 ? 'started'
      : mastered === total ? 'complete' : 'in-progress';
  const targetBand = parseIeltsBand(input.goal.level);
  const latestScore = targetBand === null ? null : parseIeltsBand(input.latestScore);
  const daysToExam = input.goal.targetDate ? daysBetween(input.today, input.goal.targetDate) : null;
  const futureExam = daysToExam !== null && daysToExam > 0;
  const week = input.counts.masteredLast7;
  return {
    state,
    total,
    started,
    mastered,
    percent: Math.round((100 * mastered) / total),
    masteredThisWeek: week === null ? null : safeCount(week),
    targetBand,
    latestScore,
    examDate: futureExam ? input.goal.targetDate : null,
    daysToExam: futureExam ? daysToExam : null,
    examThisYear: futureExam && input.goal.targetDate!.slice(0, 4) === input.today.slice(0, 4),
  };
};
