import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createLexemeId } from '../multilingual/lexemeIdentity';
import type { LexemeV3 } from '../multilingual/schemaV3';
import {
  activateCatalogInstall,
  beginCatalogInstall,
  CATALOG_STORE,
  closeCatalogCacheForTests,
  getActiveCatalogRelease,
  getActiveCatalogReleaseKey,
  getCatalogInstallStatus,
  getCatalogLexemes,
  hydrateCatalogEntries,
  ENTRY_STORE,
  LEXEME_STORE,
  openCatalogCacheDatabase,
  RECEIPT_STORE,
  RELEASE_STORE,
  rollbackCatalogRelease,
  SKILL_STORE,
  stageCatalogChunk,
  type CatalogCacheEntry,
  type CatalogReleaseDescriptor,
} from './catalogCache';

const DATABASE_NAME = 'sonflash-catalog-cache';

const deleteDatabase = () => new Promise<void>((resolve, reject) => {
  const request = indexedDB.deleteDatabase(DATABASE_NAME);
  request.onsuccess = () => resolve();
  request.onerror = () => reject(request.error ?? new Error('Could not delete catalog cache.'));
  request.onblocked = () => reject(new Error('Catalog cache deletion was blocked.'));
});

const openSchemaV2Database = () => new Promise<IDBDatabase>((resolve, reject) => {
  const request = indexedDB.open(DATABASE_NAME, 2);
  request.onupgradeneeded = () => {
    const database = request.result;
    database.createObjectStore('catalogs', { keyPath: 'catalogId' });
    const releases = database.createObjectStore('releases', { keyPath: 'releaseKey' });
    releases.createIndex('catalogId', 'catalogId');
    const receipts = database.createObjectStore('chunk-receipts', { keyPath: 'receiptKey' });
    receipts.createIndex('releaseKey', 'releaseKey');
    const entries = database.createObjectStore('entries', { keyPath: 'entryKey' });
    entries.createIndex('releaseKey', 'releaseKey');
    entries.createIndex('releaseLanguageTrackRank', ['releaseKey', 'language', 'trackId', 'rank', 'membershipId']);
    entries.createIndex('releaseLanguageTrackTierRank', ['releaseKey', 'language', 'trackId', 'tier', 'rank', 'membershipId']);
    entries.createIndex('releaseLanguageTrackCefrRank', ['releaseKey', 'language', 'trackId', 'cefrLevel', 'rank', 'membershipId']);
    entries.createIndex('releaseLanguageTrackTopicRank', ['releaseKey', 'language', 'trackId', 'topic', 'rank', 'membershipId']);
    entries.createIndex('releaseLanguageTrackPosRank', ['releaseKey', 'language', 'trackId', 'partOfSpeech', 'rank', 'membershipId']);
    entries.createIndex('releaseLanguageTrackLemma', ['releaseKey', 'language', 'trackId', 'normalizedLemma', 'rank', 'membershipId']);
    const skills = database.createObjectStore('skill-postings', { keyPath: 'postingKey' });
    skills.createIndex('releaseKey', 'releaseKey');
    skills.createIndex('releaseLanguageTrackSkillRank', ['releaseKey', 'language', 'trackId', 'skill', 'rank', 'membershipId']);
  };
  request.onerror = () => reject(request.error);
  request.onsuccess = () => {
    resolve(request.result);
  };
});

const createSchemaV2Database = async () => {
  const database = await openSchemaV2Database();
  database.close();
};

const descriptor = (
  releaseId: string,
  membershipCount = 1,
  chunkCount = 1,
): CatalogReleaseDescriptor => ({
  catalogId: 'english-core',
  releaseId,
  schemaVersion: 1,
  contentLanguage: 'en',
  chunkCount,
  membershipCount,
  encodedBytes: chunkCount * 128,
  lexemeCount: 0,
});

