export const USER_REDUCED_MOTION_KEY = 'sonflash_reduced_motion';
export const REDUCED_MOTION_CHANGE_EVENT = 'sonflash:reduced-motion-change';
export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';
let unavailableStoragePreference = false;

export const readUserReducedMotion = (): boolean => {
  try {
    return globalThis.localStorage?.getItem(USER_REDUCED_MOTION_KEY) === 'true';
  } catch {
    return unavailableStoragePreference;
  }
};

export const applyReducedMotionToDocument = () => {
  const root = globalThis.document?.documentElement;
  if (root) root.dataset.motion = readUserReducedMotion() ? 'reduced' : 'system';
};

export const getEffectiveReducedMotion = (): boolean =>
  readUserReducedMotion() || (globalThis.matchMedia?.(REDUCED_MOTION_QUERY).matches ?? false);

export const setUserReducedMotion = (enabled: boolean): void => {
  unavailableStoragePreference = enabled;
  try {
    globalThis.localStorage?.setItem(USER_REDUCED_MOTION_KEY, String(enabled));
  } catch {
    // Motion still updates for the current page when storage is unavailable.
  }
  applyReducedMotionToDocument();
  globalThis.dispatchEvent?.(new Event(REDUCED_MOTION_CHANGE_EVENT));
};

applyReducedMotionToDocument();
