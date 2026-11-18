import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { RateLimitExceededError } from '../src/rateLimiter.js';
import {
  CourseProfileValidationError,
  createLegacyCourseProfile,
} from '../src/course-profile-contract.js';
import {
  CourseProfileConflictError,
  CourseProfileOwnerMismatchError,
  CourseProfileStoredDataError,
  parseCourseProfileMutationRequest,
  type CourseProfileMutationName,
} from '../src/course-profile-persistence.js';

const applyCourseProfileMutation = vi.fn();
const consumePersistentRateLimit = vi.fn();
const isAccountDeleting = vi.fn();

vi.mock('../src/course-profile-persistence.js', async importOriginal => ({
  ...await importOriginal<typeof import('../src/course-profile-persistence.js')>(),
  applyCourseProfileMutation: (...args: unknown[]) => applyCourseProfileMutation(...args),
}));

vi.mock('../src/rateLimiter.js', async importOriginal => ({
  ...await importOriginal<typeof import('../src/rateLimiter.js')>(),
  consumePersistentRateLimit: (...args: unknown[]) => consumePersistentRateLimit(...args),
}));

vi.mock('../src/accountData.js', async importOriginal => ({
  ...await importOriginal<typeof import('../src/accountData.js')>(),
  isAccountDeleting: (...args: unknown[]) => isAccountDeleting(...args),
}));

type Callable = { run(request: unknown): Promise<unknown> };

type CourseAction = {
  readonly name: CourseProfileMutationName;
  readonly data: Record<string, unknown>;
};

const profile = createLegacyCourseProfile();
const previousEnv = { ...process.env };
let handlers: Record<CourseProfileMutationName, Callable>;

const actions: readonly CourseAction[] = [
  {
    name: 'createCourse',
    data: { ownerId: 'owner-1', input: { targetLanguage: 'ko', nativeLanguage: 'vi' } },
  },
  {
    name: 'updateCourse',
    data: {
      ownerId: 'owner-1', courseId: 'course-1',
      input: { nativeLanguage: 'en', preferences: { showRomanization: true } },
    },
  },
  { name: 'archiveCourse', data: { ownerId: 'owner-1', courseId: 'course-1' } },
  { name: 'reopenCourse', data: { ownerId: 'owner-1', courseId: 'course-1' } },
  { name: 'setActiveCourse', data: { ownerId: 'owner-1', courseId: 'course-1' } },
  {
    name: 'addGoal',
    data: {
      ownerId: 'owner-1', courseId: 'course-1',
      input: { kind: 'topik-2', level: '3', targetDate: '2026-12-31' },
    },
  },
  {
    name: 'updateGoal',
    data: {
      ownerId: 'owner-1', courseId: 'course-1', goalId: 'goal-1',
      input: { level: '4', status: 'paused' },
    },
  },
  {
    name: 'removeGoal',
    data: { ownerId: 'owner-1', courseId: 'course-1', goalId: 'goal-1' },
  },
];

beforeAll(async () => {
  process.env.ANALYTICS_PSEUDONYM_KEY = 'x'.repeat(32);
  const module = await import('../src/index.js');
  handlers = {
    createCourse: module.createCourse as unknown as Callable,
    updateCourse: module.updateCourse as unknown as Callable,
    archiveCourse: module.archiveCourse as unknown as Callable,
    reopenCourse: module.reopenCourse as unknown as Callable,
    setActiveCourse: module.setActiveCourse as unknown as Callable,
    addGoal: module.addGoal as unknown as Callable,
    updateGoal: module.updateGoal as unknown as Callable,
    removeGoal: module.removeGoal as unknown as Callable,
  };
});

afterAll(() => {
  process.env = { ...previousEnv };
});

beforeEach(() => {
  applyCourseProfileMutation.mockReset().mockResolvedValue(profile);
  consumePersistentRateLimit.mockReset().mockResolvedValue(undefined);
  isAccountDeleting.mockReset().mockResolvedValue(false);
});

