import {
  ENTRY_STORE,
  getActiveCatalogReleaseKey,
  getActiveCatalogReleaseSnapshot,
  openCatalogCacheDatabase,
  publicCatalogEntry,
  type CatalogReleaseDescriptor,
  type StoredCatalogEntry,
} from './catalogCache';

const MAXIMUM_RELEASE_MEMBERSHIPS = 10_000;
const MAXIMUM_IDENTIFIER_LENGTH = 128;

export type CatalogLearningStatus = 'started' | 'mastered';

export interface CatalogTierSummary {
  readonly tier: string;
  readonly total: number;
  readonly started: number;
  readonly mastered: number;
}

export interface CatalogFacetSummary {
  readonly cefrLevels: readonly string[];
  readonly topics: readonly string[];
  readonly partsOfSpeech: readonly string[];
  readonly skills: readonly string[];
}

export interface CatalogTrackSummary {
  readonly trackId: string;
  readonly total: number;
  readonly started: number;
  readonly mastered: number;
  readonly tiers: readonly CatalogTierSummary[];
  readonly facets: CatalogFacetSummary;
}

export interface CatalogWorkspaceSummary {
  readonly release: CatalogReleaseDescriptor;
  readonly scannedMemberships: number;
  readonly tracks: readonly CatalogTrackSummary[];
}

interface MutableCount {
  total: number;
  started: number;
  mastered: number;
}

interface MutableTrack extends MutableCount {
  readonly tiers: Map<string, MutableCount>;
  readonly cefrLevels: Set<string>;
  readonly topics: Set<string>;
  readonly partsOfSpeech: Set<string>;
  readonly skills: Set<string>;
}

const transactionDone = (transaction: IDBTransaction): Promise<void> => new Promise((resolve, reject) => {
  transaction.oncomplete = () => resolve();
  transaction.onabort = () => reject(transaction.error ?? new Error('Catalog summary transaction was aborted.'));
  transaction.onerror = () => reject(transaction.error ?? new Error('Catalog summary transaction failed.'));
});

const requestResult = <T>(request: IDBRequest<T>): Promise<T> => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error ?? new Error('Catalog summary request failed.'));
});

const nextCursor = (
  request: IDBRequest<IDBCursorWithValue | null>,
  cursor: IDBCursorWithValue,
): Promise<IDBCursorWithValue | null> => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error ?? new Error('Catalog summary cursor failed.'));
  cursor.continue();
});

const validateLearningStatuses = (
  statuses: ReadonlyMap<string, CatalogLearningStatus>,
): ReadonlyMap<string, CatalogLearningStatus> => {
  if (!(statuses instanceof Map) || statuses.size > MAXIMUM_RELEASE_MEMBERSHIPS) {
    throw new TypeError(`Learning status input must be a Map with at most ${MAXIMUM_RELEASE_MEMBERSHIPS.toLocaleString('en-US')} entries.`);
  }
  for (const [lexemeId, status] of statuses) {
    if (typeof lexemeId !== 'string' || lexemeId.length === 0 || lexemeId.length > MAXIMUM_IDENTIFIER_LENGTH) {
      throw new TypeError('Each learning status lexeme ID must be a bounded non-empty string.');
    }
    if (status !== 'started' && status !== 'mastered') {
      throw new TypeError('Each learning status must be started or mastered.');
    }
  }
  return statuses;
};

const mutableCount = (): MutableCount => ({ total: 0, started: 0, mastered: 0 });

const mutableTrack = (): MutableTrack => ({
  ...mutableCount(),
  tiers: new Map(),
  cefrLevels: new Set(),
  topics: new Set(),
  partsOfSpeech: new Set(),
  skills: new Set(),
});

const applyStatus = (count: MutableCount, status: CatalogLearningStatus | undefined): void => {
  count.total += 1;
  if (status !== undefined) count.started += 1;
  if (status === 'mastered') count.mastered += 1;
};

const sorted = (values: ReadonlySet<string>): readonly string[] => [...values].sort();

/**
 * Reads only the active immutable release and never infers progress from an
 * installation. The supplied status map is learner-owned and remains outside
 * the catalog database.
 */
export async function summarizeActiveCatalog(
  catalogId: string,
  learningStatuses: ReadonlyMap<string, CatalogLearningStatus>,
): Promise<CatalogWorkspaceSummary | null> {
  const statuses = validateLearningStatuses(learningStatuses);
  const snapshot = await getActiveCatalogReleaseSnapshot(catalogId);
  if (!snapshot) return null;
  if (snapshot.release.membershipCount > MAXIMUM_RELEASE_MEMBERSHIPS) {
    throw new RangeError(`Active catalog releases may contain at most ${MAXIMUM_RELEASE_MEMBERSHIPS.toLocaleString('en-US')} memberships.`);
  }

  const database = await openCatalogCacheDatabase();
  const transaction = database.transaction(ENTRY_STORE, 'readonly');
  const done = transactionDone(transaction);
  const request = transaction.objectStore(ENTRY_STORE)
    .index('releaseKey')
    .openCursor(IDBKeyRange.only(snapshot.releaseKey));
  const tracks = new Map<string, MutableTrack>();
  let scannedMemberships = 0;
  let cursor = await requestResult(request);
  while (cursor) {
    scannedMemberships += 1;
    if (scannedMemberships > MAXIMUM_RELEASE_MEMBERSHIPS) {
      transaction.abort();
      await done.catch(() => undefined);
      throw new RangeError(`Catalog summary exceeded ${MAXIMUM_RELEASE_MEMBERSHIPS.toLocaleString('en-US')} memberships.`);
    }
    const entry = publicCatalogEntry(cursor.value as StoredCatalogEntry);
    const track = tracks.get(entry.trackId) ?? mutableTrack();
    if (!tracks.has(entry.trackId)) tracks.set(entry.trackId, track);
    const tier = track.tiers.get(entry.tier) ?? mutableCount();
    if (!track.tiers.has(entry.tier)) track.tiers.set(entry.tier, tier);
    const status = statuses.get(entry.lexemeId);
    applyStatus(track, status);
    applyStatus(tier, status);
    if (entry.cefrLevel !== null) track.cefrLevels.add(entry.cefrLevel);
    track.topics.add(entry.topic);
    track.partsOfSpeech.add(entry.partOfSpeech);
    entry.skills.forEach(skill => track.skills.add(skill));
    cursor = await nextCursor(request, cursor);
  }
  await done;

  if (scannedMemberships !== snapshot.release.membershipCount) {
    throw new Error('Active catalog membership count does not match its release descriptor.');
  }
  if (await getActiveCatalogReleaseKey(catalogId) !== snapshot.releaseKey) {
    throw new Error('The active catalog release changed while its summary was being read.');
  }

  return {
    release: snapshot.release,
    scannedMemberships,
    tracks: [...tracks.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([trackId, track]) => ({
      trackId,
      total: track.total,
      started: track.started,
      mastered: track.mastered,
      tiers: [...track.tiers.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([tier, count]) => ({
        tier,
        total: count.total,
        started: count.started,
        mastered: count.mastered,
      })),
      facets: {
        cefrLevels: sorted(track.cefrLevels),
        topics: sorted(track.topics),
        partsOfSpeech: sorted(track.partsOfSpeech),
        skills: sorted(track.skills),
      },
    })),
  };
}
