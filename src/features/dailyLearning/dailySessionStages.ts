import { createWordMatchRound } from '../practice/practiceModel';
import type { CardData, ReviewRatingValue } from '../../types/card';
import type { DailyPlan, DailyPlanItem } from './dailyPlan';

/**
 * The four parts of the sequenced daily session (TodaySession / SessionBridge / RecapScreen
 * boards): review the due+weak backlog, meet new words, a short Word Match round on the same
 * pool, then a shared recap. Each part is skipped (never backfilled with sample cards) when its
 * bucket is empty.
 */
export type SessionStageId = 'review' | 'new' | 'match' | 'recap';

export const SESSION_STAGE_ORDER: readonly SessionStageId[] = ['review', 'new', 'match', 'recap'];

export type MatchSkipReason = 'insufficient-pairs';

const MINIMUM_MATCH_PAIRS = 4;
const MAXIMUM_MATCH_PAIRS = 6;

export interface SessionMatchStage {
  readonly cards: readonly CardData[];
  readonly skipReason: MatchSkipReason | null;
}

export interface SessionStagePlan {
  readonly review: readonly DailyPlanItem[];
  readonly fresh: readonly DailyPlanItem[];
  readonly match: SessionMatchStage;
}

/** Builds the four-part plan from the existing bounded daily plan and pool; adds no new reads. */
export function buildSessionStagePlan(
  plan: DailyPlan,
  pool: readonly CardData[],
  random: () => number = Math.random,
): SessionStagePlan {
  const review = plan.items.filter(item => item.reason === 'due' || item.reason === 'weak');
  const fresh = plan.items.filter(item => item.reason === 'new');
  const matchCards = createWordMatchRound(pool, MAXIMUM_MATCH_PAIRS, random);
  const hasEnoughPairs = matchCards.length >= MINIMUM_MATCH_PAIRS;
  return {
    review,
    fresh,
    match: {
      cards: hasEnoughPairs ? matchCards : [],
      skipReason: hasEnoughPairs ? null : 'insufficient-pairs',
    },
  };
}

/** The first stage that still has outstanding work in this plan, or 'recap' when every part is empty. */
export function firstOutstandingStage(stagePlan: SessionStagePlan): SessionStageId {
  if (stagePlan.review.length > 0) return 'review';
  if (stagePlan.fresh.length > 0) return 'new';
  if (stagePlan.match.cards.length > 0) return 'match';
  return 'recap';
}

/** The next stage after `stage` that still has outstanding work in this plan, or 'recap'. */
export function nextOutstandingStage(stagePlan: SessionStagePlan, stage: SessionStageId): SessionStageId {
  const startIndex = SESSION_STAGE_ORDER.indexOf(stage) + 1;
  for (let index = startIndex; index < SESSION_STAGE_ORDER.length; index += 1) {
    const candidate = SESSION_STAGE_ORDER[index];
    if (candidate === 'review' && stagePlan.review.length > 0) return candidate;
    if (candidate === 'new' && stagePlan.fresh.length > 0) return candidate;
    if (candidate === 'match' && stagePlan.match.cards.length > 0) return candidate;
    if (candidate === 'recap') return candidate;
  }
  return 'recap';
}

export const logicalIdsOf = (items: readonly DailyPlanItem[]): readonly string[] => items.map(item => item.logicalId);

/**
 * Items from the original per-stage snapshot that are still present in a freshly rebuilt bucket.
 * A committed review advances `nextReviewDate` server-side, so a committed card drops out of the
 * fresh `due`/`weak`/`new` bucket on its own; nothing here re-adds or re-rates a committed card.
 */
export function outstandingItems(
  snapshotLogicalIds: readonly string[],
  freshBucket: readonly DailyPlanItem[],
): readonly DailyPlanItem[] {
  const snapshot = new Set(snapshotLogicalIds);
  return freshBucket.filter(item => snapshot.has(item.logicalId));
}

export interface DailySessionStats {
  readonly goodCount: number;
  readonly againCount: number;
  readonly weakCardIds: readonly string[];
  readonly matchXp: number;
}

export const emptyDailySessionStats: DailySessionStats = { goodCount: 0, againCount: 0, weakCardIds: [], matchXp: 0 };

export function applyRatingToStats(
  stats: DailySessionStats,
  cardId: string,
  rating: ReviewRatingValue,
): DailySessionStats {
  const isPositive = rating === 'good' || rating === 'easy';
  const weakCardIds = isPositive
    ? stats.weakCardIds.filter(id => id !== cardId)
    : [...stats.weakCardIds.filter(id => id !== cardId), cardId];
  return {
    goodCount: stats.goodCount + (isPositive ? 1 : 0),
    againCount: stats.againCount + (isPositive ? 0 : 1),
    weakCardIds,
    matchXp: stats.matchXp,
  };
}

