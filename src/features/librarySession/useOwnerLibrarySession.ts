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

const browserStorage = (): StoragePort | null => {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
};

export const createBrowserOwnerLibraryCache = (
  suppliedStorage?: StoragePort | null,
): OwnerLibraryCache => {
  const storage = suppliedStorage === undefined ? browserStorage() : suppliedStorage;
  const memory = new Map<string, string>();
  const read = (key: string) => {
    try {
      return storage?.getItem(key) ?? memory.get(key) ?? null;
    } catch {
      return memory.get(key) ?? null;
    }
  };
  const write = (key: string, value: string) => {
    memory.set(key, value);
    try {
      storage?.setItem(key, value);
    } catch {
      // The session-scoped memory copy remains available.
    }
  };
  const remove = (key: string) => {
    try { storage?.removeItem(key); } catch { /* storage may be denied */ }
    memory.delete(key);
  };
  const resilientStorage: StoragePort = { getItem: read, setItem: write, removeItem: remove };

  return {
    readCards: () => ({
      ownerId: read(localCardsOwnerKey),
      cards: normalizeLocalCards(readJson(resilientStorage, 'lingoflash_cards')),
    }),
    writeCards: (ownerId, cards) => {
      write('lingoflash_cards', JSON.stringify(cards));
      write(localCardsOwnerKey, ownerId);
    },
    discardCards: () => remove('lingoflash_cards'),
    readDecks: () => ({
      ownerId: read(localDecksOwnerKey),
      decks: normalizeCustomDeckCollection(readJson(resilientStorage, 'lingoflash_custom_decks')),
    }),
    writeDecks: (ownerId, decks) => {
      write('lingoflash_custom_decks', JSON.stringify(normalizeCustomDeckCollection(decks)));
      write(localDecksOwnerKey, ownerId);
    },
    discardDecks: () => remove('lingoflash_custom_decks'),
    hasCompletedLegacyMigration: ownerId => read(cloudMigrationCacheKey(ownerId)) === 'true',
    markLegacyMigrationComplete: ownerId => write(cloudMigrationCacheKey(ownerId), 'true'),
  };
};

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
