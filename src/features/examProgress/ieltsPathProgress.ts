import {
  collection,
  documentId,
  getDocs,
  limit,
  orderBy,
  query,
  where,
  type Firestore,
} from 'firebase/firestore';
import { validCatalogProgressProjection } from '../catalogWorkspace/catalogProgressProjectionService';
import type { IeltsPathCounts } from './ieltsGoalModel';
import { IELTS_PATH_LANGUAGE } from './ieltsPathReader';

/** Firestore allows at most 30 values in an `in` filter. */
export const CATALOG_PROGRESS_BATCH_SIZE = 30;
/** Cards mastered in the last 28 days read at most; one more document tells that the limit was reached. */
export const RECENT_MASTERY_LIMIT = 500;

const DAY_MS = 86_400_000;

export interface IeltsPathProgressRequest {
  readonly database: Firestore;
  readonly ownerId: string;
  readonly libraryEpoch: number;
  readonly lexemeIds: readonly string[];
  readonly now: Date;
}

const isIdentifier = (value: unknown): value is string => (
  typeof value === 'string' && value.length > 0 && value.length <= 128 && !value.includes('/')
);

const chunks = <T>(values: readonly T[], size: number): T[][] => {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
};

const validIsoInstant = (value: unknown): value is string => typeof value === 'string' && !Number.isNaN(Date.parse(value));

/**
 * Reads progress for the path's lexemes only: their catalog progress projections in batches, and
 * the cards mastered in the last 28 days. A recent mastery counts only for a path lexeme whose
 * projection is still mastered in the current library epoch.
 */
export async function readIeltsPathCounts(request: IeltsPathProgressRequest): Promise<IeltsPathCounts> {
  const { database, ownerId, libraryEpoch, now } = request;
  if (!isIdentifier(ownerId) || !Number.isSafeInteger(libraryEpoch) || libraryEpoch < 0) {
    throw new TypeError('IELTS path progress requires a bounded owner and library epoch.');
  }
  const lexemeIds = [...new Set(request.lexemeIds)];
  if (!lexemeIds.every(isIdentifier)) throw new TypeError('IELTS path lexeme ids must be bounded identifiers.');
  const progress = collection(database, 'users', ownerId, 'catalog_progress');
  const snapshots = await Promise.all(chunks(lexemeIds, CATALOG_PROGRESS_BATCH_SIZE)
    .map(batch => getDocs(query(progress, where(documentId(), 'in', batch)))));
  const started = new Set<string>();
  const mastered = new Set<string>();
  for (const snapshot of snapshots) {
    for (const document of snapshot.docs) {
      const projection = validCatalogProgressProjection(document.id, document.data(), ownerId, IELTS_PATH_LANGUAGE, libraryEpoch);
      if (!projection) continue;
      started.add(projection.lexemeId);
      if (projection.status === 'mastered') mastered.add(projection.lexemeId);
    }
  }

  const since28 = new Date(now.getTime() - 28 * DAY_MS).toISOString();
  const since7 = new Date(now.getTime() - 7 * DAY_MS).toISOString();
  const recent = await getDocs(query(
    collection(database, 'users', ownerId, 'cards'),
    where('language', '==', IELTS_PATH_LANGUAGE),
    where('masteredAt', '>=', since28),
    orderBy('masteredAt', 'desc'),
    limit(RECENT_MASTERY_LIMIT + 1),
  ));
  const reachedLimit = recent.docs.length > RECENT_MASTERY_LIMIT;
  const documents = recent.docs.slice(0, RECENT_MASTERY_LIMIT);
  const latestMastery = new Map<string, string>();
  let oldestRead: string | null = null;
  for (const document of documents) {
    const card = document.data() as Record<string, unknown>;
    const masteredAt = card.masteredAt;
    if (!validIsoInstant(masteredAt)) continue;
    if (oldestRead === null || masteredAt < oldestRead) oldestRead = masteredAt;
    if (!isIdentifier(card.lexemeId) || !mastered.has(card.lexemeId)) continue;
    const previous = latestMastery.get(card.lexemeId);
    if (previous === undefined || masteredAt > previous) latestMastery.set(card.lexemeId, masteredAt);
  }
  const lastWeek = [...latestMastery.values()].filter(masteredAt => masteredAt >= since7).length;
  // When the limit was reached, the week is still complete if the oldest card read is older than a week.
  const weekComplete = !reachedLimit || (oldestRead !== null && oldestRead < since7);
  return {
    total: lexemeIds.length,
    started: started.size,
    mastered: mastered.size,
    masteredLast7: weekComplete ? lastWeek : null,
    masteredLast28: reachedLimit ? null : latestMastery.size,
  };
}
