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
  /** Immutable content-derived release identity; null until validation and editorial gates pass. */
  readonly releaseId: string | null;
  readonly tracks: readonly CatalogTrackDefinition[];
}

export interface CatalogWorkspaceSelection {
  readonly languageCode: string;
  readonly catalogId: string | null;
  readonly releaseId: string | null;
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
    availability: 'unavailable',
    catalogId: null,
    releaseId: null,
    tracks: englishTracks,
  }),
  Object.freeze({
    code: 'ja',
    label: 'Japanese',
    nativeLabel: '日本語',
    availability: 'unavailable',
    catalogId: null,
    releaseId: null,
    tracks: Object.freeze([]),
  }),
  Object.freeze({
    code: 'ko',
    label: 'Korean',
    nativeLabel: '한국어',
    availability: 'unavailable',
    catalogId: null,
    releaseId: null,
    tracks: Object.freeze([]),
  }),
  Object.freeze({
    code: 'zh',
    label: 'Chinese',
    nativeLabel: '中文',
    availability: 'unavailable',
    catalogId: null,
    releaseId: null,
    tracks: Object.freeze([]),
  }),
]);

export const DEFAULT_CATALOG_LANGUAGE_CODE = 'en';
export const DEFAULT_CATALOG_TRACK_ID = 'ielts';
export const DEFAULT_CATALOG_TIER_ID: CatalogTierId = 'foundation';

const languageByCode = new Map(CATALOG_LANGUAGE_REGISTRY.map(language => [language.code, language]));

export function getCatalogLanguage(code: string): CatalogLanguageDefinition {
  const known = languageByCode.get(code);
  if (known) return known;
  const safeCode = /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/.test(code) ? code : 'und';
  return Object.freeze({
    code: safeCode,
    label: 'Unsupported language',
    nativeLabel: safeCode,
    availability: 'unavailable',
    catalogId: null,
    releaseId: null,
    tracks: Object.freeze([]),
  });
}

export function resolveCatalogWorkspaceSelectionFromRegistry(
  registry: readonly CatalogLanguageDefinition[],
  languageCode: string | null | undefined,
  trackId: string | null | undefined,
  tierId: string | null | undefined,
): CatalogWorkspaceSelection {
  const requestedCode = languageCode ?? DEFAULT_CATALOG_LANGUAGE_CODE;
  const language = registry.find(candidate => candidate.code === requestedCode)
    ?? getCatalogLanguage(requestedCode);
  if (language.availability === 'unavailable') {
    return {
      languageCode: language.code,
      catalogId: null,
      releaseId: null,
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
    releaseId: language.releaseId,
    trackId: track?.id ?? null,
    tierId: tier?.id ?? null,
    availability: language.availability,
  };
}

export function resolveCatalogWorkspaceSelection(
  languageCode: string | null | undefined,
  trackId: string | null | undefined,
  tierId: string | null | undefined,
): CatalogWorkspaceSelection {
  return resolveCatalogWorkspaceSelectionFromRegistry(
    CATALOG_LANGUAGE_REGISTRY, languageCode, trackId, tierId,
  );
}

export const catalogReleaseManifestPath = (
  selection: Pick<CatalogWorkspaceSelection, 'catalogId' | 'releaseId' | 'availability'>,
): string | null => selection.availability === 'available' && selection.catalogId && selection.releaseId
  ? `/catalog/${encodeURIComponent(selection.catalogId)}/${encodeURIComponent(selection.releaseId)}/release-manifest.json`
  : null;
