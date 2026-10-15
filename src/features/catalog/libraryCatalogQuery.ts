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

export type LibraryDifficulty = 'All' | 'due' | 'easy' | 'good' | 'hard' | 'unrated';

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
  'unrated',
]);

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
