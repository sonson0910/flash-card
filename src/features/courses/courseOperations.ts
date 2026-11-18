import {
  assertCourseId,
  assertGoalId,
  canonicalNow,
  createCourseRecord,
  createGoalRecord,
  CourseError,
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
  type CreateCourseInput,
  type CreateGoalInput,
  type UpdateCourseInput,
  type UpdateGoalInput,
} from './courseModel';

type IdFactory = (kind: 'course' | 'goal') => string;
type Clock = () => string;

const uniqueId = (
  kind: 'course' | 'goal',
  factory: IdFactory,
  used: ReadonlySet<string>,
): string => {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const candidate = factory(kind);
    if (!used.has(candidate)) return candidate;
  }
  throw new CourseError('profile-invalid', `Could not allocate a unique ${kind} ID.`);
};

const normalizedProfile = (profile: CourseProfile): CourseProfile => parseCourseProfile(profile);

const courseAt = (profile: CourseProfile, courseId: string): Course => {
  const id = assertCourseId(courseId);
  const course = profile.courses.find(candidate => candidate.id === id);
  if (!course) {
    throw new CourseError('course-not-found', `Course ${id} was not found.`, { courseId: id });
  }
  return course;
};

const activeFallback = (courses: readonly Course[], excludedId: string): string | null =>
  courses.find(course => course.id !== excludedId && course.status === 'active')?.id ?? null;

const courseWithGoal = (
  course: Course,
  goal: CourseGoal,
): Course => parseCourseRecord({ ...course, goals: [...course.goals, goal] });

const nextGoal = (
  input: CreateGoalInput,
  factory: IdFactory,
  clock: Clock,
  used: ReadonlySet<string>,
): CourseGoal => parseGoalRecord(createGoalRecord({
  id: uniqueId('goal', factory, used),
  input: normalizeCreateGoalInput(input),
  createdAt: clock(),
}));

export const createCourseInProfile = (
  profile: CourseProfile,
  input: CreateCourseInput,
  factory: IdFactory,
  clock: Clock = canonicalNow,
): CourseProfile => {
  const current = normalizedProfile(profile);
  const normalized = normalizeCreateCourseInput(input);
  const existing = current.courses.find(course => course.targetLanguage === normalized.targetLanguage);
  if (existing) {
    if (normalized.operationId === existing.id) return current;
    throw new CourseError(
      'course-exists',
      `A course for ${normalized.targetLanguage} already exists.`,
      { courseId: existing.id, targetLanguage: normalized.targetLanguage },
    );
  }
  if (current.courses.length >= MAX_COURSES_PER_PROFILE) {
    throw new CourseError('course-limit', `A profile can contain at most ${MAX_COURSES_PER_PROFILE} courses.`);
  }
  const usedCourseIds = new Set(current.courses.map(course => course.id));
  const courseId = normalized.operationId ?? uniqueId('course', factory, usedCourseIds);
  if (usedCourseIds.has(courseId)) {
    throw new CourseError('course-exists', 'A course operation ID already exists.', { courseId });
  }
  const usedGoalIds = new Set<string>();
  const goals = normalized.goals.map(goal => {
    const next = nextGoal(goal, factory, clock, usedGoalIds);
    usedGoalIds.add(next.id);
    return next;
  });
  const course = createCourseRecord({
    id: courseId,
    input: normalized,
    createdAt: clock(),
    goals,
  });
  return parseCourseProfile({
    courses: [...current.courses, course],
    activeCourseId: current.activeCourseId ?? course.id,
  });
};

export const updateCourseInProfile = (
  profile: CourseProfile,
  courseId: string,
  input: UpdateCourseInput,
): CourseProfile => {
  const current = normalizedProfile(profile);
  const id = assertCourseId(courseId);
  const patch = normalizeUpdateCourseInput(input);
  courseAt(current, id);
  const courses = current.courses.map(course => course.id !== id
    ? course
    : parseCourseRecord({
        ...course,
        ...(patch.nativeLanguage === undefined ? {} : { nativeLanguage: patch.nativeLanguage }),
        ...(patch.preferences === undefined
          ? {}
          : { preferences: { ...course.preferences, ...patch.preferences } }),
      }));
  return parseCourseProfile({ ...current, courses });
};

