import type { CardData } from '../types/card';

export type RecallMode = 'adaptive' | 'en-to-vi' | 'vi-to-en' | 'image-to-word' | 'listen-to-word' | 'cloze';
type ResolvedRecallMode = Exclude<RecallMode, 'adaptive'>;

export interface RecallPrompt {
  instruction: string;
  promptText: string;
  answer: string;
  supportingText: string;
  showImage: boolean;
  playAudio: boolean;
}

export function resolveRecallMode(card: CardData, mode: RecallMode): ResolvedRecallMode {
  if (mode !== 'adaptive') return mode;
  const streak = card.correctStreak || 0;
  if (streak >= 3) return 'cloze';
  if (streak === 2) return 'listen-to-word';
  if (streak === 1) return 'vi-to-en';
  return 'en-to-vi';
}

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function normalizeRecallAnswer(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}\s'-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function editDistance(left: string, right: string): number {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[right.length];
}

export function isRecallAnswerCorrect(input: string, expectedAnswer: string): boolean {
  const normalizedInput = normalizeRecallAnswer(input);
  if (!normalizedInput) return false;
  const alternatives = expectedAnswer
    .split(/[\/;,|]/)
    .map(normalizeRecallAnswer)
    .filter(Boolean);
  return alternatives.some(answer => (
    normalizedInput === answer
    || (answer.length >= 5 && editDistance(normalizedInput, answer) <= 1)
  ));
}

export function buildRecallPrompt(card: CardData, mode: RecallMode): RecallPrompt {
  const resolvedMode = resolveRecallMode(card, mode);
  if (resolvedMode === 'cloze') {
    const source = card.exampleSentence || card.explanation || 'Complete the missing vocabulary word.';
    const promptText = source.replace(new RegExp(`\\b${escapeRegExp(card.word)}\\b`, 'gi'), '_____');
    return {
      instruction: 'Complete the missing word',
      promptText: promptText.includes('_____') ? promptText : `${promptText}: _____`,
      answer: card.word,
      supportingText: card.translation,
      showImage: false,
      playAudio: false,
    };
  }
  if (resolvedMode === 'vi-to-en') {
    return {
      instruction: 'Recall the English word',
      promptText: card.translation || 'Translate this meaning',
      answer: card.word,
      supportingText: card.phonetic,
      showImage: false,
      playAudio: false,
    };
  }

  if (resolvedMode === 'image-to-word') {
    return {
      instruction: 'Name what you see',
      promptText: 'Visual recall',
      answer: card.word,
      supportingText: card.translation,
      showImage: true,
      playAudio: false,
    };
  }

  if (resolvedMode === 'listen-to-word') {
    return {
      instruction: 'Listen and recall the spelling',
      promptText: 'Audio recall',
      answer: card.word,
      supportingText: card.translation,
      showImage: false,
      playAudio: true,
    };
  }

  return {
    instruction: 'Recall the Vietnamese meaning',
    promptText: card.word,
    answer: card.translation,
    supportingText: card.explanation,
    showImage: false,
    playAudio: false,
  };
}
