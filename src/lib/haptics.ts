// Web Haptics API for touch devices

export type HapticStyle = 'light' | 'medium' | 'heavy' | 'success' | 'warning';

const HAPTIC_PATTERNS: Record<HapticStyle, number | number[]> = {
  light: 12,
  medium: 25,
  heavy: 45,
  success: [15, 30, 20],
  warning: [30, 40, 30],
};

/**
 * Trigger subtle tactile vibration on supported mobile devices.
 * Safely fails silently if the device or browser does not support vibration.
 */
export function triggerHaptic(style: HapticStyle = 'light'): void {
  try {
    if (typeof window === 'undefined' || typeof navigator === 'undefined') return;
    if (typeof navigator.vibrate === 'function') {
      navigator.vibrate(HAPTIC_PATTERNS[style]);
    }
  } catch {
    // Haptics must never interrupt application execution
  }
}
