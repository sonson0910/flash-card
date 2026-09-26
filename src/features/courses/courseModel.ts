import {
  COURSE_NATIVE_LANGUAGES as PURE_NATIVE_LANGUAGES,
  COURSE_STATUSES as PURE_STATUSES,
  COURSE_TARGET_LANGUAGES as PURE_TARGET_LANGUAGES,
  GOAL_STATUSES as PURE_GOAL_STATUSES,
  LEGACY_COURSE_CREATED_AT as PURE_LEGACY_CREATED_AT,
  LEGACY_COURSE_ID as PURE_LEGACY_ID,
  MAX_COURSE_ID_LENGTH as PURE_MAX_COURSE_ID_LENGTH,
  MAX_GOALS_PER_COURSE as PURE_MAX_GOALS_PER_COURSE,
  MAX_COURSES_PER_PROFILE as PURE_MAX_COURSES_PER_PROFILE,
  MAX_GOAL_ID_LENGTH as PURE_MAX_GOAL_ID_LENGTH,
  MAX_GOAL_KIND_LENGTH as PURE_MAX_GOAL_KIND_LENGTH,
  MAX_GOAL_LEVEL_LENGTH as PURE_MAX_GOAL_LEVEL_LENGTH,
  MAX_PRONUNCIATION_VARIANT_LENGTH as PURE_MAX_PRONUNCIATION_VARIANT_LENGTH,
  CourseProfileValidationError,
  assertCourseId as pureAssertCourseId,
  assertGoalId as pureAssertGoalId,
  assertOwnerId as pureAssertOwnerId,
  createCourseRecord as pureCreateCourseRecord,
  createGoalRecord as pureCreateGoalRecord,
  createLegacyCourseProfile as pureCreateLegacyCourseProfile,
  defaultCoursePreferences as pureDefaultCoursePreferences,
  normalizeCreateCourseInput as pureNormalizeCreateCourseInput,
  normalizeCreateGoalInput as pureNormalizeCreateGoalInput,
  normalizeUpdateCourseInput as pureNormalizeUpdateCourseInput,
  normalizeUpdateGoalInput as pureNormalizeUpdateGoalInput,
  parseCourseProfile as pureParseCourseProfile,
  parseCourseRecord as pureParseCourseRecord,
  parseGoalRecord as pureParseGoalRecord,
  courseProfileDocumentKeys as PURE_PROFILE_KEYS,
  courseDocumentKeys as PURE_COURSE_KEYS,
  goalDocumentKeys as PURE_GOAL_KEYS,
  preferenceDocumentKeys as PURE_PREFERENCE_KEYS,
} from '../../../functions/src/course-profile-contract';
import type {
  Course,
  CourseGoal,
  CourseGoalStatus,
  CourseNativeLanguage,
  CoursePreferences,
  CourseProfile,
  CourseStatus,
  CourseTargetLanguage,
  CreateCourseInput,
  CreateGoalInput,
  UpdateCourseInput,
  UpdateGoalInput,
} from '../../../functions/src/course-profile-contract';

export const COURSE_TARGET_LANGUAGES = PURE_TARGET_LANGUAGES;
export const COURSE_NATIVE_LANGUAGES = PURE_NATIVE_LANGUAGES;
export const COURSE_STATUSES = PURE_STATUSES;
export const GOAL_STATUSES = PURE_GOAL_STATUSES;
export const MAX_COURSES_PER_PROFILE = PURE_MAX_COURSES_PER_PROFILE;
export const MAX_GOALS_PER_COURSE = PURE_MAX_GOALS_PER_COURSE;
export const MAX_COURSE_ID_LENGTH = PURE_MAX_COURSE_ID_LENGTH;
export const MAX_GOAL_ID_LENGTH = PURE_MAX_GOAL_ID_LENGTH;
export const MAX_GOAL_KIND_LENGTH = PURE_MAX_GOAL_KIND_LENGTH;
export const MAX_GOAL_LEVEL_LENGTH = PURE_MAX_GOAL_LEVEL_LENGTH;
export const MAX_PRONUNCIATION_VARIANT_LENGTH = PURE_MAX_PRONUNCIATION_VARIANT_LENGTH;
export const LEGACY_COURSE_ID = PURE_LEGACY_ID;
export const LEGACY_COURSE_CREATED_AT = PURE_LEGACY_CREATED_AT;

