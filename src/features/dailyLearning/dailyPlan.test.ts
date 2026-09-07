import { describe, expect, it } from 'vitest';
import type { CardData } from '../../types/card';
import { buildDailyPlan, buildDailyLessonSteps } from './dailyPlan';

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

describe('buildDailyPlan', () => {
  it('builds mutually exclusive reviewed-due, reviewed-weak and new buckets', () => {
    const now = new Date('2026-08-04T08:00:00.000Z');
    const plan = buildDailyPlan([
      card('new', { nextReviewDate: '2020-01-01T00:00:00.000Z' }),
      card('weak', { reviews: 2, difficulty: 'hard', nextReviewDate: '2026-09-01T00:00:00.000Z' }),
      card('due', { reviews: 3, difficulty: 'good', nextReviewDate: '2026-08-01T00:00:00.000Z' }),
    ], { now });

    expect(plan.items.map(item => [item.card.id, item.reason])).toEqual([
      ['due', 'due'],
      ['weak', 'weak'],
      ['new', 'new'],
    ]);
    expect(plan.counts).toEqual({ due: 1, weak: 1, new: 1, total: 3 });
    expect(plan.isShort).toBe(true);
  });

  it('deduplicates logical words, remains deterministic and caps reviewed work at fifteen', () => {
    const cards = Array.from({ length: 20 }, (_, index) => card(`word-${String(index).padStart(2, '0')}`, {
      reviews: 1,
      nextReviewDate: '2026-08-01T00:00:00.000Z',
    }));
    cards.push(card('duplicate-document', {
      word: 'WORD-00',
      normalizedWord: 'word-00',
      reviews: 1,
      nextReviewDate: '2026-08-01T00:00:00.000Z',
    }));

    const first = buildDailyPlan(cards, { now: new Date('2026-08-04T08:00:00.000Z') });
    const second = buildDailyPlan([...cards].reverse(), { now: new Date('2026-08-04T08:00:00.000Z') });

    expect(first.items).toHaveLength(15);
    expect(first.items.map(item => item.card.id)).toEqual(second.items.map(item => item.card.id));
    expect(new Set(first.items.map(item => item.logicalId)).size).toBe(15);
    expect(first.isShort).toBe(false);
  });

  it('caps new items at five while due and weak items can still fill fifteen', () => {
    const now = new Date('2026-08-04T08:00:00.000Z');
    const due = Array.from({ length: 8 }, (_, index) => card(`due-${index}`, {
      reviews: 1,
      nextReviewDate: '2026-08-01T00:00:00.000Z',
    }));
    const weak = Array.from({ length: 8 }, (_, index) => card(`weak-${index}`, {
      reviews: 1,
      difficulty: 'hard',
      nextReviewDate: '2026-09-01T00:00:00.000Z',
    }));
    const newItems = Array.from({ length: 8 }, (_, index) => card(`new-${index}`));

    const plan = buildDailyPlan([...newItems, ...weak, ...due], { now });

    expect(plan.items).toHaveLength(15);
    expect(plan.counts).toEqual({ due: 8, weak: 7, new: 0, total: 15 });
    const allNewPlan = buildDailyPlan(newItems, { now });
    expect(allNewPlan.counts).toEqual({ due: 0, weak: 0, new: 5, total: 5 });
    expect(allNewPlan.isShort).toBe(true);
  });

  it('clamps the new-item cap to the overall maximum and validates overrides', () => {
    const now = new Date('2026-08-04T08:00:00.000Z');
    const newItems = Array.from({ length: 5 }, (_, index) => card(`new-${index}`));

    expect(buildDailyPlan(newItems, { now, maximum: 2, targetMinimum: 1 }).counts).toEqual({
      due: 0,
      weak: 0,
      new: 2,
      total: 2,
    });
    expect(() => buildDailyPlan(newItems, { now, maximumNew: 6 })).toThrow(/maximumNew/i);
  });

  it('uses stable due-date and identity tie-breaks and rejects invalid bounds', () => {
    const now = new Date('2026-08-04T08:00:00.000Z');
    const plan = buildDailyPlan([
      card('due-later', { reviews: 1, nextReviewDate: '2026-08-03T00:00:00.000Z' }),
      card('due-a', { reviews: 1, nextReviewDate: '2026-08-01T00:00:00.000Z' }),
      card('due-b', { reviews: 1, nextReviewDate: '2026-08-01T00:00:00.000Z' }),
    ], { now, maximum: 10 });

    expect(plan.items.map(item => item.card.id)).toEqual(['due-a', 'due-b', 'due-later']);
    expect(() => buildDailyPlan([], { now, maximum: 16 })).toThrow(/maximum/i);
    expect(() => buildDailyPlan([], { now: new Date('invalid') })).toThrow(/now/i);
  });

  it('recognizes legacy review evidence and keeps the most-progressed logical duplicate', () => {
    const now = new Date('2026-08-04T08:00:00.000Z');
    const plan = buildDailyPlan([
      card('legacy-rated', { reviews: undefined, difficulty: 'good', nextReviewDate: '2026-08-01T00:00:00.000Z' }),
      card('copy-a', { normalizedWord: 'shared', word: 'shared', reviews: 0 }),
      card('copy-b', { normalizedWord: 'shared', word: 'shared', reviews: 8, nextReviewDate: '2026-08-02T00:00:00.000Z' }),
      card('future-good', { reviews: 2, difficulty: 'good', correctStreak: undefined, nextReviewDate: '2026-09-01T00:00:00.000Z' }),
    ], { now });

    expect(plan.items.map(item => [item.card.id, item.reason])).toEqual([
      ['legacy-rated', 'due'],
      ['copy-b', 'due'],
    ]);
  });
});

describe('buildDailyLessonSteps', () => {
  it('expands only new cards into introduction, guidance and one terminal recall', () => {
    const source = card('new', { translation: 'mới' });
    const due = card('due', { reviews: 1, nextReviewDate: '2026-08-01T00:00:00.000Z' });
    const plan = buildDailyPlan([source, due], { now: new Date('2026-08-04T08:00:00.000Z') });
    const steps = buildDailyLessonSteps(plan.items, [source, due], 'recognition');

    expect(steps.map(step => [step.stage, step.exercise.cardId])).toEqual([
      ['review', 'due'],
      ['introduction', 'new'],
      ['guided', 'new'],
      ['independent-recall', 'new'],
    ]);
  });
});
