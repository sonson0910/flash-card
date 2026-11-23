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

/** The run length whose first crossing grants the streak reward receipt, its badge and one freeze. */
export const STREAK_REWARD_RUN = 30;
// Bounds day arithmetic on a corrupt run counter; no real run is a century long.
const MAX_RUN_SPAN_DAYS = 36_600;

const milestoneKey = (length: StreakMilestone) => String(length) as `${StreakMilestone}`;

/** True when a review changed something the learner should be told about. */
export const isStreakChangeWorthShowing = (change: StreakChange): boolean => change.freezesUsed > 0
  || change.freezesEarned > 0 || (change.freezesRefilled ?? 0) > 0 || change.milestone !== undefined
  || change.repairOffered === true || change.repaired === true;

export interface InitialStreakInput {
  /** `verifiedStreak` before this action. */
  readonly run: number;
  /** `lastVerifiedStudyDay` before this action. */
  readonly lastStudyDay: string | null;
  readonly today: string;
  /** Days with a verified review, from the stored review activity of every course language. */
  readonly reviewedDays: readonly string[];
  /** `rewards.streakFreezes`, folded into the record once and then deleted. */
  readonly legacyFreezes: number;
  /** The 30-day reward receipt is already held. */
  readonly rewardReceiptHeld: boolean;
}

/**
 * The record an account gets on its first verified action after streak records began. Best is the
 * longest run the stored evidence shows (never below the current run), every milestone at or below
 * it counts as reached on an unknown day, and no freeze is granted for 7-day steps already passed.
 */
export const initialStreakState = (input: InitialStreakInput): StreakStateV1 => {
  const reviewed = new Set(input.reviewedDays.filter(isStudyDay));
  const sorted = [...reviewed].sort();
  let best = 0;
  let current = 0;
  let previous: string | null = null;
  for (const day of sorted) {
    current = previous !== null && studyDaysBetween(previous, day) === 1 ? current + 1 : 1;
    best = Math.max(best, current);
    previous = day;
  }
  let earliest: string | null = sorted[0] ?? null;
  const run = isCount(input.run) ? input.run : 0;
  if (input.lastStudyDay !== null && isStudyDay(input.lastStudyDay) && run >= 1) {
    const span = Math.min(run, MAX_RUN_SPAN_DAYS);
    const runStart = shiftStudyDay(input.lastStudyDay, 1 - span);
    let length = run;
    for (let day = shiftStudyDay(runStart, -1); reviewed.has(day); day = shiftStudyDay(day, -1)) length += 1;
    for (let day = shiftStudyDay(input.lastStudyDay, 1); reviewed.has(day); day = shiftStudyDay(day, 1)) length += 1;
    best = Math.max(best, length);
    if (earliest === null || runStart < earliest) earliest = runStart;
  }
  const milestones: Partial<Record<`${StreakMilestone}`, string | null>> = {};
  for (const length of STREAK_MILESTONES) if (length <= best) milestones[milestoneKey(length)] = null;
  if (input.rewardReceiptHeld) milestones[milestoneKey(STREAK_REWARD_RUN as StreakMilestone)] = null;
  return {
    coverageStartedOn: input.today,
    freezes: isCount(input.legacyFreezes) ? Math.min(input.legacyFreezes, STREAK_FREEZE_CAP) : 0,
    refilledWeek: null,
    best,
    bestCountedFrom: earliest ?? input.today,
    days: {},
    milestones,
    repair: null,
    lastRepairedOn: null,
  };
};

export interface StreakAdvanceInput {
  readonly state: StreakStateV1;
  /** `verifiedStreak` before this action. */
  readonly run: number;
  /** `lastVerifiedStudyDay` before this action. */
  readonly lastStudyDay: string | null;
  /** This action's study day in the account's reward time zone. */
  readonly today: string;
  /** A review accepted by the server. Other actions only expire a repair offer whose window closed. */
  readonly review: boolean;
  /** The review earned XP: the first review of this card today. Only these count toward a repair. */
  readonly earnedXp: boolean;
  /** This action grants the 30-day reward receipt, which adds one freeze. */
  readonly grantsRewardFreeze: boolean;
}

export interface StreakAdvance {
  readonly state: StreakStateV1;
  /** `verifiedStreak` after this action. */
  readonly run: number;
  /** The length crossings count from: the old run, the repaired run, or 0 when a new run started. */
  readonly previousRun: number;
  readonly change: StreakChange;
}

const keepNewestMarks = (days: Record<string, StreakDayMark>): Record<string, StreakDayMark> => Object.fromEntries(
  Object.entries(days).sort(([left], [right]) => (left < right ? 1 : left > right ? -1 : 0)).slice(0, STREAK_DAY_MARKS_KEPT),
);

