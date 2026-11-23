import { COURSE_NATIVE_LANGUAGES, type CourseNativeLanguage } from './course-profile-contract.js';

// Shared by the client and the server: keep this module free of firebase-admin imports.

export const ACCOUNT_PROFILE_DOCUMENT_ID = 'account';
export const AGE_RESTRICTION_DOCUMENT_ID = 'age_restriction';

/** The UI locales the app ships; the client test keeps this equal to its enabled locale list. */
export const ACCOUNT_UI_LOCALES = Object.freeze(['en', 'vi'] as const);
export const ACCOUNT_NATIVE_LANGUAGES = COURSE_NATIVE_LANGUAGES;

/** Dates printed as "Updated" on public/terms.html and public/privacy.html. */
export const CURRENT_TERMS_VERSION = '2026-10-01';
export const CURRENT_PRIVACY_VERSION = '2026-11-19';

export const MINIMUM_ACCOUNT_AGE_YEARS = 18;
/** A birth year further back than this many years is treated as a typing mistake. */
export const MAXIMUM_PLAUSIBLE_AGE_YEARS = 120;

export type AccountUiLocale = (typeof ACCOUNT_UI_LOCALES)[number];

export interface AccountProfileRecord {
  readonly birthYear: number;
  readonly uiLocale: AccountUiLocale;
  readonly nativeLanguage: CourseNativeLanguage;
  readonly termsVersion: string;
  readonly privacyVersion: string;
  readonly consentAcceptedAt: string;
  readonly completedAt: string;
}

export interface AgeRestrictionMarker {
  readonly restrictedAt: string;
}

export interface CompleteAccountProfileRequest {
  readonly ownerId: string;
  readonly birthYear: number;
  readonly uiLocale: AccountUiLocale;
  readonly nativeLanguage: CourseNativeLanguage;
  readonly consent: {
    readonly accepted: true;
    readonly termsVersion: string;
    readonly privacyVersion: string;
  };
}

export interface UpdateAccountUiLocaleRequest {
  readonly ownerId: string;
  readonly uiLocale: AccountUiLocale;
}

export type CompleteAccountProfileResponse =
  | { readonly status: 'complete'; readonly profile: AccountProfileRecord }
  | { readonly status: 'restricted'; readonly restrictedAt: string };

export type BirthYearOutcome = 'allowed' | 'restricted';

export const accountProfileDocumentKeys = Object.freeze([
  'birthYear', 'uiLocale', 'nativeLanguage', 'termsVersion', 'privacyVersion', 'consentAcceptedAt', 'completedAt',
] as const);
export const ageRestrictionDocumentKeys = Object.freeze(['restrictedAt'] as const);

/** Messages name the field and the rule, never the submitted value. */
export class AccountProfileValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AccountProfileValidationError';
  }
}

type UnknownRecord = Record<string, unknown>;

const fail = (path: string, message: string): never => {
  throw new AccountProfileValidationError(`${path}: ${message}`);
};

const recordAt = (value: unknown, path: string, keys: readonly string[]): UnknownRecord => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail(path, 'expected an object');
  const record = value as UnknownRecord;
  const unknownKey = Object.keys(record).find(key => !keys.includes(key));
  if (unknownKey) fail(`${path}.${unknownKey}`, 'unknown field');
  const missingKey = keys.find(key => !Object.prototype.hasOwnProperty.call(record, key));
  if (missingKey) fail(`${path}.${missingKey}`, 'missing field');
  return record;
};

const enumAt = <T extends string>(value: unknown, path: string, values: readonly T[]): T => {
  if (typeof value !== 'string' || !values.includes(value as T)) fail(path, 'contains an unsupported value');
  return value as T;
};

const ownerAt = (value: unknown, path: string): string => {
  if (typeof value !== 'string' || value.length === 0 || value.length > 128
    || value !== value.trim() || value.includes('/') || /[\x00-\x1F\x7F]/.test(value)) {
    fail(path, 'expected an account identifier');
  }
  return value as string;
};

const versionAt = (value: unknown, path: string): string => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail(path, 'expected a policy version date');
  return value as string;
};

const birthYearAt = (value: unknown, path: string): number => {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1000 || value > 9999) {
    fail(path, 'expected a four-digit year');
  }
  return value as number;
};

const timestampAt = (value: unknown, path: string): string => {
  if (typeof value !== 'string') fail(path, 'expected a timestamp');
  const parsed = Date.parse(value as string);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    fail(path, 'expected a canonical ISO-8601 UTC timestamp');
  }
  return value as string;
};

