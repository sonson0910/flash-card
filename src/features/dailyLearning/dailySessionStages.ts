import { cardsForLanguagePair, createWordMatchRound } from '../practice/practiceModel';
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

export interface DailySessionLanguagePair {
  readonly targetLanguage: string;
  readonly translationLanguage: string;
}

export interface SessionMatchStage {
  readonly cards: readonly CardData[];
  readonly skipReason: MatchSkipReason | null;
}

export type MatchPair = { cardId: string; word: string; translation: string };

/** Server completion fingerprints array order, so every retry uses challenge order. */
export function canonicalMatchPairs(cards: readonly CardData[], submitted: readonly MatchPair[]): MatchPair[] | null {
  const ordered = cards.map(card => ({ cardId: card.id, word: card.word, translation: card.translation }));
  return submitted.length === ordered.length && ordered.every(pair => submitted.some(candidate => (
    candidate.cardId === pair.cardId && candidate.word === pair.word && candidate.translation === pair.translation
  ))) ? ordered : null;
}

/** Valid local answers are checkpointed before an offline completion can be retried. */
export function preparePendingMatchCompletion(
  cards: readonly CardData[],
  submitted: readonly MatchPair[],
  isOffline: boolean,
): { readonly pairs: MatchPair[]; readonly matchStatus: 'completing' | 'complete-error' } | null {
  const pairs = canonicalMatchPairs(cards, submitted);
  return pairs ? { pairs, matchStatus: isOffline ? 'complete-error' : 'completing' } : null;
}

export interface SessionStagePlan {
  readonly review: readonly DailyPlanItem[];
  readonly fresh: readonly DailyPlanItem[];
  readonly match: SessionMatchStage;
}

export const sessionStageItemCount = (stagePlan: SessionStagePlan, stage: SessionStageId): number => (
  stage === 'review' ? stagePlan.review.length
    : stage === 'new' ? stagePlan.fresh.length
      : stage === 'match' ? stagePlan.match.cards.length : 0
);

const matchStageFor = (cards: readonly CardData[]): SessionMatchStage => (
  cards.length >= MINIMUM_MATCH_PAIRS
    ? { cards, skipReason: null }
    : { cards: [], skipReason: 'insufficient-pairs' }
);

/** Builds the four-part plan from the existing bounded daily plan and pool; adds no new reads. */
export function buildSessionStagePlan(
  plan: DailyPlan,
  pool: readonly CardData[],
  random: () => number = Math.random,
  languagePair: DailySessionLanguagePair = { targetLanguage: 'en', translationLanguage: 'vi' },
): SessionStagePlan {
  const review = plan.items.filter(item => item.reason === 'due' || item.reason === 'weak');
  const fresh = plan.items.filter(item => item.reason === 'new');
  const matchCards = createWordMatchRound(
    cardsForLanguagePair(pool, languagePair.targetLanguage, languagePair.translationLanguage),
    MAXIMUM_MATCH_PAIRS,
    random,
  );
  return {
    review,
    fresh,
    match: matchStageFor(matchCards),
  };
}

/** Restores only saved Word Match cards that still belong to the active language pair. */
export function restoredSessionMatchStage(
  pool: readonly CardData[],
  matchCardIds: readonly string[],
  languagePair: DailySessionLanguagePair,
  preserveSavedIds = false,
): SessionMatchStage {
  const savedIds = new Set(matchCardIds);
  const matchingCards = new Map(cardsForLanguagePair(pool, languagePair.targetLanguage, languagePair.translationLanguage)
    .filter(card => savedIds.has(card.id)).map(card => [card.id, card]));
  const cards = preserveSavedIds
    ? matchCardIds.map(id => matchingCards.get(id) ?? {
      id, word: '', translation: '', language: languagePair.targetLanguage, translationLanguage: languagePair.translationLanguage,
    } as CardData)
    : [...matchingCards.values()];
  return matchStageFor(cards);
}

