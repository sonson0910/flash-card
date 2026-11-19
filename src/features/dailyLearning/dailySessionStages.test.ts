import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CardData } from '../../types/card';
import { buildDailyPlan } from './dailyPlan';
import { cardsForLanguagePair } from '../practice/practiceModel';
import {
  answersForStage,
  applyRatingToStats,
  applyTierChangeToStats,
  longestCorrectRun,
  MAX_SESSION_ANSWERS,
  buildSessionStagePlan,
  canonicalMatchPairs,
  clearDailySessionPointer,
  emptyDailySessionStats,
  firstOutstandingStage,
  logicalIdsOf,
  nextOutstandingStage,
  outstandingItems,
  readDailySessionPointer,
  restoredSessionMatchStage,
  preparePendingMatchCompletion,
  skippedUnavailableMatchStage,
  writeDailySessionPointer,
  type DailySessionPointer,
} from './dailySessionStages';

const card = (id: string, overrides: Partial<CardData> = {}): CardData => ({
  id,
  word: id,
  normalizedWord: id,
  translation: `meaning ${id}`,
  explanation: '',
  phonetic: '',
  emoji: '',
  category: 'General',
  audioUrl: null,
  imageUrl: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  difficulty: 'unrated',
  reviews: 0,
  correctStreak: 0,
  ...overrides,
});

const now = new Date('2026-08-04T08:00:00.000Z');

const pointer = (overrides: Partial<DailySessionPointer> = {}): DailySessionPointer => ({
  ownerId: 'owner-1',
  targetLanguage: '',
  translationLanguage: '',
  stage: 'review',
  reviewLogicalIds: [],
  freshLogicalIds: [],
  matchCardIds: [],
  matchSkipReason: null,
  matchStartOpId: null,
  matchCompletionId: null,
  stats: emptyDailySessionStats,
  startedAt: '2026-08-04T08:00:00.000Z',
  ...overrides,
});

