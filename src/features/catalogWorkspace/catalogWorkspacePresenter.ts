import type { HydratedCatalogEntry } from '../catalogCache/catalogCache';
import type { CatalogCacheQuery } from '../catalogCache/catalogIndex';
import type { CatalogWorkspaceSummary } from '../catalogCache/catalogSummary';
import type {
  CatalogFilterOption,
  CatalogFilterPresentation,
  CatalogTierPresentation,
  CatalogTrackPresentation,
  CatalogVocabularyPresentation,
} from './catalogPresentation';
import type { CatalogWorkspaceQuery } from './catalogWorkspaceQuery';
import {
  CATALOG_LANGUAGE_REGISTRY,
  getCatalogLanguage,
  type CatalogTierId,
} from './catalogWorkspaceRegistry';

export const CATALOG_PAGE_SIZE = 20;
export const CATALOG_SCAN_LIMIT = 250;

const presentLabel = (value: string): string => (
  value.replace(/[-_]+/g, ' ').replace(/\b\p{L}/gu, character => character.toLocaleUpperCase())
);

const options = (values: readonly string[]): CatalogFilterOption[] => (
  values.map(value => ({ value, label: presentLabel(value) }))
);

export function catalogCacheQueryFromWorkspaceQuery(
  query: CatalogWorkspaceQuery,
  cursor: string | null = query.cursor,
): CatalogCacheQuery {
  if (!query.catalogId || !query.trackId) {
    throw new TypeError('An available catalog and track are required before querying vocabulary.');
  }
  return {
    catalogId: query.catalogId,
    language: query.languageCode,
    trackId: query.trackId,
    ...(query.tier ? { tier: query.tier } : {}),
    ...(query.cefrLevel ? { cefrLevel: query.cefrLevel } : {}),
    ...(query.topic ? { topic: query.topic } : {}),
    ...(query.partOfSpeech ? { partOfSpeech: query.partOfSpeech } : {}),
    ...(query.skill ? { skill: query.skill } : {}),
    ...(query.term ? { normalizedLemmaPrefix: query.term } : {}),
    cursor,
    pageSize: CATALOG_PAGE_SIZE,
    scanLimit: CATALOG_SCAN_LIMIT,
  };
}

export const catalogLanguagesPresentation = () => CATALOG_LANGUAGE_REGISTRY.map(language => ({
  code: language.code,
  label: language.label,
  nativeLabel: language.nativeLabel,
  isAvailable: language.availability === 'available',
}));

const trackSummary = (summary: CatalogWorkspaceSummary, trackId: string) => (
  summary.tracks.find(track => track.trackId === trackId)
);

export function catalogTracksFromSummary(summary: CatalogWorkspaceSummary): CatalogTrackPresentation[] {
  return getCatalogLanguage(summary.release.contentLanguage).tracks
    .filter((track): track is typeof track & { id: CatalogTrackPresentation['id'] } => (
      track.id === 'ielts' || track.id === 'toeic' || track.id === 'general'
    ))
    .map(track => {
      const progress = trackSummary(summary, track.id);
      return {
        id: track.id,
        label: track.label,
        description: track.description,
        total: progress?.total ?? 0,
        started: progress?.started ?? 0,
        mastered: progress?.mastered ?? 0,
      };
    });
}

const tierDescription: Record<CatalogTierId, string> = {
  foundation: 'Build essential language from A1 to A2.',
  core: 'Grow a confident working range from B1 to B2.',
  advanced: 'Use precise and nuanced language from C1 to C2.',
};

export function catalogTiersFromSummary(
  summary: CatalogWorkspaceSummary,
  trackId: string,
): CatalogTierPresentation[] {
  const language = getCatalogLanguage(summary.release.contentLanguage);
  const definition = language.tracks.find(track => track.id === trackId) ?? language.tracks[0];
  const progress = trackSummary(summary, trackId);
  return (definition?.tiers ?? []).map(tier => {
    const count = progress?.tiers.find(candidate => candidate.tier === tier.id);
    const total = count?.total ?? 0;
    const started = count?.started ?? 0;
    const mastered = count?.mastered ?? 0;
    return {
      id: tier.id,
      label: `${tier.label} · ${tier.cefrRange}`,
      description: tierDescription[tier.id],
      total,
      started,
      mastered,
      state: total > 0 && mastered === total
        ? 'completed'
        : started > 0 ? 'in-progress' : 'available',
    };
  });
}

export function catalogFiltersFromSummary(
  summary: CatalogWorkspaceSummary,
  trackId: string,
  query?: CatalogWorkspaceQuery,
): CatalogFilterPresentation {
  const facets = trackSummary(summary, trackId)?.facets;
  return {
    term: query?.term ?? '',
    cefr: query?.cefrLevel ?? '',
    topic: query?.topic ?? '',
    partOfSpeech: query?.partOfSpeech ?? '',
    skill: query?.skill ?? '',
    cefrOptions: options(facets?.cefrLevels ?? []),
    topicOptions: options(facets?.topics ?? []),
    partOfSpeechOptions: options(facets?.partsOfSpeech ?? []),
    skillOptions: options(facets?.skills ?? []),
    hasActiveFilters: Boolean(
      query?.term || query?.cefrLevel || query?.topic || query?.partOfSpeech || query?.skill,
    ),
  };
}

export function presentHydratedCatalogEntry(
  entry: HydratedCatalogEntry,
): CatalogVocabularyPresentation {
  const { membership, lexeme } = entry;
  const meaning = lexeme.definitions.find(value => value.language === lexeme.language)
    ?? lexeme.definitions[0];
  const translation = lexeme.definitions.find(value => value.language !== lexeme.language);
  const example = lexeme.examples[0];
  const exampleTranslation = example?.translations.find(value => value.language !== lexeme.language)
    ?? example?.translations[0];
  return {
    id: lexeme.id,
    lemma: lexeme.lemma,
    language: lexeme.language,
    phonetic: lexeme.phonetics[0],
    partOfSpeech: lexeme.partOfSpeech,
    cefr: membership.cefrLevel ?? 'Not set',
    tier: presentLabel(membership.tier),
    topics: [presentLabel(membership.topic)],
    skills: membership.skills.map(presentLabel),
    meaning: meaning?.text ?? 'Definition unavailable.',
    meaningLanguage: meaning?.language ?? lexeme.language,
    translation: translation?.text,
    translationLanguage: translation?.language,
    example: example?.text,
    exampleTranslation: exampleTranslation?.text,
    collocations: [...lexeme.collocations],
    provenance: {
      sourceLabel: lexeme.provenance.source,
      licenseLabel: lexeme.provenance.license,
      reviewerLabel: lexeme.provenance.reviewer,
    },
    libraryState: 'available',
  };
}
