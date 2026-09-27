import { isCloudQuotaError, isRetryableCloudError } from '../../lib/cloudError';
import { withTimeout } from '../../lib/async';
import type { LibraryStats } from '../../lib/libraryStats';
import { normalizeCardData } from '../../lib/cardNormalization';
import { dedupeCardsByNormalizedWord } from '../../lib/cardIdentity';
import type { CardData } from '../../types/card';

export interface CachedCloudPage {
  queryKey: string;
  page: number;
  total: number;
  hasNext: boolean;
  items: CardData[];
  updatedAt: string;
  countedAt?: string | null;
}

export interface CachedCloudStats {
  stats: LibraryStats;
  updatedAt: string;
}

export const MAX_AI_CARDS_PER_IMPORT = 30;

export const cloudPageCacheKey = (userId: string) => `lingoflash_cloud_page_${userId}`;
// Namespaced by course target language so switching the active course never
// serves another course's cached stats; omitting the language keeps the
// pre-course-scoping key so existing sign-out/clear cleanup paths still hit it.
export const cloudStatsCacheKey = (userId: string, targetLanguage?: string | null) =>
  targetLanguage ? `lingoflash_cloud_stats_${userId}_${targetLanguage}` : `lingoflash_cloud_stats_${userId}`;
export const cloudFacetsCacheKey = (userId: string) => `lingoflash_cloud_facets_${userId}`;
export const cloudBackoffCacheKey = (userId: string) => `lingoflash_cloud_backoff_until_${userId}`;
export const IMAGE_NEGATIVE_CACHE_TTL_MS = 6 * 60 * 60 * 1_000;
export const imageNegativeCacheKey = (ownerId: string | null, cardId: string) =>
  `lingoflash_no_image_v1_${encodeURIComponent(ownerId ?? 'guest')}_${encodeURIComponent(cardId)}`;

export const writeLocalValue = (key: string, value: string): boolean => {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
};

export const removeLocalValue = (key: string): boolean => {
  try {
    localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
};

// Stats are cached per course, so dropping an owner's stats must sweep every
// course-scoped key as well as the unscoped one.
export const removeCloudStatsCaches = (userId: string): void => {
  const baseKey = cloudStatsCacheKey(userId);
  try {
    for (let index = localStorage.length - 1; index >= 0; index--) {
      const key = localStorage.key(index);
      if (key === baseKey || key?.startsWith(`${baseKey}_`)) localStorage.removeItem(key);
    }
  } catch {
    // Storage can be unavailable (private mode); there is nothing to clear then.
  }
};

export const readLocalJson = <T,>(key: string, fallback: T): T => {
  try {
    const value = localStorage.getItem(key);
    return value === null ? fallback : JSON.parse(value) as T;
  } catch {
    removeLocalValue(key);
    return fallback;
  }
};

export const createId = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `card-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
};

export const sanitizeImportedText = (value: unknown, maximum: number) =>
  (typeof value === 'string' ? value : String(value ?? '')).trim().slice(0, maximum);

export const normalizeLocalCards = (value: unknown): CardData[] => Array.isArray(value)
  ? dedupeCardsByNormalizedWord(value.flatMap((entry, index) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
      const raw = entry as Partial<CardData>;
      return [normalizeCardData(raw, typeof raw.id === 'string' && raw.id ? raw.id : `local-${index}`)];
    }))
  : [];

export const isCloudBackoffActive = (userId: string) => {
  try {
    return Number(localStorage.getItem(cloudBackoffCacheKey(userId)) || 0) > Date.now();
  } catch {
    return false;
  }
};

export const hasImageNegativeCache = (
  ownerId: string | null,
  cardId: string,
  now = Date.now(),
) => {
  const key = imageNegativeCacheKey(ownerId, cardId);
  const value = readLocalJson<unknown>(key, null);
  const expiresAt = value && typeof value === 'object' && !Array.isArray(value)
    ? Number((value as { expiresAt?: unknown }).expiresAt)
    : 0;
  if (Number.isFinite(expiresAt) && expiresAt > now) return true;
  if (expiresAt > 0 || value !== null) removeLocalValue(key);
  return false;
};

export const markImageNegativeCache = (
  ownerId: string | null,
  cardId: string,
  now = Date.now(),
) => writeLocalValue(
  imageNegativeCacheKey(ownerId, cardId),
  JSON.stringify({ status: 'no-result', expiresAt: now + IMAGE_NEGATIVE_CACHE_TTL_MS }),
);

export const clearImageNegativeCache = (ownerId: string | null, cardId: string) =>
  removeLocalValue(imageNegativeCacheKey(ownerId, cardId));

export const waitForInitialMedia = (
  mediaPromise: Promise<{ audioUrl: string | null; imageUrl: string | null }>,
  timeoutMs = 2500,
) => withTimeout(mediaPromise, timeoutMs).catch(() => null);

export const isQuotaError = isCloudQuotaError;

export const isRetryableSyncError = isRetryableCloudError;

const isLibraryStats = (value: unknown): value is LibraryStats => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const source = value as Record<string, unknown>;
  return ['total', 'reviewed', 'easy', 'good', 'hard', 'unrated', 'bookmarked', 'due', 'legacyUnindexed']
    .every(key => typeof source[key] === 'number' && Number.isFinite(source[key]));
};

export const readCachedCloudStats = (
  userId: string,
  targetLanguage?: string | null,
): { stats: LibraryStats; cachedAt: number | null } | null => {
  const cached = readLocalJson<unknown>(cloudStatsCacheKey(userId, targetLanguage), null);
  if (isLibraryStats(cached)) return { stats: cached, cachedAt: null };
  if (!cached || typeof cached !== 'object' || Array.isArray(cached)) return null;
  const candidate = cached as Partial<CachedCloudStats>;
  if (!isLibraryStats(candidate.stats)) return null;
  const cachedAt = typeof candidate.updatedAt === 'string' ? Date.parse(candidate.updatedAt) : Number.NaN;
  return { stats: candidate.stats, cachedAt: Number.isFinite(cachedAt) ? cachedAt : null };
};

export const readCachedCloudTotal = (userId: string, queryKey: string) => {
  const cached = readLocalJson<unknown>(cloudPageCacheKey(userId), null);
  if (!cached || typeof cached !== 'object' || Array.isArray(cached)) return null;
  const candidate = cached as Partial<CachedCloudPage>;
  if (candidate.queryKey !== queryKey || typeof candidate.total !== 'number' || typeof candidate.updatedAt !== 'string') return null;
  const hasCountTimestamp = Object.prototype.hasOwnProperty.call(candidate, 'countedAt');
  const timestamp = typeof candidate.countedAt === 'string' ? candidate.countedAt : hasCountTimestamp ? null : candidate.updatedAt;
  if (timestamp === null) return { total: candidate.total, cachedAt: null };
  const cachedAt = Date.parse(timestamp);
  return Number.isFinite(cachedAt) ? { total: candidate.total, cachedAt } : { total: candidate.total, cachedAt: null };
};

export const normalizeCardForStorage = (card: CardData): CardData => {
  const normalized = normalizeCardData({ ...card, createdAt: card.createdAt || new Date().toISOString() }, card.id);
  return Object.fromEntries(Object.entries(normalized).filter(([, value]) => value !== undefined)) as unknown as CardData;
};