describe('course profile callables', () => {
  it('accepts every fixed action envelope and returns the complete profile wrapper', async () => {
    for (const action of actions) {
      const response = await handlers[action.name].run({
        auth: { uid: 'owner-1' },
        data: action.data,
      });
      expect(response).toEqual({ profile });
      expect(applyCourseProfileMutation).toHaveBeenLastCalledWith(
        expect.anything(),
        'owner-1',
        parseCourseProfileMutationRequest(action.name, action.data),
      );
    }

    expect(applyCourseProfileMutation).toHaveBeenCalledTimes(actions.length);
    expect(consumePersistentRateLimit).toHaveBeenCalledTimes(actions.length);
    for (const [database, ownerId, scope, maximum] of consumePersistentRateLimit.mock.calls) {
      expect(database).toBeDefined();
      expect(ownerId).toBe('owner-1');
      expect(scope).toBe('course-profile');
      expect(maximum).toBe(120);
    }
  });

  it('denies unauthenticated requests before budget or profile writes', async () => {
    await expect(handlers.createCourse.run({
      auth: undefined,
      data: actions[0]?.data,
    })).rejects.toMatchObject({ code: 'unauthenticated' });

    expect(consumePersistentRateLimit).not.toHaveBeenCalled();
    expect(applyCourseProfileMutation).not.toHaveBeenCalled();
  });

  it('denies an owner assertion mismatch before budget or profile writes', async () => {
    await expect(handlers.createCourse.run({
      auth: { uid: 'owner-1' },
      data: { ownerId: 'owner-2', input: { targetLanguage: 'ko', nativeLanguage: 'vi' } },
    })).rejects.toMatchObject({ code: 'permission-denied' });

    expect(consumePersistentRateLimit).not.toHaveBeenCalled();
    expect(applyCourseProfileMutation).not.toHaveBeenCalled();
  });

  it('maps malformed input to invalid-argument before budget or profile writes', async () => {
    await expect(handlers.createCourse.run({
      auth: { uid: 'owner-1' },
      data: { ownerId: 'owner-1', input: { targetLanguage: 'fr', nativeLanguage: 'vi' } },
    })).rejects.toMatchObject({ code: 'invalid-argument' });

    expect(consumePersistentRateLimit).not.toHaveBeenCalled();
    expect(applyCourseProfileMutation).not.toHaveBeenCalled();
  });

  it('maps server validation, ownership, stored-data, and conflict errors explicitly', async () => {
    const cases = [
      {
        error: new CourseProfileValidationError('course input is invalid'),
        expected: { code: 'invalid-argument' },
      },
      {
        error: new CourseProfileOwnerMismatchError('owner-2', 'owner-1'),
        expected: { code: 'permission-denied' },
      },
      {
        error: new CourseProfileStoredDataError(new Error('malformed profile')),
        expected: { code: 'failed-precondition', details: { reason: 'profile-invalid' } },
      },
      {
        error: new CourseProfileConflictError(
          'course-exists',
          'A Korean course already exists.',
          { courseId: 'course-1', targetLanguage: 'ko' },
        ),
        expected: {
          code: 'failed-precondition',
          details: { reason: 'course-exists', courseId: 'course-1', targetLanguage: 'ko' },
        },
      },
    ] as const;

    for (const entry of cases) {
      applyCourseProfileMutation.mockRejectedValueOnce(entry.error);
      await expect(handlers.archiveCourse.run({
        auth: { uid: 'owner-1' },
        data: { ownerId: 'owner-1', courseId: 'course-1' },
      })).rejects.toMatchObject(entry.expected);
    }

    expect(applyCourseProfileMutation).toHaveBeenCalledTimes(cases.length);
  });

  it('fails closed when the shared course profile budget is exhausted', async () => {
    consumePersistentRateLimit.mockRejectedValueOnce(new RateLimitExceededError(5_000));

    await expect(handlers.createCourse.run({
      auth: { uid: 'owner-1' },
      data: actions[0]?.data,
    })).rejects.toMatchObject({
      code: 'resource-exhausted',
    });

    expect(applyCourseProfileMutation).not.toHaveBeenCalled();
    expect(consumePersistentRateLimit).toHaveBeenCalledWith(
      expect.anything(), 'owner-1', 'course-profile', 120,
    );
  });

  it('fails closed when rate-limit storage fails instead of writing the profile', async () => {
    const storageFailure = new Error('rate-limit storage unavailable');
    consumePersistentRateLimit.mockRejectedValueOnce(storageFailure);

    await expect(handlers.createCourse.run({
      auth: { uid: 'owner-1' },
      data: actions[0]?.data,
    })).rejects.toBeDefined();

    expect(applyCourseProfileMutation).not.toHaveBeenCalled();
    expect(consumePersistentRateLimit).toHaveBeenCalledWith(
      expect.anything(), 'owner-1', 'course-profile', 120,
    );
  });
});
