import type { CardData } from '../../types/card';
import type { LibraryReplicaIntakePort } from '../librarySession/libraryReplicaIntakeContract';

export interface CardIntakeCloudStats {
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

export interface CardIntakePortOptions {
  ownerId: string | null;
  libraryEpoch: number | null;
  knownLibraryTotal: number;
  cloudStats: CardIntakeCloudStats;
  cardsPerPage: number;
  getCards(): CardData[];
  publishCards(cards: CardData[]): void;
  libraryReplica: LibraryReplicaIntakePort;
  patchCard(cardId: string, fields: Partial<CardData>, source?: CardData): Promise<void>;
  hydrateExisting(card: CardData): void;
  rememberPromoted(card: CardData): void;
  resetCatalog(): void;
  resetCloudPage(): void;
  updateCloudStats(update: (current: CardIntakeCloudStats) => CardIntakeCloudStats): void;
  updateCloudTotal(update: (current: number) => number): void;
  updateCategoryFacets(deltas: Record<string, number>): Promise<void>;
  setCloudUnavailable(unavailable: boolean): void;
  notify(message: string): void;
  focusLibrary(): void;
  addXp(amount: number): void;
}
