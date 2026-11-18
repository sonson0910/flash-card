import { useCallback, useSyncExternalStore } from 'react';

export const USER_REDUCED_MOTION_KEY = 'sonflash_reduced_motion';
const CHANGE_EVENT = 'sonflash:reduced-motion-change';
const MOTION_QUERY = '(prefers-reduced-motion: reduce)';
let unavailableStoragePreference = false;

const readUserPreference = (): boolean => {
  try {
    return globalThis.localStorage?.getItem(USER_REDUCED_MOTION_KEY) === 'true';
  } catch {
    return unavailableStoragePreference;
  }
};

const applyDocumentPreference = () => {
  const root = globalThis.document?.documentElement;
  if (root) root.dataset.motion = readUserPreference() ? 'reduced' : 'system';
};

export const getEffectiveReducedMotion = (): boolean =>
  readUserPreference() || (globalThis.matchMedia?.(MOTION_QUERY).matches ?? false);

export const setUserReducedMotion = (enabled: boolean): void => {
  unavailableStoragePreference = enabled;
  try {
    globalThis.localStorage?.setItem(USER_REDUCED_MOTION_KEY, String(enabled));
  } catch {
    // Motion still updates for the current page when storage is unavailable.
  }
  applyDocumentPreference();
  globalThis.dispatchEvent?.(new Event(CHANGE_EVENT));
};

const subscribe = (listener: () => void) => {
  const onChange = () => {
    applyDocumentPreference();
    listener();
  };
  const media = globalThis.matchMedia?.(MOTION_QUERY);
  const onStorage = (event: StorageEvent) => {
    if (event.key === USER_REDUCED_MOTION_KEY) onChange();
  };
  globalThis.addEventListener?.(CHANGE_EVENT, onChange);
  globalThis.addEventListener?.('storage', onStorage);
  media?.addEventListener?.('change', onChange);
  return () => {
    globalThis.removeEventListener?.(CHANGE_EVENT, onChange);
    globalThis.removeEventListener?.('storage', onStorage);
    media?.removeEventListener?.('change', onChange);
  };
};

export function useUserReducedMotion(): [boolean, (enabled: boolean) => void] {
  const reducedMotion = useSyncExternalStore(subscribe, readUserPreference, () => false);
  const setReducedMotion = useCallback((enabled: boolean) => setUserReducedMotion(enabled), []);
  return [reducedMotion, setReducedMotion];
}

export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, getEffectiveReducedMotion, () => false);
}

applyDocumentPreference();
