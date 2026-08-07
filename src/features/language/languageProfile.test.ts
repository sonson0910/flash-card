import { describe, expect, it } from 'vitest';
import { ENGLISH_TO_VIETNAMESE_PROFILE } from './languageProfile';

describe('ENGLISH_TO_VIETNAMESE_PROFILE', () => {
  it('describes the English source and Vietnamese target without runtime lookup', () => {
    expect(ENGLISH_TO_VIETNAMESE_PROFILE).toMatchObject({
      id: 'en-vi',
      source: {
        code: 'en',
        displayName: 'English',
      },
      target: {
        code: 'vi',
        displayName: 'Vietnamese',
      },
      speechLocale: 'en-US',
    });
  });

  it('normalizes English vocabulary deterministically for identity and lookup', () => {
    expect(ENGLISH_TO_VIETNAMESE_PROFILE.normalize('  FULLWIDTH ＡＰＰＬＥ   Pie  '))
      .toBe('fullwidth apple pie');
  });

  it('normalizes non-string input to an empty key', () => {
    expect(ENGLISH_TO_VIETNAMESE_PROFILE.normalize(undefined)).toBe('');
  });

  it('is immutable at the profile and language metadata boundaries', () => {
    expect(Object.isFrozen(ENGLISH_TO_VIETNAMESE_PROFILE)).toBe(true);
    expect(Object.isFrozen(ENGLISH_TO_VIETNAMESE_PROFILE.source)).toBe(true);
    expect(Object.isFrozen(ENGLISH_TO_VIETNAMESE_PROFILE.target)).toBe(true);
  });
});
