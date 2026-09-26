import { useRef } from 'react';
import type { CardData } from '../../types/card';
import type { LibrarySessionInputPorts } from './useLibrarySession';
import type { OwnerLibrarySessionAdapter } from './ownerLibrarySessionController';

export interface LibrarySessionPortStats {
  total: number;
  reviewed: number;
  easy: number;
  good: number;
  hard: number;
  unrated: number;
  bookmarked: number;
  due: number;
  legacyUnindexed: number;
}

export interface LibrarySessionPortPublications {
  cloud: {
    total(total: number): void;
    stats(stats: LibrarySessionPortStats): void;
    facets(categories: Record<string, number>, complete: boolean): void;
    hasNextPage(hasNext: boolean): void;
    unavailable(unavailable: boolean): void;
    refresh(): void;
  };
  navigation: {
    resetPage(): void;
    previousPage(): void;
  };
  promotedCards(): readonly CardData[];
}

export interface LibrarySessionPortsOptions {
  ownerAdapter: OwnerLibrarySessionAdapter;
  publications: LibrarySessionPortPublications;
}

export interface LibrarySessionPortsActions {
  resetCloudState(facetsComplete: boolean): void;
  markCloudUnavailable(unavailable: boolean): void;
  refreshCloud(): void;
}

export interface LibrarySessionPortsBinding {
  ports: { session: LibrarySessionInputPorts };
  actions: LibrarySessionPortsActions;
  replace(options: LibrarySessionPortsOptions): void;
}

const EMPTY_STATS: LibrarySessionPortStats = {
  total: 0,
  reviewed: 0,
  easy: 0,
  good: 0,
  hard: 0,
  unrated: 0,
  bookmarked: 0,
  due: 0,
  legacyUnindexed: 0,
};

export function createLibrarySessionPortsBinding(
  initialOptions: LibrarySessionPortsOptions,
): LibrarySessionPortsBinding {
  let options = initialOptions;

  const session = {
    get ownerAdapter() { return options.ownerAdapter; },
    getPromotedCards: () => options.publications.promotedCards(),
  } satisfies LibrarySessionInputPorts;
  const ports = { session };
  const actions: LibrarySessionPortsActions = {
    resetCloudState: facetsComplete => {
      options.publications.cloud.facets({}, facetsComplete);
      options.publications.cloud.stats({ ...EMPTY_STATS });
      options.publications.cloud.total(0);
      options.publications.cloud.hasNextPage(false);
    },
    markCloudUnavailable: unavailable => options.publications.cloud.unavailable(unavailable),
    refreshCloud: () => options.publications.cloud.refresh(),
  };

  return {
    ports,
    actions,
    replace: nextOptions => { options = nextOptions; },
  };
}

export function useLibrarySessionPorts(options: LibrarySessionPortsOptions): {
  ports: { session: LibrarySessionInputPorts };
  actions: LibrarySessionPortsActions;
} {
  const bindingRef = useRef<LibrarySessionPortsBinding | null>(null);
  if (!bindingRef.current) bindingRef.current = createLibrarySessionPortsBinding(options);
  bindingRef.current.replace(options);
  return { ports: bindingRef.current.ports, actions: bindingRef.current.actions };
}
