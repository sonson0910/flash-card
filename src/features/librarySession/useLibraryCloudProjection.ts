import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { loadDeviceCards } from '../../lib/deviceSync';
import type { CardData } from '../../types/card';
import {
  normalizeLocalCards,
  readLocalCardCache,
  writeLocalCardCache,
} from '../library/libraryStorage';
import type { LibrarySessionModel } from './useLibrarySession';

export interface LibraryCloudProjectionCache {
  readAnonymous(): { ownerId: string | null; cards: CardData[] };
  writeAnonymous(cards: readonly CardData[]): void;
  loadDeviceBackup(): Promise<{ ownerId: string | null; cards: CardData[] } | null>;
}

export interface LibraryCloudProjectionValue {
  items: CardData[];
  total: number;
  hasNext: boolean;
  isLoading: boolean;
  unavailable: boolean;
  stats: LibrarySessionModel['cloud']['stats'];
  facets: Record<string, number>;
  facetsComplete: boolean;
}

export interface LibraryCloudProjectionPublication {
  presentCards(ownerId: string | null, cards: CardData[]): void;
  presentCloud(value: LibraryCloudProjectionValue): void;
  resetCloud(): void;
  resetPage(): void;
  previousPage(): void;
  reportError(message: string): void;
  notify(message: string): void;
}

export interface LibraryCloudProjectionInput {
  session: LibrarySessionModel;
  cards: readonly CardData[];
  page: number;
}

export interface LibraryCloudProjectionModel {
  ownerId: string | null;
  status: 'idle' | 'seeding' | 'ready';
  source: 'none' | 'owner-cache' | 'cloud' | 'anonymous-cache' | 'device-seed';
}

interface LibraryCloudProjectionOptions {
  cache: LibraryCloudProjectionCache;
  publication: LibraryCloudProjectionPublication;
}

const EMPTY_MODEL: LibraryCloudProjectionModel = {
  ownerId: null,
  status: 'idle',
  source: 'none',
};

const sameModel = (
  left: LibraryCloudProjectionModel,
  right: LibraryCloudProjectionModel,
): boolean => left.ownerId === right.ownerId
  && left.status === right.status
  && left.source === right.source;

const restoredNotice = (count: number): string =>
  `Restored ${count} card${count === 1 ? '' : 's'} from the shared local library.`;