/** The first stage that still has outstanding work in this plan, or 'recap' when every part is empty. */
export function firstOutstandingStage(stagePlan: SessionStagePlan): SessionStageId {
  return SESSION_STAGE_ORDER.find(stage => sessionStageItemCount(stagePlan, stage) > 0) ?? 'recap';
}

/** The next stage after `stage` that still has outstanding work in this plan, or 'recap'. */
export function nextOutstandingStage(stagePlan: SessionStagePlan, stage: SessionStageId): SessionStageId {
  return SESSION_STAGE_ORDER.slice(SESSION_STAGE_ORDER.indexOf(stage) + 1)
    .find(candidate => sessionStageItemCount(stagePlan, candidate) > 0) ?? 'recap';
}

/** Whether advancing to recap bypassed an unavailable Word Match stage. */
export function skippedUnavailableMatchStage(
  stagePlan: SessionStagePlan,
  completedStage: SessionStageId,
  nextStage: SessionStageId,
): boolean {
  return completedStage !== 'match' && nextStage === 'recap' && stagePlan.match.skipReason !== null;
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
  /** Missing on a pointer saved by an older client; unknown awards are never invented. */
  readonly reviewXp?: number;
  readonly matchXp: number;
}

export const emptyDailySessionStats: DailySessionStats = { goodCount: 0, againCount: 0, weakCardIds: [], reviewXp: 0, matchXp: 0 };

export function applyRatingToStats(
  stats: DailySessionStats,
  cardId: string,
  rating: ReviewRatingValue,
  xpAwarded: number,
): DailySessionStats {
  const isPositive = rating === 'good' || rating === 'easy';
  const weakCardIds = isPositive
    ? stats.weakCardIds.filter(id => id !== cardId)
    : [...stats.weakCardIds.filter(id => id !== cardId), cardId];
  return {
    goodCount: stats.goodCount + (isPositive ? 1 : 0),
    againCount: stats.againCount + (isPositive ? 0 : 1),
    weakCardIds,
    reviewXp: (stats.reviewXp ?? 0) + xpAwarded,
    matchXp: stats.matchXp,
  };
}

export interface DailySessionPointer {
  readonly ownerId: string;
  /** Seam for phase 10; an empty string keeps today's single-course behaviour. */
  readonly targetLanguage: string;
  /** The native meaning language completes the course scope for Word Match. */
  readonly translationLanguage: string;
  readonly stage: SessionStageId;
  /** The completed stage while a bridge is visible, so reload preserves its explanation. */
  readonly bridgeCompletedStage?: SessionStageId;
  readonly reviewLogicalIds: readonly string[];
  readonly freshLogicalIds: readonly string[];
  readonly matchCardIds: readonly string[];
  readonly matchSkipReason: MatchSkipReason | null;
  /** Server operation metadata for replaying the frozen Word Match challenge. */
  readonly matchStartOpId?: string | null;
  readonly matchCompletionId?: string | null;
  readonly matchTimeZone?: string;
  /** A locally won round whose server completion must be replayed before recap. */
  readonly matchCompletionPending?: boolean;
  readonly stats: DailySessionStats;
  readonly startedAt: string;
}

const STORAGE_KEY_PREFIX = 'sonflash:daily-session:';
const storageKeyFor = (ownerId: string): string => `${STORAGE_KEY_PREFIX}${ownerId}`;

const readStoredJson = (key: string): unknown => {
  try {
    const raw = globalThis.sessionStorage?.getItem(key);
    return raw ? JSON.parse(raw) as unknown : null;
  } catch {
    return null;
  }
};

const writeStoredJson = (key: string, value?: unknown): void => {
  try {
    if (value === undefined) globalThis.sessionStorage?.removeItem(key);
    else globalThis.sessionStorage?.setItem(key, JSON.stringify(value));
  } catch {
    /* sessionStorage is optional. */
  }
};

const isStringArray = (value: unknown): value is string[] => Array.isArray(value) && value.every(entry => typeof entry === 'string');

