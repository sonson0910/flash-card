import { describe, expect, it } from 'vitest';
import { silentCaptureCourseDecision } from './app-runtime-shared';

const course = (id: string, targetLanguage: string, status = 'active') => ({ id, targetLanguage, nativeLanguage: 'vi', status });
const profile = (activeCourseId: string) => ({
  activeCourseId,
  courses: [course('en', 'en'), course('ko', 'ko')],
}) as Parameters<typeof silentCaptureCourseDecision>[2];

describe('silentCaptureCourseDecision', () => {
  it('proceeds when the capture language is the active course', () => {
    expect(silentCaptureCourseDecision('ko', 'vi', profile('ko'))).toBe('proceed');
  });

  it('cancels instead of switching when another course is active', () => {
    expect(silentCaptureCourseDecision('en', 'vi', profile('ko'))).toBe('cancel');
  });

  it('cancels instead of creating a course the learner does not have', () => {
    expect(silentCaptureCourseDecision('ja', 'vi', profile('ko'))).toBe('cancel');
  });

  it('cancels when the course would have to be reopened or its native language differs', () => {
    expect(silentCaptureCourseDecision('en', 'en', profile('en'))).toBe('cancel');
  });
});