describe('buildSessionStagePlan', () => {
  it('splits the daily plan into review and new buckets and builds a match round from the pool', () => {
    const plan = buildDailyPlan([
      card('due-1', { reviews: 3, difficulty: 'good', nextReviewDate: '2026-08-01T00:00:00.000Z' }),
      card('weak-1', { reviews: 2, difficulty: 'hard', nextReviewDate: '2026-09-01T00:00:00.000Z' }),
      card('new-1'),
      card('new-2'),
    ], { now });
    const pool = [
      card('due-1', { reviews: 3, difficulty: 'good', nextReviewDate: '2026-08-01T00:00:00.000Z' }),
      card('weak-1', { reviews: 2, difficulty: 'hard', nextReviewDate: '2026-09-01T00:00:00.000Z' }),
      card('new-1'), card('new-2'), card('new-3'), card('new-4'), card('new-5'),
    ];

    const stagePlan = buildSessionStagePlan(plan, pool);

    expect(stagePlan.review.map(item => item.card.id).sort()).toEqual(['due-1', 'weak-1']);
    expect(stagePlan.fresh.map(item => item.card.id).sort()).toEqual(['new-1', 'new-2']);
    expect(stagePlan.match.skipReason).toBeNull();
    expect(stagePlan.match.cards.length).toBeGreaterThanOrEqual(4);
    expect(stagePlan.match.cards.length).toBeLessThanOrEqual(6);
  });

  it('skips the match stage with a reason instead of padding it with insufficient pairs', () => {
    const plan = buildDailyPlan([card('due-1', { reviews: 1, nextReviewDate: '2026-08-01T00:00:00.000Z' })], { now });
    const pool = [
      card('due-1', { reviews: 1, nextReviewDate: '2026-08-01T00:00:00.000Z' }),
      card('only-other', { word: 'a', translation: 'b' }),
    ];

    const stagePlan = buildSessionStagePlan(plan, pool);

    expect(stagePlan.match.cards).toEqual([]);
    expect(stagePlan.match.skipReason).toBe('insufficient-pairs');
  });

  it('uses only the active language pair for the daily Word Match stage', () => {
    const plan = buildDailyPlan([card('new-1')], { now });
    const stagePlan = buildSessionStagePlan(plan, [
      ...['1', '2', '3', '4'].map(id => card(`ko-vi-${id}`, { language: 'ko', translationLanguage: 'vi' })),
      card('ko-en', { language: 'ko', translationLanguage: 'en' }),
    ], () => 0, { targetLanguage: 'ko', translationLanguage: 'vi' });

    expect(stagePlan.match.cards.map(card => card.id).sort()).toEqual(['ko-vi-1', 'ko-vi-2', 'ko-vi-3', 'ko-vi-4']);
  });

  it('keeps another native-language pair out of the review stage while Match uses the active pair', () => {
    const pool = [
      card('old-native-due', { language: 'ko', translationLanguage: 'vi', reviews: 1, nextReviewDate: '2026-08-01T00:00:00.000Z' }),
      ...['1', '2', '3', '4'].map(id => card(`active-${id}`, {
        language: 'ko', translationLanguage: 'en', reviews: 1, difficulty: 'good', correctStreak: 5, nextReviewDate: '2026-09-01T00:00:00.000Z',
      })),
    ];
    const activePair = cardsForLanguagePair(pool, 'ko', 'en');
    const stagePlan = buildSessionStagePlan(buildDailyPlan(activePair, { now }), pool, () => 0, {
      targetLanguage: 'ko', translationLanguage: 'en',
    });

    expect(stagePlan.review).toEqual([]);
    expect(firstOutstandingStage(stagePlan)).toBe('match');
    expect(stagePlan.match.cards.map(card => card.id).sort()).toEqual(['active-1', 'active-2', 'active-3', 'active-4']);
  });

  it('restores match cards only for the pointer language pair and skips an insufficient restored pair', () => {
    const pool = [
      ...['1', '2', '3', '4'].map(id => card(`ko-vi-${id}`, { language: 'ko', translationLanguage: 'vi' })),
      ...['1', '2', '3', '4'].map(id => card(`ko-en-${id}`, { language: 'ko', translationLanguage: 'en' })),
    ];

    expect(restoredSessionMatchStage(pool, pool.map(card => card.id), { targetLanguage: 'ko', translationLanguage: 'vi' }))
      .toMatchObject({ cards: expect.arrayContaining([expect.objectContaining({ id: 'ko-vi-1' })]), skipReason: null });
    expect(restoredSessionMatchStage(pool, ['ko-vi-1', 'ko-vi-2', 'ko-vi-3', 'ko-en-1'], { targetLanguage: 'ko', translationLanguage: 'en' }))
      .toEqual({ cards: [], skipReason: 'insufficient-pairs' });
  });

  it('keeps saved match IDs when replay will reconstruct a frozen server challenge', () => {
    const stage = restoredSessionMatchStage([], ['deleted-1', 'deleted-2', 'deleted-3', 'deleted-4'], {
      targetLanguage: 'ko', translationLanguage: 'vi',
    }, true);

    expect(stage.cards.map(card => card.id)).toEqual(['deleted-1', 'deleted-2', 'deleted-3', 'deleted-4']);
    expect(stage.cards.every(card => card.word === '' && card.translation === '')).toBe(true);
  });
});

