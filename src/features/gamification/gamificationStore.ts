import { rebaseGamificationSnapshots } from './gamificationModel';
import type { StoredGamificationSnapshot } from './gamificationStorage';

export interface GamificationStoreLoadResult {
  source: 'cloud' | 'local-fallback';
  snapshot: StoredGamificationSnapshot;
  cloudDocuments?: {
    stats: boolean;
    history: boolean;
  };
}

export interface GamificationStoreSaveCommit {
  snapshot: StoredGamificationSnapshot;
  appliedOperationIds: string[];
}

export interface GamificationStore {
  load(
    ownerId: string,
    localFallback: StoredGamificationSnapshot,
  ): Promise<GamificationStoreLoadResult>;
  save(
    ownerId: string,
    snapshot: StoredGamificationSnapshot,
  ): Promise<GamificationStoreSaveCommit>;
}

export type GamificationLoadOutcome =
  | { status: 'loaded'; snapshot: StoredGamificationSnapshot }
  | { status: 'stale-owner' };

export type GamificationSaveOutcome =
  | ({ status: 'saved' } & GamificationStoreSaveCommit)
  | { status: 'stale-owner' };

interface GamificationStoreControllerOptions {
  store: GamificationStore;
  activeOwner: () => string | null;
}

export function createGamificationStoreController({
  store,
  activeOwner,
}: GamificationStoreControllerOptions) {
  const saveTails = new Map<string, Promise<void>>();

  return {
    async load(
      ownerId: string,
      localFallback: StoredGamificationSnapshot,
      publish: (snapshot: StoredGamificationSnapshot) => void,
      currentSnapshot: () => StoredGamificationSnapshot = () => localFallback,
    ): Promise<GamificationLoadOutcome> {
      if (activeOwner() !== ownerId) return { status: 'stale-owner' };
      const loaded = await store.load(ownerId, localFallback);
      if (activeOwner() !== ownerId) return { status: 'stale-owner' };
      const current = currentSnapshot();
      let snapshot = loaded.source === 'local-fallback'
        ? current
        : rebaseGamificationSnapshots(current, loaded.snapshot);
      if (loaded.source === 'cloud' && loaded.cloudDocuments) {
        snapshot = {
          ...snapshot,
          ...(!loaded.cloudDocuments.stats
            ? {
                streak: current.streak,
                xp: current.xp,
                lastActive: current.lastActive,
              }
            : {}),
          ...(!loaded.cloudDocuments.history ? { history: current.history } : {}),
        };
      }
      publish(snapshot);
      return { status: 'loaded', snapshot };
    },

    async save(
      ownerId: string,
      snapshot: StoredGamificationSnapshot,
    ): Promise<GamificationSaveOutcome> {
      if (activeOwner() !== ownerId) return { status: 'stale-owner' };
      const previous = saveTails.get(ownerId);
      const run = async (): Promise<GamificationSaveOutcome> => {
        if (activeOwner() !== ownerId) return { status: 'stale-owner' };
        const committed = await store.save(ownerId, snapshot);
        return activeOwner() === ownerId
          ? { status: 'saved', ...committed }
          : { status: 'stale-owner' };
      };
      const operation = previous ? previous.then(run) : run();
      const tail = operation.then(() => undefined, () => undefined);
      saveTails.set(ownerId, tail);
      try {
        return await operation;
      } finally {
        if (saveTails.get(ownerId) === tail) saveTails.delete(ownerId);
      }
    },
  };
}
