import { describe, expect, it, vi } from 'vitest';
import {
  LatestExamScoreError,
  parseStoredLatestExamScore,
  saveLatestExamScore,
  SET_LATEST_EXAM_SCORE_CALLABLE,
  subscribeToLatestExamScores,
} from './latestExamScore';

const target = { ownerId: 'owner-1', courseId: 'course-en', goalId: 'goal-ielts' };
const entry = (band: unknown, courseId = 'course-en') => ({ courseId, band, updatedAt: '2026-11-19T08:00:00.000Z' });

describe('latest exam score client', () => {
  it('reads one goal score tolerantly', () => {
    expect(parseStoredLatestExamScore({ schemaVersion: 1, goals: { 'goal-ielts': entry('6.5') } }, 'course-en', 'goal-ielts')).toBe('6.5');
    expect(parseStoredLatestExamScore({ schemaVersion: 1, goals: { 'goal-ielts': entry('6.5', 'course-ko') } }, 'course-en', 'goal-ielts')).toBeNull();
    expect(parseStoredLatestExamScore({ schemaVersion: 1, goals: { 'goal-ielts': entry('6,5') } }, 'course-en', 'goal-ielts')).toBeNull();
    expect(parseStoredLatestExamScore({ schemaVersion: 2, goals: { 'goal-ielts': entry('6.5') } }, 'course-en', 'goal-ielts')).toBeNull();
    expect(parseStoredLatestExamScore({ schemaVersion: 1, goals: {} }, 'course-en', 'goal-ielts')).toBeNull();
    expect(parseStoredLatestExamScore(undefined, 'course-en', 'goal-ielts')).toBeNull();
    expect(parseStoredLatestExamScore({ schemaVersion: 1, goals: { toString: entry('6.5') } }, 'course-en', 'constructor')).toBeNull();
  });

  it('sends the canonical score to the callable and tells subscribers what the server stored', async () => {
    const call = vi.fn(async (): Promise<unknown> => ({ latestScore: { ...target, latestScore: '6.5' } }));
    const listener = vi.fn();
    const unsubscribe = subscribeToLatestExamScores(listener);
    await expect(saveLatestExamScore(call, { ...target, latestScore: 'band 6,5' })).resolves.toBe('6.5');
    expect(call).toHaveBeenCalledWith(SET_LATEST_EXAM_SCORE_CALLABLE, { ...target, latestScore: '6.5' });
    expect(listener).toHaveBeenCalledWith({ ...target, latestScore: '6.5' });
    unsubscribe();
    call.mockResolvedValueOnce({ latestScore: { ...target, latestScore: null } });
    await expect(saveLatestExamScore(call, { ...target, latestScore: null })).resolves.toBeNull();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('rejects an invalid score without calling the server', async () => {
    const call = vi.fn();
    await expect(saveLatestExamScore(call, { ...target, latestScore: '9.5' })).rejects.toMatchObject({ code: 'invalid' });
    expect(call).not.toHaveBeenCalled();
  });

  it('maps server refusals to editor error codes', async () => {
    const cases: Array<[unknown, string]> = [
      [{ code: 'functions/failed-precondition', details: { reason: 'goal-not-found' } }, 'goal-missing'],
      [{ code: 'functions/resource-exhausted' }, 'rate-limited'],
      [{ code: 'functions/invalid-argument' }, 'invalid'],
      [{ code: 'functions/unavailable' }, 'unavailable'],
      [new Error('boom'), 'failed'],
    ];
    for (const [error, code] of cases) {
      await expect(saveLatestExamScore(vi.fn(async () => { throw error; }), { ...target, latestScore: '7.0' }))
        .rejects.toMatchObject({ code });
    }
    await expect(saveLatestExamScore(vi.fn(async () => ({ latestScore: { latestScore: 'seven' } })), { ...target, latestScore: '7.0' }))
      .rejects.toBeInstanceOf(LatestExamScoreError);
  });
});
