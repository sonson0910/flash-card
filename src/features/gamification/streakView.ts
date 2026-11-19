import {
  STREAK_FREEZE_CAP,
  STREAK_FREEZE_EARN_EVERY_DAYS,
  STREAK_MILESTONES,
  streakStatus,
  type StreakMilestone,
  type StreakStatusKind,
} from '../../../functions/src/streak-rules';
import { shiftStudyDay, weekStartOf } from '../../../functions/src/study-day-rules';
import { nextStudyDayStart, resolveStudyTimeZone, studyDayInZone } from '../dailyGoals/studyDayCountdown';
import type { VerifiedGamificationState } from './verifiedGamificationClient';

export type StreakWeekDayState = 'done' | 'frozen' | 'repaired' | 'missed' | 'today' | 'future';

export interface StreakWeekDay {
  readonly day: string;
  readonly state: StreakWeekDayState;
}

export interface StreakFreezesView {
  /** Freezes held once the missed days so far have used theirs. */
  readonly held: number;
  readonly max: number;
  /** Freezes the missed days are using right now (the frozen state). */
  readonly usingNow: number;
  /** Studied days until the run earns its next freeze. */
  readonly nextEarnIn: number;
  /** The next review is the first of this week and tops freezes up. */
  readonly refillPending: boolean;
}

export interface StreakRepairView {
  /** `available` until a card counts toward it, then `in-progress`. */
  readonly state: 'available' | 'in-progress';
  readonly cardsDone: number;
  readonly cardsNeeded: number;
  /** Length of the run the repair brings back. */
  readonly runLength: number;
  /** Last study day on which the repair can be completed. */
  readonly deadline: string;
  /** The instant the repair window closes: the start of the day after the deadline. */
  readonly endsAt: Date;
}

export interface StreakView {
  readonly status: StreakStatusKind;
  readonly today: string;
  readonly timeZone: string;
  /** Run length that counts today: 0 once the run has ended. */
  readonly length: number;
  /** The run that ended, while it ended or is being repaired; otherwise the current length. */
  readonly previousLength: number;
  readonly freezes: StreakFreezesView;
  readonly repair: StreakRepairView | null;
  /** Longest verified run; null until the server has written the streak record. */
  readonly best: { readonly length: number; readonly countedFrom: string | null } | null;
  readonly nextMilestone: { readonly length: StreakMilestone; readonly daysLeft: number } | null;
  /** Milestones reached: the study day, or null when reached before dates were recorded. */
  readonly milestones: Readonly<Partial<Record<`${StreakMilestone}`, string | null>>>;
  /** Monday to Sunday of this week. */
  readonly week: readonly StreakWeekDay[];
}

/** The first instant after `day` ends in the time zone, found with the DST-safe day-start rule. */
const startOfDayAfter = (day: string, timeZone: string, now: Date): Date => {
  let start = nextStudyDayStart(now, timeZone);
  for (let step = 0; step < 31 && studyDayInZone(start, timeZone) <= day; step += 1) {
    start = nextStudyDayStart(start, timeZone);
  }
  return start;
};

const studiedOnDay = (state: VerifiedGamificationState, day: string): boolean => {
  const { lastStudyDay, streak, streakState } = state;
  if (day === lastStudyDay) return true;
  // Before the record began, the stored run is the only evidence of studied days, and no freeze
  // was ever spent in it, so its days are consecutive studied days.
  if (lastStudyDay && streak > 0 && (!streakState || day < streakState.coverageStartedOn)
    && day <= lastStudyDay && day >= shiftStudyDay(lastStudyDay, 1 - streak)) return true;
  return Object.values(state.reviewActivityByLanguage).some(activity => (activity.days[day]?.reviewed ?? 0) > 0);
};

/**
 * Everything the streak surfaces show, derived from the server's stats with the same rules the
 * server applies on the next review. `now` is read in the account's reward time zone.
 */
export function buildStreakView(state: VerifiedGamificationState, now: Date): StreakView {
  const timeZone = resolveStudyTimeZone(state.rewardTimeZone);
  const today = studyDayInZone(now, timeZone);
  const record = state.streakState;
  const projected = streakStatus({
    run: state.streak,
    lastStudyDay: state.lastStudyDay ?? null,
    today,
    state: record,
    legacyFreezes: state.rewards.streakFreezes,
  });
  const repair = projected.repair;
  const frozenNow = new Set<string>();
  if (state.lastStudyDay) {
    for (let offset = 1; offset <= projected.freezesUsedNow; offset += 1) {
      frozenNow.add(shiftStudyDay(state.lastStudyDay, offset));
    }
  }
  const monday = weekStartOf(today);
  const week = Array.from({ length: 7 }, (_, index): StreakWeekDay => {
    const day = shiftStudyDay(monday, index);
    const mark = record?.days[day];
    const dayState: StreakWeekDayState = day > today ? 'future'
      : mark === 'studied' ? 'done'
        : mark === 'frozen' || frozenNow.has(day) ? 'frozen'
          : mark === 'repaired' ? 'repaired'
            : studiedOnDay(state, day) ? 'done'
              : day === today ? 'today'
                : 'missed';
    return { day, state: dayState };
  });
  const runForMilestones = projected.length;
  const next = STREAK_MILESTONES.find(length => length > runForMilestones);
  return {
    status: projected.status,
    today,
    timeZone,
    length: projected.length,
    previousLength: repair ? repair.runLength : projected.previousLength,
    freezes: {
      held: projected.freezes,
      max: STREAK_FREEZE_CAP,
      usingNow: projected.status === 'frozen' ? projected.freezesUsedNow : 0,
      nextEarnIn: STREAK_FREEZE_EARN_EVERY_DAYS - (projected.length % STREAK_FREEZE_EARN_EVERY_DAYS),
      refillPending: projected.refillPending,
    },
    repair: repair ? {
      state: repair.cardsDone > 0 ? 'in-progress' : 'available',
      cardsDone: Math.min(repair.cardsDone, repair.cardsNeeded),
      cardsNeeded: repair.cardsNeeded,
      runLength: repair.runLength,
      deadline: repair.deadline,
      endsAt: startOfDayAfter(repair.deadline, timeZone, now),
    } : null,
    best: record ? { length: Math.max(record.best, state.streak), countedFrom: record.bestCountedFrom } : null,
    nextMilestone: next ? { length: next, daysLeft: next - runForMilestones } : null,
    milestones: record?.milestones ?? {},
    week,
  };
}
