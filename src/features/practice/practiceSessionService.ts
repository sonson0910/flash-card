import { app as firebaseApp, getSonFlashFunctions, isFirebaseConfigured, protectedFunctionsCapability } from '../../lib/firebase';
import { ProtectedFunctionError, runProtectedFunction } from '../../lib/protectedFunctionsCapability';

export type PracticeSessionGame = 'quiz' | 'spelling' | 'match';
export type PracticeSessionAnswer = { responses: Record<string, string> } | {
  pairs: Array<{ cardId: string; word: string; translation: string }>;
};

export type PracticeGamificationOutcome = {
  xp: number;
  level: number;
  streak: number;
  studyDay: string;
  events: Array<'streak' | 'levelup'>;
};

export type PracticeSessionCard = { cardId: string; word: string; translation: string };
export type PracticeSessionChallenge =
  | { kind: 'quiz'; questions: Array<{ cardId: string; prompt: string; options: string[] }> }
  | { kind: 'spelling'; prompts: Array<{ cardId: string; prompt: string; word: string }> }
  | { kind: 'match'; cards: PracticeSessionCard[] };

export type StartedPracticeSession = {
  sessionId: string;
  game: PracticeSessionGame;
  challenge: PracticeSessionChallenge;
  expiresAt: string;
};

export type CompletedPracticeSession = {
  sessionId: string;
  correct: number;
  total: number;
  awardedXp: number;
  outcome: PracticeGamificationOutcome;
};

export interface PracticeSessionService {
  start(request: { opId: string; game: PracticeSessionGame; cardIds: string[] }): Promise<StartedPracticeSession>;
  complete(request: { sessionId: string; completionId: string; answers: PracticeSessionAnswer; timeZone?: string }): Promise<CompletedPracticeSession>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const nonEmptyText = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const cardId = (value: unknown): value is string => typeof value === 'string' && value.length > 0;

const parseOutcome = (value: unknown): PracticeGamificationOutcome => {
  if (!isRecord(value) || !Number.isSafeInteger(value.xp) || !Number.isSafeInteger(value.level)
    || !Number.isSafeInteger(value.streak) || typeof value.studyDay !== 'string'
    || !Array.isArray(value.events) || value.events.some(event => event !== 'streak' && event !== 'levelup')) {
    throw new Error('The practice service returned an invalid reward outcome.');
  }
  return value as PracticeGamificationOutcome;
};

const parseChallenge = (value: unknown): PracticeSessionChallenge => {
  if (!isRecord(value) || typeof value.kind !== 'string') throw new Error('The practice service returned an invalid challenge.');
  if (value.kind === 'quiz' && Array.isArray(value.questions) && value.questions.length > 0) {
    const questions = value.questions.map(question => {
      if (!isRecord(question) || !cardId(question.cardId) || !nonEmptyText(question.prompt)
        || !Array.isArray(question.options) || question.options.length === 0 || question.options.some(option => !nonEmptyText(option))) {
        throw new Error('The practice service returned an invalid quiz challenge.');
      }
      return { cardId: question.cardId, prompt: question.prompt, options: [...question.options] as string[] };
    });
    return { kind: 'quiz', questions };
  }
  if (value.kind === 'spelling' && Array.isArray(value.prompts) && value.prompts.length > 0) {
    const prompts = value.prompts.map(prompt => {
      if (!isRecord(prompt) || !cardId(prompt.cardId) || !nonEmptyText(prompt.prompt) || !nonEmptyText(prompt.word)) {
        throw new Error('The practice service returned an invalid spelling challenge.');
      }
      return { cardId: prompt.cardId, prompt: prompt.prompt, word: prompt.word };
    });
    return { kind: 'spelling', prompts };
  }
  if (value.kind === 'match' && Array.isArray(value.cards) && value.cards.length > 0) {
    const cards = value.cards.map(card => {
      if (!isRecord(card) || !cardId(card.cardId) || !nonEmptyText(card.word) || !nonEmptyText(card.translation)) {
        throw new Error('The practice service returned an invalid match challenge.');
      }
      return { cardId: card.cardId, word: card.word, translation: card.translation };
    });
    return { kind: 'match', cards };
  }
  throw new Error('The practice service returned an invalid challenge.');
};

const parseStart = (value: unknown): StartedPracticeSession => {
  if (!isRecord(value) || typeof value.sessionId !== 'string' || typeof value.expiresAt !== 'string'
    || !['quiz', 'spelling', 'match'].includes(String(value.game))) {
    throw new Error('The practice service returned an invalid session.');
  }
  const game = value.game as PracticeSessionGame;
  const challenge = parseChallenge(value.challenge);
  if (challenge.kind !== game) throw new Error('The practice service returned a mismatched challenge.');
  return { sessionId: value.sessionId, game, challenge, expiresAt: value.expiresAt };
};

const parseCompletion = (value: unknown): CompletedPracticeSession => {
  if (!isRecord(value) || typeof value.sessionId !== 'string' || !Number.isSafeInteger(value.correct)
    || !Number.isSafeInteger(value.total) || !Number.isSafeInteger(value.awardedXp)) {
    throw new Error('The practice service returned an invalid completion.');
  }
  return { ...value, outcome: parseOutcome(value.outcome) } as CompletedPracticeSession;
};

async function call<T>(name: 'startPracticeSessionV1' | 'completePracticeSessionV1', request: unknown, parse: (value: unknown) => T): Promise<T> {
  if (!isFirebaseConfigured || !firebaseApp) {
    throw new ProtectedFunctionError({
      message: 'Practice is unavailable because protected cloud features are not configured for this build.',
      kind: 'configuration', code: 'firebase-unconfigured', retryable: false,
    });
  }
  return runProtectedFunction(protectedFunctionsCapability, 'Practice session', async () => {
    const { httpsCallable } = await import('firebase/functions');
    const app = firebaseApp;
    if (!app) throw new Error('Firebase is not initialized.');
    const callable = httpsCallable<unknown, unknown>(await getSonFlashFunctions(app), name);
    return parse((await callable(request)).data);
  });
}

export const firebasePracticeSessionService: PracticeSessionService = {
  start: request => call('startPracticeSessionV1', request, parseStart),
  complete: request => call('completePracticeSessionV1', request, parseCompletion),
};

export const practiceTimeZone = (): string | undefined => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
};