describe('firstOutstandingStage / nextOutstandingStage', () => {
  const stagePlanWithAll = () => buildSessionStagePlan(
    buildDailyPlan([
      card('due-1', { reviews: 1, nextReviewDate: '2026-08-01T00:00:00.000Z' }),
      card('new-1'),
    ], { now }),
    Array.from({ length: 6 }, (_, index) => card(`pair-${index}`)),
  );

  it('starts at review when review has outstanding items', () => {
    expect(firstOutstandingStage(stagePlanWithAll())).toBe('review');
  });

  it('advances review -> new -> match -> recap in order', () => {
    const stagePlan = stagePlanWithAll();
    expect(nextOutstandingStage(stagePlan, 'review')).toBe('new');
    expect(nextOutstandingStage(stagePlan, 'new')).toBe('match');
    expect(nextOutstandingStage(stagePlan, 'match')).toBe('recap');
  });

  it('skips an empty bucket straight to the next non-empty one', () => {
    const plan = buildDailyPlan([card('new-1')], { now });
    const stagePlan = buildSessionStagePlan(plan, []);
    expect(firstOutstandingStage(stagePlan)).toBe('new');
    expect(nextOutstandingStage(stagePlan, 'new')).toBe('recap');
  });

  it('starts with Match when it is the only available stage', () => {
    const stagePlan = buildSessionStagePlan(buildDailyPlan([], { now }), [
      card('pair-1'), card('pair-2'), card('pair-3'), card('pair-4'),
    ]);

    expect(firstOutstandingStage(stagePlan)).toBe('match');
  });

  it('marks an unavailable Match stage as skipped when advancing to recap', () => {
    const stagePlan = buildSessionStagePlan(
      buildDailyPlan([card('due-1', { reviews: 1, nextReviewDate: '2026-08-01T00:00:00.000Z' })], { now }),
      [card('pair-1'), card('pair-2'), card('pair-3')],
    );
    const nextStage = nextOutstandingStage(stagePlan, 'review');

    expect(nextStage).toBe('recap');
    expect(skippedUnavailableMatchStage(stagePlan, 'review', nextStage)).toBe(true);
  });
});

describe('outstandingItems', () => {
  it('keeps only items still present in the freshly rebuilt bucket, never re-adding a committed card', () => {
    const plan = buildDailyPlan([
      card('due-1', { reviews: 1, nextReviewDate: '2026-08-01T00:00:00.000Z' }),
      card('due-2', { reviews: 1, nextReviewDate: '2026-08-01T00:00:00.000Z' }),
    ], { now });
    const snapshotIds = logicalIdsOf(plan.items);

    // "due-1" was rated well and advanced past due with a healthy streak, so it drops out of every bucket.
    const freshPlan = buildDailyPlan([
      card('due-1', { reviews: 2, correctStreak: 5, difficulty: 'good', nextReviewDate: '2026-09-01T00:00:00.000Z' }),
      card('due-2', { reviews: 1, nextReviewDate: '2026-08-01T00:00:00.000Z' }),
    ], { now });

    const outstanding = outstandingItems(snapshotIds, freshPlan.items);
    expect(outstanding.map(item => item.card.id)).toEqual(['due-2']);
  });
});

describe('applyRatingToStats', () => {
  it('counts good/easy as good and again/hard as again, tracking weak cards without duplicates', () => {
    let stats = emptyDailySessionStats;
    stats = applyRatingToStats(stats, 'a', 'good', 2);
    stats = applyRatingToStats(stats, 'b', 'again', 2);
    stats = applyRatingToStats(stats, 'b', 'again', 0);
    stats = applyRatingToStats(stats, 'c', 'hard', 2);
    expect(stats.goodCount).toBe(1);
    expect(stats.againCount).toBe(3);
    expect(stats.reviewXp).toBe(6);
    expect([...stats.weakCardIds].sort()).toEqual(['b', 'c']);
  });

  it('clears a card from the weak list once it is rated well', () => {
    let stats = applyRatingToStats(emptyDailySessionStats, 'a', 'again', 0);
    expect(stats.weakCardIds).toEqual(['a']);
    stats = applyRatingToStats(stats, 'a', 'easy', 2);
    expect(stats.weakCardIds).toEqual([]);
    expect(stats.goodCount).toBe(1);
  });

  it('records each committed answer with its stage so the bridge can show a real combo', () => {
    let stats = emptyDailySessionStats;
    for (const [id, rating] of [['a', 'good'], ['b', 'easy'], ['c', 'again'], ['d', 'good'], ['e', 'good'], ['f', 'good']] as const) {
      stats = applyRatingToStats(stats, id, rating, 1, 'review');
    }
    stats = applyRatingToStats(stats, 'g', 'hard', 1, 'new');
    expect(answersForStage(stats, 'review').map(answer => answer.correct)).toEqual([true, true, false, true, true, true]);
    expect(answersForStage(stats, 'new')).toEqual([{ stage: 'new', correct: false }]);
    expect(longestCorrectRun(answersForStage(stats, 'review'))).toBe(3);
    expect(longestCorrectRun([])).toBe(0);
  });

  it('never invents answers for a pointer saved before answers were tracked', () => {
    const legacy = { goodCount: 4, againCount: 1, weakCardIds: [], reviewXp: 5, matchXp: 0 };
    const stats = applyRatingToStats(legacy, 'a', 'good', 1, 'review');
    expect(stats.answers).toBeUndefined();
    expect(answersForStage(stats, 'review')).toEqual([]);
  });

  it('keeps the stored answer list bounded', () => {
    let stats = emptyDailySessionStats;
    for (let index = 0; index < MAX_SESSION_ANSWERS + 5; index += 1) stats = applyRatingToStats(stats, `c${index}`, 'good', 0, 'review');
    expect(stats.answers).toHaveLength(MAX_SESSION_ANSWERS);
  });

  it('keeps promotions recorded earlier when a later rating lands', () => {
    const promoted = applyTierChangeToStats(emptyDailySessionStats, 'a', 'new', 'learning');
    expect(applyRatingToStats(promoted, 'b', 'good', 0, 'review').promotions).toEqual([{ cardId: 'a', from: 'new', to: 'learning' }]);
  });
});

