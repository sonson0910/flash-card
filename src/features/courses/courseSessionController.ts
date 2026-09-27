import { CourseError } from './courseModel';
import type {
  Course,
  CourseProfile,
  CreateCourseInput,
  CreateGoalInput,
  UpdateCourseInput,
  UpdateGoalInput,
} from './courseModel';
import type { CoursePort, CourseProfileSource } from './coursePort';

export type CourseSessionStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface CourseSessionSnapshot {
  readonly status: CourseSessionStatus;
  readonly source: CourseProfileSource | null;
  readonly profile: CourseProfile | null;
  readonly activeCourse: Course | null;
  readonly pending: boolean;
  readonly errorCode: string | null;
}

export interface CourseSessionActions {
  createCourse(input: CreateCourseInput): Promise<{ ok: true } | { ok: false; error: CourseError }>;
  updateCourse(courseId: string, input: UpdateCourseInput): Promise<{ ok: true } | { ok: false; error: CourseError }>;
  archiveCourse(courseId: string): Promise<{ ok: true } | { ok: false; error: CourseError }>;
  reopenCourse(courseId: string): Promise<{ ok: true } | { ok: false; error: CourseError }>;
  switchCourse(courseId: string): Promise<{ ok: true } | { ok: false; error: CourseError }>;
  addGoal(courseId: string, input: CreateGoalInput): Promise<{ ok: true } | { ok: false; error: CourseError }>;
  updateGoal(courseId: string, goalId: string, input: UpdateGoalInput): Promise<{ ok: true } | { ok: false; error: CourseError }>;
  removeGoal(courseId: string, goalId: string): Promise<{ ok: true } | { ok: false; error: CourseError }>;
  clearError(): void;
}

export interface CourseSessionController {
  getSnapshot(): CourseSessionSnapshot;
  subscribe(listener: () => void): () => void;
  activate(ownerId: string | null): Promise<void>;
  dispose(): void;
  actions: CourseSessionActions;
}

const idleSnapshot: CourseSessionSnapshot = {
  status: 'idle', source: null, profile: null, activeCourse: null, pending: false, errorCode: null,
};

const activeCourseOf = (profile: CourseProfile | null): Course | null =>
  profile ? profile.courses.find(course => course.id === profile.activeCourseId) ?? null : null;

const asCourseError = (error: unknown): CourseError => error instanceof CourseError
  ? error
  : new CourseError('cloud-write-failed', 'The course operation failed.', {}, error);

/**
 * Framework-free course profile session: one Firestore read on activation
 * (or none, when signed out), zero reads per mutation because every
 * `CoursePort` write returns the whole updated profile already. Mirrors the
 * `sharedDeckSessionController` snapshot/subscribe/actions shape so callers
 * can unit test it without React.
 */
export function createCourseSessionController(
  resolvePort: () => Promise<CoursePort>,
): CourseSessionController {
  let snapshot: CourseSessionSnapshot = idleSnapshot;
  let ownerId: string | null = null;
  let lifecycle = 0;
  let disposed = false;
  const listeners = new Set<() => void>();

  const publish = (patch: Partial<CourseSessionSnapshot>) => {
    if (disposed) return;
    snapshot = { ...snapshot, ...patch };
    listeners.forEach(listener => listener());
  };

  const isCurrent = (operationLifecycle: number, operationOwner: string | null) =>
    !disposed && lifecycle === operationLifecycle && ownerId === operationOwner;

  const activate = async (nextOwnerId: string | null): Promise<void> => {
    if (disposed) return;
    if (nextOwnerId === ownerId && snapshot.status !== 'idle') return;
    ownerId = nextOwnerId;
    const operationLifecycle = ++lifecycle;
    if (nextOwnerId === null) {
      publish({ status: 'idle', source: null, profile: null, activeCourse: null, pending: false, errorCode: null });
      return;
    }
    publish({ status: 'loading', pending: false, errorCode: null });
    try {
      const port = await resolvePort();
      const read = await port.load(nextOwnerId);
      if (!isCurrent(operationLifecycle, nextOwnerId)) return;
      publish({
        status: 'ready',
        source: read.source,
        profile: read.profile,
        activeCourse: activeCourseOf(read.profile),
        errorCode: null,
      });
    } catch (error) {
      if (!isCurrent(operationLifecycle, nextOwnerId)) return;
      publish({ status: 'error', errorCode: asCourseError(error).code });
    }
  };

  const mutate = async (
    run: (port: CoursePort, owner: string) => Promise<CourseProfile>,
  ): Promise<{ ok: true } | { ok: false; error: CourseError }> => {
    const owner = ownerId;
    if (!owner) {
      const error = new CourseError('owner-required', 'A signed-in owner is required for cloud courses.');
      publish({ errorCode: error.code });
      return { ok: false, error };
    }
    const operationLifecycle = lifecycle;
    publish({ pending: true, errorCode: null });
    try {
      const port = await resolvePort();
      const profile = await run(port, owner);
      if (!isCurrent(operationLifecycle, owner)) return { ok: false, error: new CourseError('owner-changed', 'The owner changed mid-operation.') };
      publish({
        status: 'ready', source: 'cloud', profile, activeCourse: activeCourseOf(profile), pending: false, errorCode: null,
      });
      return { ok: true };
    } catch (rawError) {
      const error = asCourseError(rawError);
      if (isCurrent(operationLifecycle, owner)) publish({ pending: false, errorCode: error.code });
      return { ok: false, error };
    }
  };

  const actions: CourseSessionActions = {
    createCourse: input => mutate((port, owner) => port.createCourse(owner, input)),
    updateCourse: (courseId, input) => mutate((port, owner) => port.updateCourse(owner, courseId, input)),
    archiveCourse: courseId => mutate((port, owner) => port.archiveCourse(owner, courseId)),
    reopenCourse: courseId => mutate((port, owner) => port.reopenCourse(owner, courseId)),
    switchCourse: courseId => mutate((port, owner) => port.setActiveCourse(owner, courseId)),
    addGoal: (courseId, input) => mutate((port, owner) => port.addGoal(owner, courseId, input)),
    updateGoal: (courseId, goalId, input) => mutate((port, owner) => port.updateGoal(owner, courseId, goalId, input)),
    removeGoal: (courseId, goalId) => mutate((port, owner) => port.removeGoal(owner, courseId, goalId)),
    clearError: () => publish({ errorCode: null }),
  };

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    activate,
    dispose() {
      if (disposed) return;
      disposed = true;
      lifecycle += 1;
      listeners.clear();
    },
    actions,
  };
}
