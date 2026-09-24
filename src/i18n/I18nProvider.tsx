import { i18n } from '@lingui/core';
import { I18nProvider as LinguiProvider } from '@lingui/react';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { setFormatLocale } from '../lib/format';
import { activateCatalogLocale, loadCatalog, loadVisitedCatalogs, setActiveUiLocale } from './loadCatalog';
import {
  documentDirection, documentLanguage, ENABLED_UI_LOCALES, UI_LOCALE_STORAGE_KEY,
  type ActiveUiLocale, type UiLocale,
} from './locales';
import { resolveLocale } from './resolveLocale';

type LocaleContextValue = {
  locale: ActiveUiLocale;
  setUiLocale: (locale: UiLocale) => Promise<void>;
};

const LocaleContext = createContext<LocaleContextValue>({ locale: 'en', setUiLocale: async () => undefined });

const readStoredLocale = (): string | null => {
  try { return globalThis.localStorage?.getItem(UI_LOCALE_STORAGE_KEY) ?? null; }
  catch { return null; }
};

const allowQueryOverride = (): boolean => import.meta.env.MODE !== 'production'
  || (typeof location !== 'undefined'
    && (['localhost', '127.0.0.1'].includes(location.hostname) || location.hostname.includes('--')));

const initialLocale = (profileLocale?: string | null): ActiveUiLocale => {
  const locale = resolveLocale({
    search: typeof location === 'undefined' ? '' : location.search,
    storedLocale: readStoredLocale(),
    profileLocale,
    navigatorLanguages: typeof navigator === 'undefined' ? [] : navigator.languages,
    allowQueryOverride: allowQueryOverride(),
  });
  setFormatLocale(locale === 'pseudo' ? 'en' : locale);
  setActiveUiLocale(locale);
  return locale;
};

export function I18nProvider({ children, profileLocale }: { children: ReactNode; profileLocale?: string | null }) {
  const [locale, setLocale] = useState<ActiveUiLocale>(() => initialLocale(profileLocale));
  const [catalogError, setCatalogError] = useState<Error | null>(null);
  const changeNumber = useRef(0);
  const hasLocalChoice = useRef(false);

  const applyLocale = useCallback(async (next: ActiveUiLocale, persist: boolean) => {
    const change = ++changeNumber.current;
    try {
      await loadVisitedCatalogs(next);
      if (change !== changeNumber.current) return;
      setActiveUiLocale(next);
      activateCatalogLocale(next);
      setFormatLocale(next === 'pseudo' ? 'en' : next);
      setLocale(next);
      if (persist && next !== 'pseudo') {
        try { globalThis.localStorage?.setItem(UI_LOCALE_STORAGE_KEY, next); }
        catch { /* The selection still applies in this tab when storage is unavailable. */ }
      }
    } catch (error) {
      setCatalogError(error instanceof Error ? error : new Error(String(error)));
    }
  }, []);

  const setUiLocale = useCallback(async (next: UiLocale) => {
    if (ENABLED_UI_LOCALES.includes(next)) {
      hasLocalChoice.current = true;
      await applyLocale(next, true);
    }
  }, [applyLocale]);

  useEffect(() => {
    void Promise.all([loadCatalog(locale, 'shell'), loadCatalog(locale, 'landing')])
      .catch(error => setCatalogError(error instanceof Error ? error : new Error(String(error))));
  }, [locale]);

  useEffect(() => {
    document.documentElement.lang = documentLanguage(locale);
    document.documentElement.dir = documentDirection(locale);
  }, [locale]);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== UI_LOCALE_STORAGE_KEY) return;
      const next = resolveLocale({
        search: location.search,
        allowQueryOverride: allowQueryOverride(),
        storedLocale: event.newValue,
        profileLocale,
        navigatorLanguages: navigator.languages,
      });
      void applyLocale(next, false);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [applyLocale, profileLocale]);

  useEffect(() => {
    if (!profileLocale || readStoredLocale() || hasLocalChoice.current) return;
    const next = resolveLocale({
      search: location.search,
      allowQueryOverride: allowQueryOverride(),
      profileLocale,
      navigatorLanguages: navigator.languages,
    });
    if (next !== locale) void applyLocale(next, false);
  }, [applyLocale, locale, profileLocale]);

  if (catalogError) throw catalogError;
  return <LocaleContext.Provider value={{ locale, setUiLocale }}>
    <LinguiProvider i18n={i18n}>{children}</LinguiProvider>
  </LocaleContext.Provider>;
}

export const useUiLocale = (): ActiveUiLocale => useContext(LocaleContext).locale;
export const useSetUiLocale = (): LocaleContextValue['setUiLocale'] => useContext(LocaleContext).setUiLocale;
