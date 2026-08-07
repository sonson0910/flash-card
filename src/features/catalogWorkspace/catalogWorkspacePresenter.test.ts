import { describe, expect, it } from 'vitest';
import type { HydratedCatalogEntry } from '../catalogCache/catalogCache';
import type { CatalogWorkspaceSummary } from '../catalogCache/catalogSummary';
import { readCatalogWorkspaceQuery } from './catalogWorkspaceQuery';
import {
  catalogCacheQueryFromWorkspaceQuery,
  catalogFiltersFromSummary,
  catalogTiersFromSummary,
  catalogTracksFromSummary,
  presentHydratedCatalogEntry,
} from './catalogWorkspacePresenter';

const summary: CatalogWorkspaceSummary = {
  release: {
    catalogId: 'english-core', releaseId: 'reviewed-1', schemaVersion: 1,
    contentLanguage: 'en', chunkCount: 1, lexemeCount: 1, membershipCount: 2,
    encodedBytes: 200,
  },
  scannedMemberships: 2,
  tracks: [{
    trackId: 'ielts', total: 2, started: 1, mastered: 1,
    tiers: [
      { tier: 'foundation', total: 1, started: 1, mastered: 1 },
      { tier: 'core', total: 1, started: 0, mastered: 0 },
    ],
    facets: {
      cefrLevels: ['A2', 'B2'], topics: ['education'],
      partsOfSpeech: ['noun'], skills: ['reading'],
    },
  }],
};

describe('catalog workspace presenter', () => {
  it('maps every combined filter into a bounded indexed cache query', () => {
    const query = {
      ...readCatalogWorkspaceQuery(
        '/?view=catalog&lang=en&cefr=B2&topic=education&pos=noun&skill=reading&term=Learn',
      ),
      catalogId: 'english-core',
      trackId: 'ielts',
      tier: 'core',
    } as const;

    expect(catalogCacheQueryFromWorkspaceQuery(query, 'opaque-cursor')).toEqual({
      catalogId: 'english-core', language: 'en', trackId: 'ielts', tier: 'core',
      cefrLevel: 'B2', topic: 'education', partOfSpeech: 'noun', skill: 'reading',
      normalizedLemmaPrefix: 'Learn', cursor: 'opaque-cursor', pageSize: 20, scanLimit: 250,
    });
  });

  it('creates honest track, tier and facet presentation from the active release summary', () => {
    expect(catalogTracksFromSummary(summary)).toEqual([
      expect.objectContaining({ id: 'ielts', total: 2, started: 1, mastered: 1 }),
      expect.objectContaining({ id: 'toeic', total: 0, started: 0, mastered: 0 }),
      expect.objectContaining({ id: 'general', total: 0, started: 0, mastered: 0 }),
    ]);
    expect(catalogTiersFromSummary(summary, 'ielts')).toEqual([
      expect.objectContaining({ id: 'foundation', total: 1, state: 'completed' }),
      expect.objectContaining({ id: 'core', total: 1, state: 'available' }),
      expect.objectContaining({ id: 'advanced', total: 0, state: 'available' }),
    ]);
    expect(catalogFiltersFromSummary(summary, 'ielts')).toMatchObject({
      cefrOptions: [{ value: 'A2', label: 'A2' }, { value: 'B2', label: 'B2' }],
      topicOptions: [{ value: 'education', label: 'Education' }],
      partOfSpeechOptions: [{ value: 'noun', label: 'Noun' }],
      skillOptions: [{ value: 'reading', label: 'Reading' }],
    });
  });

  it('hydrates full published Lexeme content and provenance without inventing fields', () => {
    const hydrated = {
      membership: {
        membershipId: 'm-1', lexemeId: 'lexeme-analyse', language: 'en', trackId: 'ielts',
        tier: 'core', cefrLevel: 'B2', topic: 'education', partOfSpeech: 'verb',
        skills: ['reading'], rank: 1, normalizedLemma: 'analyse', lemma: 'analyse',
      },
      lexeme: {
        schemaVersion: 3, id: 'lexeme-analyse', language: 'en', lemma: 'analyse',
        normalizedLemma: 'analyse', partOfSpeech: 'verb', senseKey: 'analyse-1',
        definitions: [
          { language: 'en', text: 'examine something carefully' },
          { language: 'vi', text: 'phân tích' },
        ],
        phonetics: ['/ˈænəlaɪz/'],
        examples: [{
          text: 'Researchers analyse the results.',
          translations: [{ language: 'vi', text: 'Các nhà nghiên cứu phân tích kết quả.' }],
        }],
        collocations: ['analyse data'], wordFamily: [],
        media: { audioUrl: null, imageUrl: null },
        compatibility: {
          legacyPartOfSpeech: 'verb', translation: 'phân tích', explanation: '',
          explanationTranslation: '', emoji: '', exampleSentence: '', exampleTranslation: '',
          synonyms: [], antonyms: [], register: '', commonMistake: '',
        },
        provenance: {
          source: 'Editorial source', license: 'CC BY 4.0', reviewer: 'Reviewer A',
          editorialStatus: 'published',
        },
        contentVersion: 1, createdAt: '2026-08-04T00:00:00.000Z',
        updatedAt: '2026-08-04T00:00:00.000Z',
      },
    } satisfies HydratedCatalogEntry;

    expect(presentHydratedCatalogEntry(hydrated)).toMatchObject({
      id: 'lexeme-analyse', lemma: 'analyse', meaning: 'examine something carefully',
      meaningLanguage: 'en', translation: 'phân tích', translationLanguage: 'vi',
      example: 'Researchers analyse the results.',
      exampleTranslation: 'Các nhà nghiên cứu phân tích kết quả.',
      collocations: ['analyse data'], topics: ['Education'], skills: ['Reading'],
      provenance: {
        sourceLabel: 'Editorial source', licenseLabel: 'CC BY 4.0', reviewerLabel: 'Reviewer A',
      },
    });
  });
});
