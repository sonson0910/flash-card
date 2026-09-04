import { useEffect, useState } from 'react';

const STORAGE_KEY = 'sonflash_zen_glass_mode';
const CHANGE_EVENT = 'sonflash-zen-mode-change';

export function getZenGlassMode(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

export function setZenGlassMode(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, enabled ? 'true' : 'false');
  } catch {
    // Ignore storage quota or security errors
  }
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: { enabled } }));
}

export function useZenGlassMode(): [boolean, (value: boolean | ((prev: boolean) => boolean)) => void] {
  const [isZenMode, setIsZenModeState] = useState<boolean>(() => getZenGlassMode());

  useEffect(() => {
    const handleCustomEvent = (event: Event) => {
      const customEvent = event as CustomEvent<{ enabled: boolean }>;
      if (customEvent.detail && typeof customEvent.detail.enabled === 'boolean') {
        setIsZenModeState(customEvent.detail.enabled);
      }
    };

    const handleStorageEvent = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY) {
        setIsZenModeState(event.newValue === 'true');
      }
    };

    window.addEventListener(CHANGE_EVENT, handleCustomEvent);
    window.addEventListener('storage', handleStorageEvent);

    return () => {
      window.removeEventListener(CHANGE_EVENT, handleCustomEvent);
      window.removeEventListener('storage', handleStorageEvent);
    };
  }, []);

  const setZenMode = (value: boolean | ((prev: boolean) => boolean)) => {
    const nextValue = typeof value === 'function' ? value(isZenMode) : value;
    setIsZenModeState(nextValue);
    setZenGlassMode(nextValue);
  };

  return [isZenMode, setZenMode];
}
