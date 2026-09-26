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

const harness = (initial?: DocumentData) => {
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
    runTransaction: vi.fn(async (callback: (value: Transaction) => Promise<unknown>) => callback(transaction)),
  } as unknown as Firestore;
  return { database, writes, values };
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

  it('creates against an absent profile with the deterministic legacy course and one transaction write', async () => {
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
