import { withTimeout } from './async';
import { app, auth, protectedFunctionsCapability } from './firebase';
import { ProtectedFunctionError, runProtectedFunction } from './protectedFunctionsCapability';
import {
  parseDialogue,
  parseExtractedWords,
  parseMnemonic,
  parseTutorAnswer,
  type DialogueResult,
  type ExtractedWordItem,
} from './aiFeatureInfo';
import { parseStoryInfo, parseWordInfo, type StoryInfo, type WordInfo } from './wordInfo';

const AI_ATTEMPT_TIMEOUT_MS = 65_000;
const AI_MAX_ATTEMPTS = 2;
const protectedOperationLabel = {
  word: 'AI generation',
  story: 'Story generation',
  translate: 'Translation',
  tutor: 'AI tutor',
  mnemonic: 'AI mnemonic',
  extract: 'Vocabulary extraction',
  dialogue: 'Dialogue generation',
} as const;

const callProductionAI = async <T,>(
  action: 'word' | 'story' | 'translate' | 'tutor' | 'mnemonic' | 'extract' | 'dialogue',
  input: unknown,
): Promise<T> => {
  const operation = protectedOperationLabel[action];
  return runProtectedFunction(protectedFunctionsCapability, operation, async () => {
    const { getFunctions, httpsCallable } = await import('firebase/functions');
    if (!app) {
      throw Object.assign(new Error('Firebase app is unavailable.'), {
        code: 'failed-precondition',
      });
    }
    if (!auth?.currentUser) {
      throw Object.assign(new Error('Authentication is unavailable.'), {
        code: 'unauthenticated',
      });
    }
    const functions = getFunctions(app, 'asia-southeast1');
    const callable = httpsCallable<{ action: string; input: unknown }, { result: T }>(functions, 'generateVocabulary');
    const response = await callable({ action, input });
    return response.data.result;
  });
};

export const withNetworkRetry = async <T>(operation: () => Promise<T>): Promise<T> => {
  let lastError: unknown;
  for (let attempt = 0; attempt < AI_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await withTimeout(
        operation(),
        AI_ATTEMPT_TIMEOUT_MS,
        'The AI service took too long to respond. Your word is still here, so please try again.',
      );
    } catch (error) {
      lastError = error;
      const status = typeof error === 'object' && error !== null && 'status' in error
        ? Number((error as { status?: unknown }).status)
        : 0;
      const isRetryable = error instanceof ProtectedFunctionError
        ? error.retryable
        : error instanceof TypeError || status === 429 || status >= 500;
      if (!isRetryable || attempt === AI_MAX_ATTEMPTS - 1) break;
      await new Promise(resolve => setTimeout(resolve, 500 * (2 ** attempt)));
    }
  }
  throw lastError;
};

export interface WordGenerationOptions {
  context?: string;
  sourceLanguage?: string;
  targetLanguage?: string;
}

const languageCode = (value: unknown, fallback: string): string => {
  const candidate = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return /^[a-z]{2,8}(?:-[a-z]{2,8})?$/.test(candidate) ? candidate : fallback;
};

export async function generateWordInfo(word: string, options: WordGenerationOptions = {}): Promise<WordInfo> {
  const safeWord = word.trim().slice(0, 80);
  const context = typeof options.context === 'string'
    ? options.context.replace(/\s+/g, ' ').trim().slice(0, 500)
    : '';
  const hasStructuredInput = Boolean(context || options.sourceLanguage || options.targetLanguage);
  const input = hasStructuredInput ? {
    term: safeWord,
    language: {
      source: languageCode(options.sourceLanguage, 'en'),
      target: languageCode(options.targetLanguage, 'vi'),
    },
    ...(context ? { context } : {}),
  } : safeWord;
  return parseWordInfo(await withNetworkRetry(() => callProductionAI<unknown>('word', input)));
}

export async function generateStoryContext(words: string[]): Promise<StoryInfo> {
  const safeWords = words.slice(0, 5).map(word => word.trim().slice(0, 80)).filter(Boolean);
  return parseStoryInfo(await withNetworkRetry(() => callProductionAI<unknown>('story', safeWords)));
}

export async function translateText(text: string): Promise<string> {
  const safeText = text.trim().slice(0, 2048);
  const translated = await withNetworkRetry(() => callProductionAI<unknown>('translate', safeText));
  return typeof translated === 'string' ? translated.trim().slice(0, 2048) : '';
}

export interface VocabularyTutorInput {
  word: string;
  translation: string;
  partOfSpeech?: string;
  question: string;
}

export interface VocabularyCardInput {
  word: string;
  translation: string;
  partOfSpeech?: string;
}

const normalizeVocabularyCard = (input: VocabularyCardInput): VocabularyCardInput => {
  const word = input.word.trim().slice(0, 80);
  const translation = input.translation.trim().slice(0, 256);
  const partOfSpeech = input.partOfSpeech?.trim().slice(0, 64);
  if (!word || !translation) throw new Error('A vocabulary card requires word and translation.');
  return { word, translation, ...(partOfSpeech ? { partOfSpeech } : {}) };
};

export async function askVocabularyTutor(input: VocabularyTutorInput): Promise<string> {
  const card = normalizeVocabularyCard(input);
  const question = input.question.trim().slice(0, 500);
  if (!question) throw new Error('A tutor question is required.');
  return parseTutorAnswer(
    await withNetworkRetry(() => callProductionAI<unknown>('tutor', { ...card, question })),
  );
}

export async function generateMnemonic(input: VocabularyCardInput): Promise<string> {
  const card = normalizeVocabularyCard(input);
  return parseMnemonic(await withNetworkRetry(() => callProductionAI<unknown>('mnemonic', card)));
}

export async function extractVocabulary(text: string): Promise<ExtractedWordItem[]> {
  const safeText = text.trim().slice(0, 2_000);
  if (!safeText) throw new Error('Vocabulary text is required.');
  return parseExtractedWords(
    await withNetworkRetry(() => callProductionAI<unknown>('extract', safeText)),
  );
}

export async function generateDialogue(cards: VocabularyCardInput[]): Promise<DialogueResult> {
  const safeCards = cards.slice(0, 5).map(normalizeVocabularyCard).map(({ word, translation }) => ({
    word,
    translation,
  }));
  if (safeCards.length === 0) throw new Error('At least one vocabulary card is required.');
  return parseDialogue(
    await withNetworkRetry(() => callProductionAI<unknown>('dialogue', safeCards)),
  );
}
