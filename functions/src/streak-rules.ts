// Streak freezes, repair, milestones and best streak. Only the verified-action transaction writes
// `stats.streakV1`; the web client and the weekly email read it through the same parser and the
// same projection, so they always agree with what the server will do on the next review.
// Shared by the Functions and the web client: import nothing that only one of them can load.
import {
  isCount, isPlainRecord, isStudyDay, shiftStudyDay, studyDaysBetween, weekStartOf,
} from './study-day-rules.js';

/** Freezes held at most. Nothing is banked above it. */
export const STREAK_FREEZE_CAP = 2;
/** One freeze is earned each time the run reaches a multiple of this many studied days. */
export const STREAK_FREEZE_EARN_EVERY_DAYS = 7;
/** The first review of each Monday-to-Sunday week tops held freezes up to this count; 0 turns it off. */
export const STREAK_FREEZE_WEEKLY_TOP_UP = 2;
/** Run lengths that are recorded and celebrated the first time they are reached. */
export const STREAK_MILESTONES = [7, 14, 30, 60] as const;
/** Bonus verified XP granted once, the first time a milestone is reached. */
export const STREAK_MILESTONE_XP: Readonly<Partial<Record<StreakMilestone, number>>> = { 30: 100 };
/** Distinct cards that must earn review XP inside the repair window. */
export const STREAK_REPAIR_CARDS = 20;
/** Only a run at least this long can be repaired. */
export const STREAK_REPAIR_MIN_RUN = 3;
/** The repair window ends with the study day this many days after the first uncovered missed day. */
export const STREAK_REPAIR_WINDOW_DAYS = 2;
/** Days that must pass after a repair before another repair is offered. */
export const STREAK_REPAIR_COOLDOWN_DAYS = 30;
/** Day marks kept, newest first. */
export const STREAK_DAY_MARKS_KEPT = 14;

export type StreakMilestone = typeof STREAK_MILESTONES[number];
export type StreakDayMark = 'studied' | 'frozen' | 'repaired';

export interface StreakRepairOffer {
  /** Length of the run that ended. */
  readonly runLength: number;
  /** Its last studied day. */
  readonly lastStudiedOn: string;
  /** The first missed day no freeze covered. */
  readonly endedOn: string;
  /** The last study day on which the repair can still be completed. */
  readonly deadline: string;
  readonly cardsDone: number;
  readonly cardsNeeded: number;
}

export interface StreakStateV1 {
  /** First study day this record was written; day marks before it are unknown. */
  readonly coverageStartedOn: string;
  readonly freezes: number;
  /** Monday of the week whose first review last topped freezes up, or null before the first one. */
  readonly refilledWeek: string | null;
  /** Longest verified run in studied days. */
  readonly best: number;
  /** Earliest day the best-streak evidence covers. */
  readonly bestCountedFrom: string | null;
  /** The newest study days that have a mark. */
  readonly days: Readonly<Record<string, StreakDayMark>>;
  /** Milestone length to the study day it was first reached; null means reached before tracking. */
  readonly milestones: Readonly<Partial<Record<`${StreakMilestone}`, string | null>>>;
  readonly repair: StreakRepairOffer | null;
  readonly lastRepairedOn: string | null;
}

/** What one review changed, returned to the client as an optional outcome key. */
export interface StreakChange {
  readonly freezesUsed: number;
  readonly freezesEarned: number;
  /** Freezes added by the weekly top-up; present only when it added any. */
  readonly freezesRefilled?: number;
  /** The milestone first reached by this review. */
  readonly milestone?: StreakMilestone;
  /** Bonus XP granted for that milestone. */
  readonly milestoneXp?: number;
  readonly repairOffered?: true;
  readonly repaired?: true;
}

const DAY_MARKS: readonly StreakDayMark[] = ['studied', 'frozen', 'repaired'];

const optionalDay = (value: unknown): string | null => isStudyDay(value) ? value : null;

const repairOffer = (value: unknown): StreakRepairOffer | null => {
  if (!isPlainRecord(value)) return null;
  const { runLength, lastStudiedOn, endedOn, deadline, cardsDone, cardsNeeded } = value;
  if (!isCount(runLength) || runLength < 1 || !isStudyDay(lastStudiedOn) || !isStudyDay(endedOn)
    || !isStudyDay(deadline) || !isCount(cardsDone) || !isCount(cardsNeeded) || cardsNeeded < 1
    || endedOn <= lastStudiedOn || deadline < endedOn) return null;
  return { runLength, lastStudiedOn, endedOn, deadline, cardsDone, cardsNeeded };
};

/**
 * Reads a stored record field by field. A record without a valid coverage day is unusable and
 * returns undefined; any other invalid field falls back to its starting value, so a corrupt
 * record never blocks a review and never throws.
 */
export const parseStreakState = (value: unknown): StreakStateV1 | undefined => {
  if (!isPlainRecord(value) || !isStudyDay(value.coverageStartedOn)) return undefined;
  const days = isPlainRecord(value.days)
    ? Object.fromEntries(Object.entries(value.days).filter((entry): entry is [string, StreakDayMark] => (
      isStudyDay(entry[0]) && DAY_MARKS.includes(entry[1] as StreakDayMark)
    )))
    : {};
  const milestones = isPlainRecord(value.milestones)
    ? Object.fromEntries(STREAK_MILESTONES.flatMap(length => {
      const reached = (value.milestones as Record<string, unknown>)[String(length)];
      return reached === null || isStudyDay(reached) ? [[String(length), reached]] : [];
    }))
    : {};
  const refilledWeek = optionalDay(value.refilledWeek);
  return {
    coverageStartedOn: value.coverageStartedOn,
    freezes: isCount(value.freezes) ? Math.min(value.freezes, STREAK_FREEZE_CAP) : 0,
    refilledWeek: refilledWeek !== null && weekStartOf(refilledWeek) === refilledWeek ? refilledWeek : null,
    best: isCount(value.best) ? value.best : 0,
    bestCountedFrom: optionalDay(value.bestCountedFrom),
    days,
    milestones,
    repair: repairOffer(value.repair),
    lastRepairedOn: optionalDay(value.lastRepairedOn),
  };
};

