// Account-wide study time in `stats.studyTimeV1`, credited from the gaps between verified actions
// as the server receives them. Only the verified-action transaction writes it; the map is
// display-only, so a malformed stored value starts over instead of failing a review.
// Shared by the Functions and the web client: import nothing that only one of them can load.
import { addCount, isCount, isPlainRecord, isStudyDay, latestStudyDay, shiftStudyDay } from './study-day-rules.js';

/** A review that follows the previous action within this gap is credited the whole gap. */
export const STUDY_TIME_FULL_GAP_MS = 60_000;
/** A longer gap, up to this one, is credited the full-gap amount; beyond it a new run starts. */
export const STUDY_TIME_RUN_BREAK_MS = 5 * 60_000;
/** A practice session is credited at most this long per card in it. */
export const STUDY_TIME_PRACTICE_MS_PER_CARD = 20_000;
/** And at most this long in total. */
export const STUDY_TIME_PRACTICE_MAX_MS = 30 * 60_000;
/** Study days kept, counted back from the newest. */
export const STUDY_TIME_DAYS_KEPT = 35;

export interface StudyTimeDay {
  /** All credited time that study day. */
  readonly activeMs: number;
  /** The part credited to reviews. */
  readonly reviewMs: number;
  /** Reviews that were credited a gap; the review pace is reviewMs / timedReviews. */
  readonly timedReviews: number;
}

export interface StudyTimeV1 {
  /** Study day this map was first written; time before it was never counted. */
  readonly coverageStartedOn: string;
  /** Coverage began with the account's first verified action, so totals are lifetime totals. */
  readonly fromFirstAction: boolean;
  /** Server time of the latest credited action, in epoch milliseconds. */
  readonly lastActionAtMs: number;
  readonly totalMs: number;
  readonly days: Readonly<Record<string, StudyTimeDay>>;
}

const studyTimeDay = (value: unknown): StudyTimeDay | undefined => (
  isPlainRecord(value) && isCount(value.activeMs) && isCount(value.reviewMs) && isCount(value.timedReviews)
    && value.reviewMs <= value.activeMs
    ? { activeMs: value.activeMs, reviewMs: value.reviewMs, timedReviews: value.timedReviews }
    : undefined
);

/** The stored map, or undefined when it is missing or any part of it is malformed. */
export const parseStudyTime = (value: unknown): StudyTimeV1 | undefined => {
  if (!isPlainRecord(value) || !isStudyDay(value.coverageStartedOn) || typeof value.fromFirstAction !== 'boolean'
    || !isCount(value.lastActionAtMs) || !isCount(value.totalMs) || !isPlainRecord(value.days)) return undefined;
  const days: Record<string, StudyTimeDay> = {};
  for (const [day, entry] of Object.entries(value.days)) {
    const parsed = studyTimeDay(entry);
    if (!isStudyDay(day) || !parsed) return undefined;
    days[day] = parsed;
  }
  return {
    coverageStartedOn: value.coverageStartedOn,
    fromFirstAction: value.fromFirstAction,
    lastActionAtMs: value.lastActionAtMs,
    totalMs: value.totalMs,
    days,
  };
};

/**
 * The record an account starts when its first verified action credits no time, a card create.
 * Coverage begins with the account, so the reviews and practice after it keep lifetime totals.
 * The chain starts empty: a create is not part of it, so the first review after it is credited
 * nothing, as an account's very first review is.
 */
export const firstActionStudyTime = (studyDay: string): StudyTimeV1 => ({
  coverageStartedOn: studyDay,
  fromFirstAction: true,
  lastActionAtMs: 0,
  totalMs: 0,
  days: {},
});

/** One verified action as the study time record sees it. */
export interface StudyTimeAction {
  /** Server time the action was received, in epoch milliseconds. */
  readonly atMs: number;
  /** Study day of `atMs` in the account's reward time zone. */
  readonly studyDay: string;
  /** Present for a practice completion, which is credited its session time instead of a gap. */
  readonly practice?: {
    /** Server time the session started, or null when unknown (then nothing is credited). */
    readonly startedAtMs: number | null;
    readonly cards: number;
  };
}

/**
 * The time credited to one action, given the previous chained action. A review is credited the
 * gap since that action, at most a minute; a gap of more than five minutes (or none at all, or an
 * action committed out of order) starts a new run and credits nothing. A practice completion is
 * credited the time since its session started or the previous action, whichever is later, capped
 * per card and in total. Chained intervals never overlap, so credited time never exceeds the
 * server time that passed.
 */
export const studyTimeCredit = (lastActionAtMs: number | null, action: StudyTimeAction): { creditMs: number; timed: boolean } => {
  if (action.practice) {
    const { startedAtMs, cards } = action.practice;
    if (startedAtMs === null || !isCount(cards)) return { creditMs: 0, timed: false };
    const from = Math.max(startedAtMs, lastActionAtMs ?? startedAtMs);
    const creditMs = Math.min(action.atMs - from, STUDY_TIME_PRACTICE_MS_PER_CARD * cards, STUDY_TIME_PRACTICE_MAX_MS);
    return { creditMs: Math.max(0, creditMs), timed: false };
  }
  if (lastActionAtMs === null) return { creditMs: 0, timed: false };
  const gap = action.atMs - lastActionAtMs;
  if (gap <= 0 || gap > STUDY_TIME_RUN_BREAK_MS) return { creditMs: 0, timed: false };
  return { creditMs: Math.min(gap, STUDY_TIME_FULL_GAP_MS), timed: true };
};

/**
 * Applies one action to the record. A new record (none stored, or an unusable one) starts its
 * chain at `seed.lastActionAtMs`, so the first review after counting began is not lost.
 */
export const nextStudyTime = (input: {
  readonly stored: StudyTimeV1 | undefined;
  readonly seed: { readonly lastActionAtMs: number | null; readonly fromFirstAction: boolean };
  readonly action: StudyTimeAction;
}): { state: StudyTimeV1; creditMs: number } => {
  const { stored, action } = input;
  const last = stored ? stored.lastActionAtMs : input.seed.lastActionAtMs;
  const { creditMs, timed } = studyTimeCredit(last, action);
  const days: Record<string, StudyTimeDay> = { ...(stored?.days ?? {}) };
  if (creditMs > 0) {
    const day = days[action.studyDay] ?? { activeMs: 0, reviewMs: 0, timedReviews: 0 };
    days[action.studyDay] = {
      activeMs: addCount(day.activeMs, creditMs),
      reviewMs: addCount(day.reviewMs, action.practice ? 0 : creditMs),
      timedReviews: addCount(day.timedReviews, timed ? 1 : 0),
    };
  }
  const windowStart = shiftStudyDay(latestStudyDay(days, action.studyDay), 1 - STUDY_TIME_DAYS_KEPT);
  return {
    creditMs,
    state: {
      coverageStartedOn: stored?.coverageStartedOn ?? action.studyDay,
      fromFirstAction: stored?.fromFirstAction ?? input.seed.fromFirstAction,
      lastActionAtMs: Math.max(last ?? action.atMs, action.atMs),
      totalMs: addCount(stored?.totalMs ?? 0, creditMs),
      days: Object.fromEntries(Object.entries(days).filter(([day]) => day >= windowStart)),
    },
  };
};
