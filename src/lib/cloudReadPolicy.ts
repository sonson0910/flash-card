export const CLOUD_COUNT_TTL_MS = 60 * 60 * 1000;
export const CLOUD_STATS_TTL_MS = 24 * 60 * 60 * 1000;

export function shouldRefreshCloudCount({
  page,
  cachedAt,
  now = Date.now(),
}: {
  page: number;
  cachedAt: number | null;
  now?: number;
}): boolean {
  if (page !== 1) return false;
  return cachedAt === null || now - cachedAt >= CLOUD_COUNT_TTL_MS;
}

export function shouldRefreshCloudStats(cachedAt: number | null, now = Date.now()): boolean {
  return cachedAt === null || now - cachedAt >= CLOUD_STATS_TTL_MS;
}
