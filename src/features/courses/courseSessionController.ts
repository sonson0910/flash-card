import { CourseError, generateOpaqueId } from './courseModel';
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
  readonly ownerId?: string | null;
  readonly status: CourseSessionStatus;
  readonly source: CourseProfileSource | null;
  readonly profile: CourseProfile | null;
  readonly activeCourse: Course | null;
  readonly pending: boolean;
  readonly errorCode: string | null;
}

export interface CourseSessionActions {
  retry(): Promise<void>;
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
  ownerId: null, status: 'idle', source: null, profile: null, activeCourse: null, pending: false, errorCode: null,
};

const activeCourseOf = (profile: CourseProfile | null): Course | null =>
  profile ? profile.courses.find(course => course.id === profile.activeCourseId) ?? null : null;

const asCourseError = (error: unknown): CourseError => error instanceof CourseError
  ? error
  : new CourseError('cloud-write-failed', 'The course operation failed.', {}, error);

const sameCreateInput = (left: CreateCourseInput, right: CreateCourseInput): boolean => {
  const { operationId: _operationId, ...leftWithoutOperationId } = left;
  const { operationId: _otherOperationId, ...rightWithoutOperationId } = right;
  return JSON.stringify(leftWithoutOperationId) === JSON.stringify(rightWithoutOperationId);
};

/**
 * Framework-free course profile session: one Firestore listener read on
 * activation (or none, when signed out), with a load fallback for ports that
 * cannot subscribe.
 * Every `CoursePort` write returns the whole updated profile already. Mirrors the
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
  let unsubscribeProfile: (() => void) | null = null;
  let finishInitialSubscription: (() => void) | null = null;
  let hasProfileSubscription = false;
  let pendingMutationCount = 0;
  const retryableCreates = new Map<string, CreateCourseInput[]>();
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
    if (nextOwnerId === ownerId && snapshot.status !== 'idle' && snapshot.status !== 'error') return;
    const ownerChanged = nextOwnerId !== ownerId;
    unsubscribeProfile?.();
    unsubscribeProfile = null;
    finishInitialSubscription?.();
    finishInitialSubscription = null;
    hasProfileSubscription = false;
    pendingMutationCount = 0;
    ownerId = nextOwnerId;
    const operationLifecycle = ++lifecycle;
    if (nextOwnerId === null) {
      publish({ ownerId: null, status: 'idle', source: null, profile: null, activeCourse: null, pending: false, errorCode: null });
      return;
    }
    publish({ ownerId: nextOwnerId, status: 'loading', pending: false, errorCode: null, ...(ownerChanged
      ? { source: null, profile: null, activeCourse: null }
      : {}) });
    try {
      const port = await resolvePort();
      if (!isCurrent(operationLifecycle, nextOwnerId)) return;
      if (port.subscribe) {
        hasProfileSubscription = true;
        await new Promise<void>(resolve => {
          let receivedInitialSnapshot = false;
          const finishInitialSnapshot = () => {
            if (receivedInitialSnapshot) return;
            receivedInitialSnapshot = true;
            if (finishInitialSubscription === finishInitialSnapshot) finishInitialSubscription = null;
            resolve();
          };
          finishInitialSubscription = finishInitialSnapshot;
          const stop = port.subscribe?.(
            nextOwnerId,
            update => {
              if (isCurrent(operationLifecycle, nextOwnerId)) {
                publish({
                  status: 'ready',
                  source: update.source,
                  profile: update.profile,
                  activeCourse: activeCourseOf(update.profile),
                  errorCode: null,
                });
              }
              finishInitialSnapshot();
            },
            error => {
              if (isCurrent(operationLifecycle, nextOwnerId)) {
                publish({ status: 'error', errorCode: error.code });
              }
              finishInitialSnapshot();
            },
          ) ?? null;
          if (isCurrent(operationLifecycle, nextOwnerId)) unsubscribeProfile = stop;
          else stop?.();
        });
        if (!isCurrent(operationLifecycle, nextOwnerId)) return;
      } else {
        const read = await port.load(nextOwnerId);
        if (!isCurrent(operationLifecycle, nextOwnerId)) return;
        publish({
          status: 'ready',
          source: read.source,
          profile: read.profile,
          activeCourse: activeCourseOf(read.profile),
          errorCode: null,
        });
      }
    } catch (error) {
      if (!isCurrent(operationLifecycle, nextOwnerId)) return;
      finishInitialSubscription = null;
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
    pendingMutationCount += 1;
    publish({ pending: true, errorCode: null });
    try {
      const port = await resolvePort();
      const profile = await run(port, owner);
      if (!isCurrent(operationLifecycle, owner)) return { ok: false, error: new CourseError('owner-changed', 'The owner changed mid-operation.') };
      pendingMutationCount -= 1;
      // A callable response can arrive after a newer listener snapshot.
      publish(hasProfileSubscription
        ? { pending: pendingMutationCount > 0 }
        : {
            status: 'ready', source: 'cloud', profile, activeCourse: activeCourseOf(profile),
            pending: pendingMutationCount > 0, errorCode: null,
          });
      return { ok: true };
    } catch (rawError) {
      const error = asCourseError(rawError);
      if (isCurrent(operationLifecycle, owner)) {
        pendingMutationCount -= 1;
        publish({ pending: pendingMutationCount > 0, errorCode: error.code });
      }
      return { ok: false, error };
    }
  };

  const actions: CourseSessionActions = {
    retry: () => activate(ownerId),
    createCourse: async input => {
      const owner = ownerId;
      const ownerRetryableCreates = owner === null ? [] : retryableCreates.get(owner) ?? [];
      const retryableCreate = input.operationId
        ? null
        : ownerRetryableCreates.find(candidate => sameCreateInput(candidate, input)) ?? null;
      const request = input.operationId
        ? input
        : retryableCreate ?? { ...input, operationId: generateOpaqueId('course') };
      if (owner !== null && !retryableCreate) {
        retryableCreates.set(owner, [...ownerRetryableCreates, request]);
      }
      const result = await mutate((port, owner) => port.createCourse(owner, request));
      if (owner !== null) {
        const remaining = (retryableCreates.get(owner) ?? [])
          .filter(candidate => !sameCreateInput(candidate, request));
        if (!result.ok && result.error.code === 'cloud-write-failed') remaining.push(request);
        if (remaining.length) retryableCreates.set(owner, remaining);
        else retryableCreates.delete(owner);
      }
      return result;
    },
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
      unsubscribeProfile?.();
      unsubscribeProfile = null;
      finishInitialSubscription?.();
      finishInitialSubscription = null;
      hasProfileSubscription = false;
      pendingMutationCount = 0;
      listeners.clear();
    },
    actions,
  };
}
