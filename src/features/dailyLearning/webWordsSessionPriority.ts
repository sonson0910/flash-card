import type { CardData } from '../../types/card';
import { logicalIdentity } from './dailyPlan';
import {
  readDailySessionPointer,
  readPendingFreshPriority,
  writePendingFreshPriority,
  type DailyLanguagePair,
  type DailySessionPointer,
} from './dailySessionStages';

export type PromoteCardsOutcome =
  /** No pointer for this course exists yet — queued into pending-fresh-priority for the next session. */
  | 'no-active-session'
  /** The active session already finished the 'new' stage; the word still surfaces on its own next time `buildDailyPlan` runs (see the caller for the resulting gap). */
  | 'new-stage-already-passed'
  /** Some cards entered the active session; the rest remain queued for a later session. */
  | 'promoted-partial'
  /** The active new-word stage is full; cards were queued without entering it. */
  | 'deferred-capped'
  /** The active session lacks these cards in its loaded practice pool, so they were queued. */
  | 'deferred-unloaded'
  | 'promoted';

/** Matches the bounded daily-plan size without changing its loading policy. */
export const MAXIMUM_ACTIVE_SESSION_NEW_WORDS = 15;

export interface ActiveSessionNewStagePromotion {
  readonly ownerId: string;
  readonly languagePair: DailyLanguagePair;
  readonly logicalIds: readonly string[];
}

const promotionListeners = new Set<(promotion: ActiveSessionNewStagePromotion) => readonly string[] | null>();

/** Bridges a persisted WebWords promotion into the already-mounted daily session. */
export const subscribeToActiveSessionNewStagePromotions = (
  listener: (promotion: ActiveSessionNewStagePromotion) => readonly string[] | null,
): (() => void) => {
  promotionListeners.add(listener);
  return () => promotionListeners.delete(listener);
};

const isNewStagePassed = (pointer: DailySessionPointer): boolean => (
  pointer.stage === 'match' || pointer.stage === 'recap'
  || pointer.bridgeCompletedStage === 'new' || pointer.bridgeCompletedStage === 'match'
);

const dedupedNewLogicalIds = (cards: readonly CardData[], existing: ReadonlySet<string>): readonly string[] => (
  cards.map(logicalIdentity).filter((logicalId, index, all) => !existing.has(logicalId) && all.indexOf(logicalId) === index)
);

/**
 * Puts freshly added web-sourced cards at the front of the *already started*
 * session's 'new' stage, so they are the very next new words the learner
 * sees instead of waiting for a fresh `buildDailyPlan` sort. It writes the
 * pending-priority queue in `dailySessionStages.ts`. The mounted workspace
 * persists its own committed pointer before acknowledging this promotion; a
 * card already committed this session, or one already present in storage, is
 * never duplicated.
 *
 * When no session has started for this language pair, there is no matching pointer to prepend into, so
 * the ids are queued in `pending-fresh-priority` (dailySessionStages.ts)
 * instead. Session planning gives queued words in its bounded pool priority
 * before the new-word cap and keeps unscheduled ids for a later session.
 */
export function promoteCardsToActiveSessionNewStage(
  ownerId: string,
  cards: readonly CardData[],
  languagePair: DailyLanguagePair,
): PromoteCardsOutcome {
  const pointer = readDailySessionPointer(ownerId);
  if (!pointer || pointer.targetLanguage !== languagePair.targetLanguage || pointer.translationLanguage !== languagePair.translationLanguage) {
    const pending = readPendingFreshPriority(ownerId, languagePair);
    const newLogicalIds = dedupedNewLogicalIds(cards, new Set(pending));
    if (newLogicalIds.length > 0) writePendingFreshPriority(ownerId, languagePair, [...newLogicalIds, ...pending]);
    return 'no-active-session';
  }
  if (isNewStagePassed(pointer)) return 'new-stage-already-passed';

  const availableLogicalIds = dedupedNewLogicalIds(cards, new Set(pointer.freshLogicalIds));
  if (availableLogicalIds.length === 0) return 'promoted';
  const room = Math.max(0, MAXIMUM_ACTIVE_SESSION_NEW_WORDS - pointer.freshLogicalIds.length);
  const candidateLogicalIds = availableLogicalIds.slice(0, room);
  let materializedLogicalIds: readonly string[] | null = null;
  for (const listener of promotionListeners) {
    const result = listener({ ownerId, languagePair, logicalIds: candidateLogicalIds });
    if (Array.isArray(result)) { materializedLogicalIds = result; break; }
  }
  const candidateSet = new Set(candidateLogicalIds);
  const materialized = (materializedLogicalIds ?? [])
    .filter((logicalId, index, all) => candidateSet.has(logicalId) && all.indexOf(logicalId) === index);
  const materializedSet = new Set(materialized);
  const deferredLogicalIds = availableLogicalIds.filter(logicalId => !materializedSet.has(logicalId));
  if (deferredLogicalIds.length > 0) {
    const pending = readPendingFreshPriority(ownerId, languagePair);
    writePendingFreshPriority(ownerId, languagePair, [...deferredLogicalIds.filter(logicalId => !pending.includes(logicalId)), ...pending]);
  }
  if (materialized.length === 0) return room === 0 ? 'deferred-capped' : 'deferred-unloaded';

  return deferredLogicalIds.length > 0 ? 'promoted-partial' : 'promoted';
}
