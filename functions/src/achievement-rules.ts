// Badges and titles the server can verify, and the stored `stats.achievementsV1` record of when
// each was first met. Only the verified-action transaction writes the record; records are never
// removed or changed once written. Badge and title ids are permanent once stored.
// Shared by the Functions and the web client: import nothing that only one of them can load.
import { isCount, isPlainRecord, isStudyDay } from './study-day-rules.js';

/** Raised when the catalog gains a definition; never lowered. */
export const ACHIEVEMENT_CATALOG_VERSION = 1;
/** A review that earns XP between this local hour and midnight, or before the end hour, is late. */
export const LATE_REVIEW_START_HOUR = 22;
export const LATE_REVIEW_END_HOUR = 4;

export type AchievementTier = 'bud' | 'bloom' | 'star';

export type AchievementMetric =
  /** Distinct cards reviewed at least once, across every course. */
  | 'reviewedCards'
  /** Study days that earned verified XP. */
  | 'activeDays'
  /** The most verified XP earned on one study day. */
  | 'bestDayXp'
  /** The verified streak, in studied days. */
  | 'streak'
  /** Reviews that earned XP late at night in the account's time zone. */
  | 'lateReviews'
  /** Correct answers in verified spelling sessions. */
  | 'spellingCorrect'
  /** Total verified XP. */
  | 'verifiedXp'
  /** Distinct cards first rated Easy. */
  | 'masteredWords';

export interface AchievementBadge {
  readonly id: string;
  readonly tier: AchievementTier;
  readonly metric: AchievementMetric;
  readonly target: number;
}

export const ACHIEVEMENT_BADGES: readonly AchievementBadge[] = [
  { id: 'first-review', tier: 'bud', metric: 'reviewedCards', target: 1 },
  { id: 'active-days-3', tier: 'bud', metric: 'activeDays', target: 3 },
  { id: 'active-days-5', tier: 'bud', metric: 'activeDays', target: 5 },
  { id: 'reviewed-10', tier: 'bloom', metric: 'reviewedCards', target: 10 },
  { id: 'day-xp-100', tier: 'bloom', metric: 'bestDayXp', target: 100 },
  { id: 'streak-7', tier: 'bloom', metric: 'streak', target: 7 },
  { id: 'late-reviews-10', tier: 'bloom', metric: 'lateReviews', target: 10 },
  { id: 'spelling-50', tier: 'bloom', metric: 'spellingCorrect', target: 50 },
  { id: 'xp-500', tier: 'star', metric: 'verifiedXp', target: 500 },
  { id: 'mastered-50', tier: 'star', metric: 'masteredWords', target: 50 },
  { id: 'mastered-100', tier: 'star', metric: 'masteredWords', target: 100 },
  { id: 'web-wanderer', tier: 'star', metric: 'streak', target: 30 },
];

export interface AchievementTitle {
  readonly id: string;
  /** Level reached from verified XP. */
  readonly level: number;
}

/** Lowest first; the highest one recorded is the one shown. */
export const ACHIEVEMENT_TITLES: readonly AchievementTitle[] = [
  { id: 'word-keeper', level: 5 },
  { id: 'word-collector', level: 13 },
];

export interface AchievementCounters {
  readonly activeDays: number;
  readonly lastXpDay: string | null;
  readonly lastXpDayXp: number;
  readonly bestDayXp: number;
  readonly reviewedCards: number;
  readonly masteredWords: number;
  readonly lateReviews: number;
  readonly spellingCorrect: number;
}

export interface AchievementRecord {
  /** Study day in the account's reward time zone. */
  readonly on: string;
  /** False when the condition was already met before recording began: earned on or before `on`. */
  readonly exact: boolean;
}

export interface AchievementsStateV1 {
  readonly catalogVersion: number;
  /** Study day of the first evaluation. */
  readonly recordingStartedOn: string;
  readonly counters: AchievementCounters;
  readonly badges: Readonly<Record<string, AchievementRecord>>;
  readonly titles: Readonly<Record<string, AchievementRecord>>;
}

export const COUNTER_KEYS = [
  'activeDays', 'lastXpDayXp', 'bestDayXp', 'reviewedCards', 'masteredWords', 'lateReviews', 'spellingCorrect',
] as const;

export const zeroAchievementCounters = (): AchievementCounters => ({
  activeDays: 0, lastXpDay: null, lastXpDayXp: 0, bestDayXp: 0,
  reviewedCards: 0, masteredWords: 0, lateReviews: 0, spellingCorrect: 0,
});

const achievementRecords = (value: unknown): Record<string, AchievementRecord> => {
  if (!isPlainRecord(value)) return {};
  return Object.fromEntries(Object.entries(value).flatMap(([id, record]) => (
    /^[a-z0-9-]{1,64}$/.test(id) && isPlainRecord(record) && isStudyDay(record.on) && typeof record.exact === 'boolean'
      ? [[id, { on: record.on, exact: record.exact }]] : []
  )));
};

/** The badge and title records that are valid, even when the rest of the stored map is not. */
export const parseAchievementRecords = (value: unknown): Pick<AchievementsStateV1, 'badges' | 'titles'> => ({
  badges: achievementRecords(isPlainRecord(value) ? value.badges : undefined),
  titles: achievementRecords(isPlainRecord(value) ? value.titles : undefined),
});

const parseCounters = (value: unknown): AchievementCounters | undefined => {
  if (!isPlainRecord(value) || !COUNTER_KEYS.every(key => isCount(value[key]))
    || !(value.lastXpDay === null || isStudyDay(value.lastXpDay))) return undefined;
  const counts = Object.fromEntries(COUNTER_KEYS.map(key => [key, value[key]])) as Omit<AchievementCounters, 'lastXpDay'>;
  return { ...counts, lastXpDay: value.lastXpDay };
};

/**
 * The stored record, or undefined when it is missing or its version, start day or counters are
 * malformed. Invalid badge and title entries are dropped; ids this catalog does not know are kept,
 * because a newer catalog may have written them.
 */
export const parseAchievements = (value: unknown): AchievementsStateV1 | undefined => {
  if (!isPlainRecord(value) || !isCount(value.catalogVersion) || value.catalogVersion < 1
    || !isStudyDay(value.recordingStartedOn)) return undefined;
  const counters = parseCounters(value.counters);
  if (!counters) return undefined;
  return {
    catalogVersion: value.catalogVersion,
    recordingStartedOn: value.recordingStartedOn,
    counters,
    ...parseAchievementRecords(value),
  };
};

/** The level shown for an amount of verified XP; the server uses the same curve. */
export const levelForVerifiedXp = (xp: number): number => Math.floor(Math.sqrt(Math.max(0, xp) / 100)) + 1;
