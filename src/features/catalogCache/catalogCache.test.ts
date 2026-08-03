import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  activateCatalogInstall,
  beginCatalogInstall,
  CATALOG_STORE,
  closeCatalogCacheForTests,
  getActiveCatalogRelease,
  getActiveCatalogReleaseKey,
  getCatalogInstallStatus,
  ENTRY_STORE,
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

const installRelease = async (releaseId: string, item: CatalogCacheEntry = entry(releaseId)) => {
  const handle = await beginCatalogInstall(descriptor(releaseId));
  await stageCatalogChunk(handle, {
    chunkId: 'chunk-0001',
    sha256: 'a'.repeat(64),
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

  it('keeps the active release authoritative while a replacement is interrupted', async () => {
    await installRelease('release-1');
    const interrupted = await beginCatalogInstall(descriptor('release-2', 2, 2));
    await stageCatalogChunk(interrupted, {
      chunkId: 'chunk-0001', sha256: 'b'.repeat(64), membershipCount: 1, encodedBytes: 128,
    }, [entry('new-1')]);

    await expect(getActiveCatalogRelease('english-core')).resolves.toMatchObject({ releaseId: 'release-1' });
    await expect(activateCatalogInstall(interrupted)).rejects.toThrow('incomplete');
  });

  it('resumes the same release and skips an already verified receipt', async () => {
    const first = await beginCatalogInstall(descriptor('release-1'));
    await stageCatalogChunk(first, {
      chunkId: 'chunk-0001', sha256: 'c'.repeat(64), membershipCount: 1, encodedBytes: 128,
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
    }, [entry('one')])).resolves.toBe('already-staged');
  });

  it('rejects stale install handles after a newer release starts', async () => {
    const stale = await beginCatalogInstall(descriptor('release-1'));
    await beginCatalogInstall(descriptor('release-2'));

    await expect(stageCatalogChunk(stale, {
      chunkId: 'chunk-0001', sha256: 'd'.repeat(64), membershipCount: 1, encodedBytes: 128,
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
    }, [entry('new')])).rejects.toThrow();
    put.mockRestore();

    await expect(getActiveCatalogRelease('english-core')).resolves.toMatchObject({ releaseId: 'release-1' });
  });

  it('rejects oversized releases, chunks, duplicate members and learner-owned fields', async () => {
    await expect(beginCatalogInstall(descriptor('too-large', 10_001))).rejects.toThrow('10,000');
    const handle = await beginCatalogInstall(descriptor('release-1', 2));
    await expect(stageCatalogChunk(handle, {
      chunkId: 'chunk-0001', sha256: 'f'.repeat(64), membershipCount: 101, encodedBytes: 128,
    }, Array.from({ length: 101 }, (_, index) => entry(String(index))))).rejects.toThrow('100');
    await expect(stageCatalogChunk(handle, {
      chunkId: 'chunk-0001', sha256: 'f'.repeat(64), membershipCount: 2, encodedBytes: 128,
    }, [entry('duplicate'), entry('duplicate')])).rejects.toThrow('duplicate');
    await expect(stageCatalogChunk(handle, {
      chunkId: 'chunk-0002', sha256: 'f'.repeat(64), membershipCount: 1, encodedBytes: 128,
    }, [{ ...entry('private'), learningState: { ownerId: 'user-a' } } as CatalogCacheEntry]))
      .rejects.toThrow('unknown field');
  });
});
