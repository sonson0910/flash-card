import { useCallback, useSyncExternalStore } from 'react';
import {
  applyReducedMotionToDocument,
  getEffectiveReducedMotion,
  readUserReducedMotion,
  REDUCED_MOTION_CHANGE_EVENT,
  REDUCED_MOTION_QUERY,
  setUserReducedMotion,
  USER_REDUCED_MOTION_KEY,
} from './motionPreference';

// The hooks live apart from the preference itself so the app entry, which only reads the
// preference, does not load them.
const subscribe = (listener: () => void) => {
  const onChange = () => {
    applyReducedMotionToDocument();
    listener();
  };
  const media = globalThis.matchMedia?.(REDUCED_MOTION_QUERY);
  const onStorage = (event: StorageEvent) => {
    if (event.key === USER_REDUCED_MOTION_KEY) onChange();
  };
  globalThis.addEventListener?.(REDUCED_MOTION_CHANGE_EVENT, onChange);
  globalThis.addEventListener?.('storage', onStorage);
  media?.addEventListener?.('change', onChange);
  return () => {
    globalThis.removeEventListener?.(REDUCED_MOTION_CHANGE_EVENT, onChange);
    globalThis.removeEventListener?.('storage', onStorage);
    media?.removeEventListener?.('change', onChange);
  };
};

export function useUserReducedMotion(): [boolean, (enabled: boolean) => void] {
  const reducedMotion = useSyncExternalStore(subscribe, readUserReducedMotion, () => false);
  const setReducedMotion = useCallback((enabled: boolean) => setUserReducedMotion(enabled), []);
  return [reducedMotion, setReducedMotion];
}

export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, getEffectiveReducedMotion, () => false);
}
