import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CourseError, type CourseProfile } from './courseModel';

const firestore = vi.hoisted(() => ({
  doc: vi.fn((_database: unknown, ...segments: string[]) => ({ path: segments.join('/') })),
  getDoc: vi.fn(),
}));

vi.mock('firebase/firestore', () => firestore);
vi.mock('firebase/functions', () => ({
  getFunctions: vi.fn(),
  httpsCallable: vi.fn(),
}));

import { createFirebaseCourseAdapter } from './firebaseCourseAdapter';

const profile: CourseProfile = {
  courses: [{
    id: 'legacy-en-vi',
    targetLanguage: 'en',
    nativeLanguage: 'vi',
    status: 'active',
    goals: [],
    preferences: {
      pronunciationVariant: null,
      showRomanization: false,
      zhScript: null,
    },
    createdAt: '1970-01-01T00:00:00.000Z',
  }],
  activeCourseId: 'legacy-en-vi',
};

const snapshot = (value: unknown, exists = true) => ({
  exists: () => exists,
  data: () => value,
});

describe('Firebase course adapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    firestore.getDoc.mockResolvedValue(snapshot(profile));
  });

  it('distinguishes an absent cloud profile from a readable profile without seeding it', async () => {
    firestore.getDoc.mockResolvedValue(snapshot(undefined, false));
    const adapter = createFirebaseCourseAdapter({
      app: {} as never,
      database: {} as never,
      configured: true,
      getCurrentOwner: () => 'owner-a',
    });

    await expect(adapter.load('owner-a')).resolves.toEqual({
      source: 'absent',
      profile: expect.objectContaining({ activeCourseId: 'legacy-en-vi' }),
    });
    expect(firestore.doc).toHaveBeenCalledWith(
      expect.anything(),
      'users', 'owner-a', 'profile', 'courses',
    );
  });

  it('does not silently fall back when a cloud read fails', async () => {
    const failure = new Error('permission denied');
    firestore.getDoc.mockRejectedValue(failure);
    const adapter = createFirebaseCourseAdapter({
      app: {} as never,
      database: {} as never,
      configured: true,
      getCurrentOwner: () => 'owner-a',
    });

    await expect(adapter.load('owner-a')).rejects.toMatchObject({
      code: 'cloud-read-failed',
      cause: failure,
    });
  });

  it('rejects a late read after the owner switches', async () => {
    let resolveRead!: (value: unknown) => void;
    firestore.getDoc.mockReturnValue(new Promise(resolve => { resolveRead = resolve; }));
    let currentOwner: string | null = 'owner-a';
    const adapter = createFirebaseCourseAdapter({
      app: {} as never,
      database: {} as never,
      configured: true,
      getCurrentOwner: () => currentOwner,
    });

    const pending = adapter.load('owner-a');
    currentOwner = 'owner-b';
    resolveRead(snapshot(profile));
    await expect(pending).rejects.toMatchObject({ code: 'owner-changed' });
  });

  it('uses callable writes and validates the returned exact profile shape', async () => {
    const call = vi.fn(async (_name: string, _payload: unknown) => profile);
    const adapter = createFirebaseCourseAdapter({
      app: {} as never,
      database: {} as never,
      configured: true,
      getCurrentOwner: () => 'owner-a',
      call,
    });

    await expect(adapter.createCourse('owner-a', {
      targetLanguage: 'ko',
      nativeLanguage: 'vi',
      preferences: { showRomanization: true },
    })).resolves.toEqual(profile);
    expect(call).toHaveBeenCalledWith('createCourse', {
      ownerId: 'owner-a',
      input: {
        targetLanguage: 'ko',
        nativeLanguage: 'vi',
        goals: [],
        preferences: {
          pronunciationVariant: null,
          showRomanization: true,
          zhScript: null,
        },
      },
    });
  });

  it('never hides callable failures behind a local profile', async () => {
    const failure = new Error('network down');
    const call = vi.fn(async () => { throw failure; });
    const adapter = createFirebaseCourseAdapter({
      app: {} as never,
      database: {} as never,
      configured: true,
      getCurrentOwner: () => 'owner-a',
      call,
    });

    await expect(adapter.archiveCourse('owner-a', 'legacy-en-vi')).rejects.toMatchObject({
      code: 'cloud-write-failed',
      cause: failure,
    });
  });

  it('preserves deterministic callable rejection reasons', async () => {
    const failure = Object.assign(new Error('target already exists'), {
      code: 'functions/failed-precondition',
      details: { reason: 'course-exists', courseId: 'legacy-en-vi' },
    });
    const call = vi.fn(async () => { throw failure; });
    const adapter = createFirebaseCourseAdapter({
      app: {} as never,
      database: {} as never,
      configured: true,
      getCurrentOwner: () => 'owner-a',
      call,
    });

    await expect(adapter.createCourse('owner-a', {
      targetLanguage: 'en',
      nativeLanguage: 'vi',
    })).rejects.toMatchObject({
      code: 'course-exists',
      details: { reason: 'course-exists', courseId: 'legacy-en-vi' },
      cause: failure,
    });
  });

  it('stops a mutation when the owner changes while the callable is pending', async () => {
    let resolveCall!: (value: unknown) => void;
    const call = vi.fn(() => new Promise(resolve => { resolveCall = resolve; }));
    let currentOwner: string | null = 'owner-a';
    const adapter = createFirebaseCourseAdapter({
      app: {} as never,
      database: {} as never,
      configured: true,
      getCurrentOwner: () => currentOwner,
      call,
    });

    const pending = adapter.reopenCourse('owner-a', 'legacy-en-vi');
    currentOwner = 'owner-b';
    resolveCall(profile);
    await expect(pending).rejects.toMatchObject({ code: 'owner-changed' });
  });

  it('requires a signed-in owner instead of selecting local fallback', async () => {
    const adapter = createFirebaseCourseAdapter({
      app: {} as never,
      database: {} as never,
      configured: true,
    });

    await expect(adapter.load(null)).rejects.toMatchObject({ code: 'owner-required' });
    await expect(adapter.createCourse(null, {
      targetLanguage: 'ko',
      nativeLanguage: 'vi',
    })).rejects.toBeInstanceOf(CourseError);
    expect(firestore.getDoc).not.toHaveBeenCalled();
  });
});
