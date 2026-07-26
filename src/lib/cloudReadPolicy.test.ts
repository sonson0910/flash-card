import { describe, expect, it } from 'vitest';
import {
  CLOUD_COUNT_TTL_MS,
  CLOUD_STATS_TTL_MS,
  shouldRefreshCloudCount,
  shouldRefreshCloudStats,
} from './cloudReadPolicy';

describe('cloud read policy', () => {
  it('never recounts the collection while navigating beyond the first page', () => {
    expect(shouldRefreshCloudCount({ page: 2, cachedAt: null, now: 10_000 })).toBe(false);
    expect(shouldRefreshCloudCount({ page: 100, cachedAt: 0, now: 10_000 })).toBe(false);
  });

  it('reuses a fresh first-page count and only refreshes it after the TTL', () => {
    const now = 1_000_000;
    expect(shouldRefreshCloudCount({ page: 1, cachedAt: now - CLOUD_COUNT_TTL_MS + 1, now })).toBe(false);
    expect(shouldRefreshCloudCount({ page: 1, cachedAt: now - CLOUD_COUNT_TTL_MS, now })).toBe(true);
  });

  it('reuses expensive statistics across reloads until their TTL expires', () => {
    const now = 2_000_000;
    expect(shouldRefreshCloudStats(now - CLOUD_STATS_TTL_MS + 1, now)).toBe(false);
    expect(shouldRefreshCloudStats(now - CLOUD_STATS_TTL_MS, now)).toBe(true);
    expect(shouldRefreshCloudStats(null, now)).toBe(true);
  });
});
