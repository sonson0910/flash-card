import { normalizeCardWord } from '../../lib/cardIdentity';
import type { CardData } from '../../types/card';

export interface QuizQuestion {
  card: CardData;
  type: 'en-to-vi' | 'vi-to-en';
  options: string[];
  correctAnswer: string;
}

export const isQuizAnswerCorrect = (question: QuizQuestion, option: string): boolean =>
  option === question.correctAnswer;

function shuffled<T>(values: readonly T[], random: () => number): T[] {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [result[index], result[target]] = [result[target], result[index]];
  }
  return result;
}

export function createQuizQuestions(
  cards: CardData[],
  maximum = 10,
  random: () => number = Math.random,
  normalizeAnswer: (value: unknown) => string = normalizeCardWord,
): QuizQuestion[] {
  const pool = shuffled(cards, random);
  return pool.slice(0, Math.min(maximum, pool.length)).map(card => {
    const type = random() > 0.5 ? 'en-to-vi' as const : 'vi-to-en' as const;
    const answerFor = (candidate: CardData) => type === 'en-to-vi' ? candidate.translation : candidate.word;
    const correctAnswer = answerFor(card);
    const answerKeys = new Set([normalizeAnswer(correctAnswer)]);
    const decoys = shuffled(cards.filter(candidate => candidate.id !== card.id), random)
      .map(answerFor)
      .filter(answer => {
        const key = normalizeAnswer(answer);
        if (!key || answerKeys.has(key)) return false;
        answerKeys.add(key);
        return true;
      })
      .slice(0, 3);
    return { card, type, correctAnswer, options: shuffled([correctAnswer, ...decoys], random) };
  });
}

export function createSpellingQueue(
  cards: CardData[],
  maximum = 10,
  random: () => number = Math.random,
): CardData[] {
  return shuffled(cards, random).slice(0, maximum);
}

export function createPracticeSnapshot(cards: readonly CardData[], maximum = 50): CardData[] {
  return cards.slice(0, Math.max(0, maximum));
}
