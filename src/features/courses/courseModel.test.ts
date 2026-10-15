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

  it('replays a create operation only when it has the original operation ID', () => {
    const input = { targetLanguage: 'ko' as const, nativeLanguage: 'vi' as const, operationId: 'course-create-ko-1' };
    const created = createCourseInProfile(profile, input, ids, () => '2026-09-25T00:00:00.000Z');
    expect(createCourseInProfile(created, input, ids, () => '2026-09-25T00:00:00.000Z')).toEqual(created);
    expect(() => createCourseInProfile(created, {
      ...input, operationId: 'course-create-ko-2',
    }, ids, () => '2026-09-25T00:00:00.000Z')).toThrow(/already exists/);
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

import type { CardData } from '../../types/card';
import {
  createCourseItemId,
  parseEnrollmentV1,
  parseLearningPreferencesV1,
  projectCatalogEntriesToCourse,
  projectPersonalLibraryToCourse,
} from './courseModel';

const card = (id: string): CardData => ({
  id,
  word: id,
  normalizedWord: id,
  translation: `vi-${id}`,
  explanation: '',
  phonetic: '',
  emoji: '📘',
  category: 'General',
  audioUrl: null,
  imageUrl: null,
  createdAt: '2026-09-04T00:00:00.000Z',
  customDeck: null,
  difficulty: 'unrated',
});

describe('adaptive course projections', () => {
  it('projects personal cards into one course and one default scenario', () => {
    const result = projectPersonalLibraryToCourse({
      ownerId: 'owner-a',
      contentLanguage: 'en',
      supportLanguage: 'vi',
      cards: [card('two'), card('one')],
      migratedAt: '2026-09-04T00:00:00.000Z',
    });

    expect(result.course.source).toBe('personal');
    expect(result.scenario.courseId).toBe(result.course.id);
    expect(result.items.map(item => item.lexemeId)).toEqual(['one', 'two']);
    expect(result.enrollment.introducedItemIds).toEqual([]);
    expect(result.preferences.activeCourseByLanguage.en).toBe(result.course.id);
    expect(result.preferences.useV3Courses).toBe(false);
  });

  it('projects catalog entries without duplicating learner state', () => {
    const result = projectCatalogEntriesToCourse({
      catalogId: 'english-core',
      releaseId: 'release-1',
      trackId: 'general',
      contentLanguage: 'en',
      supportLanguage: 'vi',
      title: 'General English',
      entries: [
        { lexemeId: 'lexeme-b', rank: 2 },
        { lexemeId: 'lexeme-a', rank: 1 },
      ],
      createdAt: '2026-09-04T00:00:00.000Z',
    });

    expect(result.course.source).toBe('catalog');
    expect(result.items.map(item => item.lexemeId)).toEqual(['lexeme-a', 'lexeme-b']);
    expect(new Set(result.items.map(item => item.id)).size).toBe(2);
    expect(result.enrollment.courseId).toBe(result.course.id);
    expect(result.enrollment.introducedItemIds).toEqual([]);
  });

  it('keeps lexeme state identity while membership IDs differ by course', () => {
    expect(createCourseItemId('course-a', 'scenario-a', 'lexeme-a'))
      .not.toBe(createCourseItemId('course-b', 'scenario-a', 'lexeme-a'));
  });

  it('rejects invalid active-course values and unknown fields', () => {
    expect(() => parseLearningPreferencesV1({
      schemaVersion: 1,
      useV3Courses: false,
      activeCourseByLanguage: { en: ['course-a', 'course-b'] },
      focus: 'balanced',
      sessionSize: 'standard',
      unexpected: true,
    })).toThrow(/unknown field/);

    expect(() => parseLearningPreferencesV1({
      schemaVersion: 1,
      useV3Courses: false,
      activeCourseByLanguage: { en: 'course-a' },
      focus: 'balanced',
      sessionSize: 'standard',
    })).not.toThrow();
  });

  it('rejects non-canonical timestamps and unsafe projection identities', () => {
    expect(() => projectPersonalLibraryToCourse({
      ownerId: 'owner-a',
      contentLanguage: 'en',
      supportLanguage: 'vi',
      cards: [card('unsafe/id')],
      migratedAt: '2026-09-04T00:00:00Z',
    })).toThrow(/migratedAt|id/i);
  });

  it('allows bounded enrollment progress beyond the v3 per-lexeme membership limit', () => {
    const introducedItemIds = Array.from({ length: 33 }, (_, index) => `item-${index}`);
    expect(parseEnrollmentV1({
      schemaVersion: 1,
      courseId: 'course-a',
      activeScenarioId: 'scenario-a',
      completedScenarioIds: [],
      introducedItemIds,
      updatedAt: '2026-09-04T00:00:00.000Z',
    }).introducedItemIds).toHaveLength(33);
  });

  it('rejects control characters in owner identities', () => {
    expect(() => projectPersonalLibraryToCourse({
      ownerId: 'owner\u0000a',
      contentLanguage: 'en',
      supportLanguage: 'vi',
      cards: [card('safe')],
      migratedAt: '2026-09-04T00:00:00.000Z',
    })).toThrow(/ownerId/i);
  });
});
