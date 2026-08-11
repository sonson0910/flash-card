export const ownerScopedCardCacheKey = 'lingoflash_cards_scoped_v1';
export const legacyCardCacheKey = 'lingoflash_cards';
export const legacyCardOwnerCacheKey = 'lingoflash_cards_owner';

export interface OwnerScopedCardCacheValue {
  ownerId: string | null;
  cards: unknown[];
}

export const serializeOwnerScopedCardCache = (
  ownerId: string | null,
  cards: readonly unknown[],
): string => JSON.stringify({ version: 1, ownerId, cards });

export const parseOwnerScopedCardCache = (
  value: string | null,
): OwnerScopedCardCacheValue | null => {
  if (value === null) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const record = parsed as Record<string, unknown>;
    if (record.version !== 1) return null;
    if (record.ownerId !== null && (
      typeof record.ownerId !== 'string'
      || record.ownerId.length === 0
      || record.ownerId.length > 256
    )) return null;
    if (!Array.isArray(record.cards)) return null;
    return { ownerId: record.ownerId as string | null, cards: record.cards };
  } catch {
    return null;
  }
};
