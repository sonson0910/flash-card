import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CardData } from '../../types/card';
import {
  buildSessionStagePlan,
  clearDailySessionPointer,
  clearPendingFreshPriority,
  consumeScheduledFreshPriority,
  logicalIdsOf,
  readDailySessionPointer,
  readPendingFreshPriority,
  writeDailySessionPointer,
  type DailySessionPointer,
} from './dailySessionStages';
import { buildDailyPlan, logicalIdentity } from './dailyPlan';
import { MAXIMUM_ACTIVE_SESSION_NEW_WORDS, promoteCardsToActiveSessionNewStage, subscribeToActiveSessionNewStagePromotions } from './webWordsSessionPriority';

const OWNER = 'owner-1';
const PAIR = { targetLanguage: 'en', translationLanguage: 'vi' };

/** The vitest node environment has no real sessionStorage; mirrors the in-memory stub `dailySessionStages.test.ts` already uses. */
function createMemoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: key => store.get(key) ?? null,
    setItem: (key, value) => { store.set(key, value); },
    removeItem: key => { store.delete(key); },
    clear: () => store.clear(),
    key: index => Array.from(store.keys())[index] ?? null,
    get length() { return store.size; },
  } as Storage;
}

const webCard = (id: string): CardData => ({
  id, word: id, translation: 'x', language: 'en', createdAt: '2026-09-27T00:00:00.000Z', reviews: 0,
  source: { url: 'https://example.com', capturedAt: '2026-09-27T00:00:00.000Z' },
} as CardData);

const pointer = (overrides: Partial<DailySessionPointer> = {}): DailySessionPointer => ({
  ownerId: OWNER,
  targetLanguage: 'en',
  translationLanguage: 'vi',
  stage: 'new',
  reviewLogicalIds: [],
  freshLogicalIds: ['already-fresh'],
  matchCardIds: [],
  matchSkipReason: null,
  stats: { goodCount: 0, againCount: 0, weakCardIds: [], matchXp: 0 },
  startedAt: '2026-09-27T07:00:00.000Z',
  ...overrides,
});

const acknowledgePromotion = (logicalIds: readonly string[]): readonly string[] => {
  const current = readDailySessionPointer(OWNER);
  if (current) writeDailySessionPointer({ ...current, freshLogicalIds: [...logicalIds, ...current.freshLogicalIds] });
  return logicalIds;
};