export type StreakStatusKind =
  /** No run: nothing studied yet, or the run is 0. */
  | 'none'
  /** Studied today. */
  | 'safe'
  /** Studied yesterday; today is still open. */
  | 'open'
  /** Missed days that held freezes cover; studying today keeps the run. */
  | 'frozen'
  /** Missed more days than freezes cover; the run is over. */
  | 'ended';

export interface StreakStatusInput {
  /** `verifiedStreak`: studied days in the run. */
  readonly run: number;
  /** `lastVerifiedStudyDay`. */
  readonly lastStudyDay: string | null;
  /** Today's study day in the account's reward time zone. */
  readonly today: string;
  /** The stored record, when the server has written one. */
  readonly state?: StreakStateV1;
  /** `rewards.streakFreezes`, used only until the server has written the record. */
  readonly legacyFreezes?: number;
}

export interface StreakStatus {
  readonly status: StreakStatusKind;
  /** Run length that counts today: 0 once the run has ended. */
  readonly length: number;
  /** The run before it ended; equals `length` otherwise. */
  readonly previousLength: number;
  /** Freezes held after the missed days so far have used theirs. */
  readonly freezes: number;
  /** Freezes the missed days so far have used. */
  readonly freezesUsedNow: number;
  /** A repair offer that is open today, stored or one the next review will create. */
  readonly repair: StreakRepairOffer | null;
  /** The next review tops freezes up, because it will be the first review of this week. */
  readonly refillPending: boolean;
}

const repairCooledDown = (lastRepairedOn: string | null, today: string): boolean =>
  lastRepairedOn === null || studyDaysBetween(lastRepairedOn, today) >= STREAK_REPAIR_COOLDOWN_DAYS;

/** The repair offer a run that ended on `endedOn` earns when the learner is back on `today`. */
export const repairOfferFor = (
  run: number, lastStudyDay: string, endedOn: string, today: string, lastRepairedOn: string | null,
): StreakRepairOffer | null => {
  const deadline = shiftStudyDay(endedOn, STREAK_REPAIR_WINDOW_DAYS);
  return run >= STREAK_REPAIR_MIN_RUN && today <= deadline && repairCooledDown(lastRepairedOn, today)
    ? { runLength: run, lastStudiedOn: lastStudyDay, endedOn, deadline, cardsDone: 0, cardsNeeded: STREAK_REPAIR_CARDS }
    : null;
};

/**
 * What the server will find on the next review, without writing anything: missed days use one
 * held freeze each, and a gap that freezes cannot bridge ends the run. Nothing runs at midnight;
 * the server applies the same rules on the next review, so the projection is exact.
 */
export const streakStatus = ({ run, lastStudyDay, today, state, legacyFreezes = 0 }: StreakStatusInput): StreakStatus => {
  const held = state ? state.freezes : Math.min(isCount(legacyFreezes) ? legacyFreezes : 0, STREAK_FREEZE_CAP);
  const storedRepair = state?.repair && today <= state.repair.deadline ? state.repair : null;
  const refillPending = STREAK_FREEZE_WEEKLY_TOP_UP > 0 && state?.refilledWeek !== weekStartOf(today);
  const base = { freezes: held, freezesUsedNow: 0, repair: storedRepair, refillPending };
  if (!lastStudyDay || run < 1) return { ...base, status: 'none', length: 0, previousLength: 0 };
  const missed = studyDaysBetween(lastStudyDay, today) - 1;
  if (missed < 0) return { ...base, status: 'safe', length: run, previousLength: run };
  if (missed === 0) return { ...base, status: 'open', length: run, previousLength: run };
  if (missed <= held) {
    return { ...base, status: 'frozen', length: run, previousLength: run, freezes: held - missed, freezesUsedNow: missed };
  }
  const endedOn = shiftStudyDay(lastStudyDay, held + 1);
  return {
    ...base,
    status: 'ended',
    length: 0,
    previousLength: run,
    freezes: 0,
    freezesUsedNow: held,
    repair: storedRepair ?? repairOfferFor(run, lastStudyDay, endedOn, today, state?.lastRepairedOn ?? null),
  };
};

/**
 * Reads the optional `streakChange` key of a review outcome. A malformed value is dropped rather
 * than rejected, so a newer server can never make an outcome unreadable.
 */
export const parseStreakChange = (value: unknown): StreakChange | undefined => {
  if (!isPlainRecord(value) || !isCount(value.freezesUsed) || !isCount(value.freezesEarned)) return undefined;
  const milestone = STREAK_MILESTONES.find(length => length === value.milestone);
  return {
    freezesUsed: value.freezesUsed,
    freezesEarned: value.freezesEarned,
    ...(isCount(value.freezesRefilled) && value.freezesRefilled > 0 ? { freezesRefilled: value.freezesRefilled } : {}),
    ...(milestone ? { milestone } : {}),
    ...(milestone && isCount(value.milestoneXp) && value.milestoneXp > 0 ? { milestoneXp: value.milestoneXp } : {}),
    ...(value.repairOffered === true ? { repairOffered: true as const } : {}),
    ...(value.repaired === true ? { repaired: true as const } : {}),
  };
};
