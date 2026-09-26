import { randomUUID } from 'node:crypto';
import type { DocumentData, Firestore, Transaction } from 'firebase-admin/firestore';
import {
  assertCourseId,
  assertGoalId,
  assertOwnerId,
  createCourseRecord,
  createGoalRecord,
  createLegacyCourseProfile,
  CourseProfileValidationError,
  MAX_COURSES_PER_PROFILE,
  normalizeCreateCourseInput,
  normalizeCreateGoalInput,
  normalizeUpdateCourseInput,
  normalizeUpdateGoalInput,
  parseCourseProfile,
  parseCourseRecord,
  parseGoalRecord,
  type Course,
  type CourseGoal,
  type CourseProfile,
  type CreateGoalInput,
  type UpdateCourseInput,
  type UpdateGoalInput,
} from './course-profile-contract.js';

export const COURSE_PROFILE_COLLECTION_PATH = 'users/{uid}/profile/courses';

export type CourseProfileMutationName =
  | 'createCourse'
  | 'updateCourse'
  | 'archiveCourse'
  | 'reopenCourse'
  | 'setActiveCourse'
  | 'addGoal'
  | 'updateGoal'
  | 'removeGoal';

type NormalizedCreateCourseInput = ReturnType<typeof normalizeCreateCourseInput>;

export type CourseProfileMutationRequest =
  | { readonly operation: 'createCourse'; readonly ownerId: string; readonly input: NormalizedCreateCourseInput }
  | { readonly operation: 'updateCourse'; readonly ownerId: string; readonly courseId: string; readonly input: UpdateCourseInput }
  | { readonly operation: 'archiveCourse'; readonly ownerId: string; readonly courseId: string }
  | { readonly operation: 'reopenCourse'; readonly ownerId: string; readonly courseId: string }
  | { readonly operation: 'setActiveCourse'; readonly ownerId: string; readonly courseId: string }
  | { readonly operation: 'addGoal'; readonly ownerId: string; readonly courseId: string; readonly input: CreateGoalInput }
  | { readonly operation: 'updateGoal'; readonly ownerId: string; readonly courseId: string; readonly goalId: string; readonly input: UpdateGoalInput }
  | { readonly operation: 'removeGoal'; readonly ownerId: string; readonly courseId: string; readonly goalId: string };

export type CourseProfileConflictReason =
  | 'course-exists'
  | 'course-limit'
  | 'course-not-found'
  | 'course-archived'
  | 'goal-exists'
  | 'goal-not-found';

export class CourseProfileConflictError extends Error {
  readonly details: Readonly<Record<string, unknown>>;

  constructor(
    readonly reason: CourseProfileConflictReason,
    message = `Course profile mutation rejected: ${reason}.`,
    details: Readonly<Record<string, unknown>> = {},
  ) {
    super(message);
    this.name = 'CourseProfileConflictError';
    this.details = details;
  }
}

export class CourseProfileOwnerMismatchError extends Error {
  constructor(
    readonly requestedOwnerId: string,
    readonly authenticatedOwnerId: string,
  ) {
    super('Course profile request owner does not match the authenticated owner.');
    this.name = 'CourseProfileOwnerMismatchError';
  }
}

export class CourseProfileStoredDataError extends Error {
  constructor(readonly cause: unknown) {
    super('The stored course profile is invalid.');
    this.name = 'CourseProfileStoredDataError';
  }
}

const asRecord = (value: unknown, message: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new CourseProfileValidationError(message);
  }
  return value as Record<string, unknown>;
};

const exactKeys = (
  source: Record<string, unknown>,
  expected: readonly string[],
  message: string,
): void => {
  const keys = Object.keys(source);
  if (keys.length !== expected.length || keys.some(key => !expected.includes(key))) {
    throw new CourseProfileValidationError(message);
  }
};

const requiredOwner = (source: Record<string, unknown>): string => {
  if (!Object.hasOwn(source, 'ownerId')) {
    throw new CourseProfileValidationError('Course profile ownerId is required.');
  }
  return assertOwnerId(source.ownerId);
};

