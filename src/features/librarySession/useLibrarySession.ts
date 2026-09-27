import type { CardQueryState } from '../../lib/cardQuery';
import type { CardData } from '../../types/card';
import { useIdentitySession } from '../session/useIdentitySession';
import type { OwnerLibrarySessionAdapter } from './ownerLibrarySessionController';
import { useCloudLibraryPage } from './useCloudLibraryPage';
import { useOwnerLibrarySession } from './useOwnerLibrarySession';

type IdentitySessionBinding = ReturnType<typeof useIdentitySession>;
type OwnerLibraryBinding = ReturnType<typeof useOwnerLibrarySession>;
type CloudPageBinding = ReturnType<typeof useCloudLibraryPage>;

export interface LibrarySessionHookDependencies {
  useIdentitySession(): IdentitySessionBinding;
  useOwnerLibrarySession: typeof useOwnerLibrarySession;
  useCloudLibraryPage: typeof useCloudLibraryPage;
}

export function createLibrarySessionHookDependencies(
  identityHook: () => IdentitySessionBinding,
): LibrarySessionHookDependencies {
  return {
    useIdentitySession: identityHook,
    useOwnerLibrarySession,
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
  progressEvidenceOpen: boolean;
}

export interface LibrarySessionLibraryInput {
  knownTotal: number;
  cloudTotal: number;
  cloudStatsTotal: number;
}

export interface LibrarySessionInputPorts {
  ownerAdapter: OwnerLibrarySessionAdapter;
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
  authenticationRecovery: IdentitySessionBinding['authenticationRecovery'];
  error: string | null;
}

export interface LibrarySessionModel {
  identity: LibrarySessionIdentityModel;
  owner: OwnerLibraryBinding['model'];
  cloud: CloudPageBinding;
}

export interface LibrarySessionActions {
  identity: Pick<IdentitySessionBinding,
    'signIn' | 'signOut' | 'clearError' | 'acceptVerifiedOwnerEpoch'>;
  owner: OwnerLibraryBinding['actions'];
}

export interface LibrarySessionFacade {
  model: LibrarySessionModel;
  actions: LibrarySessionActions;
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

  const owner = hooks.useOwnerLibrarySession({
    ownerId,
    libraryEpoch: verifiedEpoch,
    cloudTotal: library.knownTotal,
    adapter: ports.ownerAdapter,
  });

  const cloud = hooks.useCloudLibraryPage({
    ownerId,
    query: catalog.query,
    queryKey: catalog.queryKey,
    page: catalog.page,
    pageSize: catalog.pageSize,
    refreshKey: catalog.refreshKey,
    statsOpen: catalog.statsOpen,
    progressEvidenceOpen: catalog.progressEvidenceOpen,
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
        authenticationRecovery: identity.authenticationRecovery,
        error: identity.error,
      },
      owner: owner.model,
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
    },
  };
}
