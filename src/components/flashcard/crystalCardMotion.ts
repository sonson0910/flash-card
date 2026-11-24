/**
 * Motion values for the Crystal Star card, copied from the AnimeReview design board.
 *
 * The board turns one rotor through rotateY(0 → 180deg) in 640 ms on cubic-bezier(.2, .8, .2, 1),
 * with the back face mounted behind the front. The app mounts one face at a time, so the same
 * curve is split where it crosses 90deg: the leaving face runs the first part of the curve and the
 * arriving face runs the rest. Both halves keep the board's timing and velocity, so the turn reads
 * as one continuous motion.
 */

export type EaseFunction = (progress: number) => number;

/** CSS cubic-bezier timing function, solved for y at a given x (progress). */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): EaseFunction {
  const sample = (a: number, b: number, t: number) => 3 * (1 - t) * (1 - t) * t * a + 3 * (1 - t) * t * t * b + t * t * t;
  const slope = (a: number, b: number, t: number) => 3 * (1 - t) * (1 - t) * a + 6 * (1 - t) * t * (b - a) + 3 * t * t * (1 - b);
  const solveT = (x: number) => {
    let t = x;
    for (let i = 0; i < 8; i += 1) {
      const error = sample(x1, x2, t) - x;
      if (Math.abs(error) < 1e-6) return t;
      const d = slope(x1, x2, t);
      if (Math.abs(d) < 1e-6) break;
      t -= error / d;
    }
    let lo = 0;
    let hi = 1;
    t = x;
    for (let i = 0; i < 40; i += 1) {
      const value = sample(x1, x2, t);
      if (Math.abs(value - x) < 1e-6) break;
      if (value < x) lo = t;
      else hi = t;
      t = (lo + hi) / 2;
    }
    return t;
  };
  return progress => {
    if (progress <= 0) return 0;
    if (progress >= 1) return 1;
    return sample(y1, y2, solveT(progress));
  };
}

/** Find the time (0..1) at which an ease reaches the given progress. */
function timeAtProgress(ease: EaseFunction, target: number) {
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 40; i += 1) {
    const mid = (lo + hi) / 2;
    if (ease(mid) < target) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

const flipEase = cubicBezier(0.2, 0.8, 0.2, 1);
const flipDurationSeconds = 0.64;
const halfTurnTime = timeAtProgress(flipEase, 0.5);

export const crystalFlipMotion = {
  /** Total duration of the board's rotor transition. */
  durationSeconds: flipDurationSeconds,
  /** The leaving face turns 0 → 90deg over the first part of the curve. */
  out: {
    durationSeconds: flipDurationSeconds * halfTurnTime,
    ease: ((progress: number) => flipEase(progress * halfTurnTime) / 0.5) as EaseFunction,
  },
  /** The arriving face turns -90 → 0deg over the rest of the curve. */
  in: {
    durationSeconds: flipDurationSeconds * (1 - halfTurnTime),
    ease: ((progress: number) => (flipEase(halfTurnTime + progress * (1 - halfTurnTime)) - 0.5) / 0.5) as EaseFunction,
  },
  /** Reduced motion replaces the turn with a short crossfade. */
  reducedCrossfadeSeconds: 0.12,
} as const;

/** Hover tilt: rotateX/rotateY up to 5deg toward the pointer over 280 ms. */
export const crystalTiltMotion = {
  maxDegrees: 5,
  durationSeconds: 0.28,
  ease: cubicBezier(0.22, 1, 0.36, 1),
} as const;