const requiredCourseId = (source: Record<string, unknown>): string => {
  if (!Object.hasOwn(source, 'courseId')) {
    throw new CourseProfileValidationError('Course profile courseId is required.');
  }
  return assertCourseId(source.courseId);
};

const requiredGoalId = (source: Record<string, unknown>): string => {
  if (!Object.hasOwn(source, 'goalId')) {
    throw new CourseProfileValidationError('Course profile goalId is required.');
  }
  return assertGoalId(source.goalId);
};

const requiredInput = (source: Record<string, unknown>): unknown => {
  if (!Object.hasOwn(source, 'input')) {
    throw new CourseProfileValidationError('Course profile input is required.');
  }
  return source.input;
};

/** Parse one fixed callable envelope; arbitrary patch operations are rejected. */
export const parseCourseProfileMutationRequest = (
  operation: CourseProfileMutationName,
  value: unknown,
): CourseProfileMutationRequest => {
  const source = asRecord(value, 'Course profile request must be an object.');
  switch (operation) {
    case 'createCourse':
      exactKeys(source, ['ownerId', 'input'], 'Create course request contains an unsupported field.');
      return {
        operation,
        ownerId: requiredOwner(source),
        input: normalizeCreateCourseInput(requiredInput(source)),
      };
    case 'updateCourse':
      exactKeys(source, ['ownerId', 'courseId', 'input'], 'Update course request contains an unsupported field.');
      return {
        operation,
        ownerId: requiredOwner(source),
        courseId: requiredCourseId(source),
        input: normalizeUpdateCourseInput(requiredInput(source)),
      };
    case 'archiveCourse':
    case 'reopenCourse':
    case 'setActiveCourse':
      exactKeys(source, ['ownerId', 'courseId'], `${operation} request contains an unsupported field.`);
      return {
        operation,
        ownerId: requiredOwner(source),
        courseId: requiredCourseId(source),
      };
    case 'addGoal':
      exactKeys(source, ['ownerId', 'courseId', 'input'], 'Add goal request contains an unsupported field.');
      return {
        operation,
        ownerId: requiredOwner(source),
        courseId: requiredCourseId(source),
        input: normalizeCreateGoalInput(requiredInput(source)),
      };
    case 'updateGoal':
      exactKeys(source, ['ownerId', 'courseId', 'goalId', 'input'], 'Update goal request contains an unsupported field.');
      return {
        operation,
        ownerId: requiredOwner(source),
        courseId: requiredCourseId(source),
        goalId: requiredGoalId(source),
        input: normalizeUpdateGoalInput(requiredInput(source)),
      };
    case 'removeGoal':
      exactKeys(source, ['ownerId', 'courseId', 'goalId'], 'Remove goal request contains an unsupported field.');
      return {
        operation,
        ownerId: requiredOwner(source),
        courseId: requiredCourseId(source),
        goalId: requiredGoalId(source),
      };
    default:
      throw new CourseProfileValidationError('Unsupported course profile operation.');
  }
};

type IdFactory = (kind: 'course' | 'goal') => string;
type Clock = () => string;

export interface CourseProfilePersistenceOptions {
  readonly createId?: IdFactory;
  readonly now?: Clock;
}

const serverId: IdFactory = kind => `${kind}-${randomUUID()}`;
const serverNow: Clock = () => new Date().toISOString();

const uniqueId = (
  kind: 'course' | 'goal',
  factory: IdFactory,
  used: ReadonlySet<string>,
): string => {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const candidate = factory(kind);
    if (!used.has(candidate)) return candidate;
  }
  throw new CourseProfileValidationError(`Could not allocate a unique ${kind} ID.`);
};

const courseAt = (profile: CourseProfile, courseId: string): Course => {
  const course = profile.courses.find(candidate => candidate.id === courseId);
  if (!course) {
    throw new CourseProfileConflictError(
      'course-not-found',
      `Course ${courseId} was not found.`,
      { courseId },
    );
  }
  return course;
};

