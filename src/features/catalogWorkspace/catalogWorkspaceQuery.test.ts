import { describe, expect, it } from 'vitest';
import {
  createCatalogWorkspaceLocation,
  patchCatalogWorkspaceQuery,
  readCatalogWorkspaceQuery,
} from './catalogWorkspaceQuery';

describe('catalog workspace URL state', () => {
  it('retains bounded filters but strips an unregistered catalog selection from untrusted URL state', () => {
    const query = readCatalogWorkspaceQuery(
      '?view=catalog&catalog=english-core&lang=en&track=toeic&tier=core&cefr=B2'
      + '&topic=workplace&pos=noun&skill=listening&term=%20annual%20report%20',
    );

    expect(query).toEqual({
      view: 'catalog',
      catalogId: null,
      releaseId: null,
      languageCode: 'en',
      trackId: null,
      tier: null,
      cefrLevel: 'B2',
      topic: 'workplace',
      partOfSpeech: 'noun',
      skill: 'listening',
      term: 'annual report',
      cursor: null,
    });
  });

  it('retains a known unavailable language but never assigns it a catalog or track', () => {
    expect(readCatalogWorkspaceQuery('?view=catalog&lang=ja&track=ielts&tier=advanced'))
      .toMatchObject({
        languageCode: 'ja',
        catalogId: null,
        trackId: null,
        tier: null,
      });
  });

  it('rejects overlong and invalid values without silently falling back to English', () => {
    const query = readCatalogWorkspaceQuery(
      `?view=catalog&catalog=https://evil.example/catalog&lang=xx&track=unknown&tier=invalid&cefr=Z9&topic=${'x'.repeat(129)}`
      + `&pos=${'p'.repeat(65)}&skill=${'s'.repeat(65)}&term=${'t'.repeat(101)}`,
    );

    expect(query).toMatchObject({
      catalogId: null,
      languageCode: 'xx',
      trackId: null,
      tier: null,
      cefrLevel: null,
      topic: null,
      partOfSpeech: null,
      skill: null,
      term: '',
      cursor: null,
    });
  });

  it('writes canonical state while preserving unrelated parameters and the hash', () => {
    const query = readCatalogWorkspaceQuery(
      '?view=catalog&lang=en&track=ielts&tier=foundation&topic=education&utm_source=audit',
    );
    const location = createCatalogWorkspaceLocation(
      'https://sonflash.example/?share=deck-1&utm_source=audit&lang=old#catalog-heading',
      query,
    );
    const url = new URL(location, 'https://sonflash.example');

    expect(url.searchParams.get('view')).toBe('catalog');
    expect(url.searchParams.get('catalog')).toBeNull();
    expect(url.searchParams.get('lang')).toBe('en');
    expect(url.searchParams.get('track')).toBeNull();
    expect(url.searchParams.get('tier')).toBeNull();
    expect(url.searchParams.get('topic')).toBe('education');
    expect(url.searchParams.get('share')).toBe('deck-1');
    expect(url.searchParams.get('utm_source')).toBe('audit');
    expect(url.hash).toBe('#catalog-heading');
  });

  it('omits empty optional filters and never serializes the opaque paging cursor', () => {
    const query = {
      ...readCatalogWorkspaceQuery('?view=catalog&lang=en'),
      cursor: 'opaque-release-bound-cursor',
    };
    const location = createCatalogWorkspaceLocation('/?topic=old&term=old&cursor=old', query);
    const params = new URL(location, 'https://sonflash.invalid').searchParams;

    expect(params.has('topic')).toBe(false);
    expect(params.has('term')).toBe(false);
    expect(params.has('cursor')).toBe(false);
  });

  it('resets cursor on every filter or selection change and cascades language availability', () => {
    const current = {
      ...readCatalogWorkspaceQuery('?view=catalog&lang=en&track=ielts&tier=core'),
      cursor: 'opaque',
    };

    expect(patchCatalogWorkspaceQuery(current, { topic: 'education' }).cursor).toBeNull();
    expect(patchCatalogWorkspaceQuery(current, { trackId: 'toeic' })).toMatchObject({
      trackId: null,
      tier: null,
      cursor: null,
    });
    expect(patchCatalogWorkspaceQuery(current, { languageCode: 'ja' })).toMatchObject({
      languageCode: 'ja',
      catalogId: null,
      trackId: null,
      tier: null,
      cursor: null,
    });
  });
});
