export type ThemeFamily = 'classic' | 'crystal';
export type ThemeMode = 'dark' | 'light';

export interface ThemePreference {
  family: ThemeFamily;
  mode: ThemeMode;
}

export const LEGACY_THEME_STORAGE_KEY = 'lingoflash_theme';
export const THEME_FAMILY_STORAGE_KEY = 'sonflash_theme_family';
export const THEME_PREFERENCE_CHANGE_EVENT = 'sonflash-theme-preference-change';

type ThemeStorageReader = { getItem?(key: string): string | null };
type ThemeStorageWriter = { setItem?(key: string, value: string): void };
export type ThemeStorage = ThemeStorageReader & ThemeStorageWriter;
export type ThemeRoot = {
  classList: Pick<DOMTokenList, 'add' | 'remove'>;
  dataset?: { themeFamily?: string };
};

const storedValue = (storage: ThemeStorageReader | null, key: string): string | null => {
  try {
    return storage?.getItem?.(key) ?? null;
  } catch {
    return null;
  }
};

export const parseThemeFamily = (value: string | null): ThemeFamily => value === 'crystal' ? 'crystal' : 'classic';
export const parseThemeMode = (value: string | null): ThemeMode | null => (
  value === 'dark' || value === 'light' ? value : null
);

export const readThemePreference = (
  storage: ThemeStorageReader | null,
  systemMode?: ThemeMode,
): ThemePreference => ({
  family: parseThemeFamily(storedValue(storage, THEME_FAMILY_STORAGE_KEY)),
  mode: parseThemeMode(storedValue(storage, LEGACY_THEME_STORAGE_KEY)) ?? systemMode ?? 'dark',
});

export const getSystemThemeMode = (): ThemeMode | undefined => {
  try {
    const media = globalThis.matchMedia?.('(prefers-color-scheme: dark)');
    return media ? (media.matches ? 'dark' : 'light') : undefined;
  } catch {
    return undefined;
  }
};

export const applyThemeToRoot = (preference: ThemePreference, rootElement: ThemeRoot | null): void => {
  if (rootElement) (rootElement.dataset ??= {}).themeFamily = preference.family;
  if (preference.mode === 'dark') rootElement?.classList.add('dark');
  else rootElement?.classList.remove('dark');
};

export const persistThemePreference = (preference: ThemePreference, storage: ThemeStorageWriter | null): void => {
  try {
    storage?.setItem?.(THEME_FAMILY_STORAGE_KEY, preference.family);
    storage?.setItem?.(LEGACY_THEME_STORAGE_KEY, preference.mode);
  } catch {
    // The selection remains active in this tab when browser storage is unavailable.
  }
};

export const applyThemePreference = (
  preference: ThemePreference,
  storage: ThemeStorageWriter | null,
  rootElement: ThemeRoot | null,
): void => {
  persistThemePreference(preference, storage);
  applyThemeToRoot(preference, rootElement);
  globalThis.dispatchEvent?.(new CustomEvent(THEME_PREFERENCE_CHANGE_EVENT, { detail: preference }));
};

export const resolveInitialDarkMode = (storage: ThemeStorageReader | null): boolean => (
  readThemePreference(storage, getSystemThemeMode()).mode === 'dark'
);

export const applyLegacyThemePreference = (
  darkMode: boolean,
  storage: ThemeStorage | null,
  rootElement: ThemeRoot | null,
): void => {
  const preference = { ...readThemePreference(storage), mode: darkMode ? 'dark' : 'light' } satisfies ThemePreference;
  applyThemePreference(preference, storage, rootElement);
};
