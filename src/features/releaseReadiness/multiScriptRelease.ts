const RTL_LANGUAGES = new Set(['ar', 'fa', 'he', 'ur']);

const SCRIPT_LANGUAGE_RULES: ReadonlyArray<readonly [RegExp, string]> = [
  [/\p{Script=Hebrew}/u, 'he'],
  [/\p{Script=Arabic}/u, 'ar'],
  [/[\p{Script=Hiragana}\p{Script=Katakana}]/u, 'ja'],
  [/\p{Script=Hangul}/u, 'ko'],
  [/\p{Script=Han}/u, 'zh-Hans'],
];

export function scriptPresentation(language: string): { readonly lang: string; readonly dir: 'ltr' | 'rtl' } {
  if (language.length === 0 || language.length > 64) throw new TypeError('Language tag is required and bounded.');
  let canonical: string | undefined;
  try {
    [canonical] = Intl.getCanonicalLocales(language);
  } catch {
    throw new TypeError('Language tag is invalid.');
  }
  if (!canonical) throw new TypeError('Language tag is invalid.');
  return { lang: canonical, dir: RTL_LANGUAGES.has(canonical.split('-')[0].toLowerCase()) ? 'rtl' : 'ltr' };
}

export function learnerContentLanguage(content: string, fallbackLanguage: string): string {
  const fallback = scriptPresentation(fallbackLanguage).lang;
  return SCRIPT_LANGUAGE_RULES.find(([pattern]) => pattern.test(content))?.[1] ?? fallback;
}
