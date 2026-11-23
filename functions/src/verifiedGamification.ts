import type { DocumentData, DocumentReference, Firestore, Transaction } from 'firebase-admin/firestore';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { createHash } from 'node:crypto';
import { parseAchievementSalvage, parseAchievements } from './achievement-rules.js';
import { backfilledAchievements, evaluateAchievements, isLateHour, loadAchievementBaseline } from './achievements.js';
import { InputValidationError } from './inputValidation.js';
import { firstActionStudyTime, nextStudyTime, parseStudyTime } from './study-time-rules.js';
import { firstActionWordWeeks, isCourseLanguage, nextWordWeeks, parseWordWeeks } from './word-week-rules.js';
import {
  STREAK_MILESTONE_XP, STREAK_REWARD_RUN, advanceStreak, initialStreakState, isStreakChangeWorthShowing, parseStreakState,
  type StreakChange,
} from './streak-rules.js';
import { shiftStudyDay, weekStartOf } from './study-day-rules.js';
import { CREATE_CARD_XP, REVIEW_CARD_XP } from './xp-rules.js';

const VERIFIED_SCHEMA_VERSION = 1;
const STREAK_REWARD_RECEIPT = 'streak-30-v1';
const LEVEL_REWARD_RECEIPT = 'level-13-v1';
const CRIMSON_WING_FRAME = 'crimson-wing';
const MAX_REVIEW_ACTIVITY_DAYS = 182;
const MAX_REVIEW_ACTIVITY_LANGUAGES = 16;
const MAX_REVIEW_ACTIVITY_COUNTER = Number.MAX_SAFE_INTEGER;
const DAILY_GOALS_FIELD = 'dailyGoalsV1';
const DAILY_GOALS_DAYS = 8;
const STREAK_FIELD = 'streakV1';
const ACHIEVEMENTS_FIELD = 'achievementsV1';
const STUDY_TIME_FIELD = 'studyTimeV1';
const WORD_WEEKS_FIELD = 'wordWeeksV1';
const WEB_WANDERER_BADGE = 'web-wanderer';

type ActionKind = 'review' | 'create' | 'quiz' | 'spelling' | 'match';
type RewardEvent = 'streak' | 'levelup';

export type VerifiedGamificationAction = {
  kind: ActionKind;
  receivedAt: Date;
  timeZone?: string;
  targetLanguage?: string;
  rating?: 'again' | 'hard' | 'good' | 'easy';
  resultXp?: number;
  cardId?: string;
  /** Facts about the reviewed card that only the review path holds. */
  reviewedCard?: {
    /** The card had never been reviewed. */
    firstReview: boolean;
    /** Rated Easy for the first time: not Easy now and no Easy in its history. */
    firstEasy: boolean;
    /** The card had no review evidence at all, so this review starts it. */
    started: boolean;
    /** This review made the card mastered. */
    mastered: boolean;
    /** Server-bounded times of every review in the card's history, this one included. */
    reviewTimesMs: number[];
  };
  /** Correct answers of a verified spelling session. */
  correctAnswers?: number;
  /** Server time the completed practice session started. */
  practiceStartedAt?: Date;
  /** Cards in the completed practice session. */
  practiceCards?: number;
};

export type VerifiedGamificationOutcome = {
  xp: number;
  level: number;
  streak: number;
  studyDay: string;
  events: RewardEvent[];
  rewardTimeZone: string;
  xpAwarded?: number;
  reviewActivity?: VerifiedReviewActivity;
  streakChange?: StreakChange;
  /** Study time credited to this review or practice completion, in milliseconds. */
  studyTimeMs?: number;
};

