import { describe, expect, it } from 'vitest';
import {
  AnonymousAdmissionExceededError,
  createAnonymousAdmissionLimiter,
  createMemoryRateLimitStore,
  evaluateRateLimit,
  isFirestoreQuotaError,
  RateLimitExceededError,
  RATE_LIMIT_WINDOW_MS,
} from '../src/rateLimiter.js';

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

describe('anonymous shared-deck admission', () => {
  const salt = new Uint8Array(32).fill(7);

  it('isolates valid network sources while sharing one fallback bucket', () => {
    const limiter = createAnonymousAdmissionLimiter({
      sourceMaximum: 1,
      processMaximum: 10,
      salt,
    });

    limiter.consume('203.0.113.10', 1_000);
    expect(() => limiter.consume('203.0.113.10', 2_000)).toThrow(AnonymousAdmissionExceededError);
    expect(() => limiter.consume('203.0.113.11', 2_000)).not.toThrow();

    limiter.consume(undefined, 2_000);
    expect(() => limiter.consume('not-an-ip', 2_000)).toThrow(AnonymousAdmissionExceededError);
  });

  it('does not consume the process budget when the source budget denies a call', () => {
    const limiter = createAnonymousAdmissionLimiter({
      sourceMaximum: 1,
      processMaximum: 2,
      salt,
    });

    limiter.consume('2001:db8::1', 1_000);
    expect(() => limiter.consume('2001:db8::1', 2_000)).toThrow(AnonymousAdmissionExceededError);
    expect(() => limiter.consume('2001:db8::2', 2_000)).not.toThrow();
    expect(() => limiter.consume('2001:db8::3', 2_000)).toThrow(
      expect.objectContaining({ reason: 'process-limit' }),
    );
  });

  it('fails closed at source capacity and prunes expired entries', () => {
    const limiter = createAnonymousAdmissionLimiter({
      sourceMaximum: 10,
      processMaximum: 10,
      maximumSourceEntries: 1,
      salt,
    });

    limiter.consume('192.0.2.1', 1_000);
    expect(() => limiter.consume('192.0.2.2', 2_000)).toThrow(
      expect.objectContaining({ reason: 'source-capacity' }),
    );
    expect(() => limiter.consume('192.0.2.2', 1_000 + RATE_LIMIT_WINDOW_MS)).not.toThrow();
  });

  it('returns a bounded retry interval without exposing the source bucket', () => {
    const limiter = createAnonymousAdmissionLimiter({
      sourceMaximum: 1,
      processMaximum: 10,
      salt,
    });
    limiter.consume('198.51.100.3', 1_000);

    try {
      limiter.consume('198.51.100.3', 2_000);
      throw new Error('Expected admission denial.');
    } catch (error) {
      expect(error).toBeInstanceOf(AnonymousAdmissionExceededError);
      expect(error).toMatchObject({
        reason: 'source-limit',
        retryAfterMs: RATE_LIMIT_WINDOW_MS - 1_000,
      });
      expect(Object.keys(error as object)).not.toContain('source');
      expect(Object.keys(error as object)).not.toContain('bucket');
    }
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
