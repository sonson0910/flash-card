import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { normalizeCustomDeckCollection } from '../library/customDecks';
import {
  legacyCardCacheKey,
  legacyCardOwnerCacheKey,
  ownerScopedCardCacheKey,
  parseOwnerScopedCardCache,
  serializeOwnerScopedCardCache,
} from '../library/ownerScopedCardCache';
import {
  legacyDeckCacheKey,
  legacyDeckOwnerCacheKey,
  ownerScopedDeckCacheKey,
  parseOwnerScopedDeckCache,
  serializeOwnerScopedDeckCache,
} from '../library/ownerScopedDeckCache';
import { normalizeLocalCards } from '../library/libraryStorage';
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
    readCards: () => {
      const scoped = parseOwnerScopedCardCache(read(ownerScopedCardCacheKey));
      return scoped
        ? { ownerId: scoped.ownerId, cards: normalizeLocalCards(scoped.cards) }
        : {
            ownerId: read(legacyCardOwnerCacheKey),
            cards: normalizeLocalCards(readJson(resilientStorage, legacyCardCacheKey)),
          };
    },
    writeCards: (ownerId, cards) => {
      write(ownerScopedCardCacheKey, serializeOwnerScopedCardCache(ownerId, cards));
    },
    discardCards: () => {
      remove(ownerScopedCardCacheKey);
      remove(legacyCardCacheKey);
      remove(legacyCardOwnerCacheKey);
    },
    readDecks: () => parseOwnerScopedDeckCache(read(ownerScopedDeckCacheKey)) ?? ({
      ownerId: read(legacyDeckOwnerCacheKey),
      decks: normalizeCustomDeckCollection(readJson(resilientStorage, legacyDeckCacheKey)),
    }),
    writeDecks: (ownerId, decks) => {
      write(ownerScopedDeckCacheKey, serializeOwnerScopedDeckCache(ownerId, decks));
    },
    discardDecks: () => {
      remove(ownerScopedDeckCacheKey);
      remove(legacyDeckCacheKey);
      remove(legacyDeckOwnerCacheKey);
    },
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
  const activationCloudTotalRef = useRef(cloudTotal);
  activationCloudTotalRef.current = cloudTotal;

  useEffect(
    () => controller.activate({
      ownerId,
      libraryEpoch,
      cloudTotal: activationCloudTotalRef.current,
    }),
    [controller, libraryEpoch, ownerId],
  );

  useEffect(() => {
    void controller.updateContext({ ownerId, libraryEpoch, cloudTotal });
  }, [cloudTotal, controller, libraryEpoch, ownerId]);

  const actions = useMemo(() => ({
    migrateLegacy: controller.migrateLegacy,
    discardCards: controller.discardCards,
  }), [controller]);

  return { model, actions };
}
