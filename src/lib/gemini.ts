import { withTimeout } from './async';
import { app, auth, getSonFlashFunctions, protectedFunctionsCapability } from './firebase';
import { ProtectedFunctionError, runProtectedFunction } from './protectedFunctionsCapability';
import {
  parseDialogue,
  parseExtractedWords,
  parseMnemonic,
  parseTextConversationResponse,
  parseTutorAnswer,
  type DialogueResult,
  type ExtractedWordItem,
} from './aiFeatureInfo';
import { parseStoryInfo, parsePlainStoryInfo, parseWordInfo, type PlainStoryInfo, type StoryInfo, type WordInfo } from './wordInfo';
import {
  TEXT_CONVERSATION_LIMITS,
  type TextConversationRequestV1,
  type TextConversationResponseV1,
} from '../features/conversation/textConversationModel';

const AI_ATTEMPT_TIMEOUT_MS = 65_000;
const AI_MAX_ATTEMPTS = 2;
const AI_TOTAL_TIMEOUT_MS = 130_500;
const protectedOperationLabel = {
  word: 'AI generation',
  story: 'Story generation',
  translate: 'Translation',
  tutor: 'AI tutor',
  mnemonic: 'AI mnemonic',
  extract: 'Vocabulary extraction',
  dialogue: 'Dialogue generation',
  conversation: 'Text conversation',
} as const;

export type WordGenerationProgress = {
  operationId: string;
  stage: 'reserving' | 'drafting' | 'field' | 'done' | 'error';
  field?: string;
  value?: unknown;
  errorReason?: string;
  result?: unknown;
};

const callProductionAI = async <T,>(
  action: keyof typeof protectedOperationLabel, input: unknown, expectedOwnerId: string | null = auth?.currentUser?.uid ?? null,
  operationId?: string,
  onProgress?: (progress: WordGenerationProgress) => void,
  signal?: AbortSignal,
): Promise<T> => {
  const operation = protectedOperationLabel[action];
  return runProtectedFunction(protectedFunctionsCapability, operation, async () => {
    const { httpsCallable } = await import('firebase/functions');
    if (!app) {
      throw Object.assign(new Error('Firebase app is unavailable.'), {
        code: 'failed-precondition',
      });
    }
    if (expectedOwnerId && auth?.currentUser?.uid !== expectedOwnerId) {
      throw new ProtectedFunctionError({ message: 'The AI account changed.', kind: 'authentication', code: 'owner-mismatch', retryable: false });
    }
    if (!expectedOwnerId) {
      throw Object.assign(new Error('Authentication is unavailable.'), {
        code: 'unauthenticated',
      });
    }
    const functions = await getSonFlashFunctions(app);
    if (auth?.currentUser?.uid !== expectedOwnerId) {
      throw new ProtectedFunctionError({ message: 'The AI account changed.', kind: 'authentication', code: 'owner-mismatch', retryable: false });
    }
    const callable = httpsCallable<{
      action: string; input: unknown; expectedOwnerId: string; operationId?: string;
    }, { result: T }>(functions, 'generateVocabulary');
    const request = { action, input, expectedOwnerId, ...(operationId ? { operationId } : {}) };
    if (onProgress && operationId) {
      const { stream, data } = await (signal
        ? callable.stream(request, { signal }) : callable.stream(request));
      for await (const chunk of stream) {
        if (chunk && typeof chunk === 'object' && 'operationId' in chunk
          && chunk.operationId === operationId && 'stage' in chunk
          && (chunk.stage === 'reserving' || chunk.stage === 'drafting' || chunk.stage === 'field'
            || chunk.stage === 'done' || chunk.stage === 'error')) {
          onProgress(chunk as WordGenerationProgress);
        }
      }
      return (await data).result;
    }
    return (await callable(request)).data.result;
  });
};

