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

/** Each language written in its own script; the translated labels above carry the UI-language name. */
export const TARGET_ENDONYM: Readonly<Record<CourseTargetLanguage, string>> = {
  en: 'English', ko: '한국어', ja: '日本語', zh: '中文',
};

export const NATIVE_ENDONYM: Readonly<Record<CourseNativeLanguage, string>> = {
  vi: 'Tiếng Việt', en: 'English',
};

/** One character that stands for the language on course tiles. */
export const TARGET_GLYPH: Readonly<Record<CourseTargetLanguage, string>> = {
  en: 'A', ko: '한', ja: 'あ', zh: '中',
};

/** A first word in the language, shown as a sample on the language cards of the add dialog. */
export const TARGET_GREETING: Readonly<Record<CourseTargetLanguage, string>> = {
  en: 'Hello', ko: '안녕하세요', ja: 'こんにちは', zh: '你好',
};
