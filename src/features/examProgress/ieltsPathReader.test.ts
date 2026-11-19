import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  activateCatalogInstall,
  beginCatalogInstall,
  closeCatalogCacheForTests,
  stageCatalogChunk,
  type CatalogCacheEntry,
} from '../catalogCache/catalogCache';
import { readIeltsPathLexemeIds } from './ieltsPathReader';

const deleteDatabase = () => new Promise<void>((resolve, reject) => {
  const request = indexedDB.deleteDatabase('sonflash-catalog-cache');
  request.onsuccess = () => resolve();
  request.onerror = () => reject(request.error ?? new Error('Could not delete catalog cache.'));
  request.onblocked = () => reject(new Error('Catalog cache deletion was blocked.'));
});

const membership = (membershipId: string, lexemeId: string, trackId: string, rank: number, language = 'en'): CatalogCacheEntry => ({
  membershipId, lexemeId, language, trackId, tier: 'core', cefrLevel: 'B2', topic: 'education',
  partOfSpeech: 'noun', skills: ['reading'], rank, normalizedLemma: lexemeId, lemma: lexemeId,
});

const install = async (entries: readonly CatalogCacheEntry[]) => {
  const handle = await beginCatalogInstall({
    catalogId: 'english-core', releaseId: 'release-1', schemaVersion: 1, contentLanguage: 'en',
    chunkCount: 1, lexemeCount: 0, membershipCount: entries.length, encodedBytes: 128,
  });
  await stageCatalogChunk(handle, {
    chunkId: 'chunk-1', sha256: 'a'.repeat(64), lexemeCount: 0, membershipCount: entries.length, encodedBytes: 128,
  }, entries);
  await activateCatalogInstall(handle);
};

describe('IELTS path reader', () => {
  beforeEach(async () => {
    closeCatalogCacheForTests();
    await deleteDatabase();
  });

  it('returns null until a release is installed', async () => {
    await expect(readIeltsPathLexemeIds()).resolves.toBeNull();
  });

  it('reads the distinct IELTS lexemes of the active release in rank order', async () => {
    await install([
      membership('m-3', 'lexeme-c', 'ielts', 3),
      membership('m-1', 'lexeme-a', 'ielts', 1),
      membership('m-2', 'lexeme-b', 'ielts', 2),
      membership('m-4', 'lexeme-a', 'ielts', 4),
      membership('m-5', 'lexeme-x', 'toeic', 1),
      membership('m-6', 'lexeme-y', 'core', 1),
    ]);
    await expect(readIeltsPathLexemeIds()).resolves.toEqual(['lexeme-a', 'lexeme-b', 'lexeme-c']);
  });

  it('returns null when the release has no IELTS track', async () => {
    await install([membership('m-1', 'lexeme-a', 'toeic', 1)]);
    await expect(readIeltsPathLexemeIds()).resolves.toBeNull();
  });
});
