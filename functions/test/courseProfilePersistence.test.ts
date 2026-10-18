import type { DocumentData, DocumentReference, DocumentSnapshot, Firestore, Transaction } from 'firebase-admin/firestore';
import { describe, expect, it, vi } from 'vitest';
import {
  applyCourseProfileMutation,
  CourseProfileOwnerMismatchError,
  CourseProfileStoredDataError,
  parseCourseProfileMutationRequest,
} from '../src/course-profile-persistence.js';
import {
  createLegacyCourseProfile,
  parseCourseProfile,
} from '../src/course-profile-contract.js';

const snapshot = (exists: boolean, data?: DocumentData): DocumentSnapshot => ({
  exists,
  data: () => data,
} as DocumentSnapshot);

const profilePath = 'users/owner/profile/courses';

const harness = (initial?: DocumentData, retryWith?: DocumentData) => {
  const values = new Map<string, DocumentData>(initial === undefined ? [] : [[profilePath, initial]]);
  const writes: Array<{ path: string; data: DocumentData }> = [];
  const transaction = {
    get: vi.fn(async (reference: DocumentReference) => {
      const data = values.get(reference.path);
      return snapshot(data !== undefined, data);
    }),
    set: vi.fn((reference: DocumentReference, data: DocumentData) => {
      values.set(reference.path, data);
      writes.push({ path: reference.path, data });
      return transaction;
    }),
  } as unknown as Transaction;
  const database = {
    collection: (name: string) => ({
      doc: (ownerId: string) => ({
        collection: (subcollection: string) => ({
          doc: (id: string) => ({ path: `${name}/${ownerId}/${subcollection}/${id}` }),
        }),
        path: `${name}/${ownerId}`,
      }),
    }),
    runTransaction: vi.fn(async (callback: (value: Transaction) => Promise<unknown>) => {
      if (retryWith) {
        await callback(transaction);
        values.set(profilePath, retryWith);
        writes.length = 0;
      }
      return callback(transaction);
    }),
  } as unknown as Firestore;
  return { database, writes, values, transaction };
};

const deterministicIds = () => {
  let course = 0;
  let goal = 0;
  return (kind: 'course' | 'goal') => kind === 'course'
    ? `course-${++course}`
    : `goal-${++goal}`;
};

const now = () => '2026-09-25T00:00:00.000Z';