const activeFallback = (courses: readonly Course[], excludedId: string): string | null =>
  courses.find(course => course.id !== excludedId && course.status === 'active')?.id ?? null;

const createGoal = (
  input: CreateGoalInput,
  factory: IdFactory,
  clock: Clock,
  used: ReadonlySet<string>,
): CourseGoal => parseGoalRecord(createGoalRecord({
  id: uniqueId('goal', factory, used),
  input,
  createdAt: clock(),
}));

const createCourse = (
  profile: CourseProfile,
  input: NormalizedCreateCourseInput,
  factory: IdFactory,
  clock: Clock,
): CourseProfile => {
  const existing = profile.courses.find(course => course.targetLanguage === input.targetLanguage);
  if (existing) {
    throw new CourseProfileConflictError(
      'course-exists',
      `A course for ${input.targetLanguage} already exists.`,
      { courseId: existing.id, targetLanguage: input.targetLanguage },
    );
  }
  if (profile.courses.length >= MAX_COURSES_PER_PROFILE) {
    throw new CourseProfileConflictError('course-limit', 'A profile can contain at most four courses.');
  }
  const usedCourseIds = new Set(profile.courses.map(course => course.id));
  const courseId = uniqueId('course', factory, usedCourseIds);
  const usedGoalIds = new Set<string>();
  const goals = input.goals.map(goalInput => {
    const goal = createGoal(goalInput, factory, clock, usedGoalIds);
    usedGoalIds.add(goal.id);
    return goal;
  });
  const course = createCourseRecord({ id: courseId, input, createdAt: clock(), goals });
  return parseCourseProfile({
    courses: [...profile.courses, course],
    activeCourseId: profile.activeCourseId ?? course.id,
  });
};

const updateCourse = (
  profile: CourseProfile,
  courseId: string,
  input: UpdateCourseInput,
): CourseProfile => {
  courseAt(profile, courseId);
  const courses = profile.courses.map(course => course.id !== courseId
    ? course
    : parseCourseRecord({
        ...course,
        ...(input.nativeLanguage === undefined ? {} : { nativeLanguage: input.nativeLanguage }),
        ...(input.preferences === undefined
          ? {}
          : { preferences: { ...course.preferences, ...input.preferences } }),
      }));
  return parseCourseProfile({ ...profile, courses });
};

const archiveCourse = (profile: CourseProfile, courseId: string): CourseProfile => {
  const course = courseAt(profile, courseId);
  if (course.status === 'archived') return profile;
  const courses = profile.courses.map(candidate => candidate.id === courseId
    ? parseCourseRecord({ ...candidate, status: 'archived' })
    : candidate);
  return parseCourseProfile({
    courses,
    activeCourseId: profile.activeCourseId === courseId
      ? activeFallback(courses, courseId)
      : profile.activeCourseId,
  });
};

const reopenCourse = (profile: CourseProfile, courseId: string): CourseProfile => {
  const course = courseAt(profile, courseId);
  const courses = course.status === 'active'
    ? profile.courses
    : profile.courses.map(candidate => candidate.id === courseId
      ? parseCourseRecord({ ...candidate, status: 'active' })
      : candidate);
  return parseCourseProfile({ courses, activeCourseId: courseId });
};

const setActiveCourse = (profile: CourseProfile, courseId: string): CourseProfile => {
  const course = courseAt(profile, courseId);
  if (course.status !== 'active') {
    throw new CourseProfileConflictError('course-archived', `Course ${courseId} is archived.`, { courseId });
  }
  return parseCourseProfile({ ...profile, activeCourseId: courseId });
};

const addGoal = (
  profile: CourseProfile,
  courseId: string,
  input: CreateGoalInput,
  factory: IdFactory,
  clock: Clock,
): CourseProfile => {
  const course = courseAt(profile, courseId);
  const existing = course.goals.find(goal => goal.kind === input.kind);
  if (existing) {
    throw new CourseProfileConflictError(
      'goal-exists',
      `Goal ${input.kind} already exists.`,
      { goalId: existing.id, courseId, kind: input.kind },
    );
  }
  const usedGoalIds = new Set(course.goals.map(goal => goal.id));
  const next = parseCourseRecord({
    ...course,
    goals: [...course.goals, createGoal(input, factory, clock, usedGoalIds)],
  });
  return parseCourseProfile({
    ...profile,
    courses: profile.courses.map(candidate => candidate.id === courseId ? next : candidate),
  });
};

