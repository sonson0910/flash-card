import { describe, expect, it } from 'vitest';
import { crystalFlipMotion, cubicBezier } from './crystalCardMotion';
import { cardTierOf } from './cardLook';

describe('cubicBezier', () => {
  it('matches the CSS endpoints and the linear curve', () => {
    const linear = cubicBezier(0, 0, 1, 1);
    expect(linear(0)).toBe(0);
    expect(linear(1)).toBe(1);
    expect(linear(0.3)).toBeCloseTo(0.3, 4);
  });

  it('solves the board flip curve the way the browser does at its midpoint', () => {
    // cubic-bezier(.2, .8, .2, 1) is front-loaded: well past half the turn at half the time.
    const ease = cubicBezier(0.2, 0.8, 0.2, 1);
    expect(ease(0.5)).toBeGreaterThan(0.85);
    expect(ease(0.5)).toBeLessThan(0.95);
  });
});

describe('crystalFlipMotion', () => {
  it('splits the 640 ms turn into two halves that add up to the board duration', () => {
    expect(crystalFlipMotion.out.durationSeconds + crystalFlipMotion.in.durationSeconds).toBeCloseTo(0.64, 6);
  });

  it('meets at 90 degrees so the two faces read as one continuous turn', () => {
    expect(crystalFlipMotion.out.ease(0)).toBeCloseTo(0, 6);
    expect(crystalFlipMotion.out.ease(1)).toBeCloseTo(1, 3);
    expect(crystalFlipMotion.in.ease(0)).toBeCloseTo(0, 3);
    expect(crystalFlipMotion.in.ease(1)).toBeCloseTo(1, 6);
  });
});

describe('cardTierOf', () => {
  it('reads the learning stage the rim and glow show', () => {
    expect(cardTierOf({ difficulty: 'easy' })).toBe('mastered');
    expect(cardTierOf({ reviews: 2 })).toBe('learning');
    expect(cardTierOf({ nextReviewDate: '2026-11-25T00:00:00.000Z' })).toBe('learning');
    expect(cardTierOf({ difficulty: 'unrated' })).toBe('new');
    expect(cardTierOf({})).toBe('new');
  });
});
