import { describe, expect, it } from 'vitest';
import {
  projectCourseCardIndex,
  UnsupportedCourseCardLanguageError,
} from './course-card-index';
import type { CardData } from '../types/card';

describe('course card index projection', () => {
  it('projects only normalized query fields and leaves malformed source fields untouched', () => {
    const source = {
      id: 'source-id',
      word: '  Hello   World  ',
      normalizedWord: 42,
      translation: 'Xin chào',
      translationLanguage: 'vi',
      category: '',
      partOfSpeech: ' Phrasal-Verb ',
      customDeck: '  ',
      difficulty: 'impossible',
      bookmarked: 'yes',
      createdAt: 'not-a-date',
      nextReviewDate: 'also-not-a-date',
      revision: '2',
      libraryEpoch: -1,
    } as unknown as Partial<CardData>;
    const before = structuredClone(source);

    const projection = projectCourseCardIndex(source, 'card-1');

    expect(projection).toEqual({
      schemaVersion: 1,
      cardId: 'card-1',
      targetLanguage: 'en',
      sourceLibraryEpoch: 0,
      sourceRevision: null,
      normalizedWord: 'hello world',
      category: 'Other',
      partOfSpeech: 'phrasal verb',
      customDeck: null,
      difficulty: 'unrated',
      bookmarked: false,
      createdAt: '1970-01-01T00:00:00.000Z',
    });
    expect(Object.keys(projection).sort()).toEqual([
      'bookmarked', 'cardId', 'category', 'createdAt', 'customDeck', 'difficulty',
      'normalizedWord', 'partOfSpeech', 'schemaVersion', 'sourceLibraryEpoch',
      'sourceRevision', 'targetLanguage',
    ]);
    expect(source).toEqual(before);
    expect(projection).not.toHaveProperty('translationLanguage');
    expect(projection).not.toHaveProperty('translation');
  });

  it.each([
    ['english'],
    ['EN'],
    [''],
    [null],
    [42],
    [{}],
  ])('rejects an explicit malformed or unsupported target %j', language => {
    expect(() => projectCourseCardIndex({ word: 'hello', language } as unknown as Partial<CardData>, 'card-1'))
      .toThrow(UnsupportedCourseCardLanguageError);
  });

  it('keeps same-spelling English and Korean cards in separate target rows', () => {
    const english = projectCourseCardIndex({ word: 'lead' }, 'english-card');
    const korean = projectCourseCardIndex({ word: 'lead', language: 'ko', translationLanguage: 'en' }, 'korean-card');

    expect(english).toMatchObject({ cardId: 'english-card', normalizedWord: 'lead', targetLanguage: 'en' });
    expect(korean).toMatchObject({ cardId: 'korean-card', normalizedWord: 'lead', targetLanguage: 'ko' });
    expect(english.cardId).not.toBe(korean.cardId);
    expect(english.targetLanguage).not.toBe(korean.targetLanguage);
  });
});
