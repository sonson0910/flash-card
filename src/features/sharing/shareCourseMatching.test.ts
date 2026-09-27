import { describe, expect, it, vi } from 'vitest';
import type { Course, CourseProfile } from '../courses/courseModel';
import { createSharedDeckCoursePort, resolveShareCourseAction } from './shareCourseMatching';
import type { SharedDeckIncomingPreview } from './sharedDeckSessionController';

const makeCourse = (id: string, overrides: Partial<Course> = {}): Course => ({
  id, targetLanguage: 'en', nativeLanguage: 'vi', status: 'active', goals: [],
  preferences: { pronunciationVariant: null, showRomanization: false, zhScript: null },
  createdAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

const previewWithPair = (targetLanguage: string | null, translationLanguage: string | null): SharedDeckIncomingPreview => ({
  shareId: 'share-1', category: 'Shared deck', cardCount: 1, sampleWords: [],
  languagePairs: [{ targetLanguage, translationLanguage }],
  createdAt: null, expiresAt: null, containsAiGeneratedCards: false,
});

describe('resolveShareCourseAction', () => {
  it('returns null when the deck has no single clear language pair', () => {
    const preview: SharedDeckIncomingPreview = { ...previewWithPair('ko', 'vi'), languagePairs: [] };
    expect(resolveShareCourseAction(preview, null)).toBeNull();
    expect(resolveShareCourseAction({ ...preview, languagePairs: [{ targetLanguage: 'ko', translationLanguage: 'vi' }, { targetLanguage: 'ja', translationLanguage: 'vi' }] }, null)).toBeNull();
  });

  it('returns null for a language pair outside the supported course languages', () => {
    expect(resolveShareCourseAction(previewWithPair('fr', 'vi'), null)).toBeNull();
    expect(resolveShareCourseAction(previewWithPair('ko', 'fr'), null)).toBeNull();
    expect(resolveShareCourseAction(previewWithPair(null, 'vi'), null)).toBeNull();
  });

  it('asks to create a course when there is no profile yet', () => {
    expect(resolveShareCourseAction(previewWithPair('ko', 'vi'), null)).toEqual({ action: 'create', targetLanguage: 'ko', nativeLanguage: 'vi' });
  });

  it('asks to create a course when no course matches the target language', () => {
    const profile: CourseProfile = { activeCourseId: 'course-en', courses: [makeCourse('course-en')] };
    expect(resolveShareCourseAction(previewWithPair('ko', 'vi'), profile)?.action).toBe('create');
  });

  it('asks to reopen an archived matching course', () => {
    const profile: CourseProfile = {
      activeCourseId: 'course-en',
      courses: [makeCourse('course-en'), makeCourse('course-ko', { targetLanguage: 'ko', status: 'archived' })],
    };
    expect(resolveShareCourseAction(previewWithPair('ko', 'vi'), profile)?.action).toBe('reopen');
  });

  it('asks to switch to an active but not-currently-active matching course', () => {
    const profile: CourseProfile = {
      activeCourseId: 'course-en',
      courses: [makeCourse('course-en'), makeCourse('course-ko', { targetLanguage: 'ko' })],
    };
    expect(resolveShareCourseAction(previewWithPair('ko', 'vi'), profile)?.action).toBe('switch');
  });

  it('does nothing when the matching course is already active', () => {
    const profile: CourseProfile = { activeCourseId: 'course-en', courses: [makeCourse('course-en')] };
    expect(resolveShareCourseAction(previewWithPair('en', 'vi'), profile)?.action).toBe('none');
  });
});

describe('createSharedDeckCoursePort', () => {
  it('never throws when the underlying action rejects, so the deck can still import', async () => {
    const actions = {
      createCourse: vi.fn().mockRejectedValue(new Error('network down')),
      reopenCourse: vi.fn(), switchCourse: vi.fn(), updateCourse: vi.fn(), archiveCourse: vi.fn(),
      addGoal: vi.fn(), updateGoal: vi.fn(), removeGoal: vi.fn(), clearError: vi.fn(),
    };
    const port = createSharedDeckCoursePort({
      model: { status: 'ready', source: 'cloud', profile: null, activeCourse: null, pending: false, errorCode: null },
      actions: actions as never,
    });
    await expect(port.ensureCourseForIncomingShare(previewWithPair('ko', 'vi'))).resolves.toBeUndefined();
    expect(actions.createCourse).toHaveBeenCalledWith({ targetLanguage: 'ko', nativeLanguage: 'vi' });
  });

  it('does nothing when the deck already matches the active course', async () => {
    const actions = {
      createCourse: vi.fn(), reopenCourse: vi.fn(), switchCourse: vi.fn(), updateCourse: vi.fn(),
      archiveCourse: vi.fn(), addGoal: vi.fn(), updateGoal: vi.fn(), removeGoal: vi.fn(), clearError: vi.fn(),
    };
    const profile: CourseProfile = { activeCourseId: 'course-en', courses: [makeCourse('course-en')] };
    const port = createSharedDeckCoursePort({
      model: { status: 'ready', source: 'cloud', profile, activeCourse: makeCourse('course-en'), pending: false, errorCode: null },
      actions: actions as never,
    });
    await port.ensureCourseForIncomingShare(previewWithPair('en', 'vi'));
    expect(actions.createCourse).not.toHaveBeenCalled();
    expect(actions.switchCourse).not.toHaveBeenCalled();
  });
});
