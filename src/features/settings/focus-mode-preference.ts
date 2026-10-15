import { useEffect, useState } from 'react';

const STORAGE_KEY = 'sonflash_focus_mode_enabled';
const CHANGE_EVENT = 'sonflash_focus_mode_changed';
let fallbackEnabled = false;

export const readFocusModeEnabled = (): boolean => {
  try {
    const storage = globalThis.localStorage;
    return storage ? storage.getItem(STORAGE_KEY) === 'true' : fallbackEnabled;
  } catch { return fallbackEnabled; }
};

export const writeFocusModeEnabled = (enabled: boolean): void => {
  fallbackEnabled = enabled;
  try { globalThis.localStorage?.setItem(STORAGE_KEY, String(enabled)); } catch { /* Keep the setting in memory. */ }
  globalThis.dispatchEvent?.(new Event(CHANGE_EVENT));
};

export const useFocusModePreference = () => {
  const [enabled, setEnabled] = useState(readFocusModeEnabled);
  useEffect(() => {
    const refresh = () => setEnabled(readFocusModeEnabled());
    const onStorage = (event: StorageEvent) => { if (event.key === STORAGE_KEY || event.key === null) refresh(); };
    globalThis.addEventListener?.(CHANGE_EVENT, refresh);
    globalThis.addEventListener?.('storage', onStorage);
    return () => {
      globalThis.removeEventListener?.(CHANGE_EVENT, refresh);
      globalThis.removeEventListener?.('storage', onStorage);
    };
  }, []);
  return { focusModeEnabled: enabled, setFocusModeEnabled: (value: boolean) => { setEnabled(value); writeFocusModeEnabled(value); } };
};
