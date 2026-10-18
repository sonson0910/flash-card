import { describe, expect, it } from 'vitest';
import { ENGLISH_TO_VIETNAMESE_PROFILE } from '../language/languageProfile';
import type { Course } from './courseModel';
import {
  activeCourseNativeLanguage,
  activeCourseTargetLanguage,
  languageProfileForCourse,
  languageProfileForPair,
} from './courseLanguageProfile';

const courseWith = (targetLanguage: Course['targetLanguage'], nativeLanguage: Course['nativeLanguage']) =>
  ({ targetLanguage, nativeLanguage } as Course);

describe('courseLanguageProfile', () => {
  it('defaults to English target and Vietnamese native when there is no active course', () => {
    expect(activeCourseTargetLanguage(null)).toBe('en');
    expect(activeCourseNativeLanguage(null)).toBe('vi');
    expect(activeCourseTargetLanguage(undefined)).toBe('en');
  });

  it('reuses the existing English-Vietnamese profile object for the legacy pair', () => {
    expect(languageProfileForPair('en', 'vi')).toBe(ENGLISH_TO_VIETNAMESE_PROFILE);
    expect(languageProfileForCourse(null)).toBe(ENGLISH_TO_VIETNAMESE_PROFILE);
  });

  it('builds a stable, cached profile per target/native pair for non-default courses', () => {
    const first = languageProfileForPair('ko', 'vi');
    const second = languageProfileForPair('ko', 'vi');
    expect(first).toBe(second);
    expect(first.source.code).toBe('ko');
    expect(first.target.code).toBe('vi');
    expect(first.speechLocale).toBe('ko-KR');
  });

  it('normalizes Latin-script targets with case folding and non-Latin targets without it', () => {
    const english = languageProfileForPair('en', 'vi');
    expect(english.normalize('  ＡＰＰＬＥ  Pie ')).toBe('apple pie');

    const korean = languageProfileForPair('ko', 'en');
    expect(korean.normalize('  사과  ')).toBe('사과');
  });

  it('derives the full profile from a course record', () => {
    const course = courseWith('ja', 'en');
    const profile = languageProfileForCourse(course);
    expect(profile.source.code).toBe('ja');
    expect(profile.target.code).toBe('en');
    expect(profile.speechLocale).toBe('ja-JP');
  });
});
