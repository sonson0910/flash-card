// Account-wide study time in `stats.studyTimeV1`, credited from the gaps between verified actions
// as the server receives them. Only the verified-action transaction writes it; the map is
// display-only, so a malformed stored value starts over instead of failing a review.
// Shared by the Functions and the web client: import nothing that only one of them can load.
import { isCount, isPlainRecord, isStudyDay } from './study-day-rules.js';

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
