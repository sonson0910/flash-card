import { getEffectiveReducedMotion } from './motionPreference';

/**
 * The timings the app entry needs for view changes. They live apart from `motion.ts` so the
 * entry does not load the animation presets, which only the lazy workspaces use.
 */
export const motionDurations = {
  fast: 0.14,
  standard: 0.2,
  emphasis: 0.26,
} as const;

export const getReducedMotionScrollBehavior = (prefersReducedMotion = getEffectiveReducedMotion()): ScrollBehavior =>
  prefersReducedMotion ? 'auto' : 'smooth';
