export class CourseProfileValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CourseProfileValidationError';
  }
}

export const COURSE_TARGET_LANGUAGES = Object.freeze(['en', 'ko', 'ja', 'zh'] as const);
export const COURSE_NATIVE_LANGUAGES = Object.freeze(['vi', 'en'] as const);
export const COURSE_STATUSES = Object.freeze(['active', 'archived'] as const);
export const GOAL_STATUSES = Object.freeze(['active', 'paused', 'completed'] as const);

export type CourseTargetLanguage = (typeof COURSE_TARGET_LANGUAGES)[number];
export type CourseNativeLanguage = (typeof COURSE_NATIVE_LANGUAGES)[number];
export type CourseStatus = (typeof COURSE_STATUSES)[number];
export type CourseGoalStatus = (typeof GOAL_STATUSES)[number];

export const MAX_COURSES_PER_PROFILE = 4;
export const MAX_GOALS_PER_COURSE = 32;
export const MAX_COURSE_ID_LENGTH = 128;
export const MAX_GOAL_ID_LENGTH = 128;
export const MAX_GOAL_KIND_LENGTH = 64;
export const MAX_GOAL_LEVEL_LENGTH = 32;
export const MAX_PRONUNCIATION_VARIANT_LENGTH = 64;

export const LEGACY_COURSE_ID = 'legacy-en-vi';
export const LEGACY_COURSE_CREATED_AT = '1970-01-01T00:00:00.000Z';

export interface CoursePreferences {
  readonly pronunciationVariant: string | null;
  readonly showRomanization: boolean;
  readonly zhScript: 'hans' | 'hant' | null;
}

export interface CourseGoal {
  readonly id: string;
  readonly kind: string;
  readonly level: string | null;
  readonly targetDate: string | null;
  readonly status: CourseGoalStatus;
  readonly createdAt: string;
}

export interface Course {
  readonly id: string;
  readonly targetLanguage: CourseTargetLanguage;
  readonly nativeLanguage: CourseNativeLanguage;
  readonly status: CourseStatus;
  readonly goals: readonly CourseGoal[];
  readonly preferences: CoursePreferences;
  readonly createdAt: string;
}

export interface CourseProfile {
  readonly courses: readonly Course[];
  readonly activeCourseId: string | null;
}

export interface CreateGoalInput {
  readonly kind: string;
  readonly level?: string | null;
  readonly targetDate?: string | null;
}

export interface CreateCourseInput {
  readonly targetLanguage: CourseTargetLanguage;
  readonly nativeLanguage: CourseNativeLanguage;
  readonly goals?: readonly CreateGoalInput[];
  readonly preferences?: Partial<CoursePreferences>;
}

export interface UpdateCourseInput {
  readonly nativeLanguage?: CourseNativeLanguage;
  readonly preferences?: Partial<CoursePreferences>;
}

export interface UpdateGoalInput {
  readonly level?: string | null;
  readonly targetDate?: string | null;
  readonly status?: CourseGoalStatus;
}

type UnknownRecord = Record<string, unknown>;

const hasOwn = (value: UnknownRecord, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(value, key);

const fail = (
  path: string,
  message: string,
): never => {
  throw new CourseProfileValidationError(`${path}: ${message}`);
};

const recordAt = (
  value: unknown,
  path: string,
  keys: readonly string[],
): UnknownRecord => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail(path, 'expected an object');
  }
  const record = value as UnknownRecord;
  const unknownKey = Object.keys(record).find(key => !keys.includes(key));
  if (unknownKey) fail(`${path}.${unknownKey}`, 'unknown field');
  const missingKey = keys.find(key => !hasOwn(record, key));
  if (missingKey) fail(`${path}.${missingKey}`, 'missing field');
  return record;
};

const optionalRecordAt = (
  value: unknown,
  path: string,
  keys: readonly string[],
): UnknownRecord => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail(path, 'expected an object');
  }
  const record = value as UnknownRecord;
  const unknownKey = Object.keys(record).find(key => !keys.includes(key));
  if (unknownKey) fail(`${path}.${unknownKey}`, 'unknown field');
  return record;
};

const textAt = (
  value: unknown,
  path: string,
  maximum: number,
  allowEmpty = false,
): string => {
  if (typeof value !== 'string') fail(path, 'expected a string');
  const text = value as string;
  const canonical = text.normalize('NFKC').trim();
  if (canonical !== text) fail(path, 'must be normalized and trimmed');
  if (!allowEmpty && canonical.length === 0) fail(path, 'must not be empty');
  if (canonical.length > maximum) fail(path, `must be at most ${maximum} characters`);
  if (/[\x00-\x1F\x7F]/.test(canonical)) fail(path, 'must not contain control characters');
  return canonical;
};

