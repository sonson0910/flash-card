import type { CardData } from '../../types/card';
import type { LanguageProfile } from '../language/languageProfile';

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
  /** Active course's language pair; falls back to English-Vietnamese when there is no active course yet (legacy user). */
  languageProfile?: LanguageProfile;
  libraryEpoch: number | null;
  knownLibraryTotal: number;
  cloudStats: CardIntakeCloudStats;
  cardsPerPage: number;
  getCards(): CardData[];
  publishCards(cards: CardData[]): void;
  patchCard(cardId: string, fields: Partial<CardData>, source?: CardData): Promise<void>;
  hydrateExisting(card: CardData): void;
  rememberPromoted(card: CardData): void;
  resetCatalog(): void;
  resetCloudPage(): void;
  updateCloudStats(update: (current: CardIntakeCloudStats) => CardIntakeCloudStats): void;
  updateCloudTotal(update: (current: number) => number): void;
  updateCategoryFacets(deltas: Record<string, number>, operationId?: string): Promise<void>;
  setCloudUnavailable(unavailable: boolean): void;
  notify(message: string): void;
  focusLibrary(): void;
  addXp(amount: number): void;
}
