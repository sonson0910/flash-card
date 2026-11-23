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

type WordGenerationServerStage = 'reserving' | 'drafting' | 'field' | 'done' | 'error';

/**
 * Progress of one word generation. The server sends the first five stages. `retrying` is emitted
 * on this device before an automatic retry of the same operation, and `finding-image` is set by
 * the card creator after the text is complete; the server never sends either.
 */
export type WordGenerationProgress = {
  operationId: string;
  stage: WordGenerationServerStage | 'retrying' | 'finding-image';
  field?: string;
  value?: unknown;
  errorReason?: string;
  result?: unknown;
};

const WORD_GENERATION_SERVER_STAGES: readonly string[] = ['reserving', 'drafting', 'field', 'done', 'error'] satisfies readonly WordGenerationServerStage[];

/** The server refuses a fourth attempt of one operation; a new operation is charged again. */
export const WORD_ATTEMPTS_EXHAUSTED_REASON = 'operation-attempts-exhausted';

const attemptsExhaustedError = (error: unknown): ProtectedFunctionError | null => {
  if (!error || typeof error !== 'object' || error instanceof ProtectedFunctionError) return null;
  const rawCode = (error as { code?: unknown }).code;
  const code = typeof rawCode === 'string' ? rawCode.trim().toLowerCase().replace(/^functions\//, '') : '';
  const details = (error as { details?: unknown }).details;
  const reason = details && typeof details === 'object' ? (details as { reason?: unknown }).reason : undefined;
  if (code !== 'failed-precondition' || reason !== WORD_ATTEMPTS_EXHAUSTED_REASON) return null;
  return new ProtectedFunctionError({
    message: 'This AI request has used all of its retries. Trying again starts a new request.',
    kind: 'unknown', code, retryable: false, reason: WORD_ATTEMPTS_EXHAUSTED_REASON,
  });
};

/**
 * The last packet of a word stream that failed after some fields had already been sent. The server
 * ends with it instead of an error line because the callable client drops stream messages it has
 * not handed out yet when it reads an error line, which would lose fields that just arrived.
 */
type WordStreamFailure = { failure: { code?: unknown; message?: unknown; details?: unknown } };

const callableResult = <T,>(payload: { result: T } | WordStreamFailure): T => {
  if (!payload || typeof payload !== 'object' || !('failure' in payload)) return (payload as { result: T }).result;
  const failure = payload.failure && typeof payload.failure === 'object' ? payload.failure : {};
  const code = typeof failure.code === 'string' && failure.code ? failure.code : 'internal';
  const message = typeof failure.message === 'string' && failure.message ? failure.message : 'INTERNAL';
  // Shaped like the callable client's own error, so classification and automatic retries treat it the same way.
  throw Object.assign(new Error(message), {
    name: 'FirebaseError',
    code: `functions/${code}`,
    ...(failure.details === undefined ? {} : { details: failure.details }),
  });
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
    }, { result: T } | WordStreamFailure>(functions, 'generateVocabulary');
    const request = { action, input, expectedOwnerId, ...(operationId ? { operationId } : {}) };
    try {
      if (onProgress && operationId) {
        const { stream, data } = await (signal
          ? callable.stream(request, { signal }) : callable.stream(request));
        for await (const chunk of stream) {
          if (chunk && typeof chunk === 'object' && 'operationId' in chunk
            && chunk.operationId === operationId && 'stage' in chunk
            && typeof chunk.stage === 'string' && WORD_GENERATION_SERVER_STAGES.includes(chunk.stage)) {
            onProgress(chunk as WordGenerationProgress);
          }
        }
        return callableResult(await data);
      }
      return callableResult((await callable(request)).data);
    } catch (error) {
      throw attemptsExhaustedError(error) ?? error;
    }
  });
};

export const withNetworkRetry = async <T>(
  operation: () => Promise<T>,
  signal?: AbortSignal,
  onRetry?: () => void,
): Promise<T> => {
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
        try { onRetry?.(); } catch { /* A progress observer cannot stop the retry. */ }
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
  const onProgress = options.onProgress;
  return parseWordInfo(await withNetworkRetry(() => callProductionAI<unknown>(
    'word', input, expectedOwnerId, operationId, onProgress, options.signal,
  ), options.signal, onProgress ? () => onProgress({ operationId, stage: 'retrying' }) : undefined));
}

/**
 * Stops a word generation on the server. Resolves true when the request was refunded, false when
 * it still counts (part of the card had reached the learner, or it had finished), and null when
 * the server's answer does not say.
 */
export async function cancelWordInfoGeneration(operationId: string, expectedOwnerId: string): Promise<boolean | null> {
  return runProtectedFunction(protectedFunctionsCapability, 'AI generation', async () => {
    if (!app || auth?.currentUser?.uid !== expectedOwnerId) throw new Error('The AI account changed.');
    const { httpsCallable } = await import('firebase/functions');
    const functions = await getSonFlashFunctions(app);
    if (auth?.currentUser?.uid !== expectedOwnerId) throw new Error('The AI account changed.');
    const cancel = httpsCallable<
      { operationId: string; expectedOwnerId: string },
      { cancelled?: unknown; counted?: unknown }
    >(functions, 'cancelCardGeneration');
    const { cancelled, counted } = (await cancel({ operationId, expectedOwnerId })).data ?? {};
    if (typeof counted === 'boolean') return !counted;
    return cancelled === true ? true : null;
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
    // The callable accepts only question and answer per turn; callers may carry display fields.
    const turns = history.slice(-3).map(({ question: asked, answer }) => ({ question: asked, answer }));
    const request = { cardId, question, history: turns, expectedOwnerId };
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