describe('applyTierChangeToStats', () => {
  it('records a card only when its committed review raised its tier', () => {
    expect(applyTierChangeToStats(emptyDailySessionStats, 'a', 'learning', 'learning')).toBe(emptyDailySessionStats);
    expect(applyTierChangeToStats(emptyDailySessionStats, 'a', 'mastered', 'learning')).toBe(emptyDailySessionStats);
    expect(applyTierChangeToStats(emptyDailySessionStats, 'a', 'new', 'learning').promotions).toEqual([{ cardId: 'a', from: 'new', to: 'learning' }]);
  });

  it('keeps the tier a card started the session with across repeat reviews', () => {
    let stats = applyTierChangeToStats(emptyDailySessionStats, 'a', 'new', 'learning');
    stats = applyTierChangeToStats(stats, 'a', 'learning', 'mastered');
    expect(stats.promotions).toEqual([{ cardId: 'a', from: 'new', to: 'mastered' }]);
  });

  it('drops a card that fell back to its starting tier later in the session', () => {
    let stats = applyTierChangeToStats(emptyDailySessionStats, 'a', 'learning', 'mastered');
    stats = applyTierChangeToStats(stats, 'b', 'new', 'learning');
    stats = applyTierChangeToStats(stats, 'a', 'mastered', 'learning');
    expect(stats.promotions).toEqual([{ cardId: 'b', from: 'new', to: 'learning' }]);
  });
});

it('sends completed Match pairs in frozen challenge order across retries', () => {
  const cards = [card('a'), card('b')];
  const reverse = [
    { cardId: 'b', word: 'b', translation: 'meaning b' },
    { cardId: 'a', word: 'a', translation: 'meaning a' },
  ];
  expect(canonicalMatchPairs(cards, reverse)).toEqual([...reverse].reverse());
  expect(canonicalMatchPairs(cards, [{ ...reverse[0], word: 'changed' }, reverse[1]])).toBeNull();
});

it('checkpoints valid local Match pairs for offline completion retry', () => {
  const cards = [card('a'), card('b')];
  const submitted = [
    { cardId: 'b', word: 'b', translation: 'meaning b' },
    { cardId: 'a', word: 'a', translation: 'meaning a' },
  ];

  expect(preparePendingMatchCompletion(cards, submitted, true)).toEqual({
    pairs: [...submitted].reverse(), matchStatus: 'complete-error',
  });
});

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

