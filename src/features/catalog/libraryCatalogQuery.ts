export const LIBRARY_QUERY_KEYS = [
  'q',
  'category',
  'deck',
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
  deck: string;
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
    deck: boundedParam(params, 'deck', 'All', 128),
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
    deck: 'All',
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
  setOptionalParam(url.searchParams, 'deck', query.deck, 'All');
  setOptionalParam(url.searchParams, 'difficulty', query.difficulty, 'All');
  setOptionalParam(url.searchParams, 'pos', query.partOfSpeech, 'All');
  if (query.starred) url.searchParams.set('starred', '1');
  setOptionalParam(url.searchParams, 'date', query.date, 'All');
  if (query.page > 1) url.searchParams.set('page', String(query.page));
  return `${url.pathname}${url.search}${url.hash}`;
}
