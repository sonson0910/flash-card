export const UI_LOCALE_STORAGE_KEY = 'sonflash_ui_locale';

export const UI_LOCALES = {
  en: { wave: 1, autonym: 'English', dir: 'ltr', cjk: false, fontStack: 'latin', hreflang: 'en', enabled: true },
  vi: { wave: 1, autonym: 'Tiếng Việt', dir: 'ltr', cjk: false, fontStack: 'latin', hreflang: 'vi', enabled: true },
  id: { wave: 2, autonym: 'Bahasa Indonesia', dir: 'ltr', cjk: false, fontStack: 'latin', hreflang: 'id', enabled: false },
  'pt-BR': { wave: 2, autonym: 'Português (Brasil)', dir: 'ltr', cjk: false, fontStack: 'latin', hreflang: 'pt-BR', enabled: false },
  es: { wave: 2, autonym: 'Español', dir: 'ltr', cjk: false, fontStack: 'latin', hreflang: 'es', enabled: false },
  ja: { wave: 3, autonym: '日本語', dir: 'ltr', cjk: true, fontStack: 'japanese', hreflang: 'ja', enabled: false },
  ko: { wave: 3, autonym: '한국어', dir: 'ltr', cjk: true, fontStack: 'korean', hreflang: 'ko', enabled: false },
  tr: { wave: 4, autonym: 'Türkçe', dir: 'ltr', cjk: false, fontStack: 'latin', hreflang: 'tr', enabled: false },
} as const;

export type UiLocale = keyof typeof UI_LOCALES;
export type ActiveUiLocale = UiLocale | 'pseudo';

export const ENABLED_UI_LOCALES = (Object.keys(UI_LOCALES) as UiLocale[])
  .filter(locale => UI_LOCALES[locale].enabled) as readonly UiLocale[];

export const documentLanguage = (locale: ActiveUiLocale) => locale === 'pseudo' ? 'en-XA' : locale;
export const documentDirection = (locale: ActiveUiLocale) => locale === 'pseudo' ? 'ltr' : UI_LOCALES[locale].dir;