describe('session pointer storage', () => {
  beforeEach(() => {
    vi.stubGlobal('sessionStorage', createMemoryStorage());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('round-trips a pointer for its owner and reads null for another owner', () => {
    writeDailySessionPointer(pointer({ ownerId: 'owner-1', stage: 'match' }));
    expect(readDailySessionPointer('owner-1')).toEqual(pointer({ ownerId: 'owner-1', stage: 'match' }));
    expect(readDailySessionPointer('owner-2')).toBeNull();
  });

  it('retains only replay metadata for an uncertain Match completion', () => {
    const saved = pointer({
      stage: 'match', matchCardIds: ['a', 'b', 'c', 'd'], matchStartOpId: 'start-1',
      matchCompletionId: 'complete-1', matchTimeZone: 'Asia/Ho_Chi_Minh', matchCompletionPending: true,
    });
    writeDailySessionPointer(saved);
    expect(readDailySessionPointer('owner-1')).toEqual(saved);
    expect(globalThis.sessionStorage.getItem('sonflash:daily-session:owner-1')).not.toContain('meaning a');
  });

  it('round-trips a bridge checkpoint so reload can retain its skip explanation', () => {
    const saved = pointer({
      stage: 'review', bridgeCompletedStage: 'review', matchSkipReason: 'insufficient-pairs',
    });
    writeDailySessionPointer(saved);

    expect(readDailySessionPointer('owner-1')).toEqual(saved);
  });

  it('round-trips committed answers and rejects a malformed answer list', () => {
    const answers = [{ stage: 'review' as const, correct: true }, { stage: 'new' as const, correct: false }];
    const saved = pointer({ stats: { ...emptyDailySessionStats, answers } });
    writeDailySessionPointer(saved);
    expect(readDailySessionPointer('owner-1')?.stats.answers).toEqual(answers);
    globalThis.sessionStorage.setItem('sonflash:daily-session:owner-1', JSON.stringify(pointer({
      stats: { ...emptyDailySessionStats, answers: [{ stage: 'match', correct: true }] as never },
    })));
    expect(readDailySessionPointer('owner-1')).toBeNull();
  });

  it('round-trips promoted card ids and rejects a malformed promotion list', () => {
    const promotions = [{ cardId: 'a', from: 'new' as const, to: 'learning' as const }];
    writeDailySessionPointer(pointer({ stats: { ...emptyDailySessionStats, promotions } }));
    expect(readDailySessionPointer('owner-1')?.stats.promotions).toEqual(promotions);
    globalThis.sessionStorage.setItem('sonflash:daily-session:owner-1', JSON.stringify(pointer({
      stats: { ...emptyDailySessionStats, promotions: [{ cardId: 'a', from: 'new', to: 'legend' }] as never },
    })));
    expect(readDailySessionPointer('owner-1')).toBeNull();
  });

  it('reads a pointer saved before promotions were tracked', () => {
    const { promotions: _promotions, ...legacyStats } = emptyDailySessionStats;
    globalThis.sessionStorage.setItem('sonflash:daily-session:owner-1', JSON.stringify(pointer({ stats: legacyStats })));
    expect(readDailySessionPointer('owner-1')?.stats.promotions).toBeUndefined();
  });

  it('reads null for malformed stored JSON instead of throwing', () => {
    globalThis.sessionStorage.setItem('sonflash:daily-session:owner-1', '{not json');
    expect(readDailySessionPointer('owner-1')).toBeNull();
  });

  it('reads null once the shape no longer matches', () => {
    globalThis.sessionStorage.setItem('sonflash:daily-session:owner-1', JSON.stringify({ ownerId: 'owner-1' }));
    expect(readDailySessionPointer('owner-1')).toBeNull();
  });

  it('treats legacy pointers without a translation language as absent', () => {
    const { translationLanguage: _, ...legacyPointer } = pointer();
    globalThis.sessionStorage.setItem('sonflash:daily-session:owner-1', JSON.stringify(legacyPointer));
    expect(readDailySessionPointer('owner-1')).toBeNull();
  });

  it('clears the pointer for its owner only', () => {
    writeDailySessionPointer(pointer({ ownerId: 'owner-1' }));
    writeDailySessionPointer(pointer({ ownerId: 'owner-2' }));
    clearDailySessionPointer('owner-1');
    expect(readDailySessionPointer('owner-1')).toBeNull();
    expect(readDailySessionPointer('owner-2')).not.toBeNull();
  });

  it('reads null without throwing when sessionStorage is unavailable', () => {
    vi.stubGlobal('sessionStorage', undefined);
    expect(readDailySessionPointer('owner-1')).toBeNull();
    expect(() => writeDailySessionPointer(pointer())).not.toThrow();
    expect(() => clearDailySessionPointer('owner-1')).not.toThrow();
  });
});