describe('promoteCardsToActiveSessionNewStage', () => {
  beforeEach(() => vi.stubGlobal('sessionStorage', createMemoryStorage()));

  afterEach(() => {
    clearDailySessionPointer(OWNER);
    clearPendingFreshPriority(OWNER, PAIR);
    clearPendingFreshPriority(OWNER, { targetLanguage: 'ko', translationLanguage: 'vi' });
    clearPendingFreshPriority(OWNER, { targetLanguage: 'en', translationLanguage: 'en' });
    vi.unstubAllGlobals();
  });

  it('reports no-active-session, writes no pointer, and queues the word as pending-fresh-priority', () => {
    const outcome = promoteCardsToActiveSessionNewStage(OWNER, [webCard('new-word')], PAIR);

    expect(outcome).toBe('no-active-session');
    expect(readDailySessionPointer(OWNER)).toBeNull();
    expect(readPendingFreshPriority(OWNER, PAIR)).toEqual(['new-word']);
  });

  it('keeps every pre-start selection queued when more than fifteen words are selected', () => {
    const cards = Array.from({ length: MAXIMUM_ACTIVE_SESSION_NEW_WORDS + 1 }, (_, index) => webCard(`queued-${index}`));

    expect(promoteCardsToActiveSessionNewStage(OWNER, cards, PAIR)).toBe('no-active-session');
    expect(readDailySessionPointer(OWNER)).toBeNull();
    expect(readPendingFreshPriority(OWNER, PAIR)).toEqual(cards.map(logicalIdentity));
  });

  it('prepends a second pending word without duplicating one already queued', () => {
    promoteCardsToActiveSessionNewStage(OWNER, [webCard('first-word')], PAIR);

    promoteCardsToActiveSessionNewStage(OWNER, [webCard('second-word'), webCard('first-word')], PAIR);

    expect(readPendingFreshPriority(OWNER, PAIR)).toEqual(['second-word', 'first-word']);
  });

  it('keeps the same logical word queued independently for different native languages', () => {
    const word = webCard('same-word');
    promoteCardsToActiveSessionNewStage(OWNER, [word], PAIR);
    promoteCardsToActiveSessionNewStage(OWNER, [{ ...word, translationLanguage: 'en' }], {
      targetLanguage: 'en', translationLanguage: 'en',
    });

    expect(readPendingFreshPriority(OWNER, PAIR)).toEqual([logicalIdentity(word)]);
    expect(readPendingFreshPriority(OWNER, { targetLanguage: 'en', translationLanguage: 'en' })).toEqual([logicalIdentity(word)]);
  });

  it('keeps a queued word outside the bounded practice pool for a later session', () => {
    const cards = Array.from({ length: 15 }, (_, index) => webCard(`word-${String(index).padStart(2, '0')}`));
    const outsidePool = webCard('word-15');
    promoteCardsToActiveSessionNewStage(OWNER, [outsidePool, cards[0]], PAIR);
    const plan = buildDailyPlan(cards, { now: new Date('2026-09-28T00:00:00.000Z'), freshPriorityLogicalIds: readPendingFreshPriority(OWNER, PAIR) });
    const stages = buildSessionStagePlan(plan, cards);
    expect(stages.fresh).toHaveLength(5);

    consumeScheduledFreshPriority(OWNER, PAIR, [...logicalIdsOf(stages.review), ...logicalIdsOf(stages.fresh)]);
    expect(readPendingFreshPriority(OWNER, PAIR)).toEqual([logicalIdentity(outsidePool)]);
  });

  it('puts a newly captured word at the front of the freshLogicalIds queue of an in-progress session', () => {
    writeDailySessionPointer(pointer());
    const unsubscribe = subscribeToActiveSessionNewStagePromotions(promotion => acknowledgePromotion(promotion.logicalIds));

    const outcome = promoteCardsToActiveSessionNewStage(OWNER, [webCard('new-word')], PAIR);
    unsubscribe();

    expect(outcome).toBe('promoted');
    expect(readDailySessionPointer(OWNER)?.freshLogicalIds).toEqual(['new-word', 'already-fresh']);
  });

  it('keeps a concurrent stats update when the mounted session acknowledges a promotion', () => {
    writeDailySessionPointer(pointer());
    const unsubscribe = subscribeToActiveSessionNewStagePromotions(promotion => {
      const current = readDailySessionPointer(OWNER);
      if (current) writeDailySessionPointer({
        ...current,
        freshLogicalIds: [...promotion.logicalIds, ...current.freshLogicalIds],
        stats: { ...current.stats, goodCount: current.stats.goodCount + 1 },
      });
      return promotion.logicalIds;
    });

    expect(promoteCardsToActiveSessionNewStage(OWNER, [webCard('new-word')], PAIR)).toBe('promoted');
    unsubscribe();

    expect(readDailySessionPointer(OWNER)).toMatchObject({
      freshLogicalIds: ['new-word', 'already-fresh'],
      stats: { goodCount: 1 },
    });
  });

  it('acknowledges two sequential promotions without losing either committed pointer entry', () => {
    writeDailySessionPointer(pointer());
    const unsubscribe = subscribeToActiveSessionNewStagePromotions(promotion => acknowledgePromotion(promotion.logicalIds));

    expect(promoteCardsToActiveSessionNewStage(OWNER, [webCard('first')], PAIR)).toBe('promoted');
    expect(promoteCardsToActiveSessionNewStage(OWNER, [webCard('second')], PAIR)).toBe('promoted');
    unsubscribe();

    expect(readDailySessionPointer(OWNER)?.freshLogicalIds).toEqual(['second', 'first', 'already-fresh']);
  });

  it('notifies the mounted session with the persisted, deduplicated promotion', () => {
    writeDailySessionPointer(pointer());
    const received = vi.fn(promotion => acknowledgePromotion(promotion.logicalIds));
    const unsubscribe = subscribeToActiveSessionNewStagePromotions(received);

    promoteCardsToActiveSessionNewStage(OWNER, [webCard('new-word'), webCard('new-word')], PAIR);
    unsubscribe();

    expect(received).toHaveBeenCalledWith(expect.objectContaining({
      ownerId: OWNER,
      languagePair: PAIR,
      logicalIds: ['new-word'],
    }));
  });

  it('caps a live new-word stage and only notifies for cards that fit', () => {
    writeDailySessionPointer(pointer({
      freshLogicalIds: Array.from({ length: MAXIMUM_ACTIVE_SESSION_NEW_WORDS - 1 }, (_, index) => `existing-${index}`),
    }));
    const received = vi.fn(promotion => acknowledgePromotion(promotion.logicalIds));
    const unsubscribe = subscribeToActiveSessionNewStagePromotions(received);

    expect(promoteCardsToActiveSessionNewStage(OWNER, [webCard('fits'), webCard('does-not-fit')], PAIR)).toBe('promoted-partial');
    unsubscribe();

    expect(readDailySessionPointer(OWNER)?.freshLogicalIds).toEqual(['fits', ...Array.from({ length: MAXIMUM_ACTIVE_SESSION_NEW_WORDS - 1 }, (_, index) => `existing-${index}`)]);
    expect(readPendingFreshPriority(OWNER, PAIR)).toEqual(['does-not-fit']);
    expect(received).toHaveBeenCalledWith(expect.objectContaining({ logicalIds: ['fits'] }));
  });

  it('keeps an unloaded active-session word in pending priority instead of leaving it only in the pointer', () => {
    writeDailySessionPointer(pointer());
    const unsubscribe = subscribeToActiveSessionNewStagePromotions(() => []);

    expect(promoteCardsToActiveSessionNewStage(OWNER, [webCard('outside-loaded-pool')], PAIR)).toBe('deferred-unloaded');
    unsubscribe();

    expect(readDailySessionPointer(OWNER)?.freshLogicalIds).toEqual(['already-fresh']);
    expect(readPendingFreshPriority(OWNER, PAIR)).toEqual(['outside-loaded-pool']);
  });

  it('keeps an active-session word pending when Today is not mounted to materialize it', () => {
    writeDailySessionPointer(pointer());

    expect(promoteCardsToActiveSessionNewStage(OWNER, [webCard('today-unmounted')], PAIR)).toBe('deferred-unloaded');
    expect(readDailySessionPointer(OWNER)?.freshLogicalIds).toEqual(['already-fresh']);
    expect(readPendingFreshPriority(OWNER, PAIR)).toEqual(['today-unmounted']);
  });

  it('queues a full-stage selection without reporting a partial promotion', () => {
    writeDailySessionPointer(pointer({
      freshLogicalIds: Array.from({ length: MAXIMUM_ACTIVE_SESSION_NEW_WORDS }, (_, index) => `existing-${index}`),
    }));

    expect(promoteCardsToActiveSessionNewStage(OWNER, [webCard('deferred')], PAIR)).toBe('deferred-capped');
    expect(readPendingFreshPriority(OWNER, PAIR)).toEqual(['deferred']);
  });

  it('never duplicates a word that is already queued in the pointer', () => {
    writeDailySessionPointer(pointer({ freshLogicalIds: ['already-fresh'] }));

    promoteCardsToActiveSessionNewStage(OWNER, [webCard('already-fresh')], PAIR);

    expect(readDailySessionPointer(OWNER)?.freshLogicalIds).toEqual(['already-fresh']);
  });

  it('queues words for another course instead of mutating its stale session pointer', () => {
    writeDailySessionPointer(pointer());
    const korean = { ...webCard('korean-word'), language: 'ko' };
    const englishMeaning = { ...webCard('english-meaning'), translationLanguage: 'en' };

    expect(promoteCardsToActiveSessionNewStage(OWNER, [korean], { targetLanguage: 'ko', translationLanguage: 'vi' })).toBe('no-active-session');
    expect(promoteCardsToActiveSessionNewStage(OWNER, [englishMeaning], { targetLanguage: 'en', translationLanguage: 'en' })).toBe('no-active-session');
    expect(readDailySessionPointer(OWNER)?.freshLogicalIds).toEqual(['already-fresh']);
    expect(readPendingFreshPriority(OWNER, PAIR)).toEqual([]);
    expect(readPendingFreshPriority(OWNER, { targetLanguage: 'ko', translationLanguage: 'vi' })).toEqual([logicalIdentity(korean)]);
    expect(readPendingFreshPriority(OWNER, { targetLanguage: 'en', translationLanguage: 'en' })).toEqual([logicalIdentity(englishMeaning)]);
  });

  it('reports new-stage-already-passed and leaves the pointer untouched once the session reached match or recap', () => {
    writeDailySessionPointer(pointer({ stage: 'recap' }));

    const outcome = promoteCardsToActiveSessionNewStage(OWNER, [webCard('too-late')], PAIR);

    expect(outcome).toBe('new-stage-already-passed');
    expect(readDailySessionPointer(OWNER)?.freshLogicalIds).toEqual(['already-fresh']);
  });

  it('does not add cards while the bridge follows a completed new stage', () => {
    writeDailySessionPointer(pointer({ bridgeCompletedStage: 'new' }));

    expect(promoteCardsToActiveSessionNewStage(OWNER, [webCard('too-late')], PAIR)).toBe('new-stage-already-passed');
    expect(readDailySessionPointer(OWNER)?.freshLogicalIds).toEqual(['already-fresh']);
  });
});
