import {
  resolveCatalogWorkspaceSelection,
  type CatalogTierId,
} from './catalogWorkspaceRegistry';

export const CATALOG_WORKSPACE_QUERY_KEYS = [
  'view',
  'catalog',
  'lang',
  'track',
  'tier',
  'cefr',
  'topic',
  'pos',
  'skill',
  'term',
  'cursor',
] as const;

export interface CatalogWorkspaceQuery {
  readonly view: 'catalog';
  readonly catalogId: string | null;
  readonly languageCode: string;
  readonly trackId: string | null;
  readonly tier: CatalogTierId | null;
  readonly cefrLevel: string | null;
  readonly topic: string | null;
  readonly partOfSpeech: string | null;
  readonly skill: string | null;
  readonly term: string;
  /** Release-bound paging state is deliberately transient and never serialized. */
  readonly cursor: string | null;
}

export type CatalogWorkspaceQueryPatch = Partial<Omit<CatalogWorkspaceQuery, 'view' | 'catalogId'>>;

const CEFR_LEVELS = new Set(['A1', 'A2', 'B1', 'B2', 'C1', 'C2']);
const MAXIMUM_CURSOR_LENGTH = 4_096;

const bounded = (value: string | null | undefined, maximum: number): string | null => {
  if (value === null || value === undefined || value.length === 0 || value.length > maximum) return null;
  return value;
};

const boundedTerm = (value: string | null | undefined): string => {
  if (value === null || value === undefined || value.length > 100) return '';
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ');
};

const boundedCursor = (value: string | null | undefined): string | null => (
  value && value.length <= MAXIMUM_CURSOR_LENGTH ? value : null
);

const searchParamsOf = (location: string): URLSearchParams => (
  new URL(location, 'https://sonflash.invalid').searchParams
);

const normalizeQuery = ({
  languageCode,
  trackId,
  tier,
  cefrLevel,
  topic,
  partOfSpeech,
  skill,
  term,
  cursor,
}: Omit<CatalogWorkspaceQuery, 'view' | 'catalogId'>): CatalogWorkspaceQuery => {
  const selection = resolveCatalogWorkspaceSelection(
    bounded(languageCode, 35),
    bounded(trackId, 64),
    bounded(tier, 32),
  );
  const safeCefr = bounded(cefrLevel, 8);
  return {
    view: 'catalog',
    catalogId: selection.catalogId,
    languageCode: selection.languageCode,
    trackId: selection.trackId,
    tier: selection.tierId,
    cefrLevel: safeCefr && CEFR_LEVELS.has(safeCefr) ? safeCefr : null,
    topic: bounded(topic, 128),
    partOfSpeech: bounded(partOfSpeech, 64),
    skill: bounded(skill, 64),
    term: boundedTerm(term),
    cursor: boundedCursor(cursor),
  };
};

export function readCatalogWorkspaceQuery(location: string): CatalogWorkspaceQuery {
  const params = searchParamsOf(location);
  return normalizeQuery({
    languageCode: params.get('lang') ?? 'en',
    trackId: params.get('track'),
    tier: params.get('tier') as CatalogTierId | null,
    cefrLevel: params.get('cefr'),
    topic: params.get('topic'),
    partOfSpeech: params.get('pos'),
    skill: params.get('skill'),
    term: params.get('term') ?? '',
    cursor: null,
  });
}

const setOptional = (params: URLSearchParams, key: string, value: string | null): void => {
  if (value) params.set(key, value);
};

export function createCatalogWorkspaceLocation(
  currentLocation: string,
  input: CatalogWorkspaceQuery,
): string {
  const query = normalizeQuery(input);
  const url = new URL(currentLocation, 'https://sonflash.invalid');
  CATALOG_WORKSPACE_QUERY_KEYS.forEach(key => url.searchParams.delete(key));
  url.searchParams.set('view', 'catalog');
  setOptional(url.searchParams, 'catalog', query.catalogId);
  url.searchParams.set('lang', query.languageCode);
  setOptional(url.searchParams, 'track', query.trackId);
  setOptional(url.searchParams, 'tier', query.tier);
  setOptional(url.searchParams, 'cefr', query.cefrLevel);
  setOptional(url.searchParams, 'topic', query.topic);
  setOptional(url.searchParams, 'pos', query.partOfSpeech);
  setOptional(url.searchParams, 'skill', query.skill);
  setOptional(url.searchParams, 'term', query.term);
  return `${url.pathname}${url.search}${url.hash}`;
}

export function patchCatalogWorkspaceQuery(
  current: CatalogWorkspaceQuery,
  patch: CatalogWorkspaceQueryPatch,
): CatalogWorkspaceQuery {
  const changesPagingOnly = Object.keys(patch).every(key => key === 'cursor');
  return normalizeQuery({
    languageCode: patch.languageCode ?? current.languageCode,
    trackId: patch.trackId === undefined ? current.trackId : patch.trackId,
    tier: patch.tier === undefined ? current.tier : patch.tier,
    cefrLevel: patch.cefrLevel === undefined ? current.cefrLevel : patch.cefrLevel,
    topic: patch.topic === undefined ? current.topic : patch.topic,
    partOfSpeech: patch.partOfSpeech === undefined ? current.partOfSpeech : patch.partOfSpeech,
    skill: patch.skill === undefined ? current.skill : patch.skill,
    term: patch.term === undefined ? current.term : patch.term,
    cursor: changesPagingOnly ? patch.cursor ?? null : null,
  });
}
