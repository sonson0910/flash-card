import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { normalizeCustomDeckCollection } from '../library/customDecks';
import {
  cloudMigrationCacheKey,
  localCardsOwnerKey,
  localDecksOwnerKey,
  normalizeLocalCards,
} from '../library/libraryStorage';
import {
  createOwnerLibrarySessionController,
  type OwnerLibraryCache,
  type OwnerLibrarySessionAdapter,
} from './ownerLibrarySessionController';

interface StoragePort {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const readJson = (storage: StoragePort, key: string): unknown => {
  try {
    const value = storage.getItem(key);
    return value === null ? [] : JSON.parse(value);
  } catch {
    try { storage.removeItem(key); } catch { /* storage may be denied */ }
    return [];
  }
};

export const createBrowserOwnerLibraryCache = (
  storage: StoragePort = globalThis.localStorage,
): OwnerLibraryCache => ({
  readCards: () => ({
    ownerId: storage.getItem(localCardsOwnerKey),
    cards: normalizeLocalCards(readJson(storage, 'lingoflash_cards')),
  }),
  writeCards: (ownerId, cards) => {
    storage.setItem('lingoflash_cards', JSON.stringify(cards));
    storage.setItem(localCardsOwnerKey, ownerId);
  },
  discardCards: () => storage.removeItem('lingoflash_cards'),
  readDecks: () => ({
    ownerId: storage.getItem(localDecksOwnerKey),
    decks: normalizeCustomDeckCollection(readJson(storage, 'lingoflash_custom_decks')),
  }),
  writeDecks: (ownerId, decks) => {
    storage.setItem('lingoflash_custom_decks', JSON.stringify(normalizeCustomDeckCollection(decks)));
    storage.setItem(localDecksOwnerKey, ownerId);
  },
  discardDecks: () => storage.removeItem('lingoflash_custom_decks'),
  hasCompletedLegacyMigration: ownerId => storage.getItem(cloudMigrationCacheKey(ownerId)) === 'true',
  markLegacyMigrationComplete: ownerId => storage.setItem(cloudMigrationCacheKey(ownerId), 'true'),
});

export interface UseOwnerLibrarySessionOptions {
  ownerId: string | null;
  libraryEpoch: number | null;
  cloudTotal: number;
  adapter: OwnerLibrarySessionAdapter;
  cache?: OwnerLibraryCache;
}

export function useOwnerLibrarySession({
  ownerId,
  libraryEpoch,
  cloudTotal,
  adapter,
  cache,
}: UseOwnerLibrarySessionOptions) {
  const browserCache = useMemo(() => createBrowserOwnerLibraryCache(), []);
  const activeCache = cache ?? browserCache;
  const controller = useMemo(
    () => createOwnerLibrarySessionController({ adapter, cache: activeCache }),
    [adapter, activeCache],
  );
  const model = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);

  useEffect(
    () => controller.activate({ ownerId, libraryEpoch, cloudTotal }),
    [cloudTotal, controller, libraryEpoch, ownerId],
  );

  const actions = useMemo(() => ({
    migrateLegacy: controller.migrateLegacy,
  }), [controller]);

  return { model, actions };
}