const entry = (id: string, overrides: Partial<CatalogCacheEntry> = {}): CatalogCacheEntry => ({
  membershipId: id,
  lexemeId: `lexeme-${id}`,
  language: 'en',
  trackId: 'ielts',
  tier: 'foundation',
  cefrLevel: 'A2',
  topic: 'education',
  partOfSpeech: 'noun',
  skills: ['reading'],
  rank: 1,
  normalizedLemma: `word-${id}`,
  lemma: `Word ${id}`,
  ...overrides,
});

const catalogLexeme = (release: string, meaning: string): LexemeV3 => {
  const identity = {
    language: 'en', normalizedLemma: 'allocate', partOfSpeech: 'verb', senseKey: 'assign-resource',
  };
  return {
    schemaVersion: 3,
    id: createLexemeId(identity),
    ...identity,
    lemma: 'Allocate',
    definitions: [{ language: 'vi', text: meaning }],
    phonetics: ['/ˈæləkeɪt/'],
    examples: [{ text: `We allocate resources in ${release}.`, translations: [{ language: 'vi', text: `Ví dụ ${release}` }] }],
    collocations: ['allocate resources'],
    wordFamily: ['allocation'],
    media: { audioUrl: null, imageUrl: 'https://images.pexels.com/photos/1/example.jpeg' },
    compatibility: {
      legacyPartOfSpeech: 'verb', translation: meaning, explanation: '', explanationTranslation: '', emoji: '',
      exampleSentence: `We allocate resources in ${release}.`, exampleTranslation: `Ví dụ ${release}`,
      synonyms: [], antonyms: [], register: '', commonMistake: '',
    },
    provenance: {
      source: 'licensed-editorial', license: 'CC-BY-4.0', reviewer: 'reviewer-1', editorialStatus: 'published',
    },
    contentVersion: 1,
    createdAt: '2026-08-03T00:00:00.000Z',
    updatedAt: '2026-08-03T00:00:00.000Z',
  };
};

const installContentRelease = async (releaseId: string, meaning: string) => {
  const lexeme = catalogLexeme(releaseId, meaning);
  const membership = entry(releaseId, {
    lexemeId: lexeme.id, language: lexeme.language, normalizedLemma: lexeme.normalizedLemma,
    lemma: lexeme.lemma, partOfSpeech: lexeme.partOfSpeech,
  });
  const handle = await beginCatalogInstall({ ...descriptor(releaseId), lexemeCount: 1 });
  await stageCatalogChunk(handle, {
    chunkId: 'chunk-0001', sha256: '8'.repeat(64), lexemeCount: 1, membershipCount: 1, encodedBytes: 128,
  }, [membership], [lexeme]);
  await activateCatalogInstall(handle);
  return { lexeme, membership };
};

const installRelease = async (releaseId: string, item: CatalogCacheEntry = entry(releaseId)) => {
  const handle = await beginCatalogInstall(descriptor(releaseId));
  await stageCatalogChunk(handle, {
    chunkId: 'chunk-0001',
    sha256: 'a'.repeat(64),
    lexemeCount: 0,
    membershipCount: 1,
    encodedBytes: 128,
  }, [item]);
  await activateCatalogInstall(handle);
  return handle;
};

