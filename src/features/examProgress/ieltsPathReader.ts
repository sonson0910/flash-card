import {
  ENTRY_STORE,
  getActiveCatalogReleaseKey,
  getActiveCatalogReleaseSnapshot,
  openCatalogCacheDatabase,
  type StoredCatalogEntry,
} from '../catalogCache/catalogCache';
import { observeCatalogTransaction } from '../catalogCache/catalogTransaction';

export const IELTS_CATALOG_ID = 'english-core';
export const IELTS_PATH_LANGUAGE = 'en';
export const IELTS_TRACK_ID = 'ielts';
/** The reviewed path has about a hundred words; this bound keeps a damaged cache from flooding reads. */
export const MAX_IELTS_PATH_MEMBERSHIPS = 2_000;

const MAX_RANK = Number.MAX_SAFE_INTEGER;

const requestResult = <T>(request: IDBRequest<T>): Promise<T> => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error ?? new Error('IELTS path request failed.'));
});

/**
 * The distinct lexeme ids of the IELTS track in the installed active catalog release, in rank
 * order. Null when no complete release is installed or the release has no IELTS track. Throws
 * when the active release changes during the read.
 */
export async function readIeltsPathLexemeIds(catalogId: string = IELTS_CATALOG_ID): Promise<readonly string[] | null> {
  const snapshot = await getActiveCatalogReleaseSnapshot(catalogId);
  if (!snapshot) return null;
  const database = await openCatalogCacheDatabase();
  const transaction = database.transaction(ENTRY_STORE, 'readonly');
  const done = observeCatalogTransaction(transaction, 'IELTS path read was aborted.', 'IELTS path read failed.');
  const entries = await requestResult(transaction.objectStore(ENTRY_STORE)
    .index('releaseLanguageTrackRank')
    .getAll(IDBKeyRange.bound(
      [snapshot.releaseKey, IELTS_PATH_LANGUAGE, IELTS_TRACK_ID, 0, ''],
      [snapshot.releaseKey, IELTS_PATH_LANGUAGE, IELTS_TRACK_ID, MAX_RANK, '￿'],
    ), MAX_IELTS_PATH_MEMBERSHIPS + 1)) as StoredCatalogEntry[];
  await done;
  if (entries.length > MAX_IELTS_PATH_MEMBERSHIPS) {
    throw new RangeError(`The IELTS path may contain at most ${MAX_IELTS_PATH_MEMBERSHIPS} memberships.`);
  }
  if (await getActiveCatalogReleaseKey(catalogId) !== snapshot.releaseKey) {
    throw new Error('The active catalog release changed while the IELTS path was being read.');
  }
  const lexemeIds: string[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    const lexemeId = entry.lexemeId;
    if (typeof lexemeId !== 'string' || lexemeId.length === 0 || lexemeId.length > 128 || lexemeId.includes('/')) {
      throw new Error('An IELTS path membership has an invalid lexeme id.');
    }
    if (!seen.has(lexemeId)) {
      seen.add(lexemeId);
      lexemeIds.push(lexemeId);
    }
  }
  return lexemeIds.length > 0 ? lexemeIds : null;
}
