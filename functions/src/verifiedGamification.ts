import type { DocumentData, DocumentReference, Firestore, Transaction } from 'firebase-admin/firestore';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { createHash } from 'node:crypto';
import { InputValidationError } from './inputValidation.js';

const VERIFIED_SCHEMA_VERSION = 1;
const STREAK_REWARD_RECEIPT = 'streak-30-v1';
const LEVEL_REWARD_RECEIPT = 'level-13-v1';
const CRIMSON_WING_FRAME = 'crimson-wing';
const MAX_REVIEW_ACTIVITY_DAYS = 182;
const MAX_REVIEW_ACTIVITY_LANGUAGES = 16;
const MAX_REVIEW_ACTIVITY_COUNTER = Number.MAX_SAFE_INTEGER;

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

const previousDay = (day: string): string => {
  const [year, month, date] = day.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, date - 1)).toISOString().slice(0, 10);
};

const levelForXp = (xp: number) => Math.floor(Math.sqrt(xp / 100)) + 1;

const xpFor = (action: VerifiedGamificationAction): number => {
  if (action.kind === 'review') return 2;
  if (action.kind === 'create') return 10;
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
      || award.cardId !== action.cardId || award.studyDay !== studyDay || award.xpAwarded !== 2
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
  const nextXp = xp + xpAwarded;
  if (!Number.isSafeInteger(nextXp)) throw new InputValidationError('Verified XP exceeds its limit.');
  const oldLevel = levelForXp(xp);
  const level = levelForXp(nextXp);
  const lastDay = typeof stats.lastVerifiedStudyDay === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(stats.lastVerifiedStudyDay)
    ? stats.lastVerifiedStudyDay
    : null;
  const streak = counter(stats.verifiedStreak);
  const nextStreak = action.kind !== 'review' || studyDay <= (lastDay ?? '')
    ? streak
    : lastDay === previousDay(studyDay) ? streak + 1 : 1;
  const streakThreshold = streak < 30 && nextStreak >= 30;
  const levelThreshold = hasXpAward && oldLevel < 13 && level >= 13;
  let rewards: Record<string, unknown> = {};
  if (streakThreshold || levelThreshold) {
    const rewardsSnapshot = await transaction.get(refs.rewards);
    const rewardsData = rewardsSnapshot.data();
    rewards = rewardsSnapshot.exists && isRecord(rewardsData) ? rewardsData : {};
  }
  const receipts = isRecord(rewards.receipts) ? rewards.receipts : {};
  const events: RewardEvent[] = [];
  const rewardsPatch: DocumentData = {};
  const rewardReceiptsPatch: DocumentData = {};
  if (streakThreshold && receipts[STREAK_REWARD_RECEIPT] !== true) {
    events.push('streak');
    rewardReceiptsPatch[STREAK_REWARD_RECEIPT] = true;
    rewardsPatch.streakFreezes = Math.min(counter(rewards.streakFreezes) + 1, 1);
    rewardsPatch.unlockedBadgeIds = Array.from(new Set([...(Array.isArray(rewards.unlockedBadgeIds) ? rewards.unlockedBadgeIds : []), 'web-wanderer']));
  }
  if (levelThreshold && receipts[LEVEL_REWARD_RECEIPT] !== true) {
    events.push('levelup');
    rewardReceiptsPatch[LEVEL_REWARD_RECEIPT] = true;
    rewardsPatch.hintTokens = Math.min(counter(rewards.hintTokens) + 1, 3);
    rewardsPatch.ownedFrameIds = Array.from(new Set([...(Array.isArray(rewards.ownedFrameIds) ? rewards.ownedFrameIds : []), CRIMSON_WING_FRAME]));
    rewardsPatch.ownedTitleIds = Array.from(new Set([...(Array.isArray(rewards.ownedTitleIds) ? rewards.ownedTitleIds : []), 'word-collector']));
  }
  const hasRewardsPatch = Object.keys(rewardsPatch).length > 0;
  const activityOutcome = reviewActivityOutcome(activity, action.targetLanguage);
  return {
    outcome: {
      xp: nextXp, level, streak: nextStreak, studyDay, events, rewardTimeZone: timeZone,
      ...(action.kind === 'review' ? { xpAwarded } : {}),
      ...(activityOutcome ? { reviewActivity: activityOutcome } : {}),
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
    },
    ...(hasXpAward ? { historyRef: refs.history, historyPatch: { verifiedByDayV1: { [studyDay]: FieldValue.increment(xpAwarded) } } } : {}),
    hasXpAward,
    ...(hasXpAward && reviewXpAwardRef ? {
      reviewXpAwardRef,
      reviewXpAwardPatch: {
        schemaVersion: VERIFIED_SCHEMA_VERSION, ownerId, cardId: action.cardId, studyDay, xpAwarded,
        awardedAt: FieldValue.serverTimestamp(),
        expiresAt: new Date(action.receivedAt.getTime() + 7 * 24 * 60 * 60 * 1000),
      },
    } : {}),
    rewardsPatch: hasRewardsPatch ? {
      schemaVersion: VERIFIED_SCHEMA_VERSION,
      receipts: rewardReceiptsPatch,
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