/**
 * Applies one verified action to the streak. Missed days each use one held freeze; a gap the
 * freezes cannot bridge ends the run and may open a repair offer; XP-earning reviews inside the
 * window complete it. Crossings then earn freezes and record milestones, and the first review of
 * a week tops freezes up. Pure: the caller writes the result inside the stats write.
 */
export const advanceStreak = (input: StreakAdvanceInput): StreakAdvance => {
  const { today } = input;
  const storedRun = isCount(input.run) ? input.run : 0;
  const offer = input.state.repair && today > input.state.repair.deadline ? null : input.state.repair;
  const settled = offer === input.state.repair ? input.state : { ...input.state, repair: null };
  const last = input.lastStudyDay !== null && isStudyDay(input.lastStudyDay) ? input.lastStudyDay : null;
  if (!input.review || (last !== null && today < last)) {
    return { state: settled, run: storedRun, previousRun: storedRun, change: { freezesUsed: 0, freezesEarned: 0 } };
  }
  const days: Record<string, StreakDayMark> = { ...settled.days };
  let freezes = settled.freezes;
  let repair = offer;
  let lastRepairedOn = settled.lastRepairedOn;
  let run: number;
  let previousRun: number;
  let freezesUsed = 0;
  let repairOffered = false;
  let repaired = false;
  if (last !== null && today === last) {
    run = storedRun;
    previousRun = storedRun;
  } else if (last === null || storedRun < 1) {
    run = 1;
    previousRun = 0;
  } else {
    const missed = studyDaysBetween(last, today) - 1;
    const covered = Math.min(missed, freezes);
    for (let offset = 1; offset <= covered; offset += 1) days[shiftStudyDay(last, offset)] = 'frozen';
    freezes -= covered;
    freezesUsed = covered;
    if (missed <= covered) {
      run = storedRun + 1;
      previousRun = storedRun;
    } else {
      run = 1;
      previousRun = 0;
      repair = repairOfferFor(storedRun, last, shiftStudyDay(last, covered + 1), today, lastRepairedOn);
      repairOffered = repair !== null;
    }
  }
  if (repair && input.earnedXp) {
    const cardsDone = Math.min(repair.cardsDone + 1, repair.cardsNeeded);
    if (cardsDone < repair.cardsNeeded) {
      repair = { ...repair, cardsDone };
    } else {
      for (let day = repair.endedOn; day < today; day = shiftStudyDay(day, 1)) days[day] ??= 'repaired';
      previousRun = repair.runLength;
      run = Math.min(repair.runLength + run, Number.MAX_SAFE_INTEGER);
      repair = null;
      lastRepairedOn = today;
      repaired = true;
    }
  }
  let freezesEarned = 0;
  const earn = (count: number) => {
    const next = Math.min(STREAK_FREEZE_CAP, freezes + Math.max(0, count));
    if (next > freezes) {
      freezesEarned += next - freezes;
      freezes = next;
    }
  };
  earn(Math.floor(run / STREAK_FREEZE_EARN_EVERY_DAYS) - Math.floor(previousRun / STREAK_FREEZE_EARN_EVERY_DAYS));
  if (input.grantsRewardFreeze && previousRun < STREAK_REWARD_RUN && run >= STREAK_REWARD_RUN) earn(1);
  let freezesRefilled = 0;
  let refilledWeek = settled.refilledWeek;
  if (STREAK_FREEZE_WEEKLY_TOP_UP > 0 && refilledWeek !== weekStartOf(today)) {
    const next = Math.max(freezes, Math.min(STREAK_FREEZE_WEEKLY_TOP_UP, STREAK_FREEZE_CAP));
    freezesRefilled = next - freezes;
    freezes = next;
    refilledWeek = weekStartOf(today);
  }
  const milestones: Partial<Record<`${StreakMilestone}`, string | null>> = { ...settled.milestones };
  let milestone: StreakMilestone | undefined;
  for (const length of STREAK_MILESTONES) {
    if (previousRun < length && run >= length && !Object.hasOwn(milestones, milestoneKey(length))) {
      milestones[milestoneKey(length)] = today;
      milestone = length;
    }
  }
  const best = Math.max(settled.best, run);
  for (const length of STREAK_MILESTONES) {
    if (length <= best && !Object.hasOwn(milestones, milestoneKey(length))) milestones[milestoneKey(length)] = null;
  }
  days[today] = 'studied';
  return {
    state: {
      ...settled, freezes, refilledWeek, best, days: keepNewestMarks(days), milestones, repair, lastRepairedOn,
    },
    run,
    previousRun,
    change: {
      freezesUsed,
      freezesEarned,
      ...(freezesRefilled > 0 ? { freezesRefilled } : {}),
      ...(milestone !== undefined ? { milestone } : {}),
      ...(repairOffered ? { repairOffered: true as const } : {}),
      ...(repaired ? { repaired: true as const } : {}),
    },
  };
};
