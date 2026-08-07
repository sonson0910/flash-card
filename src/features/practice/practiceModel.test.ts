import { describe, expect, it } from 'vitest';
import type { CardData } from '../../types/card';
import {
  claimPracticeReview,
  createPracticeSnapshot,
  createQuizQuestions,
  createSpellingQueue,
} from './practiceModel';

const cards = ['one', 'two', 'three', 'four', 'five'].map((word, index) => ({
  id: String(index), word, translation: `vi-${word}`, explanation: '', phonetic: '', emoji: '📘', category: 'Other', audioUrl: null, imageUrl: null,
} satisfies CardData));

describe('practice model', () => {
  it('creates quiz questions with one correct answer and no duplicate options', () => {
    const questions = createQuizQuestions(cards, 3, () => 0.25);
    expect(questions).toHaveLength(3);
    questions.forEach(question => {
      expect(question.options).toContain(question.correctAnswer);
      expect(new Set(question.options).size).toBe(question.options.length);
    });
  });

  it('creates a bounded spelling queue without mutating the source cards', () => {
    const original = cards.map(card => card.id);
    expect(createSpellingQueue(cards, 3, () => 0.5)).toHaveLength(3);
    expect(cards.map(card => card.id)).toEqual(original);
  });

  it('creates a bounded practice snapshot without sharing the source array', () => {
    const snapshot = createPracticeSnapshot(cards, 3);

    expect(snapshot.map(card => card.id)).toEqual(['0', '1', '2']);
    expect(snapshot).not.toBe(cards);
  });

  it('claims each review only once while it is pending or already reviewed', () => {
    const pending = new Set<string>();
    const reviewed = new Set<string>();

    expect(claimPracticeReview('0', pending, reviewed)).toBe(true);
    expect(claimPracticeReview('0', pending, reviewed)).toBe(false);
    pending.delete('0');
    expect(claimPracticeReview('0', pending, reviewed)).toBe(false);
  });
});