export type PreparedVerifiedGamification = {
  outcome: VerifiedGamificationOutcome;
  statsRef: DocumentReference;
  historyRef?: DocumentReference;
  rewardsRef?: DocumentReference;
  statsPatch: DocumentData;
  historyPatch?: DocumentData;
  hasXpAward: boolean;
  reviewXpAwardRef?: DocumentReference;
  reviewXpAwardPatch?: DocumentData;
  rewardsPatch?: DocumentData;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const isReceiptTime = (value: unknown): boolean => value instanceof Date || value instanceof Timestamp;

const ownerReferences = (database: Firestore, ownerId: string) => {
  if (!ownerId || ownerId.includes('/')) throw new InputValidationError('Gamification owner is invalid.');
  const profile = database.collection('users').doc(ownerId).collection('profile');
  return {
    stats: profile.doc('stats'),
    history: profile.doc('xp_history'),
    rewards: profile.doc('rewards'),
  };
};

const counter = (value: unknown): number =>
  Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : 0;

const dayInTimeZone = (date: Date, timeZone: string): string => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const part = (type: string) => parts.find(item => item.type === type)?.value;
  const year = part('year');
  const month = part('month');
  const day = part('day');
  if (!year || !month || !day) throw new InputValidationError('Reward time zone is invalid.');
  return `${year}-${month}-${day}`;
};

const canonicalTimeZone = (value: unknown): string | null => {
  if (typeof value !== 'string' || !value) return null;
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: value }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
};

type ReviewActivityCounters = Record<'reviewed' | 'again' | 'hard' | 'good' | 'easy', number>;
type ReviewActivity = {
  coverageStartedOnByLanguage: Record<string, string>;
  daysByLanguage: Record<string, Record<string, ReviewActivityCounters>>;
};

export type VerifiedReviewActivity = {
  targetLanguage: string;
  coverageStartedOn: string;
  days: Record<string, ReviewActivityCounters>;
};

const isLanguage = (value: unknown): value is string => typeof value === 'string'
  && value.length <= 16
  && /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/.test(value);

const isLocalDay = (value: unknown): value is string => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
};

export const reviewXpAwardId = (cardId: string, studyDay: string): string => {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(cardId) || !isLocalDay(studyDay)) {
    throw new InputValidationError('Verified review award identity is invalid.');
  }
  return createHash('sha256').update(`${cardId}\u0000${studyDay}`).digest('hex');
};

const activityWindowStart = (day: string): string => {
  const [year, month, date] = day.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, date - (MAX_REVIEW_ACTIVITY_DAYS - 1))).toISOString().slice(0, 10);
};

const reviewActivity = (value: unknown): ReviewActivity | undefined => {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new InputValidationError('Stored review activity is invalid.');
  const { coverageStartedOnByLanguage, daysByLanguage: storedDaysByLanguage } = value;
  if (Object.keys(value).length !== 2 || !isRecord(coverageStartedOnByLanguage) || !isRecord(storedDaysByLanguage)) {
    throw new InputValidationError('Stored review activity is invalid.');
  }
  const languages = Object.keys(storedDaysByLanguage);
  if (languages.length > MAX_REVIEW_ACTIVITY_LANGUAGES
    || languages.length !== Object.keys(coverageStartedOnByLanguage).length
    || languages.some(language => !isLanguage(language) || !isLocalDay(coverageStartedOnByLanguage[language]))) {
    throw new InputValidationError('Stored review activity is invalid.');
  }
  const daysByLanguage: ReviewActivity['daysByLanguage'] = {};
  for (const language of languages) {
    const days = storedDaysByLanguage[language];
    if (!isRecord(days) || Object.keys(days).length > MAX_REVIEW_ACTIVITY_DAYS) {
      throw new InputValidationError('Stored review activity is invalid.');
    }
    const parsedDays: Record<string, ReviewActivityCounters> = {};
    for (const [day, counters] of Object.entries(days)) {
      if (!isLocalDay(day) || !isRecord(counters) || Object.keys(counters).length !== 5) {
        throw new InputValidationError('Stored review activity is invalid.');
      }
      const parsed = Object.fromEntries(['reviewed', 'again', 'hard', 'good', 'easy'].map(key => [key, counters[key]])) as ReviewActivityCounters;
      if (Object.values(parsed).some(count => !Number.isSafeInteger(count) || count < 0 || count > MAX_REVIEW_ACTIVITY_COUNTER)
        || parsed.reviewed !== parsed.again + parsed.hard + parsed.good + parsed.easy) {
        throw new InputValidationError('Stored review activity is invalid.');
      }
      parsedDays[day] = parsed;
    }
    daysByLanguage[language] = parsedDays;
  }
  return { coverageStartedOnByLanguage: coverageStartedOnByLanguage as Record<string, string>, daysByLanguage };
};

