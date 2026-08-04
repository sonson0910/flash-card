export const ENGLISH_CATALOG_ID = 'english-core';

export type CatalogLanguageAvailability = 'available' | 'unavailable';
export type CatalogTierId = 'foundation' | 'core' | 'advanced';

export interface CatalogTierDefinition {
  readonly id: CatalogTierId;
  readonly label: string;
  readonly cefrRange: string;
}

export interface CatalogTrackDefinition {
  readonly id: 'ielts' | 'toeic' | 'general' | (string & {});
  readonly label: string;
  readonly description: string;
  readonly tiers: readonly CatalogTierDefinition[];
}

export interface CatalogLanguageDefinition {
  readonly code: string;
  readonly label: string;
  readonly nativeLabel: string;
  readonly availability: CatalogLanguageAvailability;
  /** Stable cache/install slot; it is not evidence that a reviewed release exists. */
  readonly catalogId: string | null;
  readonly tracks: readonly CatalogTrackDefinition[];
}

export interface CatalogWorkspaceSelection {
  readonly languageCode: string;
  readonly catalogId: string | null;
  readonly trackId: string | null;
  readonly tierId: CatalogTierId | null;
  readonly availability: CatalogLanguageAvailability;
}

const TIERS: readonly CatalogTierDefinition[] = Object.freeze([
  Object.freeze({ id: 'foundation', label: 'Foundation', cefrRange: 'A1–A2' }),
  Object.freeze({ id: 'core', label: 'Core', cefrRange: 'B1–B2' }),
  Object.freeze({ id: 'advanced', label: 'Advanced', cefrRange: 'C1–C2' }),
]);

const englishTracks: readonly CatalogTrackDefinition[] = Object.freeze([
  Object.freeze({
    id: 'ielts',
    label: 'IELTS',
    description: 'Academic and general IELTS vocabulary from foundation to advanced.',
    tiers: TIERS,
  }),
  Object.freeze({
    id: 'toeic',
    label: 'TOEIC',
    description: 'Workplace and everyday TOEIC vocabulary from foundation to advanced.',
    tiers: TIERS,
  }),
  Object.freeze({
    id: 'general',
    label: 'General',
    description: 'General-purpose English vocabulary from foundation to advanced.',
    tiers: TIERS,
  }),
]);

export const CATALOG_LANGUAGE_REGISTRY: readonly CatalogLanguageDefinition[] = Object.freeze([
  Object.freeze({
    code: 'en',
    label: 'English',
    nativeLabel: 'English',
    availability: 'available',
    catalogId: ENGLISH_CATALOG_ID,
    tracks: englishTracks,
  }),
  Object.freeze({
    code: 'ja',
    label: 'Japanese',
    nativeLabel: '日本語',
    availability: 'unavailable',
    catalogId: null,
    tracks: Object.freeze([]),
  }),
  Object.freeze({
    code: 'ko',
    label: 'Korean',
    nativeLabel: '한국어',
    availability: 'unavailable',
    catalogId: null,
    tracks: Object.freeze([]),
  }),
  Object.freeze({
    code: 'zh',
    label: 'Chinese',
    nativeLabel: '中文',
    availability: 'unavailable',
    catalogId: null,
    tracks: Object.freeze([]),
  }),
]);

export const DEFAULT_CATALOG_LANGUAGE_CODE = 'en';
export const DEFAULT_CATALOG_TRACK_ID = 'ielts';
export const DEFAULT_CATALOG_TIER_ID: CatalogTierId = 'foundation';

const languageByCode = new Map(CATALOG_LANGUAGE_REGISTRY.map(language => [language.code, language]));

export function getCatalogLanguage(code: string): CatalogLanguageDefinition {
  return languageByCode.get(code) ?? languageByCode.get(DEFAULT_CATALOG_LANGUAGE_CODE)!;
}

export function resolveCatalogWorkspaceSelection(
  languageCode: string | null | undefined,
  trackId: string | null | undefined,
  tierId: string | null | undefined,
): CatalogWorkspaceSelection {
  const language = getCatalogLanguage(languageCode ?? DEFAULT_CATALOG_LANGUAGE_CODE);
  if (language.availability === 'unavailable') {
    return {
      languageCode: language.code,
      catalogId: null,
      trackId: null,
      tierId: null,
      availability: language.availability,
    };
  }

  const track = language.tracks.find(candidate => candidate.id === trackId)
    ?? language.tracks.find(candidate => candidate.id === DEFAULT_CATALOG_TRACK_ID)
    ?? language.tracks[0];
  const tier = track?.tiers.find(candidate => candidate.id === tierId)
    ?? track?.tiers.find(candidate => candidate.id === DEFAULT_CATALOG_TIER_ID)
    ?? track?.tiers[0];

  return {
    languageCode: language.code,
    catalogId: language.catalogId,
    trackId: track?.id ?? null,
    tierId: tier?.id ?? null,
    availability: language.availability,
  };
}
