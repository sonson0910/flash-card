import { createWordCardId, normalizeCardWord } from '../../lib/cardIdentity';
import { normalizePartOfSpeech } from '../../lib/cardQuery';
import type { CardData } from '../../types/card';
import type { CatalogVocabularyPresentation } from './catalogPresentation';

export type CatalogLibraryAddResult = {
  readonly status: 'created' | 'existing';
  readonly card: CardData;
  readonly cards: CardData[];
};

export interface CatalogOptimisticLibraryState {
  readonly ownerId: string | null;
  readonly ownerVersion: number;
  readonly addingCardIds: ReadonlySet<string>;
  readonly addedCardIds: ReadonlySet<string>;
  readonly failedCardIds: ReadonlySet<string>;
}

export interface CatalogLibraryAddToken {
  readonly ownerId: string | null;
  readonly ownerVersion: number;
  readonly cardId: string;
}

export const createCatalogOptimisticLibraryState = (
  ownerId: string | null,
  ownerVersion = 0,
): CatalogOptimisticLibraryState => ({
  ownerId,
  ownerVersion,
  addingCardIds: new Set(),
  addedCardIds: new Set(),
  failedCardIds: new Set(),
});

export const scopeCatalogOptimisticLibraryState = (
  state: CatalogOptimisticLibraryState,
  ownerId: string | null,
  ownerVersion = 0,
): CatalogOptimisticLibraryState => (
  state.ownerId === ownerId && state.ownerVersion === ownerVersion
    ? state
    : createCatalogOptimisticLibraryState(ownerId, ownerVersion)
);

export function beginCatalogLibraryAdd(
  state: CatalogOptimisticLibraryState,
  ownerId: string | null,
  ownerVersion: number,
  cardId: string,
): { readonly state: CatalogOptimisticLibraryState; readonly token: CatalogLibraryAddToken } {
  const scoped = scopeCatalogOptimisticLibraryState(state, ownerId, ownerVersion);
  const failedCardIds = new Set(scoped.failedCardIds);
  failedCardIds.delete(cardId);
  return {
    state: {
      ...scoped,
      addingCardIds: new Set(scoped.addingCardIds).add(cardId),
      failedCardIds,
    },
    token: { ownerId, ownerVersion, cardId },
  };
}

export function settleCatalogLibraryAdd(
  state: CatalogOptimisticLibraryState,
  activeOwnerId: string | null,
  activeOwnerVersion: number,
  token: CatalogLibraryAddToken,
  result: 'created' | 'existing' | 'failed',
): CatalogOptimisticLibraryState {
  const scoped = scopeCatalogOptimisticLibraryState(state, activeOwnerId, activeOwnerVersion);
  if (token.ownerId !== activeOwnerId || token.ownerVersion !== activeOwnerVersion) return scoped;
  const addingCardIds = new Set(scoped.addingCardIds);
  addingCardIds.delete(token.cardId);
  const addedCardIds = new Set(scoped.addedCardIds);
  const failedCardIds = new Set(scoped.failedCardIds);
  if (result === 'created' || result === 'existing') addedCardIds.add(token.cardId);
  if (result === 'failed') failedCardIds.add(token.cardId);
  else failedCardIds.delete(token.cardId);
  return { ...scoped, addingCardIds, addedCardIds, failedCardIds };
}

export function catalogEntryToLibraryCard(
  entry: CatalogVocabularyPresentation,
  createdAt = new Date().toISOString(),
): CardData {
  const word = normalizeCardWord(entry.lemma);
  return {
    id: createWordCardId(word),
    word,
    normalizedWord: word,
    translation: entry.translation?.trim() || entry.meaning.trim(),
    explanation: entry.meaning.trim(),
    phonetic: entry.phonetic?.trim() ?? '',
    emoji: '📚',
    category: entry.topics[0]?.trim() || 'Catalog',
    audioUrl: null,
    imageUrl: null,
    createdAt,
    customDeck: null,
    difficulty: 'unrated',
    bookmarked: false,
    reviews: 0,
    correctStreak: 0,
    partOfSpeech: normalizePartOfSpeech(entry.partOfSpeech),
    cefrLevel: entry.cefr,
    exampleSentence: entry.example,
    exampleTranslation: entry.exampleTranslation,
    collocations: [...entry.collocations],
  };
}

export function mergeCatalogEntryIntoLibrary(
  cards: readonly CardData[],
  entry: CatalogVocabularyPresentation,
  createdAt = new Date().toISOString(),
): CatalogLibraryAddResult {
  const normalizedWord = normalizeCardWord(entry.lemma);
  const existing = cards.find(card => normalizeCardWord(card.normalizedWord || card.word) === normalizedWord);
  if (existing) return { status: 'existing', card: existing, cards: [...cards] };
  const card = catalogEntryToLibraryCard(entry, createdAt);
  return { status: 'created', card, cards: [card, ...cards] };
}

export const createCatalogLibraryIdentityIndex = (
  cards: readonly CardData[],
): ReadonlySet<string> => new Set(
  cards.map(card => normalizeCardWord(card.normalizedWord || card.word)),
);

export const catalogEntryIsInLibrary = (
  libraryIdentityIndex: ReadonlySet<string>,
  entry: Pick<CatalogVocabularyPresentation, 'lemma'>,
): boolean => libraryIdentityIndex.has(normalizeCardWord(entry.lemma));