const nextReviewActivity = (stored: unknown, language: unknown, day: string, rating: string): ReviewActivity => {
  if (!isLanguage(language) || !['again', 'hard', 'good', 'easy'].includes(rating)) {
    throw new InputValidationError('Review activity target language is invalid.');
  }
  const activity = reviewActivity(stored);
  const coverageStartedOnByLanguage = { ...(activity?.coverageStartedOnByLanguage ?? {}) };
  const allDays: ReviewActivity['daysByLanguage'] = { ...(activity?.daysByLanguage ?? {}) };
  if (!allDays[language] && Object.keys(allDays).length >= MAX_REVIEW_ACTIVITY_LANGUAGES) {
    throw new InputValidationError('Review activity language limit reached.');
  }
  const counters = allDays[language]?.[day] ?? { reviewed: 0, again: 0, hard: 0, good: 0, easy: 0 };
  if (counters.reviewed >= MAX_REVIEW_ACTIVITY_COUNTER || counters[rating as keyof ReviewActivityCounters] >= MAX_REVIEW_ACTIVITY_COUNTER) {
    throw new InputValidationError('Review activity counter exceeds its limit.');
  }
  allDays[language] = { ...(allDays[language] ?? {}), [day]: { ...counters, reviewed: counters.reviewed + 1, [rating]: counters[rating as keyof ReviewActivityCounters] + 1 } };
  for (const [activityLanguage, days] of Object.entries(allDays)) {
    const latestDay = Object.keys(days).reduce((latest, localDay) => localDay > latest ? localDay : latest, day);
    const windowStart = activityWindowStart(latestDay);
    allDays[activityLanguage] = Object.fromEntries(Object.entries(days)
      .filter(([localDay]) => localDay >= windowStart));
  }
  coverageStartedOnByLanguage[language] ??= day;
  return { coverageStartedOnByLanguage, daysByLanguage: allDays };
};

const reviewActivityOutcome = (activity: ReviewActivity | undefined, language: unknown): VerifiedReviewActivity | undefined => {
  if (!activity || !isLanguage(language)) return undefined;
  const coverageStartedOn = activity.coverageStartedOnByLanguage[language];
  const days = activity.daysByLanguage[language];
  return coverageStartedOn && days ? { targetLanguage: language, coverageStartedOn, days } : undefined;
};

const dayOffset = (day: string, offset: number): string => {
  const [year, month, date] = day.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, date + offset)).toISOString().slice(0, 10);
};

type DailyGoalCounters = { studiedCards: number; matchWins: number };
type DailyGoals = { coverageStartedOn: string; days: Record<string, DailyGoalCounters> };

const isPlainMap = (value: unknown): value is Record<string, unknown> => isRecord(value)
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);

const isCount = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;

// Study days with at least one verified review in any course language. Read tolerantly: it only
// seeds the best streak once, so a malformed map contributes nothing instead of failing.
const reviewedDaysOf = (value: unknown): string[] => {
  if (!isPlainMap(value) || !isPlainMap(value.daysByLanguage)) return [];
  return Object.values(value.daysByLanguage).flatMap(days => (isPlainMap(days)
    ? Object.entries(days).filter(([day, counters]) => isLocalDay(day) && isPlainMap(counters)
      && isCount(counters.reviewed) && counters.reviewed > 0).map(([day]) => day)
    : []));
};

// Daily goal progress per study day: cards that earned review XP and completed Word Matches.
// The map is display-only and written only here, so a malformed stored value starts over
// (coverage restarts today) instead of failing the learner's action.
const storedDailyGoals = (value: unknown): DailyGoals | undefined => {
  if (!isPlainMap(value) || Object.keys(value).length !== 2
    || !isLocalDay(value.coverageStartedOn) || !isPlainMap(value.days)) return undefined;
  const days: Record<string, DailyGoalCounters> = {};
  for (const [day, counters] of Object.entries(value.days)) {
    if (!isLocalDay(day) || !isPlainMap(counters) || Object.keys(counters).length !== 2
      || !isCount(counters.studiedCards) || !isCount(counters.matchWins)) return undefined;
    days[day] = { studiedCards: counters.studiedCards, matchWins: counters.matchWins };
  }
  return { coverageStartedOn: value.coverageStartedOn, days };
};

