import type { CardQueryState } from '../../lib/cardQuery';
import type { CardData } from '../../types/card';
import { useIdentitySession } from '../session/useIdentitySession';
import type { OwnerLibraryCache, OwnerLibrarySessionAdapter } from './ownerLibrarySessionController';
import { useCloudLibraryPage } from './useCloudLibraryPage';
import {
  useLibraryDeviceSync,
  type LibraryDeviceSyncEvents,
} from './useLibraryDeviceSync';
import type { LibraryReplicaIntakePort } from './libraryReplicaIntakeContract';
import { useOwnerLibrarySession } from './useOwnerLibrarySession';

type IdentitySessionBinding = ReturnType<typeof useIdentitySession>;
type OwnerLibraryBinding = ReturnType<typeof useOwnerLibrarySession>;
type DeviceSyncBinding = ReturnType<typeof useLibraryDeviceSync>;
type CloudPageBinding = ReturnType<typeof useCloudLibraryPage>;

export interface LibrarySessionHookDependencies {
  useIdentitySession(): IdentitySessionBinding;
  useOwnerLibrarySession: typeof useOwnerLibrarySession;
  useLibraryDeviceSync: typeof useLibraryDeviceSync;
  useCloudLibraryPage: typeof useCloudLibraryPage;
}

export function createLibrarySessionHookDependencies(
  identityHook: () => IdentitySessionBinding,
): LibrarySessionHookDependencies {
  return {
    useIdentitySession: identityHook,
    useOwnerLibrarySession,
    useLibraryDeviceSync,
    useCloudLibraryPage,
  };
}

export interface LibrarySessionCatalogInput {
  query: CardQueryState;
  queryKey: string;
  page: number;
  pageSize: number;
  refreshKey: number;
  statsOpen: boolean;
}

export interface LibrarySessionLibraryInput {
  cards: readonly CardData[];
  knownTotal: number;
  cloudTotal: number;
  cloudStatsTotal: number;
  browserOnline: boolean;
  cloudUnavailable: boolean;
}

export interface LibrarySessionInputPorts {
  ownerAdapter: OwnerLibrarySessionAdapter;
  ownerCache?: OwnerLibraryCache;
  deviceEvents: LibraryDeviceSyncEvents;
  getPromotedCards(): readonly CardData[];
}

export interface LibrarySessionInputs {
  catalog: LibrarySessionCatalogInput;
  library: LibrarySessionLibraryInput;
  ports: LibrarySessionInputPorts;
}

export interface LibrarySessionIdentityModel {
  status: IdentitySessionBinding['status'];
  owner: IdentitySessionBinding['owner'];
  ownerEpoch: IdentitySessionBinding['ownerEpoch'];
  canPublishMutations: boolean;
  isSigningIn: boolean;
  isSigningOut: boolean;
  error: string | null;
}

export interface LibrarySessionSyncModel {
  isSyncing: boolean;
  pendingCount: number;
  error: string | null;
}

export interface LibrarySessionModel {
  identity: LibrarySessionIdentityModel;
  owner: OwnerLibraryBinding['model'];
  sync: LibrarySessionSyncModel;
  cloud: CloudPageBinding;
}

export interface LibrarySessionActions {
  identity: Pick<IdentitySessionBinding,
    'signIn' | 'signOut' | 'clearError' | 'acceptVerifiedOwnerEpoch'>;
  owner: OwnerLibraryBinding['actions'];
  sync: Pick<DeviceSyncBinding, 'syncNow' | 'retry'>;
}

export interface LibrarySessionConsumerPorts {
  cards: {
    acknowledge: DeviceSyncBinding['acknowledge'];
    upsert: DeviceSyncBinding['upsertCards'];
    patch: DeviceSyncBinding['patchCards'];
    remove: DeviceSyncBinding['removeCard'];
    intake: LibraryReplicaIntakePort;
  };
  cloud: {
    getFallback: DeviceSyncBinding['getFallback'];
    flush: DeviceSyncBinding['flush'];
    refreshPending: DeviceSyncBinding['refreshPending'];
    syncMirror: DeviceSyncBinding['syncMirror'];
  };
}

export interface LibrarySessionFacade {
  model: LibrarySessionModel;
  actions: LibrarySessionActions;
  ports: LibrarySessionConsumerPorts;
}

export function useLibrarySession(
  { catalog, library, ports }: LibrarySessionInputs,
  hooks: LibrarySessionHookDependencies,
): LibrarySessionFacade {
  const identity = hooks.useIdentitySession();
  const ownerId = identity.owner?.id ?? null;
  const verifiedEpoch = identity.ownerEpoch?.ownerId === ownerId
    ? identity.ownerEpoch.value
    : null;
  const epoch = ownerId !== null && verifiedEpoch !== null
    ? { userId: ownerId, value: verifiedEpoch }
    : null;

  const owner = hooks.useOwnerLibrarySession({
    ownerId,
    libraryEpoch: verifiedEpoch,
    cloudTotal: library.knownTotal,
    adapter: ports.ownerAdapter,
    cache: ports.ownerCache,
  });

  const sync = hooks.useLibraryDeviceSync({
    owner: ownerId === null ? null : { uid: ownerId },
    epoch,
    cards: library.cards,
    knownLibraryTotal: library.knownTotal,
    cloudTotal: library.cloudTotal,
    cloudStatsTotal: library.cloudStatsTotal,
    cardsPerPage: catalog.pageSize,
    isBrowserOnline: library.browserOnline,
    cloudReadUnavailable: library.cloudUnavailable,
    query: catalog.query,
    queryKey: catalog.queryKey,
    currentPage: catalog.page,
    getPromotedCards: ports.getPromotedCards,
    events: ports.deviceEvents,
  });

  const cloud = hooks.useCloudLibraryPage({
    ownerId,
    query: catalog.query,
    queryKey: catalog.queryKey,
    page: catalog.page,
    pageSize: catalog.pageSize,
    refreshKey: catalog.refreshKey,
    statsOpen: catalog.statsOpen,
    getDeviceFallback: sync.getFallback,
    getPromotedCards: ports.getPromotedCards,
  });

  return {
    model: {
      identity: {
        status: identity.status,
        owner: identity.owner,
        ownerEpoch: identity.ownerEpoch,
        canPublishMutations: identity.canPublishMutations,
        isSigningIn: identity.isSigningIn,
        isSigningOut: identity.isSigningOut,
        error: identity.error,
      },
      owner: owner.model,
      sync: {
        isSyncing: sync.isSyncing,
        pendingCount: sync.pendingCount,
        error: sync.error,
      },
      cloud,
    },
    actions: {
      identity: {
        signIn: identity.signIn,
        signOut: identity.signOut,
        clearError: identity.clearError,
        acceptVerifiedOwnerEpoch: identity.acceptVerifiedOwnerEpoch,
      },
      owner: owner.actions,
      sync: {
        syncNow: sync.syncNow,
        retry: sync.retry,
      },
    },
    ports: {
      cards: {
        acknowledge: sync.acknowledge,
        upsert: sync.upsertCards,
        patch: sync.patchCards,
        remove: sync.removeCard,
        intake: sync.intake,
      },
      cloud: {
        getFallback: sync.getFallback,
        flush: sync.flush,
        refreshPending: sync.refreshPending,
        syncMirror: sync.syncMirror,
      },
    },
  };
}
