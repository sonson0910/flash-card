/**
 * The locale every formatter in `format.ts` uses. It lives in its own module so the app
 * entry can set it without loading the formatters, which only the lazy workspaces need.
 */
let activeLocale = 'en';

export const getFormatLocale = (): string => activeLocale;

export const setFormatLocale = (locale: string): void => {
  activeLocale = locale;
};