describe('catalog IndexedDB cache', () => {
  beforeEach(async () => {
    closeCatalogCacheForTests();
    await deleteDatabase();
  });

  it('upgrades schema v2 in place with a release-scoped lexeme store', async () => {
    await createSchemaV2Database();

    const database = await openCatalogCacheDatabase();

    expect(database.version).toBe(3);
    expect(database.objectStoreNames.contains(LEXEME_STORE)).toBe(true);
    const transaction = database.transaction(LEXEME_STORE, 'readonly');
    expect(transaction.objectStore(LEXEME_STORE).indexNames.contains('releaseKey')).toBe(true);
  });

  it('rejects a blocked upgrade with recovery guidance and clears the cached open for retry', async () => {
    const blocker = await openSchemaV2Database();
    blocker.onversionchange = () => undefined;
    const firstOpen = openCatalogCacheDatabase(25);
    const firstOutcome = await Promise.race([
      firstOpen.then(
        () => ({ status: 'opened' as const, message: '' }),
        error => ({ status: 'rejected' as const, message: error instanceof Error ? error.message : String(error) }),
      ),
      new Promise<{ status: 'pending'; message: string }>(resolve => {
        setTimeout(() => resolve({ status: 'pending', message: '' }), 25);
      }),
    ]);

    blocker.close();
    await new Promise(resolve => setTimeout(resolve, 0));
    const retryOpen = openCatalogCacheDatabase(100);
    const database = await retryOpen;

    expect(firstOutcome).toEqual({
      status: 'rejected',
      message: 'Catalog storage is blocked by another SonFlash tab. Close older SonFlash tabs, then try again.',
    });
    expect(retryOpen).not.toBe(firstOpen);
    expect(database.version).toBe(3);
  });

  it('times out an IndexedDB open request that never settles', async () => {
    vi.useFakeTimers();
    const open = vi.spyOn(indexedDB, 'open').mockReturnValue({} as IDBOpenDBRequest);
    const pending = openCatalogCacheDatabase(25);
    const outcomePromise = Promise.race([
      pending.then(
        () => ({ status: 'opened' as const, message: '' }),
        error => ({ status: 'rejected' as const, message: error instanceof Error ? error.message : String(error) }),
      ),
      new Promise<{ status: 'pending'; message: string }>(resolve => {
        setTimeout(() => resolve({ status: 'pending', message: '' }), 25);
      }),
    ]);

    await vi.advanceTimersByTimeAsync(25);
    const outcome = await outcomePromise;
    closeCatalogCacheForTests();
    open.mockRestore();
    vi.useRealTimers();

    expect(outcome).toEqual({
      status: 'rejected',
      message: 'Catalog storage did not respond in time. Close older SonFlash tabs, then try again.',
    });
  });

  it('keeps the active release authoritative while a replacement is interrupted', async () => {
    await installRelease('release-1');
    const interrupted = await beginCatalogInstall(descriptor('release-2', 2, 2));
    await stageCatalogChunk(interrupted, {
      chunkId: 'chunk-0001', sha256: 'b'.repeat(64), membershipCount: 1, encodedBytes: 128,
      lexemeCount: 0,
    }, [entry('new-1')]);

    await expect(getActiveCatalogRelease('english-core')).resolves.toMatchObject({ releaseId: 'release-1' });
    await expect(activateCatalogInstall(interrupted)).rejects.toThrow('incomplete');
  });

  it('resumes the same release and skips an already verified receipt', async () => {
    const first = await beginCatalogInstall(descriptor('release-1'));
    await stageCatalogChunk(first, {
      chunkId: 'chunk-0001', sha256: 'c'.repeat(64), membershipCount: 1, encodedBytes: 128,
      lexemeCount: 0,
    }, [entry('one')]);
    closeCatalogCacheForTests();

    const resumed = await beginCatalogInstall(descriptor('release-1'));
    expect(resumed.installId).toBe(first.installId);
    await expect(getCatalogInstallStatus(resumed)).resolves.toMatchObject({
      receivedChunks: 1,
      receivedMemberships: 1,
      complete: true,
    });
    await expect(stageCatalogChunk(resumed, {
      chunkId: 'chunk-0001', sha256: 'c'.repeat(64), membershipCount: 1, encodedBytes: 128,
      lexemeCount: 0,
    }, [entry('one')])).resolves.toBe('already-staged');
  });

  it('rejects stale install handles after a newer release starts', async () => {
    const stale = await beginCatalogInstall(descriptor('release-1'));
    await beginCatalogInstall(descriptor('release-2'));

    await expect(stageCatalogChunk(stale, {
      chunkId: 'chunk-0001', sha256: 'd'.repeat(64), membershipCount: 1, encodedBytes: 128,
      lexemeCount: 0,
    }, [entry('stale')])).rejects.toThrow('stale');
  });

  it('atomically retains the previous release and can roll back to it', async () => {
    await installRelease('release-1');
    await installRelease('release-2');
    await expect(getActiveCatalogRelease('english-core')).resolves.toMatchObject({ releaseId: 'release-2' });

    await rollbackCatalogRelease('english-core');

    await expect(getActiveCatalogRelease('english-core')).resolves.toMatchObject({ releaseId: 'release-1' });
  });

  it('purges every generation older than active and previous after a third activation', async () => {
    await installRelease('release-1', entry('one'));
    await installRelease('release-2', entry('two'));
    await installRelease('release-3', entry('three'));

    const database = await openCatalogCacheDatabase();
    const transaction = database.transaction([RELEASE_STORE, RECEIPT_STORE, ENTRY_STORE, SKILL_STORE], 'readonly');
    const releases = await new Promise<unknown[]>((resolve, reject) => {
      const request = transaction.objectStore(RELEASE_STORE).getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    }) as { releaseId: string }[];
    const counts = await Promise.all([RECEIPT_STORE, ENTRY_STORE, SKILL_STORE].map(storeName => (
      new Promise<number>((resolve, reject) => {
        const request = transaction.objectStore(storeName).count();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      })
    )));

    expect(releases.map(value => value.releaseId).sort()).toEqual(['release-2', 'release-3']);
    expect(counts).toEqual([2, 2, 2]);
  });

  it('purges a replaced interrupted generation without touching the active release', async () => {
    await installRelease('release-1', entry('active'));
    const interrupted = await beginCatalogInstall(descriptor('release-2'));
    await stageCatalogChunk(interrupted, {
      chunkId: 'chunk-0001', sha256: '9'.repeat(64), membershipCount: 1, encodedBytes: 128,
      lexemeCount: 0,
    }, [entry('interrupted')]);

    await beginCatalogInstall(descriptor('release-3'));

    const database = await openCatalogCacheDatabase();
    const transaction = database.transaction([RELEASE_STORE, ENTRY_STORE], 'readonly');
    const releases = await new Promise<{ releaseId: string }[]>((resolve, reject) => {
      const request = transaction.objectStore(RELEASE_STORE).getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const entries = await new Promise<{ membershipId: string }[]>((resolve, reject) => {
      const request = transaction.objectStore(ENTRY_STORE).getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    expect(releases.map(value => value.releaseId).sort()).toEqual(['release-1', 'release-3']);
    expect(entries.map(value => value.membershipId)).toEqual(['active']);
    await expect(getActiveCatalogRelease('english-core')).resolves.toMatchObject({ releaseId: 'release-1' });
  });

  it('does not expose an incomplete release through a stale active pointer', async () => {
    const staging = await beginCatalogInstall(descriptor('release-1'));
    const database = await openCatalogCacheDatabase();
    const transaction = database.transaction(CATALOG_STORE, 'readwrite');
    const store = transaction.objectStore(CATALOG_STORE);
    const catalog = await new Promise<Record<string, unknown>>((resolve, reject) => {
      const request = store.get('english-core');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    store.put({ ...catalog, activeReleaseKey: staging.releaseKey });
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error);
      transaction.onerror = () => reject(transaction.error);
    });

    await expect(getActiveCatalogReleaseKey('english-core')).resolves.toBeNull();
  });

  it('does not replace the active release when a staging write hits quota', async () => {
    await installRelease('release-1');
    const replacement = await beginCatalogInstall(descriptor('release-2'));
    const put = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementationOnce(() => {
      throw new DOMException('Storage quota exceeded.', 'QuotaExceededError');
    });

    await expect(stageCatalogChunk(replacement, {
      chunkId: 'chunk-0001', sha256: 'e'.repeat(64), membershipCount: 1, encodedBytes: 128,
      lexemeCount: 0,
    }, [entry('new')])).rejects.toThrow();
    put.mockRestore();

    await expect(getActiveCatalogRelease('english-core')).resolves.toMatchObject({ releaseId: 'release-1' });
  });

  it('rejects oversized releases, chunks, duplicate members and learner-owned fields', async () => {
    await expect(beginCatalogInstall(descriptor('too-large', 10_001))).rejects.toThrow('10,000');
    const handle = await beginCatalogInstall(descriptor('release-1', 2));
    await expect(stageCatalogChunk(handle, {
      chunkId: 'chunk-0001', sha256: 'f'.repeat(64), membershipCount: 101, encodedBytes: 128,
      lexemeCount: 0,
    }, Array.from({ length: 101 }, (_, index) => entry(String(index))))).rejects.toThrow('100');
    await expect(stageCatalogChunk(handle, {
      chunkId: 'chunk-0001', sha256: 'f'.repeat(64), membershipCount: 2, encodedBytes: 128,
      lexemeCount: 0,
    }, [entry('duplicate'), entry('duplicate')])).rejects.toThrow('duplicate');
    await expect(stageCatalogChunk(handle, {
      chunkId: 'chunk-0002', sha256: 'f'.repeat(64), membershipCount: 1, encodedBytes: 128,
      lexemeCount: 0,
    }, [{ ...entry('private'), learningState: { ownerId: 'user-a' } } as CatalogCacheEntry]))
      .rejects.toThrow('unknown field');
  });

  it('persists complete release-scoped lexeme content and hydrates at most 100 memberships', async () => {
    const installed = await installContentRelease('release-1', 'phân bổ');

    const [value] = await getCatalogLexemes('english-core', [installed.lexeme.id]);
    expect(value).toMatchObject({
      definitions: [{ language: 'vi', text: 'phân bổ' }],
      phonetics: ['/ˈæləkeɪt/'],
      examples: [{ translations: [{ language: 'vi', text: 'Ví dụ release-1' }] }],
      collocations: ['allocate resources'],
      media: { imageUrl: 'https://images.pexels.com/photos/1/example.jpeg' },
      provenance: { source: 'licensed-editorial', license: 'CC-BY-4.0', reviewer: 'reviewer-1' },
    });
    await expect(hydrateCatalogEntries('english-core', [installed.membership])).resolves.toEqual([
      { membership: installed.membership, lexeme: value },
    ]);
    await expect(getCatalogLexemes(
      'english-core', Array.from({ length: 101 }, (_, index) => `lexeme-${index}`),
    )).rejects.toThrow('100');
  });

  it('switches and rolls back full lexeme content, then purges an obsolete third generation', async () => {
    const first = await installContentRelease('release-1', 'nghĩa cũ');
    await installContentRelease('release-2', 'nghĩa mới');
    await expect(getCatalogLexemes('english-core', [first.lexeme.id])).resolves.toEqual([
      expect.objectContaining({ definitions: [{ language: 'vi', text: 'nghĩa mới' }] }),
    ]);

    await rollbackCatalogRelease('english-core');
    await expect(getCatalogLexemes('english-core', [first.lexeme.id])).resolves.toEqual([
      expect.objectContaining({ definitions: [{ language: 'vi', text: 'nghĩa cũ' }] }),
    ]);
    await rollbackCatalogRelease('english-core');
    await installContentRelease('release-3', 'nghĩa thứ ba');

    const database = await openCatalogCacheDatabase();
    const transaction = database.transaction(LEXEME_STORE, 'readonly');
    const stored = await new Promise<{ releaseKey: string }[]>((resolve, reject) => {
      const request = transaction.objectStore(LEXEME_STORE).getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    expect(stored).toHaveLength(2);
  });

  it('rejects learner-owned fields from the lexeme content store', async () => {
    const lexeme = catalogLexeme('release-1', 'phân bổ');
    const handle = await beginCatalogInstall({ ...descriptor('release-1'), lexemeCount: 1 });
    await expect(stageCatalogChunk(handle, {
      chunkId: 'chunk-0001', sha256: '7'.repeat(64), lexemeCount: 1, membershipCount: 1, encodedBytes: 128,
    }, [entry('one', { lexemeId: lexeme.id })], [{ ...lexeme, learningState: { ownerId: 'private' } } as LexemeV3]))
      .rejects.toThrow('unknown field');
  });
});
