import { describe, expect, it } from 'vitest';
import { normalizeCardWord } from '../../lib/cardIdentity';
import type { CardData } from '../../types/card';
import {
  createPracticeSnapshot,
  createQuizQuestions,
  createSpellingQueue,
  createWordMatchRound,
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
      expect(['target-to-native', 'native-to-target']).toContain(question.type);
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

  it('shuffles a bounded practice snapshot without mutating the source cards', () => {
    const original = cards.map(card => card.id);
    const snapshot = createPracticeSnapshot(cards, 3, () => 0);

    expect(snapshot.map(card => card.id)).toEqual(['1', '2', '0']);
    expect(cards.map(card => card.id)).toEqual(original);
    expect(snapshot).not.toBe(cards);
  });

  it('creates a trimmed, logically unique Match round with its actual eligible pair count', () => {
    const round = createWordMatchRound([
      ...cards.slice(0, 4),
      { ...cards[0], id: 'duplicate', word: ' ONE ', translation: ' vi-one ' },
      { ...cards[1], id: 'blank-word', word: ' ', translation: 'valid' },
      { ...cards[2], id: 'blank-translation', word: 'valid', translation: ' ' },
      cards[4],
    ], 6, () => 0);

    expect(round).toHaveLength(5);
    expect(round.map(card => [card.word, card.translation])).toContainEqual(['one', 'vi-one']);
    expect(round.every(card => card.word === card.word.trim() && card.translation === card.translation.trim())).toBe(true);
  });

});
