import { describe, expect, it } from 'vitest';
import {
  CATALOG_LANGUAGE_REGISTRY,
  ENGLISH_CATALOG_ID,
  getCatalogLanguage,
  resolveCatalogWorkspaceSelection,
} from './catalogWorkspaceRegistry';

describe('catalog workspace registry', () => {
  it('exposes English tracks and tier metadata without claiming future catalogs exist', () => {
    const english = getCatalogLanguage('en');

    expect(english).toMatchObject({
      code: 'en',
      catalogId: ENGLISH_CATALOG_ID,
      availability: 'available',
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

  it('keeps a known unavailable language honest and falls unknown values back to English', () => {
    expect(resolveCatalogWorkspaceSelection('ja', 'ielts', 'foundation')).toMatchObject({
      languageCode: 'ja',
      catalogId: null,
      trackId: null,
      tierId: null,
      availability: 'unavailable',
    });
    expect(resolveCatalogWorkspaceSelection('xx', 'unknown', 'impossible')).toMatchObject({
      languageCode: 'en',
      catalogId: ENGLISH_CATALOG_ID,
      trackId: 'ielts',
      tierId: 'foundation',
      availability: 'available',
    });
  });

  it('derives the trusted catalog slot from registry metadata instead of caller input', () => {
    const selection = resolveCatalogWorkspaceSelection('en', 'general', 'core');

    expect(selection.catalogId).toBe(ENGLISH_CATALOG_ID);
    expect(selection).toMatchObject({ trackId: 'general', tierId: 'core' });
  });

  it('falls invalid English track and tier values back deterministically', () => {
    expect(resolveCatalogWorkspaceSelection('en', 'unknown', 'advanced')).toMatchObject({
      trackId: 'ielts',
      tierId: 'advanced',
    });
    expect(resolveCatalogWorkspaceSelection('en', 'toeic', 'unknown')).toMatchObject({
      trackId: 'toeic',
      tierId: 'foundation',
    });
  });
});
