import {
  ACCOUNT_NATIVE_LANGUAGES,
  ACCOUNT_UI_LOCALES,
  CURRENT_PRIVACY_VERSION,
  CURRENT_TERMS_VERSION,
  MAXIMUM_PLAUSIBLE_AGE_YEARS,
  accountAgeCurrentYear,
  type AccountUiLocale,
  type CompleteAccountProfileRequest,
} from '../../../functions/src/account-profile-contract';
import type { CourseNativeLanguage } from '../courses/courseModel';

export type BirthYearProblem = 'format' | 'future' | 'implausible';

/**
 * Mirrors the server's range check so the learner sees a field error before sending. The server stays the
 * authority: it re-validates the year and alone decides the age rule, so this never says "too young".
 */
export const birthYearProblem = (value: string, now: Date): BirthYearProblem | null => {
  if (!/^\d{4}$/.test(value)) return 'format';
  const year = Number(value);
  const currentYear = accountAgeCurrentYear(now);
  if (year > currentYear) return 'future';
  if (currentYear - year > MAXIMUM_PLAUSIBLE_AGE_YEARS) return 'implausible';
  return null;
};

export const isAccountUiLocale = (value: string): value is AccountUiLocale =>
  (ACCOUNT_UI_LOCALES as readonly string[]).includes(value);

export const isAccountNativeLanguage = (value: string): value is CourseNativeLanguage =>
  (ACCOUNT_NATIVE_LANGUAGES as readonly string[]).includes(value);

/** Matches the course onboarding default: English speakers default to English, everyone else to Vietnamese. */
export const defaultNativeLanguageFor = (uiLocale: string): CourseNativeLanguage => (uiLocale === 'en' ? 'en' : 'vi');

export const accountProfileSubmission = (
  birthYear: string,
  uiLocale: AccountUiLocale,
  nativeLanguage: CourseNativeLanguage,
): Omit<CompleteAccountProfileRequest, 'ownerId'> => ({
  birthYear: Number(birthYear),
  uiLocale,
  nativeLanguage,
  consent: { accepted: true, termsVersion: CURRENT_TERMS_VERSION, privacyVersion: CURRENT_PRIVACY_VERSION },
});
