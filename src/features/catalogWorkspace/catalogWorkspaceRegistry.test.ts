import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  CATALOG_LANGUAGE_REGISTRY,
  catalogReleaseManifestPath,
  getCatalogLanguage,
  resolveCatalogWorkspaceSelectionFromRegistry,
  resolveCatalogWorkspaceSelection,
} from './catalogWorkspaceRegistry';

describe('catalog workspace registry', () => {
  it('registers only the approved English tiers while other languages remain unavailable', () => {
    const english = getCatalogLanguage('en');

    expect(english).toMatchObject({
      code: 'en',
      catalogId: 'english-core',
      releaseId: 'r-261124da6107eb25204587aa',
      availability: 'available',
    });
    expect(english.tracks.map(track => track.id)).toEqual(['ielts', 'toeic', 'general']);
    expect(english.tracks.map(track => track.tiers.map(tier => tier.id)))
      .toEqual([['advanced'], ['core'], ['foundation']]);
    const path = catalogReleaseManifestPath(resolveCatalogWorkspaceSelection('en', 'ielts', null));
    if (path === null) throw new Error('Approved English catalog requires a manifest path.');
    const release = JSON.parse(readFileSync(new URL(`../../../public${path}`, import.meta.url), 'utf8')) as {
      catalogId: string; releaseId: string; unitDescriptors: readonly { trackId: string; tier: string }[];
    };
    expect(release).toMatchObject({ catalogId: english.catalogId, releaseId: english.releaseId });
    expect(release.unitDescriptors).toHaveLength(45);
    expect(release.unitDescriptors.map(unit => `${unit.trackId}:${unit.tier}`)).toEqual([
      ...Array(15).fill('general:foundation'),
      ...Array(15).fill('ielts:advanced'),
      ...Array(15).fill('toeic:core'),
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

  it('falls back to the actual tier available for each English track', () => {
    const selection = resolveCatalogWorkspaceSelection('en', 'general', 'core');

    expect(selection).toMatchObject({
      catalogId: 'english-core', trackId: 'general', tierId: 'foundation', availability: 'available',
    });
    expect(resolveCatalogWorkspaceSelection('en', 'ielts', 'foundation').tierId).toBe('advanced');
    expect(resolveCatalogWorkspaceSelection('en', 'toeic', 'advanced').tierId).toBe('core');
  });

  it('does not expose track or tier fallbacks for an unavailable release', () => {
    expect(resolveCatalogWorkspaceSelection('ja', 'unknown', 'advanced'))
      .toMatchObject({ trackId: null, tierId: null });
    expect(resolveCatalogWorkspaceSelection('ko', 'toeic', 'unknown'))
      .toMatchObject({ trackId: null, tierId: null });
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
