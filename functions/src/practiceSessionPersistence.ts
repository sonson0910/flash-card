import { createHash } from 'node:crypto';
import type { DocumentSnapshot, Firestore, Transaction } from 'firebase-admin/firestore';
import { FieldValue } from 'firebase-admin/firestore';
import { InputValidationError } from './inputValidation.js';
import { commitVerifiedGamification, prepareVerifiedGamification, type VerifiedGamificationOutcome } from './verifiedGamification.js';

const SESSION_SCHEMA_VERSION = 1;
const MAX_CARDS = 50;
const MAX_TEXT = 256;
const SESSION_TTL_MS = 30 * 60 * 1000;
const ID = /^[A-Za-z0-9:_-]{1,128}$/;

export type PracticeSessionGame = 'quiz' | 'spelling' | 'match';
export type PracticeAnswerPayload = { responses: Record<string, string> } | {
  pairs: Array<{ cardId: string; word: string; translation: string }>;
};

export type StartPracticeSessionV1Request = {
  opId: string;
  game: PracticeSessionGame;
  cardIds: string[];
};

export type CompletePracticeSessionV1Request = {
  sessionId: string;
  completionId: string;
  answers: PracticeAnswerPayload;
  timeZone?: string;
};

type TargetLanguage = 'en' | 'ko' | 'ja' | 'zh';
type SessionCard = { cardId: string; word: string; translation: string; targetLanguage: TargetLanguage };
type QuizChallenge = { kind: 'quiz'; questions: Array<{ cardId: string; prompt: string; options: string[] }> };
type SpellingChallenge = { kind: 'spelling'; prompts: Array<{ cardId: string; prompt: string; word: string }> };
type MatchChallenge = { kind: 'match'; cards: Array<Omit<SessionCard, 'targetLanguage'>> };
export type PracticeSessionChallenge = QuizChallenge | SpellingChallenge | MatchChallenge;
export type StartPracticeSessionV1Response = {
  sessionId: string;
  game: PracticeSessionGame;
  challenge: PracticeSessionChallenge;
  expiresAt: string;
};
export type CompletePracticeSessionV1Response = {
  sessionId: string;
  correct: number;
  total: number;
  awardedXp: number;
  outcome: VerifiedGamificationOutcome;
};

const record = (value: unknown, message: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new InputValidationError(message);
  return value as Record<string, unknown>;
};

const exact = (source: Record<string, unknown>, fields: readonly string[], message: string) => {
  if (Object.keys(source).some(key => !fields.includes(key))) throw new InputValidationError(message);
};

const identifier = (value: unknown, message: string): string => {
  if (typeof value !== 'string' || !ID.test(value)) throw new InputValidationError(message);
  return value;
};

const text = (value: unknown, message: string): string => {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > MAX_TEXT) throw new InputValidationError(message);
  return value.trim();
};

const targetLanguage = (value: unknown): TargetLanguage => {
  const code = typeof value === 'string' ? value.trim().toLowerCase().split('-')[0] : '';
  return code === 'ko' || code === 'ja' || code === 'zh' ? code : 'en';
};

const normalizeSpellingAnswer = (value: string, language: TargetLanguage): string => {
  const normalized = value.normalize('NFKC').trim().replace(/\s+/g, ' ');
  return language === 'en' ? normalized.toLocaleLowerCase('en-US') : normalized;
};

const canonicalJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    return `{${Object.keys(source).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(source[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
};

const fingerprint = (value: unknown) => createHash('sha256').update(canonicalJson(value)).digest('hex');

export function parseStartPracticeSessionV1Request(value: unknown): StartPracticeSessionV1Request {
  const source = record(value, 'Practice session start must be an object.');
  exact(source, ['opId', 'game', 'cardIds'], 'Practice session start contains an unsupported field.');
  const opId = identifier(source.opId, 'Practice session operation ID is invalid.');
  if (source.game !== 'quiz' && source.game !== 'spelling' && source.game !== 'match') {
    throw new InputValidationError('Practice session game is invalid.');
  }
  if (!Array.isArray(source.cardIds) || source.cardIds.length === 0 || source.cardIds.length > MAX_CARDS) {
    throw new InputValidationError('Practice session cards must contain 1 to 50 cards.');
  }
  const cardIds = source.cardIds.map(cardId => identifier(cardId, 'Practice session card ID is invalid.'));
  if (new Set(cardIds).size !== cardIds.length) throw new InputValidationError('Practice session card IDs must be unique.');
  if ((source.game === 'quiz' || source.game === 'match') && cardIds.length < 4) {
    throw new InputValidationError('Practice quiz and match sessions require at least 4 cards.');
  }
  return { opId, game: source.game, cardIds };
}

export function parseCompletePracticeSessionV1Request(value: unknown): CompletePracticeSessionV1Request {
  const source = record(value, 'Practice session completion must be an object.');
  exact(source, ['sessionId', 'completionId', 'answers', 'timeZone'], 'Practice session completion contains an unsupported field.');
  const answers = record(source.answers, 'Practice session answers are invalid.');
  let parsedAnswers: PracticeAnswerPayload;
  if (Object.hasOwn(answers, 'responses')) {
    exact(answers, ['responses'], 'Practice answer responses are invalid.');
    const responses = record(answers.responses, 'Practice answer responses are invalid.');
    parsedAnswers = { responses: Object.fromEntries(Object.entries(responses).map(([cardId, answer]) => [
      identifier(cardId, 'Practice answer card ID is invalid.'), text(answer, 'Practice answer is invalid.'),
    ])) };
  } else {
    exact(answers, ['pairs'], 'Practice match answers are invalid.');
    if (!Array.isArray(answers.pairs) || answers.pairs.length === 0 || answers.pairs.length > MAX_CARDS) {
      throw new InputValidationError('Practice match answers are invalid.');
    }
    const pairs = answers.pairs.map(value => {
      const pair = record(value, 'Practice match pair is invalid.');
      exact(pair, ['cardId', 'word', 'translation'], 'Practice match pair is invalid.');
      return {
        cardId: identifier(pair.cardId, 'Practice answer card ID is invalid.'),
        word: text(pair.word, 'Practice match word is invalid.'),
        translation: text(pair.translation, 'Practice match translation is invalid.'),
      };
    });
    if (new Set(pairs.map(pair => pair.cardId)).size !== pairs.length) throw new InputValidationError('Practice match answers must be unique.');
    parsedAnswers = { pairs };
  }
  const timeZone = source.timeZone === undefined ? undefined : text(source.timeZone, 'Practice reward time zone is invalid.');
  return {
    sessionId: identifier(source.sessionId, 'Practice session ID is invalid.'),
    completionId: identifier(source.completionId, 'Practice completion ID is invalid.'),
    answers: parsedAnswers,
    ...(timeZone === undefined ? {} : { timeZone }),
  };
}

const sessionRef = (database: Firestore, ownerId: string, sessionId: string) =>
  database.collection('users').doc(ownerId).collection('practice_sessions').doc(sessionId);
const cardRef = (database: Firestore, ownerId: string, cardId: string) =>
  database.collection('users').doc(ownerId).collection('cards').doc(cardId);
const validOwner = (ownerId: string) => {
  if (!ownerId || ownerId.includes('/')) throw new InputValidationError('Practice session owner is invalid.');
};
const asDate = (value: unknown): Date | null => {
  if (value instanceof Date) return value;
  if (value && typeof value === 'object' && 'toDate' in value && typeof (value as { toDate?: unknown }).toDate === 'function') {
    const result = (value as { toDate: () => unknown }).toDate();
    return result instanceof Date ? result : null;
  }
  return null;
};
const cardsFromSnapshots = (cardIds: readonly string[], snapshots: readonly DocumentSnapshot[]): SessionCard[] => snapshots.map((snapshot, index) => {
  const data = snapshot.data();
  if (!snapshot.exists || !data) throw new InputValidationError('Practice session card is missing.');
  return {
    cardId: cardIds[index],
    word: text(data.word, 'Practice session card word is invalid.'),
    translation: text(data.translation, 'Practice session card translation is invalid.'),
    targetLanguage: targetLanguage(data.language),
  };
});

const buildChallenge = (game: PracticeSessionGame, cards: SessionCard[]): PracticeSessionChallenge => {
  if (game === 'spelling') return {
    kind: 'spelling',
    prompts: cards.map(card => ({ cardId: card.cardId, prompt: card.translation, word: card.word })),
  };
  if (game === 'match') return {
    kind: 'match',
    cards: cards.map(({ cardId, word, translation }) => ({ cardId, word, translation })),
  };
  return {
    kind: 'quiz',
    questions: cards.map(card => {
      const options = [card.translation, ...cards.filter(candidate => candidate.cardId !== card.cardId).map(candidate => candidate.translation)]
        .filter((value, optionIndex, values) => values.indexOf(value) === optionIndex).slice(0, 4);
      return { cardId: card.cardId, prompt: card.word, options: options.length ? options : [card.translation] };
    }),
  };
};

const startResult = (data: Record<string, unknown>): StartPracticeSessionV1Response | null => {
  const expiresAt = asDate(data.expiresAt);
  const challenge = data.challenge as PracticeSessionChallenge | undefined;
  if (!expiresAt || !challenge || (data.game !== 'quiz' && data.game !== 'spelling' && data.game !== 'match')) return null;
  return { sessionId: String(data.sessionId), game: data.game, challenge, expiresAt: expiresAt.toISOString() };
};

export async function startPracticeSessionV1(
  database: Firestore,
  ownerId: string,
  request: StartPracticeSessionV1Request,
  now = new Date(),
): Promise<StartPracticeSessionV1Response> {
  validOwner(ownerId);
  const parsed = parseStartPracticeSessionV1Request(request);
  if (Number.isNaN(now.getTime())) throw new InputValidationError('Practice session start time is invalid.');
  const session = sessionRef(database, ownerId, parsed.opId);
  const requestFingerprint = fingerprint(parsed);
  try {
    return await database.runTransaction(async transaction => {
      const snapshots = await Promise.all(parsed.cardIds.map(cardId => transaction.get(cardRef(database, ownerId, cardId))));
      const cards = cardsFromSnapshots(parsed.cardIds, snapshots);
      const challenge = buildChallenge(parsed.game, cards);
      const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
      const response: StartPracticeSessionV1Response = { sessionId: parsed.opId, game: parsed.game, challenge, expiresAt: expiresAt.toISOString() };
      transaction.create(session, {
        schemaVersion: SESSION_SCHEMA_VERSION, ownerId, sessionId: parsed.opId, opId: parsed.opId,
        requestFingerprint, game: parsed.game, cardIds: parsed.cardIds, challenge,
        answerKey: cards, status: 'active', createdAt: FieldValue.serverTimestamp(), expiresAt,
      });
      return response;
    });
  } catch (error) {
    // A retry may arrive after the original cards were changed or deleted. The
    // session receipt remains the authority for that operation, so check it
    // after any failed start attempt without adding a read to successful starts.
    const replay = await database.runTransaction(async transaction => transaction.get(session));
    if (!replay.exists) throw error;
    const data = replay.data() ?? {};
    if (data.requestFingerprint !== requestFingerprint) throw new InputValidationError('Practice session operation fingerprint conflicts.');
    const response = startResult(data);
    if (!response) throw new InputValidationError('Practice session replay is invalid.');
    return response;
  }
}

const sessionCards = (data: Record<string, unknown>): SessionCard[] => {
  if (!Array.isArray(data.answerKey) || data.answerKey.length === 0 || data.answerKey.length > MAX_CARDS) {
    throw new InputValidationError('Practice session answer key is invalid.');
  }
  return data.answerKey.map(value => {
    const source = record(value, 'Practice session answer key is invalid.');
    return {
      cardId: identifier(source.cardId, 'Practice session answer key is invalid.'),
      word: text(source.word, 'Practice session answer key is invalid.'),
      translation: text(source.translation, 'Practice session answer key is invalid.'),
      targetLanguage: targetLanguage(source.targetLanguage),
    };
  });
};

const score = (game: PracticeSessionGame, cards: SessionCard[], answers: PracticeAnswerPayload) => {
  if (game === 'match') {
    if (!('pairs' in answers) || answers.pairs.length !== cards.length || !cards.every(card => {
      const pair = answers.pairs.find(candidate => candidate.cardId === card.cardId);
      return pair && pair.word.toLocaleLowerCase('en-US') === card.word.toLocaleLowerCase('en-US')
        && pair.translation.toLocaleLowerCase('en-US') === card.translation.toLocaleLowerCase('en-US');
    })) throw new InputValidationError('Practice match completion is invalid.');
    return { correct: cards.length, total: cards.length, awardedXp: 20 };
  }
  if (!('responses' in answers) || Object.keys(answers.responses).length !== cards.length
    || !cards.every(card => Object.hasOwn(answers.responses, card.cardId))) throw new InputValidationError('Practice answers do not match the session.');
  const correct = cards.filter(card => game === 'quiz'
    ? answers.responses[card.cardId].trim().toLocaleLowerCase('en-US') === card.translation.trim().toLocaleLowerCase('en-US')
    : normalizeSpellingAnswer(answers.responses[card.cardId], card.targetLanguage) === normalizeSpellingAnswer(card.word, card.targetLanguage)).length;
  return { correct, total: cards.length, awardedXp: correct * 5 };
};

const completionResult = (data: Record<string, unknown>): CompletePracticeSessionV1Response | null => {
  const result = data.result;
  if (!result || typeof result !== 'object' || Array.isArray(result)) return null;
  const value = result as Record<string, unknown>;
  if (typeof value.sessionId !== 'string' || !Number.isSafeInteger(value.correct) || !Number.isSafeInteger(value.total)
    || !Number.isSafeInteger(value.awardedXp) || !value.outcome || typeof value.outcome !== 'object') return null;
  return value as unknown as CompletePracticeSessionV1Response;
};

export async function completePracticeSessionV1(
  database: Firestore,
  ownerId: string,
  request: CompletePracticeSessionV1Request,
  now = new Date(),
): Promise<CompletePracticeSessionV1Response> {
  validOwner(ownerId);
  const parsed = parseCompletePracticeSessionV1Request(request);
  if (Number.isNaN(now.getTime())) throw new InputValidationError('Practice session completion time is invalid.');
  const completionFingerprint = fingerprint({
    sessionId: parsed.sessionId,
    completionId: parsed.completionId,
    answers: parsed.answers,
    ...(parsed.timeZone === undefined ? {} : { timeZone: parsed.timeZone }),
  });
  return database.runTransaction(async (transaction: Transaction) => {
    const reference = sessionRef(database, ownerId, parsed.sessionId);
    const snapshot = await transaction.get(reference);
    if (!snapshot.exists) throw new InputValidationError('Practice session is missing.');
    const data = record(snapshot.data(), 'Practice session is invalid.');
    if (data.ownerId !== ownerId || data.sessionId !== parsed.sessionId) throw new InputValidationError('Practice session owner is invalid.');
    if (data.status === 'completed') {
      if (data.completionId !== parsed.completionId || data.completionFingerprint !== completionFingerprint) {
        throw new InputValidationError('Practice session completion fingerprint conflicts.');
      }
      const previous = completionResult(data);
      if (!previous) throw new InputValidationError('Practice session completion is invalid.');
      return previous;
    }
    const expiresAt = asDate(data.expiresAt);
    if (!expiresAt || expiresAt.getTime() <= now.getTime()) throw new InputValidationError('Practice session has expired.');
    if (data.game !== 'quiz' && data.game !== 'spelling' && data.game !== 'match') throw new InputValidationError('Practice session game is invalid.');
    const result = score(data.game, sessionCards(data), parsed.answers);
    const prepared = await prepareVerifiedGamification(database, transaction, ownerId, {
      kind: data.game, receivedAt: now, timeZone: parsed.timeZone, resultXp: result.awardedXp,
    });
    const response: CompletePracticeSessionV1Response = { sessionId: parsed.sessionId, ...result, outcome: commitVerifiedGamification(transaction, prepared) };
    transaction.set(reference, {
      status: 'completed', completionId: parsed.completionId, completionFingerprint, result: response,
      completedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return response;
  });
}
