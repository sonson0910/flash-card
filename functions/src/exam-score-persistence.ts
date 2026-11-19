import type { DocumentData, Firestore, Transaction } from 'firebase-admin/firestore';
import {
  assertCourseId,
  assertGoalId,
  assertOwnerId,
  createLegacyCourseProfile,
  CourseProfileValidationError,
  IELTS_GOAL_KIND,
  parseCourseProfile,
  parseIeltsBand,
  type CourseProfile,
} from './course-profile-contract.js';
import {
  CourseProfileConflictError,
  CourseProfileOwnerMismatchError,
  CourseProfileStoredDataError,
} from './course-profile-persistence.js';

/**
 * Latest IELTS scores the learner reports for their IELTS goals, stored beside the course
 * profile because the goal record rejects unknown keys. Only the setLatestExamScore callable
 * writes this document; owners read it.
 *
 * Shape: { schemaVersion: 1, goals: { [goalId]: { courseId, band, updatedAt } } }
 */
export const EXAM_SCORES_DOCUMENT_ID = 'exam_scores';
export const EXAM_SCORES_SCHEMA_VERSION = 1;

export interface LatestExamScore {
  readonly courseId: string;
  readonly band: string;
  readonly updatedAt: string;
}

export interface SetLatestExamScoreRequest {
  readonly ownerId: string;
  readonly courseId: string;
  readonly goalId: string;
  /** Canonical band ("6.5"), or null to clear the stored score. */
  readonly latestScore: string | null;
}

export interface LatestExamScoreResult {
  readonly courseId: string;
  readonly goalId: string;
  readonly latestScore: string | null;
}

const REQUEST_KEYS = ['ownerId', 'courseId', 'goalId', 'latestScore'] as const;
const ENTRY_KEYS = ['courseId', 'band', 'updatedAt'] as const;
const LATEST_SCORE_RULE = 'latestScore: must be an IELTS band from 4.0 to 9.0 in half steps, or null';

const isRecord = (value: unknown): value is Record<string, unknown> => (
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)
);

const hasExactKeys = (source: Record<string, unknown>, expected: readonly string[]): boolean => {
  const keys = Object.keys(source);
  return keys.length === expected.length && keys.every(key => expected.includes(key));
};

/** Parses the callable envelope. Error messages name the field, never the submitted value. */
export const parseSetLatestExamScoreRequest = (value: unknown): SetLatestExamScoreRequest => {
  if (!isRecord(value)) throw new CourseProfileValidationError('Latest exam score request must be an object.');
  if (!hasExactKeys(value, REQUEST_KEYS)) {
    throw new CourseProfileValidationError('Latest exam score request contains an unsupported or missing field.');
  }
  let latestScore: string | null = null;
  if (value.latestScore !== null) {
    latestScore = parseIeltsBand(value.latestScore);
    if (latestScore === null) throw new CourseProfileValidationError(LATEST_SCORE_RULE);
  }
  return {
    ownerId: assertOwnerId(value.ownerId),
    courseId: assertCourseId(value.courseId),
    goalId: assertGoalId(value.goalId),
    latestScore,
  };
};

const storedEntry = (value: unknown): LatestExamScore | null => {
  if (!isRecord(value) || !hasExactKeys(value, ENTRY_KEYS)) return null;
  const { courseId, band, updatedAt } = value;
  if (typeof courseId !== 'string' || typeof band !== 'string' || typeof updatedAt !== 'string') return null;
  if (parseIeltsBand(band) !== band || Number.isNaN(Date.parse(updatedAt))) return null;
  return { courseId, band, updatedAt };
};

/**
 * Reads the stored scores tolerantly: an entry that is malformed, or whose goal no longer exists
 * as an IELTS goal of the same course, is ignored. A wholly malformed document reads as empty.
 */
export const readLatestExamScores = (
  value: unknown,
  profile: CourseProfile,
): Readonly<Record<string, LatestExamScore>> => {
  if (!isRecord(value) || value.schemaVersion !== EXAM_SCORES_SCHEMA_VERSION || !isRecord(value.goals)) return {};
  const goals = new Map(profile.courses.flatMap(course => course.goals
    .filter(goal => goal.kind === IELTS_GOAL_KIND)
    .map(goal => [goal.id, course.id] as const)));
  const scores: Record<string, LatestExamScore> = {};
  for (const [goalId, candidate] of Object.entries(value.goals)) {
    const entry = storedEntry(candidate);
    if (entry && goals.get(goalId) === entry.courseId) scores[goalId] = entry;
  }
  return scores;
};