const updateGoal = (
  profile: CourseProfile,
  courseId: string,
  goalId: string,
  input: UpdateGoalInput,
): CourseProfile => {
  const course = courseAt(profile, courseId);
  if (!course.goals.some(goal => goal.id === goalId)) {
    throw new CourseProfileConflictError('goal-not-found', `Goal ${goalId} was not found.`, { courseId, goalId });
  }
  const next = parseCourseRecord({
    ...course,
    goals: course.goals.map(goal => goal.id !== goalId ? goal : parseGoalRecord({
      ...goal,
      ...(input.level === undefined ? {} : { level: input.level }),
      ...(input.targetDate === undefined ? {} : { targetDate: input.targetDate }),
      ...(input.status === undefined ? {} : { status: input.status }),
    })),
  });
  return parseCourseProfile({
    ...profile,
    courses: profile.courses.map(candidate => candidate.id === courseId ? next : candidate),
  });
};

const removeGoal = (profile: CourseProfile, courseId: string, goalId: string): CourseProfile => {
  const course = courseAt(profile, courseId);
  if (!course.goals.some(goal => goal.id === goalId)) return profile;
  const next = parseCourseRecord({
    ...course,
    goals: course.goals.filter(goal => goal.id !== goalId),
  });
  return parseCourseProfile({
    ...profile,
    courses: profile.courses.map(candidate => candidate.id === courseId ? next : candidate),
  });
};

const applyMutation = (
  profile: CourseProfile,
  request: CourseProfileMutationRequest,
  factory: IdFactory,
  clock: Clock,
): CourseProfile => {
  switch (request.operation) {
    case 'createCourse': return createCourse(profile, request.input, factory, clock);
    case 'updateCourse': return updateCourse(profile, request.courseId, request.input);
    case 'archiveCourse': return archiveCourse(profile, request.courseId);
    case 'reopenCourse': return reopenCourse(profile, request.courseId);
    case 'setActiveCourse': return setActiveCourse(profile, request.courseId);
    case 'addGoal': return addGoal(profile, request.courseId, request.input, factory, clock);
    case 'updateGoal': return updateGoal(profile, request.courseId, request.goalId, request.input);
    case 'removeGoal': return removeGoal(profile, request.courseId, request.goalId);
    default: throw new CourseProfileValidationError('Unsupported course profile operation.');
  }
};

const profileReference = (database: Firestore, ownerId: string) =>
  database.collection('users').doc(ownerId).collection('profile').doc('courses');

const readStoredProfile = (snapshot: { exists: boolean; data(): DocumentData | undefined }): CourseProfile => {
  if (!snapshot.exists) return createLegacyCourseProfile();
  try {
    return parseCourseProfile(snapshot.data());
  } catch (error) {
    throw new CourseProfileStoredDataError(error);
  }
};

export const applyCourseProfileMutation = async (
  database: Firestore,
  authenticatedOwnerId: string,
  request: CourseProfileMutationRequest,
  options: CourseProfilePersistenceOptions = {},
): Promise<CourseProfile> => {
  const ownerId = assertOwnerId(authenticatedOwnerId);
  if (request.ownerId !== ownerId) {
    throw new CourseProfileOwnerMismatchError(request.ownerId, ownerId);
  }
  const factory = options.createId ?? serverId;
  const clock = options.now ?? serverNow;
  const reference = profileReference(database, ownerId);
  return database.runTransaction(async (transaction: Transaction) => {
    const snapshot = await transaction.get(reference);
    const current = readStoredProfile(snapshot);
    const next = applyMutation(current, request, factory, clock);
    transaction.set(reference, next as unknown as DocumentData);
    return next;
  });
};
