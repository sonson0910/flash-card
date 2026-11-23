import type { CardQueryState } from '../../lib/cardQuery';
import {
  ALL_PRACTICE_DECK_SCOPE,
  practiceDeckScopeForLibraryDeck,
  type PracticeDeckScope,
} from '../../lib/practiceScope';

export const LIBRARY_QUERY_KEYS = [
  'q',
  'category',
  'deck',
  'deckKind',
  'difficulty',
  'pos',
  'starred',
  'date',
  'page',
] as const;

export type LibraryDifficulty = 'All' | 'due' | 'easy' | 'good' | 'hard' | 'learning' | 'unrated' | 'mastered';

export interface LibraryCatalogQuery {
  search: string;
  category: string;
  deck: PracticeDeckScope;
  difficulty: LibraryDifficulty;
  partOfSpeech: string;
  starred: boolean;
  date: string;
  page: number;
}

const allowedDifficulties = new Set<LibraryDifficulty>([
  'All',
  'due',
  'easy',
  'good',
  'hard',
  'learning',
  'unrated',
  'mastered',
]);

/**
 * The "mastered" tier (the Star tier on Progress and in Vocabulary) is the stored rating Easy:
 * `difficulty == 'easy'`. That is the field the cloud count behind Progress "All N" counts and the
 * one equality filter Firestore can serve from the existing `difficulty` index, so a mastered page
 * costs exactly what an Easy page costs and its total matches N. The grid's Star badge also treats
 * an interval of 21 days or more as mastered; that heuristic needs a disjunctive query and is not
 * part of this filter.
 */
export const MASTERED_CARD_DIFFICULTY = 'easy' as const;

/**
 * The card query difficulty that serves a Vocabulary filter value, `null` for no filter. The "learning" tier
 * is the stored ratings Good and Hard together, served by one `in` filter over the same `difficulty` index,
 * so the page, its total and the page count all follow it instead of narrowing a loaded page.
 */
export function cardQueryDifficulty(difficulty: LibraryDifficulty): CardQueryState['difficulty'] {
  if (difficulty === 'All') return null;
  if (difficulty === 'mastered') return MASTERED_CARD_DIFFICULTY;
  return difficulty;
}

function boundedParam(params: URLSearchParams, key: string, fallback: string, limit: number): string {
  return (params.get(key) ?? fallback).slice(0, limit);
}

function readDeckScope(params: URLSearchParams): PracticeDeckScope {
  const deck = boundedParam(params, 'deck', 'All', 128);
  return params.get('deckKind') === 'custom'
    ? { kind: 'deck', name: deck }
    : practiceDeckScopeForLibraryDeck(deck);
}

export function readLibraryQuery(search: string): LibraryCatalogQuery {
  const params = new URLSearchParams(search);
  const page = Number.parseInt(params.get('page') ?? '1', 10);
  const requestedDifficulty = params.get('difficulty') ?? 'All';
  const difficulty = allowedDifficulties.has(requestedDifficulty as LibraryDifficulty)
    ? requestedDifficulty as LibraryDifficulty
    : 'All';

  return {
    search: boundedParam(params, 'q', '', 256),
    category: boundedParam(params, 'category', 'All', 128),
    deck: readDeckScope(params),
    difficulty,
    partOfSpeech: boundedParam(params, 'pos', 'All', 64),
    starred: params.get('starred') === '1',
    date: boundedParam(params, 'date', 'All', 64),
    page: Number.isFinite(page) && page > 0 ? page : 1,
  };
}

export function normalizeLibraryQuery(query: LibraryCatalogQuery): LibraryCatalogQuery {
  if (!query.search && query.difficulty !== 'due') return query;

  return {
    ...query,
    category: 'All',
    deck: ALL_PRACTICE_DECK_SCOPE,
    difficulty: query.search ? 'All' : query.difficulty,
    partOfSpeech: 'All',
    starred: false,
    date: 'All',
  };
}

function setOptionalParam(
  params: URLSearchParams,
  key: string,
  value: string,
  defaultValue: string,
): void {
  if (value && value !== defaultValue) params.set(key, value);
}

export function createLibraryLocation(
  currentLocation: string,
  query: LibraryCatalogQuery,
): string {
  const url = new URL(currentLocation, 'https://sonflash.invalid');
  LIBRARY_QUERY_KEYS.forEach(key => url.searchParams.delete(key));
  setOptionalParam(url.searchParams, 'q', query.search.trim(), '');
  setOptionalParam(url.searchParams, 'category', query.category, 'All');
  if (query.deck.kind !== 'all') {
    const deck = query.deck.kind === 'unassigned' ? 'Unassigned' : query.deck.name;
    url.searchParams.set('deck', deck);
    if (query.deck.kind === 'deck' && (deck === 'All' || deck === 'Unassigned')) {
      url.searchParams.set('deckKind', 'custom');
    }
  }
  setOptionalParam(url.searchParams, 'difficulty', query.difficulty, 'All');
  setOptionalParam(url.searchParams, 'pos', query.partOfSpeech, 'All');
  if (query.starred) url.searchParams.set('starred', '1');
  setOptionalParam(url.searchParams, 'date', query.date, 'All');
  if (query.page > 1) url.searchParams.set('page', String(query.page));
  return `${url.pathname}${url.search}${url.hash}`;
}
