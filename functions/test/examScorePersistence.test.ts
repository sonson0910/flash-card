import type { DocumentData, DocumentReference, DocumentSnapshot, Firestore, Transaction } from 'firebase-admin/firestore';
import { describe, expect, it, vi } from 'vitest';
import { CourseProfileValidationError } from '../src/course-profile-contract.js';
import {
  CourseProfileConflictError,
  CourseProfileOwnerMismatchError,
  CourseProfileStoredDataError,
} from '../src/course-profile-persistence.js';
import {
  parseSetLatestExamScoreRequest,
  readLatestExamScores,
  setLatestExamScore,
} from '../src/exam-score-persistence.js';
import { parseCourseProfile } from '../src/course-profile-contract.js';

const coursesPath = 'users/owner/profile/courses';
const scoresPath = 'users/owner/profile/exam_scores';
const createdAt = '2026-09-25T00:00:00.000Z';

const course = (id: string, targetLanguage: 'en' | 'ko', goals: readonly Record<string, unknown>[]) => ({
  id,
  targetLanguage,
  nativeLanguage: 'vi',
  status: 'active',
  goals,
  preferences: { pronunciationVariant: null, showRomanization: false, zhScript: null },
  createdAt,
});
const goal = (id: string, kind: string, level: string | null = null) => ({
  id, kind, level, targetDate: null, status: 'active', createdAt,
});
const profile = {
  courses: [
    course('course-en', 'en', [goal('goal-ielts', 'ielts', '7.0'), goal('goal-toeic', 'toeic')]),
    course('course-ko', 'ko', [goal('goal-topik', 'topik-2', '3')]),
  ],
  activeCourseId: 'course-en',
};
const entry = (band: string, courseId = 'course-en', updatedAt = '2026-11-01T00:00:00.000Z') => ({ courseId, band, updatedAt });

const snapshot = (exists: boolean, data?: DocumentData): DocumentSnapshot => ({ exists, data: () => data } as DocumentSnapshot);

const harness = (initial: Record<string, DocumentData | undefined>) => {
  const values = new Map(Object.entries(initial).filter((pair): pair is [string, DocumentData] => pair[1] !== undefined));
  const writes: Array<{ path: string; data: DocumentData | null }> = [];
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
    delete: vi.fn((reference: DocumentReference) => {
      values.delete(reference.path);
      writes.push({ path: reference.path, data: null });
      return transaction;
    }),
  } as unknown as Transaction;
  const database = {
    collection: (name: string) => ({
      doc: (ownerId: string) => ({
        collection: (subcollection: string) => ({
          doc: (id: string) => ({ path: `${name}/${ownerId}/${subcollection}/${id}` }),
        }),
      }),
    }),
    runTransaction: vi.fn(async (callback: (value: Transaction) => Promise<unknown>) => callback(transaction)),
  } as unknown as Firestore;
  return { database, values, writes };
};

const request = (latestScore: unknown, goalId = 'goal-ielts', courseId = 'course-en', ownerId = 'owner') => (
  parseSetLatestExamScoreRequest({ ownerId, courseId, goalId, latestScore })
);
const now = () => '2026-11-19T08:00:00.000Z';

describe('latest exam score requests', () => {
  it.each([
    ['6.5', '6.5'], ['7', '7.0'], ['6,5', '6.5'], ['band 7', '7.0'], ['IELTS 8.5', '8.5'], [' 4 ', '4.0'], [null, null],
  ])('normalises %j to %j', (latestScore, expected) => {
    expect(request(latestScore).latestScore).toBe(expected);
  });

  it.each([['3.5'], ['9.5'], ['6.25'], ['about 7'], [7], [''], [undefined]])('rejects %j without echoing the value', value => {
    expect(() => request(value)).toThrow(CourseProfileValidationError);
    try {
      request(value);
    } catch (error) {
      if (typeof value === 'string' && value.trim()) expect((error as Error).message).not.toContain(value);
    }
  });

  it('rejects missing, extra and malformed envelope fields', () => {
    expect(() => parseSetLatestExamScoreRequest({ ownerId: 'owner', courseId: 'course-en', goalId: 'goal-ielts' }))
      .toThrow(CourseProfileValidationError);
    expect(() => parseSetLatestExamScoreRequest({
      ownerId: 'owner', courseId: 'course-en', goalId: 'goal-ielts', latestScore: '6.5', target: '7.0',
    })).toThrow(CourseProfileValidationError);
    expect(() => parseSetLatestExamScoreRequest({ ownerId: 'owner', courseId: 'a/b', goalId: 'goal-ielts', latestScore: '6.5' }))
      .toThrow(CourseProfileValidationError);
    expect(() => parseSetLatestExamScoreRequest('6.5')).toThrow(CourseProfileValidationError);
  });
});

