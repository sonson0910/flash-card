import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createLexemeId } from '../multilingual/lexemeIdentity';
import type { LexemeV3 } from '../multilingual/schemaV3';
import {
  activateCatalogInstall,
  beginCatalogInstall,
  closeCatalogCacheForTests,
  getActiveCatalogRelease,
  stageCatalogChunk,
  type CatalogCacheEntry,
} from './catalogCache';
import { queryCatalogCache, readCatalogCachePage } from './catalogIndex';
import { assessCatalogPerformance } from '../releaseReadiness/catalogPerformanceGate';

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

const contentLexeme = (releaseId: string, meaning: string): LexemeV3 => {
  const identity = {
    language: 'en', normalizedLemma: 'allocate', partOfSpeech: 'verb', senseKey: 'assign-resource',
  };
  return {
    schemaVersion: 3,
    id: createLexemeId(identity),
    ...identity,
    lemma: 'Allocate',
    definitions: [{ language: 'vi', text: meaning }],
    phonetics: [],
    examples: [{ text: `Example from ${releaseId}.`, translations: [] }],
    collocations: [],
    wordFamily: [],
    media: { audioUrl: null, imageUrl: null },
    compatibility: {
      legacyPartOfSpeech: 'verb', translation: meaning, explanation: '', explanationTranslation: '',
      emoji: '', exampleSentence: `Example from ${releaseId}.`, exampleTranslation: '', synonyms: [],
      antonyms: [], register: '', commonMistake: '',
    },
    provenance: {
      source: 'licensed-editorial', license: 'CC-BY-4.0', reviewer: 'reviewer-1',
      editorialStatus: 'published',
    },
    contentVersion: releaseId === 'release-a' ? 1 : 2,
    createdAt: '2026-08-03T00:00:00.000Z',
    updatedAt: '2026-08-03T00:00:00.000Z',
  };
};

const stageContentRelease = async (releaseId: string, meaning: string) => {
  const lexeme = contentLexeme(releaseId, meaning);
  const membership = item(releaseId === 'release-a' ? 1 : 2, {
    membershipId: `membership-${releaseId}`,
    lexemeId: lexeme.id,
    normalizedLemma: lexeme.normalizedLemma,
    lemma: lexeme.lemma,
    partOfSpeech: lexeme.partOfSpeech,
    rank: 1,
  });
  const handle = await beginCatalogInstall({
    catalogId: 'english-core', releaseId, schemaVersion: 1, contentLanguage: 'en',
    chunkCount: 1, lexemeCount: 1, membershipCount: 1, encodedBytes: 128,
  });
  await stageCatalogChunk(handle, {
    chunkId: `chunk-${releaseId}`, sha256: 'a'.repeat(64), lexemeCount: 1,
    membershipCount: 1, encodedBytes: 128,
  }, [membership], [lexeme]);
  return handle;
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

  it('returns membership and lexeme content from one release while activation races the page read', async () => {
    const releaseA = await stageContentRelease('release-a', 'nghĩa từ bản A');
    await activateCatalogInstall(releaseA);
    const releaseB = await stageContentRelease('release-b', 'nghĩa từ bản B');

    const reading = readCatalogCachePage({
      catalogId: 'english-core', language: 'en', trackId: 'ielts', pageSize: 10,
    });
    const activating = activateCatalogInstall(releaseB);
    const [page] = await Promise.all([reading, activating]);
    const first = page.items[0];

    expect(first).toBeDefined();
    expect([
      ['membership-release-a', 'nghĩa từ bản A'],
      ['membership-release-b', 'nghĩa từ bản B'],
    ]).toContainEqual([
      first?.membership.membershipId,
      first?.lexeme.definitions[0]?.text,
    ]);
  });

  it('does not expose a staged release before activation', async () => {
    await stageContentRelease('release-a', 'nghĩa đang staging');

    await expect(readCatalogCachePage({
      catalogId: 'english-core', language: 'en', trackId: 'ielts', pageSize: 10,
    })).resolves.toEqual({ items: [], scanned: 0, hasMore: false, nextCursor: null });
  });

  it('rejects a page cursor after the active release changes', async () => {
    const releaseA = await stageContentRelease('release-a', 'nghĩa từ bản A');
    await activateCatalogInstall(releaseA);
    const first = await readCatalogCachePage({
      catalogId: 'english-core', language: 'en', trackId: 'ielts', pageSize: 1,
    });
    const releaseB = await stageContentRelease('release-b', 'nghĩa từ bản B');
    await activateCatalogInstall(releaseB);

    expect(first.nextCursor).toBeTruthy();
    await expect(readCatalogCachePage({
      catalogId: 'english-core', language: 'en', trackId: 'ielts', pageSize: 1,
      cursor: first.nextCursor,
    })).rejects.toThrow(/another release/);
  });

  it('returns stable rank pages using an opaque cursor and never scans beyond the cap', async () => {
    await install(Array.from({ length: 900 }, (_, index) => item(index)));

    const first = await queryCatalogCache({
      catalogId: 'english-core', language: 'en', trackId: 'ielts', pageSize: 20, scanLimit: 50,
    });
    const openCursor = vi.spyOn(IDBIndex.prototype, 'openCursor');
    const second = await queryCatalogCache({
      catalogId: 'english-core', language: 'en', trackId: 'ielts', pageSize: 20,
      scanLimit: 50, cursor: first.nextCursor,
    });

    expect(first.items).toHaveLength(20);
    expect(second.items).toHaveLength(20);
    expect(second.items[0]?.rank).toBe(20);
    expect(first.scanned).toBe(20);
    expect(second.scanned).toBe(20);
    const resumedRange = openCursor.mock.calls.at(-1)?.[0] as IDBKeyRange;
    expect(resumedRange.lowerOpen).toBe(true);
    expect(resumedRange.lower).not.toEqual([
      'english-core:release-1', 'en', 'ielts', 0, '',
    ]);
    expect(new Set([...first.items, ...second.items].map(value => value.membershipId)).size).toBe(40);
  });

  it('bounds sparse combined-filter scans across the 10,000-record release limit', async () => {
    await install(Array.from({ length: 10_000 }, (_, index) => item(index)));

    const openStarted = performance.now();
    await getActiveCatalogRelease('english-core');
    const cachedOpenMs = performance.now() - openStarted;
    const queryStarted = performance.now();
    const result = await queryCatalogCache({
      catalogId: 'english-core', language: 'en', trackId: 'ielts', tier: 'foundation',
      topic: 'missing-topic', pageSize: 20, scanLimit: 40,
    });
    const indexedQueryMs = performance.now() - queryStarted;

    expect(result.items).toEqual([]);
    expect(result.scanned).toBe(40);
    expect(result.hasMore).toBe(true);
    expect(result.nextCursor).toBeTruthy();
    expect(assessCatalogPerformance({
      itemCount: 10_000, cachedOpenMs, indexedQueryMs, scanned: result.scanned,
    }), JSON.stringify({ cachedOpenMs, indexedQueryMs })).toEqual({ status: 'passed', reasons: [] });
  }, 30_000);

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

  it('rejects oversized lemma prefixes and cursors before opening IndexedDB', async () => {
    await expect(queryCatalogCache({
      catalogId: 'english-core', language: 'en', trackId: 'ielts',
      normalizedLemmaPrefix: 'a'.repeat(257),
    })).rejects.toThrow(/normalizedLemmaPrefix/);

    await expect(queryCatalogCache({
      catalogId: 'english-core', language: 'en', trackId: 'ielts',
      cursor: 'a'.repeat(4_097),
    })).rejects.toThrow(/cursor/i);
  });
});
