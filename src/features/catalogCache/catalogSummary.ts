import {
  ENTRY_STORE,
  getActiveCatalogReleaseKey,
  getActiveCatalogReleaseSnapshot,
  openCatalogCacheDatabase,
  publicCatalogEntry,
  type CatalogReleaseDescriptor,
  type StoredCatalogEntry,
} from './catalogCache';
import type { CatalogUnitDescriptorV1 } from '../catalogPipeline/catalogContracts';
import { observeCatalogTransaction } from './catalogTransaction';

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

export interface CatalogUnitPreview {
  readonly lexemeId: string;
  readonly lemma: string;
}

export interface CatalogUnitSummary extends CatalogUnitDescriptorV1 {
  readonly total: number;
  readonly started: number;
  readonly mastered: number;
  /** First eight memberships by catalog rank, derived from the cached release. */
  readonly preview: readonly CatalogUnitPreview[];
}

export interface CatalogWorkspaceSummary {
  readonly release: CatalogReleaseDescriptor;
  readonly scannedMemberships: number;
  readonly tracks: readonly CatalogTrackSummary[];
  /** Empty for compatible V1 releases. */
  readonly units?: readonly CatalogUnitSummary[];
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

interface MutableUnit extends MutableCount {
  readonly descriptor: CatalogUnitDescriptorV1;
  readonly preview: UnitPreviewCandidate[];
}

interface UnitPreviewCandidate extends CatalogUnitPreview {
  readonly rank: number;
  readonly membershipId: string;
}

const transactionDone = (transaction: IDBTransaction): Promise<void> => observeCatalogTransaction(
  transaction,
  'Catalog summary transaction was aborted.',
  'Catalog summary transaction failed.',
);

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

const mutableUnit = (descriptor: CatalogUnitDescriptorV1): MutableUnit => ({
  ...mutableCount(), descriptor, preview: [],
});

const applyStatus = (count: MutableCount, status: CatalogLearningStatus | undefined): void => {
  count.total += 1;
  if (status !== undefined) count.started += 1;
  if (status === 'mastered') count.mastered += 1;
};

const sorted = (values: ReadonlySet<string>): readonly string[] => [...values].sort();

const unitKey = (trackId: string, unitId: string): string => `${trackId}\u0000${unitId}`;

const addPreview = (unit: MutableUnit, entry: StoredCatalogEntry): void => {
  unit.preview.push({
    lexemeId: entry.lexemeId,
    lemma: entry.lemma,
    rank: entry.rank,
    membershipId: entry.membershipId,
  });
  unit.preview.sort((left, right) => left.rank - right.rank || left.membershipId.localeCompare(right.membershipId));
  if (unit.preview.length > 8) unit.preview.pop();
};

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
  const units = new Map<string, MutableUnit>();
  if (snapshot.release.unitDescriptors) {
    snapshot.release.unitDescriptors.forEach(descriptor => {
      units.set(unitKey(descriptor.trackId, descriptor.unitId), mutableUnit(descriptor));
    });
  }
  let scannedMemberships = 0;
  let cursor = await requestResult(request);
  while (cursor) {
    scannedMemberships += 1;
    if (scannedMemberships > MAXIMUM_RELEASE_MEMBERSHIPS) {
      transaction.abort();
      await done.catch(() => undefined);
      throw new RangeError(`Catalog summary exceeded ${MAXIMUM_RELEASE_MEMBERSHIPS.toLocaleString('en-US')} memberships.`);
    }
    const storedEntry = cursor.value as StoredCatalogEntry;
    const entry = publicCatalogEntry(storedEntry);
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
    if (snapshot.release.unitDescriptors) {
      if (!entry.lessonGroup) {
        transaction.abort();
        await done.catch(() => undefined);
        throw new Error('Catalog V2 membership is missing its lesson group.');
      }
      const unit = units.get(unitKey(entry.trackId, entry.lessonGroup));
      if (!unit || unit.descriptor.tier !== entry.tier) {
        transaction.abort();
        await done.catch(() => undefined);
        throw new Error('Catalog V2 membership does not match its unit descriptor.');
      }
      applyStatus(unit, status);
      addPreview(unit, storedEntry);
    }
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
    units: [...units.values()]
      .sort((left, right) => left.descriptor.trackId.localeCompare(right.descriptor.trackId)
        || left.descriptor.ordinal - right.descriptor.ordinal)
      .map(unit => ({
        ...unit.descriptor,
        total: unit.total,
        started: unit.started,
        mastered: unit.mastered,
        preview: unit.preview.map(({ lexemeId, lemma }) => ({ lexemeId, lemma })),
      })),
  };
}