export const withNetworkRetry = async <T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T> => {
  if (signal?.aborted) throw new DOMException('AI generation cancelled.', 'AbortError');
  let expired = false;
  const retry = async (): Promise<T> => {
    let lastError: unknown;
    let ordinaryRetries = 0;
    for (let attempt = 0; attempt < 12 && !expired && !signal?.aborted; attempt += 1) {
      try {
        return await withTimeout(
          operation(),
          AI_ATTEMPT_TIMEOUT_MS,
          'The AI service took too long to respond. Your word is still here, so please try again.',
        );
      } catch (error) {
        lastError = error;
        if (signal?.aborted) break;
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
  expectedOwnerId?: string;
  context?: string;
  sourceLanguage?: string;
  targetLanguage?: string;
  partOfSpeech?: PartOfSpeechHint;
  onProgress?: (progress: WordGenerationProgress) => void;
  signal?: AbortSignal;
}

const languageCode = (value: unknown, fallback: string): string => {
  const candidate = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return /^[a-z]{2,8}(?:-[a-z]{2,8})?$/.test(candidate) ? candidate : fallback;
};

export async function generateWordInfo(word: string, options: WordGenerationOptions = {}): Promise<WordInfo> {
  const expectedOwnerId = options.expectedOwnerId ?? auth?.currentUser?.uid ?? null;
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
  return parseWordInfo(await withNetworkRetry(() => callProductionAI<unknown>(
    'word', input, expectedOwnerId, operationId, options.onProgress, options.signal,
  ), options.signal));
}

export async function cancelWordInfoGeneration(operationId: string, expectedOwnerId: string): Promise<boolean> {
  return runProtectedFunction(protectedFunctionsCapability, 'AI generation', async () => {
    if (!app || auth?.currentUser?.uid !== expectedOwnerId) throw new Error('The AI account changed.');
    const { httpsCallable } = await import('firebase/functions');
    const functions = await getSonFlashFunctions(app);
    if (auth?.currentUser?.uid !== expectedOwnerId) throw new Error('The AI account changed.');
    const cancel = httpsCallable<{ operationId: string; expectedOwnerId: string }, { cancelled: boolean }>(functions, 'cancelCardGeneration');
    return (await cancel({ operationId, expectedOwnerId })).data.cancelled;
  });
}

export interface CardTutorTurn { question: string; answer: string }

export async function askCardTutor(
  cardId: string,
  question: string,
  history: CardTutorTurn[],
  signal?: AbortSignal,
): Promise<string> {
  const expectedOwnerId = auth?.currentUser?.uid ?? null;
  return runProtectedFunction(protectedFunctionsCapability, 'AI tutor', async () => {
    if (!app || !auth?.currentUser || !expectedOwnerId) throw new Error('Sign in to use AI tutor.');
    const { httpsCallable } = await import('firebase/functions');
    const functions = await getSonFlashFunctions(app);
    const callable = httpsCallable<
      { cardId: string; question: string; history: CardTutorTurn[]; expectedOwnerId: string },
      { answer: string }
    >(functions, 'askCardTutor');
    const request = { cardId, question, history: history.slice(-3), expectedOwnerId };
    const { data } = await (signal ? callable.stream(request, { signal }) : callable.stream(request));
    const answer = (await data)?.answer;
    if (typeof answer !== 'string' || !answer.trim()) throw new Error('AI tutor returned an empty answer.');
    return answer.trim();
  });
}

export interface StoryGenerationOptions {
  targetLanguage: 'en' | 'ko' | 'ja' | 'zh';
  translationLanguage: 'vi' | 'en';
}

export function generateStoryContext(words: string[], options: StoryGenerationOptions, ownerId?: string | null): Promise<PlainStoryInfo>;
export function generateStoryContext(words: string[], expectedOwnerId?: string | null): Promise<StoryInfo>;
export async function generateStoryContext(
  words: string[], optionsOrOwner?: StoryGenerationOptions | string | null, capturedOwnerId?: string | null,
): Promise<StoryInfo | PlainStoryInfo> {
  const options = typeof optionsOrOwner === 'object' && optionsOrOwner !== null ? optionsOrOwner : undefined;
  const expectedOwnerId = typeof optionsOrOwner === 'string' || optionsOrOwner === null
    ? optionsOrOwner : capturedOwnerId ?? auth?.currentUser?.uid ?? null;
  const safeWords = words.slice(0, 5).map(word => word.trim().slice(0, 80)).filter(Boolean);
  const input = options ? { words: safeWords, ...options } : { schemaVersion: 2, words: safeWords };
  const result = await withNetworkRetry(() => callProductionAI<unknown>('story', input, expectedOwnerId));
  return options ? parsePlainStoryInfo(result) : parseStoryInfo(result, safeWords);
}

export async function translateText(text: string): Promise<string> {
  const expectedOwnerId = auth?.currentUser?.uid ?? null;
  const safeText = text.trim().slice(0, 2048);
  const translated = await withNetworkRetry(() => callProductionAI<unknown>('translate', safeText, expectedOwnerId));
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

export async function extractVocabulary(text: string, language?: { targetLanguage: string; translationLanguage: string }, expectedOwnerId?: string | null): Promise<ExtractedWordItem[]> {
  const safeText = text.trim().slice(0, 2_000);
  if (!safeText) throw new Error('Vocabulary text is required.');
  return parseExtractedWords(
    await withNetworkRetry(() => callProductionAI<unknown>('extract', language ? { text: safeText, ...language } : safeText, expectedOwnerId)),
  );
}

export async function generateDialogue(
  cards: VocabularyCardInput[],
  expectedOwnerId?: string | null,
): Promise<DialogueResult> {
  const safeCards = cards.slice(0, 5).map(normalizeVocabularyCard).map(({ word, translation }) => ({
    word,
    translation,
  }));
  if (safeCards.length === 0) throw new Error('At least one vocabulary card is required.');
  return parseDialogue(
    await withNetworkRetry(() => callProductionAI<unknown>('dialogue', safeCards, expectedOwnerId)),
  );
}

export async function sendTextConversationTurn(
  input: TextConversationRequestV1,
  expectedOwnerId?: string | null,
): Promise<TextConversationResponseV1> {
  const safeInput = {
    sessionId: input.sessionId,
    mission: {
      schemaVersion: input.mission.schemaVersion,
      id: input.mission.id,
      title: input.mission.title,
      goal: input.mission.goal,
      cards: input.mission.cards.map(({ id, word, translation }) => ({ id, word, translation })),
    },
    turn: input.turn,
    history: input.history.map(({ role, text }) => ({ role, text })),
    userMessage: input.userMessage,
  };
  const response = parseTextConversationResponse(
    await withNetworkRetry(() => callProductionAI<unknown>('conversation', safeInput, expectedOwnerId)),
  );
  return input.turn >= TEXT_CONVERSATION_LIMITS.maximumTurns
    ? { ...response, sessionComplete: true }
    : response;
}
