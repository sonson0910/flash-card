import { i18n, type Messages } from '@lingui/core';
import type { ActiveUiLocale } from './locales';

const catalogs: Record<string, () => Promise<{ messages: Messages }>> = {
  'en/landing': () => import('./locales/en/landing.po'),
  'en/shell': () => import('./locales/en/shell.po'),
  'vi/landing': () => import('./locales/vi/landing.po'),
  'vi/shell': () => import('./locales/vi/shell.po'),
};
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
  const catalogKey = locale === 'pseudo' ? `en/${area}` : key;
  const importer = catalogs[catalogKey] ?? (() => import('./workspace-catalogs')
    .then(({ loadWorkspaceCatalog }) => loadWorkspaceCatalog(catalogKey, key)));
  visitedAreas.add(area);
  const promise = importer().then(async ({ messages }) => {
    const catalog = locale === 'pseudo'
      ? (await import('./pseudo')).expandPseudoCatalog(messages)
      : messages;
    i18n.load(code, catalog);
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
