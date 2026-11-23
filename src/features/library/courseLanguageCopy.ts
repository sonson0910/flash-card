import type { I18n, MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import type { LanguageProfile } from '../language/languageProfile';
import { resolveLanguagePackId } from '../languagePacks/registry';

const wordLabelMessage = msg({ id: 'library.create.word-label', message: '{language, select, ko {Korean word} ja {Japanese word} zh {Chinese word} other {English word}}' });
const wordPlaceholderMessage = msg({ id: 'library.create.word-placeholder', message: '{language, select, ko {Type a Korean word (e.g. 사랑)…} ja {Type a Japanese word (e.g. 桜)…} zh {Type a Chinese word (e.g. 你好)…} other {Type an English word (e.g. serendipity)…}}' });
const searchLabelMessage = msg({ id: 'library.filters.search-label', message: '{language, select, ko {Search Korean words} ja {Search Japanese words} zh {Search Chinese words} other {Search English words}}' });
const searchPlaceholderMessage = msg({ id: 'library.filters.search-placeholder', message: '{language, select, ko {Search Korean words…} ja {Search Japanese words…} zh {Search Chinese words…} other {Search English words…}}' });

const format = (i18n: I18n, message: MessageDescriptor, profile: LanguageProfile): string =>
  i18n._(message.id, { language: resolveLanguagePackId(profile.source.code) }, { message: message.message });

/** The words a course teaches are written in the profile's source language; its copy and `lang` follow it. */
export const courseWordCopy = (i18n: I18n, profile: LanguageProfile) => ({
  lang: profile.source.code,
  wordLabel: format(i18n, wordLabelMessage, profile),
  wordPlaceholder: format(i18n, wordPlaceholderMessage, profile),
  searchLabel: format(i18n, searchLabelMessage, profile),
  searchPlaceholder: format(i18n, searchPlaceholderMessage, profile),
});