describe('latest exam score persistence', () => {
  it('stores a canonical score for an IELTS goal of the owner', async () => {
    const { database, values } = harness({ [coursesPath]: profile });
    await expect(setLatestExamScore(database, 'owner', request('6,5'), { now }))
      .resolves.toEqual({ courseId: 'course-en', goalId: 'goal-ielts', latestScore: '6.5' });
    expect(values.get(scoresPath)).toEqual({
      schemaVersion: 1,
      goals: { 'goal-ielts': { courseId: 'course-en', band: '6.5', updatedAt: '2026-11-19T08:00:00.000Z' } },
    });
  });

  it('writes nothing when the same score or an absent score is sent again', async () => {
    const stored = { schemaVersion: 1, goals: { 'goal-ielts': entry('6.5') } };
    const { database, writes, values } = harness({ [coursesPath]: profile, [scoresPath]: stored });
    await setLatestExamScore(database, 'owner', request('6.5'), { now });
    await setLatestExamScore(database, 'owner', request('6.5'), { now });
    expect(writes).toEqual([]);
    expect(values.get(scoresPath)).toBe(stored);
    const empty = harness({ [coursesPath]: profile });
    await setLatestExamScore(empty.database, 'owner', request(null), { now });
    await setLatestExamScore(empty.database, 'owner', request(null), { now });
    expect(empty.writes).toEqual([]);
  });

  it('clears a score and deletes the document once no score is left', async () => {
    const { database, values, writes } = harness({
      [coursesPath]: profile,
      [scoresPath]: { schemaVersion: 1, goals: { 'goal-ielts': entry('6.5'), 'goal-removed': entry('5.0') } },
    });
    await setLatestExamScore(database, 'owner', request(null), { now });
    expect(values.has(scoresPath)).toBe(false);
    expect(writes).toEqual([{ path: scoresPath, data: null }]);
  });

  it('drops scores of removed goals and malformed entries on the next write', async () => {
    const { database, values } = harness({
      [coursesPath]: profile,
      [scoresPath]: {
        schemaVersion: 1,
        goals: {
          'goal-removed': entry('8.0'),
          'goal-topik': entry('6.0', 'course-ko'),
          'goal-toeic': entry('5.5'),
          'goal-ielts': { ...entry('7.0'), note: 'extra' },
        },
      },
    });
    await setLatestExamScore(database, 'owner', request('6.0'), { now });
    expect(values.get(scoresPath)).toEqual({
      schemaVersion: 1,
      goals: { 'goal-ielts': { courseId: 'course-en', band: '6.0', updatedAt: '2026-11-19T08:00:00.000Z' } },
    });
  });

  it('replaces a wholly malformed document instead of failing', async () => {
    const { database, values } = harness({ [coursesPath]: profile, [scoresPath]: { goals: 'corrupt' } });
    await setLatestExamScore(database, 'owner', request('5.5'), { now });
    expect(values.get(scoresPath)).toEqual({
      schemaVersion: 1,
      goals: { 'goal-ielts': { courseId: 'course-en', band: '5.5', updatedAt: '2026-11-19T08:00:00.000Z' } },
    });
  });

  it('refuses a goal that is not in the owner profile, including another account goal id', async () => {
    const { database, writes } = harness({ [coursesPath]: profile });
    await expect(setLatestExamScore(database, 'owner', request('6.5', 'goal-of-another-account'), { now }))
      .rejects.toMatchObject({ reason: 'goal-not-found' });
    await expect(setLatestExamScore(database, 'owner', request('6.5', 'goal-ielts', 'course-ko'), { now }))
      .rejects.toMatchObject({ reason: 'goal-not-found' });
    await expect(setLatestExamScore(database, 'owner', request('6.5', 'goal-ielts', 'course-missing'), { now }))
      .rejects.toBeInstanceOf(CourseProfileConflictError);
    expect(writes).toEqual([]);
  });

  it('refuses a goal that is not an IELTS goal', async () => {
    const { database, writes } = harness({ [coursesPath]: profile });
    await expect(setLatestExamScore(database, 'owner', request('6.5', 'goal-topik', 'course-ko'), { now }))
      .rejects.toBeInstanceOf(CourseProfileValidationError);
    expect(writes).toEqual([]);
  });

  it('refuses an owner mismatch and an unreadable course profile', async () => {
    const { database } = harness({ [coursesPath]: profile });
    await expect(setLatestExamScore(database, 'intruder', request('6.5'), { now }))
      .rejects.toBeInstanceOf(CourseProfileOwnerMismatchError);
    const broken = harness({ [coursesPath]: { courses: 'corrupt' } });
    await expect(setLatestExamScore(broken.database, 'owner', request('6.5'), { now }))
      .rejects.toBeInstanceOf(CourseProfileStoredDataError);
  });

  it('reads only valid entries that still belong to an IELTS goal of the same course', () => {
    const parsed = parseCourseProfile(profile);
    expect(readLatestExamScores({
      schemaVersion: 1,
      goals: { 'goal-ielts': entry('6.5'), 'goal-toeic': entry('6.0'), 'goal-topik': entry('5.0', 'course-ko') },
    }, parsed)).toEqual({ 'goal-ielts': entry('6.5') });
    expect(readLatestExamScores({ schemaVersion: 1, goals: { 'goal-ielts': entry('6.25') } }, parsed)).toEqual({});
    expect(readLatestExamScores({ schemaVersion: 1, goals: { 'goal-ielts': entry('6.5', 'course-ko') } }, parsed)).toEqual({});
    expect(readLatestExamScores({ schemaVersion: 2, goals: { 'goal-ielts': entry('6.5') } }, parsed)).toEqual({});
    expect(readLatestExamScores(undefined, parsed)).toEqual({});
  });
});