const idAt = (value: unknown, path: string, maximum = MAX_COURSE_ID_LENGTH): string => {
  const id = textAt(value, path, maximum);
  if (id === '.' || id === '..' || /^__.*__$/.test(id) || id.includes('/')) {
    fail(path, 'must be a valid Firestore document ID');
  }
  return id;
};

const enumAt = <T extends string>(
  value: unknown,
  path: string,
  values: readonly T[],
): T => {
  const parsed = textAt(value, path, 32);
  if (!values.includes(parsed as T)) fail(path, 'contains an unsupported value');
  return parsed as T;
};

const nullableTextAt = (value: unknown, path: string, maximum: number): string | null =>
  value === null ? null : textAt(value, path, maximum);

const canonicalTimestampAt = (value: unknown, path: string): string => {
  const timestamp = textAt(value, path, 32);
  const parsed = Date.parse(timestamp);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== timestamp) {
    fail(path, 'expected a canonical ISO-8601 UTC timestamp');
  }
  return timestamp;
};

const calendarDateAt = (value: unknown, path: string): string | null => {
  if (value === null) return null;
  const date = textAt(value, path, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) fail(path, 'expected YYYY-MM-DD');
  const [year, month, day] = date.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year
    || parsed.getUTCMonth() !== month - 1
    || parsed.getUTCDate() !== day
  ) fail(path, 'expected a valid calendar date');
  return date;
};

const booleanAt = (value: unknown, path: string): boolean => {
  if (typeof value !== 'boolean') fail(path, 'expected a boolean');
  return value as boolean;
};

const arrayAt = (value: unknown, path: string): unknown[] => {
  if (!Array.isArray(value)) fail(path, 'expected an array');
  return value as unknown[];
};

const parsePreferences = (value: unknown, path: string): CoursePreferences => {
  const record = recordAt(value, path, ['pronunciationVariant', 'showRomanization', 'zhScript']);
  return {
    pronunciationVariant: nullableTextAt(
      record.pronunciationVariant,
      `${path}.pronunciationVariant`,
      MAX_PRONUNCIATION_VARIANT_LENGTH,
    ),
    showRomanization: booleanAt(record.showRomanization, `${path}.showRomanization`),
    zhScript: record.zhScript === null
      ? null
      : enumAt(record.zhScript, `${path}.zhScript`, ['hans', 'hant'] as const),
  };
};

const parseGoal = (value: unknown, path: string): CourseGoal => {
  const record = recordAt(value, path, ['id', 'kind', 'level', 'targetDate', 'status', 'createdAt']);
  return {
    id: idAt(record.id, `${path}.id`, MAX_GOAL_ID_LENGTH),
    kind: textAt(record.kind, `${path}.kind`, MAX_GOAL_KIND_LENGTH),
    level: nullableTextAt(record.level, `${path}.level`, MAX_GOAL_LEVEL_LENGTH),
    targetDate: calendarDateAt(record.targetDate, `${path}.targetDate`),
    status: enumAt(record.status, `${path}.status`, GOAL_STATUSES),
    createdAt: canonicalTimestampAt(record.createdAt, `${path}.createdAt`),
  };
};

const parseCourse = (value: unknown, path: string): Course => {
  const record = recordAt(value, path, [
    'id', 'targetLanguage', 'nativeLanguage', 'status', 'goals', 'preferences', 'createdAt',
  ]);
  const rawGoals = arrayAt(record.goals, `${path}.goals`);
  if (rawGoals.length > MAX_GOALS_PER_COURSE) {
    fail(`${path}.goals`, `must contain at most ${MAX_GOALS_PER_COURSE} goals`);
  }
  const goals = rawGoals.map((goal, index) => parseGoal(goal, `${path}.goals[${index}]`));
  const goalIds = new Set(goals.map(goal => goal.id));
  if (goalIds.size !== goals.length) fail(`${path}.goals`, 'contains duplicate goal IDs');
  const goalKinds = new Set(goals.map(goal => goal.kind));
  if (goalKinds.size !== goals.length) fail(`${path}.goals`, 'contains duplicate goal kinds');
  return {
    id: idAt(record.id, `${path}.id`),
    targetLanguage: enumAt(record.targetLanguage, `${path}.targetLanguage`, COURSE_TARGET_LANGUAGES),
    nativeLanguage: enumAt(record.nativeLanguage, `${path}.nativeLanguage`, COURSE_NATIVE_LANGUAGES),
    status: enumAt(record.status, `${path}.status`, COURSE_STATUSES),
    goals,
    preferences: parsePreferences(record.preferences, `${path}.preferences`),
    createdAt: canonicalTimestampAt(record.createdAt, `${path}.createdAt`),
  };
};

