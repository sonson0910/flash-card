import { describe, expect, it } from 'vitest';
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
