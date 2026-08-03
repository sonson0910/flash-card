import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  activateCatalogInstall,
  beginCatalogInstall,
  closeCatalogCacheForTests,
  stageCatalogChunk,
  type CatalogCacheEntry,
} from './catalogCache';
import { queryCatalogCache } from './catalogIndex';

const deleteDatabase = () => new Promise<void>((resolve, reject) => {
  const request = indexedDB.deleteDatabase('sonflash-catalog-cache');
  request.onsuccess = () => resolve();
  request.onerror = () => reject(request.error);
  request.onblocked = () => reject(new Error('Catalog cache deletion was blocked.'));
});

const item = (index: number, overrides: Partial<CatalogCacheEntry> = {}): CatalogCacheEntry => ({
  membershipId: `membership-${String(index).padStart(4, '0')}`,
  lexemeId: `lexeme-${index}`,
  language: 'en',
  trackId: 'ielts',
  tier: index % 2 === 0 ? 'foundation' : 'core',
  cefrLevel: index % 3 === 0 ? 'B1' : 'B2',
  topic: index % 5 === 0 ? 'work' : 'education',
  partOfSpeech: index % 7 === 0 ? 'verb' : 'noun',
  skills: index % 11 === 0 ? ['reading', 'listening'] : ['reading'],
  rank: index,
  normalizedLemma: `word-${String(index).padStart(4, '0')}`,
  lemma: `Word ${index}`,
  ...overrides,
});

const install = async (items: readonly CatalogCacheEntry[]) => {
  const chunkCount = Math.ceil(items.length / 100);
  const handle = await beginCatalogInstall({
    catalogId: 'english-core', releaseId: 'release-1', schemaVersion: 1, contentLanguage: 'en',
    chunkCount, membershipCount: items.length, encodedBytes: chunkCount * 128,
  });
  for (let offset = 0; offset < items.length; offset += 100) {
    const chunk = items.slice(offset, offset + 100);
    await stageCatalogChunk(handle, {
      chunkId: `chunk-${String(offset / 100).padStart(4, '0')}`,
      sha256: String(offset / 100).padStart(64, 'a').slice(-64),
      membershipCount: chunk.length,
      encodedBytes: 128,
    }, chunk);
  }
  await activateCatalogInstall(handle);
};

describe('catalog cache indexed query', () => {
  beforeEach(async () => {
    closeCatalogCacheForTests();
    await deleteDatabase();
  });

  it('combines track, tier, CEFR, topic, POS, skill, rank and lemma-prefix filters', async () => {
    await install([
      item(1),
      item(2, {
        tier: 'core', cefrLevel: 'B2', topic: 'work', partOfSpeech: 'verb',
        skills: ['reading', 'listening'], normalizedLemma: 'allocate', lemma: 'Allocate', rank: 20,
      }),
      item(3, { trackId: 'toeic', normalizedLemma: 'allocate', rank: 20 }),
    ]);

    const result = await queryCatalogCache({
      catalogId: 'english-core', language: 'en', trackId: 'ielts', tier: 'core', cefrLevel: 'B2',
      topic: 'work', partOfSpeech: 'verb', skill: 'listening', normalizedLemmaPrefix: ' allo ',
      minimumRank: 10, maximumRank: 30, pageSize: 10,
    });

    expect(result.items).toEqual([expect.objectContaining({ lemma: 'Allocate', membershipId: 'membership-0002' })]);
    expect(result.scanned).toBeLessThanOrEqual(3);
  });

  it('returns stable rank pages using an opaque cursor and never scans beyond the cap', async () => {
    await install(Array.from({ length: 900 }, (_, index) => item(index)));

    const first = await queryCatalogCache({
      catalogId: 'english-core', language: 'en', trackId: 'ielts', pageSize: 20, scanLimit: 50,
    });
    const second = await queryCatalogCache({
      catalogId: 'english-core', language: 'en', trackId: 'ielts', pageSize: 20,
      scanLimit: 50, cursor: first.nextCursor,
    });

    expect(first.items).toHaveLength(20);
    expect(second.items).toHaveLength(20);
    expect(second.items[0]?.rank).toBe(20);
    expect(first.scanned).toBe(20);
    expect(second.scanned).toBe(20);
    expect(new Set([...first.items, ...second.items].map(value => value.membershipId)).size).toBe(40);
  });

  it('bounds sparse combined-filter scans instead of walking the full active release', async () => {
    await install(Array.from({ length: 900 }, (_, index) => item(index)));

    const result = await queryCatalogCache({
      catalogId: 'english-core', language: 'en', trackId: 'ielts', tier: 'foundation',
      topic: 'missing-topic', pageSize: 20, scanLimit: 40,
    });

    expect(result.items).toEqual([]);
    expect(result.scanned).toBe(40);
    expect(result.hasMore).toBe(true);
    expect(result.nextCursor).toBeTruthy();
  });

  it('binds an opaque cursor to the complete filter set', async () => {
    await install(Array.from({ length: 30 }, (_, index) => item(index)));
    const first = await queryCatalogCache({
      catalogId: 'english-core', language: 'en', trackId: 'ielts',
      normalizedLemmaPrefix: 'word-', topic: 'education', pageSize: 5,
    });

    await expect(queryCatalogCache({
      catalogId: 'english-core', language: 'en', trackId: 'ielts',
      normalizedLemmaPrefix: 'word-', topic: 'work', pageSize: 5, cursor: first.nextCursor,
    })).rejects.toThrow('invalid');
  });
});
