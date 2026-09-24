import { ENABLED_UI_LOCALES, type ActiveUiLocale, type UiLocale } from './locales';

export type LocaleResolutionInput = {
  search?: string;
  storedLocale?: string | null;
  profileLocale?: string | null;
  navigatorLanguages?: readonly string[];
  allowQueryOverride?: boolean;
  enabledLocales?: readonly UiLocale[];
};

const matchLocale = (value: string | null | undefined, enabled: readonly UiLocale[]): UiLocale | null => {
  if (!value) return null;
  const normalized = value.trim().replaceAll('_', '-').toLowerCase();
  if (!normalized) return null;
  const exact = enabled.find(locale => locale.toLowerCase() === normalized);
  if (exact) return exact;
  const language = normalized.split('-')[0];
  // A regional Portuguese catalog must not silently stand in for another region.
  if (language === 'pt') return null;
  return enabled.find(locale => locale.toLowerCase() === language) ?? null;
};

export const resolveLocale = ({
  search = '', storedLocale, profileLocale, navigatorLanguages = [],
  allowQueryOverride = false, enabledLocales = ENABLED_UI_LOCALES,
}: LocaleResolutionInput = {}): ActiveUiLocale => {
  if (allowQueryOverride) {
    const requested = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search).get('locale');
    if (requested?.toLowerCase() === 'pseudo') return 'pseudo';
    const queryLocale = matchLocale(requested, enabledLocales);
    if (queryLocale) return queryLocale;
  }
  const stored = matchLocale(storedLocale, enabledLocales);
  if (stored) return stored;
  const profile = matchLocale(profileLocale, enabledLocales);
  if (profile) return profile;
  for (const language of navigatorLanguages) {
    const browser = matchLocale(language, enabledLocales);
    if (browser) return browser;
  }
  return 'en';
};
