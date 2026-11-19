import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { RateLimitExceededError } from '../src/rateLimiter.js';
import { CourseProfileValidationError } from '../src/course-profile-contract.js';
import {
  CourseProfileConflictError,
  CourseProfileOwnerMismatchError,
  CourseProfileStoredDataError,
} from '../src/course-profile-persistence.js';

const setLatestExamScore = vi.fn();
const consumePersistentRateLimit = vi.fn();
const isAccountDeleting = vi.fn();

vi.mock('../src/exam-score-persistence.js', async importOriginal => ({
  ...await importOriginal<typeof import('../src/exam-score-persistence.js')>(),
  setLatestExamScore: (...args: unknown[]) => setLatestExamScore(...args),
}));

vi.mock('../src/rateLimiter.js', async importOriginal => ({
  ...await importOriginal<typeof import('../src/rateLimiter.js')>(),
  consumePersistentRateLimit: (...args: unknown[]) => consumePersistentRateLimit(...args),
}));

vi.mock('../src/accountData.js', async importOriginal => ({
  ...await importOriginal<typeof import('../src/accountData.js')>(),
  isAccountDeleting: (...args: unknown[]) => isAccountDeleting(...args),
  // The owners here completed the account profile; the deletion answer still comes from the mock above.
  readAccountAccess: async (...args: unknown[]) => ({ deleting: await isAccountDeleting(...args), profiled: true }),
}));

type Callable = { run(request: unknown): Promise<unknown> };

const previousEnv = { ...process.env };
let handler: Callable;
const data = (latestScore: unknown) => ({ ownerId: 'owner-1', courseId: 'course-en', goalId: 'goal-ielts', latestScore });

beforeAll(async () => {
  process.env.ANALYTICS_PSEUDONYM_KEY = 'x'.repeat(32);
  handler = (await import('../src/index.js')).setLatestExamScore as unknown as Callable;
});

afterAll(() => {
  process.env = { ...previousEnv };
});

beforeEach(() => {
  setLatestExamScore.mockReset().mockImplementation(async (_database, _owner, request: { latestScore: string | null }) => ({
    courseId: 'course-en', goalId: 'goal-ielts', latestScore: request.latestScore,
  }));
  consumePersistentRateLimit.mockReset().mockResolvedValue(undefined);
  isAccountDeleting.mockReset().mockResolvedValue(false);
});

describe('setLatestExamScore callable', () => {
  it('normalises the score, spends the course profile budget and returns the stored state', async () => {
    await expect(handler.run({ auth: { uid: 'owner-1' }, data: data('band 6,5') }))
      .resolves.toEqual({ latestScore: { courseId: 'course-en', goalId: 'goal-ielts', latestScore: '6.5' } });
    expect(setLatestExamScore).toHaveBeenCalledWith(expect.anything(), 'owner-1', {
      ownerId: 'owner-1', courseId: 'course-en', goalId: 'goal-ielts', latestScore: '6.5',
    });
    expect(consumePersistentRateLimit).toHaveBeenCalledWith(expect.anything(), 'owner-1', 'course-profile', 120);
  });

  it('clears the score with null', async () => {
    await expect(handler.run({ auth: { uid: 'owner-1' }, data: data(null) }))
      .resolves.toEqual({ latestScore: { courseId: 'course-en', goalId: 'goal-ielts', latestScore: null } });
  });

  it('rejects signed-out, mismatched and malformed requests before budget or writes', async () => {
    await expect(handler.run({ auth: undefined, data: data('6.5') })).rejects.toMatchObject({ code: 'unauthenticated' });
    await expect(handler.run({ auth: { uid: 'owner-2' }, data: data('6.5') })).rejects.toMatchObject({ code: 'permission-denied' });
    await expect(handler.run({ auth: { uid: 'owner-1' }, data: data('9.5') })).rejects.toMatchObject({ code: 'invalid-argument' });
    await expect(handler.run({ auth: { uid: 'owner-1' }, data: { ...data('6.5'), extra: true } }))
      .rejects.toMatchObject({ code: 'invalid-argument' });
    expect(consumePersistentRateLimit).not.toHaveBeenCalled();
    expect(setLatestExamScore).not.toHaveBeenCalled();
  });

  it('maps refused goals and stored-data errors without logging the score', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const cases = [
      [new CourseProfileConflictError('goal-not-found', 'Goal goal-x was not found.', { courseId: 'course-en', goalId: 'goal-x' }),
        { code: 'failed-precondition', details: { reason: 'goal-not-found' } }],
      [new CourseProfileValidationError('goalId: a latest exam score can only be stored for an IELTS goal'), { code: 'invalid-argument' }],
      [new CourseProfileOwnerMismatchError('owner-1', 'owner-2'), { code: 'permission-denied' }],
      [new CourseProfileStoredDataError(new Error('bad')), { code: 'failed-precondition', details: { reason: 'profile-invalid' } }],
      [new Error('storage down'), { code: 'internal' }],
    ] as const;
    for (const [error, expected] of cases) {
      setLatestExamScore.mockRejectedValueOnce(error);
      await expect(handler.run({ auth: { uid: 'owner-1' }, data: data('7.5') })).rejects.toMatchObject(expected);
    }
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain('7.5');
    consoleError.mockRestore();
  });

  it('fails closed when the budget is exhausted', async () => {
    consumePersistentRateLimit.mockRejectedValueOnce(new RateLimitExceededError(5_000));
    await expect(handler.run({ auth: { uid: 'owner-1' }, data: data('6.5') })).rejects.toMatchObject({ code: 'resource-exhausted' });
    expect(setLatestExamScore).not.toHaveBeenCalled();
  });
});
