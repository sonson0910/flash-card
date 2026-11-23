import type { FirebaseApp } from 'firebase/app';
import { doc, getDoc, onSnapshot, type Firestore } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { getSonFlashFunctions } from '../../lib/firebase';
import {
  assertCourseId,
  assertGoalId,
  assertOwnerId,
  CourseError,
  createLegacyCourseProfile,
  normalizeCreateCourseInput,
  normalizeCreateGoalInput,
  normalizeUpdateCourseInput,
  normalizeUpdateGoalInput,
  parseCourseProfile,
  type CourseProfile,
} from './courseModel';
import type { CoursePort, CourseProfileRead, CreatedCourseIds } from './coursePort';

type CourseCallable = (name: string, payload: unknown) => Promise<unknown>;

export interface FirebaseCourseAdapterOptions {
  readonly app: FirebaseApp | null;
  readonly database: Firestore | null;
  readonly configured?: boolean;
  readonly getCurrentOwner?: () => string | null;
  readonly call?: CourseCallable;
  readonly functionsRegion?: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const errorCode = (error: unknown): string => {
  if (!isRecord(error)) return '';
  if (isRecord(error.details)) {
    if (typeof error.details.reason === 'string') return error.details.reason;
    if (typeof error.details.code === 'string') return error.details.code;
  }
  const direct = typeof error.code === 'string' ? error.code : '';
  if (direct) return direct.replace(/^functions\//, '').replace(/^firebase\//, '');
  return '';
};

const errorDetails = (error: unknown): Record<string, unknown> => {
  if (!isRecord(error)) return {};
  if (isRecord(error.details)) return error.details;
  return {};
};

/**
 * The ids of the course and goals a create produced. The server names them in `created`; a server
 * one release older does not, and then the same ids are read from the returned profile, which is
 * exact because target languages are unique per profile and goal kinds unique per course. Either
 * way only ids the returned profile holds are reported.
 */
const createdCourseIds = (
  profile: CourseProfile,
  input: ReturnType<typeof normalizeCreateCourseInput>,
  reported: unknown,
): CreatedCourseIds | null => {
  const reportedCourseId = isRecord(reported) && typeof reported.courseId === 'string' ? reported.courseId : null;
  const course = profile.courses.find(candidate => reportedCourseId === null
    ? candidate.targetLanguage === input.targetLanguage
    : candidate.id === reportedCourseId && candidate.targetLanguage === input.targetLanguage);
  if (!course) return null;
  const reportedGoals = isRecord(reported) && Array.isArray(reported.goals) ? reported.goals : [];
  const goals = input.goals.flatMap(requested => {
    const named = reportedGoals.find(entry => isRecord(entry) && entry.kind === requested.kind);
    const goal = course.goals.find(candidate => candidate.kind === requested.kind
      && (!isRecord(named) || candidate.id === named.id));
    return goal ? [{ kind: goal.kind, id: goal.id }] : [];
  });
  return { courseId: course.id, goals };
};

const courseErrorCodes = new Set([
  'course-exists', 'course-limit', 'course-not-found', 'course-archived',
  'goal-exists', 'goal-not-found', 'profile-invalid', 'owner-required', 'owner-changed',
]);

export function createFirebaseCourseAdapter({
  app,
  database,
  configured = Boolean(database),
  getCurrentOwner,
  call: suppliedCall,
  functionsRegion = 'asia-southeast1',
}: FirebaseCourseAdapterOptions): CoursePort {
  const available = Boolean(configured && database);

  const requireDatabase = (): Firestore => {
    if (!available || !database) {
      throw new CourseError('cloud-unavailable', 'Cloud course storage is not configured.');
    }
    return database;
  };

  const requireOwner = (ownerId: string | null): string => {
    if (ownerId === null) throw new CourseError('owner-required', 'A signed-in owner is required for cloud courses.');
    return assertOwnerId(ownerId);
  };

  const assertCurrentOwner = (ownerId: string): void => {
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

  const call = suppliedCall ?? (async (name: string, payload: unknown): Promise<unknown> => {
    if (!app) throw new CourseError('cloud-unavailable', 'Cloud course functions are not configured.');
    const callable = httpsCallable<unknown, unknown>(await getSonFlashFunctions(app, functionsRegion), name);
    const response = await callable(payload);
    return response.data;
  });

  const parseCallableProfile = (value: unknown): CourseProfile => {
    const source = isRecord(value) && Object.prototype.hasOwnProperty.call(value, 'profile')
      ? value.profile
      : value;
    return parseCourseProfile(source);
  };

  const invokeCallable = async <T>(
    ownerId: string | null,
    name: string,
    payload: unknown,
    parse: (value: unknown) => T,
  ): Promise<T> => {
    const owner = requireOwner(ownerId);
    requireDatabase();
    assertCurrentOwner(owner);
    try {
      const result = await call(name, payload);
      assertCurrentOwner(owner);
      return parse(result);
    } catch (error) {
      assertCurrentOwner(owner);
      if (error instanceof CourseError) throw error;
      const code = errorCode(error);
      if (courseErrorCodes.has(code)) {
        throw new CourseError(code as CourseError['code'], 'The cloud course operation was rejected.', errorDetails(error), error);
      }
      throw new CourseError('cloud-write-failed', 'The cloud course operation failed.', {}, error);
    }
  };

  const invokeMutation = (ownerId: string | null, name: string, payload: unknown): Promise<CourseProfile> =>
    invokeCallable(ownerId, name, payload, parseCallableProfile);

  const load = async (ownerId: string | null): Promise<CourseProfileRead> => {
    const owner = requireOwner(ownerId);
    const databaseInstance = requireDatabase();
    assertCurrentOwner(owner);
    try {
      const snapshot = await getDoc(doc(databaseInstance, 'users', owner, 'profile', 'courses'));
      assertCurrentOwner(owner);
      if (!snapshot.exists()) return { source: 'absent', profile: createLegacyCourseProfile() };
      try {
        return { source: 'cloud', profile: parseCourseProfile(snapshot.data()) };
      } catch (error) {
        if (error instanceof CourseError) throw error;
        throw new CourseError('profile-invalid', 'The cloud course profile is invalid.', {}, error);
      }
    } catch (error) {
      assertCurrentOwner(owner);
      if (error instanceof CourseError) throw error;
      throw new CourseError('cloud-read-failed', 'The cloud course profile could not be read.', {}, error);
    }
  };

  const subscribe = (
    ownerId: string | null,
    onProfile: (read: CourseProfileRead) => void,
    onError: (error: CourseError) => void,
  ): (() => void) => {
    const owner = requireOwner(ownerId);
    const databaseInstance = requireDatabase();
    assertCurrentOwner(owner);
    return onSnapshot(
      doc(databaseInstance, 'users', owner, 'profile', 'courses'),
      snapshot => {
        try {
          assertCurrentOwner(owner);
          onProfile(snapshot.exists()
            ? { source: 'cloud', profile: parseCourseProfile(snapshot.data()) }
            : { source: 'absent', profile: createLegacyCourseProfile() });
        } catch (error) {
          onError(error instanceof CourseError
            ? error
            : new CourseError('profile-invalid', 'The cloud course profile is invalid.', {}, error));
        }
      },
      error => {
        try {
          assertCurrentOwner(owner);
          onError(new CourseError('cloud-read-failed', 'The cloud course profile could not be read.', {}, error));
        } catch (ownerError) {
          onError(ownerError instanceof CourseError
            ? ownerError
            : new CourseError('cloud-read-failed', 'The cloud course profile could not be read.', {}, ownerError));
        }
      },
    );
  };

  return {
    available,
    load,
    subscribe,
    createCourse: async (ownerId, input) => {
      const normalized = normalizeCreateCourseInput(input);
      return invokeCallable(ownerId, 'createCourse', {
        ownerId: ownerId === null ? null : assertOwnerId(ownerId),
        input: normalized,
      }, value => {
        const profile = parseCallableProfile(value);
        return { profile, created: createdCourseIds(profile, normalized, isRecord(value) ? value.created : undefined) };
      });
    },
    updateCourse: async (ownerId, courseId, input) => {
      const normalized = normalizeUpdateCourseInput(input);
      return invokeMutation(ownerId, 'updateCourse', {
        ownerId: ownerId === null ? null : assertOwnerId(ownerId),
        courseId: assertCourseId(courseId),
        input: normalized,
      });
    },
    archiveCourse: async (ownerId, courseId) => invokeMutation(ownerId, 'archiveCourse', {
      ownerId: ownerId === null ? null : assertOwnerId(ownerId),
      courseId: assertCourseId(courseId),
    }),
    reopenCourse: async (ownerId, courseId) => invokeMutation(ownerId, 'reopenCourse', {
      ownerId: ownerId === null ? null : assertOwnerId(ownerId),
      courseId: assertCourseId(courseId),
    }),
    setActiveCourse: async (ownerId, courseId) => invokeMutation(ownerId, 'setActiveCourse', {
      ownerId: ownerId === null ? null : assertOwnerId(ownerId),
      courseId: assertCourseId(courseId),
    }),
    addGoal: async (ownerId, courseId, input) => {
      const normalized = normalizeCreateGoalInput(input);
      return invokeMutation(ownerId, 'addGoal', {
        ownerId: ownerId === null ? null : assertOwnerId(ownerId),
        courseId: assertCourseId(courseId),
        input: normalized,
      });
    },
    updateGoal: async (ownerId, courseId, goalId, input) => {
      const normalized = normalizeUpdateGoalInput(input);
      return invokeMutation(ownerId, 'updateGoal', {
        ownerId: ownerId === null ? null : assertOwnerId(ownerId),
        courseId: assertCourseId(courseId),
        goalId: assertGoalId(goalId),
        input: normalized,
      });
    },
    removeGoal: async (ownerId, courseId, goalId) => invokeMutation(ownerId, 'removeGoal', {
      ownerId: ownerId === null ? null : assertOwnerId(ownerId),
      courseId: assertCourseId(courseId),
      goalId: assertGoalId(goalId),
    }),
  } satisfies CoursePort;
}
