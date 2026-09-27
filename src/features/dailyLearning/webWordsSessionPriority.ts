import type { CardData } from '../../types/card';
import { logicalIdentity } from './dailyPlan';
import {
  readDailySessionPointer,
  readPendingFreshPriority,
  writeDailySessionPointer,
  writePendingFreshPriority,
  type DailySessionPointer,
} from './dailySessionStages';

export type PromoteCardsOutcome =
  /** No session pointer existed yet (not started, or already finished) — queued into pending-fresh-priority instead; see the caller that builds the first pointer of the day. */
  | 'no-active-session'
  /** The active session already finished the 'new' stage; the word still surfaces on its own next time `buildDailyPlan` runs (see the caller for the resulting gap). */
  | 'new-stage-already-passed'
  | 'promoted';

const isNewStagePassed = (stage: DailySessionPointer['stage']): boolean => stage === 'match' || stage === 'recap';

const dedupedNewLogicalIds = (cards: readonly CardData[], existing: ReadonlySet<string>): readonly string[] => (
  cards.map(logicalIdentity).filter((logicalId, index, all) => !existing.has(logicalId) && all.indexOf(logicalId) === index)
);

/**
 * Puts freshly added web-sourced cards at the front of the *already started*
 * session's 'new' stage, so they are the very next new words the learner
 * sees instead of waiting for a fresh `buildDailyPlan` sort. Only touches the
 * sessionStorage pointer (`dailySessionStages.ts`, already exported and
 * already used by `SessionBridge.tsx`); it never rewrites `dailyPlan.ts`'s
 * bucket, so a card already committed this session, or one already present
 * in the pointer, is never duplicated.
 *
 * When no session has started yet, there is no pointer to prepend into, so
 * the ids are queued in `pending-fresh-priority` (dailySessionStages.ts)
 * instead; whichever code builds the first pointer of the day consumes that
 * queue to front-load these words, the same guarantee the already-started
 * path gives above.
 */
export function promoteCardsToActiveSessionNewStage(
  ownerId: string,
  cards: readonly CardData[],
): PromoteCardsOutcome {
  const pointer = readDailySessionPointer(ownerId);
  if (!pointer) {
    const pending = readPendingFreshPriority(ownerId);
    const newLogicalIds = dedupedNewLogicalIds(cards, new Set(pending));
    if (newLogicalIds.length > 0) writePendingFreshPriority(ownerId, [...newLogicalIds, ...pending]);
    return 'no-active-session';
  }
  if (isNewStagePassed(pointer.stage)) return 'new-stage-already-passed';

  const newLogicalIds = dedupedNewLogicalIds(cards, new Set(pointer.freshLogicalIds));
  if (newLogicalIds.length === 0) return 'promoted';

  writeDailySessionPointer({
    ...pointer,
    freshLogicalIds: [...newLogicalIds, ...pointer.freshLogicalIds],
  });
  return 'promoted';
}
