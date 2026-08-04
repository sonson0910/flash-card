import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  activateCatalogInstall,
  beginCatalogInstall,
  closeCatalogCacheForTests,
  stageCatalogChunk,
  type CatalogCacheEntry,
} from './catalogCache';
import { summarizeActiveCatalog } from './catalogSummary';

const DATABASE_NAME = 'sonflash-catalog-cache';

const deleteDatabase = () => new Promise<void>((resolve, reject) => {
  const request = indexedDB.deleteDatabase(DATABASE_NAME);
  request.onsuccess = () => resolve();
  request.onerror = () => reject(request.error ?? new Error('Could not delete catalog cache.'));
  request.onblocked = () => reject(new Error('Catalog cache deletion was blocked.'));
});

const membership = (
  membershipId: string,
  lexemeId: string,
  trackId: string,
  tier: string,
  overrides: Partial<CatalogCacheEntry> = {},
): CatalogCacheEntry => ({
  membershipId,
  lexemeId,
  language: 'en',
  trackId,
  tier,
  cefrLevel: 'A2',
  topic: 'education',
  partOfSpeech: 'noun',
  skills: ['reading'],
  rank: 1,
  normalizedLemma: lexemeId,
  lemma: lexemeId,
  ...overrides,
});

const install = async (entries: readonly CatalogCacheEntry[], releaseId = 'release-1') => {
  const handle = await beginCatalogInstall({
    catalogId: 'english-core',
    releaseId,
    schemaVersion: 1,
    contentLanguage: 'en',
    chunkCount: 1,
    lexemeCount: 0,
    membershipCount: entries.length,
    encodedBytes: 128,
  });
  await stageCatalogChunk(handle, {
    chunkId: 'chunk-1',
    sha256: 'a'.repeat(64),
    lexemeCount: 0,
    membershipCount: entries.length,
    encodedBytes: 128,
  }, entries);
  await activateCatalogInstall(handle);
};

describe('active catalog summary', () => {
  beforeEach(async () => {
    closeCatalogCacheForTests();
    await deleteDatabase();
  });

  it('aggregates release-scoped track, tier and facet counts from at most 10,000 memberships', async () => {
    await install([
      membership('m1', 'lexeme-1', 'ielts', 'foundation'),
      membership('m2', 'lexeme-2', 'ielts', 'core', {
        cefrLevel: 'B2', topic: 'work', partOfSpeech: 'verb', skills: ['writing', 'reading'], rank: 2,
      }),
      membership('m3', 'lexeme-3', 'toeic', 'foundation', {
        cefrLevel: null, topic: 'work', partOfSpeech: 'verb', skills: ['listening'], rank: 3,
      }),
    ]);

    const result = await summarizeActiveCatalog('english-core', new Map([
      ['lexeme-1', 'started'],
      ['lexeme-2', 'mastered'],
      ['not-in-release', 'mastered'],
    ]));

    expect(result?.release.releaseId).toBe('release-1');
    expect(result?.scannedMemberships).toBe(3);
    expect(result?.tracks).toEqual([
      {
        trackId: 'ielts', total: 2, started: 2, mastered: 1,
        tiers: [
          { tier: 'core', total: 1, started: 1, mastered: 1 },
          { tier: 'foundation', total: 1, started: 1, mastered: 0 },
        ],
        facets: {
          cefrLevels: ['A2', 'B2'], topics: ['education', 'work'],
          partsOfSpeech: ['noun', 'verb'], skills: ['reading', 'writing'],
        },
      },
      {
        trackId: 'toeic', total: 1, started: 0, mastered: 0,
        tiers: [{ tier: 'foundation', total: 1, started: 0, mastered: 0 }],
        facets: {
          cefrLevels: [], topics: ['work'], partsOfSpeech: ['verb'], skills: ['listening'],
        },
      },
    ]);
  });

  it('returns null without a complete active release and rejects unvalidated progress input', async () => {
    await expect(summarizeActiveCatalog('english-core', new Map())).resolves.toBeNull();

    await install([membership('m1', 'lexeme-1', 'ielts', 'foundation')]);
    await expect(summarizeActiveCatalog(
      'english-core',
      new Map([['lexeme-1', 'complete' as 'started']]),
    )).rejects.toThrow(/learning status/i);
    await expect(summarizeActiveCatalog(
      'english-core',
      new Map(Array.from({ length: 10_001 }, (_, index) => [`lexeme-${index}`, 'started'] as const)),
    )).rejects.toThrow(/10,000/);
  });

  it('does not mix an older release into an active replacement summary', async () => {
    await install([membership('old', 'old-lexeme', 'ielts', 'foundation')], 'release-1');
    await install([membership('new', 'new-lexeme', 'toeic', 'advanced')], 'release-2');

    const result = await summarizeActiveCatalog('english-core', new Map());

    expect(result?.release.releaseId).toBe('release-2');
    expect(result?.tracks.map(track => track.trackId)).toEqual(['toeic']);
    expect(result?.scannedMemberships).toBe(1);
  });
});
