export interface LanguageMetadata {
  readonly code: string;
  readonly displayName: string;
}

export interface LanguageProfile {
  readonly id: string;
  readonly source: LanguageMetadata;
  readonly target: LanguageMetadata;
  readonly speechLocale: string;
  readonly normalize: (value: unknown) => string;
}

const normalizeEnglishVocabulary = (value: unknown): string => {
  if (typeof value !== 'string') return '';
  return value
    .normalize('NFKC')
    .trim()
    .toLocaleLowerCase('en-US')
    .replace(/\s+/g, ' ');
};

export const ENGLISH_TO_VIETNAMESE_PROFILE: LanguageProfile = Object.freeze({
  id: 'en-vi',
  source: Object.freeze({
    code: 'en',
    displayName: 'English',
  }),
  target: Object.freeze({
    code: 'vi',
    displayName: 'Vietnamese',
  }),
  speechLocale: 'en-US',
  normalize: normalizeEnglishVocabulary,
});
