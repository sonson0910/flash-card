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

  it('keeps pending true until concurrent mutations settle', async () => {
    const profile = makeProfile('course-en');
    const port = createFakePort(async () => ({ source: 'cloud', profile }));
    const firstUpdate = deferred<CourseProfile>();
    const secondUpdate = deferred<CourseProfile>();
    (port.updateCourse as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce(firstUpdate.promise)
      .mockReturnValueOnce(secondUpdate.promise);
    const controller = createCourseSessionController(async () => port);
    await controller.activate('owner-1');

    const firstMutation = controller.actions.updateCourse('course-en', { preferences: { showRomanization: true } });
    const secondMutation = controller.actions.updateCourse('course-en', { preferences: { zhScript: 'hans' } });
    await vi.waitFor(() => expect(port.updateCourse).toHaveBeenCalledTimes(2));
    expect(controller.getSnapshot().pending).toBe(true);

    firstUpdate.resolve(profile);
    await expect(firstMutation).resolves.toEqual({ ok: true });
    expect(controller.getSnapshot().pending).toBe(true);

    secondUpdate.reject(new CourseError('cloud-write-failed', 'second write failed'));
    await expect(secondMutation).resolves.toMatchObject({ ok: false, error: { code: 'cloud-write-failed' } });
    expect(controller.getSnapshot()).toMatchObject({ pending: false, errorCode: 'cloud-write-failed' });
  });

  it('publishes a course profile changed on another device', async () => {
    const initialProfile = makeProfile('course-en');
    const remoteProfile = makeProfile('course-ko', [
      makeCourse('course-en'), makeCourse('course-ko', { targetLanguage: 'ko' }),
    ]);
    const port = createFakePort(async () => ({ source: 'cloud', profile: initialProfile }));
    let publishRemote!: (read: CourseProfileRead) => void;
    const stop = vi.fn();
    port.subscribe = vi.fn((_owner, listener) => {
      publishRemote = listener;
      listener({ source: 'cloud', profile: initialProfile });
      return stop;
    });
    const controller = createCourseSessionController(async () => port);

    await controller.activate('owner-1');
    publishRemote({ source: 'cloud', profile: remoteProfile });

    expect(controller.getSnapshot()).toMatchObject({
      status: 'ready', activeCourse: { id: 'course-ko' }, profile: remoteProfile,
    });
    await controller.activate(null);
    expect(stop).toHaveBeenCalledOnce();
  });

  it('does not replace a newer subscription profile with a late callable response', async () => {
    const initialProfile = makeProfile('course-en');
    const callableProfile = makeProfile('course-en', [makeCourse('course-en', {
      preferences: { pronunciationVariant: null, showRomanization: true, zhScript: null },
    })]);
    const newerProfile = makeProfile('course-en', [makeCourse('course-en', {
      preferences: { pronunciationVariant: 'voice-a', showRomanization: true, zhScript: null },
    })]);
    const port = createFakePort(async () => ({ source: 'cloud', profile: initialProfile }));
    let publishRemote!: (read: CourseProfileRead) => void;
    port.subscribe = vi.fn((_owner, listener) => {
      publishRemote = listener;
      listener({ source: 'cloud', profile: initialProfile });
      return vi.fn();
    });
    const pendingUpdate = deferred<CourseProfile>();
    (port.updateCourse as ReturnType<typeof vi.fn>).mockReturnValue(pendingUpdate.promise);
    const controller = createCourseSessionController(async () => port);
    await controller.activate('owner-1');

    const mutation = controller.actions.updateCourse('course-en', { preferences: { showRomanization: true } });
    await vi.waitFor(() => expect(port.updateCourse).toHaveBeenCalledOnce());
    publishRemote({ source: 'cloud', profile: newerProfile });
    pendingUpdate.resolve(callableProfile);
    await mutation;

    expect(controller.getSnapshot()).toMatchObject({ profile: newerProfile, pending: false });
  });

  it('waits for the subscribed profile when a callable response arrives first', async () => {
    const initialProfile = makeProfile('course-en');
    const updatedProfile = makeProfile('course-ko', [
      makeCourse('course-en'), makeCourse('course-ko', { targetLanguage: 'ko' }),
    ]);
    const port = createFakePort(async () => ({ source: 'cloud', profile: initialProfile }));
    let publishRemote!: (read: CourseProfileRead) => void;
    port.subscribe = vi.fn((_owner, listener) => {
      publishRemote = listener;
      listener({ source: 'cloud', profile: initialProfile });
      return vi.fn();
    });
    (port.setActiveCourse as ReturnType<typeof vi.fn>).mockResolvedValue(updatedProfile);
    const controller = createCourseSessionController(async () => port);
    await controller.activate('owner-1');

    expect(await controller.actions.switchCourse('course-ko')).toEqual({ ok: true });
    expect(controller.getSnapshot()).toMatchObject({ profile: initialProfile, pending: false });
    publishRemote({ source: 'cloud', profile: updatedProfile });
    expect(controller.getSnapshot()).toMatchObject({ profile: updatedProfile, activeCourse: { id: 'course-ko' } });
  });

  it('keeps a subscription error visible when the callable later succeeds', async () => {
    const profile = makeProfile('course-en');
    const port = createFakePort(async () => ({ source: 'cloud', profile }));
    let publishError!: (error: CourseError) => void;
    port.subscribe = vi.fn((_owner, onProfile, onError) => {
      publishError = onError;
      onProfile({ source: 'cloud', profile });
      return vi.fn();
    });
    const pendingUpdate = deferred<CourseProfile>();
    (port.updateCourse as ReturnType<typeof vi.fn>).mockReturnValue(pendingUpdate.promise);
    const controller = createCourseSessionController(async () => port);
    await controller.activate('owner-1');

    const mutation = controller.actions.updateCourse('course-en', { preferences: { showRomanization: true } });
    await vi.waitFor(() => expect(port.updateCourse).toHaveBeenCalledOnce());
    publishError(new CourseError('cloud-read-failed', 'listener failed'));
    pendingUpdate.resolve(profile);
    expect(await mutation).toEqual({ ok: true });
    expect(controller.getSnapshot()).toMatchObject({ status: 'error', errorCode: 'cloud-read-failed', pending: false });

    await controller.activate('owner-1');
    expect(port.subscribe).toHaveBeenCalledTimes(2);
    expect(controller.getSnapshot()).toMatchObject({ status: 'ready', errorCode: null });
  });

  it('retries a failed create with the same operation ID', async () => {
    const port = createFakePort(async () => ({ source: 'cloud', profile: makeProfile('course-en') }));
    (port.createCourse as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new CourseError('cloud-write-failed', 'response lost'))
      .mockResolvedValueOnce(makeProfile('course-en'));
    const controller = createCourseSessionController(async () => port);
    await controller.activate('owner-1');

    await controller.actions.createCourse({ targetLanguage: 'ko', nativeLanguage: 'vi' });
    await controller.actions.createCourse({ targetLanguage: 'ko', nativeLanguage: 'vi' });

    const [first] = (port.createCourse as ReturnType<typeof vi.fn>).mock.calls[0] ?? [];
    const [, secondInput] = (port.createCourse as ReturnType<typeof vi.fn>).mock.calls[1] ?? [];
    expect(first).toBe('owner-1');
    expect(secondInput).toMatchObject({ operationId: expect.any(String) });
    expect(secondInput).toEqual((port.createCourse as ReturnType<typeof vi.fn>).mock.calls[0]?.[1]);
  });

  it('keeps retry operation IDs isolated for interleaved owners', async () => {
    const port = createFakePort(async owner => ({
      source: 'cloud', profile: makeProfile(owner === 'owner-b' ? 'course-ko' : 'course-en'),
    }));
    (port.createCourse as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new CourseError('cloud-write-failed', 'response lost for A'))
      .mockRejectedValueOnce(new CourseError('cloud-write-failed', 'response lost for B'))
      .mockResolvedValueOnce(makeProfile('course-en'));
    const controller = createCourseSessionController(async () => port);
    const input = { targetLanguage: 'ko' as const, nativeLanguage: 'vi' as const };

    await controller.activate('owner-a');
    await controller.actions.createCourse(input);
    await controller.activate('owner-b');
    await controller.actions.createCourse(input);
    await controller.activate('owner-a');
    await controller.actions.createCourse(input);

    const calls = (port.createCourse as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[0]?.[0]).toBe('owner-a');
    expect(calls[1]?.[0]).toBe('owner-b');
    expect(calls[2]?.[0]).toBe('owner-a');
    expect(calls[2]?.[1]).toEqual(calls[0]?.[1]);
    expect(calls[1]?.[1]).not.toEqual(calls[0]?.[1]);
  });

  it('keeps a separate retry operation ID for each failed create of one owner', async () => {
    const port = createFakePort(async () => ({ source: 'cloud', profile: makeProfile('course-en') }));
    (port.createCourse as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new CourseError('cloud-write-failed', 'response lost for Korean'))
      .mockRejectedValueOnce(new CourseError('cloud-write-failed', 'response lost for Japanese'))
      .mockResolvedValueOnce(makeProfile('course-en'))
      .mockResolvedValueOnce(makeProfile('course-en'));
    const controller = createCourseSessionController(async () => port);
    const korean = { targetLanguage: 'ko' as const, nativeLanguage: 'vi' as const };
    const japanese = { targetLanguage: 'ja' as const, nativeLanguage: 'vi' as const };
    await controller.activate('owner-a');

    await controller.actions.createCourse(korean);
    await controller.actions.createCourse(japanese);
    await controller.actions.createCourse(korean);
    await controller.actions.createCourse(japanese);

    const calls = (port.createCourse as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[2]?.[1]).toEqual(calls[0]?.[1]);
    expect(calls[3]?.[1]).toEqual(calls[1]?.[1]);
  });

  it('keeps concurrent failed creates retryable for one owner', async () => {
    const port = createFakePort(async () => ({ source: 'cloud', profile: makeProfile('course-en') }));
    (port.createCourse as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new CourseError('cloud-write-failed', 'response lost for Korean'))
      .mockRejectedValueOnce(new CourseError('cloud-write-failed', 'response lost for Japanese'))
      .mockResolvedValueOnce(makeProfile('course-en'))
      .mockResolvedValueOnce(makeProfile('course-en'));
    const controller = createCourseSessionController(async () => port);
    const korean = { targetLanguage: 'ko' as const, nativeLanguage: 'vi' as const };
    const japanese = { targetLanguage: 'ja' as const, nativeLanguage: 'vi' as const };
    await controller.activate('owner-a');

    await Promise.all([controller.actions.createCourse(korean), controller.actions.createCourse(japanese)]);
    await controller.actions.createCourse(korean);
    await controller.actions.createCourse(japanese);

    const calls = (port.createCourse as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[2]?.[1]).toEqual(calls[0]?.[1]);
    expect(calls[3]?.[1]).toEqual(calls[1]?.[1]);
  });

  it('shares an operation ID for concurrent creates with the same input', async () => {
    const port = createFakePort(async () => ({ source: 'cloud', profile: makeProfile('course-en') }));
    (port.createCourse as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new CourseError('cloud-write-failed', 'first response lost'))
      .mockRejectedValueOnce(new CourseError('cloud-write-failed', 'second response lost'))
      .mockResolvedValueOnce(makeProfile('course-en'));
    const controller = createCourseSessionController(async () => port);
    const korean = { targetLanguage: 'ko' as const, nativeLanguage: 'vi' as const };
    await controller.activate('owner-a');

    await Promise.all([controller.actions.createCourse(korean), controller.actions.createCourse(korean)]);
    await controller.actions.createCourse(korean);

    const calls = (port.createCourse as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[1]?.[1]).toEqual(calls[0]?.[1]);
    expect(calls[2]?.[1]).toEqual(calls[0]?.[1]);
  });

  it('uses a subscription initial snapshot without a second profile read', async () => {
    const profile = makeProfile('course-en');
    const port = createFakePort(async () => { throw new Error('load must not run'); });
    port.subscribe = vi.fn((_owner, listener) => {
      listener({ source: 'cloud', profile });
      return vi.fn();
    });
    const controller = createCourseSessionController(async () => port);

    await controller.activate('owner-1');

    expect(port.load).not.toHaveBeenCalled();
    expect(controller.getSnapshot()).toMatchObject({ status: 'ready', profile });
  });

  it('stops a previous owner subscription before its first snapshot arrives', async () => {
    const port = createFakePort(async () => { throw new Error('load must not run'); });
    const stopFirst = vi.fn();
    port.subscribe = vi.fn((owner, onProfile) => {
      if (owner === 'owner-a') return stopFirst;
      onProfile({ source: 'cloud', profile: makeProfile('course-ko') });
      return vi.fn();
    });
    const controller = createCourseSessionController(async () => port);

    const firstActivation = controller.activate('owner-a');
    await vi.waitFor(() => expect(port.subscribe).toHaveBeenCalledOnce());
    await controller.activate('owner-b');

    expect(stopFirst).toHaveBeenCalledOnce();
    await firstActivation;
    expect(controller.getSnapshot()).toMatchObject({ status: 'ready', activeCourse: { id: 'course-ko' } });
  });

  it('clears the previous owner course while the next owner is loading or fails', async () => {
    const port = createFakePort(async () => { throw new Error('load must not run'); });
    let failSecond!: (error: CourseError) => void;
    port.subscribe = vi.fn((owner, onProfile, onError) => {
      if (owner === 'owner-a') onProfile({ source: 'cloud', profile: makeProfile('course-en') });
      else failSecond = onError;
      return vi.fn();
    });
    const controller = createCourseSessionController(async () => port);
    await controller.activate('owner-a');
    expect(controller.getSnapshot().activeCourse?.targetLanguage).toBe('en');

    const nextOwner = controller.activate('owner-b');
    expect(controller.getSnapshot()).toMatchObject({ status: 'loading', source: null, profile: null, activeCourse: null });
    await vi.waitFor(() => expect(failSecond).toBeTypeOf('function'));
    failSecond(new CourseError('cloud-read-failed', 'offline'));
    await nextOwner;
    expect(controller.getSnapshot()).toMatchObject({ status: 'error', source: null, profile: null, activeCourse: null });
  });

  it('stops a subscription and settles activation when disposed before its first snapshot', async () => {
    const port = createFakePort(async () => { throw new Error('load must not run'); });
    const stop = vi.fn();
    port.subscribe = vi.fn(() => stop);
    const controller = createCourseSessionController(async () => port);

    const activation = controller.activate('owner-1');
    await vi.waitFor(() => expect(port.subscribe).toHaveBeenCalledOnce());
    controller.dispose();

    expect(stop).toHaveBeenCalledOnce();
    await activation;
  });

  it('retries a same-owner activation after a listener error', async () => {
    const profile = makeProfile('course-en');
    const port = createFakePort(async () => { throw new Error('load must not run'); });
    const stops = [vi.fn(), vi.fn()];
    port.subscribe = vi.fn((_owner, onProfile, onError) => {
      if ((port.subscribe as ReturnType<typeof vi.fn>).mock.calls.length === 1) {
        onError(new CourseError('cloud-read-failed', 'offline'));
        return stops[0];
      }
      onProfile({ source: 'cloud', profile });
      return stops[1];
    });
    const controller = createCourseSessionController(async () => port);

    await controller.activate('owner-1');
    expect(controller.getSnapshot()).toMatchObject({ status: 'error', errorCode: 'cloud-read-failed' });
    await controller.actions.retry();

    expect(port.subscribe).toHaveBeenCalledTimes(2);
    expect(stops[0]).toHaveBeenCalledOnce();
    expect(controller.getSnapshot()).toMatchObject({ status: 'ready', profile, errorCode: null });
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
