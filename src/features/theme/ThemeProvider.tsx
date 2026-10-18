import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { applyLumiEnabled, LUMI_ENABLED_STORAGE_KEY, readLumiEnabled } from '../settings/lumi-preference';
import {
  applyThemeToRoot,
  getSystemThemeMode,
  persistThemePreference,
  readThemePreference,
  THEME_FAMILY_STORAGE_KEY,
  THEME_FOLLOW_SYSTEM_STORAGE_KEY,
  type ThemeFamily,
  type ThemeMode,
  type ThemePreference,
} from './themePreference';

const useLumiPreferenceLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

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
  const requestedPreferenceRef = useRef(preference);
  const crystalReadyRef = useRef(false);

  const commit = useCallback((next: ThemePreference) => {
    applyThemeToRoot(next, root);
    setPreference(next);
  }, [root]);

  const loadCrystal = useCallback(() => {
    void import('./loadThemeAssets')
      .then(({ loadThemeAssets }) => loadThemeAssets('crystal'))
      .then(() => {
        crystalReadyRef.current = true;
        const next = requestedPreferenceRef.current;
        if (next.family === 'crystal') commit(next);
      })
      .catch(() => undefined);
  }, [commit]);

  const apply = useCallback((update: (current: ThemePreference) => ThemePreference, persist = true) => {
    const next = update(requestedPreferenceRef.current);
    requestedPreferenceRef.current = next;
    if (persist) persistThemePreference(next, storage);
    if (next.family === 'crystal' && !crystalReadyRef.current) loadCrystal();
    else commit(next);
  }, [commit, loadCrystal, storage]);

  useEffect(() => {
    if (preference.family === 'crystal' && !crystalReadyRef.current) loadCrystal();
    else applyThemeToRoot(preference, root);
  }, [loadCrystal, preference, root]);

  useLumiPreferenceLayoutEffect(() => {
    applyLumiEnabled(readLumiEnabled(storage), null, root);
  }, [root, storage]);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === LUMI_ENABLED_STORAGE_KEY) {
        applyLumiEnabled(readLumiEnabled(storage), null, root);
        return;
      }
      if (event.key === THEME_FAMILY_STORAGE_KEY || event.key === 'lingoflash_theme' || event.key === THEME_FOLLOW_SYSTEM_STORAGE_KEY) {
        const next = readThemePreference(storage, getSystemThemeMode());
        apply(() => next, false);
      }
    };
    globalThis.addEventListener?.('storage', onStorage);
    return () => {
      globalThis.removeEventListener?.('storage', onStorage);
    };
  }, [apply, root, storage]);

  useEffect(() => {
    const media = globalThis.matchMedia?.('(prefers-color-scheme: dark)');
    if (!media) return undefined;
    const onChange = () => {
      if (!requestedPreferenceRef.current.followSystem) return;
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
