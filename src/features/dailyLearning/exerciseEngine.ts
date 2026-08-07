import type { CardData } from '../../types/card';
import { isSupportedAudioUrl } from '../../lib/mediaUrlPolicy';
import {
  inferScriptScoringPolicy,
  scoreScriptAnswer,
  type ScriptScore,
  type ScriptScoringPolicy,
} from './scriptScoring';

export type ExerciseMode =
  | 'recognition'
  | 'active-recall'
  | 'listening'
  | 'spelling'
  | 'cloze'
  | 'sentence-building';

interface ExerciseBase {
  readonly cardId: string;
  readonly prompt: string;
  readonly promptLanguage: 'en' | 'vi';
  readonly instruction: string;
  readonly fallbackFrom?: ExerciseMode;
}

interface TypedExercise extends ExerciseBase {
  readonly mode: 'active-recall' | 'listening' | 'spelling' | 'cloze';
  readonly answer: string;
  readonly scoringPolicy: ScriptScoringPolicy;
  readonly audioUrl?: string;
}

export interface RecognitionExercise extends ExerciseBase {
  readonly mode: 'recognition';
  readonly answer: string;
  readonly options: readonly string[];
}

export interface SentenceToken {
  readonly id: string;
  readonly text: string;
}

export interface SentenceBuildingExercise extends ExerciseBase {
  readonly mode: 'sentence-building';
  readonly tokens: readonly SentenceToken[];
  readonly answerTokens: readonly SentenceToken[];
}

export type Exercise = TypedExercise | RecognitionExercise | SentenceBuildingExercise;
export type ExerciseAnswer = string | readonly string[];
export type ExerciseEvaluation = Pick<ScriptScore, 'correct'> & Partial<Omit<ScriptScore, 'correct'>>;

const MODE_ORDER: readonly ExerciseMode[] = [
  'recognition', 'active-recall', 'listening', 'spelling', 'cloze', 'sentence-building',
];
const MAXIMUM_PROMPT_LENGTH = 2_048;
const MAXIMUM_SENTENCE_TOKENS = 16;
const MINIMUM_SENTENCE_TOKENS = 3;

const bounded = (value: string, fallback: string): string => (value.trim() || fallback).slice(0, MAXIMUM_PROMPT_LENGTH);
const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const promptKey = (value: string): string => value.normalize('NFKC').toLocaleLowerCase()
  .replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/gu, ' ').trim();
const promptWithoutAnswer = (value: string, answer: string, fallback: string): string => {
  const prompt = bounded(value, fallback);
  const normalizedPrompt = promptKey(prompt);
  const normalizedAnswer = promptKey(answer);
  return normalizedAnswer && normalizedPrompt.includes(normalizedAnswer) ? fallback : prompt;
};
const stableHash = (value: string): number => {
  let hash = 0;
  for (const character of value) hash = ((hash * 31) + (character.codePointAt(0) ?? 0)) >>> 0;
  return hash;
};
const rotate = <T>(values: readonly T[], offset: number): readonly T[] => {
  if (values.length < 2) return [...values];
  const pivot = ((offset % values.length) + values.length) % values.length;
  return [...values.slice(pivot), ...values.slice(0, pivot)];
};

const distinctRecognitionOptions = (card: CardData, pool: readonly CardData[]): readonly string[] => {
  const candidates = [card, ...pool]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map(candidate => candidate.translation.trim())
    .filter(Boolean);
  const unique = new Map<string, string>();
  for (const candidate of candidates) {
    const key = candidate.normalize('NFKC').toLocaleLowerCase();
    if (!unique.has(key)) unique.set(key, candidate);
  }
  const correct = card.translation.trim();
  const distractors = [...unique.values()].filter(value => value.normalize('NFKC').toLocaleLowerCase()
    !== correct.normalize('NFKC').toLocaleLowerCase());
  if (!correct || distractors.length < 3 || promptKey(card.word) === promptKey(correct)) return [];
  const options = [correct, ...distractors.slice(0, 3)];
  return rotate(options, stableHash(card.id) % options.length);
};

const clozePrompt = (card: CardData): string | null => {
  const sentence = card.exampleSentence?.trim();
  const answer = card.word.trim();
  if (!sentence || !answer) return null;
  const usesUnsegmentedScript = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(answer);
  const pattern = usesUnsegmentedScript
    ? escapeRegExp(answer)
    : `(?<![\\p{L}\\p{N}])${escapeRegExp(answer)}(?![\\p{L}\\p{N}])`;
  const result = sentence.replace(new RegExp(pattern, 'giu'), '_____');
  return result === sentence ? null : bounded(result, 'Complete the missing vocabulary item: _____');
};