export const parseCourseProfile = (value: unknown): CourseProfile => {
  const record = recordAt(value, 'profile', ['courses', 'activeCourseId']);
  const rawCourses = arrayAt(record.courses, 'profile.courses');
  if (rawCourses.length > MAX_COURSES_PER_PROFILE) {
    fail('profile.courses', `must contain at most ${MAX_COURSES_PER_PROFILE} courses`);
  }
  const courses = rawCourses.map((course, index) => parseCourse(course, `profile.courses[${index}]`));
  const courseIds = new Set(courses.map(course => course.id));
  if (courseIds.size !== courses.length) fail('profile.courses', 'contains duplicate course IDs');
  const targets = new Set(courses.map(course => course.targetLanguage));
  if (targets.size !== courses.length) fail('profile.courses', 'contains duplicate target languages');
  const activeCourseId = record.activeCourseId === null
    ? null
    : idAt(record.activeCourseId, 'profile.activeCourseId');
  if (activeCourseId !== null) {
    const activeCourse = courses.find(course => course.id === activeCourseId);
    if (!activeCourse) fail('profile.activeCourseId', 'does not reference a course');
    if (activeCourse?.status !== 'active') fail('profile.activeCourseId', 'must reference an active course');
  } else if (courses.some(course => course.status === 'active')) {
    fail('profile.activeCourseId', 'must reference an active course when one exists');
  }
  return { courses, activeCourseId };
};

export const defaultCoursePreferences = (): CoursePreferences => ({
  pronunciationVariant: null,
  showRomanization: false,
  zhScript: null,
});

export const createLegacyCourseProfile = (
  nativeLanguage: CourseNativeLanguage = 'vi',
): CourseProfile => ({
  courses: [{
    id: nativeLanguage === 'vi' ? LEGACY_COURSE_ID : `legacy-en-${nativeLanguage}`,
    targetLanguage: 'en',
    nativeLanguage,
    status: 'active',
    goals: [],
    preferences: defaultCoursePreferences(),
    createdAt: LEGACY_COURSE_CREATED_AT,
  }],
  activeCourseId: nativeLanguage === 'vi' ? LEGACY_COURSE_ID : `legacy-en-${nativeLanguage}`,
});

export const normalizeCreateCourseInput = (value: unknown): {
  targetLanguage: CourseTargetLanguage;
  nativeLanguage: CourseNativeLanguage;
  goals: readonly CreateGoalInput[];
  preferences: CoursePreferences;
} => {
  const record = optionalRecordAt(value, 'course', [
    'targetLanguage', 'nativeLanguage', 'goals', 'preferences',
  ]);
  const rawGoals = arrayAt(hasOwn(record, 'goals') ? record.goals : [], 'course.goals');
  if (rawGoals.length > MAX_GOALS_PER_COURSE) {
    fail('course.goals', `must contain at most ${MAX_GOALS_PER_COURSE} goals`);
  }
  const goals = rawGoals.map((goalValue, index) => normalizeCreateGoalInput(
    goalValue,
    `course.goals[${index}]`,
  ));
  const goalKinds = new Set(goals.map(goal => goal.kind));
  if (goalKinds.size !== goals.length) fail('course.goals', 'contains duplicate goal kinds');

  const preferencesRecord = hasOwn(record, 'preferences')
    ? optionalRecordAt(
        record.preferences,
        'course.preferences',
        ['pronunciationVariant', 'showRomanization', 'zhScript'],
      )
    : {};
  const preferences = {
    pronunciationVariant: hasOwn(preferencesRecord, 'pronunciationVariant')
      ? nullableTextAt(
          preferencesRecord.pronunciationVariant,
          'course.preferences.pronunciationVariant',
          MAX_PRONUNCIATION_VARIANT_LENGTH,
        )
      : null,
    showRomanization: hasOwn(preferencesRecord, 'showRomanization')
      ? booleanAt(preferencesRecord.showRomanization, 'course.preferences.showRomanization')
      : false,
    zhScript: hasOwn(preferencesRecord, 'zhScript')
      ? preferencesRecord.zhScript === null
        ? null
        : enumAt(preferencesRecord.zhScript, 'course.preferences.zhScript', ['hans', 'hant'] as const)
      : null,
  } satisfies CoursePreferences;

  return {
    targetLanguage: enumAt(record.targetLanguage, 'course.targetLanguage', COURSE_TARGET_LANGUAGES),
    nativeLanguage: enumAt(record.nativeLanguage, 'course.nativeLanguage', COURSE_NATIVE_LANGUAGES),
    goals,
    preferences,
  };
};

