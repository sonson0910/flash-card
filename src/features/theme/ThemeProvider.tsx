import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  applyThemePreference,
  applyThemeToRoot,
  getSystemThemeMode,
  readThemePreference,
  THEME_FAMILY_STORAGE_KEY,
  THEME_FOLLOW_SYSTEM_STORAGE_KEY,
  type ThemeFamily,
  type ThemeMode,
  type ThemePreference,
} from './themePreference';

type ThemeContextValue = ThemePreference & {
  setFamily: (family: ThemeFamily) => void;
  setMode: (mode: ThemeMode) => void;
  setFollowSystem: (followSystem: boolean) => void;
};

const ThemeContext = createContext<ThemeContextValue>({
  family: 'classic', mode: 'dark', followSystem: false, setFamily: () => undefined, setMode: () => undefined, setFollowSystem: () => undefined,
});

const browserStorage = () => {
  try { return globalThis.localStorage; }
  catch { return null; }
};

const browserRoot = () => globalThis.document?.documentElement ?? null;

export function ThemeProvider({ children }: { children: ReactNode }) {
  const storage = browserStorage();
  const root = browserRoot();
  const [preference, setPreference] = useState(() => readThemePreference(storage, getSystemThemeMode()));
  const preferenceRef = useRef(preference);
  preferenceRef.current = preference;

  const apply = useCallback((update: (current: ThemePreference) => ThemePreference) => {
    const next = update(preferenceRef.current);
    preferenceRef.current = next;
    setPreference(next);
    applyThemePreference(next, storage, root);
  }, [root, storage]);

  useEffect(() => {
    applyThemeToRoot(preference, root);
  }, [preference, root]);

  useEffect(() => {
    if (preference.family !== 'crystal') return;
    void import('./loadThemeAssets').then(({ loadThemeAssets }) => loadThemeAssets('crystal'));
  }, [preference.family]);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === THEME_FAMILY_STORAGE_KEY || event.key === 'lingoflash_theme' || event.key === THEME_FOLLOW_SYSTEM_STORAGE_KEY) {
        const next = readThemePreference(storage, getSystemThemeMode());
        preferenceRef.current = next;
        setPreference(next);
        applyThemeToRoot(next, root);
      }
    };
    globalThis.addEventListener?.('storage', onStorage);
    return () => {
      globalThis.removeEventListener?.('storage', onStorage);
    };
  }, [root, storage]);

  useEffect(() => {
    const media = globalThis.matchMedia?.('(prefers-color-scheme: dark)');
    if (!media) return undefined;
    const onChange = () => {
      if (!preferenceRef.current.followSystem) return;
      apply(current => ({ ...current, mode: media.matches ? 'dark' : 'light' }));
    };
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [apply]);

  const setFamily = useCallback((family: ThemeFamily) => apply(current => ({ ...current, family })), [apply]);
  const setMode = useCallback((mode: ThemeMode) => apply(current => ({ ...current, mode, followSystem: false })), [apply]);
  const setFollowSystem = useCallback((followSystem: boolean) => apply(current => ({
    ...current,
    followSystem,
    mode: followSystem ? getSystemThemeMode() ?? current.mode : current.mode,
  })), [apply]);

  return <ThemeContext.Provider value={{ ...preference, setFamily, setMode, setFollowSystem }}>{children}</ThemeContext.Provider>;
}

export const useTheme = (): ThemeContextValue => useContext(ThemeContext);
