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

export const getFlashcardFlipMotion = (direction: 1 | -1, prefersReducedMotion: boolean) => ({
  from: {
    autoAlpha: prefersReducedMotion ? 1 : 0.62,
    rotationY: prefersReducedMotion ? 0 : direction * 92,
    scale: prefersReducedMotion ? 1 : 0.985,
  },
  to: {
    autoAlpha: 1,
    rotationY: 0,
    scale: 1,
    duration: prefersReducedMotion ? 0 : motionDurations.emphasis,
    ease: prefersReducedMotion ? 'none' : 'expo.out',
  },
});

interface SpotlightBounds {
  left: number;
  top: number;
  width: number;
  height: number;
}

export const getSpotlightPosition = (
  clientX: number,
  clientY: number,
  bounds: SpotlightBounds,
) => {
  if (bounds.width <= 0 || bounds.height <= 0) return { x: 50, y: 50 };
  const clamp = (value: number) => Math.min(100, Math.max(0, value));
  return {
    x: clamp(((clientX - bounds.left) / bounds.width) * 100),
    y: clamp(((clientY - bounds.top) / bounds.height) * 100),
  };
};

export type GsapEntranceVariant = 'view' | 'fade' | 'step' | 'feedback' | 'result';

export const getGsapEntranceMotion = (
  variant: GsapEntranceVariant,
  direction: 1 | -1,
  prefersReducedMotion: boolean,
) => {
  if (prefersReducedMotion) {
    return {
      from: { autoAlpha: 1, x: 0, y: 0, scale: 1 },
      to: { autoAlpha: 1, x: 0, y: 0, scale: 1, duration: 0, ease: 'none' },
    };
  }

  const variants = {
    view: { x: 0, y: 12, scale: 0.985, duration: motionDurations.emphasis },
    fade: { x: 0, y: 0, scale: 1, duration: motionDurations.standard },
    step: { x: 24 * direction, y: 0, scale: 0.985, duration: motionDurations.emphasis },
    feedback: { x: 0, y: 8, scale: 1, duration: motionDurations.standard },
    result: { x: 0, y: 14, scale: 0.97, duration: 0.34 },
  } as const;
  const selected = variants[variant];
  return {
    from: { autoAlpha: 0, x: selected.x, y: selected.y, scale: selected.scale },
    to: {
      autoAlpha: 1,
      x: 0,
      y: 0,
      scale: 1,
      duration: selected.duration,
      ease: 'expo.out',
    },
  };
};