const sameScores = (stored: unknown, next: Readonly<Record<string, LatestExamScore>>): boolean => {
  if (!isRecord(stored) || !hasExactKeys(stored, ['schemaVersion', 'goals'])
    || stored.schemaVersion !== EXAM_SCORES_SCHEMA_VERSION || !isRecord(stored.goals)) return false;
  const goals = stored.goals;
  return hasExactKeys(goals, Object.keys(next)) && Object.entries(next).every(([goalId, entry]) => {
    const current = storedEntry(goals[goalId]);
    return current?.courseId === entry.courseId && current.band === entry.band && current.updatedAt === entry.updatedAt;
  });
};

const ieltsGoalCourse = (profile: CourseProfile, courseId: string, goalId: string): void => {
  const course = profile.courses.find(candidate => candidate.id === courseId);
  if (!course) throw new CourseProfileConflictError('course-not-found', `Course ${courseId} was not found.`, { courseId });
  const goal = course.goals.find(candidate => candidate.id === goalId);
  if (!goal) {
    throw new CourseProfileConflictError('goal-not-found', `Goal ${goalId} was not found.`, { courseId, goalId });
  }
  if (goal.kind !== IELTS_GOAL_KIND) {
    throw new CourseProfileValidationError('goalId: a latest exam score can only be stored for an IELTS goal');
  }
};

export interface LatestExamScorePersistenceOptions {
  readonly now?: () => string;
}

/**
 * Stores or clears the latest score for one IELTS goal of the authenticated owner. The goal must
 * exist in the owner's own course profile, so another account's goal id is refused. Entries for
 * goals that no longer exist are dropped on every write. A repeated request leaves the document
 * unchanged.
 */
export const setLatestExamScore = async (
  database: Firestore,
  authenticatedOwnerId: string,
  request: SetLatestExamScoreRequest,
  options: LatestExamScorePersistenceOptions = {},
): Promise<LatestExamScoreResult> => {
  const ownerId = assertOwnerId(authenticatedOwnerId);
  if (request.ownerId !== ownerId) throw new CourseProfileOwnerMismatchError(request.ownerId, ownerId);
  const now = options.now ?? (() => new Date().toISOString());
  const profileDocuments = database.collection('users').doc(ownerId).collection('profile');
  const coursesReference = profileDocuments.doc('courses');
  const scoresReference = profileDocuments.doc(EXAM_SCORES_DOCUMENT_ID);
  return database.runTransaction(async (transaction: Transaction) => {
    const [coursesSnapshot, scoresSnapshot] = await Promise.all([
      transaction.get(coursesReference),
      transaction.get(scoresReference),
    ]);
    let profile: CourseProfile;
    try {
      profile = coursesSnapshot.exists ? parseCourseProfile(coursesSnapshot.data()) : createLegacyCourseProfile();
    } catch (error) {
      throw new CourseProfileStoredDataError(error);
    }
    ieltsGoalCourse(profile, request.courseId, request.goalId);
    const stored = scoresSnapshot.exists ? scoresSnapshot.data() : undefined;
    const { [request.goalId]: current, ...others } = readLatestExamScores(stored, profile);
    const next: Record<string, LatestExamScore> = { ...others };
    if (request.latestScore !== null) {
      next[request.goalId] = current?.band === request.latestScore
        ? current
        : { courseId: request.courseId, band: request.latestScore, updatedAt: now() };
    }
    const unchanged = Object.keys(next).length === 0 ? !scoresSnapshot.exists : sameScores(stored, next);
    if (!unchanged) {
      if (Object.keys(next).length === 0) {
        transaction.delete(scoresReference);
      } else {
        transaction.set(scoresReference, {
          schemaVersion: EXAM_SCORES_SCHEMA_VERSION,
          goals: next,
        } as DocumentData);
      }
    }
    return { courseId: request.courseId, goalId: request.goalId, latestScore: request.latestScore };
  });
};