// Coverage starts on the day of the account's first verified action, when every action of the day
// reaches this map. Otherwise XP may already have been earned today without being counted, so the
// first fully counted day is the next one.
const nextDailyGoals = (
  stored: unknown,
  studyDay: string,
  studiedCards: number,
  matchWins: number,
  fromFirstAction: boolean,
): DailyGoals => {
  const previous = storedDailyGoals(stored);
  const days = { ...(previous?.days ?? {}) };
  const today = days[studyDay] ?? { studiedCards: 0, matchWins: 0 };
  days[studyDay] = {
    studiedCards: Math.min(today.studiedCards + studiedCards, Number.MAX_SAFE_INTEGER),
    matchWins: Math.min(today.matchWins + matchWins, Number.MAX_SAFE_INTEGER),
  };
  const latestDay = Object.keys(days).reduce((latest, day) => day > latest ? day : latest, studyDay);
  const windowStart = dayOffset(latestDay, 1 - DAILY_GOALS_DAYS);
  return {
    coverageStartedOn: previous?.coverageStartedOn ?? (fromFirstAction ? studyDay : dayOffset(studyDay, 1)),
    days: Object.fromEntries(Object.entries(days).filter(([day]) => day >= windowStart)),
  };
};

// set(..., { merge: true }) merges nested maps key by key, so a stored key that the new value
// no longer has would survive the write. Delete each such key; a stored non-map is overwritten.
const replacingMergePatch = (stored: unknown, next: Record<string, unknown>): DocumentData => {
  const storedMap = isPlainMap(stored) ? stored : {};
  const patch: DocumentData = {};
  for (const key of Object.keys(storedMap)) {
    if (!Object.hasOwn(next, key)) patch[key] = FieldValue.delete();
  }
  for (const [key, value] of Object.entries(next)) {
    patch[key] = isPlainMap(value) ? replacingMergePatch(storedMap[key], value) : value;
  }
  return patch;
};

const levelForXp = (xp: number) => Math.floor(Math.sqrt(xp / 100)) + 1;

// Reviews whose time falls in the Monday week of `studyDay` in the account's time zone.
const reviewsInWeekOf = (timesMs: unknown, studyDay: string, timeZone: string): number => {
  if (!Array.isArray(timesMs)) return 0;
  const weekStart = weekStartOf(studyDay);
  const weekEnd = shiftStudyDay(weekStart, 6);
  return timesMs.filter(time => typeof time === 'number' && Number.isFinite(time)).filter(time => {
    const day = dayInTimeZone(new Date(time), timeZone);
    return day >= weekStart && day <= weekEnd;
  }).length;
};

const xpFor = (action: VerifiedGamificationAction): number => {
  if (action.kind === 'review') return REVIEW_CARD_XP;
  if (action.kind === 'create') return CREATE_CARD_XP;
  if (!Number.isSafeInteger(action.resultXp) || action.resultXp! < 0) {
    throw new InputValidationError('Verified result XP is invalid.');
  }
  return action.resultXp as number;
};

