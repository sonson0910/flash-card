import { readFileSync } from 'node:fs';

const catalogCache = new Map();

const loadCatalog = locale => {
  if (catalogCache.has(locale)) return catalogCache.get(locale);
  const url = new URL(`../_locales/${locale}/messages.json`, import.meta.url);
  const catalog = JSON.parse(readFileSync(url, 'utf8'));
  catalogCache.set(locale, catalog);
  return catalog;
};

// Mirrors the subset of the Chrome/Firefox i18n message format this
// extension uses: $1..$9 positional substitutions and named placeholders
// whose "content" resolves to a positional reference.
export const resolveMessage = (catalog, name, substitutions) => {
  const entry = catalog[name];
  if (!entry || typeof entry.message !== 'string') return '';
  const args = substitutions === undefined || substitutions === null
    ? []
    : Array.isArray(substitutions) ? substitutions : [substitutions];
  let message = entry.message;
  for (const [placeholderName, placeholder] of Object.entries(entry.placeholders ?? {})) {
    const content = String(placeholder?.content ?? '');
    const positional = content.match(/^\$(\d)$/);
    const resolved = positional ? String(args[Number(positional[1]) - 1] ?? '') : content;
    message = message.replaceAll(new RegExp(`\\$${placeholderName}\\$`, 'gi'), resolved);
  }
  return message;
};

export const loadMessages = locale => loadCatalog(locale);

// Returns a chrome.i18n-shaped mock backed by the real _locales catalog, so
// tests exercise the same message content shipped to users instead of a
// duplicated fixture.
export const createI18nMock = (locale = 'vi') => {
  const catalog = loadCatalog(locale);
  return {
    getMessage: (name, substitutions) => resolveMessage(catalog, name, substitutions),
    getUILanguage: () => locale,
  };
};

export const availableLocales = () => ['vi', 'en'];