export const archiveCourseInProfile = (
  profile: CourseProfile,
  courseId: string,
): CourseProfile => {
  const current = normalizedProfile(profile);
  const id = assertCourseId(courseId);
  const course = courseAt(current, id);
  if (course.status === 'archived') return current;
  const courses = current.courses.map(candidate => candidate.id === id
    ? parseCourseRecord({ ...candidate, status: 'archived' })
    : candidate);
  return parseCourseProfile({
    courses,
    activeCourseId: current.activeCourseId === id
      ? activeFallback(courses, id)
      : current.activeCourseId,
  });
};

export const reopenCourseInProfile = (
  profile: CourseProfile,
  courseId: string,
): CourseProfile => {
  const current = normalizedProfile(profile);
  const id = assertCourseId(courseId);
  const course = courseAt(current, id);
  const courses = course.status === 'active'
    ? current.courses
    : current.courses.map(candidate => candidate.id === id
      ? parseCourseRecord({ ...candidate, status: 'active' })
      : candidate);
  return parseCourseProfile({ courses, activeCourseId: id });
};

export const setActiveCourseInProfile = (
  profile: CourseProfile,
  courseId: string,
): CourseProfile => {
  const current = normalizedProfile(profile);
  const id = assertCourseId(courseId);
  const course = courseAt(current, id);
  if (course.status !== 'active') {
    throw new CourseError('course-archived', `Course ${id} is archived.`, { courseId: id });
  }
  return parseCourseProfile({ ...current, activeCourseId: id });
};

export const addGoalToProfile = (
  profile: CourseProfile,
  courseId: string,
  input: CreateGoalInput,
  factory: IdFactory,
  clock: Clock = canonicalNow,
): CourseProfile => {
  const current = normalizedProfile(profile);
  const id = assertCourseId(courseId);
  const course = courseAt(current, id);
  const normalized = normalizeCreateGoalInput(input);
  const existing = course.goals.find(goal => goal.kind === normalized.kind);
  if (existing) {
    throw new CourseError('goal-exists', `Goal ${normalized.kind} already exists.`, {
      goalId: existing.id,
      courseId: id,
      kind: normalized.kind,
    });
  }
  const used = new Set(course.goals.map(goal => goal.id));
  const next = courseWithGoal(course, nextGoal(normalized, factory, clock, used));
  return parseCourseProfile({
    ...current,
    courses: current.courses.map(candidate => candidate.id === id ? next : candidate),
  });
};

export const updateGoalInProfile = (
  profile: CourseProfile,
  courseId: string,
  goalId: string,
  input: UpdateGoalInput,
): CourseProfile => {
  const current = normalizedProfile(profile);
  const course = courseAt(current, courseId);
  const id = assertGoalId(goalId);
  const patch = normalizeUpdateGoalInput(input);
  if (!course.goals.some(goal => goal.id === id)) {
    throw new CourseError('goal-not-found', `Goal ${id} was not found.`, { courseId, goalId: id });
  }
  const next = parseCourseRecord({
    ...course,
    goals: course.goals.map(goal => goal.id !== id ? goal : parseGoalRecord({
      ...goal,
      ...(patch.level === undefined ? {} : { level: patch.level }),
      ...(patch.targetDate === undefined ? {} : { targetDate: patch.targetDate }),
      ...(patch.status === undefined ? {} : { status: patch.status }),
    })),
  });
  return parseCourseProfile({
    ...current,
    courses: current.courses.map(candidate => candidate.id === course.id ? next : candidate),
  });
};

export const removeGoalFromProfile = (
  profile: CourseProfile,
  courseId: string,
  goalId: string,
): CourseProfile => {
  const current = normalizedProfile(profile);
  const course = courseAt(current, courseId);
  const id = assertGoalId(goalId);
  if (!course.goals.some(goal => goal.id === id)) return current;
  const next = parseCourseRecord({
    ...course,
    goals: course.goals.filter(goal => goal.id !== id),
  });
  return parseCourseProfile({
    ...current,
    courses: current.courses.map(candidate => candidate.id === course.id ? next : candidate),
  });
};

export type { IdFactory, Clock };
