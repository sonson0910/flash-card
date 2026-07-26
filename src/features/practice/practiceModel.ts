import type { CardData } from '../../types/card';

export interface QuizQuestion {
  card: CardData;
  type: 'en-to-vi' | 'vi-to-en';
  options: string[];
  correctAnswer: string;
}

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
): QuizQuestion[] {
  const pool = shuffled(cards, random);
  return pool.slice(0, Math.min(maximum, pool.length)).map(card => {
    const type = random() > 0.5 ? 'en-to-vi' as const : 'vi-to-en' as const;
    const answerFor = (candidate: CardData) => type === 'en-to-vi' ? candidate.translation : candidate.word;
    const correctAnswer = answerFor(card);
    const decoys = shuffled(cards.filter(candidate => candidate.id !== card.id), random)
      .map(answerFor)
      .filter((answer, index, values) => answer !== correctAnswer && values.indexOf(answer) === index)
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
