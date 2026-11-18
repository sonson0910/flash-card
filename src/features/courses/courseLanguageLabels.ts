import { msg } from '@lingui/core/macro';
import type { MessageDescriptor } from '@lingui/core';
import type { CourseNativeLanguage, CourseTargetLanguage } from './courseModel';

export const TARGET_LANGUAGE_LABEL: Readonly<Record<CourseTargetLanguage, MessageDescriptor>> = {
  en: msg({ id: 'course.language.en', message: 'English' }),
  ko: msg({ id: 'course.language.ko', message: 'Korean' }),
  ja: msg({ id: 'course.language.ja', message: 'Japanese' }),
  zh: msg({ id: 'course.language.zh', message: 'Chinese' }),
};

export const NATIVE_LANGUAGE_LABEL: Readonly<Record<CourseNativeLanguage, MessageDescriptor>> = {
  vi: msg({ id: 'course.language.vi', message: 'Vietnamese' }),
  en: msg({ id: 'course.language.en', message: 'English' }),
};

export const TARGET_LANGUAGE_FLAG: Readonly<Record<CourseTargetLanguage, string>> = {
  en: '🇬🇧', ko: '🇰🇷', ja: '🇯🇵', zh: '🇨🇳',
};
