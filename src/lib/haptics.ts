// Web Haptics API for touch devices
import { useEffect, useState } from 'react';
import { getEffectiveReducedMotion } from './motionPreference';

export type HapticStyle = 'light' | 'medium' | 'heavy' | 'success' | 'warning';

const HAPTIC_PATTERNS: Record<HapticStyle, number | number[]> = {
  light: 12,
  medium: 25,
  heavy: 45,
  success: [15, 30, 20],
  warning: [30, 40, 30],
};

export const HAPTICS_STORAGE_KEY = 'sonflash_haptics_enabled';
const HAPTICS_CHANGE_EVENT = 'sonflash_haptics_changed';

/**
 * Reads the haptics preference from Web Storage, persisted the same way
 * sound feedback is (`isSoundEnabled` in `./interactionSounds.ts`): denied
 * or partitioned storage must not break the app shell, so any read failure
 * falls back to enabled.
 */
export const isHapticsEnabled = (): boolean => {
  if (typeof window === 'undefined') return true;
  try {
    const stored = window.localStorage.getItem(HAPTICS_STORAGE_KEY);
    return stored === null ? true : stored === 'true';
  } catch {
    return true;
  }
};

export const setHapticsEnabled = (enabled: boolean): void => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(HAPTICS_STORAGE_KEY, String(enabled));
  } catch {
    // Keep the in-memory React state usable when storage is denied or full.
  }
  window.dispatchEvent(new Event(HAPTICS_CHANGE_EVENT));
};

/**
 * Trigger subtle tactile vibration on supported mobile devices.
 * Safely fails silently: when the device or browser does not support
 * vibration, when the user turned haptics off in Settings, when the tab is
 * hidden (a backgrounded page must never buzz a device in someone's
 * pocket), or when reduced motion is in effect. Vibration is a physical
 * motion effect, so it defers to `getEffectiveReducedMotion`
 * (`./motionPreference.ts`), the helper that already combines the user's
 * saved choice with the OS `prefers-reduced-motion` media query, instead of
 * re-implementing that check here.
 */
export function triggerHaptic(style: HapticStyle = 'light'): void {
  try {
    if (typeof window === 'undefined' || typeof navigator === 'undefined') return;
    if (typeof navigator.vibrate !== 'function') return;
    if (!isHapticsEnabled()) return;
    if (getEffectiveReducedMotion()) return;
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    navigator.vibrate(HAPTIC_PATTERNS[style]);
  } catch {
    // Haptics must never interrupt application execution
  }
}

/**
 * React hook to observe and toggle the haptics preference, mirroring
 * `useSoundSettings` in `./interactionSounds.ts`.
 */
export const useHapticsSettings = () => {
  const [enabled, setEnabled] = useState(isHapticsEnabled);

  useEffect(() => {
    const handleUpdate = () => setEnabled(isHapticsEnabled());
    window.addEventListener(HAPTICS_CHANGE_EVENT, handleUpdate);
    window.addEventListener('storage', handleUpdate);
    return () => {
      window.removeEventListener(HAPTICS_CHANGE_EVENT, handleUpdate);
      window.removeEventListener('storage', handleUpdate);
    };
  }, []);

  return {
    isHapticsEnabled: enabled,
    setHapticsEnabled,
  };
};
