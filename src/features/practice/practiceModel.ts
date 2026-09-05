import { normalizeCardWord } from '../../lib/cardIdentity';
import type { CardData } from '../../types/card';

export interface QuizQuestion {
  card: CardData;
  type: 'en-to-vi' | 'vi-to-en';
  options: string[];
  correctAnswer: string;
}

export function eligibleWordMatchCards(cards: readonly CardData[]): CardData[] {
  const candidates = cards
    .map(card => ({
      card,
      word: card.word.trim(),
      translation: card.translation.trim(),
    }))
    .filter(candidate => candidate.word && candidate.translation)
    .map(candidate => ({
      ...candidate,
      wordKey: normalizeCardWord(candidate.word),
      translationKey: normalizeCardWord(candidate.translation),
    }))
    .filter(candidate => candidate.wordKey && candidate.translationKey && candidate.wordKey !== candidate.translationKey);
  const wordCounts = new Map<string, number>();
  const translationCounts = new Map<string, number>();
  candidates.forEach(({ wordKey, translationKey }) => {
    wordCounts.set(wordKey, (wordCounts.get(wordKey) ?? 0) + 1);
    translationCounts.set(translationKey, (translationCounts.get(translationKey) ?? 0) + 1);
  });
  return candidates
    .filter(
      ({ wordKey, translationKey }) =>
        wordCounts.get(wordKey) === 1 && translationCounts.get(translationKey) === 1,
    )
    .map(({ card, word, translation }) => ({ ...card, word, translation }));
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

export function createPracticeSnapshot(
  cards: readonly CardData[],
  maximum = 50,
  random: () => number = Math.random,
): CardData[] {
  return shuffled(cards.slice(0, Math.max(0, maximum)), random);
}