export function createLibraryCloudProjectionController({
  cache,
  publication,
}: LibraryCloudProjectionOptions) {
  let model = EMPTY_MODEL;
  let identityKey: string | null = null;
  let generation = 0;
  let adoptedOwnerId: string | null = null;
  let anonymousReady = false;
  let seedStarted = false;
  let disposed = false;
  let latestInput: LibraryCloudProjectionInput | null = null;
  let lastOwnerError: string | null = null;
  let lastCloudError: string | null = null;
  let exhaustedPageKey: string | null = null;
  const listeners = new Set<() => void>();

  const publishModel = (next: LibraryCloudProjectionModel) => {
    if (disposed || sameModel(model, next)) return;
    model = next;
    listeners.forEach(listener => listener());
  };

  const forwardError = (
    value: string | null,
    previous: string | null,
  ): string | null => {
    if (value && value !== previous) publication.reportError(value);
    return value;
  };

  const beginIdentity = (key: string, ownerId: string | null) => {
    if (identityKey === key) return;
    identityKey = key;
    generation += 1;
    adoptedOwnerId = null;
    anonymousReady = false;
    seedStarted = false;
    lastOwnerError = null;
    lastCloudError = null;
    exhaustedPageKey = null;
    publishModel({ ownerId, status: 'idle', source: 'none' });
  };

  const seedAnonymous = async (
    input: LibraryCloudProjectionInput,
    seedGeneration: number,
  ): Promise<void> => {
    if (seedStarted || disposed) return;
    seedStarted = true;
    publishModel({ ownerId: null, status: 'seeding', source: 'none' });
    try {
      const backup = await cache.loadDeviceBackup();
      if (disposed || generation !== seedGeneration || identityKey !== 'anonymous') return;
      if (latestInput?.cards !== input.cards) {
        publishModel({
          ownerId: null,
          status: 'ready',
          source: latestInput?.cards.length ? 'anonymous-cache' : 'none',
        });
        return;
      }
      if (!backup || backup.ownerId !== null || backup.cards.length === 0) {
        publishModel({ ownerId: null, status: 'ready', source: 'none' });
        return;
      }
      const cards = normalizeLocalCards(backup.cards);
      if (cards.length === 0) {
        publishModel({ ownerId: null, status: 'ready', source: 'none' });
        return;
      }
      publication.presentCards(null, cards);
      try { cache.writeAnonymous(cards); } catch { /* memory projection remains valid */ }
      publication.notify(restoredNotice(cards.length));
      publishModel({ ownerId: null, status: 'ready', source: 'device-seed' });
    } catch {
      if (!disposed && generation === seedGeneration && identityKey === 'anonymous') {
        publishModel({ ownerId: null, status: 'ready', source: 'none' });
      }
    }
  };

  const update = async (input: LibraryCloudProjectionInput): Promise<void> => {
    if (disposed) return;
    latestInput = input;
    const identity = input.session.identity;
    if (identity.status === 'loading') {
      beginIdentity('loading', null);
      return;
    }
    const ownerId = identity.owner?.id ?? null;
    const key = ownerId ? `owner:${ownerId}` : 'anonymous';
    beginIdentity(key, ownerId);
    const activeGeneration = generation;

    if (ownerId) {
      const owner = input.session.owner;
      const cloud = input.session.cloud;
      if (owner.ownerId === ownerId && adoptedOwnerId !== ownerId) {
        adoptedOwnerId = ownerId;
        publication.presentCards(ownerId, owner.cards);
        publication.resetCloud();
        publication.resetPage();
        publishModel({ ownerId, status: 'ready', source: 'owner-cache' });
      }
      lastOwnerError = forwardError(owner.error, lastOwnerError);

      if (cloud.ownerId === ownerId) {
        publication.presentCards(ownerId, cloud.items);
        publication.presentCloud({
          items: cloud.items,
          total: cloud.total,
          hasNext: cloud.hasNext,
          isLoading: cloud.isLoading,
          unavailable: cloud.cloudUnavailable,
          stats: cloud.stats,
          facets: cloud.facets,
          facetsComplete: cloud.facetsComplete,
        });
        lastCloudError = forwardError(cloud.error, lastCloudError);
        const exhausted = !cloud.isLoading
          && input.page > 1
          && cloud.items.length === 0
          && !cloud.hasNext;
        const pageKey = exhausted ? `${ownerId}:${cloud.queryKey}:${input.page}` : null;
        if (pageKey && exhaustedPageKey !== pageKey) publication.previousPage();
        exhaustedPageKey = pageKey;
        publishModel({ ownerId, status: 'ready', source: 'cloud' });
      }
      return;
    }

    if (!anonymousReady) {
      let cached: { ownerId: string | null; cards: CardData[] } = { ownerId: null, cards: [] };
      try { cached = cache.readAnonymous(); } catch { /* denied storage is empty */ }
      const cards = cached.ownerId === null ? normalizeLocalCards(cached.cards) : [];
      anonymousReady = true;
      publication.presentCards(null, cards);
      publication.resetCloud();
      publishModel({
        ownerId: null,
        status: cards.length > 0 ? 'ready' : 'idle',
        source: cards.length > 0 ? 'anonymous-cache' : 'none',
      });
      if (cards.length > 0) return;
    } else {
      try { cache.writeAnonymous(input.cards); } catch { /* memory cards remain valid */ }
      if (input.cards.length > 0) {
        publishModel({ ownerId: null, status: 'ready', source: 'anonymous-cache' });
        return;
      }
    }

    await seedAnonymous(input, activeGeneration);
  };

  const actions = {
    async retryAnonymousSeed(): Promise<void> {
      if (!latestInput || identityKey !== 'anonymous' || disposed) return;
      seedStarted = false;
      await seedAnonymous(latestInput, generation);
    },
  };

  return {
    getSnapshot: () => model,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    update,
    dispose() {
      if (disposed) return;
      disposed = true;
      generation += 1;
      listeners.clear();
    },
    actions,
  };
}

const browserCache: LibraryCloudProjectionCache = {
  readAnonymous: () => {
    const cached = readLocalCardCache();
    return { ownerId: cached.ownerId ?? null, cards: cached.cards };
  },
  writeAnonymous: cards => { writeLocalCardCache(cards, null); },
  loadDeviceBackup: async () => {
    const backup = await loadDeviceCards();
    return backup
      ? { ownerId: backup.ownerUserId ?? null, cards: normalizeLocalCards(backup.cards) }
      : null;
  },
};

export interface UseLibraryCloudProjectionOptions extends LibraryCloudProjectionInput {
  publication: LibraryCloudProjectionPublication;
  cache?: LibraryCloudProjectionCache;
}

export function useLibraryCloudProjection({
  session,
  cards,
  page,
  publication,
  cache = browserCache,
}: UseLibraryCloudProjectionOptions) {
  const controller = useMemo(
    () => createLibraryCloudProjectionController({ cache, publication }),
    [cache, publication],
  );
  const model = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );

  useEffect(() => {
    void controller.update({ session, cards, page });
  }, [cards, controller, page, session]);

  useEffect(() => () => controller.dispose(), [controller]);

  return { model, actions: controller.actions };
}