export const parseCompleteAccountProfileRequest = (value: unknown): CompleteAccountProfileRequest => {
  const record = recordAt(value, 'request', ['ownerId', 'birthYear', 'uiLocale', 'nativeLanguage', 'consent']);
  const consent = recordAt(record.consent, 'request.consent', ['accepted', 'termsVersion', 'privacyVersion']);
  if (consent.accepted !== true) fail('request.consent.accepted', 'consent is required');
  return {
    ownerId: ownerAt(record.ownerId, 'request.ownerId'),
    birthYear: birthYearAt(record.birthYear, 'request.birthYear'),
    uiLocale: enumAt(record.uiLocale, 'request.uiLocale', ACCOUNT_UI_LOCALES),
    nativeLanguage: enumAt(record.nativeLanguage, 'request.nativeLanguage', ACCOUNT_NATIVE_LANGUAGES),
    consent: {
      accepted: true,
      termsVersion: versionAt(consent.termsVersion, 'request.consent.termsVersion'),
      privacyVersion: versionAt(consent.privacyVersion, 'request.consent.privacyVersion'),
    },
  };
};

export const parseUpdateAccountUiLocaleRequest = (value: unknown): UpdateAccountUiLocaleRequest => {
  const record = recordAt(value, 'request', ['ownerId', 'uiLocale']);
  return {
    ownerId: ownerAt(record.ownerId, 'request.ownerId'),
    uiLocale: enumAt(record.uiLocale, 'request.uiLocale', ACCOUNT_UI_LOCALES),
  };
};

const EARLIEST_UTC_OFFSET_MS = 14 * 60 * 60 * 1_000;

/**
 * The current year in the earliest time zone (UTC+14). No learner's local year is ahead of it, so a new
 * year that has started anywhere counts at once and nobody is held back by the server's own time zone.
 */
export const accountAgeCurrentYear = (now: Date): number =>
  new Date(now.getTime() + EARLIEST_UTC_OFFSET_MS).getUTCFullYear();

/**
 * The account age rule. A birth year cannot separate 17 from 18 inside the birthday year; the
 * "18 or older" statement in the consent covers that gap. The year is the server clock's year at UTC+14.
 */
export const evaluateBirthYear = (birthYear: number, now: Date): BirthYearOutcome => {
  const currentYear = accountAgeCurrentYear(now);
  if (birthYear > currentYear) fail('request.birthYear', 'must not be in the future');
  if (currentYear - birthYear > MAXIMUM_PLAUSIBLE_AGE_YEARS) fail('request.birthYear', 'is not a plausible birth year');
  return currentYear - birthYear >= MINIMUM_ACCOUNT_AGE_YEARS ? 'allowed' : 'restricted';
};

export const isCurrentConsent = (consent: CompleteAccountProfileRequest['consent']): boolean =>
  consent.termsVersion === CURRENT_TERMS_VERSION && consent.privacyVersion === CURRENT_PRIVACY_VERSION;

export const parseAccountProfileRecord = (value: unknown): AccountProfileRecord => {
  const record = recordAt(value, 'account', accountProfileDocumentKeys);
  return {
    birthYear: birthYearAt(record.birthYear, 'account.birthYear'),
    uiLocale: enumAt(record.uiLocale, 'account.uiLocale', ACCOUNT_UI_LOCALES),
    nativeLanguage: enumAt(record.nativeLanguage, 'account.nativeLanguage', ACCOUNT_NATIVE_LANGUAGES),
    termsVersion: versionAt(record.termsVersion, 'account.termsVersion'),
    privacyVersion: versionAt(record.privacyVersion, 'account.privacyVersion'),
    consentAcceptedAt: timestampAt(record.consentAcceptedAt, 'account.consentAcceptedAt'),
    completedAt: timestampAt(record.completedAt, 'account.completedAt'),
  };
};

export const parseAgeRestrictionMarker = (value: unknown): AgeRestrictionMarker => {
  const record = recordAt(value, 'age_restriction', ageRestrictionDocumentKeys);
  return { restrictedAt: timestampAt(record.restrictedAt, 'age_restriction.restrictedAt') };
};

export const createAccountProfileRecord = (
  request: CompleteAccountProfileRequest,
  completedAt: string,
): AccountProfileRecord => ({
  birthYear: request.birthYear,
  uiLocale: request.uiLocale,
  nativeLanguage: request.nativeLanguage,
  termsVersion: request.consent.termsVersion,
  privacyVersion: request.consent.privacyVersion,
  consentAcceptedAt: completedAt,
  completedAt,
});