const isDailySessionStats = (value: unknown): value is DailySessionStats => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.goodCount === 'number' && typeof candidate.againCount === 'number'
    && (candidate.reviewXp === undefined || Number.isSafeInteger(candidate.reviewXp) && Number(candidate.reviewXp) >= 0)
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
    && typeof candidate.translationLanguage === 'string'
    && isSessionStageId(candidate.stage)
    && (candidate.bridgeCompletedStage === undefined || isSessionStageId(candidate.bridgeCompletedStage))
    && isStringArray(candidate.reviewLogicalIds)
    && isStringArray(candidate.freshLogicalIds)
    && isStringArray(candidate.matchCardIds)
    && (candidate.matchSkipReason === null || candidate.matchSkipReason === 'insufficient-pairs')
    && (candidate.matchStartOpId === undefined || candidate.matchStartOpId === null || typeof candidate.matchStartOpId === 'string')
    && (candidate.matchCompletionId === undefined || candidate.matchCompletionId === null || typeof candidate.matchCompletionId === 'string')
    && (candidate.matchTimeZone === undefined || typeof candidate.matchTimeZone === 'string')
    && (candidate.matchCompletionPending === undefined || typeof candidate.matchCompletionPending === 'boolean')
    && isDailySessionStats(candidate.stats)
    && typeof candidate.startedAt === 'string';
};

/** Reads the session pointer for this owner; a shape mismatch or a different owner reads as absent. */
export function readDailySessionPointer(ownerId: string): DailySessionPointer | null {
  const parsed = readStoredJson(storageKeyFor(ownerId));
  return isDailySessionPointer(parsed) && parsed.ownerId === ownerId ? parsed : null;
}

/** Stores only the stage pointer: stage, card ids, skip reason and committed tallies. No card content, no write queue. */
export function writeDailySessionPointer(pointer: DailySessionPointer): void {
  writeStoredJson(storageKeyFor(pointer.ownerId), pointer);
}

export function clearDailySessionPointer(ownerId: string): void {
  writeStoredJson(storageKeyFor(ownerId));
}

const PENDING_PRIORITY_KEY_PREFIX = 'sonflash:pending-fresh-priority:';
export interface DailyLanguagePair {
  readonly targetLanguage: string;
  readonly translationLanguage: string;
}

const pendingPriorityKeyFor = (ownerId: string, pair: DailyLanguagePair): string =>
  `${PENDING_PRIORITY_KEY_PREFIX}${ownerId}:${encodeURIComponent(pair.targetLanguage)}:${encodeURIComponent(pair.translationLanguage)}`;

/**
 * Logical ids a learner marked "add to today" before any session pointer
 * existed (e.g. from WebWords, `webWordsSessionPriority.ts`). `buildDailyPlan`
 * sorts the 'new' bucket oldest-first, so without this queue a freshly added
 * word would wait behind every older unstudied card instead of surfacing
 * "once you start today's session" as promised. Scoped to the language pair
 * because logical card ids do not include the translation language.
 */
export function readPendingFreshPriority(ownerId: string, pair: DailyLanguagePair): readonly string[] {
  const parsed = readStoredJson(pendingPriorityKeyFor(ownerId, pair));
  return isStringArray(parsed) ? parsed : [];
}

export function writePendingFreshPriority(ownerId: string, pair: DailyLanguagePair, logicalIds: readonly string[]): void {
  writeStoredJson(pendingPriorityKeyFor(ownerId, pair), logicalIds.length > 0 ? logicalIds : undefined);
}

/** Keep queued words that the bounded session could not schedule yet. */
export function consumeScheduledFreshPriority(ownerId: string, pair: DailyLanguagePair, scheduledLogicalIds: readonly string[]): void {
  const scheduled = new Set(scheduledLogicalIds);
  if (scheduled.size === 0) return;
  const pending = readPendingFreshPriority(ownerId, pair);
  if (pending.length > 0) writePendingFreshPriority(ownerId, pair, pending.filter(logicalId => !scheduled.has(logicalId)));
}

export function clearPendingFreshPriority(ownerId: string, pair: DailyLanguagePair): void {
  writeStoredJson(pendingPriorityKeyFor(ownerId, pair));
}
