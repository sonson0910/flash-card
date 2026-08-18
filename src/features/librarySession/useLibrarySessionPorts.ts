import { useRef } from 'react';
import type { CardData } from '../../types/card';
import type { LibrarySessionInputPorts } from './useLibrarySession';
import type {
  OwnerLibraryCache,
  OwnerLibrarySessionAdapter,
} from './ownerLibrarySessionController';

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
  library: {
    replace(cards: CardData[]): void;
    advance(cardId: string, advance: (card: CardData) => CardData): void;
    remove(cardId: string): void;
  };
  practice: {
    find(cardId: string): CardData | undefined;
    advance(cardId: string, advance: (card: CardData) => CardData): void;
    remove(cardId: string): void;
  };
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
  feedback: {
    error(message: string): void;
    notice(message: string): void;
  };
  promotedCards(): readonly CardData[];
}

export interface LibrarySessionPortsOptions {
  ownerAdapter: OwnerLibrarySessionAdapter;
  ownerCache?: OwnerLibraryCache;
  publications: LibrarySessionPortPublications;
}

export interface LibrarySessionPortsActions {
  connectVerifiedEpoch(accept: (ownerId: string, epoch: number) => unknown): void;
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
  let acceptVerifiedEpoch: (ownerId: string, epoch: number) => unknown = () => false;

  const deviceEvents: LibrarySessionInputPorts['deviceEvents'] = {
    advanceCard: (cardId, advance) => options.publications.library.advance(cardId, advance),
    removeCard: cardId => options.publications.library.remove(cardId),
    findPracticeCard: cardId => options.publications.practice.find(cardId),
    advancePracticeCard: (cardId, advance) => options.publications.practice.advance(cardId, advance),
    removePracticeCard: cardId => options.publications.practice.remove(cardId),
    resetPage: () => options.publications.navigation.resetPage(),
    refreshCloud: () => options.publications.cloud.refresh(),
    setCloudAvailable: available => options.publications.cloud.unavailable(!available),
    setCloudTotal: total => options.publications.cloud.total(total),
    publishDeviceCards: cards => options.publications.library.replace(cards),
    publishDevicePage: (cards, total, hasNext) => {
      options.publications.library.replace(cards);
      options.publications.cloud.total(total);
      options.publications.cloud.hasNextPage(hasNext);
    },
    previousPage: () => options.publications.navigation.previousPage(),
    reportError: message => options.publications.feedback.error(message),
    notify: message => options.publications.feedback.notice(message),
    verifyEpoch: epoch => { acceptVerifiedEpoch(epoch.userId, epoch.value); },
  };

  const session = {
    get ownerAdapter() { return options.ownerAdapter; },
    get ownerCache() { return options.ownerCache; },
    deviceEvents,
    getPromotedCards: () => options.publications.promotedCards(),
  } satisfies LibrarySessionInputPorts;
  const ports = { session };
  const actions: LibrarySessionPortsActions = {
    connectVerifiedEpoch: accept => { acceptVerifiedEpoch = accept; },
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
