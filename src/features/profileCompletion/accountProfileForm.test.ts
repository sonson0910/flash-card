import { describe, expect, it } from 'vitest';
import {
  ACCOUNT_NATIVE_LANGUAGES,
  ACCOUNT_UI_LOCALES,
  CURRENT_PRIVACY_VERSION,
  CURRENT_TERMS_VERSION,
  parseCompleteAccountProfileRequest,
} from '../../../functions/src/account-profile-contract';
import { ENABLED_UI_LOCALES } from '../../i18n/locales';
import { COURSE_NATIVE_LANGUAGES } from '../courses/courseModel';
import { accountProfileSubmission, birthYearProblem, defaultNativeLanguageFor } from './accountProfileForm';

const now = new Date('2026-11-19T08:30:00.000Z');

describe('account profile form', () => {
  it('offers exactly the app locales and the course native languages the server accepts', () => {
    expect([...ACCOUNT_UI_LOCALES]).toEqual([...ENABLED_UI_LOCALES]);
    expect([...ACCOUNT_NATIVE_LANGUAGES]).toEqual([...COURSE_NATIVE_LANGUAGES]);
  });

  it('accepts four-digit years from the plausible range without judging the age', () => {
    expect(birthYearProblem('1990', now)).toBeNull();
    expect(birthYearProblem('2026', now)).toBeNull();
    expect(birthYearProblem('1906', now)).toBeNull();
  });

  it.each([
    ['', 'format'],
    ['199', 'format'],
    ['19a0', 'format'],
    ['19900', 'format'],
    ['2027', 'future'],
    ['1905', 'implausible'],
  ])('reports %j as %s', (value, problem) => {
    expect(birthYearProblem(value, now)).toBe(problem);
  });

  it('defaults the native language the way course onboarding does', () => {
    expect(defaultNativeLanguageFor('en')).toBe('en');
    expect(defaultNativeLanguageFor('vi')).toBe('vi');
  });

  it('builds a request the server contract accepts, with the current policy versions', () => {
    const submission = accountProfileSubmission('1994', 'vi', 'en');
    expect(submission).toEqual({
      birthYear: 1994,
      uiLocale: 'vi',
      nativeLanguage: 'en',
      consent: { accepted: true, termsVersion: CURRENT_TERMS_VERSION, privacyVersion: CURRENT_PRIVACY_VERSION },
    });
    expect(parseCompleteAccountProfileRequest({ ownerId: 'owner', ...submission })).toEqual({ ownerId: 'owner', ...submission });
  });
});