describe('course profile persistence', () => {
  it('parses exact operation envelopes and materializes optional fields', () => {
    expect(parseCourseProfileMutationRequest('createCourse', {
      ownerId: 'owner',
      input: { targetLanguage: 'ko', nativeLanguage: 'vi' },
    })).toEqual({
      operation: 'createCourse',
      ownerId: 'owner',
      input: {
        targetLanguage: 'ko',
        nativeLanguage: 'vi',
        goals: [],
        preferences: {
          pronunciationVariant: null,
          showRomanization: false,
          zhScript: null,
        },
      },
    });
    expect(() => parseCourseProfileMutationRequest('createCourse', {
      ownerId: 'owner',
      input: { targetLanguage: 'fr', nativeLanguage: 'vi' },
    })).toThrow(/unsupported value/);
    expect(parseCourseProfileMutationRequest('createCourse', {
      ownerId: 'owner',
      input: { targetLanguage: 'ko', nativeLanguage: 'vi', activateOnCreate: true },
    })).toMatchObject({ input: { activateOnCreate: true } });
    expect(() => parseCourseProfileMutationRequest('createCourse', {
      ownerId: 'owner',
      input: { targetLanguage: 'ko', nativeLanguage: 'vi', activateOnCreate: 'true' },
    })).toThrow(/expected a boolean/);
    expect(() => parseCourseProfileMutationRequest('createCourse', {
      ownerId: 'owner',
      input: { targetLanguage: 'ko', nativeLanguage: 'vi' },
      extra: true,
    })).toThrow(/unsupported field/);
    expect(() => parseCourseProfileMutationRequest('archiveCourse', {
      ownerId: 'owner',
      courseId: 'course-1',
      input: {},
    })).toThrow(/unsupported field/);
  });

  it('rejects oversized goal arrays before mapping untrusted entries', () => {
    const goals = Array.from({ length: 33 }, () => null);
    expect(() => parseCourseProfileMutationRequest('createCourse', {
      ownerId: 'owner',
      input: { targetLanguage: 'ko', nativeLanguage: 'vi', goals },
    })).toThrow(/at most 32 goals/);
  });

  it('preserves legacy English by default when creating against an absent profile', async () => {
    const test = harness();
    const request = parseCourseProfileMutationRequest('createCourse', {
      ownerId: 'owner',
      input: {
        targetLanguage: 'ko',
        nativeLanguage: 'vi',
        goals: [{ kind: 'topik-2', level: '3' }],
      },
    });
    const result = await applyCourseProfileMutation(test.database, 'owner', request, {
      createId: deterministicIds(),
      now,
    });

    expect(result).toMatchObject({
      activeCourseId: 'legacy-en-vi',
      courses: [
        { id: 'legacy-en-vi', targetLanguage: 'en', status: 'active' },
        { id: 'course-1', targetLanguage: 'ko', goals: [{ id: 'goal-1', kind: 'topik-2', level: '3' }] },
      ],
    });
    expect(test.writes).toHaveLength(1);
    expect(test.writes[0]).toMatchObject({ path: profilePath, data: result });
    expect(Object.keys(test.writes[0]?.data ?? {})).toEqual(['courses', 'activeCourseId']);
  });

  it('keeps the existing active course when adding to a stored profile', async () => {
    const test = harness(createLegacyCourseProfile());
    const request = parseCourseProfileMutationRequest('createCourse', {
      ownerId: 'owner', input: { targetLanguage: 'ko', nativeLanguage: 'vi' },
    });
    const result = await applyCourseProfileMutation(test.database, 'owner', request, {
      createId: deterministicIds(), now,
    });

    expect(result.activeCourseId).toBe('legacy-en-vi');
    expect(result.courses).toHaveLength(2);
    expect(test.writes).toHaveLength(1);
  });

  it('replays a course creation with the same operation ID without another course', async () => {
    const first = harness();
    const request = parseCourseProfileMutationRequest('createCourse', {
      ownerId: 'owner',
      input: { targetLanguage: 'ko', nativeLanguage: 'vi', operationId: 'course-create-ko-1' },
    });
    const created = await applyCourseProfileMutation(first.database, 'owner', request, {
      createId: deterministicIds(), now,
    });
    const replay = harness(created);
    const replayed = await applyCourseProfileMutation(replay.database, 'owner', request, {
      createId: deterministicIds(), now,
    });

    expect(created.courses).toHaveLength(2);
    expect(created.courses[1]?.id).toBe('course-create-ko-1');
    expect(replayed).toEqual(created);
    expect(replay.writes).toHaveLength(1);
    await expect(applyCourseProfileMutation(replay.database, 'owner',
      parseCourseProfileMutationRequest('createCourse', {
        ownerId: 'owner',
        input: { targetLanguage: 'ko', nativeLanguage: 'vi', operationId: 'course-create-ko-2' },
      }), { createId: deterministicIds(), now })).rejects.toMatchObject({ reason: 'course-exists' });
  });

  it('activates the requested course even after a competing create forces a transaction retry', async () => {
    const competing = harness(createLegacyCourseProfile());
    const competingProfile = await applyCourseProfileMutation(competing.database, 'owner',
      parseCourseProfileMutationRequest('createCourse', {
        ownerId: 'owner', input: { targetLanguage: 'ja', nativeLanguage: 'vi', activateOnCreate: true },
      }), { createId: deterministicIds(), now });
    const test = harness(undefined, competingProfile);
    const result = await applyCourseProfileMutation(test.database, 'owner',
      parseCourseProfileMutationRequest('createCourse', {
        ownerId: 'owner', input: { targetLanguage: 'ko', nativeLanguage: 'vi', activateOnCreate: true },
      }), { createId: deterministicIds(), now });

    expect(test.transaction.get).toHaveBeenCalledTimes(2);
    expect(result.activeCourseId).toBe('course-2');
    expect(result.courses.map(course => course.targetLanguage)).toEqual(['en', 'ja', 'ko']);
    expect(test.writes).toHaveLength(1);
    expect(test.writes[0]?.data).toEqual(result);
  });

  it('keeps the same-target conflict after a competing create forces a retry', async () => {
    const competing = harness(createLegacyCourseProfile());
    const request = parseCourseProfileMutationRequest('createCourse', {
      ownerId: 'owner', input: { targetLanguage: 'ko', nativeLanguage: 'vi', activateOnCreate: true },
    });
    const competingProfile = await applyCourseProfileMutation(competing.database, 'owner', request,
      { createId: deterministicIds(), now });
    const test = harness(undefined, competingProfile);

    await expect(applyCourseProfileMutation(test.database, 'owner', request,
      { createId: deterministicIds(), now })).rejects.toMatchObject({ reason: 'course-exists' });
    expect(test.transaction.get).toHaveBeenCalledTimes(2);
    expect(test.writes).toEqual([]);
  });

  it('merges a partial preference update with the latest profile after a transaction retry', async () => {
    const legacy = createLegacyCourseProfile();
    const course = legacy.courses[0]!;
    const initial = parseCourseProfile({
      ...legacy,
      courses: [{ ...course, preferences: { ...course.preferences, pronunciationVariant: 'voice-a' } }],
    });
    const competing = parseCourseProfile({
      ...initial,
      courses: [{ ...initial.courses[0]!, preferences: { ...initial.courses[0]!.preferences, pronunciationVariant: null } }],
    });
    const test = harness(initial, competing);
    const request = parseCourseProfileMutationRequest('updateCourse', {
      ownerId: 'owner', courseId: course.id,
      input: { preferences: { showRomanization: true } },
    });

    const result = await applyCourseProfileMutation(test.database, 'owner', request);

    expect(test.transaction.get).toHaveBeenCalledTimes(2);
    expect(result.courses[0]?.preferences).toEqual({
      pronunciationVariant: null, showRomanization: true, zhScript: null,
    });
    expect(test.writes).toEqual([{ path: profilePath, data: result }]);
  });

  it('serializes archive and re-open policies, including duplicate archived targets', async () => {
    const test = harness();
    const create = parseCourseProfileMutationRequest('createCourse', {
      ownerId: 'owner', input: { targetLanguage: 'ko', nativeLanguage: 'vi' },
    });
    await applyCourseProfileMutation(test.database, 'owner', create, {
      createId: deterministicIds(),
      now,
    });

    const archive = parseCourseProfileMutationRequest('archiveCourse', {
      ownerId: 'owner', courseId: 'legacy-en-vi',
    });
    await expect(applyCourseProfileMutation(test.database, 'owner', archive)).resolves.toMatchObject({
      activeCourseId: 'course-1',
    });
    const duplicate = parseCourseProfileMutationRequest('createCourse', {
      ownerId: 'owner', input: { targetLanguage: 'en', nativeLanguage: 'vi' },
    });
    await expect(applyCourseProfileMutation(test.database, 'owner', duplicate))
      .rejects.toMatchObject({ reason: 'course-exists', details: { courseId: 'legacy-en-vi' } });

    const reopen = parseCourseProfileMutationRequest('reopenCourse', {
      ownerId: 'owner', courseId: 'legacy-en-vi',
    });
    await expect(applyCourseProfileMutation(test.database, 'owner', reopen)).resolves.toMatchObject({
      activeCourseId: 'legacy-en-vi',
      courses: expect.arrayContaining([
        expect.objectContaining({ id: 'legacy-en-vi', status: 'active' }),
      ]),
    });
  });

  it('keeps target uniqueness and the four-course bound deterministic', async () => {
    let profile = createLegacyCourseProfile();
    const createId = deterministicIds();
    const targets = ['ko', 'ja', 'zh'] as const;
    for (const targetLanguage of targets) {
      const test = harness(profile);
      const request = parseCourseProfileMutationRequest('createCourse', {
        ownerId: 'owner', input: { targetLanguage, nativeLanguage: 'vi' },
      });
      profile = await applyCourseProfileMutation(test.database, 'owner', request, {
        createId,
        now,
      });
    }

    const test = harness(profile);
    const duplicate = parseCourseProfileMutationRequest('createCourse', {
      ownerId: 'owner', input: { targetLanguage: 'zh', nativeLanguage: 'en' },
    });
    await expect(applyCourseProfileMutation(test.database, 'owner', duplicate))
      .rejects.toMatchObject({ reason: 'course-exists' });
    expect(test.writes).toEqual([]);
  });

  it('fails closed for owner mismatch and malformed stored data before writing', async () => {
    const ownerTest = harness();
    const request = parseCourseProfileMutationRequest('archiveCourse', {
      ownerId: 'other-owner', courseId: 'legacy-en-vi',
    });
    await expect(applyCourseProfileMutation(ownerTest.database, 'owner', request))
      .rejects.toBeInstanceOf(CourseProfileOwnerMismatchError);
    expect(ownerTest.writes).toEqual([]);

    const malformed = harness({ courses: [] });
    const validRequest = parseCourseProfileMutationRequest('archiveCourse', {
      ownerId: 'owner', courseId: 'legacy-en-vi',
    });
    await expect(applyCourseProfileMutation(malformed.database, 'owner', validRequest))
      .rejects.toBeInstanceOf(CourseProfileStoredDataError);
    expect(malformed.writes).toEqual([]);
  });

  it('accepts a stored profile only when its active pointer is not archived', () => {
    const invalid = {
      ...createLegacyCourseProfile(),
      courses: [{ ...createLegacyCourseProfile().courses[0], status: 'archived' }],
    };
    expect(() => parseCourseProfile(invalid)).toThrow(/activeCourseId/);
    expect(() => parseCourseProfile({
      ...createLegacyCourseProfile(),
      activeCourseId: null,
    })).toThrow(/when one exists/);
  });
});
