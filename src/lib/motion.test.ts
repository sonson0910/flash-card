import { describe, expect, it } from 'vitest';
import {
  getReducedMotionScrollBehavior,
  getStepVariants,
  motionDurations,
  motionEase,
  motionSprings,
} from './motion';

describe('shared motion language', () => {
  it('keeps a compact duration scale and one expressive easing curve', () => {
    expect(motionDurations).toEqual({ fast: 0.14, standard: 0.2, emphasis: 0.26 });
    expect(motionEase).toEqual([0.16, 1, 0.3, 1]);
  });

  it('provides restrained springs for controls and layout', () => {
    expect(motionSprings.snappy).toMatchObject({ type: 'spring', stiffness: 360, damping: 30, mass: 0.7 });
    expect(motionSprings.gentle).toMatchObject({ type: 'spring', stiffness: 260, damping: 26, mass: 0.8 });
  });

  it('moves practice steps no more than 24 pixels in the requested direction', () => {
    expect(getStepVariants(1)).toEqual({
      enter: { opacity: 0, x: 24, scale: 0.985 },
      center: { opacity: 1, x: 0, scale: 1 },
      exit: { opacity: 0, x: -24, scale: 0.985 },
    });
    expect(getStepVariants(-1).enter.x).toBe(-24);
    expect(getStepVariants(-1).exit.x).toBe(24);
  });

  it('avoids smooth scrolling when reduced motion is requested', () => {
    expect(getReducedMotionScrollBehavior(true)).toBe('auto');
    expect(getReducedMotionScrollBehavior(false)).toBe('smooth');
  });
});
