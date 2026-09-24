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

export interface RecallPromptCopy {
  missingVocabularyWord: string;
  completeMissingWord: string;
  recallEnglishWord: string;
  translateMeaning: string;
  nameWhatYouSee: string;
  visualRecall: string;
  listenAndRecallSpelling: string;
  audioRecall: string;
  recallVietnameseMeaning: string;
}

const defaultRecallCopy: RecallPromptCopy = {
  missingVocabularyWord: 'Complete the missing vocabulary word.',
  completeMissingWord: 'Complete the missing word',
  recallEnglishWord: 'Recall the English word',
  translateMeaning: 'Translate this meaning',
  nameWhatYouSee: 'Name what you see',
  visualRecall: 'Visual recall',
  listenAndRecallSpelling: 'Listen and recall the spelling',
  audioRecall: 'Audio recall',
  recallVietnameseMeaning: 'Recall the Vietnamese meaning',
};

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

export function buildRecallPrompt(card: CardData, mode: RecallMode, copy: RecallPromptCopy = defaultRecallCopy): RecallPrompt {
  const resolvedMode = resolveRecallMode(card, mode);
  if (resolvedMode === 'cloze') {
    const source = card.exampleSentence || card.explanation || copy.missingVocabularyWord;
    const promptText = source.replace(
      new RegExp(`(^|[^\\p{L}\\p{N}_])${escapeRegExp(card.word)}(?=$|[^\\p{L}\\p{N}_])`, 'giu'),
      '$1_____',
    );
    return {
      instruction: copy.completeMissingWord,
      promptText: promptText.includes('_____') ? promptText : `${promptText}: _____`,
      answer: card.word,
      supportingText: card.translation,
      showImage: false,
      playAudio: false,
    };
  }
  if (resolvedMode === 'vi-to-en') {
    return {
      instruction: copy.recallEnglishWord,
      promptText: card.translation || copy.translateMeaning,
      answer: card.word,
      supportingText: card.phonetic,
      showImage: false,
      playAudio: false,
    };
  }

  if (resolvedMode === 'image-to-word') {
    return {
      instruction: copy.nameWhatYouSee,
      promptText: copy.visualRecall,
      answer: card.word,
      supportingText: card.translation,
      showImage: true,
      playAudio: false,
    };
  }

  if (resolvedMode === 'listen-to-word') {
    return {
      instruction: copy.listenAndRecallSpelling,
      promptText: copy.audioRecall,
      answer: card.word,
      supportingText: card.translation,
      showImage: false,
      playAudio: true,
    };
  }

  return {
    instruction: copy.recallVietnameseMeaning,
    promptText: card.word,
    answer: card.translation,
    supportingText: card.explanation,
    showImage: false,
    playAudio: false,
  };
}
