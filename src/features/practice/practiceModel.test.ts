import { describe, expect, it } from 'vitest';
import type { CardData } from '../../types/card';
import { createQuizQuestions, createSpellingQueue } from './practiceModel';

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
});
