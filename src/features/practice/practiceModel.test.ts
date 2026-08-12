import { describe, expect, it } from 'vitest';
import { normalizeCardWord } from '../../lib/cardIdentity';
import type { CardData } from '../../types/card';
import {
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

  it('deduplicates quiz options by the normalized answer users are scored against', () => {
    const equivalentAnswers = [
      { ...cards[0], id: 'apple-1', word: 'apple', translation: 'quả táo' },
      { ...cards[1], id: 'apple-2', word: 'APPLE', translation: ' QUẢ TÁO ' },
      { ...cards[2], id: 'pear', word: 'pear', translation: 'lê' },
      { ...cards[3], id: 'plum', word: 'plum', translation: 'mận' },
    ];

    const questions = createQuizQuestions(equivalentAnswers, 4, () => 0.75, normalizeCardWord);

    questions.forEach(question => {
      const answerKeys = question.options.map(normalizeCardWord);
      expect(new Set(answerKeys).size).toBe(answerKeys.length);
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

});
