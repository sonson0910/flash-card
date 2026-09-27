import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CardData } from '../../types/card';
import { buildDailyPlan } from './dailyPlan';
import {
  applyRatingToStats,
  buildSessionStagePlan,
  clearDailySessionPointer,
  emptyDailySessionStats,
  firstOutstandingStage,
  logicalIdsOf,
  nextOutstandingStage,
  outstandingItems,
  readDailySessionPointer,
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
  stage: 'review',
  reviewLogicalIds: [],
  freshLogicalIds: [],
  matchCardIds: [],
  matchSkipReason: null,
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
    stats = applyRatingToStats(stats, 'a', 'good');
    stats = applyRatingToStats(stats, 'b', 'again');
    stats = applyRatingToStats(stats, 'b', 'again');
    stats = applyRatingToStats(stats, 'c', 'hard');
    expect(stats.goodCount).toBe(1);
    expect(stats.againCount).toBe(3);
    expect([...stats.weakCardIds].sort()).toEqual(['b', 'c']);
  });

  it('clears a card from the weak list once it is rated well', () => {
    let stats = applyRatingToStats(emptyDailySessionStats, 'a', 'again');
    expect(stats.weakCardIds).toEqual(['a']);
    stats = applyRatingToStats(stats, 'a', 'easy');
    expect(stats.weakCardIds).toEqual([]);
    expect(stats.goodCount).toBe(1);
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

  it('reads null for malformed stored JSON instead of throwing', () => {
    globalThis.sessionStorage.setItem('sonflash:daily-session:owner-1', '{not json');
    expect(readDailySessionPointer('owner-1')).toBeNull();
  });

  it('reads null once the shape no longer matches', () => {
    globalThis.sessionStorage.setItem('sonflash:daily-session:owner-1', JSON.stringify({ ownerId: 'owner-1' }));
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
