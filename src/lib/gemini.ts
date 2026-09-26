import { withTimeout } from './async';
import { app, auth, protectedFunctionsCapability } from './firebase';
import { ProtectedFunctionError, runProtectedFunction } from './protectedFunctionsCapability';
import { parseStoryInfo, parseWordInfo, type StoryInfo, type WordInfo } from './wordInfo';

const AI_ATTEMPT_TIMEOUT_MS = 65_000;
const AI_MAX_ATTEMPTS = 2;
const AI_TOTAL_TIMEOUT_MS = 130_500;
const protectedOperationLabel = {
  word: 'AI generation',
  story: 'Story generation',
  translate: 'Translation',
} as const;

const callProductionAI = async <T,>(action: 'word' | 'story' | 'translate', input: unknown, operationId?: string): Promise<T> => {
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
    const callable = httpsCallable<{ action: string; input: unknown; operationId?: string }, { result: T }>(functions, 'generateVocabulary');
    const response = await callable({ action, input, ...(operationId ? { operationId } : {}) });
    return response.data.result;
  });
};

export const withNetworkRetry = async <T>(operation: () => Promise<T>): Promise<T> => {
  let expired = false;
  const retry = async (): Promise<T> => {
    let lastError: unknown;
    let ordinaryRetries = 0;
    for (let attempt = 0; attempt < 12 && !expired; attempt += 1) {
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
        const inFlight = error instanceof ProtectedFunctionError && error.retryAfterMs !== undefined;
        if (!isRetryable || attempt === 11 || (!inFlight && ordinaryRetries >= AI_MAX_ATTEMPTS - 1)) break;
        const delay = inFlight ? error.retryAfterMs : 500 * (2 ** ordinaryRetries++);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    throw lastError;
  };
  return withTimeout(retry(), AI_TOTAL_TIMEOUT_MS,
    'The AI service took too long to respond. Your word is still here, so please try again.',
    () => { expired = true; });
};

export const PART_OF_SPEECH_HINTS = [
  'noun', 'verb', 'adjective', 'adverb', 'pronoun', 'preposition', 'conjunction',
  'determiner', 'interjection', 'phrasal verb', 'auxiliary verb', 'modal verb',
  'article', 'numeral', 'idiom', 'phrase',
] as const;

export type PartOfSpeechHint = typeof PART_OF_SPEECH_HINTS[number];

export interface WordGenerationOptions {
  operationId?: string;
  context?: string;
  sourceLanguage?: string;
  targetLanguage?: string;
  partOfSpeech?: PartOfSpeechHint;
}

const languageCode = (value: unknown, fallback: string): string => {
  const candidate = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return /^[a-z]{2,8}(?:-[a-z]{2,8})?$/.test(candidate) ? candidate : fallback;
};

export async function generateWordInfo(word: string, options: WordGenerationOptions = {}): Promise<WordInfo> {
  const operationId = options.operationId ?? globalThis.crypto.randomUUID();
  const safeWord = word.trim().slice(0, 80);
  const context = typeof options.context === 'string'
    ? options.context.replace(/\s+/g, ' ').trim().slice(0, 500)
    : '';
  const hasStructuredInput = Boolean(
    context || options.sourceLanguage || options.targetLanguage || options.partOfSpeech,
  );
  const input = hasStructuredInput ? {
    term: safeWord,
    language: {
      source: languageCode(options.sourceLanguage, 'en'),
      target: languageCode(options.targetLanguage, 'vi'),
    },
    ...(context ? { context } : {}),
    ...(options.partOfSpeech ? { partOfSpeech: options.partOfSpeech } : {}),
  } : safeWord;
  return parseWordInfo(await withNetworkRetry(() => callProductionAI<unknown>('word', input, operationId)));
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
