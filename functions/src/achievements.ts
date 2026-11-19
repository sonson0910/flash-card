// Evaluates the verified badges and titles inside the verified-action transaction. The record rides
// in the stats write that every verified action already makes; only an account's first evaluation
// reads a baseline (XP history, two card counts and, through the caller, the rewards document).
import type { DocumentReference, Firestore, Transaction } from 'firebase-admin/firestore';
import {
  ACHIEVEMENT_BADGES, ACHIEVEMENT_CATALOG_VERSION, ACHIEVEMENT_TITLES, LATE_REVIEW_END_HOUR, LATE_REVIEW_START_HOUR,
  levelForVerifiedXp, zeroAchievementCounters,
  type AchievementCounters, type AchievementMetric, type AchievementRecord, type AchievementsStateV1,
} from './achievement-rules.js';
import { addCount, isCount, isPlainRecord, isStudyDay } from './study-day-rules.js';

/** What one verified action contributes. */
export interface AchievementSignals {
  readonly studyDay: string;
  /** All verified XP this action added, including a milestone bonus. */
  readonly xpGained: number;
  /** A review of a card that had never been reviewed. */
  readonly firstReview: boolean;
  /** An Easy rating of a card never rated Easy before. */
  readonly firstEasy: boolean;
  /** A review that earned XP late at night in the account's time zone. */
  readonly lateReview: boolean;
  /** Correct answers of a verified spelling session. */
  readonly correctAnswers: number;
}

/** Values the badges read from the stats document rather than from the counters. */
export interface AchievementTotals {
  readonly verifiedXp: number;
  /** The longest streak known: the run, the best run, and 30 when the 30-day badge is held. */
  readonly streak: number;
}

export interface AchievementEvaluation {
  readonly state: AchievementsStateV1;
  /** Only the leaves that changed, for a merge write; undefined when nothing changed. */
  readonly patch?: Record<string, unknown>;
}

export interface AchievementBaseline {
  /** `xp_history.verifiedByDayV1`, or undefined when the account has no verified history yet. */
  readonly verifiedByDay: unknown;
  readonly reviewedCards: number;
  readonly masteredWords: number;
}

/** True for a local hour from the late start (22:00) until the end hour (04:00). */
export const isLateHour = (date: Date, timeZone: string): boolean => {
  const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', hourCycle: 'h23' })
    .formatToParts(date).find(part => part.type === 'hour')?.value);
  return Number.isInteger(hour) && (hour >= LATE_REVIEW_START_HOUR || hour < LATE_REVIEW_END_HOUR);
};

/** The record of an account's first evaluation, from its stored evidence. */
export const backfilledAchievements = (
  studyDay: string,
  baseline: AchievementBaseline,
  salvaged: Pick<AchievementsStateV1, 'badges' | 'titles'> = { badges: {}, titles: {} },
  storedCatalogVersion = 0,
): AchievementsStateV1 => {
  const days = isPlainRecord(baseline.verifiedByDay)
    ? Object.entries(baseline.verifiedByDay).filter((entry): entry is [string, number] => (
      isStudyDay(entry[0]) && isCount(entry[1]) && entry[1] > 0
    ))
    : [];
  const latest = days.reduce<[string, number] | null>((found, entry) => (!found || entry[0] > found[0] ? entry : found), null);
  return {
    catalogVersion: Math.max(ACHIEVEMENT_CATALOG_VERSION, storedCatalogVersion),
    recordingStartedOn: studyDay,
    counters: {
      ...zeroAchievementCounters(),
      activeDays: days.length,
      lastXpDay: latest?.[0] ?? null,
      lastXpDayXp: latest?.[1] ?? 0,
      bestDayXp: days.reduce((best, [, xp]) => Math.max(best, xp), 0),
      reviewedCards: baseline.reviewedCards,
      masteredWords: baseline.masteredWords,
    },
    badges: salvaged.badges,
    titles: salvaged.titles,
  };
};

const advanceCounters = (counters: AchievementCounters, signals: AchievementSignals): AchievementCounters => {
  let { activeDays, lastXpDay, lastXpDayXp, bestDayXp } = counters;
  if (signals.xpGained > 0) {
    if (lastXpDay === signals.studyDay) {
      lastXpDayXp = addCount(lastXpDayXp, signals.xpGained);
    } else if (lastXpDay === null || signals.studyDay > lastXpDay) {
      activeDays = addCount(activeDays, 1);
      lastXpDay = signals.studyDay;
      lastXpDayXp = signals.xpGained;
    }
    // XP on an earlier day than the last one (a retry across midnight) does not move the counters.
    bestDayXp = Math.max(bestDayXp, lastXpDayXp);
  }
  return {
    activeDays,
    lastXpDay,
    lastXpDayXp,
    bestDayXp,
    reviewedCards: addCount(counters.reviewedCards, signals.firstReview ? 1 : 0),
    masteredWords: addCount(counters.masteredWords, signals.firstEasy ? 1 : 0),
    lateReviews: addCount(counters.lateReviews, signals.lateReview ? 1 : 0),
    spellingCorrect: addCount(counters.spellingCorrect, isCount(signals.correctAnswers) ? signals.correctAnswers : 0),
  };
};