export const normalizeUpdateCourseInput = (value: unknown): UpdateCourseInput => {
  const record = optionalRecordAt(value, 'course', ['nativeLanguage', 'preferences']);
  const preferencesRecord = hasOwn(record, 'preferences')
    ? optionalRecordAt(record.preferences, 'course.preferences', [
        'pronunciationVariant', 'showRomanization', 'zhScript',
      ])
    : undefined;
  return {
    ...(hasOwn(record, 'nativeLanguage')
      ? { nativeLanguage: enumAt(record.nativeLanguage, 'course.nativeLanguage', COURSE_NATIVE_LANGUAGES) }
      : {}),
    ...(preferencesRecord
      ? {
          preferences: {
            ...(hasOwn(preferencesRecord, 'pronunciationVariant')
              ? {
                  pronunciationVariant: nullableTextAt(
                    preferencesRecord.pronunciationVariant,
                    'course.preferences.pronunciationVariant',
                    MAX_PRONUNCIATION_VARIANT_LENGTH,
                  ),
                }
              : {}),
            ...(hasOwn(preferencesRecord, 'showRomanization')
              ? { showRomanization: booleanAt(preferencesRecord.showRomanization, 'course.preferences.showRomanization') }
              : {}),
            ...(hasOwn(preferencesRecord, 'zhScript')
              ? {
                  zhScript: preferencesRecord.zhScript === null
                    ? null
                    : enumAt(preferencesRecord.zhScript, 'course.preferences.zhScript', ['hans', 'hant'] as const),
                }
              : {}),
          },
        }
      : {}),
  };
};

export const normalizeUpdateGoalInput = (value: unknown): UpdateGoalInput => {
  const record = optionalRecordAt(value, 'goal', ['level', 'targetDate', 'status']);
  return {
    ...(hasOwn(record, 'level')
      ? { level: nullableTextAt(record.level, 'goal.level', MAX_GOAL_LEVEL_LENGTH) }
      : {}),
    ...(hasOwn(record, 'targetDate')
      ? { targetDate: calendarDateAt(record.targetDate, 'goal.targetDate') }
      : {}),
    ...(hasOwn(record, 'status')
      ? { status: enumAt(record.status, 'goal.status', GOAL_STATUSES) }
      : {}),
  };
};

export function normalizeCreateGoalInput(
  value: unknown,
  path = 'goal',
): CreateGoalInput {
  const record = optionalRecordAt(value, path, ['kind', 'level', 'targetDate']);
  return {
    kind: textAt(record.kind, `${path}.kind`, MAX_GOAL_KIND_LENGTH),
    level: hasOwn(record, 'level')
      ? nullableTextAt(record.level, `${path}.level`, MAX_GOAL_LEVEL_LENGTH)
      : null,
    targetDate: hasOwn(record, 'targetDate')
      ? calendarDateAt(record.targetDate, `${path}.targetDate`)
      : null,
  };
}

export const createCourseRecord = ({
  id,
  input,
  createdAt,
  goals,
}: {
  readonly id: string;
  readonly input: ReturnType<typeof normalizeCreateCourseInput>;
  readonly createdAt: string;
  readonly goals: readonly CourseGoal[];
}): Course => parseCourse({
  id,
  targetLanguage: input.targetLanguage,
  nativeLanguage: input.nativeLanguage,
  status: 'active',
  goals,
  preferences: input.preferences,
  createdAt,
}, 'course');

export const createGoalRecord = ({
  id,
  input,
  createdAt,
}: {
  readonly id: string;
  readonly input: CreateGoalInput;
  readonly createdAt: string;
}): CourseGoal => parseGoal({
  id,
  kind: input.kind,
  level: input.level ?? null,
  targetDate: input.targetDate ?? null,
  status: 'active',
  createdAt,
}, 'goal');

export const parseCourseRecord = (value: unknown): Course => parseCourse(value, 'course');
export const parseGoalRecord = (value: unknown): CourseGoal => parseGoal(value, 'goal');
export const assertOwnerId = (value: unknown, path = 'ownerId'): string => idAt(value, path);
export const assertCourseId = (value: unknown, path = 'courseId'): string => idAt(value, path);
export const assertGoalId = (value: unknown, path = 'goalId'): string => idAt(value, path, MAX_GOAL_ID_LENGTH);

export const courseProfileDocumentKeys = Object.freeze(['courses', 'activeCourseId'] as const);
export const courseDocumentKeys = Object.freeze([
  'id', 'targetLanguage', 'nativeLanguage', 'status', 'goals', 'preferences', 'createdAt',
] as const);
export const goalDocumentKeys = Object.freeze([
  'id', 'kind', 'level', 'targetDate', 'status', 'createdAt',
] as const);
export const preferenceDocumentKeys = Object.freeze([
  'pronunciationVariant', 'showRomanization', 'zhScript',
] as const);
