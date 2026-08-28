import { describe, expect, it } from 'vitest';
import {
  getFlashcardFlipMotion,
  getGsapEntranceMotion,
  getReducedMotionScrollBehavior,
  getSpotlightPosition,
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

  it('keeps the flashcard flip directional and settles on a crisp face', () => {
    expect(getFlashcardFlipMotion(1, false)).toEqual({
      from: { autoAlpha: 0.62, rotationY: 92, scale: 0.985 },
      to: { autoAlpha: 1, rotationY: 0, scale: 1, duration: 0.26, ease: 'expo.out' },
    });
    expect(getFlashcardFlipMotion(-1, false).from.rotationY).toBe(-92);
  });

  it('removes the 3D hand-off when reduced motion is requested', () => {
    expect(getFlashcardFlipMotion(1, true)).toEqual({
      from: { autoAlpha: 1, rotationY: 0, scale: 1 },
      to: { autoAlpha: 1, rotationY: 0, scale: 1, duration: 0, ease: 'none' },
    });
  });

  it('calculates and clamps spotlight coordinates without repeated layout work', () => {
    const bounds = { left: 100, top: 50, width: 200, height: 100 };
    expect(getSpotlightPosition(200, 75, bounds)).toEqual({ x: 50, y: 25 });
    expect(getSpotlightPosition(20, 300, bounds)).toEqual({ x: 0, y: 100 });
    expect(getSpotlightPosition(200, 75, { ...bounds, width: 0 })).toEqual({ x: 50, y: 50 });
  });

  it('provides distinct GSAP choreography for views, async fades, steps, feedback, and results', () => {
    expect(getGsapEntranceMotion('view', 1, false).from).toMatchObject({ autoAlpha: 0, y: 12, scale: 0.985 });
    expect(getGsapEntranceMotion('fade', 1, false)).toMatchObject({
      from: { autoAlpha: 0, x: 0, y: 0, scale: 1 },
      to: { autoAlpha: 1, duration: 0.2, ease: 'expo.out' },
    });
    expect(getGsapEntranceMotion('step', -1, false).from).toMatchObject({ autoAlpha: 0, x: -24, scale: 0.985 });
    expect(getGsapEntranceMotion('feedback', 1, false).to).toMatchObject({ duration: 0.2, ease: 'expo.out' });
    expect(getGsapEntranceMotion('result', 1, false).to).toMatchObject({ duration: 0.34, ease: 'expo.out' });
  });

  it('collapses shared GSAP entrances for reduced-motion users', () => {
    expect(getGsapEntranceMotion('step', -1, true)).toEqual({
      from: { autoAlpha: 1, x: 0, y: 0, scale: 1 },
      to: { autoAlpha: 1, x: 0, y: 0, scale: 1, duration: 0, ease: 'none' },
    });
  });
});
