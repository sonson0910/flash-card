import { CLOUD_PAGE_SIZE, type CardQueryState } from '../../lib/cardQuery';
import { mergeDeviceCards } from '../../lib/deviceSync';
import type { LibraryStats } from '../../lib/cardRepository';
import { normalizeCardData } from '../../lib/cardNormalization';
import { dedupeCardsByNormalizedWord } from '../../lib/cardIdentity';
import { selectCardsVisibleForSession } from '../../lib/sessionCards';
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

export const localCardsOwnerKey = 'lingoflash_cards_owner';
export const localDecksOwnerKey = 'lingoflash_custom_decks_owner';
export const MAX_AI_CARDS_PER_IMPORT = 30;

export const cloudPageCacheKey = (userId: string) => `lingoflash_cloud_page_${userId}`;
export const cloudStatsCacheKey = (userId: string) => `lingoflash_cloud_stats_${userId}`;
export const cloudFacetsCacheKey = (userId: string) => `lingoflash_cloud_facets_${userId}`;
export const cloudMigrationCacheKey = (userId: string) => `lingoflash_query_migration_complete_${userId}`;
export const cloudBackoffCacheKey = (userId: string) => `lingoflash_cloud_backoff_until_${userId}`;

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

export const persistLocalCardBackup = (
  cards: CardData[],
  maximum = CLOUD_PAGE_SIZE,
  total = cards.length,
  ownerUserId?: string | null,
) => {
  const boundedCards = cards.slice(0, maximum);
  if (boundedCards.length === 0) return;
  writeLocalValue('lingoflash_cards', JSON.stringify(boundedCards));
  void mergeDeviceCards(boundedCards, Math.max(total, boundedCards.length), ownerUserId);
};

export const waitForInitialMedia = (
  mediaPromise: Promise<{ audioUrl: string | null; imageUrl: string | null }>,
  timeoutMs = 2500,
) => Promise.race([
  mediaPromise,
  new Promise<null>(resolve => window.setTimeout(() => resolve(null), timeoutMs)),
]);

export const getBoundedCloudFallback = (
  userId: string,
  queryKey: string,
  page: number,
  filters: CardQueryState,
  pageSize: number,
): { items: CardData[]; total: number; hasNext: boolean } | null => {
  const cachedValue = readLocalJson<unknown>(cloudPageCacheKey(userId), null);
  const cachedPage = cachedValue && typeof cachedValue === 'object' && !Array.isArray(cachedValue)
    ? cachedValue as Partial<CachedCloudPage>
    : null;
  if (cachedPage && cachedPage.queryKey === queryKey && cachedPage.page === page
    && Array.isArray(cachedPage.items) && typeof cachedPage.total === 'number') {
    const items = normalizeLocalCards(cachedPage.items).slice(0, pageSize);
    if (items.length > 0) return { items, total: ((page - 1) * pageSize) + items.length, hasNext: false };
  }

  const isDefaultFirstPage = page === 1 && filters.wordPrefix === ''
    && !filters.category && !filters.customDeck && !filters.difficulty
    && !filters.partOfSpeech && !filters.bookmarkedOnly && !filters.createdDate;
  if (!isDefaultFirstPage) return null;
  let localOwner: string | null = null;
  try { localOwner = localStorage.getItem(localCardsOwnerKey); } catch { /* storage may be denied */ }
  const localBackup = selectCardsVisibleForSession(
    normalizeLocalCards(readLocalJson<unknown>('lingoflash_cards', [])),
    localOwner,
    userId,
  ).slice(0, pageSize);
  return localBackup.length > 0 ? { items: localBackup, total: localBackup.length, hasNext: false } : null;
};

export const isQuotaError = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('resource-exhausted') || message.toLocaleLowerCase().includes('quota');
};

export const isRetryableSyncError = (error: unknown) => {
  if (isQuotaError(error)) return true;
  const source = error && typeof error === 'object' ? error as { code?: unknown; message?: unknown } : null;
  const code = String(source?.code ?? '').toLocaleLowerCase();
  const message = String(source?.message ?? error).toLocaleLowerCase();
  return ['unavailable', 'deadline-exceeded', 'aborted', 'internal', 'unknown'].some(value => code.includes(value))
    || ['network', 'offline', 'timeout', 'connection'].some(value => message.includes(value));
};

const isLibraryStats = (value: unknown): value is LibraryStats => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const source = value as Record<string, unknown>;
  return ['total', 'reviewed', 'easy', 'good', 'hard', 'unrated', 'bookmarked', 'due', 'legacyUnindexed']
    .every(key => typeof source[key] === 'number' && Number.isFinite(source[key]));
};

export const readCachedCloudStats = (userId: string): { stats: LibraryStats; cachedAt: number | null } | null => {
  const cached = readLocalJson<unknown>(cloudStatsCacheKey(userId), null);
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