export type {
  Course,
  CourseGoal,
  CourseGoalStatus,
  CourseNativeLanguage,
  CoursePreferences,
  CourseProfile,
  CourseStatus,
  CourseTargetLanguage,
  CreateCourseInput,
  CreateGoalInput,
  UpdateCourseInput,
  UpdateGoalInput,
};
export { CourseProfileValidationError };

export type CourseErrorCode =
  | 'course-exists'
  | 'course-limit'
  | 'course-not-found'
  | 'course-archived'
  | 'goal-exists'
  | 'goal-not-found'
  | 'profile-invalid'
  | 'owner-required'
  | 'owner-changed'
  | 'cloud-unavailable'
  | 'cloud-read-failed'
  | 'cloud-write-failed'
  | 'local-storage-failed';

export class CourseError extends Error {
  readonly code: CourseErrorCode;
  readonly details: Readonly<Record<string, unknown>>;
  readonly cause: unknown;

  constructor(
    code: CourseErrorCode,
    message: string,
    details: Readonly<Record<string, unknown>> = {},
    cause?: unknown,
  ) {
    super(message);
    this.name = 'CourseError';
    this.code = code;
    this.details = details;
    this.cause = cause;
  }
}

const translateValidation = <T>(operation: () => T): T => {
  try {
    return operation();
  } catch (error) {
    if (error instanceof CourseProfileValidationError) {
      throw new CourseError('profile-invalid', error.message, {}, error);
    }
    throw error;
  }
};

export const parseCourseProfile = (value: unknown): CourseProfile =>
  translateValidation(() => pureParseCourseProfile(value));

export const defaultCoursePreferences = (): CoursePreferences => pureDefaultCoursePreferences();

export const createLegacyCourseProfile = (
  nativeLanguage: CourseNativeLanguage = 'vi',
): CourseProfile => translateValidation(() => pureCreateLegacyCourseProfile(nativeLanguage));

export const normalizeCreateCourseInput = (
  value: unknown,
): ReturnType<typeof pureNormalizeCreateCourseInput> =>
  translateValidation(() => pureNormalizeCreateCourseInput(value));

export const normalizeUpdateCourseInput = (
  value: unknown,
): UpdateCourseInput => translateValidation(() => pureNormalizeUpdateCourseInput(value));

export const normalizeUpdateGoalInput = (
  value: unknown,
): UpdateGoalInput => translateValidation(() => pureNormalizeUpdateGoalInput(value));

export function normalizeCreateGoalInput(
  value: unknown,
  path = 'goal',
): CreateGoalInput {
  return translateValidation(() => pureNormalizeCreateGoalInput(value, path));
}

export const createCourseRecord = ({
  id,
  input,
  createdAt,
  goals,
}: {
  readonly id: string;
  readonly input: ReturnType<typeof pureNormalizeCreateCourseInput>;
  readonly createdAt: string;
  readonly goals: readonly CourseGoal[];
}): Course => translateValidation(() => pureCreateCourseRecord({ id, input, createdAt, goals }));

export const createGoalRecord = ({
  id,
  input,
  createdAt,
}: {
  readonly id: string;
  readonly input: CreateGoalInput;
  readonly createdAt: string;
}): CourseGoal => translateValidation(() => pureCreateGoalRecord({ id, input, createdAt }));

export const parseCourseRecord = (value: unknown): Course =>
  translateValidation(() => pureParseCourseRecord(value));
export const parseGoalRecord = (value: unknown): CourseGoal =>
  translateValidation(() => pureParseGoalRecord(value));

export const assertOwnerId = (value: unknown, path = 'ownerId'): string =>
  translateValidation(() => pureAssertOwnerId(value, path));
export const assertCourseId = (value: unknown, path = 'courseId'): string =>
  translateValidation(() => pureAssertCourseId(value, path));
export const assertGoalId = (value: unknown, path = 'goalId'): string =>
  translateValidation(() => pureAssertGoalId(value, path));

export const canonicalNow = (): string => new Date().toISOString();

export const generateOpaqueId = (prefix: 'course' | 'goal'): string => {
  try {
    const randomUuid = globalThis.crypto?.randomUUID?.();
    if (randomUuid) return `${prefix}-${randomUuid}`;
  } catch {
    // The deterministic fallback below keeps the local adapter usable in old browsers and tests.
  }
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
};

export const courseProfileDocumentKeys = PURE_PROFILE_KEYS;
export const courseDocumentKeys = PURE_COURSE_KEYS;
export const goalDocumentKeys = PURE_GOAL_KEYS;
export const preferenceDocumentKeys = PURE_PREFERENCE_KEYS;