const sentenceTokens = (card: CardData): readonly SentenceToken[] => {
  const raw = card.exampleSentence?.trim().split(/\s+/u).filter(Boolean) ?? [];
  if (raw.length < MINIMUM_SENTENCE_TOKENS || raw.length > MAXIMUM_SENTENCE_TOKENS) return [];
  return raw.map((text, index) => ({ id: `${card.id}:${index}`, text }));
};

export function getEligibleExerciseModes(card: CardData, pool: readonly CardData[]): readonly ExerciseMode[] {
  const eligible = new Set<ExerciseMode>(['active-recall', 'spelling']);
  if (distinctRecognitionOptions(card, pool).length === 4) eligible.add('recognition');
  if (isSupportedAudioUrl(card.audioUrl)) eligible.add('listening');
  if (clozePrompt(card)) eligible.add('cloze');
  if (sentenceTokens(card).length > 0) eligible.add('sentence-building');
  return MODE_ORDER.filter(mode => eligible.has(mode));
}

const activeRecall = (
  card: CardData,
  scoringPolicy: ScriptScoringPolicy,
  fallbackFrom?: ExerciseMode,
): TypedExercise => {
  const fallbackPrompt = 'Recall this vocabulary item from its context';
  const prompt = promptWithoutAnswer(card.translation, card.word, fallbackPrompt);
  return {
    mode: 'active-recall', cardId: card.id,
    instruction: 'Type the vocabulary item for this meaning', prompt,
    promptLanguage: prompt === fallbackPrompt ? 'en' : 'vi',
    answer: card.word, scoringPolicy,
    ...(fallbackFrom ? { fallbackFrom } : {}),
  };
};

export function buildExercise(
  card: CardData,
  pool: readonly CardData[],
  requestedMode: ExerciseMode,
  scoringPolicy?: ScriptScoringPolicy,
): Exercise {
  const resolvedScoringPolicy = scoringPolicy ?? inferScriptScoringPolicy(card.word);
  const eligible = getEligibleExerciseModes(card, pool);
  if (!eligible.includes(requestedMode)) return activeRecall(card, resolvedScoringPolicy, requestedMode);

  if (requestedMode === 'recognition') {
    return {
      mode: 'recognition', cardId: card.id,
      instruction: 'Choose the matching meaning', prompt: bounded(card.word, 'Choose the correct meaning'),
      promptLanguage: 'en',
      answer: card.translation.trim(), options: distinctRecognitionOptions(card, pool),
    };
  }
  if (requestedMode === 'listening') {
    return {
      mode: 'listening', cardId: card.id, instruction: 'Listen and type what you hear',
      prompt: 'Audio prompt', promptLanguage: 'en', answer: card.word, scoringPolicy: resolvedScoringPolicy, audioUrl: card.audioUrl ?? undefined,
    };
  }
  if (requestedMode === 'spelling') {
    const fallbackPrompt = 'Spell the vocabulary item from its context';
    const prompt = promptWithoutAnswer(card.translation, card.word, fallbackPrompt);
    return {
      mode: 'spelling', cardId: card.id, instruction: 'Spell the vocabulary item',
      prompt, promptLanguage: prompt === fallbackPrompt ? 'en' : 'vi',
      answer: card.word, scoringPolicy: resolvedScoringPolicy,
    };
  }
  if (requestedMode === 'cloze') {
    return {
      mode: 'cloze', cardId: card.id, instruction: 'Complete the missing vocabulary item',
      prompt: clozePrompt(card)!, promptLanguage: 'en', answer: card.word, scoringPolicy: resolvedScoringPolicy,
    };
  }
  if (requestedMode === 'sentence-building') {
    const answerTokens = sentenceTokens(card);
    const fallbackPrompt = 'Build the sentence in the correct order';
    const prompt = bounded(card.exampleTranslation ?? fallbackPrompt, 'Build the sentence');
    return {
      mode: 'sentence-building', cardId: card.id, instruction: 'Put the sentence in order',
      prompt, promptLanguage: prompt === fallbackPrompt || prompt === 'Build the sentence' ? 'en' : 'vi',
      answerTokens,
      tokens: rotate(answerTokens, 1 + (stableHash(card.id) % Math.max(1, answerTokens.length - 1))),
    };
  }
  return activeRecall(card, resolvedScoringPolicy);
}

export function evaluateExerciseAnswer(exercise: Exercise, answer: ExerciseAnswer): ExerciseEvaluation {
  if (exercise.mode === 'sentence-building') {
    if (!Array.isArray(answer)) return { correct: false };
    const expected = exercise.answerTokens.map(token => token.id);
    return { correct: expected.length === answer.length && expected.every((id, index) => id === answer[index]) };
  }
  if (typeof answer !== 'string') return { correct: false };
  if (exercise.mode === 'recognition') {
    return { correct: exercise.answer.normalize('NFKC').trim() === answer.normalize('NFKC').trim() };
  }
  return scoreScriptAnswer(exercise.answer, answer, exercise.scoringPolicy);
}
