import { describe, expect, it } from 'vitest';
import { evaluateRateLimit, RATE_LIMIT_WINDOW_MS } from '../src/rateLimiter.js';

describe('evaluateRateLimit', () => {
  it('starts a new fixed window with the first consumed call', () => {
    const result = evaluateRateLimit(null, 1_000, 30);

    expect(result).toEqual({
      allowed: true,
      state: { windowStartedAt: 1_000, calls: 1 },
      retryAfterMs: 0,
    });
  });

  it('increments a call within the active window', () => {
    const result = evaluateRateLimit({ windowStartedAt: 1_000, calls: 12 }, 2_000, 30);

    expect(result).toEqual({
      allowed: true,
      state: { windowStartedAt: 1_000, calls: 13 },
      retryAfterMs: 0,
    });
  });

  it('rejects calls at the maximum without mutating the stored state', () => {
    const state = { windowStartedAt: 1_000, calls: 30 };
    const result = evaluateRateLimit(state, 2_000, 30);

    expect(result).toEqual({
      allowed: false,
      state,
      retryAfterMs: RATE_LIMIT_WINDOW_MS - 1_000,
    });
  });

  it('resets exactly at the next window boundary', () => {
    const result = evaluateRateLimit(
      { windowStartedAt: 1_000, calls: 30 },
      1_000 + RATE_LIMIT_WINDOW_MS,
      30,
    );

    expect(result).toEqual({
      allowed: true,
      state: { windowStartedAt: 1_000 + RATE_LIMIT_WINDOW_MS, calls: 1 },
      retryAfterMs: 0,
    });
  });

  it('fails closed for an invalid maximum', () => {
    expect(() => evaluateRateLimit(null, 1_000, 0)).toThrow('maximum must be a positive integer');
  });
});
