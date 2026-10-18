import { ENGLISH_TO_VIETNAMESE_PROFILE } from '../language/languageProfile';
import type { LanguageMetadata, LanguageProfile } from '../language/languageProfile';
import { NATIVE_LANGUAGE_LABEL, TARGET_LANGUAGE_LABEL } from './courseLanguageLabels';
import type { Course, CourseNativeLanguage, CourseTargetLanguage } from './courseModel';

/** Legacy users have no active course yet; this is the wave-1 default pair. */
export const DEFAULT_COURSE_TARGET_LANGUAGE: CourseTargetLanguage = 'en';
export const DEFAULT_COURSE_NATIVE_LANGUAGE: CourseNativeLanguage = 'vi';

const SPEECH_LOCALE: Readonly<Record<CourseTargetLanguage, string>> = {
  en: 'en-US',
  ko: 'ko-KR',
  ja: 'ja-JP',
  zh: 'zh-CN',
};

const normalizeCasedVocabulary = (locale: string) => (value: unknown): string => {
  if (typeof value !== 'string') return '';
  return value.normalize('NFKC').trim().toLocaleLowerCase(locale).replace(/\s+/g, ' ');
};

// Korean, Japanese, and Chinese vocabulary has no case to fold; case-folding
// a scriptless-case language is a no-op that only adds Unicode risk, so
// those targets only normalize width/compatibility form and whitespace.
const normalizeScriptVocabulary = (value: unknown): string => {
  if (typeof value !== 'string') return '';
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ');
};

const NORMALIZE_BY_TARGET: Readonly<Record<CourseTargetLanguage, (value: unknown) => string>> = {
  en: normalizeCasedVocabulary('en-US'),
  ko: normalizeScriptVocabulary,
  ja: normalizeScriptVocabulary,
  zh: normalizeScriptVocabulary,
};

const metadataFor = (code: string, descriptorMessage: string | undefined): LanguageMetadata =>
  Object.freeze({ code, displayName: descriptorMessage ?? code });

// Cached by pair so the same target/native combination always returns the
// same object identity. Several callers (useCardIntake's controller-reuse
// guard, useMemo deps elsewhere) reference-compare LanguageProfile values;
// minting a fresh object per render would churn those on every re-render.
const profileCache = new Map<string, LanguageProfile>();

export const languageProfileForPair = (
  target: CourseTargetLanguage,
  native: CourseNativeLanguage,
): LanguageProfile => {
  if (target === 'en' && native === 'vi') return ENGLISH_TO_VIETNAMESE_PROFILE;
  const key = `${target}-${native}`;
  const cached = profileCache.get(key);
  if (cached) return cached;
  const profile: LanguageProfile = Object.freeze({
    id: key,
    source: metadataFor(target, TARGET_LANGUAGE_LABEL[target]?.message),
    target: metadataFor(native, NATIVE_LANGUAGE_LABEL[native]?.message),
    speechLocale: SPEECH_LOCALE[target],
    normalize: NORMALIZE_BY_TARGET[target],
  });
  profileCache.set(key, profile);
  return profile;
};

export const activeCourseTargetLanguage = (
  course: Course | null | undefined,
): CourseTargetLanguage => course?.targetLanguage ?? DEFAULT_COURSE_TARGET_LANGUAGE;

export const activeCourseNativeLanguage = (
  course: Course | null | undefined,
): CourseNativeLanguage => course?.nativeLanguage ?? DEFAULT_COURSE_NATIVE_LANGUAGE;

export const languageProfileForCourse = (course: Course | null | undefined): LanguageProfile =>
  languageProfileForPair(activeCourseTargetLanguage(course), activeCourseNativeLanguage(course));
