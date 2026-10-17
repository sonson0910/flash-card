export type ThemeFamily = 'classic' | 'crystal';
export type ThemeMode = 'dark' | 'light';

export interface ThemePreference {
  family: ThemeFamily;
  mode: ThemeMode;
  followSystem: boolean;
}

export const LEGACY_THEME_STORAGE_KEY = 'lingoflash_theme';
export const THEME_FAMILY_STORAGE_KEY = 'sonflash_theme_family';
export const THEME_FOLLOW_SYSTEM_STORAGE_KEY = 'sonflash_theme_follow_system';

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
export const parseFollowSystem = (value: string | null): boolean => value === 'true';

export const readThemePreference = (
  storage: ThemeStorageReader | null,
  systemMode?: ThemeMode,
): ThemePreference => {
  const followSystem = parseFollowSystem(storedValue(storage, THEME_FOLLOW_SYSTEM_STORAGE_KEY));
  const storedMode = parseThemeMode(storedValue(storage, LEGACY_THEME_STORAGE_KEY));
  return {
    family: parseThemeFamily(storedValue(storage, THEME_FAMILY_STORAGE_KEY)),
    mode: followSystem ? systemMode ?? storedMode ?? 'dark' : storedMode ?? systemMode ?? 'dark',
    followSystem,
  };
};

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
    storage?.setItem?.(THEME_FOLLOW_SYSTEM_STORAGE_KEY, String(preference.followSystem));
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
};

export const resolveInitialDarkMode = (storage: ThemeStorageReader | null): boolean => (
  readThemePreference(storage, getSystemThemeMode()).mode === 'dark'
);

export const applyLegacyThemePreference = (
  darkMode: boolean,
  storage: ThemeStorage | null,
  rootElement: ThemeRoot | null,
): void => {
  const preference = { ...readThemePreference(storage), mode: darkMode ? 'dark' : 'light', followSystem: false } satisfies ThemePreference;
  applyThemePreference(preference, storage, rootElement);
};
