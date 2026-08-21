import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  consumeRateLimitWithMemoryFallback,
  createMemoryRateLimitStore,
  evaluateRateLimit,
  isFirestoreQuotaError,
  RATE_LIMIT_STORAGE_DEADLINE_MS,
  RateLimitExceededError,
  RATE_LIMIT_WINDOW_MS,
} from '../src/rateLimiter.js';

afterEach(() => {
  vi.useRealTimers();
});

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

describe('memory rate-limit fallback', () => {
  it('bounds a stalled Firestore limiter before using the memory fallback', async () => {
    vi.useFakeTimers();
    const consumeMemory = vi.fn();
    const result = consumeRateLimitWithMemoryFallback(
      () => new Promise<void>(() => undefined),
      consumeMemory,
    );
    const settlement = expect(result).resolves.toBe('memory');

    await vi.advanceTimersByTimeAsync(RATE_LIMIT_STORAGE_DEADLINE_MS);

    await settlement;
    expect(consumeMemory).toHaveBeenCalledOnce();
  });

  it('does not bypass an application rate-limit rejection', async () => {
    const consumeMemory = vi.fn();

    await expect(consumeRateLimitWithMemoryFallback(
      () => Promise.reject(new RateLimitExceededError(1_000)),
      consumeMemory,
    )).rejects.toBeInstanceOf(RateLimitExceededError);
    expect(consumeMemory).not.toHaveBeenCalled();
  });

  it('enforces the same fixed-window maximum when Firestore quota is unavailable', () => {
    const store = createMemoryRateLimitStore();

    store.consume('user-a', 'ai', 2, 1_000);
    store.consume('user-a', 'ai', 2, 2_000);

    expect(() => store.consume('user-a', 'ai', 2, 3_000)).toThrow(RateLimitExceededError);
  });

  it('isolates users and scopes while resetting at the next window', () => {
    const store = createMemoryRateLimitStore();

    store.consume('user-a', 'ai', 1, 1_000);
    expect(() => store.consume('user-a', 'ai', 1, 2_000)).toThrow(RateLimitExceededError);
    expect(() => store.consume('user-b', 'ai', 1, 2_000)).not.toThrow();
    expect(() => store.consume('user-a', 'image', 1, 2_000)).not.toThrow();
    expect(() => store.consume('user-a', 'ai', 1, 1_000 + RATE_LIMIT_WINDOW_MS)).not.toThrow();
  });

  it('fails closed when its bounded user-scope capacity is full', () => {
    const store = createMemoryRateLimitStore(1);

    store.consume('user-a', 'ai', 30, 1_000);

    expect(() => store.consume('user-b', 'ai', 30, 2_000)).toThrow(RateLimitExceededError);
  });
});

describe('Firestore quota classification', () => {
  it('recognizes the Admin SDK resource-exhausted shape', () => {
    expect(isFirestoreQuotaError({
      code: 8,
      details: 'Quota exceeded for Free daily read units per project.',
    })).toBe(true);
  });

  it('does not treat application rate-limit rejections as a Firestore outage', () => {
    expect(isFirestoreQuotaError(new RateLimitExceededError(1_000))).toBe(false);
  });
});
