import {
  collection,
  getDocs,
  limit,
  query,
  where,
  type Firestore,
} from 'firebase/firestore';

import type { CatalogLearningStatus, CatalogUnitSummary, CatalogWorkspaceSummary } from '../catalogCache/catalogSummary';

export const CATALOG_PROGRESS_PROJECTION_LIMIT = 10_000;
export const CATALOG_PATH_UNIT_LEXEME_LIMIT = 20;

export type CatalogProgressProjectionStatus = 'active' | 'mastered';
export type CatalogPathUnitStatus = 'not-started' | 'active' | 'complete';

export interface CatalogProgressProjection {
  readonly lexemeId: string;
  readonly status: CatalogProgressProjectionStatus;
}

export interface CatalogPathUnitProgress {
  readonly unit: CatalogUnitSummary;
  readonly introduced: number;
  readonly mastered: number;
  readonly status: CatalogPathUnitStatus;
}

const isIdentifier = (value: unknown): value is string => (
  typeof value === 'string' && value.length > 0 && value.length <= 128 && !value.includes('/')
);

const isCounter = (value: unknown): value is number => (
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
);

const validProjection = (
  id: string,
  value: unknown,
  ownerId: string,
  targetLanguage: string,
  libraryEpoch: number,
): CatalogProgressProjection | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const projection = value as Record<string, unknown>;
  if (
    projection.schemaVersion !== 1
    || projection.ownerId !== ownerId
    || projection.lexemeId !== id
    || projection.targetLanguage !== targetLanguage
    || (projection.status !== 'active' && projection.status !== 'mastered')
    || !isCounter(projection.cardRevision)
    || projection.libraryEpoch !== libraryEpoch
  ) return null;
  return { lexemeId: id, status: projection.status };
};

/**
 * Reads the server-owned projection once. Invalid, stale, and other-language
 * documents are excluded before catalog aggregation.
 */
export async function readCatalogProgressProjection(
  database: Firestore,
  ownerId: string,
  targetLanguage: string,
  libraryEpoch: number,
): Promise<ReadonlyMap<string, CatalogLearningStatus>> {
  if (!isIdentifier(ownerId) || !isIdentifier(targetLanguage) || !isCounter(libraryEpoch)) {
    throw new TypeError('Catalog progress reader requires bounded owner, language, and library epoch values.');
  }
  const snapshot = await getDocs(query(
    collection(database, 'users', ownerId, 'catalog_progress'),
    where('targetLanguage', '==', targetLanguage),
    limit(CATALOG_PROGRESS_PROJECTION_LIMIT + 1),
  ));
  if (snapshot.docs.length > CATALOG_PROGRESS_PROJECTION_LIMIT) {
    throw new RangeError(`Catalog progress supports at most ${CATALOG_PROGRESS_PROJECTION_LIMIT.toLocaleString('en-US')} projections.`);
  }
  const statuses = new Map<string, CatalogLearningStatus>();
  snapshot.docs.forEach(document => {
    const projection = validProjection(document.id, document.data(), ownerId, targetLanguage, libraryEpoch);
    if (projection) statuses.set(projection.lexemeId, projection.status === 'mastered' ? 'mastered' : 'started');
  });
  return statuses;
}

const assertUnitCounts = (unit: CatalogUnitSummary): void => {
  if (
    !Number.isSafeInteger(unit.total)
    || !Number.isSafeInteger(unit.started)
    || !Number.isSafeInteger(unit.mastered)
    || unit.total < 1
    || unit.total > CATALOG_PATH_UNIT_LEXEME_LIMIT
    || unit.started < 0
    || unit.mastered < 0
    || unit.mastered > unit.started
    || unit.started > unit.total
  ) throw new RangeError(`Catalog unit ${unit.unitId} has invalid bounded progress counts.`);
};

/**
 * Converts the full-membership Catalog V2 summary into Paths unit state.
 * `started` means introduced; it never makes a unit complete on its own.
 */
export function projectCatalogPathUnits(
  summary: CatalogWorkspaceSummary | null,
): readonly CatalogPathUnitProgress[] | null {
  if (!summary || summary.release.schemaVersion !== 2 || !summary.units) return null;
  return summary.units.map(unit => {
    assertUnitCounts(unit);
    return {
      unit,
      introduced: unit.started,
      mastered: unit.mastered,
      status: unit.mastered === unit.total ? 'complete' : unit.started > 0 ? 'active' : 'not-started',
    };
  });
}
