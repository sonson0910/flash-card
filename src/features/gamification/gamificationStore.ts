import type { StoredGamificationSnapshot } from './gamificationStorage';

export interface GamificationStore {
  load(ownerId: string, localFallback: StoredGamificationSnapshot): Promise<StoredGamificationSnapshot>;
  save(ownerId: string, snapshot: StoredGamificationSnapshot): Promise<void>;
}

export type GamificationLoadOutcome =
  | { status: 'loaded'; snapshot: StoredGamificationSnapshot }
  | { status: 'stale-owner' };

export type GamificationSaveOutcome =
  | { status: 'saved' }
  | { status: 'stale-owner' };

interface GamificationStoreControllerOptions {
  store: GamificationStore;
  activeOwner: () => string | null;
}

export function createGamificationStoreController({
  store,
  activeOwner,
}: GamificationStoreControllerOptions) {
  return {
    async load(
      ownerId: string,
      localFallback: StoredGamificationSnapshot,
      publish: (snapshot: StoredGamificationSnapshot) => void,
    ): Promise<GamificationLoadOutcome> {
      if (activeOwner() !== ownerId) return { status: 'stale-owner' };
      const snapshot = await store.load(ownerId, localFallback);
      if (activeOwner() !== ownerId) return { status: 'stale-owner' };
      publish(snapshot);
      return { status: 'loaded', snapshot };
    },

    async save(
      ownerId: string,
      snapshot: StoredGamificationSnapshot,
    ): Promise<GamificationSaveOutcome> {
      if (activeOwner() !== ownerId) return { status: 'stale-owner' };
      await store.save(ownerId, snapshot);
      return activeOwner() === ownerId ? { status: 'saved' } : { status: 'stale-owner' };
    },
  };
}
