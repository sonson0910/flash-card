import type { DocumentData, DocumentReference, Firestore, Transaction } from 'firebase-admin/firestore';
import { FieldValue } from 'firebase-admin/firestore';
import { InputValidationError } from './inputValidation.js';

const VERIFIED_SCHEMA_VERSION = 1;
const STREAK_REWARD_RECEIPT = 'streak-30-v1';
const LEVEL_REWARD_RECEIPT = 'level-13-v1';
const CRIMSON_WING_FRAME = 'crimson-wing';

type ActionKind = 'review' | 'create' | 'quiz' | 'spelling' | 'match';
type RewardEvent = 'streak' | 'levelup';

export type VerifiedGamificationAction = {
  kind: ActionKind;
  receivedAt: Date;
  timeZone?: string;
  resultXp?: number;
};

export type VerifiedGamificationOutcome = {
  xp: number;
  level: number;
  streak: number;
  studyDay: string;
  events: RewardEvent[];
};

export type PreparedVerifiedGamification = {
  outcome: VerifiedGamificationOutcome;
  statsRef: DocumentReference;
  historyRef: DocumentReference;
  rewardsRef?: DocumentReference;
  statsPatch: DocumentData;
  historyPatch: DocumentData;
  rewardsPatch?: DocumentData;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

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
  const xp = counter(stats.verifiedXp);
  const nextXp = xp + xpFor(action);
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
  const levelThreshold = oldLevel < 13 && level >= 13;
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
  return {
    outcome: { xp: nextXp, level, streak: nextStreak, studyDay, events },
    statsRef: refs.stats,
    historyRef: refs.history,
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
    },
    historyPatch: { verifiedByDayV1: { [studyDay]: FieldValue.increment(xpFor(action)) } },
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
  transaction.set(prepared.historyRef, prepared.historyPatch, { merge: true });
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