export async function prepareVerifiedGamification(
  database: Firestore,
  transaction: Transaction,
  ownerId: string,
  action: VerifiedGamificationAction,
): Promise<PreparedVerifiedGamification> {
  if (!(action.receivedAt instanceof Date) || Number.isNaN(action.receivedAt.getTime())) {
    throw new InputValidationError('Verified action time is invalid.');
  }
  const refs = ownerReferences(database, ownerId);
  const statsSnapshot = await transaction.get(refs.stats);
  const statsData = statsSnapshot.data();
  const stats: Record<string, unknown> = statsSnapshot.exists && isRecord(statsData) ? statsData : {};
  const lastVerifiedReviewAt = stats.lastVerifiedReviewAt;
  if (lastVerifiedReviewAt !== undefined && lastVerifiedReviewAt !== null && !(lastVerifiedReviewAt instanceof Timestamp)) {
    throw new InputValidationError('Stored verified review time is invalid.');
  }
  const storedTimeZone = canonicalTimeZone(stats.rewardTimeZone);
  if (stats.rewardTimeZone !== undefined && !storedTimeZone) {
    throw new InputValidationError('Stored reward time zone is invalid.');
  }
  const actionTimeZone = canonicalTimeZone(action.timeZone);
  if (storedTimeZone === null && !actionTimeZone) {
    throw new InputValidationError('Reward time zone is invalid.');
  }
  const timeZone = storedTimeZone ?? actionTimeZone as string;
  const studyDay = dayInTimeZone(action.receivedAt, timeZone);
  if (action.kind === 'review' && (typeof action.cardId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(action.cardId))) {
    throw new InputValidationError('Verified review card is invalid.');
  }
  const awardId = action.kind === 'review' ? reviewXpAwardId(action.cardId!, studyDay) : undefined;
  const reviewXpAwardRef = awardId === undefined ? undefined
    : database.collection('users').doc(ownerId).collection('review_xp_awards').doc(awardId);
  const awardSnapshot = reviewXpAwardRef === undefined ? undefined : await transaction.get(reviewXpAwardRef);
  if (awardSnapshot?.exists) {
    const award = awardSnapshot.data();
    if (!isRecord(award) || award.schemaVersion !== VERIFIED_SCHEMA_VERSION || award.ownerId !== ownerId
      || award.cardId !== action.cardId || award.studyDay !== studyDay || award.xpAwarded !== REVIEW_CARD_XP
      || !isReceiptTime(award.expiresAt)) {
      throw new InputValidationError('Stored review XP award is invalid.');
    }
  }
  const xpAwarded = action.kind === 'review' ? (awardSnapshot?.exists ? 0 : xpFor(action)) : xpFor(action);
  const hasXpAward = xpAwarded > 0;
  const activity = action.kind === 'review' && storedTimeZone
    ? nextReviewActivity(stats.reviewActivityV1, action.targetLanguage, studyDay, action.rating ?? '')
    : undefined;
  const xp = counter(stats.verifiedXp);
  const oldLevel = levelForXp(xp);
  const crossesRewardLevel = (gain: number) => gain > 0 && oldLevel < 13 && levelForXp(xp + gain) >= 13;
  const lastDay = typeof stats.lastVerifiedStudyDay === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(stats.lastVerifiedStudyDay)
    ? stats.lastVerifiedStudyDay
    : null;
  const streak = counter(stats.verifiedStreak);
  // The rewards document is read at most once: to fold the legacy freeze into the streak record on
  // an account's first action after streak records began, or when a reward threshold is crossed.
  const loaded: { rewards?: Record<string, unknown> } = {};
  const readRewards = async (): Promise<Record<string, unknown>> => {
    if (!loaded.rewards) {
      const rewardsSnapshot = await transaction.get(refs.rewards);
      const rewardsData = rewardsSnapshot.data();
      loaded.rewards = rewardsSnapshot.exists && isRecord(rewardsData) ? rewardsData : {};
    }
    return loaded.rewards;
  };
  const rewardsPatch: DocumentData = {};
  let streakState = parseStreakState(stats[STREAK_FIELD]);
  if (!streakState) {
    // The record is display-only, so an unusable stored value starts over instead of failing the action.
    if (stats[STREAK_FIELD] !== undefined) console.warn('Stored streak record was unusable and starts over.');
    const legacyRewards = stats[STREAK_FIELD] === undefined && statsSnapshot.exists ? await readRewards() : {};
    streakState = initialStreakState({
      run: streak,
      lastStudyDay: lastDay,
      today: studyDay,
      reviewedDays: reviewedDaysOf(stats.reviewActivityV1),
      legacyFreezes: counter(legacyRewards.streakFreezes),
      rewardReceiptHeld: isRecord(legacyRewards.receipts) && legacyRewards.receipts[STREAK_REWARD_RECEIPT] === true,
    });
    if (Object.hasOwn(legacyRewards, 'streakFreezes')) rewardsPatch.streakFreezes = FieldValue.delete();
  }
  // Achievements are recorded from the first evaluation on. That one evaluation reads a baseline;
  // an unusable stored record is rebuilt the same way, keeping every valid badge and title record
  // and every counter whose own value is valid (see backfilledAchievements).
  let achievementsBase = parseAchievements(stats[ACHIEVEMENTS_FIELD]);
  let achievementsRebuilt = false;
  let webWandererHeld = false;
  if (!achievementsBase) {
    if (stats[ACHIEVEMENTS_FIELD] !== undefined) console.warn('Stored achievements record was unusable and is rebuilt.');
    const baseline = await loadAchievementBaseline(database, transaction, ownerId, statsSnapshot.exists ? refs.history : undefined);
    if (baseline) {
      const heldRewards = statsSnapshot.exists ? await readRewards() : {};
      webWandererHeld = (isRecord(heldRewards.receipts) && heldRewards.receipts[STREAK_REWARD_RECEIPT] === true)
        || (Array.isArray(heldRewards.unlockedBadgeIds) && heldRewards.unlockedBadgeIds.includes(WEB_WANDERER_BADGE));
      const storedVersion = isRecord(stats[ACHIEVEMENTS_FIELD]) ? counter(stats[ACHIEVEMENTS_FIELD].catalogVersion) : 0;
      achievementsBase = backfilledAchievements(studyDay, baseline, parseAchievementSalvage(stats[ACHIEVEMENTS_FIELD]), storedVersion);
      achievementsRebuilt = true;
    }
  }
  const isReview = action.kind === 'review';
  const streakInput = {
    state: streakState, run: streak, lastStudyDay: lastDay, today: studyDay,
    review: isReview, earnedXp: isReview && hasXpAward, grantsRewardFreeze: false,
  };
  let streakAdvance = advanceStreak(streakInput);
  const streakThreshold = isReview && streakAdvance.previousRun < STREAK_REWARD_RUN && streakAdvance.run >= STREAK_REWARD_RUN;
  const rewards = streakThreshold || crossesRewardLevel(xpAwarded) ? await readRewards() : loaded.rewards ?? {};
  const receipts = isRecord(rewards.receipts) ? rewards.receipts : {};
  const grantsStreakReward = streakThreshold && receipts[STREAK_REWARD_RECEIPT] !== true;
  if (grantsStreakReward) streakAdvance = advanceStreak({ ...streakInput, grantsRewardFreeze: true });
  // Milestone XP is granted with the 30-day receipt, so it can never be granted twice.
  const milestoneXp = grantsStreakReward && streakAdvance.change.milestone === STREAK_REWARD_RUN
    ? STREAK_MILESTONE_XP[STREAK_REWARD_RUN] ?? 0
    : 0;
  const xpGained = xpAwarded + milestoneXp;
  const nextXp = xp + xpGained;
  if (!Number.isSafeInteger(nextXp)) throw new InputValidationError('Verified XP exceeds its limit.');
  const level = levelForXp(nextXp);
  const nextStreak = streakAdvance.run;
  const levelThreshold = crossesRewardLevel(xpGained);
  const events: RewardEvent[] = [];
  const rewardReceiptsPatch: DocumentData = {};
  if (grantsStreakReward) {
    events.push('streak');
    rewardReceiptsPatch[STREAK_REWARD_RECEIPT] = true;
    rewardsPatch.unlockedBadgeIds = Array.from(new Set([...(Array.isArray(rewards.unlockedBadgeIds) ? rewards.unlockedBadgeIds : []), WEB_WANDERER_BADGE]));
  }
  if (levelThreshold && receipts[LEVEL_REWARD_RECEIPT] !== true) {
    events.push('levelup');
    rewardReceiptsPatch[LEVEL_REWARD_RECEIPT] = true;
    rewardsPatch.hintTokens = Math.min(counter(rewards.hintTokens) + 1, 3);
    rewardsPatch.ownedFrameIds = Array.from(new Set([...(Array.isArray(rewards.ownedFrameIds) ? rewards.ownedFrameIds : []), CRIMSON_WING_FRAME]));
    rewardsPatch.ownedTitleIds = Array.from(new Set([...(Array.isArray(rewards.ownedTitleIds) ? rewards.ownedTitleIds : []), 'word-collector']));
  }
  const grantsReceipt = Object.keys(rewardReceiptsPatch).length > 0;
  const heldStreak = webWandererHeld ? STREAK_REWARD_RUN : 0;
  const achievements = achievementsBase ? evaluateAchievements({
    stored: achievementsBase,
    rebuilt: achievementsRebuilt,
    signals: {
      studyDay,
      xpGained,
      firstReview: isReview && action.reviewedCard?.firstReview === true,
      firstEasy: isReview && action.reviewedCard?.firstEasy === true,
      lateReview: isReview && xpAwarded > 0 && isLateHour(action.receivedAt, timeZone),
      correctAnswers: action.kind === 'spelling' && isCount(action.correctAnswers) ? action.correctAnswers : 0,
    },
    before: { verifiedXp: xp, streak: Math.max(streak, streakState.best, heldStreak) },
    after: { verifiedXp: nextXp, streak: Math.max(nextStreak, streakAdvance.state.best, heldStreak) },
  }) : undefined;
  // Coverage of the study time and weekly word records began with the account's first verified action.
  // That is only known on the first action itself: it raises verified XP, so a later action cannot tell.
  // An action that does not write a record (a create, or a practice completion for the weekly words)
  // therefore starts it empty when it is the first, inside the same stats write.
  const fromFirstAction = !statsSnapshot.exists || (xp === 0 && stats.lastVerifiedStudyDay == null);
  const dailyGoals = nextDailyGoals(
    stats[DAILY_GOALS_FIELD],
    studyDay,
    action.kind === 'review' && hasXpAward ? 1 : 0,
    action.kind === 'match' ? 1 : 0,
    fromFirstAction,
  );
  // Study time is credited to reviews and practice completions; creating a card is not counted.
  const storedStudyTime = parseStudyTime(stats[STUDY_TIME_FIELD]);
  if (!storedStudyTime && stats[STUDY_TIME_FIELD] !== undefined) console.warn('Stored study time was unusable and starts over.');
  const studyTime = action.kind === 'create' ? undefined : nextStudyTime({
    stored: storedStudyTime,
    seed: {
      lastActionAtMs: lastVerifiedReviewAt instanceof Timestamp ? lastVerifiedReviewAt.toMillis() : null,
      fromFirstAction,
    },
    action: {
      atMs: action.receivedAt.getTime(),
      studyDay,
      ...(isReview ? {} : {
        practice: {
          startedAtMs: action.practiceStartedAt instanceof Date && Number.isFinite(action.practiceStartedAt.getTime())
            ? action.practiceStartedAt.getTime() : null,
          cards: isCount(action.practiceCards) ? action.practiceCards : 0,
        },
      }),
    },
  });
  const studyTimeState = studyTime?.state
    ?? (fromFirstAction && !storedStudyTime ? firstActionStudyTime(studyDay) : undefined);
  // Weekly words count reviews in a course language, from facts only the review path holds.
  const storedWordWeeks = parseWordWeeks(stats[WORD_WEEKS_FIELD]);
  if (!storedWordWeeks && stats[WORD_WEEKS_FIELD] !== undefined) console.warn('Stored weekly words were unusable and start over.');
  const reviewedCard = isReview ? action.reviewedCard : undefined;
  const wordWeeks = reviewedCard && isCourseLanguage(action.targetLanguage) ? nextWordWeeks({
    stored: storedWordWeeks,
    fromFirstAction,
    review: {
      studyDay,
      language: action.targetLanguage,
      cardId: action.cardId!,
      started: reviewedCard.started === true,
      mastered: reviewedCard.mastered === true,
      reviewsThisWeek: reviewsInWeekOf(reviewedCard.reviewTimesMs, studyDay, timeZone),
    },
  }) : undefined;
  const wordWeeksState = wordWeeks
    ?? (fromFirstAction && !storedWordWeeks ? firstActionWordWeeks(studyDay) : undefined);
  const streakChange: StreakChange | undefined = isReview && isStreakChangeWorthShowing(streakAdvance.change)
    ? { ...streakAdvance.change, ...(milestoneXp > 0 ? { milestoneXp } : {}) }
    : undefined;
  const hasRewardsPatch = Object.keys(rewardsPatch).length > 0;
  const activityOutcome = reviewActivityOutcome(activity, action.targetLanguage);
  return {
    outcome: {
      xp: nextXp, level, streak: nextStreak, studyDay, events, rewardTimeZone: timeZone,
      ...(action.kind === 'review' ? { xpAwarded } : {}),
      ...(activityOutcome ? { reviewActivity: activityOutcome } : {}),
      ...(streakChange ? { streakChange } : {}),
      ...(studyTime ? { studyTimeMs: studyTime.creditMs } : {}),
    },
    statsRef: refs.stats,
    rewardsRef: hasRewardsPatch ? refs.rewards : undefined,
    statsPatch: {
      ...(statsSnapshot.exists ? {} : { streak: 0, xp: 0, lastActive: null }),
      verifiedSchemaVersion: VERIFIED_SCHEMA_VERSION,
      verifiedXp: nextXp,
      verifiedStreak: nextStreak,
      ...(action.kind === 'review' && studyDay > (lastDay ?? '')
        ? { lastVerifiedStudyDay: studyDay }
        : stats.lastVerifiedStudyDay === undefined ? { lastVerifiedStudyDay: null } : {}),
      ...(stats.rewardTimeZone === undefined ? { rewardTimeZone: timeZone } : {}),
      ...(action.kind === 'review' && (!(lastVerifiedReviewAt instanceof Timestamp)
        || action.receivedAt.getTime() > lastVerifiedReviewAt.toMillis())
        ? { lastVerifiedReviewAt: Timestamp.fromDate(action.receivedAt) } : {}),
      ...(activity ? { reviewActivityV1: activity } : {}),
      [DAILY_GOALS_FIELD]: replacingMergePatch(stats[DAILY_GOALS_FIELD], dailyGoals),
      [STREAK_FIELD]: replacingMergePatch(stats[STREAK_FIELD], { ...streakAdvance.state }),
      ...(achievements?.patch ? { [ACHIEVEMENTS_FIELD]: achievements.patch } : {}),
      ...(studyTimeState ? { [STUDY_TIME_FIELD]: replacingMergePatch(stats[STUDY_TIME_FIELD], { ...studyTimeState }) } : {}),
      ...(wordWeeksState ? { [WORD_WEEKS_FIELD]: replacingMergePatch(stats[WORD_WEEKS_FIELD], { ...wordWeeksState }) } : {}),
    },
    ...(xpGained > 0 ? { historyRef: refs.history, historyPatch: { verifiedByDayV1: { [studyDay]: FieldValue.increment(xpGained) } } } : {}),
    hasXpAward,
    ...(hasXpAward && reviewXpAwardRef ? {
      reviewXpAwardRef,
      reviewXpAwardPatch: {
        schemaVersion: VERIFIED_SCHEMA_VERSION, ownerId, cardId: action.cardId, studyDay, xpAwarded,
        awardedAt: FieldValue.serverTimestamp(),
        expiresAt: new Date(action.receivedAt.getTime() + 7 * 24 * 60 * 60 * 1000),
      },
    } : {}),
    // A fold-only patch deletes the legacy freeze and nothing else; an empty receipts map is never
    // written, because a merge write would replace the stored receipts with it.
    rewardsPatch: hasRewardsPatch ? {
      ...(grantsReceipt ? { schemaVersion: VERIFIED_SCHEMA_VERSION, receipts: rewardReceiptsPatch } : {}),
      ...rewardsPatch,
    } : undefined,
  };
}

