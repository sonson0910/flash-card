import { describe, expect, it, vi } from 'vitest';
import { CourseError } from './courseModel';
import type { Course, CourseProfile } from './courseModel';
import type { CoursePort, CourseProfileRead } from './coursePort';
import { createCourseSessionController } from './courseSessionController';

const makeCourse = (id: string, overrides: Partial<Course> = {}): Course => ({
  id,
  targetLanguage: 'en',
  nativeLanguage: 'vi',
  status: 'active',
  goals: [],
  preferences: { pronunciationVariant: null, showRomanization: false, zhScript: null },
  createdAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

const makeProfile = (activeCourseId: string, courses: readonly Course[] = [makeCourse(activeCourseId)]): CourseProfile => ({
  activeCourseId, courses,
});

interface Deferred<T> { promise: Promise<T>; resolve: (value: T) => void; reject: (error: unknown) => void }
const deferred = <T>(): Deferred<T> => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

function createFakePort(load: (ownerId: string | null) => Promise<CourseProfileRead>): CoursePort {
  const notImplemented = () => Promise.reject(new Error('not used in this test'));
  return {
    available: true,
    load: vi.fn(load),
    createCourse: vi.fn(notImplemented),
    updateCourse: vi.fn(notImplemented),
    archiveCourse: vi.fn(notImplemented),
    reopenCourse: vi.fn(notImplemented),
    setActiveCourse: vi.fn(notImplemented),
    addGoal: vi.fn(notImplemented),
    updateGoal: vi.fn(notImplemented),
    removeGoal: vi.fn(notImplemented),
  };
}

describe('createCourseSessionController', () => {
  it('starts idle and stays idle for a null owner', async () => {
    const port = createFakePort(async () => ({ source: 'cloud', profile: makeProfile('course-en') }));
    const controller = createCourseSessionController(async () => port);
    await controller.activate(null);
    expect(controller.getSnapshot().status).toBe('idle');
    expect(controller.getSnapshot().profile).toBeNull();
  });

  it('becomes ready with the active course resolved once load succeeds', async () => {
    const profile = makeProfile('course-en');
    const port = createFakePort(async () => ({ source: 'cloud', profile }));
    const controller = createCourseSessionController(async () => port);
    await controller.activate('owner-1');
    const snapshot = controller.getSnapshot();
    expect(snapshot.status).toBe('ready');
    expect(snapshot.source).toBe('cloud');
    expect(snapshot.activeCourse?.id).toBe('course-en');
  });

  it('surfaces a CourseError code when load fails', async () => {
    const port = createFakePort(async () => { throw new CourseError('cloud-read-failed', 'boom'); });
    const controller = createCourseSessionController(async () => port);
    await controller.activate('owner-1');
    const snapshot = controller.getSnapshot();
    expect(snapshot.status).toBe('error');
    expect(snapshot.errorCode).toBe('cloud-read-failed');
  });

  it('discards a stale load when the owner changes before it resolves', async () => {
    const firstLoad = deferred<CourseProfileRead>();
    const secondProfile = makeProfile('course-ko', [makeCourse('course-ko', { targetLanguage: 'ko' })]);
    const port = createFakePort(ownerId => ownerId === 'owner-a' ? firstLoad.promise : Promise.resolve({ source: 'cloud', profile: secondProfile }));
    const controller = createCourseSessionController(async () => port);

    const firstActivate = controller.activate('owner-a');
    const secondActivate = controller.activate('owner-b');
    firstLoad.resolve({ source: 'cloud', profile: makeProfile('course-en') });
    await Promise.all([firstActivate, secondActivate]);

    const snapshot = controller.getSnapshot();
    expect(snapshot.status).toBe('ready');
    expect(snapshot.activeCourse?.id).toBe('course-ko');
  });

  it('rejects a mutation with owner-required and never calls the port when no owner is active', async () => {
    const port = createFakePort(async () => ({ source: 'cloud', profile: makeProfile('course-en') }));
    const controller = createCourseSessionController(async () => port);
    const result = await controller.actions.createCourse({ targetLanguage: 'ko', nativeLanguage: 'vi' });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe('owner-required');
    expect(port.createCourse).not.toHaveBeenCalled();
  });

  it('applies a successful mutation directly from the callable response, without a re-read', async () => {
    const initialProfile = makeProfile('course-en');
    const updatedProfile = makeProfile('course-en', [makeCourse('course-en'), makeCourse('course-ko', { targetLanguage: 'ko' })]);
    const port = createFakePort(async () => ({ source: 'cloud', profile: initialProfile }));
    (port.createCourse as ReturnType<typeof vi.fn>).mockResolvedValue(updatedProfile);
    const controller = createCourseSessionController(async () => port);
    await controller.activate('owner-1');

    const result = await controller.actions.createCourse({ targetLanguage: 'ko', nativeLanguage: 'vi' });
    expect(result.ok).toBe(true);
    expect(port.load).toHaveBeenCalledTimes(1);
    expect(controller.getSnapshot().profile?.courses).toHaveLength(2);
    expect(controller.getSnapshot().pending).toBe(false);
  });

  it('drops a mutation whose owner changed before the callable resolved', async () => {
    const initialProfile = makeProfile('course-en');
    const port = createFakePort(async () => ({ source: 'cloud', profile: initialProfile }));
    const pendingCreate = deferred<CourseProfile>();
    (port.createCourse as ReturnType<typeof vi.fn>).mockReturnValue(pendingCreate.promise);
    const controller = createCourseSessionController(async () => port);
    await controller.activate('owner-1');

    const mutation = controller.actions.createCourse({ targetLanguage: 'ko', nativeLanguage: 'vi' });
    await controller.activate('owner-2');
    pendingCreate.resolve(makeProfile('course-en', [makeCourse('course-en'), makeCourse('course-ko', { targetLanguage: 'ko' })]));
    const result = await mutation;

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe('owner-changed');
  });

  it('stops publishing to listeners after dispose', async () => {
    const port = createFakePort(async () => ({ source: 'cloud', profile: makeProfile('course-en') }));
    const controller = createCourseSessionController(async () => port);
    const listener = vi.fn();
    controller.subscribe(listener);
    controller.dispose();
    await controller.activate('owner-1');
    expect(listener).not.toHaveBeenCalled();
    expect(controller.getSnapshot().status).toBe('idle');
  });
});
