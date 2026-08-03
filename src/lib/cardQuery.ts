import type { CardData } from '../types/card';
import { isCardDue } from './srs';
import { normalizeCardWord } from './cardIdentity';

export const CLOUD_PAGE_SIZE = 9;

export interface CardQueryState {
  category: string | null;
  customDeck: string | null | 'unassigned';
  difficulty: 'easy' | 'good' | 'hard' | 'unrated' | 'due' | null;
  partOfSpeech: string | null;
  bookmarkedOnly: boolean;
  createdDate: string | null;
  wordPrefix: string;
}

export const PART_OF_SPEECH_OPTIONS = [
  { value: 'noun', label: 'Noun' },
  { value: 'verb', label: 'Verb' },
  { value: 'adjective', label: 'Adjective' },
  { value: 'adverb', label: 'Adverb' },
  { value: 'pronoun', label: 'Pronoun' },
  { value: 'preposition', label: 'Preposition' },
  { value: 'conjunction', label: 'Conjunction' },
  { value: 'determiner', label: 'Determiner' },
  { value: 'interjection', label: 'Interjection' },
  { value: 'phrasal verb', label: 'Phrasal verb' },
  { value: 'auxiliary verb', label: 'Auxiliary verb' },
  { value: 'modal verb', label: 'Modal verb' },
  { value: 'article', label: 'Article' },
  { value: 'numeral', label: 'Numeral' },
  { value: 'idiom', label: 'Idiom' },
  { value: 'phrase', label: 'Phrase' },
] as const;

export function normalizePartOfSpeech(value: unknown): string {
  if (typeof value !== 'string') return '';
  const normalized = value.trim().toLocaleLowerCase('en-US').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').slice(0, 64);
  if (!normalized) return '';
  if (/\bphrasal\s+verb\b/.test(normalized)) return 'phrasal verb';
  if (/\bauxiliary\s+verb\b/.test(normalized)) return 'auxiliary verb';
  if (/\bmodal\s+verb\b/.test(normalized)) return 'modal verb';
  for (const option of PART_OF_SPEECH_OPTIONS) {
    if (new RegExp(`\\b${option.value.replace(' ', '\\s+')}\\b`).test(normalized)) return option.value;
  }
  return normalized;
}

export interface VisiblePage<T> {
  items: T[];
  hasNext: boolean;
}

export interface LocalCardPage {
  items: CardData[];
  total: number;
  hasNext: boolean;
}

export function createPage<T>(documents: T[], pageSize = CLOUD_PAGE_SIZE): VisiblePage<T> {
  return {
    items: documents.slice(0, pageSize),
    hasNext: documents.length > pageSize,
  };
}

export function calculateTotalPages(total: number, pageSize: number, currentPage: number, hasNext: boolean): number {
  const safePageSize = Math.max(1, Math.floor(pageSize) || 1);
  const safeCurrentPage = Math.max(1, Math.floor(currentPage) || 1);
  const pagesFromCount = Math.max(1, Math.ceil(Math.max(0, total) / safePageSize));
  return Math.max(pagesFromCount, safeCurrentPage + (hasNext ? 1 : 0));
}

export function normalizePrefixSearch(value: string): string {
  return normalizeCardWord(value);
}

export function prioritizePracticeCards<T extends { id: string }>(dueCards: T[], fallbackCards: T[], maximum: number): T[] {
  const seen = new Set<string>();
  const prioritized: T[] = [];
  for (const card of [...dueCards, ...fallbackCards]) {
    if (seen.has(card.id)) continue;
    seen.add(card.id);
    prioritized.push(card);
    if (prioritized.length >= maximum) break;
  }
  return prioritized;
}

export function cardMatchesQuery(card: CardData, filters: CardQueryState): boolean {
  if (filters.category && card.category !== filters.category) return false;
  if (filters.partOfSpeech && normalizePartOfSpeech(card.partOfSpeech) !== filters.partOfSpeech) return false;
  if (filters.customDeck === 'unassigned' && card.customDeck) return false;
  if (filters.customDeck && filters.customDeck !== 'unassigned' && card.customDeck !== filters.customDeck) return false;
  if (filters.difficulty && filters.difficulty !== 'due') {
    const difficulty = card.difficulty || 'unrated';
    if (difficulty !== filters.difficulty) return false;
  }
  if (filters.difficulty === 'due' && !isCardDue(card)) return false;
  if (filters.bookmarkedOnly && card.bookmarked !== true) return false;
  if (filters.createdDate && card.createdAt?.slice(0, 10) !== filters.createdDate) return false;
  if (filters.wordPrefix) {
    const normalizedWord = (card.normalizedWord || card.word).trim().toLocaleLowerCase('en-US');
    if (!normalizedWord.startsWith(filters.wordPrefix.trim().toLocaleLowerCase('en-US'))) return false;
  }
  return true;
}

export function cardActivityTimestamp(card: Pick<CardData, 'createdAt' | 'lastOpenedAt' | 'sortTouchedAt'>): string {
  const fallback = new Date(0).toISOString();
  const candidates = [card.sortTouchedAt, card.lastOpenedAt, card.createdAt];
  return candidates.find(value => {
    if (!value) return false;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed);
  }) ?? fallback;
}

export function sortCardsByActivity(cards: readonly CardData[]): CardData[] {
  return cards
    .map((card, index) => ({ card, index, timestamp: Date.parse(cardActivityTimestamp(card)) }))
    .sort((left, right) => right.timestamp - left.timestamp || left.index - right.index)
    .map(({ card }) => card);
}

export function createLocalCardPage(
  cards: CardData[],
  filters: CardQueryState,
  page: number,
  pageSize = CLOUD_PAGE_SIZE,
): LocalCardPage | null {
  const matchingCards = sortCardsByActivity(cards.filter(card => cardMatchesQuery(card, filters)));
  if (matchingCards.length === 0) return null;
  const safePage = Math.max(1, Math.floor(page) || 1);
  const startIndex = (safePage - 1) * pageSize;
  const pageItems = matchingCards.slice(startIndex, startIndex + pageSize);
  if (pageItems.length === 0) return null;
  return {
    items: pageItems,
    total: matchingCards.length,
    hasNext: startIndex + pageSize < matchingCards.length,
  };
}

export function createDailyPracticePivot(userId: string, now = new Date()): string {
  const day = now.toISOString().slice(0, 10);
  const source = `${userId}:${day}`;
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let state = hash >>> 0;
  let pivot = '';
  for (let index = 0; index < 20; index += 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    pivot += alphabet[state % alphabet.length];
  }
  return pivot;
}

export function queryStateKey(state: CardQueryState): string {
  return JSON.stringify({
    ...state,
    wordPrefix: normalizePrefixSearch(state.wordPrefix),
  });
}
