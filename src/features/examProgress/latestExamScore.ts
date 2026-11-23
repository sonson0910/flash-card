import { doc, getDoc, type Firestore } from 'firebase/firestore';
import { parseIeltsBand } from '../../../functions/src/course-profile-contract';

/**
 * The learner's own latest IELTS score per goal, stored by the server in
 * `users/{ownerId}/profile/exam_scores` as `{ schemaVersion: 1, goals: { [goalId]: { courseId, band, updatedAt } } }`.
 * Only the `setLatestExamScore` callable writes it; the owner reads it.
 */
export const EXAM_SCORES_DOCUMENT_ID = 'exam_scores';
export const SET_LATEST_EXAM_SCORE_CALLABLE = 'setLatestExamScore';

export interface LatestExamScoreTarget {
  readonly ownerId: string;
  readonly courseId: string;
  readonly goalId: string;
}

export interface LatestExamScoreRequest extends LatestExamScoreTarget {
  /** A band from 4.0 to 9.0 in half steps, or null to clear the score. */
  readonly latestScore: string | null;
}

export type LatestExamScoreErrorCode = 'invalid' | 'goal-missing' | 'rate-limited' | 'unavailable' | 'failed';

export class LatestExamScoreError extends Error {
  constructor(readonly code: LatestExamScoreErrorCode, options?: { cause?: unknown }) {
    super(`The latest exam score could not be saved (${code}).`, options);
    this.name = 'LatestExamScoreError';
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => (
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)
);

/**
 * Reads one goal's score from the stored document tolerantly: anything malformed, or an entry
 * that belongs to another course, reads as no score.
 */
export const parseStoredLatestExamScore = (value: unknown, courseId: string, goalId: string): string | null => {
  if (!isRecord(value) || value.schemaVersion !== 1 || !isRecord(value.goals)) return null;
  if (!Object.prototype.hasOwnProperty.call(value.goals, goalId)) return null;
  const entry = value.goals[goalId];
  if (!isRecord(entry) || entry.courseId !== courseId || typeof entry.band !== 'string') return null;
  return parseIeltsBand(entry.band) === entry.band ? entry.band : null;
};

export async function readLatestExamScore(database: Firestore, target: LatestExamScoreTarget): Promise<string | null> {
  const snapshot = await getDoc(doc(database, 'users', target.ownerId, 'profile', EXAM_SCORES_DOCUMENT_ID));
  return snapshot.exists() ? parseStoredLatestExamScore(snapshot.data(), target.courseId, target.goalId) : null;
}

/** Calls a named callable with a payload and resolves with its response data. */
export type CallableInvoker = (name: string, payload: unknown) => Promise<unknown>;

const errorReason = (error: unknown): string => {
  if (!isRecord(error)) return '';
  if (isRecord(error.details) && typeof error.details.reason === 'string') return error.details.reason;
  return typeof error.code === 'string' ? error.code.replace(/^functions\//, '') : '';
};

const errorCodeFor = (reason: string): LatestExamScoreErrorCode => {
  if (reason === 'invalid-argument') return 'invalid';
  if (reason === 'goal-not-found' || reason === 'course-not-found') return 'goal-missing';
  if (reason === 'resource-exhausted') return 'rate-limited';
  if (reason === 'unavailable' || reason === 'deadline-exceeded') return 'unavailable';
  return 'failed';
};

type Listener = (request: LatestExamScoreRequest) => void;
const listeners = new Set<Listener>();

/** Lets every mounted panel show a score as soon as the server has stored it. */
export const subscribeToLatestExamScores = (listener: Listener): (() => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};

/**
 * Stores or clears the score through the server, which validates it against the owner's goals.
 * Resolves with the canonical score the server stored.
 */
export async function saveLatestExamScore(call: CallableInvoker, request: LatestExamScoreRequest): Promise<string | null> {
  const latestScore = request.latestScore === null ? null : parseIeltsBand(request.latestScore);
  if (request.latestScore !== null && latestScore === null) throw new LatestExamScoreError('invalid');
  let response: unknown;
  try {
    response = await call(SET_LATEST_EXAM_SCORE_CALLABLE, {
      ownerId: request.ownerId, courseId: request.courseId, goalId: request.goalId, latestScore,
    });
  } catch (error) {
    throw new LatestExamScoreError(errorCodeFor(errorReason(error)), { cause: error });
  }
  const stored = isRecord(response) && isRecord(response.latestScore) ? response.latestScore.latestScore : undefined;
  if (stored !== null && (typeof stored !== 'string' || parseIeltsBand(stored) !== stored)) {
    throw new LatestExamScoreError('failed');
  }
  const saved: LatestExamScoreRequest = { ...request, latestScore: stored };
  listeners.forEach(listener => listener(saved));
  return stored;
}