export function commitVerifiedGamification(
  transaction: Transaction,
  prepared: PreparedVerifiedGamification,
): VerifiedGamificationOutcome {
  transaction.set(prepared.statsRef, prepared.statsPatch, { merge: true });
  if (prepared.historyRef && prepared.historyPatch) transaction.set(prepared.historyRef, prepared.historyPatch, { merge: true });
  if (prepared.reviewXpAwardRef && prepared.reviewXpAwardPatch) transaction.create(prepared.reviewXpAwardRef, prepared.reviewXpAwardPatch);
  if (prepared.rewardsRef && prepared.rewardsPatch) transaction.set(prepared.rewardsRef, prepared.rewardsPatch, { merge: true });
  return prepared.outcome;
}

export async function equipOwnedFrame(
  database: Firestore,
  ownerId: string,
  frameId: string,
): Promise<{ equippedFrameId: string }> {
  if (frameId !== CRIMSON_WING_FRAME) throw new InputValidationError('Reward frame is invalid.');
  const { rewards } = ownerReferences(database, ownerId);
  return database.runTransaction(async transaction => {
    const snapshot = await transaction.get(rewards);
    const stored = snapshot.data();
    const data: Record<string, unknown> = snapshot.exists && isRecord(stored) ? stored : {};
    if (!Array.isArray(data.ownedFrameIds) || !data.ownedFrameIds.includes(frameId)) {
      throw new InputValidationError('Reward frame is not owned.');
    }
    transaction.set(rewards, { equippedFrameId: frameId }, { merge: true });
    return { equippedFrameId: frameId };
  });
}