export interface DailySessionPointer {
  readonly ownerId: string;
  /** Seam for phase 10; an empty string keeps today's single-course behaviour. */
  readonly targetLanguage: string;
  readonly stage: SessionStageId;
  readonly reviewLogicalIds: readonly string[];
  readonly freshLogicalIds: readonly string[];
  readonly matchCardIds: readonly string[];
  readonly matchSkipReason: MatchSkipReason | null;
  readonly stats: DailySessionStats;
  readonly startedAt: string;
}

const STORAGE_KEY_PREFIX = 'sonflash:daily-session:';
const storageKeyFor = (ownerId: string): string => `${STORAGE_KEY_PREFIX}${ownerId}`;

const isStringArray = (value: unknown): value is string[] => Array.isArray(value) && value.every(entry => typeof entry === 'string');

const isDailySessionStats = (value: unknown): value is DailySessionStats => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.goodCount === 'number' && typeof candidate.againCount === 'number'
    && typeof candidate.matchXp === 'number' && isStringArray(candidate.weakCardIds);
};

const isSessionStageId = (value: unknown): value is SessionStageId => (
  value === 'review' || value === 'new' || value === 'match' || value === 'recap'
);

const isDailySessionPointer = (value: unknown): value is DailySessionPointer => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.ownerId === 'string' && candidate.ownerId.length > 0
    && typeof candidate.targetLanguage === 'string'
    && isSessionStageId(candidate.stage)
    && isStringArray(candidate.reviewLogicalIds)
    && isStringArray(candidate.freshLogicalIds)
    && isStringArray(candidate.matchCardIds)
    && (candidate.matchSkipReason === null || candidate.matchSkipReason === 'insufficient-pairs')
    && isDailySessionStats(candidate.stats)
    && typeof candidate.startedAt === 'string';
};

/** Reads the session pointer for this owner; a shape mismatch or a different owner reads as absent. */
export function readDailySessionPointer(ownerId: string): DailySessionPointer | null {
  try {
    const raw = globalThis.sessionStorage?.getItem(storageKeyFor(ownerId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    return isDailySessionPointer(parsed) && parsed.ownerId === ownerId ? parsed : null;
  } catch {
    return null;
  }
}

/** Stores only the stage pointer: stage, card ids, skip reason and committed tallies. No card content, no write queue. */
export function writeDailySessionPointer(pointer: DailySessionPointer): void {
  try {
    globalThis.sessionStorage?.setItem(storageKeyFor(pointer.ownerId), JSON.stringify(pointer));
  } catch {
    /* sessionStorage is optional; losing the pointer only means a reload restarts at Today. */
  }
}

export function clearDailySessionPointer(ownerId: string): void {
  try {
    globalThis.sessionStorage?.removeItem(storageKeyFor(ownerId));
  } catch {
    /* sessionStorage is optional. */
  }
}

const PENDING_PRIORITY_KEY_PREFIX = 'sonflash:pending-fresh-priority:';
const pendingPriorityKeyFor = (ownerId: string): string => `${PENDING_PRIORITY_KEY_PREFIX}${ownerId}`;

/**
 * Logical ids a learner marked "add to today" before any session pointer
 * existed (e.g. from WebWords, `webWordsSessionPriority.ts`). `buildDailyPlan`
 * sorts the 'new' bucket oldest-first, so without this queue a freshly added
 * word would wait behind every older unstudied card instead of surfacing
 * "once you start today's session" as promised. Consumed once by whichever
 * code builds the first session pointer of the day.
 */
export function readPendingFreshPriority(ownerId: string): readonly string[] {
  try {
    const raw = globalThis.sessionStorage?.getItem(pendingPriorityKeyFor(ownerId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return isStringArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function writePendingFreshPriority(ownerId: string, logicalIds: readonly string[]): void {
  try {
    if (logicalIds.length === 0) globalThis.sessionStorage?.removeItem(pendingPriorityKeyFor(ownerId));
    else globalThis.sessionStorage?.setItem(pendingPriorityKeyFor(ownerId), JSON.stringify(logicalIds));
  } catch {
    /* sessionStorage is optional; losing the queue only means the word sorts by its own createdAt next time. */
  }
}

export function clearPendingFreshPriority(ownerId: string): void {
  try {
    globalThis.sessionStorage?.removeItem(pendingPriorityKeyFor(ownerId));
  } catch {
    /* sessionStorage is optional. */
  }
}
