import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  applyThemePreference,
  applyThemeToRoot,
  getSystemThemeMode,
  readThemePreference,
  THEME_FAMILY_STORAGE_KEY,
  THEME_PREFERENCE_CHANGE_EVENT,
  type ThemeFamily,
  type ThemeMode,
  type ThemePreference,
} from './themePreference';

type ThemeContextValue = ThemePreference & {
  setFamily: (family: ThemeFamily) => void;
  setMode: (mode: ThemeMode) => void;
};

const ThemeContext = createContext<ThemeContextValue>({
  family: 'classic', mode: 'dark', setFamily: () => undefined, setMode: () => undefined,
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
    const onThemeChange = (event: Event) => {
      const next = (event as CustomEvent<ThemePreference>).detail;
      if (next?.family && next?.mode) {
        preferenceRef.current = next;
        setPreference(next);
      }
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === THEME_FAMILY_STORAGE_KEY || event.key === 'lingoflash_theme') {
        const next = readThemePreference(storage, getSystemThemeMode());
        preferenceRef.current = next;
        setPreference(next);
        applyThemeToRoot(next, root);
      }
    };
    globalThis.addEventListener?.(THEME_PREFERENCE_CHANGE_EVENT, onThemeChange);
    globalThis.addEventListener?.('storage', onStorage);
    return () => {
      globalThis.removeEventListener?.(THEME_PREFERENCE_CHANGE_EVENT, onThemeChange);
      globalThis.removeEventListener?.('storage', onStorage);
    };
  }, [root, storage]);

  const setFamily = useCallback((family: ThemeFamily) => apply(current => ({ ...current, family })), [apply]);
  const setMode = useCallback((mode: ThemeMode) => apply(current => ({ ...current, mode })), [apply]);

  return <ThemeContext.Provider value={{ ...preference, setFamily, setMode }}>{children}</ThemeContext.Provider>;
}

export const useTheme = (): ThemeContextValue => useContext(ThemeContext);
