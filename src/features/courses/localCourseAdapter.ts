import {
  assertOwnerId,
  createLegacyCourseProfile,
  CourseError,
  generateOpaqueId,
  normalizeCreateCourseInput,
  normalizeCreateGoalInput,
  normalizeUpdateCourseInput,
  normalizeUpdateGoalInput,
  parseCourseProfile,
  type CourseNativeLanguage,
  type CourseProfile,
} from './courseModel';
import {
  addGoalToProfile,
  archiveCourseInProfile,
  createCourseInProfile,
  removeGoalFromProfile,
  reopenCourseInProfile,
  setActiveCourseInProfile,
  updateCourseInProfile,
  updateGoalInProfile,
} from './courseOperations';
import type { CoursePort, CourseProfileRead } from './coursePort';

export interface CourseProfileStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const COURSE_PROFILE_STORAGE_KEY = 'sonflash_course_profile_v1';
export const courseProfileStorageKey = (ownerId: string | null): string => ownerId === null
  ? `${COURSE_PROFILE_STORAGE_KEY}:anonymous`
  : `${COURSE_PROFILE_STORAGE_KEY}:user:${encodeURIComponent(assertOwnerId(ownerId))}`;

const browserStorage = (): CourseProfileStorage | null => {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
};

export interface LocalCourseAdapterOptions {
  readonly storage?: CourseProfileStorage | null;
  readonly defaultNativeLanguage?: CourseNativeLanguage;
  readonly getCurrentOwner?: () => string | null;
  readonly createId?: (kind: 'course' | 'goal') => string;
  readonly now?: () => string;
}

export function createLocalCourseAdapter({
  storage: suppliedStorage,
  defaultNativeLanguage = 'vi',
  getCurrentOwner,
  createId = generateOpaqueId,
  now,
}: LocalCourseAdapterOptions = {}): CoursePort {
  const storage = suppliedStorage === undefined ? browserStorage() : suppliedStorage;
  const memory = new Map<string, string>();
  const clock = now;

  const assertCurrentOwner = (ownerId: string | null): void => {
    if (!getCurrentOwner) return;
    const current = getCurrentOwner();
    if (current !== ownerId) {
      throw new CourseError(
        'owner-changed',
        'The course operation belongs to a different owner.',
        { requestedOwnerId: ownerId, currentOwnerId: current },
      );
    }
  };

  const readRaw = (key: string): string | null => {
    try {
      const persisted = storage?.getItem(key);
      if (persisted !== null && persisted !== undefined) return persisted;
    } catch {
      // The in-memory copy remains authoritative for this device session.
    }
    return memory.get(key) ?? null;
  };

  const writeRaw = (key: string, value: string): void => {
    memory.set(key, value);
    try {
      storage?.setItem(key, value);
    } catch {
      // A denied/full browser store does not make the current in-memory session unusable.
    }
  };

  const readProfile = (ownerId: string | null): CourseProfile => {
    const raw = readRaw(courseProfileStorageKey(ownerId));
    if (raw === null) return createLegacyCourseProfile(defaultNativeLanguage);
    try {
      return parseCourseProfile(JSON.parse(raw) as unknown);
    } catch (error) {
      if (error instanceof CourseError) throw error;
      throw new CourseError('local-storage-failed', 'The saved course profile is not readable.', {}, error);
    }
  };

  const writeProfile = (ownerId: string | null, profile: CourseProfile): CourseProfile => {
    const parsed = parseCourseProfile(profile);
    writeRaw(courseProfileStorageKey(ownerId), JSON.stringify(parsed));
    return parsed;
  };

  const mutate = (
    ownerId: string | null,
    update: (profile: CourseProfile) => CourseProfile,
  ): CourseProfile => {
    assertCurrentOwner(ownerId);
    const current = readProfile(ownerId);
    assertCurrentOwner(ownerId);
    const next = update(current);
    assertCurrentOwner(ownerId);
    const persisted = writeProfile(ownerId, next);
    assertCurrentOwner(ownerId);
    return persisted;
  };

  const load = async (ownerId: string | null): Promise<CourseProfileRead> => {
    assertCurrentOwner(ownerId);
    const profile = readProfile(ownerId);
    assertCurrentOwner(ownerId);
    return { source: 'local', profile };
  };

  return {
    available: true,
    load,
    createCourse: async (ownerId, input) => {
      const normalized = normalizeCreateCourseInput(input);
      return mutate(ownerId, profile => createCourseInProfile(profile, normalized, createId, clock));
    },
    updateCourse: async (ownerId, courseId, input) => {
      const normalized = normalizeUpdateCourseInput(input);
      return mutate(ownerId, profile => updateCourseInProfile(profile, courseId, normalized));
    },
    archiveCourse: async (ownerId, courseId) => mutate(
      ownerId,
      profile => archiveCourseInProfile(profile, courseId),
    ),
    reopenCourse: async (ownerId, courseId) => mutate(
      ownerId,
      profile => reopenCourseInProfile(profile, courseId),
    ),
    setActiveCourse: async (ownerId, courseId) => mutate(
      ownerId,
      profile => setActiveCourseInProfile(profile, courseId),
    ),
    addGoal: async (ownerId, courseId, input) => {
      const normalized = normalizeCreateGoalInput(input);
      return mutate(ownerId, profile => addGoalToProfile(profile, courseId, normalized, createId, clock));
    },
    updateGoal: async (ownerId, courseId, goalId, input) => {
      const normalized = normalizeUpdateGoalInput(input);
      return mutate(ownerId, profile => updateGoalInProfile(profile, courseId, goalId, normalized));
    },
    removeGoal: async (ownerId, courseId, goalId) => mutate(
      ownerId,
      profile => removeGoalFromProfile(profile, courseId, goalId),
    ),
  } satisfies CoursePort;
}
