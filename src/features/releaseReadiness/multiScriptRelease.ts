const RTL_LANGUAGES = new Set(['ar', 'fa', 'he', 'ur']);

export function scriptPresentation(language: string): { readonly lang: string; readonly dir: 'ltr' | 'rtl' } {
  if (language.length === 0 || language.length > 64) throw new TypeError('Language tag is required and bounded.');
  const [canonical] = Intl.getCanonicalLocales(language);
  if (!canonical) throw new TypeError('Language tag is invalid.');
  return { lang: canonical, dir: RTL_LANGUAGES.has(canonical.split('-')[0].toLowerCase()) ? 'rtl' : 'ltr' };
}
