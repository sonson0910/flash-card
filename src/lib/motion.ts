export const motionDurations = {
  fast: 0.14,
  standard: 0.2,
  emphasis: 0.26,
} as const;

export const motionEase: [number, number, number, number] = [0.16, 1, 0.3, 1];

export const motionSprings = {
  snappy: {
    type: 'spring',
    stiffness: 360,
    damping: 30,
    mass: 0.7,
  },
  gentle: {
    type: 'spring',
    stiffness: 260,
    damping: 26,
    mass: 0.8,
  },
} as const;

export const getStepVariants = (direction: 1 | -1 = 1) => ({
  enter: { opacity: 0, x: 24 * direction, scale: 0.985 },
  center: { opacity: 1, x: 0, scale: 1 },
  exit: { opacity: 0, x: -24 * direction, scale: 0.985 },
});

export const getReducedMotionScrollBehavior = (prefersReducedMotion = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false): ScrollBehavior =>
  prefersReducedMotion ? 'auto' : 'smooth';
