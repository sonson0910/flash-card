import { normalizeCustomDeckProfile, type CoverPreset } from './customDecks';

export const ownerScopedDeckCacheKey = 'lingoflash_custom_decks_scoped_v1';
export const legacyDeckCacheKey = 'lingoflash_custom_decks';
export const legacyDeckOwnerCacheKey = 'lingoflash_custom_decks_owner';

export interface OwnerScopedDeckCacheValue {
  ownerId: string | null;
  decks: string[];
  coverPresets: Record<string, CoverPreset>;
}

export const serializeOwnerScopedDeckCache = (
  ownerId: string | null,
  decks: readonly string[],
  coverPresets: Record<string, CoverPreset> = {},
): string => JSON.stringify({
  version: 2,
  ownerId,
  ...normalizeCustomDeckProfile({ decks, coverPresets }),
});

export const parseOwnerScopedDeckCache = (
  value: string | null,
): OwnerScopedDeckCacheValue | null => {
  if (value === null) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const record = parsed as Record<string, unknown>;
    if (record.version !== 1 && record.version !== 2) return null;
    if (record.ownerId !== null && (
      typeof record.ownerId !== 'string'
      || record.ownerId.length === 0
      || record.ownerId.length > 256
    )) return null;
    if (!Array.isArray(record.decks)) return null;
    const profile = normalizeCustomDeckProfile({
      decks: record.decks,
      coverPresets: record.version === 2 ? record.coverPresets : {},
    });
    return {
      ownerId: record.ownerId as string | null,
      ...profile,
    };
  } catch {
    return null;
  }
};
