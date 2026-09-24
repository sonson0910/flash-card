import { i18n, type Messages } from '@lingui/core';
import type { ActiveUiLocale } from './locales';
import { expandPseudoCatalog } from './pseudo';

const catalogs = import.meta.glob<{ messages: Messages }>('./locales/*/*.po');
const loaded = new Map<string, Promise<void>>();
const visitedAreas = new Set<string>();
let activeUiLocale: ActiveUiLocale = 'en';

export const getActiveUiLocale = () => activeUiLocale;
export const setActiveUiLocale = (locale: ActiveUiLocale) => { activeUiLocale = locale; };
export const linguiLocale = (locale: ActiveUiLocale) => locale === 'pseudo' ? 'en-XA' : locale;

export const loadCatalog = (locale: ActiveUiLocale, area: string): Promise<void> => {
  const code = linguiLocale(locale);
  const key = `${code}/${area}`;
  const existing = loaded.get(key);
  if (existing) return existing;
  const importer = catalogs[`./locales/${code}/${area}.po`];
  if (!importer) return Promise.reject(new Error(`Missing UI catalog: ${key}`));
  visitedAreas.add(area);
  const promise = importer().then(({ messages }) => {
    i18n.load(code, locale === 'pseudo' ? expandPseudoCatalog(messages) : messages);
    if (activeUiLocale === locale) i18n.activate(code);
  });
  loaded.set(key, promise);
  promise.catch(() => loaded.delete(key));
  return promise;
};

export const loadVisitedCatalogs = async (locale: ActiveUiLocale): Promise<void> => {
  await Promise.all([...visitedAreas].map(area => loadCatalog(locale, area)));
};

export const activateCatalogLocale = (locale: ActiveUiLocale) => i18n.activate(linguiLocale(locale));