const metricValue = (metric: AchievementMetric, counters: AchievementCounters, totals: AchievementTotals): number => {
  if (metric === 'verifiedXp') return totals.verifiedXp;
  if (metric === 'streak') return totals.streak;
  return counters[metric];
};

/**
 * Applies one action to a record. A badge or title not yet recorded is recorded on this study day
 * once it is met; `exact` is false when it was already met before this action (before recording
 * began, on the first evaluation). Records are never removed or changed.
 */
export const evaluateAchievements = (input: {
  readonly stored: AchievementsStateV1;
  /** The record is new or rebuilt, so every field is written. */
  readonly rebuilt: boolean;
  readonly signals: AchievementSignals;
  readonly before: AchievementTotals;
  readonly after: AchievementTotals;
}): AchievementEvaluation => {
  const { stored, signals } = input;
  const counters = advanceCounters(stored.counters, signals);
  const recordOn = (metBefore: boolean): AchievementRecord => ({ on: signals.studyDay, exact: !metBefore });
  const newBadges: Record<string, AchievementRecord> = {};
  for (const badge of ACHIEVEMENT_BADGES) {
    if (Object.hasOwn(stored.badges, badge.id) || metricValue(badge.metric, counters, input.after) < badge.target) continue;
    newBadges[badge.id] = recordOn(metricValue(badge.metric, stored.counters, input.before) >= badge.target);
  }
  const newTitles: Record<string, AchievementRecord> = {};
  for (const title of ACHIEVEMENT_TITLES) {
    if (Object.hasOwn(stored.titles, title.id) || levelForVerifiedXp(input.after.verifiedXp) < title.level) continue;
    newTitles[title.id] = recordOn(levelForVerifiedXp(input.before.verifiedXp) >= title.level);
  }
  const state: AchievementsStateV1 = {
    ...stored,
    catalogVersion: Math.max(stored.catalogVersion, ACHIEVEMENT_CATALOG_VERSION),
    counters,
    badges: { ...stored.badges, ...newBadges },
    titles: { ...stored.titles, ...newTitles },
  };
  // A merge write replaces a map written empty, so an empty map is never written.
  const nonEmpty = (key: string, value: Record<string, unknown>) => (Object.keys(value).length > 0 ? { [key]: value } : {});
  if (input.rebuilt) {
    return {
      state,
      patch: {
        catalogVersion: state.catalogVersion,
        recordingStartedOn: state.recordingStartedOn,
        counters: { ...state.counters },
        ...nonEmpty('badges', state.badges),
        ...nonEmpty('titles', state.titles),
      },
    };
  }
  const changedCounters = Object.fromEntries(Object.entries(counters)
    .filter(([key, value]) => stored.counters[key as keyof AchievementCounters] !== value));
  const patch = {
    ...(state.catalogVersion !== stored.catalogVersion ? { catalogVersion: state.catalogVersion } : {}),
    ...nonEmpty('counters', changedCounters),
    ...nonEmpty('badges', newBadges),
    ...nonEmpty('titles', newTitles),
  };
  return { state, ...(Object.keys(patch).length > 0 ? { patch } : {}) };
};

/**
 * Reads the evidence for a first evaluation. XP history is read in the transaction when the account
 * already has verified activity. The two card counts run outside it, like the card-create usage
 * count, so they hold no locks; a concurrent verified action also writes the stats document, so
 * the transaction retries and counts again. Undefined means the counts are unavailable: the caller
 * skips the record this time and the next action tries again.
 */
export async function loadAchievementBaseline(
  database: Firestore,
  transaction: Transaction,
  ownerId: string,
  history: DocumentReference | undefined,
): Promise<AchievementBaseline | undefined> {
  const historySnapshot = history ? await transaction.get(history) : undefined;
  const cards = database.collection('users').doc(ownerId).collection('cards');
  try {
    const [reviewed, mastered] = await Promise.all([
      cards.where('reviews', '>', 0).count().get(),
      cards.where('difficulty', '==', 'easy').count().get(),
    ]);
    const reviewedCards = reviewed.data().count;
    const masteredWords = mastered.data().count;
    if (!isCount(reviewedCards) || !isCount(masteredWords)) throw new Error('invalid count');
    return { verifiedByDay: historySnapshot?.data()?.verifiedByDayV1, reviewedCards, masteredWords };
  } catch {
    console.warn('Achievement baseline counts are unavailable; recording starts on a later action.');
    return undefined;
  }
}
