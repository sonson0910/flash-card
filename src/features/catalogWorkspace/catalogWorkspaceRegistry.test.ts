import { describe, expect, it } from 'vitest';
import {
  CATALOG_LANGUAGE_REGISTRY,
  catalogReleaseManifestPath,
  getCatalogLanguage,
  resolveCatalogWorkspaceSelectionFromRegistry,
  resolveCatalogWorkspaceSelection,
} from './catalogWorkspaceRegistry';

describe('catalog workspace registry', () => {
  it('keeps every language unavailable until a validated release is registered', () => {
    const english = getCatalogLanguage('en');

    expect(english).toMatchObject({
      code: 'en',
      catalogId: null,
      releaseId: null,
      availability: 'unavailable',
    });
    expect(english.tracks.map(track => track.id)).toEqual(['ielts', 'toeic', 'general']);
    expect(english.tracks[0]?.tiers.map(tier => tier.id)).toEqual([
      'foundation',
      'core',
      'advanced',
    ]);
    expect(CATALOG_LANGUAGE_REGISTRY.filter(language => language.availability === 'unavailable'))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ code: 'ja', catalogId: null }),
        expect.objectContaining({ code: 'ko', catalogId: null }),
        expect.objectContaining({ code: 'zh', catalogId: null }),
      ]));
  });

  it('keeps known and unknown unsupported languages honest without falling back to English', () => {
    expect(resolveCatalogWorkspaceSelection('ja', 'ielts', 'foundation')).toMatchObject({
      languageCode: 'ja',
      catalogId: null,
      trackId: null,
      tierId: null,
      availability: 'unavailable',
    });
    expect(resolveCatalogWorkspaceSelection('xx', 'unknown', 'impossible')).toMatchObject({
      languageCode: 'xx',
      catalogId: null,
      trackId: null,
      tierId: null,
      availability: 'unavailable',
    });
  });

  it('does not derive a catalog slot without validated release metadata', () => {
    const selection = resolveCatalogWorkspaceSelection('en', 'general', 'core');

    expect(selection.catalogId).toBeNull();
    expect(selection).toMatchObject({ trackId: null, tierId: null, availability: 'unavailable' });
  });

  it('does not expose track or tier fallbacks for an unavailable release', () => {
    expect(resolveCatalogWorkspaceSelection('en', 'unknown', 'advanced')).toMatchObject({
      trackId: null,
      tierId: null,
    });
    expect(resolveCatalogWorkspaceSelection('en', 'toeic', 'unknown')).toMatchObject({
      trackId: null,
      tierId: null,
    });
  });

  it('threads an approved immutable release id into runtime selection and its manifest path', () => {
    const approvedRegistry = CATALOG_LANGUAGE_REGISTRY.map(language => language.code === 'en'
      ? { ...language, availability: 'available' as const, catalogId: 'english-core', releaseId: 'r-a1b2c3d4e5f60718293a4b5c' }
      : language);
    const selection = resolveCatalogWorkspaceSelectionFromRegistry(
      approvedRegistry, 'en', 'ielts', 'foundation',
    );

    expect(selection).toMatchObject({
      catalogId: 'english-core', releaseId: 'r-a1b2c3d4e5f60718293a4b5c', availability: 'available',
    });
    expect(catalogReleaseManifestPath(selection))
      .toBe('/catalog/english-core/r-a1b2c3d4e5f60718293a4b5c/release-manifest.json');
  });
});
