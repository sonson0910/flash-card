import { describe, expect, it } from 'vitest';
import {
  createLegacyCourseProfile,
  parseCourseProfile,
  normalizeCreateCourseInput,
  type CourseProfile,
} from './courseModel';
import {
  archiveCourseInProfile,
  createCourseInProfile,
  reopenCourseInProfile,
  setActiveCourseInProfile,
} from './courseOperations';

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

const ids = (() => {
  let course = 0;
  let goal = 0;
  return (kind: 'course' | 'goal') => `${kind}-${kind === 'course' ? ++course : ++goal}`;
})();

describe('bounded course profile contract', () => {
  it('accepts the exact profile shape and materializes all preference keys', () => {
    expect(parseCourseProfile(profile)).toEqual(profile);
    expect(Object.keys(profile)).toEqual(['courses', 'activeCourseId']);
    expect(Object.keys(profile.courses[0] ?? {})).toEqual([
      'id', 'targetLanguage', 'nativeLanguage', 'status', 'goals', 'preferences', 'createdAt',
    ]);
    expect(Object.keys(profile.courses[0]?.preferences ?? {})).toEqual([
      'pronunciationVariant', 'showRomanization', 'zhScript',
    ]);
  });

  it('rejects unknown keys and unsupported languages', () => {
    expect(() => parseCourseProfile({ ...profile, unexpected: true })).toThrow(/unknown field/);
    expect(() => parseCourseProfile({
      ...profile,
      courses: [{ ...profile.courses[0], targetLanguage: 'fr' }],
    })).toThrow(/unsupported value/);
    expect(() => parseCourseProfile({
      ...profile,
      courses: [{ ...profile.courses[0], nativeLanguage: 'ja' }],
    })).toThrow(/unsupported value/);
  });

  it('rejects duplicate target languages and an archived active course', () => {
    expect(() => parseCourseProfile({
      ...profile,
      courses: [profile.courses[0], { ...profile.courses[0], id: 'english-2' }],
    })).toThrow(/duplicate target/);
    expect(() => parseCourseProfile({
      ...profile,
      courses: [{ ...profile.courses[0], status: 'archived' }],
    })).toThrow(/activeCourseId/);
    expect(() => parseCourseProfile({
      ...profile,
      activeCourseId: null,
    })).toThrow(/when one exists/);
  });

  it('keeps the legacy English pilot profile deterministic', () => {
    expect(createLegacyCourseProfile()).toEqual(profile);
    expect(createLegacyCourseProfile('en').courses[0]).toMatchObject({
      id: 'legacy-en-en',
      targetLanguage: 'en',
      nativeLanguage: 'en',
    });
  });

  it('supports omitted optional fields while rejecting duplicate initial goals', () => {
    expect(normalizeCreateCourseInput({
      targetLanguage: 'ko',
      nativeLanguage: 'vi',
    })).toMatchObject({
      goals: [],
      preferences: {
        pronunciationVariant: null,
        showRomanization: false,
        zhScript: null,
      },
    });
    expect(() => normalizeCreateCourseInput({
      targetLanguage: 'ko',
      nativeLanguage: 'vi',
      goals: [{ kind: 'topik-2' }, { kind: 'topik-2' }],
    })).toThrow(/duplicate goal/);
  });

  it('rejects a duplicate target even when the existing course is archived', () => {
    const archived = archiveCourseInProfile(profile, 'legacy-en-vi');
    expect(() => createCourseInProfile(
      archived,
      { targetLanguage: 'en', nativeLanguage: 'vi' },
      ids,
      () => '2026-09-25T00:00:00.000Z',
    )).toThrow(/already exists/);
  });

  it('moves the active pointer deterministically when archiving and reopens the same ID', () => {
    const withKorean = createCourseInProfile(
      profile,
      { targetLanguage: 'ko', nativeLanguage: 'vi' },
      ids,
      () => '2026-09-25T00:00:00.000Z',
    );
    const archivedEnglish = archiveCourseInProfile(withKorean, 'legacy-en-vi');
    expect(archivedEnglish.activeCourseId).toBe('course-1');
    expect(archivedEnglish.courses[0]?.status).toBe('archived');
    expect(() => setActiveCourseInProfile(archivedEnglish, 'legacy-en-vi')).toThrow(/archived/);
    const reopened = reopenCourseInProfile(archivedEnglish, 'legacy-en-vi');
    expect(reopened.activeCourseId).toBe('legacy-en-vi');
    expect(reopened.courses[0]?.status).toBe('active');
  });
});
